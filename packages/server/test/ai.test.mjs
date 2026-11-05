// AI suggestions (docs/API-AI.md) with the stub provider: no network and no key from this machine. Who may ask for
// what (the MCP server's readable rule; a plan's summary for editors and up), the size caps, the per-person limits
// counted from the audit, the audit row with no prompt or answer text, the off state in words, and that asking
// commits nothing. Test people are made up here, with generated passwords.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';
import { mcpToken } from './mcp-support.mjs';

const suggest = (who, body) => who.post('/ai/suggest', body);

/** A fixture with images in the media folder: a PNG, a text file named .png, and a link out of the folder. */
function mediaFixture() {
  const fx = makeFixture({ checks: false });
  const up = path.join(fx.site, 'src/assets/uploads');
  fs.mkdirSync(path.join(up, '2026'), { recursive: true });
  fs.writeFileSync(path.join(up, 'sky.png'), makePng());
  fs.writeFileSync(path.join(up, '2026/sea view.png'), makePng());
  fs.writeFileSync(path.join(up, 'notes.png'), 'not an image\n');
  fs.symlinkSync(path.join(fx.site, 'secret.txt'), path.join(up, 'link.png'));
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Images');
  return fx;
}

/** A plan row as Environments leaves it once its files are listed (the summary reads only these facts). */
function addPlan(app, { files = true } = {}) {
  const id = `pl_${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date(app.clock()).toISOString();
  const data = files
    ? { files: { list: [{ status: 'modified', group: 'templates', path: 'src/layouts/Base.astro' }, { status: 'removed', group: 'pages', path: 'src/content/blog/old.md' }], autoMerged: [] }, conflicts: [], checks: [], pages: null }
    : {};
  app.db.prepare('INSERT INTO env_plans (id, action, from_env, from_branch, to_env, to_branch, created_at, expires_at, status, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'promote', 'staging', 'staging', 'production', 'main', now, now, files ? 'ready' : 'preparing', JSON.stringify(data));
  return id;
}

describe('AI suggestions with the stub provider', () => {
  let fx, srv, ed, alice, carol;
  const audits = (action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
  let head0;

  before(async () => {
    fx = mediaFixture();
    head0 = fx.git('rev-parse', 'HEAD').trim();
    srv = await startServer(fx, { overrides: { ai: { provider: 'stub', perMinute: 600, perDay: 100_000 } } });
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => srv?.close());

  test('GET /ai says it is on, and lists the kinds this person may ask for', async () => {
    const e = await ed.get('/ai');
    assert.equal(e.status, 200);
    assert.deepEqual({ on: e.json.on, why: e.json.why, envVar: e.json.envVar, provider: e.json.provider, kinds: e.json.kinds }, { on: true, why: null, envVar: 'MARKSTAGE_AI_KEY', provider: 'stub', kinds: ['alt', 'seo', 'summary', 'rewrite'] });
    assert.deepEqual(e.json.limits, { perMinute: 600, perDay: 100_000 });
    // a one-locale site has nothing to translate into; a promotion summary is for editors and up
    assert.deepEqual((await alice.get('/ai')).json.kinds, ['alt', 'seo', 'rewrite']);
  });

  test('alt text for an image, by each way the site writes its address', async () => {
    for (const image of ['/uploads/sky.png', 'src/assets/uploads/sky.png', 'sky.png', '/uploads/2026/sea%20view.png']) {
      const r = await suggest(alice, { kind: 'alt', image });
      assert.equal(r.status, 200, `${image}: ${r.text}`);
      assert.equal(r.json.kind, 'alt');
      assert.match(r.json.suggestion.alt, /^A photo: (sky|sea view)\.png$/);
      assert.equal(r.json.provider, 'stub');
    }
    // relative to the entry's file, as an Astro image field stores it
    const rel = await suggest(alice, { kind: 'alt', image: '../../assets/uploads/sky.png', collection: 'posts', id: 'hello-world', context: 'The header image.' });
    assert.equal(rel.status, 200, rel.text);
    assert.deepEqual(rel.json.suggestion, { alt: 'A photo: sky.png' });
  });

  test('an image outside the media folder, through a link, or not an image is refused', async () => {
    for (const image of ['../../secret.txt', '/uploads/../../../secret.txt', 'link.png', 'missing.png', '/etc/passwd', 'src/content/blog/hello-world.md']) {
      const r = await suggest(alice, { kind: 'alt', image });
      assert.equal(r.status, 404, `${image}: ${r.text}`);
      assert.doesNotMatch(r.text, /not content/);
    }
    const t = await suggest(alice, { kind: 'alt', image: 'notes.png' });
    assert.equal(t.status, 422);
    assert.equal(t.json.error, 'image-type');
    assert.equal((await suggest(alice, { kind: 'alt' })).status, 422);
  });

  test('the readable rule: drafts are for their author and editors; another is "not available"', async () => {
    const live = await suggest(carol, { kind: 'seo', collection: 'posts', id: 'hello-world' });
    assert.equal(live.status, 200, live.text);
    assert.deepEqual(live.json.suggestion, { title: 'Hello World | stub', description: 'Stub description of Hello World.' });
    // carol's own draft, not bob's; an editor may ask for either
    assert.equal((await suggest(carol, { kind: 'seo', collection: 'posts', id: 'carol-draft' })).status, 200);
    const bobs = await suggest(alice, { kind: 'seo', collection: 'posts', id: 'bob-draft' });
    assert.equal(bobs.status, 404);
    assert.match(bobs.json.message, /not available to you/);
    assert.equal((await suggest(alice, { kind: 'alt', image: 'sky.png', collection: 'posts', id: 'bob-draft' })).status, 404);
    assert.equal((await suggest(ed, { kind: 'seo', collection: 'posts', id: 'bob-draft' })).status, 200);
    assert.equal((await suggest(alice, { kind: 'seo', collection: 'nope', id: 'x' })).status, 404);
    assert.equal((await suggest(alice, { kind: 'seo' })).status, 422);
  });

  test('a promotion summary is for editors and up, from the plan’s facts', async () => {
    const id = addPlan(srv.app);
    const no = await suggest(alice, { kind: 'summary', plan: id });
    assert.equal(no.status, 403);
    const yes = await suggest(ed, { kind: 'summary', plan: id });
    assert.equal(yes.status, 200, yes.text);
    assert.deepEqual(yes.json.suggestion, { text: 'Stub summary: 2 files.' });
    assert.equal((await suggest(ed, { kind: 'summary', plan: 'pl_missing' })).status, 404);
    const early = await suggest(ed, { kind: 'summary', plan: addPlan(srv.app, { files: false }) });
    assert.equal(early.status, 422);
    assert.equal(early.json.error, 'plan-not-ready');
  });

  test('rewrite: each mode on a selection, the readable rule, its size cap, one paragraph back for one', async () => {
    const ask = (who, mode, text, id = 'hello-world') => suggest(who, { kind: 'rewrite', collection: 'posts', id, mode, text });
    const cases = [
      ['fix', 'I recieve alot of  mail from teh harbour.', 'I receive a lot of mail from the harbour.'],
      ['shorten', 'We really just walked in order to see the boats.', 'We walked to see the boats.'],
      ['rewrite', 'The boats came in.', 'The boats came in, put more plainly.'],
      ['tone:formal', "We don't stop, it's early.", 'We do not stop, it is early.'],
      ['tone:confident', 'I think maybe the harbour is busy.', 'the harbour is busy.'],
      ['tone:friendly', 'The harbour opens at nine.', 'Good news: the harbour opens at nine.'],
    ];
    for (const [mode, text, want] of cases) {
      const r = await ask(alice, mode, text);
      assert.equal(r.status, 200, `${mode}: ${r.text}`);
      assert.deepEqual([r.json.kind, r.json.suggestion], ['rewrite', { text: want }], mode);
    }
    // the readable rule: carol's own draft, not bob's
    assert.equal((await ask(carol, 'fix', 'Carol writes.', 'carol-draft')).status, 200);
    assert.equal((await ask(alice, 'fix', 'A draft.', 'bob-draft')).status, 404);
    // a mode, a selection and the entry are needed; 4,000 characters at most
    for (const bad of [{ mode: 'poem', text: 'x' }, { mode: 'tone:angry', text: 'x' }, { mode: 'fix', text: '   ' }, { mode: 'fix' }, { mode: 'fix', text: 7 }]) assert.equal((await suggest(alice, { kind: 'rewrite', collection: 'posts', id: 'hello-world', ...bad })).status, 422, JSON.stringify(bad));
    assert.equal((await suggest(alice, { kind: 'rewrite', mode: 'fix', text: 'x' })).status, 422);
    const big = await ask(alice, 'fix', 'y'.repeat(4001));
    assert.deepEqual([big.status, big.json.field, big.json.max], [413, 'text', 4000]);
    assert.equal((await ask(alice, 'fix', 'y'.repeat(4000))).status, 200);
    const row = audits('ai.suggest').at(-1);
    assert.deepEqual([row.target, JSON.parse(row.detail).kind], ['posts/hello-world', 'rewrite']);
  });

  test('sizes are capped, naming the field; a wrong kind or body is refused', async () => {
    const big = await suggest(alice, { kind: 'alt', image: 'sky.png', context: 'x'.repeat(2001) });
    assert.equal(big.status, 413);
    assert.deepEqual([big.json.error, big.json.field, big.json.max], ['too-large', 'context', 2000]);
    const text = await suggest(alice, { kind: 'seo', collection: 'posts', id: 'hello-world', text: 'y'.repeat(20_001) });
    assert.deepEqual([text.status, text.json.field], [413, 'text']);
    assert.equal((await suggest(alice, { kind: 'seo', collection: 'posts', id: 'hello-world', text: 'y'.repeat(20_000) })).status, 200);
    assert.equal((await suggest(alice, { kind: 'poem' })).status, 422);
    assert.equal((await suggest(alice, { kind: 'alt', image: 'sky.png', context: 5 })).status, 422);
  });

  test('a provider failure is words; a busy provider is 429 with Retry-After', async () => {
    const fail = await suggest(alice, { kind: 'alt', image: 'sky.png', context: 'STUB-FAIL' });
    assert.equal(fail.status, 502);
    assert.equal(fail.json.error, 'ai-failed');
    const busy = await suggest(alice, { kind: 'alt', image: 'sky.png', context: 'STUB-RATE' });
    assert.equal(busy.status, 429);
    assert.equal(busy.headers.get('retry-after'), '30');
    const rows = audits('ai.suggest').slice(-2);
    assert.deepEqual(rows.map((r) => [r.ok, JSON.parse(r.detail).error]), [[0, 'ai-failed'], [0, 'ai-rate']]);
  });

  test('the audit says who, what kind, which entry and the token counts, never the prompt or the answer', async () => {
    const marker = `marker-${crypto.randomBytes(6).toString('hex')}`;
    const r = await suggest(alice, { kind: 'seo', collection: 'posts', id: 'hello-world', title: `Title ${marker}`, text: `Body ${marker}` });
    assert.equal(r.status, 200);
    assert.match(r.json.suggestion.title, new RegExp(marker));
    const row = audits('ai.suggest').at(-1);
    assert.equal(row.user_id, alice.user.id);
    assert.equal(row.target, 'posts/hello-world');
    assert.equal(row.ok, 1);
    const d = JSON.parse(row.detail);
    assert.deepEqual(Object.keys(d).sort(), ['inputTokens', 'kind', 'model', 'outputTokens', 'provider']);
    assert.equal(d.kind, 'seo');
    assert.ok(d.inputTokens > 0 && d.outputTokens > 0);
    const all = JSON.stringify(srv.app.db.prepare('SELECT * FROM audit').all());
    assert.doesNotMatch(all, new RegExp(marker));
    assert.doesNotMatch(all, /Stub description/);
  });

  test('asking commits nothing: no new commit, no changed file', async () => {
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head0);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
  });

  test('only a session asks: no sign-in is 401, an agent’s token is refused', async () => {
    const anon = await fetch(`${srv.base}/markstage/api/ai`);
    assert.equal(anon.status, 401);
    // an AI assistant's token and the command line's
    for (const scopes of [['mcp:draft'], ['env:read']]) {
      const secret = await mcpToken(ed, scopes);
      for (const [method, p] of [['GET', '/ai'], ['POST', '/ai/suggest']]) {
        const r = await fetch(`${srv.base}/markstage/api${p}`, { method, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ kind: 'alt', image: 'sky.png' }) : undefined });
        assert.equal(r.status, 403, `${scopes} ${p}`);
      }
    }
  });
});

describe('AI suggestions: the per-person limits', () => {
  let fx, srv, clock, a, b;
  const ask = (who) => suggest(who, { kind: 'seo', collection: 'posts', id: 'hello-world' });
  before(async () => {
    fx = makeFixture({ checks: false });
    clock = { now: Date.parse('2026-10-29T09:00:00.000Z') };
    srv = await startServer(fx, { overrides: { ai: { provider: 'stub', perMinute: 2, perDay: 3 } }, clock });
    a = await as(srv, 'editor');
    b = await as(srv, 'editor');
  });
  after(() => srv?.close());

  test('per minute, then per day, rolling, for each person on their own; a refusal is logged once a minute', async () => {
    assert.equal((await ask(a)).status, 200);
    assert.equal((await ask(a)).status, 200);
    const third = await ask(a);
    assert.equal(third.status, 429);
    assert.deepEqual([third.json.error, third.json.limit, third.json.max], ['ai-rate', 'minute', 2]);
    assert.ok(Number(third.headers.get('retry-after')) >= 1 && Number(third.headers.get('retry-after')) <= 60);
    assert.equal((await ask(a)).status, 429);
    // another person has their own count
    assert.equal((await ask(b)).status, 200);
    const limited = srv.app.db.prepare("SELECT * FROM audit WHERE action = 'ai.limited'").all();
    assert.equal(limited.length, 1);
    assert.equal(limited[0].user_id, a.user.id);
    clock.now += 61_000;
    assert.equal((await ask(a)).status, 200);
    clock.now += 61_000;
    const day = await ask(a);
    assert.equal(day.status, 429);
    assert.equal(day.json.limit, 'day');
    assert.match(day.json.message, /3 suggestions in the last day/);
    clock.now += 24 * 3_600_000;
    // a day on, the session has run out too: the same person signs in again
    await a.login(a.user.email, a.user.password);
    assert.equal((await ask(a)).status, 200);
  });
});

describe('AI suggestions: off in words', () => {
  let fx, srv, ed;
  before(async () => {
    fx = makeFixture({ checks: false });
    // no key in this environment: none from this machine is read
    srv = await startServer(fx, { overrides: { ai: { provider: 'anthropic' } }, ai: { env: {}, fetch: () => assert.fail('no call when off') } });
    ed = await as(srv, 'editor');
  });
  after(() => srv?.close());

  test('GET /ai says why; a suggestion is 503 with the variable to set', async () => {
    const g = await ed.get('/ai');
    assert.deepEqual([g.json.on, g.json.envVar, g.json.model], [false, 'MARKSTAGE_AI_KEY', 'claude-sonnet-5-5']);
    assert.equal(g.json.why, 'AI suggestions are off: MARKSTAGE_AI_KEY is not set on the server and there is no ai.keyFile.');
    const r = await suggest(ed, { kind: 'seo', collection: 'posts', id: 'hello-world' });
    assert.equal(r.status, 503);
    assert.deepEqual([r.json.error, r.json.envVar, r.json.message], ['ai-off', 'MARKSTAGE_AI_KEY', g.json.why]);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action LIKE 'ai.%'").get().n, 0);
  });
});
