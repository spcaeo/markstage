// Small edits for an AI agent (docs/API-MCP.md "Small edits"): `edit_entry` sends only the words to find and what to
// put there, not the whole file, and `get_entry` with `find` reads only the passages around a phrase. Most of what
// an agent pays for a one-sentence change is reading and sending back the whole file; these two make it the size of
// the change.
//
// edit_entry makes the new source from the entry's text and then goes through exactly the same path as
// update_entry (no release: drafts only) or add_to_release (with a release): the toolkit's saveDraft and
// putInRelease, so every rule of theirs holds (version, rights, locks, synced blocks, hidden values, the site's
// validation, the modified date, the commit). Its answer is small: what each edit matched and the changed lines.
import { HttpError, badRequest } from '../util.mjs';

const MAX_EDITS = 100;
const SHOWN = 80;
const DIFF_MAX = 4000;
const LINE_MAX = 300;
const PASSAGES_MAX = 20;
const LCS_CELLS = 4_000_000;

const short = (s) => (s.length > SHOWN ? `${s.slice(0, SHOWN)}…` : s);

/** How many times `find` is in `text`, not overlapping (as a replace-all would change them). */
export function countOf(text, find) {
  let n = 0;
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + find.length)) n++;
  return n;
}

/** The edits as the tool takes them, or a refusal in words: a list of {find, replace, all?}. */
export function checkEdits(edits) {
  if (!Array.isArray(edits) || !edits.length) throw badRequest('edits is a list of changes, each {find, replace}: send at least one.');
  if (edits.length > MAX_EDITS) throw badRequest(`At most ${MAX_EDITS} edits in one call; for more, send the whole source with update_entry or add_to_release.`);
  return edits.map((ed, i) => {
    const n = i + 1;
    if (!ed || typeof ed !== 'object' || Array.isArray(ed)) throw badRequest(`Edit ${n} must be an object: {find, replace}.`);
    for (const k of Object.keys(ed)) if (!['find', 'replace', 'all'].includes(k)) throw badRequest(`Edit ${n} takes no "${k}" (it takes find, replace and all).`);
    if (typeof ed.find !== 'string' || ed.find === '') throw badRequest(`Edit ${n} needs find: the exact text to change, as get_entry gives it. It cannot be empty.`);
    if (typeof ed.replace !== 'string') throw badRequest(`Edit ${n} needs replace: the text to put there ('' takes the found text out).`);
    if (ed.all !== undefined && typeof ed.all !== 'boolean') throw badRequest(`Edit ${n}: all is true or false.`);
    return { find: ed.find, replace: ed.replace, all: ed.all === true };
  });
}

/**
 * The edits applied in order, each to the text the ones before it left: each find must be there exactly once (or,
 * with all, at least once). Refused in words naming the edit and how many places it found; nothing is changed then.
 */
export function applyEdits(text, edits, where = 'the entry') {
  let out = text;
  const report = [];
  edits.forEach((ed, i) => {
    const n = i + 1;
    const matches = countOf(out, ed.find);
    const shown = short(ed.find);
    if (matches === 0) {
      throw new HttpError(422, 'no-match', `Edit ${n} finds nothing: “${shown}” is not in ${where}${i ? ' as the edits before it left it' : ''}. find must be the text exactly as it is in the file (spaces, line breaks, quotes and Markdown marks included). get_entry with find shows where a phrase is. Nothing was changed.`, { edit: n, matches: 0 });
    }
    if (matches > 1 && !ed.all) {
      throw new HttpError(422, 'many-matches', `Edit ${n} finds “${shown}” in ${matches} places, and it must find one. Make find longer so it is in one place only, or set all: true to change all ${matches}. Nothing was changed.`, { edit: n, matches });
    }
    if (ed.all) out = out.split(ed.find).join(ed.replace);
    else {
      const at = out.indexOf(ed.find);
      out = out.slice(0, at) + ed.replace + out.slice(at + ed.find.length);
    }
    report.push({ find: shown, matches });
  });
  return { text: out, edits: report };
}

/** A long line cut to the part that matters: around [from, to) when given, else its start. */
function clip(line, from = 0, to = 0) {
  if (line.length <= LINE_MAX) return line;
  const pad = Math.max(40, Math.floor((LINE_MAX - (to - from)) / 2));
  const a = Math.max(0, from - pad);
  const b = Math.min(line.length, Math.max(to + pad, a + LINE_MAX));
  return `${a > 0 ? '…' : ''}${line.slice(a, b)}${b < line.length ? '…' : ''}`;
}

