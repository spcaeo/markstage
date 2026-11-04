// GET collections/:c/entries/:id/preflight: what the publish sheet shows before anything goes live, from the saved
// entry. The site's own validate and pre-build checks; the post-build checks that will run during the publish (e.g.
// hreflang); images without alt text; internal links that point at no page, or at a page that is not live; and the
// entry's address in every locale. The phone check runs in the browser, in the preview (the measuring agent).
import fs from 'node:fs';
import path from 'node:path';
import { isWithin } from './config.mjs';
import { linkRewriter, movePairs, rewriteEntry } from './content/links.mjs';
import { duplicatesOf, headingIssues, verdicts } from './publish-rules.mjs';
import { atLeast, owns } from './roles.mjs';
import { HttpError, notFound, sha1 } from './util.mjs';

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const HREF = /\bhref\s*=\s*(["'])([^"']*)\1/gi;
const IMG_TAG = /<img\b[^>]*>/gi;

/** Every string of a value, with its key and the object holding it. */
function* strings(v, key = null, holder = null, where = '') {
  if (typeof v === 'string') yield { value: v, key, holder, where };
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], key, v, `${where}[${i}]`);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) yield* strings(x, k, v, where ? `${where}.${k}` : k);
}

/** The src of each <img> with no alt attribute or a blank one (alt="" is HTML's mark for a decorative image). */
const imgsWithoutAlt = (html) =>
  (html.match(IMG_TAG) ?? []).filter((tag) => !/\balt\s*=\s*(["'])(\s*\S[^"']*)?\1/i.test(tag)).map((tag) => /\bsrc\s*=\s*(["'])([^"']*)\1/i.exec(tag)?.[2] ?? '');

/** Images without alt text: Markdown image nodes, <img> in HTML, and {src, alt} objects (covers, JSON images). */
export function missingAlt(doc, fields, decorativeClass = 'decorative', images = []) {
  // an image is decorative when its <figure> carries the site's decorative class (core image attrs: figure = the class)
  const decorative = (n) => String(n.attrs?.figure ?? '').split(/\s+/).includes(decorativeClass);
  const out = [];
  const seen = new Set();
  const add = (src, where) => {
    const k = `${where}|${src}`;
    if (!seen.has(k)) seen.add(k), out.push({ src, where });
  };
  const visit = (n, at) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'image' && !String(n.attrs?.alt ?? '').trim() && !decorative(n)) add(n.attrs?.src ?? '', at);
    const html = n.attrs?.html;
    if (typeof html === 'string') for (const src of imgsWithoutAlt(html)) add(src, at);
    (n.content ?? []).forEach((ch, i) => visit(ch, n.type === 'doc' ? `block ${i + 1}` : at));
  };
  if (doc) visit(doc, 'body');
  // the site's image settings (a cover): with no alt written, its altFallback key (e.g. the title) stands in, as the
  // site's build does; a cover with its own alt key and neither is missing
  const at = (o, k) => (k ? k.split('.').reduce((v, p) => (v && typeof v === 'object' ? v[p] : undefined), o) : undefined);
  const said = (v) => typeof v === 'string' && v.trim() !== '';
  const filled = new Set();
  for (const im of images) {
    const src = at(fields, im.key);
    if (!said(src)) continue;
    const where = im.key.replace(/\.src$/, '');
    if (said(at(fields, im.alt)) || (im.altFallback && said(at(fields, im.altFallback)))) filled.add(where);
    else if (im.alt) add(src, where);
  }
  for (const s of strings(fields)) {
    // an image object: {src: 'x.webp', alt: ''} (alt '' with decorative: true is fine)
    if (s.key === 'src' && IMAGE.test(s.value) && s.holder && !Array.isArray(s.holder) && !String(s.holder.alt ?? '').trim() && s.holder.decorative !== true && !filled.has(s.where.replace(/\.src$/, ''))) add(s.value, s.where.replace(/\.src$/, ''));
    if (/<img\b/i.test(s.value)) for (const src of imgsWithoutAlt(s.value)) add(src, s.where);
  }
  return out;
}

/** Internal link targets in an entry: link marks in the body, hrefs in HTML, and path-like values in its fields. */
export function internalLinks(doc, fields, siteUrl) {
  const out = new Map();
  const site = siteUrl ? siteUrl.replace(/\/+$/, '') : null;
  const add = (href, where) => {
    if (typeof href !== 'string') return;
    let h = href.trim();
    if (site && h.startsWith(site)) h = h.slice(site.length) || '/';
    if (!h.startsWith('/') || h.startsWith('//')) return;
    if (!out.has(h)) out.set(h, where);
  };
  const visit = (n, at) => {
    if (!n || typeof n !== 'object') return;
    for (const m of n.marks ?? []) if (m.type === 'link') add(m.attrs?.href, at);
    if (typeof n.attrs?.html === 'string') for (const m of n.attrs.html.matchAll(HREF)) add(m[2], at);
    (n.content ?? []).forEach((ch, i) => visit(ch, n.type === 'doc' ? `block ${i + 1}` : at));
  };
  if (doc) visit(doc, 'body');
  for (const s of strings(fields)) {
    if (/^(href|url|link|to)$/i.test(s.key ?? '') || (s.key && /canonical/i.test(s.key))) add(s.value, s.where);
    if (/href/i.test(s.value)) for (const m of s.value.matchAll(HREF)) add(m[2], s.where);
  }
  return [...out].map(([href, where]) => ({ href, where }));
}

const norm = (p) => {
  const bare = p.replace(/[#?].*$/, '');
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
};
/** A site path as the page lookups key it (no query, hash or trailing slash). */
export const pageKey = norm;

// findings kept per file version (the site check-up asks for every entry; a save changes one)
const KEEP_FINDINGS = 2000;
const YIELD_EVERY = 20;
const yieldNow = () => new Promise((r) => setImmediate(r));

export function preflightRoutes(router, app, entries, history) {
  const { store, config } = app;
  const pathsOf = (url) => app.site?.pathsOf?.(url) ?? (url ? [url] : []);

  /**
   * Every entry's address (in every locale) -> {collection, id, title, status, data}. From the content index, kept
   * by the content version (and the minute, since a scheduled entry's status follows the clock).
   */
  let known = null;
  function knownPages() {
    const key = `${store.rev()}:${Math.floor(app.clock() / 60_000)}`;
    if (known?.key === key) return known.map;
    const map = new Map();
    for (const c of store.collections) {
      for (const e of store.index(c).values()) {
        const s = store.summaryOf(c, e);
        for (const p of pathsOf(s.url)) map.set(norm(p), { collection: c.id, id: e.id, title: s.title, status: s.status ?? 'published', data: e.fields });
      }
    }
    known = { key, map };
    return map;
  }

  /** The parts of an entry's findings that depend on its text alone, once per version (an LRU of KEEP_FINDINGS). */
  const kept = new Map();
  /** how often the kept findings were used, and how often worked out (the check-up's test reads them) */
  const stats = { hits: 0, misses: 0 };
  function ownFindings(c, id, text) {
    const key = `${c.id}/${id}@${sha1(text)}`;
    const hit = kept.get(key);
    if (hit) return (stats.hits++, hit);
    stats.misses++;
    const parsed = entries.parse(c, text);
    const fields = c.format === 'md' ? store.fieldsOf(c, text) : parsed.data;
    const own = {
      parsed,
      fields,
      altText: missingAlt(parsed.doc, fields, config.decorativeClass, c.images),
      headings: c.format === 'md' ? headingIssues(parsed.doc) : [],
      internal: internalLinks(parsed.doc, fields, config.siteUrl),
    };
    if (kept.size >= KEEP_FINDINGS) kept.delete(kept.keys().next().value);
    kept.set(key, own);
    return own;
  }

  /** Work out the findings of every entry of a collection not kept yet, yielding to other requests between entries. */
  async function warm(c) {
    let n = 0;
    for (const e of [...store.index(c).values()]) {
      if (kept.has(`${c.id}/${e.id}@${e.version}`)) continue;
      try {
        ownFindings(c, e.id, store.read(c, e.id).text);
      } catch {
        // an entry that does not parse has no findings
      }
      if (++n % YIELD_EVERY === 0) await yieldNow();
    }
  }

  /** A page in the last build output (when the server knows where it is). */
  function built(p) {
    const dir = config.verify?.public;
    if (!dir || !fs.existsSync(dir)) return false;
    const rel = decodeURI(norm(p)).replace(/^\/+/, '');
    return [path.join(dir, rel, 'index.html'), path.join(dir, rel), path.join(dir, `${rel}.html`)].some((f) => isWithin(dir, f) && fs.existsSync(f) && fs.statSync(f).isFile());
  }

  /** What the publish rules look at, from an entry's text: images, links, duplicates, headings. */
  function findings(c, id, text, { known = knownPages(), duplicates = true } = {}) {
    const summary = store.summarize(c, id, text);
    const { parsed, fields, altText, headings, internal } = ownFindings(c, id, text);
    const self = new Set(pathsOf(summary.url).map(norm));
    // "no such page" is sure only when the server can look in the last build output
    const canLook = !!config.verify?.public && fs.existsSync(config.verify.public);
    const links = [];
    for (const l of internal) {
      const n = norm(l.href);
      if (self.has(n)) continue;
      const hit = known.get(n);
      if (hit && hit.status !== 'published') links.push({ ...l, problem: 'not-live', target: { collection: hit.collection, id: hit.id, title: hit.title, status: hit.status } });
      else if (!hit && !built(n) && !isMedia(n)) links.push({ ...l, problem: 'unknown', sure: canLook });
    }
    return {
      summary,
      parsed,
      fields,
      altText,
      links,
      // site-wide, the health screen groups duplicates once instead of per entry
      duplicates: duplicates ? duplicatesOf(store, c, id, fields ?? {}, summary.url ?? null) : { title: [], description: [] },
      headings,
      synced: drifted(c, text),
      // the checks of the page's type (page-types.mjs): null when the site has no page types or the page has none
      page: app.pageTypes?.enabled ? app.pageTypes.results(c, id, text, { parsed, fields, known }) : null,
    };
  }

  /** Copies of synced Library items changed on this page (never overwritten by the item): said, to keep or reset. */
  function drifted(c, text) {
    const synced = app.library?.synced;
    if (!synced) return [];
    return synced
      .usesIn(c, text)
      .filter((u) => u.state === 'changed')
      .map((u) => {
        const name = app.library.shared(u.id)?.name ?? u.id;
        const page = c.format === 'json';
        return {
          id: u.id,
          name,
          ...(u.path ? { path: u.path } : {}),
          canReset: page,
          message: `This copy of “${name}” was changed here, so it no longer follows the Library. ${page ? 'Keep it as its own copy (detach it) or reset it to the Library version.' : 'Keep it as its own copy (detach it), or make it like the Library version again.'}`,
        };
      });
  }

  /** The rules' verdicts for a text; links that may exist (no build output to look in) only warn. */
  function judge(f) {
    const sure = { ...f, links: f.links.filter((l) => l.problem !== 'unknown' || l.sure) };
    const out = verdicts(config.publishRules, sure);
    const unsure = f.links.length - sure.links.length;
    if (unsure && config.publishRules.links !== 'off') out.push({ rule: 'links', level: 'warn', count: unsure, message: `${unsure} link${unsure === 1 ? '' : 's'} to a page that may not exist` });
    const drift = f.synced?.length ?? 0;
    if (drift) out.push({ rule: 'synced', level: 'warn', count: drift, message: drift === 1 ? f.synced[0].message : `${drift} copies of synced Library items were changed here; keep each as its own copy or reset it to the Library version` });
    // each failed check of the page's type, at its own level (block stops a publish)
    for (const k of f.page?.checks ?? []) if (!k.ok) out.push({ rule: 'pageType', level: k.level, check: k.id, count: 1, message: k.message ?? `${f.page.type.label}: ${k.label}` });
    return out;
  }

  // the same findings for the site health screen and the exports (health.mjs)
  app.preflight = { findings, knownPages, pathsOf, warm, stats: () => ({ ...stats, kept: kept.size }) };

  /** The findings that stop a publish of this text: [] when it may go live (publish and schedule routes). */
  // and every finding of a text not yet written (an import's plan: what would stop or warn when it is published)
  app.publishRules = { blocking: (c, id, text) => judge(findings(c, id, text)).filter((v) => v.level === 'block'), verdicts: (c, id, text) => judge(findings(c, id, text)) };

  router.add('GET', '/collections/:c/entries/:id/preflight', async (ctx) => {
    const c = store.collection(ctx.params.c);
    const id = ctx.params.id;
    const cur = store.read(c, id);
    const f = findings(c, id, cur.text);

    let validate = null;
    if (config.validate) {
      try {
        await entries.validate(c, id, cur.text);
        validate = { ok: true, issues: [] };
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        validate = { ok: false, issues: e.extra?.issues ?? [{ severity: 'error', message: e.message }], unavailable: e.status === 503 };
      }
    }
    const rules = judge(f);
    return {
      version: cur.version,
      status: f.summary.status ?? 'published',
      validate,
      checks: await history.runChecks(c, id, cur.text),
      afterBuild: config.checks.filter((k) => k.after === 'build').map(({ id: cid, label, blocking }) => ({ id: cid, label, blocking })),
      verify: !!config.verify,
      altText: f.altText,
      links: f.links,
      duplicates: f.duplicates,
      headings: f.headings,
      synced: f.synced,
      // the page's type, frame and the type's checks (page-types.mjs), or null
      page: f.page,
      // its topic links (links/): how many pages could link to it, what it should link to; null without topics
      topicLinks: app.links?.enabled ? app.links.preflight(c, id) : null,
      // each rule's level (block, warn, off) and the verdicts with findings; blocked: publishing is refused
      publishRules: config.publishRules,
      rules,
      blocked: rules.some((r) => r.level === 'block'),
      addresses: addressesOf(f.summary),
      alsoLive: await alsoLive(store.rel(store.fileOf(c, id))),
    };
  });

  /** The entries that link to `url` (by the move's own link finder), except `skip` ({collection, id}). */
  function linksTo(url, skip = null) {
    if (!url) return [];
    const rw = linkRewriter(movePairs(url, '/\u0000/', { locales: config.locales, siteUrl: config.siteUrl }));
    const out = [];
    for (const cc of store.collections) {
      for (const eid of store.ids(cc)) {
        if (skip && cc.id === skip.collection && eid === skip.id) continue;
        try {
          const t = store.read(cc, eid).text;
          if (!rw.hit(t) || rewriteEntry(app.converter, cc, t, rw) === t) continue;
          const s = store.summarize(cc, eid, t);
          out.push({ collection: cc.id, id: eid, title: s.title || eid, status: s.status ?? 'published', url: s.url ?? null });
        } catch {
          // an entry that cannot be read or parsed is not counted
        }
      }
    }
    return out;
  }

  // the entries that link to this one: what breaks if it is deleted or unpublished
  router.add('GET', '/collections/:c/entries/:id/links-in', (ctx) => {
    const c = store.collection(ctx.params.c);
    const me = store.summarize(c, ctx.params.id, store.read(c, ctx.params.id).text);
    return { entries: linksTo(me.url, { collection: c.id, id: ctx.params.id }) };
  });

  // the same for an entry in the trash (before "Delete for good"): its old address, from the text kept there
  router.add('GET', '/trash/:tid/links-in', (ctx) => {
    const row = app.db.prepare('SELECT * FROM trash WHERE id = ?').get(ctx.params.tid);
    if (!row || !(atLeast(ctx.user, 'editor') || owns(ctx.user, row))) throw notFound('Not in the trash.');
    let url = null;
    try {
      url = store.summarize(store.collection(row.collection), row.entry_id, row.text).url ?? null;
    } catch {
      // a collection that is gone: no address to look for
    }
    return { url, entries: linksTo(url) };
  });

  // the page's addresses alone (the job screen's live card): cheap, no checks run
  router.add('GET', '/collections/:c/entries/:id/addresses', (ctx) => {
    const c = store.collection(ctx.params.c);
    const summary = store.summarize(c, ctx.params.id, store.read(c, ctx.params.id).text);
    return { title: summary.title, status: summary.status ?? 'published', addresses: addressesOf(summary) };
  });

  /** The page in every locale: [{locale, path, url}] (url null without the site's siteUrl). */
  function addressesOf(summary) {
    const site = config.siteUrl ? config.siteUrl.replace(/\/+$/, '') : null;
    const codes = config.locales?.list.map((l) => l.code) ?? [null];
    return pathsOf(summary.url).map((p, i) => ({ locale: codes[i] ?? null, path: p, url: site ? site + p : null }));
  }

  /**
   * What else a build puts live now: the other entries saved since the last deploy, newest first, with who saved
   * them last and when. Never deployed from here: the saves made through Markstage (its committer). `media` counts
   * the changed images, `files` the other changed files that are not entries (styles, config).
   */
  async function alsoLive(exceptRel) {
    const head = app.db.prepare('SELECT value FROM kv WHERE key = ?').get('deploy.head')?.value ?? null;
    const range = head ? [`${head}..HEAD`] : [`--committer=${config.git.committerEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`];
    const out = await app.git.git(['log', ...range, '--max-count=500', '--name-only', '--format=%x1e%an%x1f%aI'], { allowFail: true });
    const seen = new Map();
    const others = new Set();
    const skipped = new Set();
    for (const rec of out.ok ? out.stdout.split('\x1e').slice(1) : []) {
      const [who, ...files] = rec.split('\n');
      const [name, date] = who.split('\x1f');
      for (const rel of files.filter(Boolean)) {
        if (rel === exceptRel || seen.has(rel) || others.has(rel) || skipped.has(rel)) continue;
        const c = store.collections.find((x) => rel.startsWith(`${x.dir}/`) && rel.endsWith(x.ext) && !rel.slice(x.dir.length + 1).includes('/'));
        if (!c) {
          others.add(rel);
          continue;
        }
        const id = rel.slice(c.dir.length + 1, -c.ext.length);
        let title = id;
        let gone = false;
        try {
          const sm = store.summarize(c, id, store.read(c, id).text);
          // a draft's or a scheduled entry's saves do not go live with this build
          if ((sm.status ?? 'published') !== 'published') {
            skipped.add(rel);
            continue;
          }
          title = sm.title || id;
        } catch {
          gone = true;
        }
        seen.set(rel, { collection: c.id, id, title, by: name, at: date, deleted: gone });
      }
    }
    // net changes only: a file added and removed again since the deploy changes nothing live
    const live = [];
    for (const rel of others) {
      if (fs.existsSync(path.join(config.contentRoot, rel))) live.push(rel);
      else if (head && (await app.git.git(['cat-file', '-e', `${head}:${rel}`], { allowFail: true })).ok) live.push(rel);
    }
    const media = live.filter((r) => r.startsWith(`${config.media.dir}/`) && IMAGE.test(r)).length;
    return { deployed: !!head, entries: [...seen.values()], media, files: live.length - media };
  }

  /** A path under the media URL (the uploads folder): an image, not a page. */
  function isMedia(p) {
    const prefix = config.media.url.split('{path}')[0];
    return prefix.startsWith('/') && p.startsWith(prefix.replace(/\/+$/, ''));
  }
}
