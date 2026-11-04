// AI suggestions (src/ai/words.ts): why there is no suggestion, in plain words, from the server's answer. Off says
// the env var to set by its name only; too many says when to try again; a failure says nothing was changed.
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { trouble } = await import('../src/ai/words.ts');

/** what the editor's request() throws for an answer that is not ok */
const answer = (message: string, status: number, code?: string, data?: Record<string, unknown>) => Object.assign(new Error(message), { status, code, data });

test('off: the env var by name, and how to turn it on', () => {
  const t = trouble(answer('AI suggestions are off.', 503, 'ai-off', { envVar: 'MARKSTAGE_AI_KEY' }));
  assert.equal(t.state, 'off');
  assert.equal(t.envVar, 'MARKSTAGE_AI_KEY');
  assert.match(t.words, /set MARKSTAGE_AI_KEY where the server runs/);
});

test('too many: the server’s words, and the seconds it says to wait', () => {
  const t = trouble(answer('You have asked for 10 suggestions in the last minute, the most this site allows. Try again in 12 seconds.', 429, 'ai-rate', { retryAfter: 12 }));
  assert.deepEqual([t.state, t.wait], ['rate', 12]);
  assert.equal(t.words, 'You have asked for 10 suggestions in the last minute, the most this site allows. Try again in 12 seconds.');
  const bare = trouble(answer('', 429));
  assert.deepEqual([bare.wait, bare.words], [30, 'Too many suggestions asked for in a short time. Try again in 30 seconds.']);
});

test('failed and denied: the server words, and nothing was changed', () => {
  const f = trouble(answer('The AI provider answered with an error (500). Try again in a moment.', 502, 'ai-failed'));
  assert.equal(f.state, 'failed');
  assert.equal(f.words, 'The AI provider answered with an error (500). Try again in a moment. Nothing was changed.');
  assert.equal(trouble(answer('There is no title or description to translate', 422)).words, 'There is no title or description to translate. Nothing was changed.');
  assert.equal(trouble(answer('A promotion summary is for editors and up.', 403)).state, 'denied');
  assert.equal(trouble(new Error('')).words, 'No suggestion this time: the AI did not answer. Nothing was changed.');
});
