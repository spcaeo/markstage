// Three-way merge: what one side changed is taken from it; the same change once; different changes conflict.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeBlocks, mergeData, resolve, splitBlocks } from '../src/index.mjs';

const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

test('different blocks merge: my p[1] edit and their p[3] edit both land', () => {
  const base = [p('one'), p('two'), p('three'), p('four')];
  const mine = [p('one'), p('TWO mine'), p('three'), p('four')];
  const theirs = [p('one'), p('two'), p('three'), p('FOUR theirs')];
  const r = mergeBlocks(base, mine, theirs);
  assert.equal(r.conflicts, 0);
  assert.deepEqual(r.merged, [p('one'), p('TWO mine'), p('three'), p('FOUR theirs')]);
  assert.equal(r.theirsTaken, 1);
  assert.equal(r.mineTaken, 1);
});

test('inserts and deletes on different sides merge; the same edit on both sides is taken once', () => {
  const base = ['a', 'b', 'c', 'd'];
  assert.deepEqual(mergeBlocks(base, ['a', 'new', 'b', 'c', 'd'], ['a', 'b', 'c']).merged, ['a', 'new', 'b', 'c']);
  assert.deepEqual(mergeBlocks(base, ['a', 'B', 'c', 'd'], ['a', 'B', 'c', 'd']).merged, ['a', 'B', 'c', 'd']);
  assert.deepEqual(mergeBlocks(base, base, base).merged, base);
  assert.deepEqual(mergeBlocks([], ['x'], []).merged, ['x']);
});

test('the same block changed differently is a conflict with the three versions; resolve picks', () => {
  const base = ['a', 'b', 'c'];
  const r = mergeBlocks(base, ['a', 'b mine', 'c'], ['a', 'b theirs', 'c']);
  assert.equal(r.conflicts, 1);
  assert.equal(r.merged, null);
  assert.deepEqual(r.parts[1].conflict, { base: ['b'], mine: ['b mine'], theirs: ['b theirs'] });
  assert.deepEqual(resolve(r.parts, ['theirs']), ['a', 'b theirs', 'c']);
  assert.deepEqual(resolve(r.parts, ['both']), ['a', 'b mine', 'b theirs', 'c']);
  assert.deepEqual(resolve(r.parts, []), ['a', 'b mine', 'c']);
  // a block one side deleted and the other changed
  assert.equal(mergeBlocks(base, ['a', 'c'], ['a', 'B', 'c']).conflicts, 1);
});

test('splitBlocks: paragraphs, a fenced block with blank lines kept whole', () => {
  assert.deepEqual(splitBlocks('# T\n\nOne\nline two\n\n```js\na\n\nb\n```\n\nEnd\n'), ['# T', 'One\nline two', '```js\na\n\nb\n```', 'End']);
});

test('mergeData: leaf by leaf; both changed differently is a conflict (mine kept)', () => {
  const base = { title: 'T', seo: { title: 'S', description: 'D' }, tags: ['a'] };
  const mine = { title: 'T mine', seo: { title: 'S', description: 'D' }, tags: ['a'] };
  const theirs = { title: 'T', seo: { title: 'S', description: 'D theirs' }, tags: ['a', 'b'], extra: 1 };
  assert.deepEqual(mergeData(base, mine, theirs), { merged: { title: 'T mine', seo: { title: 'S', description: 'D theirs' }, tags: ['a', 'b'], extra: 1 }, conflicts: [] });
  const both = mergeData(base, { ...base, title: 'A' }, { ...base, title: 'B' });
  assert.deepEqual(both.conflicts, ['title']);
  assert.equal(both.merged.title, 'A');
  // theirs removed a key mine did not touch
  assert.deepEqual(mergeData({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1 }).merged, { a: 1 });
});

test('changedLeaves: the leaf paths to set to turn one object into another', async () => {
  const { changedLeaves } = await import('../src/index.mjs');
  assert.deepEqual(changedLeaves({ a: 1, seo: { t: 'x', d: 'y' }, tags: ['a'] }, { a: 1, seo: { t: 'X' }, tags: ['a', 'b'], n: 2 }), [
    ['seo.t', 'X'],
    ['seo.d', undefined],
    ['tags', ['a', 'b']],
    ['n', 2],
  ]);
});
