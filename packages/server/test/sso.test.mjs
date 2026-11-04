// Single sign-on through OpenID Connect (docs/API-SSO.md), against a provider on loopback reached through the test
// seam only: the state bound to the browser, PKCE, the ID token's signature and claims, who may get in (a link, a
// verified email, a domain), two-step sign-in still asked, and the password kept for the owner. Test people, client
// secrets and keys are made up here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { totpAt, stepAt } from '../src/auth/totp.mjs';
import { addUser, as, client, makeFixture, startServer } from './helpers.mjs';
import { createScrub, HIDDEN } from '../src/mcp/answer.mjs';
import { fakeOidc } from './fake-oidc.mjs';

const secrets = { 'markstage-test': crypto.randomBytes(16).toString('hex'), 'markstage-corp': crypto.randomBytes(16).toString('hex') };
const ENV = { MARKSTAGE_SSO_TEST_SECRET: secrets['markstage-test'], MARKSTAGE_SSO_CORP_SECRET: secrets['markstage-corp'] };

const ssoConfig = (idp, extra = {}) => ({
  providers: [
    { id: 'test', label: 'Test IdP', issuer: idp.issuer, clientId: 'markstage-test' },
    { id: 'corp', label: 'Corp', issuer: idp.issuer, clientId: 'markstage-corp', domains: ['corp.test'], autoCreate: { role: 'author' } },
  ],
  ...extra,
});

/** A browser signing in: start, the provider's page, the callback. Returns where it lands and the browser. */
async function signIn(srv, idp, claims, { provider = 'test', next = '#/pages', browser = client(srv.base), tamper = null } = {}) {
  const start = await browser.get(`/auth/sso/${provider}/start?next=${encodeURIComponent(next)}`);
  assert.equal(start.status, 302, start.text);
  const at = idp.authorize(start.headers.get('location'), claims);
  idp.tamper = tamper;
  const cb = await browser.get(`${at.redirectUri}?code=${at.code}&state=${at.state}`);
  assert.equal(cb.status, 302);
  return { location: cb.headers.get('location'), browser, start, at };
}

