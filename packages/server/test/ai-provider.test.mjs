// AI suggestions' provider and translations (docs/API-AI.md "Provider", "Translate"). The Anthropic provider is met
// with a fake fetch only: no real API call, and no key from this machine (each test makes up its own and plants
// it, to prove it goes in the x-api-key header and nowhere else). Translation drafts keep the site's spelling for
// the locale, as its build does. Test people are made up here, with generated passwords.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { TMP_ROOT, as, makeFixture, startServer } from './helpers.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { createProvider } from '../src/ai/provider.mjs';
import { API_VERSION } from '../src/env/summary.mjs';

const fakeKey = () => `sk-ant-test-${crypto.randomBytes(16).toString('hex')}`;
const ANTHROPIC = { provider: 'anthropic', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages', timeoutSeconds: 30, perMinute: 10, perDay: 200 };
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const said = (text, usage = { input_tokens: 120, output_tokens: 30 }) => reply(200, { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage });

describe('the Anthropic provider, with a fake fetch', () => {
  const key = fakeKey();
  const make = (answer) => {
    const calls = [];
    const p = createProvider({ ai: ANTHROPIC }, { env: { MARKSTAGE_AI_KEY: key }, fetch: async (url, init) => (calls.push({ url, init }), typeof answer === 'function' ? answer() : answer) });
    return { p, calls };
  };
  const ask = (p) => p.complete({ system: 'S', content: [{ type: 'text', text: 'T' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] });

  test('the request: the key in x-api-key only, the API version, the model, low effort, the image block', async () => {
    const { p, calls } = make(said('{"alt":"A red door"}'));
    const out = await ask(p);
    assert.deepEqual(out, { text: '{"alt":"A red door"}', usage: { input: 120, output: 30 } });
    const [{ url, init }] = calls;
    assert.equal(url, ANTHROPIC.endpoint);
    assert.equal(init.headers['x-api-key'], key);
    assert.equal(init.headers['anthropic-version'], API_VERSION);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'claude-sonnet-5-5');
    assert.deepEqual(body.output_config, { effort: 'low' });
    assert.equal(body.system, 'S');
    assert.equal(body.messages[0].content[1].source.media_type, 'image/png');
    assert.doesNotMatch(init.body, new RegExp(key));
    assert.doesNotMatch(url, new RegExp(key));
    // no sampling settings: the model takes none
    for (const k of ['temperature', 'top_p', 'top_k']) assert.equal(k in body, false);
  });

  test('each failure is fixed words with no key in them', async () => {
    const cases = [
      [reply(429, { error: { type: 'rate_limit_error' } }, { 'retry-after': '12' }), 429, 'ai-rate', { retryAfter: 12 }],
      [reply(429, {}), 429, 'ai-rate', { retryAfter: 30 }],
      [reply(401, { error: { type: 'authentication_error', message: `bad key ${key}` } }), 502, 'ai-failed', {}],
      [reply(500, { error: { message: key } }), 502, 'ai-failed', {}],
      [reply(200, { content: [], stop_reason: 'refusal' }), 502, 'ai-failed', {}],
      [said('   '), 502, 'ai-failed', {}],
      [() => Promise.reject(new Error(`connect ECONNREFUSED with ${key}`)), 502, 'ai-failed', {}],
    ];
    for (const [answer, status, code, extra] of cases) {
      const { p } = make(answer);
      const e = await ask(p).then(() => null, (x) => x);
      assert.ok(e, `${status} ${code}`);
      assert.deepEqual([e.status, e.code], [status, code]);
      for (const [k, v] of Object.entries(extra)) assert.equal(e.extra[k], v);
      assert.doesNotMatch(JSON.stringify({ m: e.message, x: e.extra }), new RegExp(key));
    }
  });

  test('no key: off, in words, and nothing is sent', async () => {
    let sent = 0;
    const p = createProvider({ ai: ANTHROPIC }, { env: {}, fetch: async () => (sent++, said('x')) });
    assert.deepEqual(p.status(), { on: false, why: 'AI suggestions are off: MARKSTAGE_AI_KEY is not set on the server and there is no ai.keyFile.', reason: 'key', provider: null, model: 'claude-sonnet-5-5' });
    const e = await ask(p).then(() => null, (x) => x);
    assert.deepEqual([e.status, e.code, e.extra.envVar], [503, 'ai-off', 'MARKSTAGE_AI_KEY']);
    // no ai block in the config: the defaults, still off without a key
    assert.equal(createProvider({}, { env: {} }).status().on, false);
    assert.equal(sent, 0);
  });

  test('the key from ai.keyFile (a Docker secret), read on each call; the environment wins; a missing file is off', async () => {
    const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'ai-key-'));
    const file = path.join(dir, 'ai.key');
    const fromFile = fakeKey();
    fs.writeFileSync(file, `${fromFile}\n`, { mode: 0o600 });
    const heads = [];
    const p = (env) => createProvider({ ai: { ...ANTHROPIC, keyFile: file } }, { env, fetch: async (url, init) => (heads.push(init.headers['x-api-key']), said('{"alt":"x"}')) });
    await ask(p({}));
    // a new key in the file works without a restart
    const next = fakeKey();
    fs.writeFileSync(file, next);
    await ask(p({}));
    await ask(p({ MARKSTAGE_AI_KEY: key }));
    assert.deepEqual(heads, [fromFile, next, key]);
    fs.unlinkSync(file);
    assert.equal(p({}).status().why, 'AI suggestions are off: MARKSTAGE_AI_KEY is not set on the server, and ai.keyFile cannot be read or is empty.');
  });
});

