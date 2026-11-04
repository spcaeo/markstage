// The Publish control saves first (src/publish-first.ts): the owner edited a heading, clicked Publish, and the sheet
// published the saved version without the edit. Now an unsaved entry is saved (awaited) before the sheet opens, and a
// failed save keeps the writer on the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishFirst } from '../src/publish-first.ts';

function deps(dirty: boolean, saveOk: boolean, saveClears = true) {
  const calls: string[] = [];
  let isDirty = dirty;
  return {
    calls,
    d: {
      dirty: () => isDirty,
      save: async () => {
        calls.push('save');
        if (saveOk && saveClears) isDirty = false;
        return saveOk;
      },
      open: () => calls.push('open'),
    },
  };
}

test('nothing unsaved: the sheet opens at once, no save', async () => {
  const { d, calls } = deps(false, true);
  assert.equal(await publishFirst(d), 'opened');
  assert.deepEqual(calls, ['open']);
});

test('unsaved changes: saved first (awaited), then the sheet opens', async () => {
  const { d, calls } = deps(true, true);
  assert.equal(await publishFirst(d), 'saved');
  assert.deepEqual(calls, ['save', 'open']);
});

test('the save fails (an error or a conflict): stay on the page, the sheet never opens', async () => {
  const { d, calls } = deps(true, false);
  assert.equal(await publishFirst(d), 'stayed');
  assert.deepEqual(calls, ['save']);
});

test('a save that answered true but left the entry dirty (a save already running) does not open the sheet either', async () => {
  const { d, calls } = deps(true, true, false);
  assert.equal(await publishFirst(d), 'stayed');
  assert.deepEqual(calls, ['save']);
});
