// The writing help (src/ai/rewrite.ts): its word diff (src/ai/diff.ts), its URL (router.ts: every state of it has
// one), and why it is off in words (src/ai/words.ts) when the server names something other than the key.
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
const { changeWords, wordDiff } = await import('../src/ai/diff.ts');
const { trouble } = await import('../src/ai/words.ts');

/** The diff read back both ways: kept + taken out is the selection, kept + put in is the suggestion. */
const sides = (parts: { op: string; text: string }[]) => [parts.filter((p) => p.op !== 'add').map((p) => p.text).join(''), parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')];

test('the diff: words taken out and put in, the rest kept, and it joins back to both texts', () => {
  const cases = [
    ['I recieve alot of mail.', 'I receive a lot of mail.'],
    ['We really just walked in order to see the boats.', 'We walked to see the boats.'],
    ['The harbour opens at nine.', 'Good news: the harbour opens at nine.'],
    ['Same words.', 'Same words.'],
    ['', 'All new.'],
    ['Gone.', ''],
    ['A very big dog barked, loudly.', 'A huge dog barked.'],
    ['Ünïcödé café — naïve.', 'Unicode cafe, naive.'],
  ];
  for (const [a, b] of cases) assert.deepEqual(sides(wordDiff(a, b)), [a, b], `${a} → ${b}`);
  assert.deepEqual(wordDiff('I recieve alot of mail.', 'I receive a lot of mail.'), [
    { op: 'same', text: 'I ' },
    { op: 'del', text: 'recieve alot' },
    { op: 'add', text: 'receive a lot' },
    { op: 'same', text: ' of mail.' },
  ]);
  assert.deepEqual(
    wordDiff('I recieve alot of letters from teh harbour master.', 'I receive a lot of letters from the harbour master.').filter((p) => p.op !== 'same'),
    [
      { op: 'del', text: 'recieve alot' },
      { op: 'add', text: 'receive a lot' },
      { op: 'del', text: 'teh' },
      { op: 'add', text: 'the' },
    ],
    'the spaces both runs share stay kept',
  );
  assert.deepEqual(sides(wordDiff('a  b', 'a b')), ['a  b', 'a b']);
  // a run only taken out ends with its space, wherever the matching put it
  assert.deepEqual(
    wordDiff('We really just walked down in order to see the boats.', 'We walked down to see the boats.').filter((p) => p.op !== 'same'),
    [
      { op: 'del', text: 'really just ' },
      { op: 'del', text: 'in order ' },
    ],
  );
  // a run taken out with nothing put in keeps its spaces where they were
  assert.deepEqual(wordDiff('We really walked.', 'We walked.'), [
    { op: 'same', text: 'We ' },
    { op: 'del', text: 'really ' },
    { op: 'same', text: 'walked.' },
  ]);
  assert.deepEqual(wordDiff('Same words.', 'Same words.'), [{ op: 'same', text: 'Same words.' }]);
});

test('the change in words: how many out and in', () => {
  assert.equal(changeWords(wordDiff('I recieve alot of mail.', 'I receive a lot of mail.')), '2 words out, 3 words in');
  assert.equal(changeWords(wordDiff('We really walked.', 'We walked.')), '1 word out');
  assert.equal(changeWords(wordDiff('Hi.', 'Hi!')), 'Only spaces or punctuation change');
  assert.equal(changeWords(wordDiff('Hi.', 'Hi.')), 'No change');
});

test('a 4,000-character selection diffs quickly', () => {
  const a = 'The quick brown fox jumps over the lazy dog. '.repeat(90);
  const b = a.replaceAll('lazy', 'sleepy');
  const t0 = Date.now();
  assert.deepEqual(sides(wordDiff(a, b)), [a, b]);
  assert.ok(Date.now() - t0 < 2000);
});

test('the URL: the choices, then the chosen mode; a bad one is not read', async () => {
  const router = await import('../src/router.ts');
  const at = (h: string) => router.format(router.parse(h));
  assert.deepEqual(router.parse('#/e/posts/hello?suggest=rewrite&sel=12-40').suggest, { kind: 'rewrite', sel: [12, 40] });
  assert.equal(at('#/e/posts/hello?suggest=rewrite&sel=12-40'), '#/e/posts/hello?suggest=rewrite&sel=12-40');
  assert.deepEqual(router.parse('#/e/posts/hello?suggest=rewrite&sel=12-40&how=tone:formal').suggest, { kind: 'rewrite', sel: [12, 40], how: 'tone:formal' });
  assert.equal(at('#/e/posts/hello?suggest=rewrite&sel=12-40&how=shorten'), '#/e/posts/hello?suggest=rewrite&sel=12-40&how=shorten');
  // an unknown mode is the choices again; a range the wrong way round, or none, is no card
  assert.deepEqual(router.parse('#/e/posts/hello?suggest=rewrite&sel=12-40&how=poem').suggest, { kind: 'rewrite', sel: [12, 40] });
  assert.equal(router.parse('#/e/posts/hello?suggest=rewrite&sel=40-12').suggest, null);
  assert.equal(router.parse('#/e/posts/hello?suggest=rewrite').suggest, null);
  assert.equal(router.parse('#/e/posts/hello?suggest=rewrite&sel=1-x').suggest, null);
});

test('off for a missing model: the server’s own words, and no variable to set', () => {
  const words = 'AI suggestions are off: ai.provider is "ollama", which has no default model. The owner names a model you have pulled there, such as one ollama list shows, in ai.model.';
  const t = trouble(Object.assign(new Error(words), { status: 503, code: 'ai-off', data: { reason: 'model' } }));
  assert.deepEqual([t.state, t.words, t.envVar], ['off', words, undefined]);
  // the key: the variable by name, as before
  const k = trouble(Object.assign(new Error('off'), { status: 503, code: 'ai-off', data: { envVar: 'MARKSTAGE_AI_KEY' } }));
  assert.equal(k.envVar, 'MARKSTAGE_AI_KEY');
});
