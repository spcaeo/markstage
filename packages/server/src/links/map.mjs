// The site's link map on the server (docs/API-LINKS.md): every entry of the topic collections read once per change
// (each entry's links and text blocks are kept by its version, so a save re-reads that entry only), the topic files,
// and the site's redirects (asked of its redirects hook at most once a minute). core's link-map.mjs does the rest.
// A site with its own finder (`topics.related`: an embeddings index, an AI model) is asked for the words that name a
// page when someone looks at that page's suggestions; the answer is kept by the page's version.
import { runCommand } from '../jobs.mjs';

const REDIRECTS_FOR = 60_000;
const RELATED_MAX = 20;
const RELATED_TEXT = 4000;

const at = (data, key) => (key ? key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data) : undefined);
const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean);

export function createLinkMap(app, { core, cfg, files }) {
  const { store, config, converter } = app;
  const kept = new Map(); // ref -> {version, page}
  let redirects = { at: 0, list: [] };
  let last = null;
  const related = new Map(); // ref -> {version, phrases}
  let relatedRev = 0;

  /** One entry as the map needs it (null when it does not read). */
  function pageOf(c, id) {
    let cur;
    try {
      cur = store.read(c, id);
    } catch {
      return null;
    }
    const ref = `${c.id}/${id}`;
    const hit = kept.get(ref);
    if (hit && hit.version === cur.version) return hit.page;
    let page = null;
    try {
      const s = store.summarize(c, id, cur.text);
      const fields = store.fieldsOf(c, cur.text) ?? {};
      const doc = c.format === 'md' ? converter.mdToDoc(cur.text).doc : null;
      const { links, blocks } = core.map.entryText({ format: c.format, doc, data: fields });
      const type = config.pageTypes ? core.pageTypes.pageTypeOf({ pageTypes: config.pageTypes, collections: store.collections }, c, fields) : null;
      page = {
        ref,
        collection: c.id,
        id,
        title: s.title || id,
        url: s.url ?? null,
        paths: app.site?.pathsOf?.(s.url) ?? (s.url ? [s.url] : []),
        status: s.status ?? 'published',
        // the page's own last-changed date (its modified field, else its date)
        updated: s.modified || s.date || null,
        // each as the entry says it, never guessed: when it first went out (its date field) and when it last changed
        published: s.date || null,
        modified: s.modified || null,
        live: !c.hasStatus || (s.status ?? 'published') === 'published',
        noindex: core.map.isNoindex(at(fields, cfg.robots), fields.noindex),
        type: type?.id ?? null,
        keywords: list(at(fields, cfg.keywords)),
        format: c.format,
        links,
        blocks,
      };
    } catch {
      page = null;
    }
    kept.set(ref, { version: cur.version, page });
    return page;
  }

  /** Ask the site's redirects hook again when its list is older than a minute (none without a hook). */
  async function refreshRedirects() {
    if (!config.redirects || !app.redirectsHook || Date.now() - redirects.at < REDIRECTS_FOR) return;
    try {
      const l = await app.repoLock.run(() => app.redirectsHook.list());
      redirects = { at: Date.now(), list: (l.redirects ?? []).map((r) => ({ from: r.from, to: r.to })) };
    } catch {
      redirects = { at: Date.now(), list: [] };
    }
  }

  /**
   * Ask the site's `related` hook for the words that name a page (once per version of the page). It gets JSON on
   * stdin, {page: {ref, title, url, keywords, text}, pages: [{ref, title, url}]}, and answers {phrases: [words]} on
   * stdout. A hook that fails or times out counts as no words (the phrase match still runs).
   */
  async function relatedFor(ref) {
    if (!cfg.related) return;
    const hit = kept.get(ref);
    if (!hit?.page || related.get(ref)?.version === hit.version) return;
    const p = hit.page;
    const all = [...kept.values()].map((k) => k.page).filter(Boolean);
    const text = (p.blocks ?? []).map((b) => b.text).join('\n').slice(0, RELATED_TEXT);
    const input = JSON.stringify({ page: { ref, title: p.title, url: p.url, keywords: p.keywords, text }, pages: all.map((x) => ({ ref: x.ref, title: x.title, url: x.url })) });
    let out = '';
    let phrases = [];
    try {
      const r = await runCommand(cfg.related.command, { cwd: config.contentRoot, timeoutSeconds: cfg.related.timeoutSeconds, stdin: input, onStdout: (d) => (out += d) });
      const answer = r.code === 0 ? JSON.parse(out) : null;
      phrases = (Array.isArray(answer?.phrases) ? answer.phrases : []).filter((x) => typeof x === 'string' && x.trim() && x.length <= 80).slice(0, RELATED_MAX);
    } catch {
      phrases = [];
    }
    related.set(ref, { version: hit.version, phrases });
    relatedRev++;
  }

  /** The topics as files have them: [{id, version, topic}]. */
  const topicFiles = () => files.all();

  /**
   * The map of the site as it is now (the same object while nothing changed), with the redirects last asked for.
   * Which entries changed comes from the content index (store.rev, a stat sweep): only those are read again.
   */
  function current() {
    const rev = store.rev();
    const tf = topicFiles();
    const rd = redirects.list;
    const key = JSON.stringify([rev, tf.map((t) => [t.id, t.version]), rd, relatedRev]);
    if (last?.key === key) return last.map;
    const pages = [];
    const seen = new Set();
    for (const c of store.collections) {
      if (!cfg.collections.includes(c.id)) continue;
      for (const e of store.index(c).values()) {
        const ref = `${c.id}/${e.id}`;
        const hit = kept.get(ref);
        const p = hit && hit.version === e.version ? hit.page : pageOf(c, e.id);
        seen.add(ref);
        const r = related.get(ref);
        if (p) pages.push(r && r.version === kept.get(p.ref)?.version && r.phrases.length ? { ...p, related: r.phrases } : p);
      }
    }
    for (const ref of kept.keys()) if (!seen.has(ref)) kept.delete(ref), related.delete(ref);
    const map = core.map.buildLinkMap({ pages, topics: tf.map((t) => t.topic), redirects: rd, cfg, siteUrl: config.siteUrl ?? '' });
    last = { key, map };
    return map;
  }

  /** Forget the redirects (after the site's redirects changed). */
  const forgetRedirects = () => {
    redirects = { at: 0, list: [] };
  };

  /** The map with the redirects asked for again when they are old (the routes use this; checks inside a save use current). */
  async function fresh() {
    await refreshRedirects();
    return current();
  }

  return { current, fresh, pageOf, forgetRedirects, relatedFor };
}
