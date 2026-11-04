// The canvas's waiting state while the framed page has not reported in (src/pages/wait.ts): one automatic retry with
// a fresh preview URL on a timeout or the preview's expired page, then "Try again"; ready clears everything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAIT_MS, WAIT_START, waitStep, waitWords, type WaitState } from '../src/pages/wait.ts';

test('a page that reports ready: the notice goes, nothing reloads', () => {
  const r = waitStep(WAIT_START, 'ready');
  assert.deepEqual(r, { state: { phase: 'ready', retried: false }, reload: false });
  assert.equal(waitWords(r.state), null);
  assert.ok(WAIT_MS >= 60_000, 'the cold path can take a minute');
});

test('a timeout: one retry with a fresh URL, then Try again; a timeout once ready changes nothing', () => {
  const first = waitStep(WAIT_START, 'timeout');
  assert.deepEqual(first, { state: { phase: 'waiting', retried: true }, reload: true });
  assert.match(waitWords(first.state)!.text, /Preparing the preview/);
  const opened = waitStep(first.state, 'open');
  assert.deepEqual(opened, { state: { phase: 'waiting', retried: true }, reload: false });
  const second = waitStep(opened.state, 'timeout');
  assert.deepEqual(second, { state: { phase: 'long', retried: true }, reload: false });
  assert.deepEqual(waitWords(second.state), { text: 'The preview is taking long.', button: 'Try again' });
  const ready: WaitState = { phase: 'ready', retried: false };
  assert.deepEqual(waitStep(ready, 'timeout'), { state: ready, reload: false });
  assert.deepEqual(waitStep(second.state, 'timeout'), { state: second.state, reload: false }, 'a second timeout while long: still Try again');
});

test("the preview's expired page counts as a timeout: an automatic retry at once", () => {
  const r = waitStep(WAIT_START, 'expired');
  assert.deepEqual(r, { state: { phase: 'waiting', retried: true }, reload: true });
  assert.deepEqual(waitStep(r.state, 'expired'), { state: { phase: 'long', retried: true }, reload: false });
  // the dead page can also land in a frame that was in already (a redraw after a save, a cookie that ended)
  assert.deepEqual(waitStep({ phase: 'ready', retried: false }, 'expired'), { state: { phase: 'waiting', retried: true }, reload: true });
  assert.deepEqual(waitStep({ phase: 'long', retried: true }, 'expired'), { state: { phase: 'long', retried: true }, reload: false });
});

test('Try again reloads and waits again; it does nothing unless the notice shows it', () => {
  const long: WaitState = { phase: 'long', retried: true };
  assert.deepEqual(waitStep(long, 'try-again'), { state: { phase: 'waiting', retried: true }, reload: true });
  assert.deepEqual(waitStep(WAIT_START, 'try-again'), { state: WAIT_START, reload: false });
  // after Try again a page that still does not come: Try again again, no endless automatic retries
  assert.deepEqual(waitStep({ phase: 'waiting', retried: true }, 'timeout'), { state: long, reload: false });
  // ready clears the retry, so the next load (a save redraws the page) may retry once more
  assert.deepEqual(waitStep({ phase: 'waiting', retried: true }, 'ready').state, { phase: 'ready', retried: false });
});
