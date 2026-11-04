// The page model (src/pages/model.ts): undo after a save, and the changes a list's diff makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, diffChanges, PageModel } from '../src/pages/model.ts';

const page = () => ({ title: 'T', sections: [{ discriminant: 'hero', value: { heading: 'A' } }, { discriminant: 'faq', value: { heading: 'B' } }, { discriminant: 'cta', value: { heading: 'C' } }] });
const added = { discriminant: 'logos', value: { heading: 'New' } };

/** What a save does: the changes go to the file (the server applies them as the model does), then markSaved. */
function save(m: PageModel, file: Record<string, unknown>): void {
  const sent = m.changes;
  for (const ch of sent) apply(file, ch);
  m.markSaved(sent, `v${Math.random()}`);
}

test('an insert saved, then undone: the page has changes to save, and saving them puts the file back as it was', () => {
  const file = page();
  const m = new PageModel(structuredClone(file), 'v1');
  m.change({ op: 'insert', path: 'sections', index: 1, value: added });
  save(m, file);
  assert.equal(m.dirty, false);
  m.undo();
  assert.deepEqual(m.data, page());
  assert.equal(m.dirty, true, 'the file still has the section: undoing it is a change to save');
  assert.deepEqual(m.changes, [{ op: 'remove', path: 'sections.1' }]);
  save(m, file);
  assert.deepEqual(file, page());
  // and redo puts it back, as a change to save again
  m.redo();
  assert.deepEqual(m.changes, [{ op: 'insert', path: 'sections', index: 1, value: added }]);
});

test('an edit before the save and one after: undoing past the save keeps both sides right', () => {
  const file = page();
  const m = new PageModel(structuredClone(file), 'v1');
  m.change({ op: 'set', path: 'sections.0.value.heading', value: 'A2' });
  m.settle();
  save(m, file);
  m.change({ op: 'set', path: 'title', value: 'T2' });
  m.undo();
  assert.equal(m.dirty, false, 'back to the saved file');
  m.undo();
  assert.deepEqual(m.changes, [{ op: 'set', path: 'sections.0.value.heading', value: 'A' }]);
});

test('a list diff: one item put in or taken out is one insert or one remove, not every item after it set again', () => {
  const a = page().sections;
  const b = [a[0], added, a[1], a[2]];
  assert.deepEqual(diffChanges(a, b, 'sections'), [{ op: 'insert', path: 'sections', index: 1, value: added }]);
  assert.deepEqual(diffChanges(b, a, 'sections'), [{ op: 'remove', path: 'sections.1' }]);
  assert.deepEqual(diffChanges(a, [a[2]], 'sections'), [{ op: 'remove', path: 'sections.1' }, { op: 'remove', path: 'sections.0' }]);
  // an item changed in the middle is still changed field by field
  const c = [a[0], { ...a[1], value: { heading: 'B2' } }, a[2]];
  assert.deepEqual(diffChanges(a, c, 'sections'), [{ op: 'set', path: 'sections.1.value.heading', value: 'B2' }]);
  // and every diff turns one list into the other
  for (const [x, y] of [[a, b], [b, a], [a, c], [c, b], [b, [added]], [[], a]] as unknown[][][]) {
    const d = { sections: structuredClone(x) };
    for (const ch of diffChanges(x, y, 'sections')) apply(d, ch);
    assert.deepEqual(d.sections, y);
  }
});

test('what the server stamped on a save (the modified date) is taken in, and an undo past the save puts it back', () => {
  const file: Record<string, unknown> = { modified: '2026-10-28T13:00:44+00:00', ...page() };
  const m = new PageModel(structuredClone(file), 'v1');
  m.change({ op: 'insert', path: 'sections', index: 1, value: added });
  const sent = m.changes;
  for (const ch of sent) apply(file, ch);
  file.modified = '2026-10-29T09:15:00+00:00';
  m.markSaved(sent, 'v2');
  // another version than the one saved: not this save's file
  m.absorb(structuredClone(file), 'v3');
  assert.equal(m.data.modified, '2026-10-28T13:00:44+00:00');
  m.absorb(structuredClone(file), 'v2');
  assert.equal(m.data.modified, '2026-10-29T09:15:00+00:00');
  assert.equal(m.dirty, false);
  m.undo();
  assert.deepEqual(m.changes, [{ op: 'set', path: 'modified', value: '2026-10-28T13:00:44+00:00' }, { op: 'remove', path: 'sections.1' }]);
});
