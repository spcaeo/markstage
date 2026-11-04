// Single sign-on through OpenID Connect (docs/API-SSO.md): "Sign in with <provider>" on the sign-in screen.
//
//   GET /auth/sso                        {providers: [{id, label}], passwordLogin}
//   GET /auth/sso/:id/start?next=#/...   302 to the provider (state, nonce and PKCE; the state in a cookie too)
//   GET /auth/sso/:id/callback           302 into the editor, signed in (or to the sign-in screen, saying why)
//   GET    /users/:uid/sso               [{provider, label, email, createdAt, lastAt}] (owner, administrator)
//   DELETE /users/:uid/sso/:provider     the link undone: their next sign-in there links again by email
//
// A person is found by the provider's own id for them (linked on their first sign-in), else by their verified email
// (an invited person), else made when the provider's autoCreate allows their email's domain. A person with two-step
// sign-in on still gives their code. Every step is audited; nothing the provider sends is kept but the link.
import { cookie, parseCookies } from '../http.mjs';
import { canManageUser } from '../roles.mjs';
import { forbidden, newToken, notFound, nowIso, sha256 } from '../util.mjs';
import { SSO_STEP } from './routes.mjs';
import { clientSecretOf } from './sso-config.mjs';
import { createOidc } from './oidc.mjs';

