// The contrast guard's arithmetic (scripts/canvas-contrast.mjs): WCAG 2 ratios, colours laid over others, the verdict.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judge, over, ratio } from '../scripts/canvas-contrast.mjs';

test('WCAG ratios: black on white is 21, a colour on itself is 1, the order does not matter', () => {
  assert.equal(ratio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(ratio([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(ratio([120, 120, 120], [120, 120, 120]), 1);
  // the bug this guards: the canvas's light text on the site's light code box
  assert.ok(ratio([228, 229, 232], [245, 245, 247]) < 1.2);
  // the example blog's text on its page
  assert.ok(ratio([29, 31, 35], [255, 255, 255]) > 15);
});

test('a partly transparent colour is laid over what is under it', () => {
  assert.deepEqual(over([0, 0, 0, 0.5], [255, 255, 255]), [127.5, 127.5, 127.5]);
  assert.deepEqual(over([10, 20, 30], [255, 255, 255]), [10, 20, 30]);
});

test('the verdict: a block under 4.5:1 fails and is named; the lowest per kind is kept', () => {
  const r = judge([
    { kind: 'p', text: 'Fine', ratio: 15.2, fg: 'rgb(29, 31, 35)', bg: 'rgb(255, 255, 255)' },
    { kind: 'code', text: 'console.log', ratio: 1.1, fg: 'rgb(228, 229, 232)', bg: 'rgb(245, 245, 247)' },
    { kind: 'p', text: 'Muted', ratio: 5.1, fg: 'rgb(102, 107, 115)', bg: 'rgb(255, 255, 255)' },
  ]);
  assert.deepEqual(r.worst, { p: 5.1, code: 1.1 });
  assert.equal(r.count, 3);
  assert.deepEqual(r.failures, ['contrast code: 1.1:1, rgb(228, 229, 232) on rgb(245, 245, 247) ("console.log")']);
});
