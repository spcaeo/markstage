// Sign-in, sessions, CSRF/Origin/Host checks, rate limits, lockout, 2FA, invites, users and roles management.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { issueOwnerCode, issueResetCode } from '../src/auth/routes.mjs';
import { totpAt, stepAt } from '../src/auth/totp.mjs';
import { addUser, as, client, makeFixture, startServer, testPassword } from './helpers.mjs';

describe('first owner and sign-in', () => {
  let fx;
  let srv;
  before(async () => {
    fx = makeFixture();
    srv = await startServer(fx);
  });
  after(() => srv.close());

  test('a fresh server has no users and no default password', async () => {
    const c = client(srv.base);
    const me = await c.get('/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user, null);
    assert.equal(me.json.setupRequired, true);
    for (const [email, password] of [['admin@example.test', 'admin'], ['owner@example.test', 'password'], ['admin', 'admin']]) {
      const r = await c.post('/auth/login', { email, password });
      assert.equal(r.status, 401);
    }
    assert.equal((await c.get('/collections')).status, 401);
  });

  test('setup needs the one-time CLI code; the code works once', async () => {
    const c = client(srv.base);
    const password = testPassword();
    const bad = await c.post('/auth/setup', { setupCode: 'AAAA-BBBB-CCCC-DDDD', email: 'owner@example.test', name: 'Owner', password });
    assert.equal(bad.status, 401);
    const code = issueOwnerCode(srv.app);
    const weak = await c.post('/auth/setup', { setupCode: code, email: 'owner@example.test', name: 'Owner', password: 'short' });
    assert.equal(weak.status, 422);
    const ok = await c.post('/auth/setup', { setupCode: code.toLowerCase().replace(/-/g, ' '), email: 'owner@example.test', name: 'Owner', password });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.user.role, 'owner');
    assert.ok(ok.json.csrfToken);
    const again = await client(srv.base).post('/auth/setup', { setupCode: code, email: 'x@example.test', name: 'X', password });
    assert.equal(again.status, 409);
    assert.throws(() => issueOwnerCode(srv.app), /already has an owner/);
    srv.ownerPassword = password;
  });

  test('session cookie is __Host-, HttpOnly, Secure, SameSite=Strict, and rotates at sign-in', async () => {
    const c = client(srv.base);
    const r1 = await c.login('owner@example.test', srv.ownerPassword);
    const sc = r1.res.headers.getSetCookie()[0];
    assert.match(sc, /^__Host-markstage=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(sc.includes(flag), flag);
    assert.ok(!/Domain=/i.test(sc));
    const first = c.cookies.get('__Host-markstage');
    const csrf1 = c.csrf;
    await c.login('owner@example.test', srv.ownerPassword);
    assert.notEqual(c.cookies.get('__Host-markstage'), first);
    assert.notEqual(c.csrf, csrf1);
    // the old cookie was revoked by the rotation
    const old = client(srv.base);
    old.cookies.set('__Host-markstage', first);
    assert.equal((await old.get('/auth/me')).json.user, null);
  });

  test('wrong password and unknown email get the same answer', async () => {
    const c = client(srv.base);
    const a = await c.post('/auth/login', { email: 'owner@example.test', password: 'Wrong-password-123' });
    const b = await c.post('/auth/login', { email: 'nobody@example.test', password: 'Wrong-password-123' });
    assert.equal(a.status, 401);
    assert.deepEqual(a.json, b.json);
  });

  test('logout revokes the session server-side', async () => {
    const c = client(srv.base);
    await c.login('owner@example.test', srv.ownerPassword);
    const token = c.cookies.get('__Host-markstage');
    assert.equal((await c.post('/auth/logout', {})).status, 200);
    const replay = client(srv.base);
    replay.cookies.set('__Host-markstage', token);
    assert.equal((await replay.get('/collections')).status, 401);
  });
});

describe('CSRF, Origin, Host and headers', () => {
  let fx;
  let srv;
  let ed;
  before(async () => {
    fx = makeFixture();
    srv = await startServer(fx);
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('a write without the CSRF token is refused', async () => {
    const r = await ed.post('/snippets', { name: 'x', doc: { type: 'doc', content: [] } }, { noCsrf: true });
    assert.equal(r.status, 403);
    const wrong = await ed.request('POST', '/snippets', { body: { name: 'x', doc: { type: 'doc', content: [] } }, noCsrf: true, headers: { 'X-CSRF-Token': 'forged' } });
    assert.equal(wrong.status, 403);
    assert.equal((await ed.post('/snippets', { name: 'x', doc: { type: 'doc', content: [] } })).status, 201);
  });

  test('a write from another origin, or with no Origin/Referer, is refused (even with the token)', async () => {
    const evil = await ed.request('POST', '/snippets', { body: { name: 'x', doc: { type: 'doc', content: [] } }, headers: { Origin: 'https://evil.example' }, noOrigin: true });
    assert.equal(evil.status, 403);
    const none = await ed.request('POST', '/snippets', { body: { name: 'x', doc: { type: 'doc', content: [] } }, noOrigin: true });
    assert.equal(none.status, 403);
    const login = await client(srv.base, { origin: 'https://evil.example' }).post('/auth/login', { email: ed.user.email, password: ed.user.password });
    assert.equal(login.status, 403);
    const audit = srv.app.audit.list({ action: 'security.' }).items;
    assert.ok(audit.some((a) => a.action === 'security.origin'));
    assert.ok(audit.some((a) => a.action === 'security.csrf'));
  });

  test('an unknown Host header is refused (DNS rebinding)', async () => {
    const http = await import('node:http');
    const status = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: srv.port, path: '/markstage/api/auth/me', headers: { Host: 'attacker.example' } }, (res) => resolve(res.statusCode)).end();
    });
    assert.equal(status, 421);
  });

  test('security headers on API answers and on the editor page', async () => {
    const r = await ed.get('/auth/me');
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const page = await fetch(`${srv.base}/markstage/`);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
  });

  test('bodies are size-limited and must be JSON', async () => {
    const big = await ed.post('/snippets', { name: 'x', doc: { type: 'doc', content: [{ type: 'text', text: 'a'.repeat(5 * 1024 * 1024) }] } });
    assert.equal(big.status, 413);
    const form = await ed.request('POST', '/snippets', { body: 'name=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 415);
  });
});

describe('the release line', () => {
  test('GET /release: the footer line for everyone (the owner\'s rule); the version parts and the commit once signed in', async () => {
    const fx = makeFixture({ checks: false });
    const srv = await startServer(fx);
    try {
      const open = await client(srv.base).get('/release');
      assert.equal(open.status, 200);
      assert.deepEqual(Object.keys(open.json), ['line']);
      assert.match(open.json.line, /^v\d+\.\d+\.\d+/);
      const me = await as(srv, 'contributor');
      const mine = await me.get('/release');
      assert.deepEqual(Object.keys(mine.json).sort(), ['build', 'builtAt', 'commit', 'line', 'version']);
      assert.equal(mine.json.line, open.json.line);
    } finally {
      await srv.close();
    }
  });
});

describe('rate limit and progressive lockout', () => {
  let fx;
  let srv;
  const clock = { now: Date.UTC(2026, 9, 28, 12) };
  before(async () => {
    fx = makeFixture();
    srv = await startServer(fx, { clock, overrides: { login: { ipMaxAttempts: 8, ipWindowSeconds: 600, accountFreeFailures: 3, lockBaseSeconds: 60, lockMaxSeconds: 600 } } });
  });
  after(() => srv.close());

  test('the account locks after 3 misses, longer after each further miss, and a success clears it', async () => {
    const u = await addUser(srv.app, { email: 'lock@example.test', role: 'author' });
    const c = client(srv.base);
    for (let i = 0; i < 3; i++) assert.equal((await c.post('/auth/login', { email: u.email, password: 'Nope-nope-nope-1' })).status, 401);
    const locked = await c.post('/auth/login', { email: u.email, password: u.password });
    assert.equal(locked.status, 423, 'even the right password waits out the lock');
    assert.equal(locked.json.retryAfter, 60);
    clock.now += 61_000;
    assert.equal((await c.post('/auth/login', { email: u.email, password: 'Nope-nope-nope-1' })).status, 401);
    const longer = await c.post('/auth/login', { email: u.email, password: u.password });
    assert.equal(longer.status, 423);
    assert.equal(longer.json.retryAfter, 120);
    clock.now += 121_000;
    assert.equal((await c.post('/auth/login', { email: u.email, password: u.password })).status, 200);
    assert.ok(srv.app.audit.list({ action: 'auth.lockout' }).items.length >= 1);
  });

  test('the lock is per address: another address, or the person from a known browser, still signs in; the account alone locks only after many misses in an hour', async () => {
    const u = await addUser(srv.app, { email: 'spread@example.test', role: 'author' });
    // a server that trusts the proxy's X-Forwarded-For, so one test can speak from several addresses
    const proxied = await startServer(fx, { clock, overrides: { trustProxy: true, login: { ipMaxAttempts: 1000, ipWindowSeconds: 600, accountFreeFailures: 3, lockBaseSeconds: 60, lockMaxSeconds: 600, accountMaxFailures: 8, accountWindowSeconds: 3600 } } });
    try {
      const from = (ip) => ({ headers: { 'X-Forwarded-For': ip } });
      const home = client(proxied.base);
      // the person signs in once from home: that browser is now a known device (cookie in the jar)
      assert.equal((await home.post('/auth/login', { email: u.email, password: u.password }, from('10.0.0.1'))).status, 200);
      assert.ok(home.cookies.has('__Host-markstage-device'));
      await home.post('/auth/logout', {}, from('10.0.0.1'));
      // a stranger at 203.0.113.9 misses three times: their address is locked out of the account
      const stranger = client(proxied.base);
      for (let i = 0; i < 3; i++) assert.equal((await stranger.post('/auth/login', { email: u.email, password: 'Nope-nope-nope-1' }, from('203.0.113.9'))).status, 401);
      const theirs = await stranger.post('/auth/login', { email: u.email, password: u.password }, from('203.0.113.9'));
      assert.equal(theirs.status, 423, 'the stranger\'s address is locked, same words as before');
      assert.match(theirs.json.message, /^Too many wrong tries\. This account is locked for \d+ seconds\.$/);
      assert.deepEqual(srv.app.audit.list({ action: 'auth.lockout' }).items.length >= 1, true);
      // the person at another address is not locked at all
      const office = client(proxied.base);
      assert.equal((await office.post('/auth/login', { email: u.email, password: u.password }, from('10.0.0.2'))).status, 200, 'another address signs in');
      await office.post('/auth/logout', {}, from('10.0.0.2'));
      // misses from many addresses: after accountMaxFailures (8) within the hour the account itself locks
      let n = 0;
      for (let a = 1; n < 8; a++) for (let i = 0; i < 2 && n < 8; i++, n++) assert.equal((await stranger.post('/auth/login', { email: u.email, password: 'Nope-nope-nope-1' }, from(`198.51.100.${a}`))).status, 401);
      const fresh = client(proxied.base);
      const everyone = await fresh.post('/auth/login', { email: u.email, password: u.password }, from('10.0.0.3'));
      assert.equal(everyone.status, 423, 'a new browser at a new address waits out the account lock');
      assert.equal(everyone.json.retryAfter, 600);
      const lockouts = proxied.app.audit.list({ action: 'auth.lockout' }).items;
      assert.ok(lockouts.some((e) => e.detail?.scope === 'account') && lockouts.some((e) => e.detail?.scope === 'device'), 'both lock kinds are audited');
      // the person's known browser: a wrong password is 423 like everyone else's, the right one gets in
      assert.equal((await home.post('/auth/login', { email: u.email, password: 'Nope-nope-nope-1' }, from('10.0.0.1'))).status, 423);
      const back = await home.post('/auth/login', { email: u.email, password: u.password }, from('10.0.0.1'));
      assert.equal(back.status, 200, 'a known device with the right password gets through the account-wide lock');
      // the success cleared the account lock
      assert.equal((await fresh.post('/auth/login', { email: u.email, password: u.password }, from('10.0.0.3'))).status, 200);
      // the stranger's own address stays locked (its progressive lock is its own)
      assert.equal((await stranger.post('/auth/login', { email: u.email, password: u.password }, from('203.0.113.9'))).status, 423);
    } finally {
      await proxied.close();
    }
  });

  test('locked out account-wide on a new device: a reset code from the owner or the CLI still gets the person in (review 3 Nov, S8)', async () => {
    const u = await addUser(srv.app, { email: 'stuck@example.test', role: 'editor' });
    const proxied = await startServer(fx, { clock, overrides: { trustProxy: true, login: { ipMaxAttempts: 1000, ipWindowSeconds: 600, accountFreeFailures: 3, lockBaseSeconds: 60, lockMaxSeconds: 600, accountMaxFailures: 8, accountWindowSeconds: 3600 } } });
    try {
      const from = (ip) => ({ headers: { 'X-Forwarded-For': ip } });
      const stranger = client(proxied.base);
      for (let a = 1; a <= 8; a++) assert.equal((await stranger.post('/auth/login', { email: u.email, password: 'Nope-nope-nope-1' }, from(`198.51.100.${a}`))).status, 401);
      // the person on a new laptop, no known-device cookie: the account-wide lock keeps them out
      const laptop = client(proxied.base);
      assert.equal((await laptop.post('/auth/login', { email: u.email, password: u.password }, from('10.0.0.9'))).status, 423);
      // the documented way back: a reset code (People & access → Reset password, or `markstage-server reset-password`)
      const code = issueResetCode(proxied.app, u.email);
      const password = testPassword();
      const back = await laptop.post('/auth/accept-invite', { email: u.email, setupCode: code, password }, from('10.0.0.9'));
      assert.equal(back.status, 200, back.text);
      // and the account lock is cleared: a sign-in from yet another new browser works
      assert.equal((await client(proxied.base).post('/auth/login', { email: u.email, password }, from('10.0.0.10'))).status, 200);
    } finally {
      await proxied.close();
    }
  });

  test('one IP gets 429 with Retry-After after too many failed attempts', async () => {
    srv.app.limiter.reset();
    const c = client(srv.base);
    let last;
    for (let i = 0; i < 9; i++) last = await c.post('/auth/login', { email: `x${i}@example.test`, password: 'Whatever-123456' });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    assert.match(last.json.message, /failed sign-ins from your network. Try again in \d+ seconds/);
    srv.app.limiter.reset();
  });

  test('successful sign-ins never count toward the network limit, and a success forgets the misses (F2)', async () => {
    srv.app.limiter.reset();
    const u = await addUser(srv.app, { email: 'office@example.test', role: 'author' });
    // thirty people (or browser sessions) behind one address sign in within the window: nobody is locked out
    for (let i = 0; i < 30; i++) {
      const r = await client(srv.base).post('/auth/login', { email: u.email, password: u.password });
      assert.equal(r.status, 200, `sign-in ${i + 1} of 30 from one address`);
    }
    // seven misses, then a right password: the misses are forgotten
    const c = client(srv.base);
    for (let i = 0; i < 7; i++) assert.equal((await c.post('/auth/login', { email: `x${i}@example.test`, password: 'Whatever-123456' })).status, 401);
    assert.equal((await c.post('/auth/login', { email: u.email, password: u.password })).status, 200);
    for (let i = 0; i < 7; i++) assert.equal((await c.post('/auth/login', { email: `y${i}@example.test`, password: 'Whatever-123456' })).status, 401, 'the count started again at the success');
    // and the eighth miss in a row is the one that locks the address
    assert.equal((await c.post('/auth/login', { email: 'z@example.test', password: 'Whatever-123456' })).status, 401);
    assert.equal((await c.post('/auth/login', { email: u.email, password: u.password })).status, 429);
    srv.app.limiter.reset();
  });
});

describe('session timeouts and revocation', () => {
  let fx;
  let srv;
  const clock = { now: Date.UTC(2026, 9, 28, 8) };
  before(async () => {
    fx = makeFixture();
    srv = await startServer(fx, { clock, overrides: { session: { idleMinutes: 30, absoluteHours: 2 } } });
  });
  after(() => srv.close());

  test('idle timeout', async () => {
    const c = await as(srv, 'editor');
    clock.now += 29 * 60_000;
    assert.equal((await c.get('/collections')).status, 200);
    clock.now += 31 * 60_000;
    assert.equal((await c.get('/collections')).status, 401);
  });

  test('absolute timeout even when active', async () => {
    const c = await as(srv, 'editor');
    for (let i = 0; i < 4; i++) {
      clock.now += 25 * 60_000;
      assert.equal((await c.get('/collections')).status, 200);
    }
    clock.now += 25 * 60_000;
    assert.equal((await c.get('/collections')).status, 401, 'past 2 h absolute');
  });

  test('revoking a session from the list ends it; disabling a user ends theirs', async () => {
    const owner = await as(srv, 'owner');
    const a = await as(srv, 'author', { authorSlug: 'alice' });
    const other = client(srv.base);
    await other.login(a.user.email, a.user.password);
    const list = await a.get('/auth/sessions');
    assert.equal(list.json.length, 2);
    const theirs = list.json.find((s) => !s.current);
    assert.equal((await a.del(`/auth/sessions/${theirs.id}`)).status, 200);
    assert.equal((await other.get('/collections')).status, 401);
    assert.equal((await owner.patch(`/users/${a.user.id}`, { disabled: true })).status, 200);
    assert.equal((await a.get('/collections')).status, 401);
    const relog = await client(srv.base).post('/auth/login', { email: a.user.email, password: a.user.password });
    assert.equal(relog.status, 401);
  });

  test('changing the password revokes the other sessions and rotates this one', async () => {
    const u = await addUser(srv.app, { email: 'pw@example.test', role: 'editor' });
    const c1 = client(srv.base);
    const c2 = client(srv.base);
    await c1.login(u.email, u.password);
    await c2.login(u.email, u.password);
    const before1 = c1.cookies.get('__Host-markstage');
    const weak = await c1.post('/auth/password', { currentPassword: u.password, newPassword: 'pw@example.test' });
    assert.equal(weak.status, 422);
    const next = testPassword();
    const r = await c1.post('/auth/password', { currentPassword: u.password, newPassword: next });
    assert.equal(r.status, 200);
    assert.notEqual(c1.cookies.get('__Host-markstage'), before1);
    assert.equal((await c1.get('/collections')).status, 200);
    assert.equal((await c2.get('/collections')).status, 401);
    assert.equal((await client(srv.base).post('/auth/login', { email: u.email, password: u.password })).status, 401);
  });
});

describe('two-step sign-in (TOTP) and recovery codes', () => {
  let fx;
  let srv;
  const clock = { now: Date.UTC(2026, 9, 28, 9) };
  before(async () => {
    fx = makeFixture();
    srv = await startServer(fx, { clock });
  });
  after(() => srv.close());

  test('enable, sign in with a code, refuse replay, use a recovery code once, disable', async () => {
    const u = await addUser(srv.app, { email: 'twofa@example.test', role: 'editor' });
    const c = client(srv.base);
    await c.login(u.email, u.password);
    assert.equal((await c.post('/auth/2fa/setup', { password: 'wrong-wrong-wrong' })).status, 422);
    const setup = await c.post('/auth/2fa/setup', { password: u.password });
    assert.equal(setup.status, 200);
    assert.match(setup.json.otpauthUri, /^otpauth:\/\/totp\//);
    const secret = setup.json.secret;
    assert.equal((await c.post('/auth/2fa/enable', { code: '000000' })).status, 422);
    const en = await c.post('/auth/2fa/enable', { code: totpAt(secret, stepAt(clock.now)) });
    assert.equal(en.status, 200);
    assert.equal(en.json.recoveryCodes.length, 10);

    // password alone is no longer a session
    clock.now += 60_000;
    const d = client(srv.base);
    const step1 = await d.post('/auth/login', { email: u.email, password: u.password });
    assert.equal(step1.json.twoFactorRequired, true);
    assert.equal(step1.json.user, undefined);
    assert.equal(d.cookies.size, 0);
    assert.equal((await d.post('/auth/login/2fa', { challenge: step1.json.challenge, code: '123456' })).status, 401);
    const code = totpAt(secret, stepAt(clock.now));
    const ok = await d.post('/auth/login/2fa', { challenge: step1.json.challenge, code });
    assert.equal(ok.status, 200);
    // the session, and the browser's device id (a sign-in from a new device is a safety alert)
    assert.deepEqual([...d.cookies.keys()].sort(), ['__Host-markstage', '__Host-markstage-device']);

    // the same code (same 30 s step) cannot be used again
    const e = client(srv.base);
    const s2 = await e.post('/auth/login', { email: u.email, password: u.password });
    const again = await e.post('/auth/login/2fa', { challenge: s2.json.challenge, code });
    assert.equal(again.status, 401);
    assert.match(again.json.message, /^That code was used already\. Wait for the next one/, 'the words say to wait, not that the code is wrong (QA F19)');
    // a recovery code works once
    const rc = en.json.recoveryCodes[0];
    assert.equal((await e.post('/auth/login/2fa', { challenge: s2.json.challenge, recoveryCode: rc.toUpperCase() })).status, 200);
    const f = client(srv.base);
    const s3 = await f.post('/auth/login', { email: u.email, password: u.password });
    assert.equal((await f.post('/auth/login/2fa', { challenge: s3.json.challenge, recoveryCode: rc })).status, 401);

    // a challenge allows 5 codes, then it is dead
    const g = client(srv.base);
    const s4 = await g.post('/auth/login', { email: u.email, password: u.password });
    for (let i = 0; i < 5; i++) await g.post('/auth/login/2fa', { challenge: s4.json.challenge, code: '111111' });
    srv.app.limiter.accountSuccess(u.email); // isolate the challenge limit from the account lockout
    clock.now += 31_000;
    assert.equal((await g.post('/auth/login/2fa', { challenge: s4.json.challenge, code: totpAt(secret, stepAt(clock.now)) })).status, 401);

    clock.now += 31_000;
    const off = await c.post('/auth/2fa/disable', { password: u.password, code: totpAt(secret, stepAt(clock.now)) });
    assert.equal(off.status, 200);
    clock.now += 600_000; // let the lockout from the bad codes above expire
    const plain = await client(srv.base).post('/auth/login', { email: u.email, password: u.password });
    assert.ok(plain.json.user);
  });

  test('an expired challenge is refused', async () => {
    const u = await addUser(srv.app, { email: 'twofa2@example.test', role: 'author' });
    srv.app.db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run('JBSWY3DPEHPK3PXP', u.id);
    const c = client(srv.base);
    const s = await c.post('/auth/login', { email: u.email, password: u.password });
    clock.now += 6 * 60_000;
    assert.equal((await c.post('/auth/login/2fa', { challenge: s.json.challenge, code: totpAt('JBSWY3DPEHPK3PXP', stepAt(clock.now)) })).status, 401);
  });
});

describe('users, invites and role management', () => {
  let fx;
  let srv;
  let owner;
  before(async () => {
    fx = makeFixture();
    srv = await startServer(fx);
    owner = await as(srv, 'owner');
  });
  after(() => srv.close());

  test('invite: setup code + matching email sets the password; code is single use', async () => {
    const r = await owner.post('/users', { email: 'new@example.test', name: 'New Person', role: 'author', authorSlug: 'newp' });
    assert.equal(r.status, 201);
    const code = r.json.setupCode;
    assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    const c = client(srv.base);
    const password = testPassword();
    assert.equal((await c.post('/auth/accept-invite', { email: 'other@example.test', setupCode: code, password })).status, 401);
    const ok = await c.post('/auth/accept-invite', { email: 'NEW@example.test', setupCode: code, password });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.role, 'author');
    assert.equal((await client(srv.base).post('/auth/accept-invite', { email: 'new@example.test', setupCode: code, password })).status, 401);
    assert.equal((await client(srv.base).post('/auth/login', { email: 'new@example.test', password })).status, 200);
  });

  test('reset clears the password and gives a new code; CLI reset works the same', async () => {
    const u = await addUser(srv.app, { email: 'reset@example.test', role: 'editor' });
    const r = await owner.post(`/users/${u.id}/reset`, {});
    assert.equal(r.status, 200);
    assert.equal((await client(srv.base).post('/auth/login', { email: u.email, password: u.password })).status, 401);
    const code = issueResetCode(srv.app, u.email);
    assert.notEqual(code, r.json.setupCode);
    assert.equal((await client(srv.base).post('/auth/accept-invite', { email: u.email, setupCode: r.json.setupCode, password: testPassword() })).status, 401, 'older code no longer works');
    assert.equal((await client(srv.base).post('/auth/accept-invite', { email: u.email, setupCode: code, password: testPassword() })).status, 200);
  });

  test('an email is one account whatever its letter case: kept lowercased, found in any case, never invited twice', async () => {
    const made = await owner.post('/users', { email: 'Mixed.Case@Example.TEST', name: 'Mixed', role: 'author' });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.json.user.email, 'mixed.case@example.test');
    assert.equal(srv.app.users.byEmail('MIXED.CASE@example.test').id, made.json.user.id);
    const again = await owner.post('/users', { email: 'mixed.CASE@example.test', name: 'Twice', role: 'author' });
    assert.equal(again.status, 409);
    assert.equal(again.json.message, 'A user with this email already exists.');
    // the invite and the sign-in take any case
    const code = (await owner.post(`/users/${made.json.user.id}/reset`, {})).json.setupCode;
    const password = testPassword();
    const c = client(srv.base);
    assert.equal((await c.post('/auth/accept-invite', { email: 'MIXED.case@EXAMPLE.test', setupCode: code, password })).status, 200);
    await c.post('/auth/logout', {});
    assert.equal((await client(srv.base).post('/auth/login', { email: 'Mixed.Case@Example.test', password })).status, 200);
  });

  test('only owner/admin manage users; admins cannot touch owners or make admins', async () => {
    const admin = await as(srv, 'administrator');
    const editor = await as(srv, 'editor');
    assert.equal((await editor.get('/users')).status, 403);
    assert.equal((await editor.get('/users?brief=1')).status, 200);
    assert.equal((await editor.post('/users', { email: 'e2@example.test', name: 'E', role: 'author' })).status, 403);
    assert.equal((await admin.post('/users', { email: 'adm2@example.test', name: 'A', role: 'administrator' })).status, 403);
    const ownerRow = srv.app.users.list().find((x) => x.role === 'owner');
    assert.equal((await admin.patch(`/users/${ownerRow.id}`, { disabled: true })).status, 403);
    assert.equal((await admin.post(`/users/${ownerRow.id}/reset`, {})).status, 403);
    assert.equal((await admin.patch(`/users/${admin.user.id}`, { role: 'owner' })).status, 403, 'no self-promotion');
    const made = await admin.post('/users', { email: 'ed2@example.test', name: 'Ed', role: 'editor' });
    assert.equal(made.status, 201);
    assert.equal((await admin.del(`/users/${made.json.user.id}`)).status, 200);
  });

  test('there is always exactly one owner; ownership transfers', async () => {
    const meId = owner.user.id;
    assert.equal((await owner.patch(`/users/${meId}`, { role: 'editor' })).status, 403, 'cannot change own role');
    assert.equal((await owner.del(`/users/${meId}`)).status, 400);
    const next = await addUser(srv.app, { email: 'heir@example.test', role: 'administrator' });
    const t = await owner.patch(`/users/${next.id}`, { role: 'owner' });
    assert.equal(t.status, 200);
    assert.equal(srv.app.users.get(meId).role, 'administrator');
    assert.equal(srv.app.users.ownerCount(), 1);
  });

  test('the audit log is admin-only and records sign-ins', async () => {
    const editor = await as(srv, 'editor');
    assert.equal((await editor.get('/audit')).status, 403);
    const heir = srv.app.users.byEmail('heir@example.test');
    assert.ok(heir);
    const log = await owner.get('/audit?action=auth.login&limit=5');
    assert.equal(log.status, 200);
    assert.ok(log.json.items.length > 0);
    assert.ok(log.json.items.every((i) => i.action.startsWith('auth.login')));
    assert.ok(log.json.items[0].ip);
  });
});
