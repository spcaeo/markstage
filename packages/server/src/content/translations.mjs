// Translation status (docs/API.md "Translation status"): for every entry and every locale that takes its own title or
// description (`overrides` in markstage.config), whether that locale's words are missing, outdated or done.
//
// - The source of a field is the entry's search text (publish-rules.mjs searchText: the seo key, else the title or
//   the excerpt); its translation is <overridesKey>.<code>.<field> in the same file.
// - missing: the translation is empty while the source is not. In a locale of the default locale's language (en-US
//   beside en-CA) an empty field means "the same as the source", so it is done: only another language needs words.
// - outdated: the source changed in a later commit than the one that last changed the translation (the same commit:
//   done). The working copy, when it differs from HEAD, is the newest change.
// - An entry's status in a locale is its worst field's: missing, then outdated, then done.
//
// From git, in few processes: one `git log --raw` of the collections' folders gives every change to every file with
// its blob ids; `git cat-file --batch` reads the blobs, a round per step back in history, only for the fields not yet
// decided. Both are cached by HEAD and the working copy's version.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { searchText } from '../publish-rules.mjs';
import { entryCan } from '../roles.mjs';
import { HttpError, notFound, sha1 } from '../util.mjs';

export const STATUSES = ['missing', 'outdated', 'done'];
const FIELDS = ['title', 'description'];
const MAX_DEPTH = 200;
const rank = (s) => STATUSES.indexOf(s);
const lang = (code) => String(code).split('-')[0].toLowerCase();
const get = (o, key) => key.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const wrong = (field, words) => new HttpError(422, 'invalid', words, { field });
const pub = ({ code, label, sameLanguage }) => ({ code, label, sameLanguage });
/** A whole number query value within its bounds, else 422 naming it. */
function intOf(q, key, def, max) {
  const raw = q.get(key);
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) throw wrong(key, `${key} must be a whole number from 1 to ${max}.`);
  return n;
}

/** The locales tracked here: not the default, and taking their own title or description. */
export function trackedLocales(locales) {
  if (!locales?.list?.length) return [];
  const source = locales.list.find((l) => l.default) ?? locales.list[0];
  return locales.list
    .filter((l) => l !== source && l.overrides.some((f) => FIELDS.includes(f)))
    .map((l) => ({ code: l.code, label: l.label, fields: FIELDS.filter((f) => l.overrides.includes(f)), sameLanguage: lang(l.code) === lang(source.code) }));
}

