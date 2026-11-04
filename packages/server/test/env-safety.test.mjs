// Environments: what keeps staging safe (no mail out, "Test form: not sent", noindex, the site behind sign-in,
// branch previews), personal tokens for the laptop CLI, plans that expire, the config checks, and the AI summary
// with a stubbed model (no network: the model's answer is made up here, and dropped when it states a number the
// facts do not have).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, client } from './helpers.mjs';
import { smtpSink } from './smtp-sink.mjs';
import { ConfigError, loadConfig } from '../src/app.mjs';
import { sha256 } from '../src/util.mjs';
import { factsWords, numbersHold, summarize } from '../src/env/summary.mjs';
import { PRODUCTION, STAGING, commit, envConfig, makeEnvFixture, page, plan, sh, startEnv, waitJob } from './env-fixture.mjs';

const SITE = 'site.staging.test';
const PROD_SITE = 'site.prod.test';
// staging's form also names Odoo (forms/crm.mjs), switched on in its environment: a test form must still send nothing
const ODOO_ENV = 'MSTEST_ENVSAFETY_ODOO';
const FORMS = { contact: { label: 'Contact', fields: { name: { label: 'Name', required: true, max: 100 }, email: { label: 'Email', type: 'email', required: true }, comment: { label: 'Message', type: 'textarea', required: true } }, message: 'Thanks!', reply: { subject: 'Thank you', text: 'Hi {name}, thanks.' }, team: { subject: 'Inquiry from {name}' } } };

