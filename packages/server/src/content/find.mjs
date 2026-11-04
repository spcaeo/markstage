// Find and replace across the whole site (docs/OPERATIONS.md "Writing and finding"): search every entry for a piece
// of text, see every place it would change, then replace it in the chosen entries in one commit. Plain text only (no
// patterns, so a search can never hang the server); match case and whole words are options. In a JSON entry the
// text is matched and written as JSON writes it, so quotes and backslashes stay valid. Each match is sorted by where
// it sits (find-places.mjs): plain text is replaced; one inside a link address, an image file name, an HTML tag,
// code or a field's name only when that group is asked for, so a replace never changes an address by accident.
// Every change is checked like a save of that entry; one that fails is left out and says why. Editors and above,
// since it changes other people's entries.
// A plain-text match also comes as it reads (`read`: no markup, links as chips; find-read.mjs). "Keep the case of each
// match" (`keep`, when the case is not matched) writes the new text in the case of each match it replaces.
//   GET  /site/find?q=&with=&case=1&whole=1&keep=1&collection=   matches per entry, by group, with the field and the
//                                                          words around each; with `with`, each match's new text (to)
//                                                          and whether each entry may be changed (problem; problems
//                                                          per other group)
//   POST /site/replace {q, with, case, whole, keep, entries: [{collection, id, version, kinds?}]}
//                                                          {commit, changed, skipped, job}
import { atLeast } from '../roles.mjs';
import { badRequest, forbidden, sha1 } from '../util.mjs';
import { DEFAULT_KINDS, KINDS, placesOf } from './find-places.mjs';
import { keepCase, readable } from './find-read.mjs';

const MAX_Q = 200;
const MAX_WITH = 2000;
const MAX_ENTRIES = 500;
const MAX_SAMPLES = 50;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The search as a pattern: the text as it is written in this format, optionally case-blind and whole words only. */
export function finder(q, { matchCase = false, whole = false, json = false } = {}) {
  const needle = esc(json ? JSON.stringify(q).slice(1, -1) : q);
  const body = whole ? `(?<![\\p{L}\\p{N}_])${needle}(?![\\p{L}\\p{N}_])` : needle;
  return new RegExp(body, `gu${matchCase ? '' : 'i'}`);
}

/** A match as the words read (a JSON value's match is still escaped). */
const plainOf = (m, json) => {
  if (!json) return m;
  try {
    return JSON.parse(`"${m}"`);
  } catch {
    return m;
  }
};

/** The new text for one match, written as this format writes it: as typed, or in the case of the match. */
export const newTextOf = (o, json) => (m) => {
  const w = o.keep ? keepCase(plainOf(m, json), o.with) : o.with;
  return json ? JSON.stringify(w).slice(1, -1) : w;
};

/**
 * Each match: [{line, where, kind, field, before, match, after, read?, to?}] (at most `max`), and how many matches of
 * each kind there are in all. `kind` is one of KINDS; `field` names where it is; before and after are about eight
 * words; `read` is a plain-text match's context as it reads; `to` its new text (given `to`, a newTextOf).
 */
export function samplesOf(text, re, { format = 'md', max = MAX_SAMPLES, to } = {}) {
  const fmEnd = format === 'md' ? (/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0].length ?? 0) : text.length;
  const places = placesOf(text, { format });
  const out = [];
  const kinds = {};
  for (const m of text.matchAll(re)) {
    const kind = places.kindAt(m.index, m.index + m[0].length);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (out.length >= max) continue;
    const around = places.contextAt(m.index, m.index + m[0].length);
    const read = kind === 'text' ? readable(around.before, m[0], around.after, { json: format === 'json' }) : null;
    const new_ = to ? to(m[0]) : undefined;
    out.push({
      line: text.slice(0, m.index).split('\n').length,
      where: m.index < fmEnd ? 'fields' : 'text',
      kind,
      field: places.fieldAt(m.index),
      ...around,
      match: m[0],
      ...(read ? { read } : {}),
      ...(new_ === undefined ? {} : { to: format === 'json' ? plainOf(new_, true) : new_ }),
    });
  }
  return { samples: out, kinds };
}

/** The asked groups: a list of KINDS (unknown ones refused); none given is plain text only. */
export function kindsOf(v) {
  if (v === undefined || v === null) return new Set(DEFAULT_KINDS);
  if (!Array.isArray(v) || !v.length || v.some((k) => !KINDS.includes(k))) throw badRequest(`kinds must be a list of ${KINDS.join(', ')}.`);
  return new Set(v);
}

