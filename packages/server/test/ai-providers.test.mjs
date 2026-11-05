// The AI providers beside Anthropic (docs/API-AI.md "Providers"): any OpenAI-compatible endpoint and Ollama. Each is
// met with a fake fetch only: no real API call, and no key from this machine (each test makes up its own and plants
// it, to prove it goes in its header and nowhere else, and that Ollama never gets one). The request's shape, streaming
// off, each failure in fixed words, the timeout, no default model, the config's address rule, the health check, and
// a suggestion and a promotion summary through each.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';
import { createProvider } from '../src/ai/provider.mjs';
import { checkAi } from '../src/env/config.mjs';
import { summarize } from '../src/env/summary.mjs';

const fakeKey = () => `sk-test-${crypto.randomBytes(16).toString('hex')}`;
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const chat = (content, extra = {}) => reply(200, { choices: [{ message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 9 }, ...extra });
const olla = (content) => reply(200, { model: 'llama3.2', message: { role: 'assistant', content }, done: true, prompt_eval_count: 40, eval_count: 7 });
const ask = (p, content = [{ type: 'text', text: 'T' }]) => p.complete({ system: 'S', content });
const fails = (p, content) => ask(p, content).then(() => null, (e) => e);
const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };

/** The config as the server keeps it (checkAi), from what an operator writes. */
const conf = (a) => checkAi(a, { fail: (m) => { throw new Error(m); }, contentRoot: '/srv/site', isInside: (root, p) => p.startsWith(`${root}/`), env: { NODE_ENV: 'test' } });
/** A provider with a fake fetch that records each call and answers `answer` (a Response, or a function giving one). */
function make(a, answer, env = {}) {
  const calls = [];
  const p = createProvider({ ai: conf(a) }, { env, fetch: async (url, init) => (calls.push({ url, init }), typeof answer === 'function' ? answer(init) : answer) });
  return { p, calls };
}
/** A fetch that never answers until the timeout aborts it, as a slow server does. */
const hangs = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));