describe('a planted key never leaves through the server', () => {
  const key = fakeKey();
  const before0 = process.env.MARKSTAGE_AI_KEY;
  const sent = [];
  let answer = () => said('{"title":"x","description":"y"}');
  let fx, srv, ed;
  before(async () => {
    // the scrubber reads the server's own environment: plant the made-up key there for this file only
    process.env.MARKSTAGE_AI_KEY = key;
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { overrides: { ai: { provider: 'anthropic' } }, ai: { env: { MARKSTAGE_AI_KEY: key }, fetch: async (url, init) => (sent.push(init), answer()) } });
    ed = await as(srv, 'editor');
  });
  after(async () => {
    await srv?.close();
    if (before0 === undefined) delete process.env.MARKSTAGE_AI_KEY;
    else process.env.MARKSTAGE_AI_KEY = before0;
  });

  test('not in what the model reads, the answer, an error or the audit', async () => {
    answer = () => said(JSON.stringify({ title: `Title ${key}`, description: 'A description.' }));
    const r = await ed.post('/ai/suggest', { kind: 'seo', collection: 'posts', id: 'hello-world', text: `The body names ${key} by mistake.` });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.suggestion, { title: 'Title [hidden]', description: 'A description.' });
    assert.deepEqual([r.json.provider, r.json.model], ['anthropic', 'claude-sonnet-5-5']);
    const last = sent.at(-1);
    assert.equal(last.headers['x-api-key'], key);
    assert.doesNotMatch(last.body, new RegExp(key));
    assert.match(last.body, /\[hidden\] by mistake/);
    // a locale named as the key: the error says it back hidden
    const bad = await ed.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: key });
    assert.equal(bad.status, 422);
    answer = () => reply(401, { error: { message: key } });
    const no = await ed.post('/ai/suggest', { kind: 'seo', collection: 'posts', id: 'hello-world' });
    assert.equal(no.status, 502);
    const info = await ed.get('/ai');
    assert.equal(info.json.on, true);
    for (const t of [bad.text, no.text, info.text, JSON.stringify(srv.app.db.prepare('SELECT * FROM audit').all())]) assert.doesNotMatch(t, new RegExp(key));
  });

  test('a model answer in another shape is a failure, not a suggestion', async () => {
    answer = () => said('Here is a title: Hello.');
    const r = await ed.post('/ai/suggest', { kind: 'seo', collection: 'posts', id: 'hello-world' });
    assert.deepEqual([r.status, r.json.error], [502, 'ai-failed']);
    answer = () => said('{"title": "Only a title"}');
    assert.equal((await ed.post('/ai/suggest', { kind: 'seo', collection: 'posts', id: 'hello-world' })).status, 502);
    const row = srv.app.db.prepare("SELECT * FROM audit WHERE action = 'ai.suggest' ORDER BY id DESC").get();
    assert.deepEqual([row.ok, JSON.parse(row.detail).inputTokens], [0, 120]);
  });
});