export function findRoutes(router, app, many) {
  const { store, repoLock, audit } = app;

  function optionsOf(src) {
    const get = (k) => (src instanceof URLSearchParams ? src.get(k) : src?.[k]);
    const q = get('q');
    if (typeof q !== 'string' || !q.trim()) throw badRequest('Type what to find.');
    if (q.length > MAX_Q) throw badRequest(`Find at most ${MAX_Q} characters at a time.`);
    const has = src instanceof URLSearchParams ? src.has('with') : typeof src?.with === 'string';
    const w = has ? String(get('with')) : null;
    if (w !== null && w.length > MAX_WITH) throw badRequest(`The new text can be at most ${MAX_WITH} characters.`);
    const flag = (k) => ['1', 'true', true].includes(get(k));
    const matchCase = flag('case');
    // the case of each match is kept only when the search ignores case (with it matched, every match is as typed)
    return { q, with: w, matchCase, whole: flag('whole'), keep: !matchCase && flag('keep') };
  }

  /**
   * The text after the replace, written as this format writes it (a function, so `$&` in the new text is literal),
   * only in the asked groups (kinds): {after, count}.
   */
  function replaced(c, text, o, kinds = new Set(DEFAULT_KINDS)) {
    const re = finder(o.q, { ...o, json: c.format === 'json' });
    const w = newTextOf(o, c.format === 'json');
    const places = placesOf(text, { format: c.format });
    let count = 0;
    const after = text.replace(re, (m, at) => (kinds.has(places.kindAt(at, at + m.length)) ? (count++, w(m)) : m));
    return { after, count };
  }

  const needEditor = (ctx) => {
    if (!atLeast(ctx.user, 'editor')) throw forbidden('Only editors and above can find and replace across the site.');
  };

  router.add('GET', '/site/find', async (ctx) => {
    needEditor(ctx);
    const o = optionsOf(ctx.query);
    const only = ctx.query.get('collection');
    const hits = [];
    let total = 0;
    let more = false;
    for (const c of store.collections) {
      if (only && c.id !== only) continue;
      for (const id of store.ids(c)) {
        let text;
        try {
          text = store.read(c, id).text;
        } catch {
          continue;
        }
        const re = finder(o.q, { ...o, json: c.format === 'json' });
        const count = (text.match(re) ?? []).length;
        if (!count) continue;
        if (hits.length >= MAX_ENTRIES) {
          more = true;
          continue;
        }
        total += count;
        const s = store.summarize(c, id, text);
        const { samples, kinds } = samplesOf(text, re, { format: c.format, to: o.with === null ? undefined : newTextOf(o, c.format === 'json') });
        const hit = { collection: c.id, id, title: s.title || id, status: s.status ?? 'published', url: s.url, version: sha1(text), count, kinds, samples };
        if (o.with !== null) {
          // plain text (the default), and each other group as it would be if ticked as well
          const problem = async (k) => {
            const r = replaced(c, text, o, new Set(k));
            return r.count ? many.problemOf(ctx, { c, id, before: text, after: r.after }) : null;
          };
          hit.problem = await problem(DEFAULT_KINDS);
          hit.problems = {};
          for (const k of Object.keys(kinds)) if (!DEFAULT_KINDS.includes(k)) hit.problems[k] = (await problem([...DEFAULT_KINDS, k])) ?? null;
        }
        hits.push(hit);
      }
    }
    hits.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
    return { total, entries: hits, more };
  });

  router.add('POST', '/site/replace', async (ctx) => {
    needEditor(ctx);
    const o = optionsOf(ctx.body);
    if (o.with === null) throw badRequest('Say what to replace it with (with), even if empty.');
    const asked = ctx.body.entries;
    if (!Array.isArray(asked) || !asked.length) throw badRequest('Choose the entries to change.');
    if (asked.length > MAX_ENTRIES) throw badRequest(`At most ${MAX_ENTRIES} entries at a time.`);
    for (const a of asked) kindsOf(a?.kinds);
    const out = await repoLock.run(async () => {
      const list = [];
      const skipped = [];
      for (const a of asked) {
        const skip = (reason, title = a?.id) => skipped.push({ collection: a?.collection, id: a?.id, title, reason });
        let c;
        let cur;
        try {
          c = store.collection(String(a?.collection));
          cur = store.read(c, String(a?.id));
        } catch {
          skip('It is no longer there.');
          continue;
        }
        const s = store.summarize(c, a.id, cur.text);
        if (cur.version !== a.version) {
          skip('It changed since the search. Search again to see it as it is now.', s.title);
          continue;
        }
        const kinds = kindsOf(a.kinds);
        const { after, count } = replaced(c, cur.text, o, kinds);
        if (after === cur.text) {
          skip(count ? 'The new text is the same as the old.' : 'The text is not in the ticked places any more.', s.title);
          continue;
        }
        const h = { c, id: a.id, before: cur.text, after: many.stamped(c, cur.text, after), title: s.title, status: s.status ?? 'published', count, kinds: [...kinds] };
        const problem = await many.problemOf(ctx, h);
        if (problem) skip(problem, s.title);
        else list.push(h);
      }
      const n = list.length;
      const commit = await many.commitAll(ctx, list, `Replace “${o.q.slice(0, 60)}” with “${o.with.slice(0, 60)}” in ${n} entr${n === 1 ? 'y' : 'ies'}`);
      if (commit) audit.log(ctx, 'site.replace', { target: 'site', detail: { find: o.q, with: o.with, matchCase: o.matchCase, whole: o.whole, keepCase: o.keep, commit, entries: list.map((h) => `${h.c.id}/${h.id}`), kinds: Object.fromEntries(list.filter((h) => h.kinds.join() !== DEFAULT_KINDS.join()).map((h) => [`${h.c.id}/${h.id}`, h.kinds])) } });
      return { list, skipped, commit };
    });
    const job = many.deploy(ctx, { kind: 'replace', target: 'site', list: out.list, commit: out.commit });
    return {
      commit: out.commit,
      changed: out.list.map((h) => ({ collection: h.c.id, id: h.id, title: h.title, status: h.status, count: h.count, kinds: h.kinds })),
      skipped: out.skipped,
      job,
    };
  });
}