describe('an OpenAI-compatible endpoint, with a fake fetch', () => {
  const key = fakeKey();
  const OPENAI = { provider: 'openai', model: 'gpt-test-1' };

  test('the request: base URL + /chat/completions, Bearer key, streaming off, the system and the user text', async () => {
    const { p, calls } = make(OPENAI, chat('{"alt":"A red door"}'), { MARKSTAGE_AI_KEY: key });
    assert.deepEqual(await ask(p), { text: '{"alt":"A red door"}', usage: { input: 50, output: 9 } });
    const [{ url, init }] = calls;
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.authorization, `Bearer ${key}`);
    const body = JSON.parse(init.body);
    assert.deepEqual(body, { model: 'gpt-test-1', stream: false, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'T' }] });
    assert.doesNotMatch(init.body + url, new RegExp(key));
    assert.deepEqual(p.status(), { on: true, why: null, reason: null, provider: 'openai', model: 'gpt-test-1' });
  });

  test('an image goes as a data URL part; another base URL; Azure’s api-key header', async () => {
    const { p, calls } = make({ ...OPENAI, baseUrl: 'https://example-resource.openai.azure.com/openai/v1/', keyHeader: 'api-key' }, chat('ok'), { MARKSTAGE_AI_KEY: key });
    await ask(p, [{ type: 'text', text: 'Describe it' }, IMAGE]);
    const { url, init } = calls[0];
    assert.equal(url, 'https://example-resource.openai.azure.com/openai/v1/chat/completions');
    assert.equal(init.headers['api-key'], key);
    assert.equal('authorization' in init.headers, false);
    assert.deepEqual(JSON.parse(init.body).messages[1].content, [{ type: 'text', text: 'Describe it' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
  });

  test('a server on this machine (LM Studio) runs with no key; one elsewhere is off without it', async () => {
    const { p, calls } = make({ ...OPENAI, baseUrl: 'http://127.0.0.1:1234/v1' }, chat('ok'));
    assert.equal(p.status().on, true);
    await ask(p);
    assert.equal(calls[0].url, 'http://127.0.0.1:1234/v1/chat/completions');
    assert.equal('authorization' in calls[0].init.headers, false);
    const remote = make(OPENAI, chat('ok'));
    assert.deepEqual([remote.p.status().on, remote.p.status().reason], [false, 'key']);
    const e = await fails(remote.p);
    assert.deepEqual([e.status, e.code, e.extra.envVar], [503, 'ai-off', 'MARKSTAGE_AI_KEY']);
    assert.equal(remote.calls.length, 0);
  });

  test('no default model: off in words that say to name one, and nothing is sent', async () => {
    const { p, calls } = make({ provider: 'openai' }, chat('ok'), { MARKSTAGE_AI_KEY: key });
    const s = p.status();
    assert.deepEqual([s.on, s.reason, s.model], [false, 'model', null]);
    assert.match(s.why, /"openai", which has no default model\. The owner names the model the endpoint serves in ai\.model\./);
    const e = await fails(p);
    assert.deepEqual([e.status, e.code, e.extra.reason, 'envVar' in e.extra], [503, 'ai-off', 'model', false]);
    assert.equal(calls.length, 0);
  });

  test('each failure is fixed words with no key in them', async () => {
    const cases = [
      [reply(429, { error: { message: 'slow down' } }, { 'retry-after': '7' }), 429, 'ai-rate', /busy/],
      [reply(401, { error: { message: `Incorrect API key provided: ${key}` } }), 502, 'ai-failed', /did not take the server’s key/],
      [reply(404, { error: { message: 'The model does not exist' } }), 502, 'ai-failed', /no model “gpt-test-1”/],
      [reply(500, { error: { message: key } }), 502, 'ai-failed', /error \(500\)/],
      [chat(null, { choices: [{ message: { content: null, refusal: 'I can’t help with that.' }, finish_reason: 'stop' }] }), 502, 'ai-failed', /declined/],
      [chat('', { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }), 502, 'ai-failed', /declined/],
      [chat('   '), 502, 'ai-failed', /said nothing/],
      [reply(200, { unexpected: true }), 502, 'ai-failed', /said nothing/],
      [() => Promise.reject(new Error(`getaddrinfo ENOTFOUND ${key}`)), 502, 'ai-failed', /could not be reached/],
    ];
    for (const [answer, status, code, words] of cases) {
      const e = await fails(make(OPENAI, answer, { MARKSTAGE_AI_KEY: key }).p);
      assert.deepEqual([e?.status, e?.code], [status, code], String(words));
      assert.match(e.message, words);
      assert.doesNotMatch(JSON.stringify({ m: e.message, x: e.extra }), new RegExp(key));
    }
    // a provider's Retry-After is passed on
    assert.equal((await fails(make(OPENAI, reply(429, {}, { 'retry-after': '7' }), { MARKSTAGE_AI_KEY: key }).p)).extra.retryAfter, 7);
  });

  test('a content list answer is read as its text parts', async () => {
    const { p } = make(OPENAI, chat([{ type: 'text', text: '{"text":' }, { type: 'text', text: '"Hi"}' }]), { MARKSTAGE_AI_KEY: key });
    assert.equal((await ask(p)).text, '{"text":"Hi"}');
  });

  test('a timeout is words, after timeoutSeconds', async () => {
    const t0 = Date.now();
    const e = await fails(make({ ...OPENAI, timeoutSeconds: 1 }, hangs, { MARKSTAGE_AI_KEY: key }).p);
    assert.deepEqual([e.status, e.code], [502, 'ai-failed']);
    assert.match(e.message, /did not answer within 1 seconds/);
    assert.ok(Date.now() - t0 >= 900);
  });
});

describe('Ollama, with a fake fetch', () => {
  const OLLAMA = { provider: 'ollama', model: 'llama3.2' };

  test('the request: 127.0.0.1:11434/api/chat by default, streaming off, images beside the text, never a key', async () => {
    const key = fakeKey();
    const { p, calls } = make(OLLAMA, olla('{"alt":"Boats"}'), { MARKSTAGE_AI_KEY: key });
    assert.deepEqual(await ask(p, [{ type: 'text', text: 'Describe it' }, IMAGE]), { text: '{"alt":"Boats"}', usage: { input: 40, output: 7 } });
    const { url, init } = calls[0];
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body);
    assert.equal(body.stream, false);
    assert.equal(body.model, 'llama3.2');
    assert.deepEqual(body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'Describe it', images: ['AAAA'] }]);
    assert.equal(body.options.num_predict, 4000);
    // the server's key is Anthropic's or the endpoint's: it never goes to Ollama
    assert.deepEqual(Object.keys(init.headers), ['content-type']);
    assert.doesNotMatch(JSON.stringify(init), new RegExp(key));
  });

  test('no key needed; no model named is off and says to name one', async () => {
    assert.equal(make(OLLAMA, olla('x')).p.status().on, true);
    const s = make({ provider: 'ollama' }, olla('x')).p.status();
    assert.deepEqual([s.on, s.reason], [false, 'model']);
    assert.match(s.why, /a model you have pulled there/);
  });

  test('a model it does not have, a server that is not running, a timeout: fixed words', async () => {
    const missing = await fails(make(OLLAMA, reply(404, { error: "model 'llama3.2' not found" })).p);
    assert.equal(missing.code, 'ai-failed');
    assert.match(missing.message, /has no model “llama3\.2”\. The owner pulls it there \(ollama pull llama3\.2\)/);
    const down = await fails(make(OLLAMA, () => Promise.reject(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).p);
    assert.match(down.message, /could not be reached/);
    const slow = await fails(make({ ...OLLAMA, timeoutSeconds: 1 }, hangs).p);
    assert.match(slow.message, /within 1 seconds/);
    assert.match((await fails(make(OLLAMA, olla('')).p)).message, /said nothing/);
  });
});