const STATE = '__Host-markstage-sso';
const STATE_MS = 10 * 60_000;
// where the editor goes after signing in: one of its own screens, never back to sign-in, never another site
const nextOf = (n) => (typeof n === 'string' && /^#\/(?!sign-in|setup|accept-invite)[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*$/.test(n) && n.length <= 500 ? n : '#/');
// the state cookie comes back on the provider's redirect (a top-level GET from another site): Lax, not Strict
const stateCookie = (value, maxAge) => `${STATE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function ssoRoutes(router, app) {
  const { db, config, audit, users, limiter, challenges } = app;
  const sso = config.sso;
  const oidc = createOidc({ outbound: app.outbound ?? {}, clock: app.clock });
  const apiPrefix = `${config.basePath}/api`;
  const providerOf = (id) => sso?.providers.find((p) => p.id === id) ?? null;
  const redirectUri = (p) => `${config.publicOrigin}${apiPrefix}/auth/sso/${p.id}/callback`;

  const go = (ctx, location) => {
    ctx.res.statusCode = 302;
    ctx.res.setHeader('Location', location);
    ctx.res.setHeader('Cache-Control', 'no-store');
    ctx.res.end();
  };
  const editor = (hash) => `${config.basePath}/${hash}`;
  /** Back to the sign-in screen with why, in a word the screen turns into a sentence. */
  const fail = (ctx, p, why, words, target = null) => {
    limiter.ipFailure(ctx.ip);
    audit.log(ctx, 'auth.sso.fail', { ok: false, target, detail: { provider: p?.id ?? null, why, words: String(words ?? '').slice(0, 300) } });
    go(ctx, editor(`#/sign-in?sso=${why}${p ? `&provider=${p.id}` : ''}`));
  };

  router.add('GET', '/auth/sso', () => ({ providers: (sso?.providers ?? []).map((p) => ({ id: p.id, label: p.label })), passwordLogin: sso ? sso.passwordLogin : true }), { auth: false });

  router.add('GET', '/auth/sso/:id/start', async (ctx) => {
    limiter.ipCheck(ctx.ip);
    const p = providerOf(ctx.params.id);
    if (!p) return fail(ctx, null, 'unknown', 'No such provider.');
    const state = newToken(24);
    const nonce = newToken(24);
    const verifier = newToken(48);
    let url;
    try {
      url = await oidc.authorizeUrl(p, { redirectUri: redirectUri(p), state, nonce, verifier });
    } catch (e) {
      return fail(ctx, p, 'provider', e.message);
    }
    const now = app.clock();
    db.prepare('DELETE FROM sso_states WHERE expires_at < ?').run(now);
    db.prepare('INSERT INTO sso_states (state_hash, provider, nonce, verifier, next, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sha256(state), p.id, nonce, verifier, nextOf(ctx.query.get('next')), nowIso(now), now + STATE_MS);
    ctx.res.appendHeader('Set-Cookie', stateCookie(state, STATE_MS / 1000));
    return go(ctx, url);
  }, { auth: false });

  router.add('GET', '/auth/sso/:id/callback', async (ctx) => {
    limiter.ipCheck(ctx.ip);
    const p = providerOf(ctx.params.id);
    if (!p) return fail(ctx, null, 'unknown', 'No such provider.');
    // the state: the one this browser was given, unused, for this provider, within ten minutes
    const state = ctx.query.get('state') ?? '';
    const mine = parseCookies(ctx.req.headers.cookie)[STATE] ?? '';
    ctx.res.appendHeader('Set-Cookie', stateCookie('', 0));
    const row = state && mine === state ? db.prepare('SELECT * FROM sso_states WHERE state_hash = ?').get(sha256(state)) : null;
    if (!row || row.used_at || row.provider !== p.id || row.expires_at < app.clock()) return fail(ctx, p, 'expired', row ? 'used, expired or for another provider' : 'no matching state for this browser');
    db.prepare('UPDATE sso_states SET used_at = ? WHERE state_hash = ?').run(nowIso(app.clock()), row.state_hash);
    if (ctx.query.get('error')) return fail(ctx, p, 'denied', String(ctx.query.get('error')).slice(0, 60));
    const code = ctx.query.get('code');
    if (!code || code.length > 2000) return fail(ctx, p, 'provider', 'no code');
    const secret = clientSecretOf(p);
    if (!secret) return fail(ctx, p, 'provider', `${p.secretEnv} is not set`);
    let claims;
    try {
      claims = await oidc.signIn(p, { code, redirectUri: redirectUri(p), verifier: row.verifier, nonce: row.nonce, secret });
    } catch (e) {
      return fail(ctx, p, 'provider', e.message);
    }

    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase().slice(0, 254) : null;
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    const domainOk = !p.domains.length || (email && p.domains.includes(email.split('@').pop()));
    if (!domainOk) return fail(ctx, p, 'domain', `${email ?? 'no email'} is not at ${p.domains.join(', ')}`);
    const link = db.prepare('SELECT * FROM sso_identities WHERE provider = ? AND subject = ?').get(p.id, claims.sub);
    let user = link ? users.get(link.user_id) : null;
    if (!user) {
      if (!email || !verified) return fail(ctx, p, 'email', 'the provider did not give a verified email');
      user = users.byEmail(email) ?? null;
      // an account on first sign-in, for the domains the provider names
      if (!user && p.autoCreate) {
        const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 100) : email.split('@')[0];
        user = users.create({ email, name, role: p.autoCreate.role });
        audit.log(ctx, 'user.create', { target: user.id, detail: { role: p.autoCreate.role, via: `sso:${p.id}` } });
        app.notices?.tell({ kind: 'user.invited', level: 'warn', text: `${user.name} (${user.email}) joined as ${p.autoCreate.role}, signing in with ${p.label}.`, link: `#/users?user=${user.id}`, to: 'administrators' });
      }
      if (!user) return fail(ctx, p, 'no-account', `no person with ${email}`);
      // one link per person and provider: another id from the same provider for them is someone else
      if (db.prepare('SELECT 1 FROM sso_identities WHERE provider = ? AND user_id = ?').get(p.id, user.id)) return fail(ctx, p, 'no-account', 'already linked to another account at this provider', user.id);
      db.prepare('INSERT INTO sso_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)').run(p.id, claims.sub, user.id, email, nowIso(app.clock()));
      audit.log(ctx, 'auth.sso.link', { target: user.id, detail: { provider: p.id } });
    }
    if (user.disabled) return fail(ctx, p, 'disabled', 'account turned off', user.id);
    db.prepare('UPDATE sso_identities SET last_at = ?, email = ? WHERE provider = ? AND subject = ?').run(nowIso(app.clock()), email, p.id, claims.sub);
    // two-step sign-in is the person's own: still asked, the challenge in a cookie for the code screen
    if (user.totp_secret) {
      ctx.res.appendHeader('Set-Cookie', cookie(SSO_STEP, challenges.create(user.id), { maxAge: 300 }));
      return go(ctx, editor(`#/sign-in?step=code&via=sso&next=${encodeURIComponent(row.next ?? '#/')}`));
    }
    app.signIn(ctx, user, 'auth.sso');
    return go(ctx, editor(row.next ?? '#/'));
  }, { auth: false });

  const person = (ctx) => {
    const row = users.get(ctx.params.uid);
    if (!row) throw notFound('No such user.');
    if (!canManageUser(ctx.user, users.toPublic(row))) throw forbidden('You cannot manage this user.');
    return row;
  };
  router.add('GET', '/users/:uid/sso', (ctx) => {
    const row = person(ctx);
    return db.prepare('SELECT provider, email, created_at, last_at FROM sso_identities WHERE user_id = ? ORDER BY provider').all(row.id).map((l) => ({ provider: l.provider, label: providerOf(l.provider)?.label ?? l.provider, email: l.email, createdAt: l.created_at, lastAt: l.last_at }));
  });
  router.add('DELETE', '/users/:uid/sso/:provider', (ctx) => {
    const row = person(ctx);
    const n = db.prepare('DELETE FROM sso_identities WHERE user_id = ? AND provider = ?').run(row.id, ctx.params.provider).changes;
    if (!n) throw notFound('No such link.');
    audit.log(ctx, 'auth.sso.unlink', { target: row.id, detail: { provider: ctx.params.provider } });
    return { ok: true };
  });
}