describe('a key from ai.keyFile is hidden like one from the environment', () => {
  const key = fakeKey();
  let fx, srv, ed;
  before(async () => {
    fx = makeFixture({ checks: false });
    const file = path.join(fx.run, 'ai.key');
    fs.writeFileSync(file, key, { mode: 0o600 });
    srv = await startServer(fx, { overrides: { ai: { provider: 'anthropic', keyFile: file } }, ai: { env: {}, fetch: async () => said(JSON.stringify({ title: `T ${key}`, description: `D ${key}` })) } });
    ed = await as(srv, 'editor');
  });
  after(() => srv?.close());

  test('not in the answer, the MCP scrubber’s list or the audit', async () => {
    const r = await ed.post('/ai/suggest', { kind: 'seo', collection: 'posts', id: 'hello-world', text: `names ${key}` });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.suggestion, { title: 'T [hidden]', description: 'D [hidden]' });
    assert.ok(srv.app.mcp.scrubber.values().includes(key));
    assert.doesNotMatch(JSON.stringify(srv.app.db.prepare('SELECT * FROM audit').all()), new RegExp(key));
  });

  test('a key file inside the site repo is refused at start, saying why', async () => {
    const inside = path.join(fx.site, 'ai.key');
    await assert.rejects(startServer(fx, { overrides: { ai: { keyFile: inside } } }), /outside the content repo: a file there can be committed/);
  });
});

// A site written in US English at the root, with a Canadian copy that respells it at build, a French copy that
// takes its own title only, and a locale whose spelling module is broken.
const SITE = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  locales: [
    { code: 'en-US', prefix: '', label: 'English (US)' },
    { code: 'en-CA', prefix: '/en-ca', label: 'English (Canada)', variety: 'Canadian English', spelling: './scripts/canadian.mjs', overrides: ['title', 'description'] },
    { code: 'fr-CA', prefix: '/fr', label: 'Français', overrides: ['title'] },
    { code: 'en-GB', prefix: '/uk', label: 'English (UK)', spelling: './scripts/broken.mjs', overrides: ['title'] },
  ],
};
`;

describe('translation drafts keep the site’s spelling', () => {
  let fx, srv, alice, ed;
  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE);
    fs.writeFileSync(path.join(fx.site, 'scripts/canadian.mjs'), "export default (t) => t.replace(/\\bcolor/g, 'colour').replace(/\\bhonor/g, 'honour');\n");
    fs.writeFileSync(path.join(fx.site, 'scripts/broken.mjs'), 'export default 42;\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Locales');
    srv = await startServer(fx, { overrides: { collections: [], ai: { provider: 'stub' } }, core: await loadCore() });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    ed = await as(srv, 'editor');
  });
  after(() => srv?.close());

  test('translate is offered on a site with locales', async () => {
    assert.deepEqual((await alice.get('/ai')).json.kinds, ['alt', 'seo', 'translate', 'rewrite']);
  });

  test('the draft goes through the locale’s spelling, field by field', async () => {
    const r = await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: 'en-CA', fields: { title: 'The color of honor', description: 'Pick a color.' } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.suggestion, { title: 'The colour of honour (stub)', description: 'Pick a colour. (stub)' });
    // with no fields: the entry's own title and description
    const own = await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: 'en-CA' });
    assert.deepEqual(own.json.suggestion, { title: 'Hello World (stub)', description: 'The first post. (stub)' });
    // a locale with no spelling module: the words as the model wrote them
    const fr = await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: 'fr-CA', fields: { title: 'The color' } });
    assert.deepEqual(fr.json.suggestion, { title: 'The color (stub)' });
  });

  test('only a configured locale, only the fields it takes, only an entry this person may read', async () => {
    const unknown = await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: 'de-DE' });
    assert.deepEqual([unknown.status, unknown.json.error], [422, 'locale']);
    assert.match(unknown.json.message, /en-US, en-CA, fr-CA, en-GB/);
    const shut = await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: 'fr-CA', fields: { title: 'A', description: 'B' } });
    assert.deepEqual([shut.status, shut.json.error, shut.json.fields], [422, 'locale', ['description']]);
    const other = await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: 'en-CA', fields: { body: 'x' } });
    assert.equal(other.status, 422);
    const long = await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: 'en-CA', fields: { title: 'x'.repeat(1001) } });
    assert.deepEqual([long.status, long.json.field], [413, 'fields.title']);
    assert.equal((await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'bob-draft', locale: 'en-CA' })).status, 404);
    assert.equal((await ed.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'bob-draft', locale: 'en-CA' })).status, 200);
  });

  test('a broken spelling module is said plainly, before the model is asked', async () => {
    const n = () => srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'ai.suggest'").get().n;
    const was = n();
    const r = await alice.post('/ai/suggest', { kind: 'translate', collection: 'posts', id: 'hello-world', locale: 'en-GB', fields: { title: 'Color' } });
    assert.deepEqual([r.status, r.json.error], [500, 'spelling']);
    assert.match(r.json.message, /en-GB/);
    assert.equal(n(), was);
  });
});