describe('the config: the address rule, the model, what each provider takes', () => {
  const refused = (a, words) => assert.throws(() => conf(a), (e) => (assert.match(e.message, words), true));

  test('https, or an address on this machine; never a sign-in in it', () => {
    refused({ provider: 'openai', model: 'm', baseUrl: 'http://api.example.com/v1' }, /must be https, or an address on this machine/);
    refused({ provider: 'ollama', model: 'm', baseUrl: 'http://192.168.1.20:11434' }, /must be https/);
    refused({ provider: 'openai', model: 'm', baseUrl: 'https://user:secret@api.example.com/v1' }, /must not hold a sign-in/);
    refused({ provider: 'anthropic', endpoint: 'ftp://127.0.0.1/x' }, /must be https/);
    refused({ provider: 'openai', model: 'm', baseUrl: 'not a url' }, /is not a URL/);
    assert.equal(conf({ provider: 'ollama', model: 'm', baseUrl: 'http://localhost:11434/' }).baseUrl, 'http://localhost:11434');
    assert.equal(conf({ provider: 'openai', model: 'm', baseUrl: 'https://openrouter.ai/api/v1' }).baseUrl, 'https://openrouter.ai/api/v1');
  });

  test('each provider its own keys; a model id of any provider’s shape; an unknown provider refused', () => {
    refused({ provider: 'openai', model: 'm', endpoint: 'https://x.example/v1' }, /ai\.endpoint is for the anthropic provider/);
    refused({ provider: 'anthropic', baseUrl: 'https://x.example/v1' }, /ai\.baseUrl is for the openai and ollama providers/);
    refused({ provider: 'ollama', model: 'm', keyHeader: 'api-key' }, /ai\.keyHeader is for the openai provider/);
    refused({ provider: 'openai', model: 'm', keyHeader: 'x-key' }, /ai\.keyHeader/);
    refused({ provider: 'gemini' }, /"anthropic", "openai" \(any OpenAI-compatible endpoint\) or "ollama"/);
    refused({ provider: 'openai', model: 'bad model; rm -rf' }, /must be a model id/);
    refused({ provider: 'anthropic', model: 'gpt-4' }, /Claude model id/);
    refused({ provider: 'openai', model: 'm', key: 'sk-x' }, /never the key itself/);
    for (const model of ['gpt-5.1', 'llama3.2:3b', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'qwen2.5@q4_k_m']) assert.equal(conf({ provider: 'openai', model }).model, model);
    assert.equal(conf({ provider: 'openai' }).model, null);
    assert.equal(conf({ provider: 'anthropic' }).model, 'claude-sonnet-5-5');
  });
});

