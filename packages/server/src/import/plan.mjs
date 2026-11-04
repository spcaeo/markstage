// The import's plan (docs/API-IMPORT.md "The plan"): what each entry and media file of a payload would do, checked the
// way a save checks it (the guard: rights, links, raw HTML, locks, synced copies, the page's address; the site's own
// validate), with the publish rules' findings to show, and nothing written. The run (index.mjs) makes the plan again
// at its time and carries out what it says, so a plan is never stale and a run never does what its plan did not.
import path from 'node:path';
import { HttpError, datedId, sha1, slugify } from '../util.mjs';
import { canCreate, canRawHtml, entryCan } from '../roles.mjs';
import { checkUrl } from '../library/fetch.mjs';
import { nameOfUrl } from '../media/import.mjs';

export const LIMITS = Object.freeze({ entries: 500, media: 200, sourceId: 200, body: 1024 * 1024 });
const STATUS_KEYS = ['draft', 'publishAt', 'protected'];
const SOURCE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const TOKEN = /media:([A-Za-z0-9._~:/-]{1,200})/g;

const bad = (words, extra) => new HttpError(422, 'invalid', words, extra);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** The payload's shape, before anything else: {source, entries, media, overwrite, mediaAs}; else 422 naming where. */
export function checkPayload(body) {
  if (!isObj(body)) throw bad('Send {source, entries, media?}.');
  const { source, entries = [], media = [], overwrite = false, mediaAs = 'url' } = body;
  if (typeof source !== 'string' || !SOURCE.test(source)) throw bad('source names where it comes from: lowercase letters, digits and hyphens ("wordpress").', { field: 'source' });
  if (!Array.isArray(entries) || entries.length > LIMITS.entries) throw bad(`entries is a list of at most ${LIMITS.entries}. Split a larger import into several.`, { field: 'entries' });
  if (!Array.isArray(media) || media.length > LIMITS.media) throw bad(`media is a list of at most ${LIMITS.media}. Split a larger import into several.`, { field: 'media' });
  if (!entries.length && !media.length) throw bad('There is nothing to import.', { field: 'entries' });
  if (typeof overwrite !== 'boolean') throw bad('overwrite is true or false.', { field: 'overwrite' });
  if (!['url', 'relative'].includes(mediaAs)) throw bad('mediaAs is "url" or "relative".', { field: 'mediaAs' });
  const seen = { entry: new Set(), media: new Set() };
  const sid = (v, kind, i) => {
    const where = `${kind === 'entry' ? 'entries' : 'media'}[${i}].sourceId`;
    if (typeof v !== 'string' || !v.trim() || v.length > LIMITS.sourceId) throw bad(`${where} is the item's id in the source (text, at most ${LIMITS.sourceId} characters).`, { field: where });
    if (seen[kind].has(v)) throw bad(`${where} "${v}" is listed twice.`, { field: where });
    seen[kind].add(v);
  };
  entries.forEach((e, i) => {
    if (!isObj(e)) throw bad(`entries[${i}] must be an object.`, { field: `entries[${i}]` });
    sid(e.sourceId, 'entry', i);
    if (typeof e.collection !== 'string') throw bad(`entries[${i}].collection is needed.`, { field: `entries[${i}].collection` });
    for (const k of ['frontmatter', 'data']) if (e[k] !== undefined && !isObj(e[k])) throw bad(`entries[${i}].${k} must be an object.`, { field: `entries[${i}].${k}` });
    for (const k of ['title', 'body', 'id']) if (e[k] !== undefined && typeof e[k] !== 'string') throw bad(`entries[${i}].${k} must be text.`, { field: `entries[${i}].${k}` });
    if ((e.body ?? '').length > LIMITS.body) throw bad(`entries[${i}].body is over 1 MB.`, { field: `entries[${i}].body` });
  });
  media.forEach((m, i) => {
    if (!isObj(m)) throw bad(`media[${i}] must be an object.`, { field: `media[${i}]` });
    sid(m.sourceId, 'media', i);
    if (typeof m.url !== 'string' || m.url.length > 2000) throw bad(`media[${i}].url is the file's address.`, { field: `media[${i}].url` });
    if (m.alt !== undefined && (typeof m.alt !== 'string' || m.alt.length > 1000)) throw bad(`media[${i}].alt is text, at most 1,000 characters.`, { field: `media[${i}].alt` });
  });
  return { source, entries, media, overwrite, mediaAs };
}