describe('single sign-on', () => {
  let srv, idp, admin, invited, fx;
  before(async () => {
    Object.assign(process.env, ENV);
    idp = await fakeOidc({ clients: secrets });
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { env: ENV, outbound: idp.site.outbound, overrides: { sso: ssoConfig(idp) } });
    admin = await as(srv, 'administrator');
    invited = await addUser(srv.app, { email: 'dana@example.test', role: 'editor' });
  });
  after(async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    await srv?.close();
    await idp?.close();
  });

  test('the sign-in screen lists the providers', async () => {
    const r = await client(srv.base).get('/auth/sso');
    assert.deepEqual(r.json, { providers: [{ id: 'test', label: 'Test IdP' }, { id: 'corp', label: 'Corp' }], passwordLogin: true });
  });

  test('an invited person: found by their verified email, linked, signed in, landing where they were going', async () => {
    const { location, browser, start, at } = await signIn(srv, idp, { sub: 'idp-dana', email: 'Dana@Example.test', email_verified: true });
    assert.equal(location, '/markstage/#/pages');
    // the start: state, nonce and PKCE S256, the state in a Lax cookie for the provider's redirect back
    assert.deepEqual([at.query.response_type, at.query.code_challenge_method, at.query.scope], ['code', 'S256', 'openid email profile']);
    assert.match(start.headers.get('set-cookie'), /__Host-markstage-sso=[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
    assert.equal(idp.tokenCalls.at(-1).client_secret, secrets['markstage-test']);
    const me = (await browser.get('/auth/me')).json;
    assert.deepEqual([me.user.id, me.user.role], [invited.id, 'editor']);
    // next time by the provider's id for them, even when their email there changed
    const again = await signIn(srv, idp, { sub: 'idp-dana', email: 'dana.new@example.test', email_verified: true });
    assert.equal((await again.browser.get('/auth/me')).json.user.id, invited.id);
    const links = (await admin.get(`/users/${invited.id}/sso`)).json;
    assert.deepEqual(links.map((l) => [l.provider, l.label, l.email]), [['test', 'Test IdP', 'dana.new@example.test']]);
    const acts = srv.app.db.prepare("SELECT action FROM audit WHERE target = ? AND action LIKE 'auth.sso%' ORDER BY id").all(invited.id).map((a) => a.action);
    assert.deepEqual(acts, ['auth.sso.link', 'auth.sso', 'auth.sso']);
  });

  test('the state is this browser’s, once: another browser, or the same state again, is sent back to sign in', async () => {
    const mine = client(srv.base);
    const start = await mine.get('/auth/sso/test/start');
    const at = idp.authorize(start.headers.get('location'), { sub: 'idp-dana', email: 'dana@example.test', email_verified: true });
    const theirs = await client(srv.base).get(`${at.redirectUri}?code=${at.code}&state=${at.state}`);
    assert.equal(theirs.headers.get('location'), '/markstage/#/sign-in?sso=expired&provider=test');
    const ok = await signIn(srv, idp, { sub: 'idp-dana', email: 'dana@example.test', email_verified: true });
    const replay = await ok.browser.get(`${ok.at.redirectUri}?code=${ok.at.code}&state=${ok.at.state}`);
    assert.match(replay.headers.get('location'), /sso=expired/);
    assert.equal((await client(srv.base).get('/auth/sso/test/start?next=https%3A%2F%2Fevil.test%2F')).status, 302);
    const evil = await signIn(srv, idp, { sub: 'idp-dana', email: 'dana@example.test', email_verified: true }, { next: 'https://evil.test/' });
    assert.equal(evil.location, '/markstage/#/');
  });

  test('the ID token is checked: signature, algorithm, issuer, audience, nonce, expiry', async () => {
    const who = { sub: 'idp-dana', email: 'dana@example.test', email_verified: true };
    for (const [tamper, re] of [
      [{ stranger: true }, /signature is wrong/],
      [{ alg: 'none' }, /none, which is not accepted/],
      [{ alg: 'HS256' }, /HS256, which is not accepted/],
      [{ claims: { iss: 'https://other.test' } }, /another issuer/],
      [{ claims: { aud: 'someone-else' } }, /for another site/],
      [{ claims: { nonce: 'not-this-one' } }, /not for this sign-in/],
      [{ claims: { exp: Math.floor(Date.now() / 1000) - 3600 } }, /has expired/],
    ]) {
      const r = await signIn(srv, idp, who, { tamper });
      assert.equal(r.location, '/markstage/#/sign-in?sso=provider&provider=test', JSON.stringify(tamper));
      assert.equal((await r.browser.get('/auth/me')).json.user, null);
      const why = srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'auth.sso.fail' ORDER BY id DESC LIMIT 1").get().detail;
      assert.match(why, re);
    }
  });

  test('who gets in: no unverified email, no stranger, no turned-off account; a domain the provider allows may join', async () => {
    assert.match((await signIn(srv, idp, { sub: 'idp-x', email: 'dana@example.test', email_verified: false })).location, /sso=email/);
    assert.match((await signIn(srv, idp, { sub: 'idp-y', email: 'nobody@example.test', email_verified: true })).location, /sso=no-account/);
    const off = await addUser(srv.app, { email: 'off@example.test', role: 'author' });
    srv.app.users.update(off.id, { disabled: true });
    assert.match((await signIn(srv, idp, { sub: 'idp-off', email: 'off@example.test', email_verified: true })).location, /sso=disabled/);
    // corp: its domain only, and a first sign-in makes the account (author), telling the administrators
    assert.match((await signIn(srv, idp, { sub: 'c-1', email: 'eve@elsewhere.test', email_verified: true }, { provider: 'corp' })).location, /sso=domain/);
    const joined = await signIn(srv, idp, { sub: 'c-2', email: 'kim@corp.test', email_verified: true, name: 'Kim Corp' }, { provider: 'corp' });
    const me = (await joined.browser.get('/auth/me')).json.user;
    assert.deepEqual([me.email, me.name, me.role], ['kim@corp.test', 'Kim Corp', 'author']);
    assert.ok(srv.app.db.prepare("SELECT 1 FROM notices WHERE kind = 'user.invited' AND text LIKE '%signing in with Corp%'").get());
  });

  test('two-step sign-in is still asked, the challenge in a cookie, never the URL', async () => {
    const u = await addUser(srv.app, { email: 'tess@example.test', role: 'editor' });
    const secret = 'JBSWY3DPEHPK3PXP';
    srv.app.db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, u.id);
    const r = await signIn(srv, idp, { sub: 'idp-tess', email: 'tess@example.test', email_verified: true }, { next: '#/media' });
    assert.equal(r.location, '/markstage/#/sign-in?step=code&via=sso&next=%23%2Fmedia');
    assert.equal((await r.browser.get('/auth/me')).json.user, null);
    const step = await r.browser.post('/auth/login/2fa', { code: totpAt(secret, stepAt(Date.now())) });
    assert.equal(step.status, 200, step.text);
    assert.equal((await r.browser.get('/auth/me')).json.user.id, u.id);
  });

  test('a client secret is never told: from its variable or its file, scrubbed from what an agent or a log sees', () => {
    const file = path.join(fx.data, 'corp-sso-secret');
    fs.writeFileSync(file, 'file-held-sso-secret-42\n');
    const providers = [...srv.app.config.sso.providers, { id: 'file', secretEnv: 'MARKSTAGE_SSO_FILE_SECRET', clientSecretFile: file }];
    const { scrub } = createScrub({ config: { contentRoot: fx.site, sso: { providers } }, db: srv.app.db, clock: () => Date.now() }, { env: ENV });
    assert.equal(scrub(`a ${secrets['markstage-test']} b file-held-sso-secret-42 c`), `a ${HIDDEN} b ${HIDDEN} c`);
  });

  test('links: listed and undone by an administrator', async () => {
    assert.equal((await admin.del(`/users/${invited.id}/sso/test`)).status, 200);
    assert.deepEqual((await admin.get(`/users/${invited.id}/sso`)).json, []);
    assert.equal((await admin.del(`/users/${invited.id}/sso/test`)).status, 404);
  });
});