describe('the health check: one call to the models list', () => {
  const key = fakeKey();

  test('each provider’s list, whether it has the model, and a failure in words', async () => {
    const o = make({ provider: 'openai', model: 'gpt-test-1' }, reply(200, { data: [{ id: 'gpt-test-1' }, { id: 'other' }] }), { MARKSTAGE_AI_KEY: key });
    assert.deepEqual(await o.p.health(), { ok: true, words: 'The openai provider answers, and it has gpt-test-1.', modelFound: true });
    assert.deepEqual([o.calls[0].url, o.calls[0].init.method, o.calls[0].init.headers.authorization, o.calls[0].init.body], ['https://api.openai.com/v1/models', 'GET', `Bearer ${key}`, undefined]);
    const gone = await make({ provider: 'openai', model: 'gpt-test-1' }, reply(200, { data: [{ id: 'other' }] }), { MARKSTAGE_AI_KEY: key }).p.health();
    assert.deepEqual([gone.ok, gone.modelFound], [false, false]);
    const l = make({ provider: 'ollama', model: 'llama3.2' }, reply(200, { models: [{ name: 'llama3.2:latest' }] }));
    assert.deepEqual((await l.p.health()).modelFound, true);
    assert.equal(l.calls[0].url, 'http://127.0.0.1:11434/api/tags');
    const a = make({ provider: 'anthropic' }, reply(200, { data: [] }), { MARKSTAGE_AI_KEY: key });
    assert.equal((await a.p.health()).ok, true);
    assert.equal(a.calls[0].url, 'https://api.anthropic.com/v1/models');
    const bad = await make({ provider: 'openai', model: 'm' }, reply(401, { error: { message: key } }), { MARKSTAGE_AI_KEY: key }).p.health();
    assert.equal(bad.ok, false);
    assert.doesNotMatch(bad.words, new RegExp(key));
    // off: the reason, and no call
    const off = make({ provider: 'openai', model: 'm' }, reply(200, {}));
    assert.equal((await off.p.health()).ok, false);
    assert.equal(off.calls.length, 0);
  });
});

