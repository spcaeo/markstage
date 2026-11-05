// The site import's run (docs/IMPORT.md "The run"), as a job of four steps, each one or more commits by the person
// who runs it, so the history can be read batch by batch:
//   media      the pictures and PDFs, fetched through the SSRF guard (an answer must say it is a picture or a PDF),
//              then through the upload's pipeline (sniffed, never SVG, re-encoded): 50 to a commit;
//   authors    the authors the entries name that the site does not have yet: one commit;
//   entries    the plan made again with the media in place, each entry checked as a save is: new ones 25 to a
//              commit, a changed one (a second run, or a replaced address) one commit each;
//   redirects  every old address to its new one through the site's redirects hook, and the ?p= / ?page_id= /
//              ?attachment_id= map (plus the paths, when the site has no hook) in markstage/import/<source>.json.
// Everything is remembered by source id (import_map), so a second run updates or leaves alone, never duplicates.
import { safeFetch } from '../../library/fetch.mjs';
import { HttpError, nowIso, sha1 } from '../../util.mjs';
import { nameOfUrl } from '../../media/import.mjs';
import { makeSitePlan, productName } from './plan.mjs';

export const BATCH = Object.freeze({ media: 50, entries: 25 });
const ACCEPT = 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/heic,application/pdf;q=0.8';
const TYPE_OK = /^(image\/|application\/pdf$|application\/octet-stream$|binary\/octet-stream$)/;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** Where a run keeps its id map (and its paths when the site has no redirects hook). */
export const idsFileOf = (source) => `markstage/import/${source}.json`;