describe('single sign-on only', () => {
  let srv, idp;
  before(async () => {
    Object.assign(process.env, ENV);
    idp = await fakeOidc({ clients: secrets });
    srv = await startServer(makeFixture({ checks: false }), { env: ENV, outbound: idp.site.outbound, overrides: { sso: ssoConfig(idp, { passwordLogin: false }) } });
  });
  after(async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    await srv?.close();
    await idp?.close();
  });

  test('passwords are for the owner alone, for when the provider is down', async () => {
    const ed = await addUser(srv.app, { email: 'ed@example.test', role: 'editor' });
    const r = await client(srv.base).post('/auth/login', { email: ed.email, password: ed.password });
    assert.equal(r.status, 403);
    assert.match(r.json.message, /signs in with Test IdP or Corp/);
    await as(srv, 'owner');
    assert.equal((await client(srv.base).get('/auth/sso')).json.passwordLogin, false);
  });
});

describe('single sign-on config', () => {
  const base = { MARKSTAGE_DATA_DIR: null };
  const load = (sso, { env = {}, production = false } = {}) => {
    const fx = makeFixture({ checks: false });
    return () => loadConfig({ env: { ...base, MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: production ? 'production' : 'test', ...(production ? { MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.test' } : {}), ...env }, overrides: { sso } });
  };
  const p = { id: 'test', issuer: 'https://idp.example.test', clientId: 'x' };

  test('mistakes stop the start, in words', () => {
    assert.throws(load({ providers: [p] }), /no client secret. Set MARKSTAGE_SSO_TEST_SECRET/);
    const env = { MARKSTAGE_SSO_TEST_SECRET: 'made-up' };
    assert.throws(load({ providers: [{ ...p, clientSecret: 'abc' }] }, { env }), /keys it does not know: clientSecret/);
    assert.throws(load({ providers: [{ ...p, issuer: 'http://idp.example.test' }] }, { env }), /issuer must be https/);
    assert.throws(load({ providers: [{ ...p, autoCreate: { role: 'author' } }] }, { env }), /autoCreate needs domains/);
    assert.throws(load({ providers: [{ ...p, domains: ['corp.test'], autoCreate: { role: 'administrator' } }] }, { env }), /given their role by a person/);
    assert.throws(load({ providers: [{ ...p, scopes: ['openid'] }] }, { env }), /must include "openid" and "email"/);
    assert.equal(load({ providers: [p] }, { env })().sso.providers[0].label, 'test');
  });
});