/** The line-by-line steps from a to b: [' ' | '-' | '+', line], the shortest way (a longest common subsequence). */
function steps(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > LCS_CELLS) return [...a.map((l) => ['-', l]), ...b.map((l) => ['+', l])];
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push([' ', a[i++]]);
      j++;
    } else if (j >= m || (i < n && dp[(i + 1) * w + j] >= dp[i * w + j + 1])) out.push(['-', a[i++]]);
    else out.push(['+', b[j++]]);
  }
  return out;
}

/**
 * Only the lines that changed from `before` to `after`, with `context` lines around each change, as hunks headed
 * "@@ -<old line> +<new line> @@". A long changed line is cut to the part that changed. At most `max` characters.
 */
export function lineDiff(before, after, { context = 2, max = DIFF_MAX } = {}) {
  if (before === after) return '';
  const A = before.split('\n');
  const B = after.split('\n');
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let s = 0;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  const lead = Math.min(context, p);
  const ops = [...A.slice(p - lead, p).map((l) => [' ', l]), ...steps(A.slice(p, A.length - s), B.slice(p, B.length - s)), ...A.slice(A.length - s, A.length - s + context).map((l) => [' ', l])];
  // each step's line numbers (old, new), from where the lines shown start
  let o = p - lead + 1;
  let nw = p - lead + 1;
  const rows = ops.map(([k, line]) => {
    const row = { k, line, o, n: nw };
    if (k !== '+') o++;
    if (k !== '-') nw++;
    return row;
  });
  // a run of removed lines then added ones: each pair cut around the part that differs
  for (let i = 0; i < rows.length; ) {
    if (rows[i].k !== '-') {
      i++;
      continue;
    }
    let d = i;
    while (d < rows.length && rows[d].k === '-') d++;
    let e = d;
    while (e < rows.length && rows[e].k === '+') e++;
    for (let x = 0; x < Math.min(d - i, e - d); x++) {
      const [r1, r2] = [rows[i + x], rows[d + x]];
      let cp = 0;
      while (cp < r1.line.length && cp < r2.line.length && r1.line[cp] === r2.line[cp]) cp++;
      let cs = 0;
      while (cs < r1.line.length - cp && cs < r2.line.length - cp && r1.line[r1.line.length - 1 - cs] === r2.line[r2.line.length - 1 - cs]) cs++;
      r1.shown = clip(r1.line, cp, r1.line.length - cs);
      r2.shown = clip(r2.line, cp, r2.line.length - cs);
    }
    i = e;
  }
  const keep = rows.map(() => false);
  rows.forEach((r, i) => {
    if (r.k === ' ') return;
    for (let x = Math.max(0, i - context); x <= Math.min(rows.length - 1, i + context); x++) keep[x] = true;
  });
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (!keep[i]) continue;
    if (i === 0 || !keep[i - 1]) out.push(`@@ -${rows[i].o} +${rows[i].n} @@`);
    out.push(`${rows[i].k} ${rows[i].shown ?? clip(rows[i].line)}`);
  }
  const text = out.join('\n');
  return text.length > max ? `${text.slice(0, max)}\n… (the diff goes on for ${text.length - max} more characters)` : text;
}

/**
 * The passages of `text` that hold `find` (exactly, as edit_entry's find matches), each with `context` lines around
 * it and its line numbers; passages that touch are joined. A long line is cut to the part around the match.
 */
export function passages(text, find, { context = 3, most = PASSAGES_MAX } = {}) {
  const lines = text.split('\n');
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineAt = (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const hits = [];
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + find.length)) hits.push(at);
  // where in each line the matches fall, to cut a long line around them
  const spans = new Map();
  const ranges = [];
  for (const at of hits) {
    const first = lineAt(at);
    const last = lineAt(at + find.length - 1);
    for (let l = first; l <= last; l++) {
      const from = Math.max(0, at - starts[l]);
      const to = Math.min(lines[l].length, at + find.length - starts[l]);
      const sp = spans.get(l);
      spans.set(l, sp ? [Math.min(sp[0], from), Math.max(sp[1], to)] : [from, to]);
    }
    const r = [Math.max(0, first - context), Math.min(lines.length - 1, last + context)];
    const prev = ranges.at(-1);
    if (prev && r[0] <= prev[1] + 1) prev[1] = Math.max(prev[1], r[1]);
    else ranges.push(r);
  }
  const shown = ranges.slice(0, most).map(([a, b]) => ({
    from: a + 1,
    to: b + 1,
    text: lines
      .slice(a, b + 1)
      .map((l, x) => (spans.has(a + x) ? clip(l, ...spans.get(a + x)) : clip(l)))
      .join('\n'),
  }));
  return { matches: hits.length, passages: shown, more: ranges.length > most };
}