export function createSiteRun(app, entries, { mediaAt, remember }) {
  const { store, git, repoLock, config } = app;

  /** One picture through the guard: a Buffer, refused when the answer is not a picture or a PDF. */
  async function fetchMedia(url) {
    const r = await safeFetch(url, { maxBytes: config.media.maxBytes, timeoutMs: 15_000, accept: ACCEPT, outbound: app.outbound ?? {} });
    const host = new URL(r.url).host;
    if (r.status < 200 || r.status >= 300) throw new HttpError(502, 'fetch-failed', `${host} answered ${r.status}.`);
    if (r.type && !TYPE_OK.test(r.type)) throw new HttpError(415, 'unsupported-type', `${host} sent ${r.type}, not a picture or a PDF.`);
    return r.body;
  }

  /** The job's work for run `runId` of `stored` ({bundle, mapping}); returns the result to keep. */
  async function run(ctx, runId, stored, step) {
    const word = productName(stored.bundle.kind);
    const planOf = (opts = {}) => makeSitePlan(app, ctx, entries, stored, { mediaAt, ...opts });
    const result = { commits: [], media: [], authors: [], entries: [], redirects: null, review: [] };
    const fetchedNow = new Set();

    await step('media', async (log) => {
      const p = await planOf();
      const fetch = p.plan.media.filter((m) => m.action === 'fetch');
      const groups = chunks(fetch, BATCH.media);
      for (const [i, group] of groups.entries()) {
        const sources = group.map((m) => ({ label: m.sourceId, name: nameOfUrl(m.url), alt: m.alt, read: () => fetchMedia(m.url) }));
        const r = await app.mediaImport.storeAll(ctx, sources, { message: (n) => `Import ${plural(n, 'media file')} from ${word}${groups.length > 1 ? ` (batch ${i + 1} of ${groups.length})` : ''}`, source: p.source, log });
        if (r.commit) result.commits.push(r.commit);
        for (const m of group) {
          const row = r.byLabel.get(m.sourceId);
          if (!row) continue;
          remember(p.source, 'media', m.sourceId, { target: row.id, inputHash: sha1(m.url), written: row.path, runId });
          fetchedNow.add(m.sourceId);
        }
      }
      log(`\n${plural(fetch.length, 'media file')} to fetch, ${plural(p.plan.media.length - fetch.length, 'already here or left out', 'already here or left out')}.\n`);
      return 0;
    });

    await step('authors', async (log) => {
      const p = await planOf();
      const make = p.authors.filter((a) => a.action === 'create');
      if (make.length) {
        const bundleAuthor = new Map(stored.bundle.authors.map((a) => [a.sourceId, a]));
        const r = await app.authors.createMany(ctx, make.map((a) => ({ slug: a.slug, name: a.name, bio: bundleAuthor.get(a.sourceId)?.bio ?? null, website: bundleAuthor.get(a.sourceId)?.website ?? null })), `Import ${plural(make.length, 'author')} from ${word}`);
        if (r.commit) result.commits.push(r.commit);
        log(`${plural(r.created.length, 'author')} added: ${r.created.join(', ') || 'none'}.\n`);
      } else log('No new authors.\n');
      for (const a of p.authors) if (a.slug) remember(p.source, 'author', a.sourceId, { target: a.slug, inputHash: sha1(a.name ?? ''), written: null, runId });
      result.authors = p.authors;
      return 0;
    });

    let last;
    await step('entries', async (log) => {
      const p = (last = await planOf({ stored: true }));
      const byId = new Map(p.plan.entries.map((e) => [e.sourceId, e]));
      const creates = p.plan.entries.filter((e) => e.action === 'create' && e.text);
      const groups = chunks(creates, BATCH.entries);
      const done = new Map();
      for (const [i, group] of groups.entries()) {
        const kinds = [...new Set(group.map((e) => e.c.label.toLowerCase()))].join(' and ');
        const r = await entries.createMany(ctx, group.map((e) => ({ c: e.c, id: e.id, source: e.text })), { message: `Import ${group.length} ${kinds} from ${word}${groups.length > 1 ? ` (batch ${i + 1} of ${groups.length})` : ''}` });
        if (r.commit) result.commits.push(r.commit);
        for (const x of r.created) {
          const e = group.find((g) => g.c.id === x.c.id && g.id === x.id);
          remember(p.source, 'entry', e.sourceId, { collection: e.c.id, target: e.id, inputHash: e.inputHash, written: sha1(store.read(e.c, e.id).text), runId });
          done.set(e.sourceId, { action: 'create' });
          log(`${e.sourceId}: create ${e.c.id}/${e.id}\n`);
        }
        for (const pr of r.problems) {
          done.set(group[pr.index].sourceId, { action: 'skip', problem: pr.message });
          log(`${group[pr.index].sourceId}: ${pr.message}\n`);
        }
      }
      for (const planned of p.plan.entries.filter((x) => x.action === 'update' || x.action === 'unchanged')) {
        const e = { ...planned, c: planned.c ?? store.collections.find((x) => x.id === planned.collection) };
        try {
          if (e.action === 'update') {
            const current = store.read(e.c, e.id);
            const saved = await entries.saveEntry(ctx, e.c, e.id, { version: current.version, build: async () => ({ text: e.text }), message: `Import from ${word}: ${e.c.id}/${e.id}`, action: 'entry.import' });
            if (saved?.commit) result.commits.push(saved.commit);
          }
          if (e.action === 'update') remember(p.source, 'entry', e.sourceId, { collection: e.c.id, target: e.id, inputHash: e.inputHash, written: sha1(store.read(e.c, e.id).text), runId });
          done.set(e.sourceId, { action: e.action });
          log(`${e.sourceId}: ${e.action} ${e.c.id}/${e.id}\n`);
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
          done.set(e.sourceId, { action: 'skip', problem: err.message });
          log(`${e.sourceId}: ${err.message}\n`);
        }
      }
      result.entries = p.items.map((it) => {
        const d = done.get(it.sourceId);
        const planned = byId.get(it.sourceId);
        const action = d?.action ?? (it.problem ? 'skip' : planned?.action ?? 'skip');
        return { ...it, action, ...(d?.problem ? { problem: d.problem } : {}), ...(planned?.kept ? { kept: planned.kept.length } : {}) };
      });
      const n = (a) => result.entries.filter((x) => x.action === a).length;
      log(`\n${n('create')} created, ${n('update')} updated, ${n('unchanged')} unchanged, ${n('skip')} left out.\n`);
      return 0;
    });

    await step('redirects', async (log) => {
      const p = last;
      const rel = idsFileOf(p.source);
      const hook = Boolean(config.redirects);
      const paths = p.redirects;
      const out = await repoLock.run(async () => {
        const before = await git.dirty();
        let files = [];
        if (hook && paths.length) files = await app.redirectsHook.apply({ add: paths }, before, 'no redirect was added');
        const idsCount = Object.values(p.ids).reduce((n, m) => n + Object.keys(m).length, 0);
        if (idsCount || (!hook && paths.length)) {
          const doc = { source: p.source, from: word, site: stored.bundle.site.url || null, updatedAt: nowIso(app.clock()), ids: p.ids, ...(hook ? {} : { paths: Object.fromEntries(paths.map((r) => [r.from, r.to])) }) };
          const text = `${JSON.stringify(doc, null, 2)}\n`;
          const was = store.readRel(rel);
          if (was === null || JSON.stringify({ ...JSON.parse(was), updatedAt: null }) !== JSON.stringify({ ...doc, updatedAt: null })) {
            store.writeRel(rel, text);
            files.push(rel);
          }
        }
        const commit = files.length ? await git.commit(files, `Moved addresses for the ${word} import (${plural(paths.length, 'path')}, ${plural(idsCount, 'id link')})`, entries.authorOf(ctx.user)) : null;
        return { commit, idsCount };
      });
      if (out.commit) result.commits.push(out.commit);
      result.redirects = { paths: paths.length, ids: out.idsCount, hook, file: out.idsCount || (!hook && paths.length) ? rel : null, commit: out.commit };
      log(`${plural(paths.length, 'old path')} ${hook ? 'given to the site’s redirects hook' : `kept in ${rel} (this site has no redirects hook)`}, ${plural(out.idsCount, 'old id link')} in ${rel}.\n`);
      return 0;
    });

    // the review list with where to go: each entry's address in Markstage, each picture's id in the library
    const where = new Map(result.entries.map((e) => [e.sourceId, e]));
    const mediaRow = (sid) => {
      const m = app.db.prepare("SELECT target FROM import_map WHERE source = ? AND kind = 'media' AND source_id = ?").get(last.source, sid);
      return m ? app.db.prepare('SELECT id, path, alt FROM media WHERE id = ?').get(m.target) : null;
    };
    result.media = last.plan.media.map((m) => {
      const row = mediaRow(m.sourceId);
      return { sourceId: m.sourceId, url: m.url, action: row ? (fetchedNow.has(m.sourceId) ? 'fetch' : 'reuse') : 'skip', ...(row ? { id: row.id, path: row.path, alt: Boolean(row.alt?.trim()) } : { problem: m.problem ?? 'It could not be brought in; its pages keep its old address.' }) };
    });
    const mediaIdOf = new Map(result.media.filter((m) => m.id).map((m) => [m.sourceId, m.id]));
    const withAlt = new Set(result.media.filter((m) => m.alt).map((m) => m.sourceId));
    result.review = last.review
      .filter((r) => r.kind !== 'alt' || !withAlt.has(r.media))
      .map((r) => {
        const e = r.entry ? where.get(r.entry) : null;
        return { ...r, ...(e ? { entry: { sourceId: e.sourceId, collection: e.collection, id: e.action === 'skip' ? null : e.id, title: e.title } } : {}), ...(r.media ? { media: { sourceId: r.media, id: mediaIdOf.get(r.media) ?? null } } : {}) };
      });
    for (const m of result.media.filter((x) => x.problem)) result.review.push({ kind: 'media', text: `${m.url.split('/').pop()}: ${m.problem}`, media: { sourceId: m.sourceId, id: null } });
    const count = (list, key) => list.reduce((o, x) => ((o[x[key]] = (o[x[key]] ?? 0) + 1), o), {});
    // what the plan left out before any item was made (a kind with no collection chosen, menus and the like) is in
    // the report too, so it accounts for everything the plan did
    result.counts = { entries: count(result.entries, 'action'), media: count(result.media, 'action'), authors: count(result.authors, 'action'), review: count(result.review, 'kind'), redirects: result.redirects?.paths ?? 0, ids: result.redirects?.ids ?? 0, commits: result.commits.length, left: { ...(last.counts.left ?? {}) }, other: { ...(last.counts.other ?? {}) } };
    return result;
  }

  return { run };
}
