// Personal access tokens, with the rights of the person who made them and no more, of two kinds that never mix:
// - the laptop CLI's (`markstage login|status|promote`): env:read, env:promote; they reach the Environments routes
//   only (/env/...). GET routes need env:read; every write needs env:promote.
// - an AI agent's (the MCP server, mcp/index.mjs; `markstage mcp`): mcp:read, mcp:draft, mcp:publish; they reach /mcp
//   only, and the tool decides what each scope lets through (mcp:draft and mcp:publish need mcp:read, which they
//   bring). mcp:publish is an owner's or administrator's to give, and is never ticked for them.
//
//   GET    /me/tokens            the signed-in person's tokens (never the secret)
//   POST   /me/tokens            {name, scopes: ['env:read', 'env:promote'] | ['mcp:read', 'mcp:draft'], days: 1..90}
//                                 -> 201 {token, secret}
//   DELETE /me/tokens/:tid       revoke (kept, marked revoked); a job started with it stops at its next step
//
// Only a browser session manages tokens: a token cannot make or list tokens. A token's secret is shown once and
// stored as a SHA-256 hash. Wrong tokens are counted per address: 20 misses in 10 minutes and that address waits
// (429). Each use records when and from where.
import { HttpError, badRequest, forbidden, newId, newToken, notFound, nowIso, sha256 } from '../util.mjs';
import { atLeast } from '../roles.mjs';
import { limitKey } from '../cluster/limits.mjs';

export const SCOPES = ['env:read', 'env:promote'];
// mcp:publish lets an agent ask to publish a release (mcp/publish.mjs): made by an owner or administrator only
export const MCP_SCOPES = ['mcp:read', 'mcp:draft', 'mcp:publish'];
/** The two kinds, with where each reaches: a token's scopes are all of one kind. */
export const GROUPS = { cli: { scopes: SCOPES, reaches: '/env' }, mcp: { scopes: MCP_SCOPES, reaches: '/mcp' } };
const groupOf = (scopes) => (scopes.every((s) => MCP_SCOPES.includes(s)) ? 'mcp' : 'cli');
const MAX_DAYS = 90;
const PREFIX = 'mst_';
const MISS_WINDOW_MS = 10 * 60_000;
const MISS_MAX = 20;

const toPublic = (r, now) => ({
  id: r.id,
  name: r.name,
  scopes: r.scopes.split(' '),
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
  status: r.revoked_at ? 'revoked' : Date.parse(r.expires_at) <= now ? 'expired' : 'active',
});