describe('through the server: GET ai, a rewrite and a promotion summary with each provider', () => {
  const key = fakeKey();
  const before0 = process.env.MARKSTAGE_AI_KEY;
  let fx, srv, ed, admin;
  const sent = [];
  let answer = () => chat('{"text":"Short words."}');

  before(async () => {
    process.env.MARKSTAGE_AI_KEY = key;
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { overrides: { ai: { provider: 'openai', model: 'gpt-test-1', baseUrl: 'https://llm.example.test/v1' } }, ai: { env: { MARKSTAGE_AI_KEY: key }, fetch: async (url, init) => (sent.push({ url, init }), answer(url)) } });
    ed = await as(srv, 'editor');
    admin = await as(srv, 'administrator');
  });
  after(async () => {
    await srv?.close();
    if (before0 === undefined) delete process.env.MARKSTAGE_AI_KEY;
    else process.env.MARKSTAGE_AI_KEY = before0;
  });

  test('GET ai names the provider and the model; the health check is an administrator’s and is audited', async () => {
    const r = await ed.get('/ai');
    assert.deepEqual([r.json.on, r.json.why, r.json.reason, r.json.provider, r.json.model], [true, null, null, 'openai', 'gpt-test-1']);
    assert.equal('health' in r.json, false);
    const n = sent.length;
    assert.equal((await ed.get('/ai?check=1')).status, 403);
    assert.equal(sent.length, n);
    answer = () => reply(200, { data: [{ id: 'gpt-test-1' }] });
    const h = await admin.get('/ai?check=1');
    assert.equal(h.status, 200, h.text);
    assert.deepEqual(h.json.health, { ok: true, words: 'The openai provider answers, and it has gpt-test-1.', modelFound: true });
    assert.equal(sent.at(-1).url, 'https://llm.example.test/v1/models');
    const row = srv.app.db.prepare("SELECT * FROM audit WHERE action = 'ai.health'").get();
    assert.deepEqual(JSON.parse(row.detail), { provider: 'openai', model: 'gpt-test-1', modelFound: true });
    assert.doesNotMatch(h.text + row.detail, new RegExp(key));
  });

  test('a rewrite goes to the endpoint and comes back as the suggestion', async () => {
    answer = () => chat('{"text":"Short words."}');
    const r = await ed.post('/ai/suggest', { kind: 'rewrite', collection: 'posts', id: 'hello-world', mode: 'shorten', text: 'These are really very long words.' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.suggestion, r.json.provider, r.json.model], [{ text: 'Short words.' }, 'openai', 'gpt-test-1']);
    const body = JSON.parse(sent.at(-1).init.body);
    assert.equal(body.stream, false);
    assert.match(body.messages[0].content, /fewer words/);
    assert.match(body.messages[1].content, /<passage>\nThese are really very long words\.\n<\/passage>/);
    // one paragraph selected, one back; an answer far longer than the selection, or in another shape, is dropped
    const again = (text) => ed.post('/ai/suggest', { kind: 'rewrite', collection: 'posts', id: 'hello-world', mode: 'rewrite', text });
    answer = () => chat('{"text":"First part.\\n\\nSecond part."}');
    assert.deepEqual((await again('One line.')).json.suggestion, { text: 'First part. Second part.' });
    answer = () => chat(JSON.stringify({ text: 'z'.repeat(500) }));
    const long = await again('Short.');
    assert.deepEqual([long.status, long.json.error], [502, 'ai-failed']);
    assert.match(long.json.message, /much more than was selected/);
    answer = () => chat('Here you go: better words.');
    assert.equal((await again('Short.')).status, 502);
  });

  test('the promotion summary goes through the provider too, with the same number check', async () => {
    const plan = { action: 'promote', from: { env: 'staging' }, to: { env: 'production' }, files: { list: [{ status: 'modified', group: 'pages', path: 'src/content/blog/a.md' }] }, conflicts: [], checks: [] };
    const config = { ai: conf({ provider: 'ollama', model: 'llama3.2' }) };
    const ok = await summarize(config, plan, { env: {}, fetch: async () => olla('One page changes.') });
    assert.deepEqual([ok.status, ok.text, ok.ai], ['ai', 'One page changes.', { model: 'llama3.2' }]);
    const stray = await summarize(config, plan, { env: {}, fetch: async () => olla('It changes 40 pages.') });
    assert.equal(stray.status, 'dropped');
    const down = await summarize(config, plan, { env: {}, fetch: async () => Promise.reject(new Error('down')) });
    assert.deepEqual([down.status, down.ai.why], ['facts', 'the model was not reached: The AI provider could not be reached. Try again in a moment.']);
    const noModel = await summarize({ ai: conf({ provider: 'ollama' }) }, plan, { env: {} });
    assert.deepEqual([noModel.status, noModel.ai.why], ['facts', 'no model is named (ai.model)']);
  });
});
