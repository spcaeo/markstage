// Where a Library section can go on a page (src/pages/places.ts): the drop line between sections, a locked section's
// middle, a page whose layout is locked, and the places in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropTarget, layoutLock, placeWords } from '../src/pages/places.ts';

const label = (i: number) => `${i + 1}. Section ${i + 1}`;
const none = () => null;
// three sections drawn 0-300, 300-500, 500-900 (the third one tall); the frame's window is 600 high
const rects = [
  { index: 0, top: 0, bottom: 300 },
  { index: 1, top: 300, bottom: 500 },
  { index: 2, top: 500, bottom: 900 },
];

test('a drop lands before the section it is over when nearer its top, else after it; past the last, at the end', () => {
  assert.deepEqual(dropTarget(10, rects, 3, none, label), { index: 0, y: 0 });
  assert.deepEqual(dropTarget(200, rects, 3, none, label), { index: 1, y: 300 });
  assert.deepEqual(dropTarget(350, rects, 3, none, label), { index: 1, y: 300 });
  assert.deepEqual(dropTarget(480, rects, 3, none, label), { index: 2, y: 500 });
  assert.deepEqual(dropTarget(880, rects, 3, none, label), { index: 3, y: 900 });
  assert.deepEqual(dropTarget(2000, rects, 3, none, label), { index: 3, y: 900 });
  // the page scrolled: the same sections higher up
  const scrolled = rects.map((r) => ({ ...r, top: r.top - 400, bottom: r.bottom - 400 }));
  assert.deepEqual(dropTarget(10, scrolled, 3, none, label), { index: 2, y: 100 });
});

test('a site that draws its sections in a column: the line is as wide as the section it is drawn by', () => {
  const column = rects.map((r) => ({ ...r, left: 280, right: 1100 }));
  assert.deepEqual(dropTarget(10, column, 3, none, label), { index: 0, y: 0, left: 280, right: 1100 });
  assert.deepEqual(dropTarget(880, column, 3, none, label), { index: 3, y: 900, left: 280, right: 1100 });
});

test('a locked section takes no drop in its middle, in words; near its edges the drop goes above or below it', () => {
  const lockedWhy = (i: number) => (i === 2 ? "Locked by the site: can't be moved or changed." : null);
  assert.deepEqual(dropTarget(700, rects, 3, lockedWhy, label), {
    why: "3. Section 3. Locked by the site: can't be moved or changed. Drop it above or below this section.",
    box: rects[2],
  });
  assert.deepEqual(dropTarget(520, rects, 3, lockedWhy, label), { index: 2, y: 500 });
  assert.deepEqual(dropTarget(890, rects, 3, lockedWhy, label), { index: 3, y: 900 });
});

test('no sections yet: anywhere puts it on the page; sections the page does not mark: it says so', () => {
  assert.deepEqual(dropTarget(300, [], 0, none, label), { index: 0, y: 12 });
  assert.match((dropTarget(300, [], 3, none, label) as { why: string }).why, /does not mark its sections/);
  // a section the page draws but the entry does not have (yet) is not a place
  assert.deepEqual(dropTarget(880, rects, 2, none, label), { index: 2, y: 500 });
});

test('the page’s own lock: layout or edit, while the file and the page both have it', () => {
  const page = (saved: unknown, now: unknown) => ({ savedData: { _lock: saved }, data: { _lock: now } });
  assert.equal(layoutLock(page(undefined, undefined)), null);
  assert.equal(layoutLock(page({ layout: true }, { layout: true, by: 'Ana' })), 'The layout of this page is locked by Ana: no section can be added, deleted or reordered.');
  assert.equal(layoutLock(page({ layout: true }, { layout: true })), 'The layout of this page is locked by an editor: no section can be added, deleted or reordered.');
  assert.equal(layoutLock(page({ edit: true }, { edit: true })), "This page is locked by an editor: it can't be changed.");
  // taken off here (an editor may, in the same save), or not yet saved: it does not bind
  assert.equal(layoutLock(page({ layout: true }, undefined)), null);
  assert.equal(layoutLock(page(undefined, { layout: true })), null);
});

test('the places in words', () => {
  const page = { data: { sections: [{}, {}, {}] }, savedData: {} };
  assert.equal(placeWords(page, 0, label), 'at the top, before 1. Section 1');
  assert.equal(placeWords(page, 2, label), 'after 2. Section 2');
  assert.equal(placeWords(page, 3, label), 'at the end, after 3. Section 3');
  assert.equal(placeWords({ data: {}, savedData: {} }, 0, label), 'on the page');
});
