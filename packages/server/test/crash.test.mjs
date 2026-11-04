// An unhandled rejection or an uncaught exception is logged and ends the process non-zero (src/crash.mjs), so the
// supervisor restarts it instead of leaving a half-working server (L5 of the 2026-11-02 review).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { watchCrashes } from '../src/crash.mjs';

test('an unhandled rejection is logged with its stack and the process exits 1, once', () => {
  const proc = new EventEmitter();
  const lines = [];
  const exits = [];
  watchCrashes(proc, { log: (l) => lines.push(l), exit: (c) => exits.push(c) });
  assert.deepEqual([proc.listenerCount('unhandledRejection'), proc.listenerCount('uncaughtException')], [1, 1]);
  const err = new Error('the sweeper broke');
  proc.emit('unhandledRejection', err);
  assert.match(lines[0], /^\[markstage\] unhandled promise rejection: Error: the sweeper broke\n\s+at /);
  assert.equal(lines[1], '[markstage] exiting so the service manager can start a fresh process.');
  assert.deepEqual(exits, [1]);
  // a second crash while exiting is logged, not a second exit
  proc.emit('uncaughtException', new TypeError('again'));
  assert.match(lines[2], /uncaught exception: TypeError: again/);
  assert.deepEqual(exits, [1]);
});

test('a rejection with a plain value (not an Error) is still logged', () => {
  const proc = new EventEmitter();
  const lines = [];
  watchCrashes(proc, { log: (l) => lines.push(l), exit: () => {} });
  proc.emit('unhandledRejection', 'just a string');
  assert.equal(lines[0], '[markstage] unhandled promise rejection: just a string');
});
