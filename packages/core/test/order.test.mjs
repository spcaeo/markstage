// Ordering lists and trees (order.mjs): moves (with children, several at once, into and out of parents), removes
// and their undo, the lock rules; moving back gives the same tree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ancestors, canMove, canRemove, flatten, moveItems, placeOf, removeItems, restoreItems } from '@markstage/core';

const menu = () => [
  { id: 'home', label: 'Home' },
  { id: 'services', label: 'Services', children: [{ id: 'migration', label: 'Migration' }, { id: 'consulting', label: 'Consulting' }, { id: 'training', label: 'Training' }] },
  { id: 'blog', label: 'Blog' },
  { id: 'contact', label: 'Contact', lock: { move: true, by: 'the site' } },
];
const ids = (tree) => flatten(tree).map((r) => `${'  '.repeat(r.depth)}${r.item.id}`);

test('flatten: reading order with depth, parent and index', () => {
  assert.deepEqual(ids(menu()), ['home', 'services', '  migration', '  consulting', '  training', 'blog', 'contact']);
  assert.deepEqual(flatten(menu())[3], { item: menu()[1].children[1], depth: 1, parent: 'services', index: 1, path: [1, 1] });
  assert.deepEqual(ancestors(menu(), 'training'), ['services']);
});

test('move within a level, to another parent (with its children), and back: the same tree', () => {
  const t = menu();
  const down = moveItems(t, ['home'], { parent: null, index: 1 });
  assert.deepEqual(ids(down).filter((x) => !x.startsWith(' ')), ['services', 'home', 'blog', 'contact']);
  assert.deepEqual(moveItems(down, ['home'], placeOf(t, 'home')), t);
  // a child out to the top level, then back in
  const out = moveItems(t, ['training'], { parent: null, index: 2 });
  assert.deepEqual(ids(out), ['home', 'services', '  migration', '  consulting', 'training', 'blog', 'contact']);
  assert.deepEqual(moveItems(out, ['training'], placeOf(t, 'training')), t);
  // a parent moves with its children
  const last = moveItems(t, ['services'], { parent: null, index: 3 });
  assert.deepEqual(ids(last), ['home', 'blog', 'contact', 'services', '  migration', '  consulting', '  training']);
  // nesting: blog inside services at the end
  assert.deepEqual(ids(moveItems(t, ['blog'], { parent: 'services', index: 3 })).slice(1, 6), ['services', '  migration', '  consulting', '  training', '  blog']);
});

test('several at once keep their reading order; an item never goes inside itself; items keep identity', () => {
  const t = menu();
  const m = moveItems(t, ['training', 'home'], { parent: null, index: 3 });
  assert.deepEqual(ids(m), ['services', '  migration', '  consulting', 'blog', 'contact', 'home', 'training']);
  assert.equal(moveItems(t, ['services'], { parent: 'migration', index: 0 }), t);
  assert.equal(moveItems(t, ['services'], { parent: 'services', index: 0 }), t);
  assert.equal(m.find((x) => x.id === 'blog'), t[2]);
});

test('remove and restore: back exactly where they were', () => {
  const t = menu();
  const { tree, removed } = removeItems(t, ['consulting', 'blog', 'migration']);
  assert.deepEqual(ids(tree), ['home', 'services', '  training', 'contact']);
  assert.deepEqual(restoreItems(tree, removed), t);
  // removing a parent takes its children; they come back with it
  const r = removeItems(t, ['services', 'training']);
  assert.equal(r.removed.length, 1);
  assert.deepEqual(restoreItems(r.tree, r.removed), t);
});

test('locks: a move-locked item does not move; a remove-lock inside a parent keeps the parent', () => {
  const t = menu();
  assert.deepEqual(canMove(t, ['contact']), { ok: false, reason: "Locked by the site: can't be moved." });
  assert.equal(canMove(t, ['home', 'blog']).ok, true);
  const locked = [{ id: 'a', children: [{ id: 'b', lock: { remove: true, by: 'Olive' } }] }];
  assert.deepEqual(canRemove(locked, ['a']), { ok: false, reason: "Locked by Olive: can't be deleted." });
  assert.equal(canRemove(t, ['contact']).ok, true);
});
