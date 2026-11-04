// Structural edits at the edges (insert, delete, move at the start, in the middle, at the end; delete every block;
// type into an empty body) through the surgical save, with the checker sites run on their own content.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { createConverter } from '../src/index.mjs';
import { editMatrix, MATRIX_TEXT } from '../src/verify.mjs';

const md = createConverter();
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const failures = (text) =>
  editMatrix(md, text)
    .filter((r) => !r.ok)
    .map((r) => `${r.name}: ${r.problems.join('; ')}`);

test('a block inserted before the first one (the reported crash)', () => {
  const t = '---\ntitle: X\n---\n\nCarol writes.\n\n<div class="legacy">old html</div>\n';
  const d = md.mdToDoc(t).doc;
  d.content.unshift(para('New'));
  assert.equal(md.docToMd(d, t), '---\ntitle: X\n---\n\nNew\n\nCarol writes.\n\n<div class="legacy">old html</div>\n');
});

test('a list item inserted before the first item', () => {
  const t = '- a\n- b\n';
  const d = md.mdToDoc(t).doc;
  d.content[0].content.unshift({ type: 'listItem', content: [para('z')] });
  assert.equal(md.docToMd(d, t), '- z\n- a\n- b\n');
});

test('deleting every block leaves the frontmatter; typing into it gives one block', () => {
  const t = '---\ntitle: X\n---\n\nOne.\n\nTwo.\n';
  const empty = md.docToMd({ type: 'doc', content: [] }, t);
  assert.equal(empty, '---\ntitle: X\n---\n');
  assert.equal(md.docToMd({ type: 'doc', content: [para('Hi')] }, empty), '---\ntitle: X\n---\n\nHi\n');
  assert.equal(md.docToMd({ type: 'doc', content: [para('Hi')] }, ''), 'Hi\n');
  assert.equal(md.docToMd(md.mdToDoc(empty).doc, empty), empty, 'an empty body saves unchanged');
});

test('two lists that become neighbours stay two lists', () => {
  const t = '- a\n- b\n\nBetween.\n\n- c\n- d\n';
  const d = md.mdToDoc(t).doc;
  d.content.splice(1, 1);
  const out = md.docToMd(d, t);
  assert.equal(out, '- a\n- b\n\n* c\n* d\n');
  assert.equal(md.mdToDoc(out).doc.content.length, 2);
  const o = '1. a\n2. b\n\nBetween.\n\n1. c\n';
  const od = md.mdToDoc(o).doc;
  od.content.splice(1, 1);
  assert.equal(md.docToMd(od, o), '1. a\n2. b\n\n1) c\n');
});

test('the printer keeps three lists in a row apart', () => {
  const list = (x) => ({ type: 'bulletList', attrs: { tight: true }, content: [{ type: 'listItem', content: [para(x)] }] });
  const text = md.printBlocks([list('a'), list('b'), list('c')]);
  assert.equal(md.mdToDoc(text).doc.content.length, 3, text);
});

test('a moved block keeps its exact source', () => {
  const t = 'First   with  spaces.\n\n<aside>kept</aside>\n\nLast.\n';
  const d = md.mdToDoc(t).doc;
  d.content.push(d.content.shift());
  assert.equal(md.docToMd(d, t), '<aside>kept</aside>\n\nLast.\n\nFirst   with  spaces.\n');
});

test('the edit matrix passes on small documents of every shape', () => {
  for (const t of [
    '',
    '---\ntitle: X\n---\n',
    'Only one.\n',
    '---\ntitle: X\n---\n\n# Head\n\nText.\n\n- a\n- b\n\n> quote\n\n```js\nx\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n',
    '- a\n\n1. b\n\n- c\n\nPara.\n\n- d\n',
  ])
    assert.deepEqual(failures(t), [], JSON.stringify(t));
  assert.ok(editMatrix(md, 'x\n').some((r) => r.name.startsWith('insert')));
  assert.equal(typeof MATRIX_TEXT, 'string');
});

test('the edit matrix passes on the example blog posts', () => {
  const dir = new URL('../../../examples/blog/src/content/posts/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) assert.deepEqual(failures(readFileSync(new URL(f, dir), 'utf8')), [], f);
});
