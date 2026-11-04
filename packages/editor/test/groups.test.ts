// The Groups screen's arithmetic (src/groups/model.ts): a group's entries as its page shows them, and the order a
// move leaves behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, orderAfterMove, placeWords, sameOrder, withoutOne } from '../src/groups/model.ts';

const m = (id: string, date: string) => ({ id, title: id.toUpperCase(), url: `/t/${id}/`, date, version: 'v' });
const all = [m('a', '2026-01-01'), m('b', '2026-03-01'), m('c', '2026-02-01'), m('d', '2026-04-01')];
const ids = (x: { id: string }[]) => x.map((y) => y.id);

test('arrange: the ids in the order first, in that order; the rest newest first; unknown and repeated ids skipped', () => {
  assert.deepEqual(ids(arrange(all, []).list), ['d', 'b', 'c', 'a']);
  assert.equal(arrange(all, []).pinned, 0);
  const x = arrange(all, ['c', 'gone', 'a', 'c']);
  assert.deepEqual(ids(x.list), ['c', 'a', 'd', 'b']);
  assert.equal(x.pinned, 2);
});

test('orderAfterMove: what is above the lowest kept or moved item keeps its place; below it, newest first', () => {
  // [c, a | d, b]: d dragged to the top
  assert.deepEqual(orderAfterMove(['d', 'c', 'a', 'b'], ['c', 'a'], ['d']), ['d', 'c', 'a']);
  // nothing kept yet: b dragged to place 2 keeps d above it too (as the writer sees it)
  assert.deepEqual(orderAfterMove(['d', 'b', 'c', 'a'], [], ['b']), ['d', 'b']);
  // a kept one dragged below the line takes what is above it along
  assert.deepEqual(orderAfterMove(['a', 'd', 'b', 'c'], ['c', 'a'], ['c']), ['a', 'd', 'b', 'c']);
  // several at once
  assert.deepEqual(orderAfterMove(['b', 'a', 'd', 'c'], [], ['b', 'a']), ['b', 'a']);
});

test('withoutOne and sameOrder', () => {
  assert.deepEqual(withoutOne(['c', 'a'], 'c'), ['a']);
  assert.ok(sameOrder(['a', 'b'], ['a', 'b']));
  assert.ok(!sameOrder(['a', 'b'], ['b', 'a']));
  assert.ok(!sameOrder(['a'], ['a', 'b']));
});

test('placeWords: the line above the list, in words for one, some, all and none', () => {
  assert.equal(placeWords(0, 0, 'articles', 'topic'), 'No articles in this topic yet.');
  assert.equal(placeWords(5, 0, 'articles', 'topic'), 'None has a place of its own yet: they follow, newest first.');
  assert.equal(placeWords(5, 1, 'articles', 'topic'), 'The first keeps its place on the page; the rest follow, newest first.');
  assert.equal(placeWords(5, 2, 'articles', 'topic'), 'The first 2 keep these places on the page; the rest follow, newest first.');
  assert.equal(placeWords(2, 2, 'articles', 'topic'), 'All 2 keep these places on the page.');
});