const str = (description) => ({ type: 'string', description });

export const EDIT_TOOL = {
  name: 'edit_entry',
  title: 'Change a few words',
  scope: 'draft',
  description:
    'The cheap way to make a small change (a word, a sentence, a link, a field): send only what to find and what to put there, not the whole file. Prefer it over update_entry or add_to_release whenever the change is small; send the whole source only to rewrite most of an entry. Each edit’s find is exact text from the file (get_entry, or get_entry with find to read just the passage around it) and must be in one place only, unless all is true; the edits apply in order. Without release it changes a draft, as update_entry does; with release it puts the changed entry into that release, as add_to_release does (if the entry is already in that release, the edits apply to the text the release holds, so several small edits add up). The same rules hold: the version from get_entry (stale: 409), locked and synced blocks stay as they are. The answer is small: what each edit found and only the lines that changed.',
  input: {
    properties: {
      collection: str('A collection id.'),
      id: str('The entry id.'),
      version: str('The version get_entry gave.'),
      edits: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_EDITS,
        description: 'The changes, applied in order. find: the exact text as it is in the file (in a page’s JSON, as the JSON writes it: \\" for a quote). replace: what goes there instead ("" takes it out). all: true to change every place find is, not just the one.',
        items: {
          type: 'object',
          properties: { find: { type: 'string', minLength: 1 }, replace: { type: 'string' }, all: { type: 'boolean' } },
          required: ['find', 'replace'],
          additionalProperties: false,
        },
      },
      release: str('A release id (list_releases), for a live or scheduled entry or a page: the change goes into that release, for a person to publish. Leave out to change a draft.'),
    },
    required: ['collection', 'id', 'version', 'edits'],
  },
  async run(t, a) {
    const edits = checkEdits(a.edits);
    const e = t.entry(t.coll(a.collection), a.id);
    if (a.version !== e.version) throw new HttpError(409, 'conflict', 'This entry changed since you read it. Read it again (get_entry, with find for just the part you change) and send your edits with the version it gives now.', { version: e.version });
    if (a.release === undefined) {
      t.draftOnly(e, 'Send the same edits with a release (edit_entry’s release), or use add_to_release.');
      const next = applyEdits(e.text, edits);
      const r = await t.saveDraft(e, a.version, next.text);
      const after = r.changed ? t.store.read(e.c, e.id).text : e.text;
      return { changed: r.changed, version: r.version, ...(r.commit ? { commit: r.commit } : {}), edits: next.edits, diff: lineDiff(e.text, after) };
    }
    // the entry as this release already holds it, when it does (and the file has not changed since): edits add up
    let before = e.text;
    let from = 'saved';
    const rel = await t.call('GET', `/releases/${encodeURIComponent(a.release)}`);
    const held = (rel.items ?? []).find((i) => i.kind === 'entry' && i.collection === e.c.id && i.entryId === e.id && !i.changedSince);
    if (held) {
      before = (await t.call('GET', `/releases/${encodeURIComponent(rel.id)}/items/${encodeURIComponent(held.id)}`)).text;
      from = 'release';
    }
    const next = applyEdits(before, edits, from === 'release' ? `the entry as the release “${rel.name}” holds it (with the changes already in it)` : 'the entry');
    if (next.text === before) return { changed: false, version: e.version, from, edits: next.edits, diff: '' };
    const r = await t.putInRelease(e, rel.id, a.version, next.text, before);
    const now = (await t.call('GET', `/releases/${encodeURIComponent(rel.id)}/items/${encodeURIComponent(r.item.id)}`)).text;
    return { changed: true, version: e.version, from, edits: next.edits, diff: lineDiff(before, now), item: r.item, release: r.release };
  },
};