export function createTranslations(app) {
  const { store } = app;
  const root = app.config.contentRoot;
  let logCache = { key: null, byFile: null };
  const results = new Map();

  const run = (args, input) =>
    new Promise((resolve, reject) => {
      const child = execFile('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
      child.stdin.on('error', () => {});
      child.stdin.end(input ?? '');
    });

  /** Every change to each file under the collections' folders, newest first: rel -> [{sha, at, from, to}]. */
  async function changes() {
    const head = await app.git.head();
    if (logCache.key === head && logCache.byFile) return logCache.byFile;
    const byFile = new Map();
    const dirs = app.config.collections.map((c) => path.relative(root, c.absDir).split(path.sep).join('/')).filter(Boolean);
    if (head && dirs.length) {
      const out = (await run(['log', '--relative', '--no-renames', '--raw', '--no-abbrev', '--format=%x1e%H%x1f%cI', '--', ...dirs])).toString('utf8');
      for (const block of out.split('\x1e').filter(Boolean)) {
        const [first, ...lines] = block.split('\n');
        const [sha, when] = first.split('\x1f');
        const at = new Date(when).toISOString();
        for (const line of lines) {
          const m = /^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) [A-Z]\d*\t(.+)$/.exec(line);
          if (!m) continue;
          const zero = /^0+$/;
          if (!byFile.has(m[3])) byFile.set(m[3], []);
          byFile.get(m[3]).push({ sha, at, from: zero.test(m[1]) ? null : m[1], to: zero.test(m[2]) ? null : m[2] });
        }
      }
    }
    logCache = { key: head, byFile };
    return byFile;
  }

  /** Blobs' texts by id, in one `git cat-file --batch`. */
  async function blobs(ids) {
    const want = [...new Set(ids.filter(Boolean))];
    const out = new Map();
    if (!want.length) return out;
    const buf = await run(['cat-file', '--batch'], `${want.join('\n')}\n`);
    let i = 0;
    while (i < buf.length) {
      const nl = buf.indexOf(10, i);
      const [id, type, size] = buf.subarray(i, nl).toString('utf8').split(' ');
      if (type === 'missing' || size === undefined) {
        i = nl + 1;
        continue;
      }
      const n = Number(size);
      out.set(id, buf.subarray(nl + 1, nl + 1 + n).toString('utf8'));
      i = nl + 1 + n + 1;
    }
    return out;
  }

  /** The source and translated values of each tracked field in one version of a file (null: no file). */
  const valuesOf = (c, text, tracked, key) => {
    if (text === null) return null;
    const fields = store.fieldsOf(c, text);
    const src = searchText(c, fields);
    const v = {};
    for (const l of tracked) for (const f of l.fields) v[`${l.code}\u0000${f}`] = { source: str(src[f]), value: str(get(fields, `${key}.${l.code}.${f}`)) };
    return v;
  };

  /**
   * For each file, when each tracked field's source and translation last changed: {<code>\0<field>: {source, value,
   * sourceAt, sourceStep, valueAt, valueStep}}; a step is how far back the change is (0: the newest).
   */
  async function history(files, tracked) {
    const key = app.config.locales.overridesKey;
    const log = await changes();
    const out = new Map();
    const todo = [];
    for (const f of files) {
      const list = log.get(f.rel) ?? [];
      const working = f.text;
      const headBlob = list[0]?.to ?? null;
      const cacheKey = `${f.rel}\u0000${list[0]?.sha ?? ''}\u0000${sha1(working)}`;
      if (results.has(cacheKey)) {
        out.set(f.rel, results.get(cacheKey));
        continue;
      }
      const now = valuesOf(f.c, working, tracked, key);
      const state = {};
      for (const [k, v] of Object.entries(now)) state[k] = { ...v, sourceAt: null, sourceStep: null, valueAt: null, valueStep: null };
      // the working copy first (when it is not HEAD's text), then each commit's change, newest first
      const steps = [{ at: null, newer: { text: working }, older: headBlob }, ...list.map((ch) => ({ at: ch.at, newer: { blob: ch.to }, older: ch.from }))];
      todo.push({ f, steps, step: 0, state, cacheKey, newerValues: now });
    }
    const open = (t) => Object.values(t.state).some((s) => s.sourceStep === null || s.valueStep === null);
    let round = todo.filter(open);
    for (let depth = 0; round.length && depth < MAX_DEPTH; depth++) {
      const texts = await blobs(round.map((t) => t.steps[t.step].older));
      for (const t of round) {
        const s = t.steps[t.step];
        const older = s.older ? valuesOf(t.f.c, texts.get(s.older) ?? null, tracked, key) : null;
        // the working copy equal to HEAD is no change
        const same = t.step === 0 && s.older && texts.get(s.older) === t.f.text;
        if (!same) {
          for (const [k, st] of Object.entries(t.state)) {
            const was = older?.[k] ?? { source: '', value: '' };
            const at = s.at ?? new Date(app.clock()).toISOString();
            if (st.sourceStep === null && was.source !== t.newerValues[k].source) Object.assign(st, { sourceAt: at, sourceStep: t.step });
            if (st.valueStep === null && was.value !== t.newerValues[k].value) Object.assign(st, { valueAt: at, valueStep: t.step });
          }
        }
        if (older) t.newerValues = older;
        t.step++;
        // the file's first version: whatever is still open was there from the start
        if (!s.older || t.step >= t.steps.length) {
          for (const st of Object.values(t.state)) {
            if (st.sourceStep === null) Object.assign(st, { sourceAt: s.at, sourceStep: Infinity });
            if (st.valueStep === null) Object.assign(st, { valueAt: s.at, valueStep: Infinity });
          }
        }
      }
      round = round.filter(open);
    }
    for (const t of todo) {
      results.set(t.cacheKey, t.state);
      out.set(t.f.rel, t.state);
    }
    if (results.size > 20_000) results.clear();
    return out;
  }

  /** May this person save a translation into the entry (the entry save's own rule: a live one needs publish)? */
  const canEdit = (ctx, c, summary) => {
    const can = entryCan(ctx.user, c, summary);
    return Boolean(can.edit && (!c.hasStatus || summary.status === 'draft' || can.publish));
  };

  /** One entry's status in one locale, from its fields' history. */
  function statusOf(l, state) {
    const fields = {};
    let worst = 'done';
    let sourceChangedAt = null;
    let translatedAt = null;
    for (const f of l.fields) {
      const s = state[`${l.code}\u0000${f}`];
      if (!s.source && !s.value) continue;
      let status = 'done';
      if (!s.value) status = l.sameLanguage ? 'done' : 'missing';
      else if (s.source && s.sourceStep < s.valueStep) status = 'outdated';
      fields[f] = { status, source: s.source, value: s.value, sourceChangedAt: s.sourceAt, translatedAt: s.value ? s.valueAt : null };
      if (rank(status) < rank(worst)) worst = status;
      if (s.sourceAt && (!sourceChangedAt || s.sourceAt > sourceChangedAt)) sourceChangedAt = s.sourceAt;
      if (s.value && s.valueAt && (!translatedAt || s.valueAt > translatedAt)) translatedAt = s.valueAt;
    }
    return { status: worst, fields, sourceChangedAt, translatedAt };
  }

  /** Every entry of these collections, with its text, and its summary. */
  function filesOf(collections) {
    const out = [];
    for (const c of collections) {
      for (const id of store.ids(c)) {
        const abs = path.join(c.absDir, id + c.ext);
        let text;
        try {
          text = fs.readFileSync(abs, 'utf8');
        } catch {
          continue;
        }
        out.push({ c, id, text, rel: path.relative(root, abs).split(path.sep).join('/'), summary: store.summarize(c, id, text) });
      }
    }
    return out;
  }

  /** GET translations: one row per entry and tracked locale, filtered, sorted and paged. */
  async function list(ctx) {
    const q = ctx.query;
    const tracked = trackedLocales(app.config.locales);
    const page = intOf(q, 'page', 1, 100_000);
    const perPage = intOf(q, 'perPage', 50, 200);
    const want = q.get('locale') || null;
    if (want && !tracked.some((l) => l.code === want)) throw wrong('locale', tracked.length ? `"${want}" is not a locale with its own words here (${tracked.map((l) => l.code).join(', ')}).` : 'This site has no locale with its own words.');
    const status = q.get('status') || 'needs';
    if (![...STATUSES, 'needs', 'all'].includes(status)) throw wrong('status', 'status is one of needs, missing, outdated, done, all.');
    const sort = q.get('sort') || 'changed';
    if (!['changed', 'title'].includes(sort)) throw wrong('sort', 'sort is changed or title.');
    const cid = q.get('collection') || null;
    const collections = app.config.collections.filter((c) => !cid || c.id === cid);
    if (cid && !collections.length) throw wrong('collection', `No collection "${cid}".`);
    const empty = { locales: tracked.map(pub), counts: {}, items: [], total: 0, page, perPage };
    if (!tracked.length) return empty;
    const files = filesOf(collections);
    const hist = await history(files, tracked);
    const text = (q.get('q') || '').trim().toLowerCase();
    const counts = Object.fromEntries(tracked.map((l) => [l.code, { missing: 0, outdated: 0, done: 0 }]));
    const rows = [];
    for (const f of files) {
      if (text && !f.summary.title.toLowerCase().includes(text) && !f.id.includes(text)) continue;
      for (const l of tracked) {
        if (want && l.code !== want) continue;
        const s = statusOf(l, hist.get(f.rel));
        if (!Object.keys(s.fields).length) continue;
        counts[l.code][s.status]++;
        if (status === 'needs' ? s.status === 'done' : status !== 'all' && s.status !== status) continue;
        rows.push({ collection: f.c.id, id: f.id, title: f.summary.title, url: f.summary.url ?? null, entryStatus: f.summary.status, locale: l.code, ...s, can: { edit: canEdit(ctx, f.c, f.summary) } });
      }
    }
    rows.sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : String(b.sourceChangedAt ?? '').localeCompare(String(a.sourceChangedAt ?? ''))) || a.id.localeCompare(b.id) || a.locale.localeCompare(b.locale));
    return { ...empty, counts, items: rows.slice((page - 1) * perPage, page * perPage), total: rows.length };
  }

  /** GET collections/:c/entries/:id/translations: the entry in every tracked locale. */
  async function ofEntry(ctx, cid, id) {
    const c = app.config.collections.find((x) => x.id === cid);
    if (!c) throw notFound('No such collection.');
    const file = store.read(c, id);
    const tracked = trackedLocales(app.config.locales);
    const can = { edit: canEdit(ctx, c, store.summarize(c, id, file.text)) };
    if (!tracked.length) return { locales: [], can };
    const f = { c, id, text: file.text, rel: file.rel };
    const state = (await history([f], tracked)).get(f.rel);
    return { locales: tracked.map((l) => ({ ...pub(l), ...statusOf(l, state) })), can };
  }

  function routes(api) {
    api.add('GET', '/translations', list);
    api.add('GET', '/collections/:c/entries/:id/translations', (ctx) => ofEntry(ctx, ctx.params.c, ctx.params.id));
  }

  return { routes, list, ofEntry };
}