/** Every string inside `v` with the media's addresses and media:<sourceId> tokens put to their place on the site. */
function swapMedia(v, swap, depth = 0) {
  if (typeof v === 'string') return swap(v);
  if (depth > 40 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => swapMedia(x, swap, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapMedia(x, swap, depth + 1)]));
}

/**
 * The plan: {entries: [{sourceId, collection, id, action, problem?, rules?}], media: [{sourceId, url, action, path?,
 * problem?}], counts}, and for the run each entry's text and each media's source. `mediaAt(m)`: where a media file
 * would be on the site: {path} (repo-relative). `stored`: the media were fetched already (the run's entries step).
 * action: entries create | update | unchanged | skip (with why); media fetch | reuse | skip.
 */
export async function makePlan(app, ctx, entries, payload, { mediaAt, stored = false }) {
  const { store, db, converter } = app;
  const { source, overwrite, mediaAs } = payload;
  const map = (kind, sid) => db.prepare('SELECT * FROM import_map WHERE source = ? AND kind = ? AND source_id = ?').get(source, kind, sid);

  // media first: an entry's text names where each file is
  const media = [];
  const placeOf = new Map();
  for (const m of payload.media) {
    const row = map('media', m.sourceId);
    const kept = row && db.prepare('SELECT id, path FROM media WHERE id = ?').get(row.target);
    if (kept && row.input_hash === sha1(m.url)) {
      media.push({ sourceId: m.sourceId, url: m.url, action: 'reuse', path: kept.path });
      placeOf.set(m.sourceId, { path: kept.path, url: m.url });
      continue;
    }
    try {
      checkUrl(m.url, app.outbound ?? {});
    } catch (e) {
      media.push({ sourceId: m.sourceId, url: m.url, action: 'skip', problem: e.message });
      continue;
    }
    // the run's second look: a file that should be there by now and is not could not be brought in
    if (stored) {
      media.push({ sourceId: m.sourceId, url: m.url, action: 'skip', problem: 'It could not be brought in.' });
      continue;
    }
    const at = mediaAt(m);
    media.push({ sourceId: m.sourceId, url: m.url, action: 'fetch', path: at.path, name: nameOfUrl(m.url), alt: m.alt ?? '' });
    placeOf.set(m.sourceId, { path: at.path, url: m.url });
  }

  const claimed = new Set();
  const out = [];
  for (const e of payload.entries) {
    const item = { sourceId: e.sourceId, collection: e.collection, id: null, action: 'skip' };
    try {
      Object.assign(item, await planEntry(e));
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      item.problem = err.message;
      item.action = 'skip';
    }
    out.push(item);
  }

  async function planEntry(e) {
    const c = store.collections.find((x) => x.id === e.collection);
    if (!c) throw bad(`No collection "${e.collection}".`);
    const f = c.fields;
    const fm = { ...(c.format === 'json' ? e.data ?? {} : e.frontmatter ?? {}) };
    if (STATUS_KEYS.some((k) => k in fm)) throw bad(`${STATUS_KEYS.filter((k) => k in fm).join(', ')}: an import brings drafts; publishing is a person's step.`);
    if (e.title !== undefined) fm[f.title] = e.title;
    const title = fm[f.title];
    if (typeof title !== 'string' || !title.trim()) throw bad('It needs a title.');
    const inputHash = sha1(JSON.stringify([c.id, e.id ?? null, fm, e.body ?? '', mediaAs]));
    const was = map('entry', e.sourceId);
    let id;
    let current = null;
    if (was) {
      id = was.target;
      try {
        current = store.read(c, id);
      } catch {
        current = null;
      }
      if (!current && !overwrite) throw bad(`It was imported as ${c.id}/${id}, which is no longer there (deleted in Markstage). Send overwrite: true to create it again.`);
      if (current && sha1(current.text) !== was.written && !overwrite) throw bad(`${c.id}/${id} changed in Markstage since it was imported. Send overwrite: true to replace it with the source.`);
      if (current && was.input_hash === inputHash) return { id, action: 'unchanged' };
    }
    if (!current) {
      if (!canCreate(ctx.user, c)) throw new HttpError(403, 'forbidden', 'Your role cannot create entries here.');
      if (e.id !== undefined && !ID.test(e.id)) throw bad('id: lowercase letters, digits and hyphens.');
      id = id ?? e.id ?? freeId(c, slugify((f.slug && fm[f.slug]) || title));
      if (store.exists(c, id) || claimed.has(`${c.id}/${id}`)) throw new HttpError(409, 'id-taken', `Another entry already has the address ${c.id}/${id}.`);
    }
    claimed.add(`${c.id}/${id}`);
    // where the entry's file is (for media paths relative to it), then its words with the media in place
    const fileRel = path.relative(app.config.contentRoot, path.join(c.absDir, `${id}${c.ext}`)).split(path.sep).join('/');
    const missing = new Set();
    const swap = (s) =>
      s
        .replace(TOKEN, (all, sid) => {
          const p = placeOf.get(sid);
          if (!p) return missing.add(sid), all;
          return mediaAs === 'relative' ? path.posix.relative(path.posix.dirname(fileRel), p.path) : app.mediaPrepare.urlOf(p.path);
        });
    let fields = swapMedia(fm, swap);
    let body = swap(e.body ?? '');
    for (const [, p] of placeOf) {
      const to = mediaAs === 'relative' ? null : app.mediaPrepare.urlOf(p.path);
      const rep = (s) => s.split(p.url).join(to ?? path.posix.relative(path.posix.dirname(fileRel), p.path));
      fields = swapMedia(fields, rep);
      body = rep(body);
    }
    if (missing.size) throw bad(`It names media this import does not bring in: ${[...missing].slice(0, 5).map((s) => `media:${s}`).join(', ')}.`);
    let text;
    if (c.format === 'json') {
      text = `${JSON.stringify(fields, null, 2)}\n`;
    } else {
      text = converter.setFrontmatter('---\n---\n', fields);
      text = `${text}\n${body.replace(/^\n+/, '')}${body.endsWith('\n') ? '' : '\n'}`;
    }
    let after = text;
    if (current) {
      // an update keeps the entry's status (publishing stays a person's step) and its address
      const now = store.fieldsOf(c, current.text);
      const keep = Object.fromEntries(STATUS_KEYS.map((k) => [k, now[k] ?? null]));
      if (c.format === 'json') {
        const d = JSON.parse(text);
        for (const [k, v] of Object.entries(keep)) if (v === null) delete d[k];
        else d[k] = v;
        after = `${JSON.stringify(d, null, 2)}\n`;
      } else {
        after = converter.setFrontmatter(text, keep);
      }
      const summary = store.summarize(c, id, current.text);
      const can = entryCan(ctx.user, c, summary);
      if (!can.edit || (c.hasStatus && summary.status !== 'draft' && !can.publish)) throw new HttpError(403, 'forbidden', 'Your role cannot change this entry.');
      if (after === current.text) return { id, action: 'unchanged', text: after, inputHash, c };
      entries.guard(ctx, c, current.text, after, can, { id });
    } else {
      entries.guard(ctx, c, null, after, { rawHtml: canRawHtml(ctx.user) }, { allowStatus: true });
    }
    await entries.validate(c, id, after);
    const rules = (app.publishRules?.verdicts?.(c, id, after) ?? []).map(({ rule, level, message }) => ({ rule, level, message }));
    return { id, action: current ? 'update' : 'create', text: after, inputHash, c, ...(rules.length ? { rules } : {}) };
  }

  function freeId(c, base) {
    const root = base.slice(0, 96).replace(/-+$/, '') || datedId(c, app.clock());
    let id = root;
    for (let n = 2; store.exists(c, id) || claimed.has(`${c.id}/${id}`); n++) id = `${root.slice(0, 92).replace(/-+$/, '')}-${n}`;
    return id;
  }

  const counts = {};
  for (const i of out) counts[i.action] = (counts[i.action] ?? 0) + 1;
  const mcounts = {};
  for (const m of media) mcounts[m.action] = (mcounts[m.action] ?? 0) + 1;
  return { entries: out, media, counts: { entries: counts, media: mcounts } };
}

/** The plan as the API shows it: no texts, no internals. */
export function planView(plan) {
  return {
    entries: plan.entries.map(({ sourceId, collection, id, action, problem, rules }) => ({ sourceId, collection, id, action, ...(problem ? { problem } : {}), ...(rules ? { rules } : {}) })),
    media: plan.media.map(({ sourceId, url, action, path: p, problem }) => ({ sourceId, url, action, ...(p ? { path: p } : {}), ...(problem ? { problem } : {}) })),
    counts: plan.counts,
  };
}
