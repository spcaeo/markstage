// A page list item's lock (src/pages/locks.ts): its own `_lock` and the site's rule for its kind, merged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLocks } from '../src/pages/locks.ts';

test('no site rule: the item keeps its own lock, or none', () => {
  assert.equal(mergeLocks(undefined, undefined), undefined);
  assert.deepEqual(mergeLocks({ move: true }, undefined), { move: true });
  assert.deepEqual(mergeLocks({ edit: true }, {}), { edit: true });
});

test('only the site locks it: the site is named', () => {
  assert.deepEqual(mergeLocks(undefined, { move: true, remove: true }), { move: true, remove: true, by: 'the site' });
});

test('both lock: each can only add, and the site is named when it adds', () => {
  assert.deepEqual(mergeLocks({ edit: true }, { move: true, remove: true }), { move: true, remove: true, edit: true, by: 'the site' });
  assert.deepEqual(mergeLocks({ move: true, by: 'Ana' }, { remove: true }), { move: true, remove: true, edit: false, by: 'the site' });
});

test('the site adds nothing the item does not already forbid: the item lock keeps its own name', () => {
  assert.deepEqual(mergeLocks({ move: true, remove: true, by: 'Ana' }, { move: true }), { move: true, remove: true, edit: false, by: 'Ana' });
  assert.deepEqual(mergeLocks({ move: true, remove: true }, { remove: true }), { move: true, remove: true, edit: false });
});

test('the item lifts the site’s rule for an action ("Unlock on this page"): that action is not locked here', () => {
  assert.deepEqual(mergeLocks({ move: false }, { move: true, remove: true }), { move: false, remove: true, edit: false, by: 'the site' });
  assert.equal(mergeLocks({ move: false, remove: false }, { move: true, remove: true }), undefined);
  // a lift with nothing to lift locks nothing either
  assert.equal(mergeLocks({ move: false }, undefined), undefined);
});