/** A request to a host by name (fetch cannot set Host). */
function hostRequest(port, host, p, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: host, ...headers };
    if (body !== null) h['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

describe('Environments: staging stays safe', () => {
  let fx, prod, staging, sink, pOwner, sOwner;
  const offset = { ms: 0 };
  const clock = { get now() { return Date.now() + offset.ms; } };
  const lead = { name: 'Jane', email: 'jane@client.example', comment: 'We need a hand with a migration.' };
  const formPost = (srv, host, body) => hostRequest(srv.port, host, '/markstage/forms/contact', { method: 'POST', body: new URLSearchParams(body).toString(), headers: { Origin: `https://${host}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });

  before(async () => {
    fx = makeEnvFixture();
    sink = await smtpSink();
    const notify = { email: { host: '127.0.0.1', port: sink.port, security: 'none', from: 'Sales <sales@example.test>', to: ['team@example.test'] } };
    prod = await startEnv(fx, 'production', { environment: PRODUCTION, clock, extra: { siteHosts: [PROD_SITE], forms: FORMS, notify } });
    staging = await startEnv(fx, 'staging', { environment: { ...STAGING(prod.base), previews: { branches: true, host: '{branch}.preview.test' } }, extra: { siteHosts: [SITE], forms: { contact: { ...FORMS.contact, crm: { kind: 'odoo', env: ODOO_ENV, source: 'Example Website' } } }, notify } });
    pOwner = await as(prod, 'owner');
    sOwner = await as(staging, 'owner');
    for (const [srv, c] of [[prod, pOwner], [staging, sOwner]]) assert.equal((await waitJob(srv, (await c.post('/site/publish', {})).json.job)).status, 'succeeded');
  });
  after(async () => {
    await prod?.close();
    await staging?.close();
    await sink?.close();
  });

  test('a form on staging says "Test form: not sent", is kept there, and mails nobody; production mails as before', async () => {
    const before = sink.messages.length;
    // Odoo switched on, at an address where nothing answers: it must not even be tried
    Object.assign(process.env, { [`${ODOO_ENV}_ENABLE`]: 'true', [`${ODOO_ENV}_URL`]: 'http://127.0.0.1:9', [`${ODOO_ENV}_DB`]: 'd', [`${ODOO_ENV}_EMAIL`]: 'e@example.test', [`${ODOO_ENV}_PASSWORD`]: 'not-a-real-one' });
    let r;
    try {
      r = await formPost(staging, SITE, lead);
    } finally {
      for (const k of ['ENABLE', 'URL', 'DB', 'EMAIL', 'PASSWORD']) delete process.env[`${ODOO_ENV}_${k}`];
    }
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
    const body = JSON.parse(r.text);
    assert.equal(body.test, true);
    assert.match(body.message, /^Test form: not sent\./);
    const row = staging.app.db.prepare('SELECT * FROM form_messages').get();
    assert.equal(row.alert, 'none');
    assert.equal(row.crm, null, 'not for Odoo outside production');
    assert.deepEqual(staging.app.db.prepare('SELECT change FROM form_events WHERE message_id = ? ORDER BY id').all(row.id).map((e) => e.change), ['sent from the site', 'a test form on staging: nobody was mailed']);
    assert.equal(staging.app.db.prepare("SELECT COUNT(*) AS n FROM notices WHERE kind = 'form.message'").get().n > 0, true, 'the editor still shows it');
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(sink.messages.length, before, 'no mail left staging');

    const p = await formPost(prod, PROD_SITE, lead);
    assert.equal(JSON.parse(p.text).message, 'Thanks!');
    const end = Date.now() + 5000;
    while (sink.messages.length < before + 2 && Date.now() < end) await new Promise((res) => setTimeout(res, 25));
    assert.deepEqual(sink.messages.slice(before).map((m) => m.to.join()).sort(), ['jane@client.example', 'team@example.test']);
  });

  test("staging's test alert goes to the person who sent it only", async () => {
    const before = sink.messages.length;
    const r = await sOwner.post('/site/notify/test', { channel: 'email' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(sink.messages.slice(before).map((m) => m.to), [[sOwner.user.email.toLowerCase()]]);
  });

  test('the staging site is behind sign-in: a one-time ticket from the CMS, then a cookie for that host', async () => {
    const away = await hostRequest(staging.port, SITE, '/about/');
    assert.equal(away.status, 303);
    assert.equal(away.headers.location, `${staging.base}/markstage/gate?host=${SITE}&to=%2Fabout%2F`);
    assert.equal(away.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal((await hostRequest(staging.port, SITE, '/markstage/gate-auth')).status, 401);
    assert.equal((await fetch(`${staging.base}/markstage/gate?host=${SITE}&to=/about/`)).status, 401, 'not signed in');
    assert.equal((await sOwner.get(`${staging.base}/markstage/gate?host=evil.test&to=/`)).status, 400);
    // `to` is a path of this site only: `//host`, `/\host` (a browser reads it as `//host`), a scheme, control characters are refused
    for (const bad of ['//evil.example/', '/\\evil.example/', '%2F%5Cevil.example', 'https://evil.example/', '/about/%0D%0ASet-Cookie:x', 'about/']) assert.equal((await sOwner.get(`${staging.base}/markstage/gate?host=${SITE}&to=${bad}`)).status, 400, `to=${bad}`);
    // a ticket row that somehow holds a bad path sends the browser home, never away
    // (a ticket names the CMS session it was made in: <sessionId>.<random>)
    const sid = staging.app.db.prepare('SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC').get(sOwner.user.id).id;
    staging.app.db.prepare('INSERT INTO env_gate_tickets (ticket_hash, user_id, host, to_path, expires_at) VALUES (?, ?, ?, ?, ?)').run(sha256(`${sid}.badpath-ticket`), sOwner.user.id, SITE, '/\\evil.example/', Date.now() + 60_000);
    const badPath = await hostRequest(staging.port, SITE, '/markstage/gate-enter', { method: 'POST', body: `ticket=${sid}.badpath-ticket`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.deepEqual([badPath.status, badPath.headers.location], [303, '/']);
    const g = await sOwner.get(`${staging.base}/markstage/gate?host=${SITE}&to=/about/`);
    assert.equal(g.status, 200);
    const ticket = /name="ticket" value="([^"]+)"/.exec(g.text)[1];
    // the site's own host is https (a loopback host would be http)
    assert.match(g.text, new RegExp(`action="https://${SITE.replace(/\./g, '\\.')}/markstage/gate-enter"`));
    const enter = await hostRequest(staging.port, SITE, '/markstage/gate-enter', { method: 'POST', body: `ticket=${ticket}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(enter.status, 303);
    assert.equal(enter.headers.location, '/about/');
    const cookie = enter.headers['set-cookie'][0].split(';')[0];
    assert.equal((await hostRequest(staging.port, SITE, '/markstage/gate-enter', { method: 'POST', body: `ticket=${ticket}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 403, 'a ticket works once');
    const pg = await hostRequest(staging.port, SITE, '/about/', { headers: { Cookie: cookie } });
    assert.equal(pg.status, 200);
    assert.match(pg.text, /We are here/);
    assert.equal(pg.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal((await hostRequest(staging.port, SITE, '/markstage/gate-auth', { headers: { Cookie: cookie } })).status, 204);
    assert.equal((await hostRequest(staging.port, SITE, '/../../etc/passwd', { headers: { Cookie: cookie } })).status, 404);
    // a symlink in the build that points out of it (a branch can add one to public/) is not served (S5): a file and
    // a folder, outside the build; a link that stays inside the build still is
    const pub = staging.config.verify.public;
    const outside = path.join(fx.run ?? path.dirname(path.dirname(pub)), `outside-${Date.now()}`);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET OUTSIDE THE BUILD');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(pub, 'leak.txt'));
    fs.symlinkSync(outside, path.join(pub, 'leakdir'));
    fs.symlinkSync(path.join(pub, 'about', 'index.html'), path.join(pub, 'alias.html'));
    for (const p of ['/leak.txt', '/leakdir/secret.txt']) {
      const r = await hostRequest(staging.port, SITE, p, { headers: { Cookie: cookie } });
      assert.equal(r.status, 404, p);
      assert.doesNotMatch(r.text, /SECRET/, p);
    }
    assert.match((await hostRequest(staging.port, SITE, '/alias.html', { headers: { Cookie: cookie } })).text, /We are here/, 'a link inside the build');
    for (const f of ['leak.txt', 'leakdir', 'alias.html']) fs.unlinkSync(path.join(pub, f));
    const forged = cookie.replace(/\.[^.]+$/, '.AAAA');
    assert.equal((await hostRequest(staging.port, SITE, '/about/', { headers: { Cookie: forged } })).status, 303);
    // the cookie dies with the CMS session it was opened from (S11): signing out of the CMS closes the site too
    const who = await as(staging, 'editor');
    const g2 = await who.get(`${staging.base}/markstage/gate?host=${SITE}&to=/about/`);
    const t2 = /name="ticket" value="([^"]+)"/.exec(g2.text)[1];
    const e2 = await hostRequest(staging.port, SITE, '/markstage/gate-enter', { method: 'POST', body: `ticket=${encodeURIComponent(t2)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const c2 = e2.headers['set-cookie'][0].split(';')[0];
    assert.equal((await hostRequest(staging.port, SITE, '/about/', { headers: { Cookie: c2 } })).status, 200);
    assert.equal((await who.post('/auth/logout', {})).status, 200);
    assert.equal((await hostRequest(staging.port, SITE, '/about/', { headers: { Cookie: c2 } })).status, 303, 'signed out of the CMS: the site asks again');
    assert.equal((await hostRequest(staging.port, SITE, '/markstage/gate-auth', { headers: { Cookie: c2 } })).status, 401);
    // production has no gate: its site host answers forms only
    assert.equal((await hostRequest(prod.port, PROD_SITE, '/about/')).status, 404);
  });

  test('a branch preview is built at <branch>.preview.test, behind the same sign-in', async () => {
    sh(fx.laptop, 'checkout', '-q', '-b', 'feature/new-hero');
    commit(fx.laptop, { 'src/content/pages/home.json': page('Home', '/', 'A brand new hero') }, 'New hero', { push: 'feature/new-hero' });
    const r = await sOwner.post('/env/previews', { branch: 'feature/new-hero' });
    assert.equal(r.status, 202, JSON.stringify(r.json));
    assert.equal(r.json.preview.slug, 'feature-new-hero');
    assert.equal(r.json.preview.url, 'https://feature-new-hero.preview.test/');
    assert.equal((await waitJob(staging, r.json.job)).status, 'succeeded');
    const host = 'feature-new-hero.preview.test';
    const g = await sOwner.get(`${staging.base}/markstage/gate?host=${host}&to=/`);
    const ticket = /name="ticket" value="([^"]+)"/.exec(g.text)[1];
    const enter = await hostRequest(staging.port, host, '/markstage/gate-enter', { method: 'POST', body: `ticket=${ticket}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const cookie = enter.headers['set-cookie'][0].split(';')[0];
    const pg = await hostRequest(staging.port, host, '/', { headers: { Cookie: cookie } });
    assert.match(pg.text, /A brand new hero/);
    assert.equal((await hostRequest(staging.port, 'other.preview.test', '/', { headers: { Cookie: cookie } })).status, 303, 'a cookie is for its own host');
    assert.equal((await sOwner.get('/env/previews')).json.previews[0].status, 'ready');
    assert.equal((await sOwner.del('/env/previews/feature-new-hero')).status, 200);
    assert.equal((await hostRequest(staging.port, host, '/', { headers: { Cookie: cookie } })).status, 404);
    const contributor = await as(staging, 'contributor');
    assert.equal((await contributor.post('/env/previews', { branch: 'feature/new-hero' })).status, 403, 'the rules say who previews');
  });

  test('personal tokens: env routes only, scoped, 90 days at most, revocable, and wrong ones are rate limited', async () => {
    assert.equal((await pOwner.post('/me/tokens', { name: 'Laptop', scopes: ['env:read'], days: 91 })).status, 400);
    const junk = await pOwner.post('/me/tokens', { name: {}, scopes: ['env:read'] });
    assert.equal(junk.status, 400, 'a name is text, never "[object Object]" (QA F17)');
    const made = await pOwner.post('/me/tokens', { name: 'Laptop', scopes: ['env:read'] });
    assert.equal(made.status, 201);
    assert.match(made.json.secret, /^mst_/);
    assert.equal(made.json.token.status, 'active');
    const row = prod.app.db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(made.json.token.id);
    assert.notEqual(row.token_hash, made.json.secret, 'only a hash is kept');
    const t = client(prod.base, { origin: null });
    const auth = { headers: { Authorization: `Bearer ${made.json.secret}` } };
    const env = await t.get('/env', auth);
    assert.equal(env.status, 200);
    assert.equal(env.json.name, 'production');
    assert.ok(prod.app.db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(made.json.token.id).last_used_at);
    assert.equal((await t.get('/users', auth)).status, 403, 'a token reaches /env only');
    assert.equal((await t.get('/me/tokens', auth)).status, 403);
    assert.equal((await t.post('/env/plans', { action: 'promote', source: 'staging' }, auth)).status, 403, 'env:read cannot write');
    assert.equal((await pOwner.del(`/me/tokens/${made.json.token.id}`)).json.token.status, 'revoked');
    const gone = await t.get('/env', auth);
    assert.equal(gone.status, 401);
    assert.match(gone.json.message, /revoked/);

    // a token that starts a promotion, revoked while it builds: the rest of the job stops, production is unchanged
    commit(fx.stagingSite, { 'src/content/pages/news.json': page('News', '/news/', 'News') }, 'A news page');
    await waitJob(staging, (await sOwner.post('/site/publish', {})).json.job);
    const p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(p.status, 'ready');
    const promo = await pOwner.post('/me/tokens', { name: 'CI', scopes: ['env:read', 'env:promote'], days: 1 });
    const head = sh(fx.prodSite, 'rev-parse', 'HEAD');
    fs.writeFileSync(`${fx.fail}.slow`, '1500');
    try {
      const run = await t.post(`/env/plans/${p.id}/run`, { version: p.version }, { headers: { Authorization: `Bearer ${promo.json.secret}` } });
      assert.equal(run.status, 202, JSON.stringify(run.json));
      await new Promise((res) => setTimeout(res, 300));
      await pOwner.del(`/me/tokens/${promo.json.token.id}`);
      const j = await waitJob(prod, run.json.job);
      assert.equal(j.status, 'failed');
      assert.match(j.error, /the token that started it was revoked/);
    } finally {
      fs.rmSync(`${fx.fail}.slow`, { force: true });
    }
    assert.equal(sh(fx.prodSite, 'rev-parse', 'HEAD'), head);
    assert.equal(fs.existsSync(path.join(fx.prodLive, 'news')), false);

    prod.app.tokens.reset();
    for (let i = 0; i < 20; i++) assert.equal((await t.get('/env', { headers: { Authorization: 'Bearer mst_wrong' } })).status, 401);
    const limited = await t.get('/env', { headers: { Authorization: 'Bearer mst_wrong' } });
    assert.equal(limited.status, 429);
    assert.ok(prod.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'security.token' AND ok = 0").get().n >= 20);
    prod.app.tokens.reset();
  });

  test('a plan not run within 7 days expires and cannot run', async () => {
    commit(fx.stagingSite, { 'src/content/pages/blog.json': page('Blog', '/blog/', 'Blog') }, 'A blog page');
    await waitJob(staging, (await sOwner.post('/site/publish', {})).json.job);
    const p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(p.status, 'ready');
    offset.ms = 8 * 86_400_000;
    try {
      const c = await as(prod, 'owner');
      const now = (await c.get(`/env/plans/${p.id}`)).json;
      assert.equal(now.status, 'expired');
      assert.match(now.note, /Not run within 7 days/);
      assert.equal((await c.post(`/env/plans/${p.id}/run`, { version: now.version })).status, 409);
    } finally {
      offset.ms = 0;
    }
  });
});

describe('Environments: config', () => {
  const fx = makeEnvFixture();
  const load = (environment, extra = {}) => {
    fs.writeFileSync(path.join(fx.prodData, 'config.json'), JSON.stringify(envConfig(fx, 'production', { environment, extra })));
    return loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.prodData, NODE_ENV: 'test' } });
  };
  const refuses = (environment, re, extra) => assert.throws(() => load(environment, extra), (e) => e instanceof ConfigError && re.test(e.message));

  test('no environment is production; a bad one is refused in words', () => {
    const c = load(undefined);
    assert.equal(c.environment.name, 'production');
    assert.equal(c.environment.production, true);
    refuses({ name: 'Staging!', branch: 'staging' }, /environment.name must be a short lowercase name/);
    refuses({ name: 'staging', branch: '-x' }, /environment.branch must be the git branch/);
    refuses({ name: 'staging', branch: 'staging', promoteTo: 'production' }, /must be listed in environment.peers/);
    refuses({ name: 'production', branch: 'main', previews: { host: '{branch}.x.test' } }, /Branch previews belong on staging/);
    refuses({ name: 'staging', branch: 'staging', mail: 'everyone' }, /environment.mail is "sink"/);
    refuses({ name: 'staging', branch: 'staging', mail: 'sink' }, /notify.email.host must be a mail catcher on this machine/, { notify: { email: { host: 'smtp.example.com', port: 587, from: 'a@example.test', to: ['b@example.test'] } } });
    refuses({ name: 'staging', branch: 'staging', colour: 'x' }, /keys it does not know: colour/);
  });

  test('outside production the CDN purge, IndexNow, Slack and the webhook are off unless kept', () => {
    const extra = { purge: { command: ['true'] }, indexNow: { key: 'a'.repeat(32), endpoint: 'http://127.0.0.1:9/x' }, notify: { slack: 'http://127.0.0.1:9/s', webhook: 'http://127.0.0.1:9/w' } };
    const s = load({ name: 'staging', branch: 'staging' }, extra);
    assert.deepEqual([s.purge, s.indexNow, s.notify.slack, s.notify.webhook], [null, null, null, null]);
    const k = load({ name: 'staging', branch: 'staging', keep: ['purge', 'webhook'] }, extra);
    assert.ok(k.purge);
    assert.equal(k.notify.webhook, 'http://127.0.0.1:9/w');
    assert.equal(k.notify.slack, null);
    const p = load(undefined, extra);
    assert.ok(p.purge && p.indexNow && p.notify.slack);
  });

  test('ai takes a key file outside the repo, never the key in config', () => {
    assert.throws(() => load(undefined, { ai: { key: 'sk-x' } }), /never the key itself/);
    assert.throws(() => load(undefined, { ai: { keyFile: path.join(fx.prodSite, 'k') } }), /outside the content repo/);
    assert.throws(() => load(undefined, { ai: { model: 'gpt-4' } }), /Claude model id/);
    const c = load(undefined, { ai: { keyFile: path.join(fx.run, 'ai.key') } });
    assert.deepEqual([c.ai.model, c.ai.endpoint, c.ai.perMinute, c.ai.perDay], ['claude-sonnet-5-5', 'https://api.anthropic.com/v1/messages', 10, 200]);
  });
});

describe('Environments: the summary', () => {
  const plan = {
    action: 'promote',
    from: { env: 'staging' },
    to: { env: 'production' },
    files: { list: [{ path: 'src/layouts/page.html', status: 'changed', group: 'templates' }, { path: 'src/layouts/post.html', status: 'changed', group: 'templates' }, { path: 'src/layouts/blog.html', status: 'changed', group: 'templates' }, { path: 'src/content/pages/old.json', status: 'removed', group: 'pages' }], autoMerged: [] },
    conflicts: [],
    checks: [{ id: 'build', label: 'The site builds', status: 'passed', blocking: true }, { id: 'redirects', label: 'Removed pages have a redirect', status: 'failed', blocking: true }],
    pages: { changed: Array.from({ length: 41 }, (_, i) => `/p${i}/`), added: [], removed: ['/old/'], removedWithoutRedirect: ['/old/'] },
  };
  const config = (ai) => ({ ai: ai && { provider: 'anthropic', model: 'claude-haiku-5-5', keyFile: null, endpoint: 'https://api.anthropic.com/v1/messages', timeoutSeconds: 5 } });
  const stub = (text, { status = 200, stop = 'end_turn', seen = [] } = {}) => async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(status === 200 ? { content: [{ type: 'text', text }], stop_reason: stop } : { error: { type: 'overloaded_error' } }), { status });
  };

  test('the facts in plain words come first and always', async () => {
    const s = await summarize(config(false), plan);
    assert.equal(s.status, 'facts');
    assert.equal(s.text, '3 templates, 1 content file changed; 1 file removed; 41 pages look different; 1 page removed, 1 without a redirect (blocked); failed: Removed pages have a redirect.');
    assert.equal(factsWords({ ...s.facts, groups: {} }).startsWith('No files change'), true);
  });

  test('without a key: the facts, the reason, and no error', async () => {
    const s = await summarize(config(true), plan, { env: {}, fetch: () => assert.fail('no call without a key') });
    assert.equal(s.status, 'facts');
    assert.match(s.ai.why, /no key is set/);
  });

  test('the model gets the facts and the file list only, and its words are used when every number is in the facts', async () => {
    const seen = [];
    const words = 'This change is blocked: 1 page was removed without a redirect. It changes 3 templates, and 41 pages look different.';
    const s = await summarize(config(true), plan, { env: { MARKSTAGE_AI_KEY: 'test-key' }, fetch: stub(words, { seen }) });
    assert.equal(s.status, 'ai');
    assert.equal(s.text, words);
    assert.equal(s.words, factsWords(s.facts), 'the facts words are kept beside it');
    const req = JSON.parse(seen[0].init.body);
    assert.equal(seen[0].init.headers['x-api-key'], 'test-key');
    assert.equal(seen[0].init.headers['anthropic-version'], '2026-10-21');
    assert.equal(req.model, 'claude-haiku-5-5');
    assert.match(req.system, /Do not add anything that is not in them/);
    assert.match(req.messages[0].content, /templates src\/layouts\/page\.html/);
    assert.equal('temperature' in req, false);
  });

  test('a number the facts do not have drops the AI text; so do a refusal and an error', async () => {
    const env = { MARKSTAGE_AI_KEY: 'test-key' };
    const s = await summarize(config(true), plan, { env, fetch: stub('About 40 pages change and 3 templates.') });
    assert.equal(s.status, 'dropped');
    assert.equal(s.text, s.words);
    assert.match(s.ai.why, /numbers the facts do not have \(40\)/);
    assert.equal((await summarize(config(true), plan, { env, fetch: stub('', { stop: 'refusal' }) })).status, 'facts');
    const e = await summarize(config(true), plan, { env, fetch: stub('', { status: 529 }) });
    assert.equal(e.status, 'facts');
    assert.match(e.ai.why, /answered 529 \(overloaded_error\)/);
    assert.deepEqual(numbersHold('3 and 41', { a: 3, b: [41] }), { ok: true, stray: [] });
  });
});