export function createTokens(app) {
  const { db, clock, audit } = app;
  // wrong tokens per address: in the database, counted by every server process (cluster/limits.mjs)
  const BUCKET = 'token.miss';
  const hits = app.cluster.hits;

  function missCheck(ip) {
    const now = clock();
    const { n, oldest } = hits.count(BUCKET, limitKey(ip), MISS_WINDOW_MS, now);
    if (n >= MISS_MAX) throw new HttpError(429, 'rate-limited', 'Too many wrong tokens from your network. Try again later.', { retryAfter: Math.max(1, Math.ceil((oldest + MISS_WINDOW_MS - now) / 1000)) });
  }

  /**
   * The person behind `Authorization: Bearer mst_…` for an /env route, or throws 401/403/429. Sets ctx.user and
   * ctx.token ({id, scopes}).
   */
  function authenticate(ctx, header, routePath, method) {
    missCheck(ctx.ip ?? 'unknown');
    const secret = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? '';
    const now = clock();
    const row = secret.startsWith(PREFIX) ? db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(sha256(secret)) : null;
    const user = row ? app.users.get(row.user_id) : null;
    const dead = !row || row.revoked_at || Date.parse(row.expires_at) <= now || !user || user.disabled;
    if (dead) {
      hits.add(BUCKET, limitKey(ctx.ip ?? 'unknown'), MISS_WINDOW_MS, { at: now });
      audit.log(ctx, 'security.token', { ok: false, target: routePath, detail: { why: !row ? 'unknown' : row.revoked_at ? 'revoked' : !user || user.disabled ? 'user' : 'expired' } });
      // a new one is made where this kind is: the command line's with `markstage login`, an agent's with `markstage mcp login`
      const again = row && groupOf(row.scopes.split(' ')) === 'mcp' ? 'Make a new one at Settings → Tokens and give it to the agent (`markstage mcp login`).' : 'Make a new one with `markstage login`.';
      throw new HttpError(401, 'unauthorized', row?.revoked_at ? `This token was revoked. ${again}` : row && Date.parse(row.expires_at) <= now ? `This token has expired. ${again}` : 'Unknown token.');
    }
    const scopes = row.scopes.split(' ');
    if (groupOf(scopes) === 'mcp') {
      // an agent's token: the MCP endpoint and nothing else (each tool checks its own scope)
      if (routePath !== '/mcp') throw forbidden('This token is for the MCP server (/mcp) only.');
    } else {
      if (!routePath.startsWith('/env/') && routePath !== '/env') throw forbidden('A token reaches the Environments routes only.');
      const need = method === 'GET' || method === 'HEAD' ? 'env:read' : 'env:promote';
      if (!scopes.includes(need)) throw forbidden(`This token does not have ${need}.`);
    }
    db.prepare('UPDATE api_tokens SET last_used_at = ?, last_used_ip = ? WHERE id = ?').run(nowIso(now), ctx.ip ?? null, row.id);
    ctx.user = app.users.toPublic(user);
    ctx.token = { id: row.id, name: row.name, scopes };
  }

  /** Is the token still good (a job started with it checks before each step)? */
  function alive(id) {
    if (!id) return true;
    const r = db.prepare('SELECT revoked_at, expires_at, user_id FROM api_tokens WHERE id = ?').get(id);
    const u = r && app.users.get(r.user_id);
    return Boolean(r && !r.revoked_at && Date.parse(r.expires_at) > clock() && u && !u.disabled);
  }

  const mine = (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'unauthorized', 'Please sign in.');
    if (ctx.token) throw forbidden('Tokens are made and revoked in a browser session, not with a token.');
  };

  function routes(router) {
    router.add('GET', '/me/tokens', (ctx) => {
      mine(ctx);
      const now = clock();
      return { tokens: db.prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').all(ctx.user.id).map((r) => toPublic(r, now)), scopes: SCOPES, mcpScopes: MCP_SCOPES, groups: GROUPS, maxDays: MAX_DAYS, canMcpPublish: atLeast(ctx.user, 'administrator') };
    });
    router.add('POST', '/me/tokens', (ctx) => {
      mine(ctx);
      const b = ctx.body ?? {};
      const name = typeof b.name === 'string' ? b.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
      if (!name || name.length > 80) throw badRequest('Give the token a name (text, at most 80 characters), such as "Sam\'s laptop".');
      let scopes = [...new Set(b.scopes ?? ['env:read'])];
      if (!scopes.length || scopes.some((s) => !SCOPES.includes(s) && !MCP_SCOPES.includes(s))) throw badRequest(`scopes is a list of ${SCOPES.join(', ')} (the command line), or of ${MCP_SCOPES.join(', ')} (an AI agent).`);
      if (scopes.some((s) => SCOPES.includes(s)) && scopes.some((s) => MCP_SCOPES.includes(s))) throw badRequest('A token is for the command line (env:…) or for an AI agent (mcp:…), not both: make two.');
      // publishing is asked for by name, and only an owner or administrator may give it to an agent
      if (scopes.includes('mcp:publish') && !atLeast(ctx.user, 'administrator')) throw forbidden('Only an owner or administrator can make a token that lets an AI agent publish.');
      // drafting and publishing read first: mcp:draft and mcp:publish bring mcp:read
      if ((scopes.includes('mcp:draft') || scopes.includes('mcp:publish')) && !scopes.includes('mcp:read')) scopes = ['mcp:read', ...scopes];
      const days = b.days ?? 30;
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw badRequest(`days is 1 to ${MAX_DAYS}.`);
      const live = db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?').get(ctx.user.id, nowIso(clock())).n;
      if (live >= 20) throw new HttpError(409, 'too-many', 'You have 20 tokens. Revoke one first.');
      const id = newId('tk');
      const secret = `${PREFIX}${newToken(32)}`;
      const now = clock();
      db.prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ctx.user.id, name, sha256(secret), scopes.join(' '), nowIso(now), nowIso(now + days * 86_400_000));
      audit.log(ctx, 'token.create', { target: id, detail: { name, scopes, days } });
      ctx.status = 201;
      return { token: toPublic(db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id), now), secret };
    });
    router.add('DELETE', '/me/tokens/:tid', (ctx) => {
      mine(ctx);
      const r = db.prepare('SELECT * FROM api_tokens WHERE id = ? AND user_id = ?').get(ctx.params.tid, ctx.user.id);
      if (!r) throw notFound('No such token.');
      if (!r.revoked_at) db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(nowIso(clock()), r.id);
      audit.log(ctx, 'token.revoke', { target: r.id, detail: { name: r.name } });
      return { token: toPublic(db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(r.id), clock()) };
    });
  }

  return { authenticate, alive, routes, reset: () => db.prepare('DELETE FROM limit_hits WHERE bucket = ?').run(BUCKET) };
}
