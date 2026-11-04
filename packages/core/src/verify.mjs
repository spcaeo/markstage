// Checks a site can run on its own content with its own packs (@markstage/core/verify):
//   roundTrip(md, text)   -> problems of an unedited save (must be byte for byte the same file)
//   editMatrix(md, text)  -> one result per structural edit: insert, delete and move a top-level block at the start,
//                            in the middle and at the end, delete every block, insert into an empty body.
// An edit passes when the save does not throw, the saved file reads back as the edited document, the lines that
// change are only the edited block's, and undoing the edit (deleting the inserted block, moving the block back)
// gives back the original file byte for byte.

const HINTS = new Set(['outer', 'order']);
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (HINTS.has(k) ? undefined : x)));
const sameNodes = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const clone = (v) => JSON.parse(JSON.stringify(v));
/** An empty body reads as one empty paragraph (so the editor has a line to type in); for comparing, that is no block. */
const blocksOf = (doc) => (doc.content.length === 1 && doc.content[0].type === 'paragraph' && !doc.content[0].content?.length ? [] : doc.content);

export const MATRIX_TEXT = 'Inserted by the edit matrix.';
const NEW = () => ({ type: 'paragraph', content: [{ type: 'text', text: MATRIX_TEXT }] });

// A list that would merge into the list before it gets another top-level marker (markdown/lists.mjs); comparisons
// treat - * + and . ) at column 0 as the same marker, and the result notes it.
const unmark = (t) => t.replace(/^[-*+](?=[ \t]|$)/gm, '-').replace(/^(\d{1,9})[.)](?=[ \t]|$)/gm, '$1.');
const lines = (t) => unmark(t).split('\n').filter((l) => l.trim() !== '');
/** The same file, or the same but for list markers changed to keep two lists apart (noted). */
function sameFile(a, b, notes) {
  if (a === b) return true;
  if (unmark(a) !== unmark(b)) return false;
  notes.push('list markers changed so two lists stay apart');
  return true;
}

/** The non-blank lines only in `a` and only in `b`, after the common start and end are taken off. */
function middle(a, b) {
  const x = lines(a);
  const y = lines(b);
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  return { removed: x.slice(p, x.length - s), added: y.slice(p, y.length - s) };
}

const sorted = (l) => [...l].sort().join('\n');

export function roundTrip(md, text) {
  const out = md.docToMd(md.mdToDoc(text).doc, text);
  return out === text ? [] : [`an unedited save changes the file (first difference at ${[...out].findIndex((c, i) => c !== text[i])})`];
}

export function editMatrix(md, text) {
  const { frontmatter } = md.splitFrontmatter(text);
  const base = blocksOf(md.mdToDoc(text).doc);
  const n = base.length;
  const mid = Math.floor(n / 2);
  const results = [];

  function run(name, edit, check) {
    const r = { name, ok: false, problems: [], notes: [] };
    results.push(r);
    try {
      const doc = { type: 'doc', content: clone(base) };
      edit(doc.content);
      const out = md.docToMd(doc, text);
      if (!sameNodes(blocksOf(md.mdToDoc(out).doc), doc.content)) r.problems.push('the saved file does not read back as the edited document');
      check(out, doc, r.problems, r.notes);
    } catch (e) {
      r.problems.push(`throws: ${e?.message ?? e}`);
    }
    r.ok = r.problems.length === 0;
  }

  const inserted = (at) => (out, doc, problems, notes) => {
    const { removed, added } = middle(text, out);
    if (removed.length || added.join('\n') !== MATRIX_TEXT) problems.push(`lines changed besides the new block: -${removed.length} +${added.length}`);
    const back = { type: 'doc', content: clone(doc.content) };
    back.content.splice(at, 1);
    if (!sameFile(md.docToMd(back, out), text, notes)) problems.push('deleting the new block again does not give back the original file');
  };
  // the lines a delete removes are one run (middle() takes them between the unchanged start and end); a neighbour
  // that got rewritten would show up as added lines
  const deleted = () => (out, _doc, problems) => {
    const { added } = middle(text, out);
    if (added.length) problems.push(`a delete rewrote ${added.length} line(s) of other blocks`);
  };
  const moved = (from, to) => (out, doc, problems, notes) => {
    // the same lines in another order: the moved block keeps its exact source and no other block is rewritten
    if (sorted(lines(text)) !== sorted(lines(out))) problems.push('a move changed the text of blocks');
    const back = { type: 'doc', content: clone(doc.content) };
    const [b] = back.content.splice(to, 1);
    back.content.splice(from, 0, b);
    if (!sameFile(md.docToMd(back, out), text, notes)) problems.push('moving the block back does not give back the original file');
  };

  const places = n === 0 ? [] : [...new Set([0, mid, n - 1])];
  for (const at of [...new Set([0, mid, n])]) run(`insert at ${at === 0 ? 'start' : at === n ? 'end' : 'middle'} (${at}/${n})`, (c) => c.splice(at, 0, NEW()), inserted(at));
  for (const at of places) run(`delete at ${at === 0 ? 'start' : at === n - 1 ? 'end' : 'middle'} (${at}/${n})`, (c) => c.splice(at, 1), deleted());
  if (n > 1) {
    const move = (from, to) => (c) => c.splice(to, 0, c.splice(from, 1)[0]);
    run(`move start to end (0 -> ${n - 1})`, move(0, n - 1), moved(0, n - 1));
    run(`move end to start (${n - 1} -> 0)`, move(n - 1, 0), moved(n - 1, 0));
    if (mid > 0 && mid < n - 1) run(`move middle to start (${mid} -> 0)`, move(mid, 0), moved(mid, 0));
  }
  run(
    'delete every block',
    (c) => c.splice(0),
    (out, _doc, problems) => {
      if (out !== frontmatter && !(n === 0 && out === text)) problems.push(`left ${JSON.stringify(out.slice(frontmatter.length, frontmatter.length + 40))} after the frontmatter`);
    },
  );
  // an empty body (what "delete every block" saved), then one block typed into it
  const empty = md.docToMd({ type: 'doc', content: [] }, text);
  const r = { name: 'insert into an empty body', ok: false, problems: [], notes: [] };
  results.push(r);
  try {
    const out = md.docToMd({ type: 'doc', content: [NEW()] }, empty);
    const want = `${empty ? `${empty}\n` : ''}${MATRIX_TEXT}\n`;
    if (out !== want) r.problems.push(`saved ${JSON.stringify(out.slice(-60))}, expected ${JSON.stringify(want.slice(-60))}`);
  } catch (e) {
    r.problems.push(`throws: ${e?.message ?? e}`);
  }
  r.ok = r.problems.length === 0;
  return results;
}
