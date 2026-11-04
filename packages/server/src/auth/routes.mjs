// Sign-in routes: first-owner setup, login (+2FA step), logout, invites, password change, 2FA management, sessions.
import { tx } from '../db.mjs';
import { cookie, parseCookies } from '../http.mjs';
import { INVITE_TTL_MS, checkProfile } from '../users.mjs';
import { conflict, forbidden, invalid, newToken, notFound, nowIso, sha256, unauthorized } from '../util.mjs';
import { buildInfo } from '../version.mjs';
import { hashPassword, passwordProblem, verifyPassword } from './passwords.mjs';
import { USED_WORDS, checkTotp, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from './totp.mjs';

const WRONG = 'Wrong email or password.';
// the two-step challenge of a single sign-on (auth/sso.mjs): kept in a cookie, never in the URL
export const SSO_STEP = '__Host-markstage-sso-step';
// a long-lived random id per browser, so a sign-in from one never seen for that person is a safety alert
const DEVICE = '__Host-markstage-device';
const DEVICE_DAYS = 400;

/** "Firefox on macOS" from a user agent, for the alert (never the whole string). */
export function deviceName(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

export function authRoutes(router, app) {
  const { db, users, sessions, challenges, limiter, audit, config, clock } = app;

  /** Start a fresh session (rotation: whatever session the browser had is revoked first) and set the cookie. */
  function signIn(ctx, row, action = 'auth.login') {
    if (ctx.session) sessions.revoke(ctx.session.id);
    const s = sessions.create(row.id, ctx);
    ctx.setSessionCookie(s.token);
    users.touchLogin(row.id);
    limiter.accountSuccess(row.email, ctx.ip);
    ctx.user = users.toPublic(row);
    audit.log(ctx, action, { target: row.id });
    knownDevice(ctx, row);
    return { user: users.toPublic(users.get(row.id)), csrfToken: s.csrf };
  }

  /** The browser's device cookie, when it has a well-formed one. */
  const deviceToken = (ctx) => {
    const token = parseCookies(ctx.req?.headers?.cookie)[DEVICE];
    return /^[A-Za-z0-9_-]{20,100}$/.test(token ?? '') ? token : null;
  };

  /** Is this browser one the person signed in from before? (Nothing is written.) */
  function isKnownDevice(ctx, row) {
    const token = row && deviceToken(ctx);
    return Boolean(token && db.prepare('SELECT 1 FROM known_devices WHERE user_id = ? AND device_hash = ?').get(row.id, sha256(token)));
  }

  /** Remember this browser for the person; a sign-in from one they never used before tells them (and the rules). */
  function knownDevice(ctx, row) {
    let token = deviceToken(ctx);
    const at = nowIso(clock());
    const hash = token ? sha256(token) : null;
    const seen = hash && db.prepare('SELECT 1 FROM known_devices WHERE user_id = ? AND device_hash = ?').get(row.id, hash);
    if (seen) {
      db.prepare('UPDATE known_devices SET last_at = ? WHERE user_id = ? AND device_hash = ?').run(at, row.id, hash);
      return;
    }
    // their first device ever is not news (setting up the account); any later new one is
    const before = db.prepare('SELECT COUNT(*) AS n FROM known_devices WHERE user_id = ?').get(row.id).n;
    token ??= newToken(24);
    db.prepare('INSERT OR IGNORE INTO known_devices (user_id, device_hash, first_at, last_at, user_agent) VALUES (?, ?, ?, ?, ?)').run(row.id, sha256(token), at, at, String(ctx.userAgent ?? '').slice(0, 300) || null);
    ctx.res?.appendHeader('Set-Cookie', cookie(DEVICE, token, { maxAge: DEVICE_DAYS * 86400 }));
    if (Number(before) > 0) {
      app.notices?.tell({ kind: 'signin.new-device', level: 'warn', text: `${row.name} signed in from a new device: ${deviceName(ctx.userAgent)}${ctx.ip ? ` at ${ctx.ip}` : ''}, ${at.replace(/\.\d{3}Z$/, 'Z')}. If it wasn't you, change your password and sign out your other sessions.`, link: '#/account', to: [row.id] });
    }
  }

  // single sign-on (auth/sso.mjs) ends the same way as a password
  app.signIn = signIn;

  const passwordFields = (password, email) => {
    const problem = passwordProblem(password, email);
    if (problem) throw invalid({ password: problem });
  };

  router.add('GET', '/auth/me', (ctx) => ({
    user: ctx.user ?? null,
    csrfToken: ctx.session?.csrf ?? null,
    setupRequired: users.ownerCount() === 0,
    devMode: Boolean(config.devNoAuth),
    // what runs, for the menu and Your account; only for someone signed in
    server: ctx.user ? buildInfo() : null,
  }), { auth: false });

  // the footer line of every editor screen (public by the owner's rule: version, build number, build time; the
  // site's smoke test compares it with the built editor's); the exact commit and the parts only once signed in
  router.add('GET', '/release', (ctx) => {
    const { version, build, builtAt, commit, line } = buildInfo();
    return ctx.user ? { version, build, builtAt, commit, line } : { line };
  }, { auth: false });

  router.add('POST', '/auth/setup', async (ctx) => {
    limiter.ipCheck(ctx.ip);
    const { setupCode, email, name, password } = ctx.body;
    if (users.ownerCount() > 0) throw conflict('This site already has an owner.');
    const code = users.findCode('owner', setupCode);
    if (!code) {
      limiter.ipFailure(ctx.ip);
      audit.log(ctx, 'auth.setup', { ok: false });
      throw unauthorized('That setup code is wrong or expired. Run `markstage-server setup-code` again.');
    }
    const fields = checkProfile({ email, name });
    if (Object.keys(fields).length) throw invalid(fields);
    passwordFields(password, email);
    const pwHash = await hashPassword(password);
    const row = tx(db, () => {
      if (users.ownerCount() > 0) throw conflict('This site already has an owner.');
      users.useCode(code);
      return users.create({ email, name, role: 'owner', pwHash });
    });
    ctx.status = 201;
    return signIn(ctx, row, 'auth.setup');
  }, { auth: false });

  router.add('POST', '/auth/login', async (ctx) => {
    const { email, password } = ctx.body;
    limiter.ipCheck(ctx.ip);
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 256) {
      limiter.ipFailure(ctx.ip);
      throw unauthorized(WRONG);
    }
    const row = users.byEmail(email);
    // this address locked out of the account, or the account locked from everywhere: 423. A browser the person
    // used before may still try during an account-wide lock (the right password gets in, a wrong one is 423 too).
    const known = isKnownDevice(ctx, row);
    limiter.accountCheck(email, ctx.ip, { knownDevice: known });
    const ok = await verifyPassword(password, row?.pw_hash ?? null);
    if (!ok || row.disabled) {
      const locked = limiter.accountFailure(email, ctx.ip);
      audit.log(ctx, 'auth.login.fail', { ok: false, target: row?.id ?? null, detail: { email: email.slice(0, 254) } });
      if (locked) audit.log(ctx, 'auth.lockout', { ok: false, target: row?.id ?? null, detail: { seconds: locked.seconds, scope: locked.scope } });
      if (known) limiter.accountCheck(email, ctx.ip);
      throw unauthorized(WRONG);
    }
    // a site that signs in through its provider keeps the owner's password for when the provider is down
    if (config.sso?.passwordLogin === false && row.role !== 'owner') {
      audit.log(ctx, 'auth.login.fail', { ok: false, target: row.id, detail: { reason: 'sso-only' } });
      throw forbidden(`This site signs in with ${config.sso.providers.map((p) => p.label).join(' or ')}.`);
    }
    if (row.totp_secret) return { twoFactorRequired: true, challenge: challenges.create(row.id) };
    return signIn(ctx, row);
  }, { auth: false });

  router.add('POST', '/auth/login/2fa', (ctx) => {
    limiter.ipCheck(ctx.ip);
    const { code, recoveryCode } = ctx.body;
    // after a single sign-on the challenge waits in its cookie (auth/sso.mjs)
    const fromSso = ctx.body.challenge === undefined ? parseCookies(ctx.req?.headers?.cookie)[SSO_STEP] : undefined;
    const challenge = ctx.body.challenge ?? fromSso;
    const ch = typeof challenge === 'string' ? challenges.use(challenge) : null;
    if (!ch) {
      limiter.ipFailure(ctx.ip);
      throw unauthorized('This sign-in step expired. Enter your password again.');
    }
    const row = users.get(ch.userId);
    if (!row || row.disabled || !row.totp_secret) throw unauthorized('This sign-in step expired. Enter your password again.');
    limiter.accountCheck(row.email, ctx.ip);
    let ok = false;
    if (recoveryCode) {
      const hit = db.prepare('SELECT rowid FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').get(row.id, hashRecoveryCode(recoveryCode));
      if (hit) {
        db.prepare('UPDATE recovery_codes SET used_at = ? WHERE rowid = ?').run(new Date(clock()).toISOString(), hit.rowid);
        ok = true;
      }
    } else {
      const { state, step } = checkTotp(row.totp_secret, code, { now: clock(), lastStep: row.totp_last_step });
      if (state === 'ok') {
        db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, row.id);
        ok = true;
      }
      // the right code a second time (QA F19): not a wrong guess, so no lockout; say to wait for the next one
      if (state === 'used') throw unauthorized(USED_WORDS);
    }
    if (!ok) {
      const locked = limiter.accountFailure(row.email, ctx.ip);
      audit.log(ctx, 'auth.2fa.fail', { ok: false, target: row.id });
      if (locked) audit.log(ctx, 'auth.lockout', { ok: false, target: row.id, detail: { seconds: locked.seconds, scope: locked.scope } });
      throw unauthorized('That code is not right.');
    }
    challenges.consume(ch.id);
    if (fromSso) ctx.res?.appendHeader('Set-Cookie', cookie(SSO_STEP, '', { maxAge: 0 }));
    return signIn(ctx, row, fromSso ? 'auth.sso' : recoveryCode ? 'auth.login.recovery' : 'auth.login');
  }, { auth: false });

  router.add('POST', '/auth/logout', (ctx) => {
    if (ctx.session) sessions.revoke(ctx.session.id);
    ctx.clearSessionCookie();
    audit.log(ctx, 'auth.logout');
    return { ok: true };
  });

  router.add('POST', '/auth/accept-invite', async (ctx) => {
    limiter.ipCheck(ctx.ip);
    const { email, setupCode, password, name } = ctx.body;
    const code = users.findCode('invite', setupCode);
    const row = code && users.get(code.user_id);
    // the code alone is not enough: it must belong to this email (same answer either way)
    if (!row || row.disabled || String(email ?? '').trim().toLowerCase() !== row.email.toLowerCase()) {
      limiter.ipFailure(ctx.ip);
      audit.log(ctx, 'auth.invite.fail', { ok: false });
      throw unauthorized('That email and setup code do not match, or the code expired. Ask for a new one.');
    }
    if (name !== undefined) {
      const fields = checkProfile({ name }, { partial: true });
      if (Object.keys(fields).length) throw invalid(fields);
    }
    passwordFields(password, row.email);
    const pwHash = await hashPassword(password);
    tx(db, () => {
      users.useCode(code);
      users.setPassword(row.id, pwHash);
      if (name !== undefined) users.update(row.id, { name });
    });
    sessions.revokeUser(row.id);
    return signIn(ctx, users.get(row.id), 'auth.invite');
  }, { auth: false });

  router.add('POST', '/auth/password', async (ctx) => {
    const { currentPassword, newPassword } = ctx.body;
    const row = users.get(ctx.user.id);
    limiter.accountCheck(row.email, ctx.ip);
    if (!(await verifyPassword(currentPassword, row.pw_hash))) {
      limiter.accountFailure(row.email, ctx.ip);
      audit.log(ctx, 'auth.password', { ok: false });
      throw invalid({ currentPassword: 'That is not your current password.' });
    }
    const problem = passwordProblem(newPassword, row.email);
    if (problem) throw invalid({ newPassword: problem });
    users.setPassword(row.id, await hashPassword(newPassword));
    sessions.revokeUser(row.id);
    const s = sessions.create(row.id, ctx);
    ctx.setSessionCookie(s.token);
    audit.log(ctx, 'auth.password');
    return { ok: true, csrfToken: s.csrf };
  });

  router.add('GET', '/auth/sessions', (ctx) =>
    sessions.listForUser(ctx.user.id).map((s) => ({
      id: s.id,
      current: s.id === ctx.session?.id,
      createdAt: new Date(s.created_at).toISOString(),
      lastSeenAt: new Date(s.last_seen_at).toISOString(),
      ip: s.ip,
      userAgent: s.user_agent,
    })),
  );

  router.add('DELETE', '/auth/sessions/:sid', (ctx) => {
    const own = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(ctx.params.sid, ctx.user.id);
    if (!own) throw notFound('No such session.');
    sessions.revoke(own.id);
    audit.log(ctx, 'auth.session.revoke', { target: own.id });
    return { ok: true };
  });

  // --- 2FA ---------------------------------------------------------------------------------------------------

  const requirePassword = async (ctx, row, password) => {
    limiter.accountCheck(row.email, ctx.ip);
    if (!(await verifyPassword(password, row.pw_hash))) {
      limiter.accountFailure(row.email, ctx.ip);
      throw invalid({ password: 'That is not your password.' });
    }
  };
  const requireCode = (row, code, ctx = {}) => {
    const { state, step } = checkTotp(row.totp_secret, code, { now: clock(), lastStep: row.totp_last_step });
    if (state === 'used') throw invalid({ code: USED_WORDS });
    if (state !== 'ok') {
      limiter.accountFailure(row.email, ctx.ip);
      throw invalid({ code: 'That code is not right.' });
    }
    db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, row.id);
  };
  const storeRecoveryCodes = (userId) => {
    const codes = newRecoveryCodes();
    tx(db, () => {
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
      const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
      for (const c of codes) ins.run(userId, hashRecoveryCode(c));
    });
    return codes;
  };

  router.add('POST', '/auth/2fa/setup', async (ctx) => {
    const row = users.get(ctx.user.id);
    await requirePassword(ctx, row, ctx.body.password);
    if (row.totp_secret) throw conflict('Two-step sign-in is already on. Turn it off first.');
    const secret = newTotpSecret();
    db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, row.id);
    return { secret, otpauthUri: otpauthUri(secret, { issuer: 'Markstage', account: row.email }) };
  });

  router.add('POST', '/auth/2fa/enable', (ctx) => {
    const row = users.get(ctx.user.id);
    if (!row.totp_pending) throw conflict('Start the setup first.');
    const step = verifyTotp(row.totp_pending, ctx.body.code, { now: clock() });
    if (!step) throw invalid({ code: 'That code is not right. Check the time on your phone.' });
    db.prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ? WHERE id = ?').run(step, row.id);
    const recoveryCodes = storeRecoveryCodes(row.id);
    audit.log(ctx, 'auth.2fa.enable');
    return { recoveryCodes };
  });

  router.add('POST', '/auth/2fa/disable', async (ctx) => {
    const row = users.get(ctx.user.id);
    if (!row.totp_secret) throw conflict('Two-step sign-in is not on.');
    await requirePassword(ctx, row, ctx.body.password);
    requireCode(row, ctx.body.code, ctx);
    db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL WHERE id = ?').run(row.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(row.id);
    audit.log(ctx, 'auth.2fa.disable');
    return { ok: true };
  });

  router.add('POST', '/auth/2fa/recovery-codes', async (ctx) => {
    const row = users.get(ctx.user.id);
    if (!row.totp_secret) throw conflict('Two-step sign-in is not on.');
    await requirePassword(ctx, row, ctx.body.password);
    requireCode(row, ctx.body.code, ctx);
    audit.log(ctx, 'auth.2fa.recovery-codes');
    return { recoveryCodes: storeRecoveryCodes(row.id) };
  });
}

/** CLI helper: a one-time code to create the first owner (only while there is none). */
export function issueOwnerCode(app) {
  if (app.users.ownerCount() > 0) throw forbidden('This site already has an owner. Use `reset-password` instead.');
  return app.users.issueCode('owner', null, 60 * 60_000);
}

/** CLI helper: reset a user's password by email; prints a setup code the user enters with their email. */
export function issueResetCode(app, email) {
  const row = app.users.byEmail(email);
  if (!row) throw notFound('No user with that email.');
  app.users.setPassword(row.id, null);
  app.sessions.revokeUser(row.id);
  app.audit.log({ actorName: 'cli' }, 'user.reset', { target: row.id, detail: { via: 'cli' } });
  return app.users.issueCode('invite', row.id, INVITE_TTL_MS);
}

