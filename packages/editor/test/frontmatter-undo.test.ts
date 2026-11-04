// The Post settings' undo history (src/settings/state.ts): ⌘Z takes back the writer's last change to the frontmatter,
// typing in one field within a second is one step, a group (an accepted suggestion) is one step, the editor's own
// bookkeeping is no step, and the history lasts through a save but not into another entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrontmatterEdits } from '../src/settings/state.ts';

const clock = () => {
  const c = { t: 0, now: () => c.t };
  return c;
};

test('typing in one field within a second is one step; another field or a pause is another', () => {
  const c = clock();
  const e = new FrontmatterEdits(c.now);
  e.reset({ title: 'Hello', excerpt: 'Old' });
  for (const v of ['N', 'Ne', 'New']) (c.t += 200), e.set('excerpt', v);
  c.t += 200;
  e.set('title', 'Hi');
  c.t += 2000;
  e.set('title', 'Hi there');
  assert.equal(e.undo(), true);
  assert.equal(e.get('title'), 'Hi');
  assert.equal(e.undo(), true);
  assert.equal(e.get('title'), 'Hello');
  assert.equal(e.undo(), true);
  assert.equal(e.get('excerpt'), 'Old');
  assert.equal(e.isDirty, false, 'back to the file: nothing to save');
  assert.equal(e.undo(), false);
  assert.equal(e.redo(), true);
  assert.equal(e.get('excerpt'), 'New');
  assert.deepEqual(e.changes(), { excerpt: 'New' });
});

test('a group is one step: an accepted title and description go back together, and a new key goes away again', () => {
  const e = new FrontmatterEdits(clock().now);
  e.reset({ title: 'Hello' });
  e.group(() => {
    e.set('seo.title', 'A title');
    e.set('seo.description', 'A description');
  });
  assert.deepEqual(e.changes(), { seo: { title: 'A title', description: 'A description' } });
  e.undo();
  assert.equal(e.isDirty, false);
  assert.equal(e.get('seo.title'), undefined);
  e.redo();
  assert.equal(e.get('seo.description'), 'A description');
  assert.equal(e.canRedo, false);
});

test('a new change after an undo drops what could be redone; bookkeeping is no step', () => {
  const e = new FrontmatterEdits(clock().now);
  e.reset({ a: '1' });
  e.set('a', '2');
  e.undo();
  e.set('a', '3');
  assert.equal(e.canRedo, false);
  e.set('b', 'x', { record: false });
  e.undo();
  assert.equal(e.get('a'), '1');
  assert.equal(e.get('b'), 'x', 'not part of the history');
});

test('the history lasts through a save, not into another entry', () => {
  const e = new FrontmatterEdits(clock().now);
  e.reset({ a: '1' });
  e.set('a', '2');
  e.reset({ a: '2' }, { keepHistory: true });
  assert.equal(e.isDirty, false);
  e.undo();
  assert.deepEqual(e.changes(), { a: '1' }, 'undone after the save: a change to save again');
  e.reset({ z: 'other' });
  assert.equal(e.canUndo, false);
  assert.equal(e.canRedo, false);
});
