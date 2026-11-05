// Outside production: the site behind sign-in (the gate), and branch previews (docs/ENVIRONMENTS.md "Safety on
// non-production"). Every answer here says noindex. Only people with a Markstage account on this server get in:
//
//   CMS host    GET  /markstage/gate?host=&to=     signed in: a page that posts a one-time ticket to that host
//   site host   POST /markstage/gate-enter         ticket -> the gate cookie (12 hours) -> 303 to the page
//               GET  /markstage/gate-auth          for nginx auth_request: 204 with a good cookie, else 401
//               GET  <any path>                    the build (verify.public, or a preview's build) with the cookie;
//                                                  without it, 303 to the CMS's gate page
//   API         GET    /env/previews               the branch previews
//               POST   /env/previews {branch}      build a branch at <branch>.<previews host> (rules: action preview)
//               DELETE /env/previews/:slug
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atLeast } from '../roles.mjs';
import { runCommand } from '../jobs.mjs';
import { SAFE_PATH, readRaw } from '../http.mjs';
import { staticFileIn } from '../static-file.mjs';
import { HttpError, badRequest, forbidden, newToken, notFound, nowIso, sha256 } from '../util.mjs';
import { isBranch } from './config.mjs';
import { decide } from './rules.mjs';

const COOKIE = 'ms_gate';
const COOKIE_MS = 12 * 3_600_000;
const TICKET_MS = 60_000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.pdf': 'application/pdf' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const isLoopbackHost = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);

/** A branch's preview name: lowercase letters, digits and dashes (a host name label). */
export const slugOf = (branch) => branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'branch';

export function createSiteGate(app, { ops, rules }) {
  // a branch preview cut by a restart, or whose server process stopped (its job failed: jobs.mjs), did not build
  app.cluster?.onReap(({ startup, alone, jobs: cut }) => {
    const why = startup ? 'The server restarted while it was building.' : 'The server process building it stopped.';
    if (startup && alone) app.db.prepare("UPDATE env_previews SET status = 'failed', error = ? WHERE status = 'building'").run(why);
    else for (const j of cut) app.db.prepare("UPDATE env_previews SET status = 'failed', error = ? WHERE status = 'building' AND job_id = ?").run(why, j);
  });
  const { config, db, clock, audit, jobs } = app;
  const env = config.environment;
  const on = !env.production && env.gate;
  const siteHosts = new Set(config.siteHosts);
  const previewRe = env.previews ? new RegExp(`^${env.previews.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{branch\\}', '([a-z0-9-]{1,40})')}$`) : null;
  const previewsDir = path.join(config.dataDir, 'env', 'previews');
  const basePath = config.basePath;

  const kv = (k) => db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value ?? null;
  let key = kv('env.gate.key');
  if (!key) {
    key = newToken(32);
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run('env.gate.key', key);
    key = kv('env.gate.key');
  }
  const sign = (s) => crypto.createHmac('sha256', key).update(s).digest('base64url');

  /**
   * The person a request's gate cookie names, if it is good: signed, not expired, account on, and the CMS session it
   * was opened from still live, so signing out of the CMS (or a revoked or timed-out session) ends it too, as the
   * preview cookie does (review 3 Nov 2026, S11). Cookie: <exp>.<userId>.<sessionId>.<hmac of those and the host>.
   */
  function gateUser(req, host) {
    const raw = String(req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const [exp, uid, sid, sig] = raw.slice(COOKIE.length + 1).split('.');
    const want = sign(`${exp}.${uid}.${sid}.${host}`);
    if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    if (!(Number(exp) > clock())) return null;
    if (app.sessions.alive(sid)?.userId !== uid) return null;
    const u = app.users.get(uid);
    return u && !u.disabled && u.role ? u : null;
  }

  /** Is this host one the gate answers (a site host outside production, or a preview)? Returns its folder or null. */
  function hostOf(host) {
    if (on && siteHosts.has(host)) return { kind: 'site', dir: config.verify?.public ?? null };
    const m = previewRe?.exec(host);
    if (!m) return null;
    const row = db.prepare('SELECT * FROM env_previews WHERE slug = ?').get(m[1]);
    const dir = row && config.verify?.public ? path.join(previewsDir, row.slug, path.relative(config.contentRoot, config.verify.public)) : null;
    return { kind: 'preview', dir, row };
  }

  const scheme = (host) => (isLoopbackHost(host) ? 'http' : 'https');

  function send(res, status, type, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }

  /** The static file at a site path in `dir`, or null (never outside it, links followed: static-file.mjs). */
  const fileOf = (dir, p) => staticFileIn(dir, p);

  /** Handle a request on a gated host; false when the host is not one (the caller goes on). */
  async function handle(req, res, url) {
    const host = String(req.headers.host ?? '').toLowerCase();
    const where = hostOf(host);
    if (!where) return false;
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (url.pathname === `${basePath}/gate-auth`) {
      res.statusCode = gateUser(req, host) ? 204 : 401;
      return res.end(), true;
    }
    if (url.pathname === `${basePath}/gate-enter` && req.method === 'POST') {
      const form = new URLSearchParams((await readRaw(req, 4096)).toString('utf8'));
      const hash = sha256(form.get('ticket') ?? '');
      const t = db.prepare('SELECT * FROM env_gate_tickets WHERE ticket_hash = ?').get(hash);
      db.prepare('DELETE FROM env_gate_tickets WHERE ticket_hash = ? OR expires_at < ?').run(hash, clock());
      // the ticket names the CMS session it was made in (<sessionId>.<random>; the stored hash proves it is ours)
      const sid = String(form.get('ticket') ?? '').split('.')[0];
      if (!t || t.expires_at < clock() || t.host !== host || app.sessions.alive(sid)?.userId !== t.user_id) return send(res, 403, 'text/plain; charset=utf-8', 'This sign-in link is used or too old. Open the page again.'), true;
      const exp = clock() + COOKIE_MS;
      res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${t.user_id}.${sid}.${sign(`${exp}.${t.user_id}.${sid}.${host}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MS / 1000}${scheme(host) === 'https' ? '; Secure' : ''}`);
      res.statusCode = 303;
      // the ticket's path was checked when it was made; checked again here so a row can never send anyone elsewhere
      res.setHeader('Location', SAFE_PATH.test(t.to_path) ? t.to_path : '/');
      return res.end(), true;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'text/plain; charset=utf-8', 'Read only.'), true;
    if (!gateUser(req, host)) {
      res.statusCode = 303;
      res.setHeader('Location', `${config.publicOrigin}${basePath}/gate?host=${encodeURIComponent(host)}&to=${encodeURIComponent(url.pathname + url.search)}`);
      res.setHeader('Cache-Control', 'no-store');
      return res.end(), true;
    }
    if (where.kind === 'preview' && where.row?.status !== 'ready') return send(res, 404, 'text/plain; charset=utf-8', where.row ? `The preview of ${where.row.branch} is ${where.row.status}.` : 'There is no preview here.'), true;
    const file = where.dir ? fileOf(where.dir, url.pathname) : null;
    if (!file) return send(res, 404, 'text/plain; charset=utf-8', where.dir ? 'Not found.' : 'This server has no build folder to show (verify.public).'), true;
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(file).pipe(res);
    return true;
  }

  /** The CMS's gate page: signed in, it hands a one-time ticket to the gated host; else it says to sign in. */
  function gatePage(req, res, url, session) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const host = String(url.searchParams.get('host') ?? '').toLowerCase();
    const to = url.searchParams.get('to') ?? '/';
    // SAFE_PATH: one leading slash, never `//` or `/\` (a browser reads `/\evil.example` as another host), no control characters
    if (!hostOf(host) || !SAFE_PATH.test(to)) return send(res, 400, 'text/plain; charset=utf-8', 'Not a page of this environment.');
    if (!session) return send(res, 401, 'text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><title>Sign in</title><p>This is the ${esc(env.name)} site: only people with an account here see it. <a href="${esc(basePath)}/">Sign in to Markstage</a>, then open the page again.`);
    // the session it is made in goes with it, so the cookie it becomes dies with that session (gateUser)
    const ticket = `${session.id}.${newToken(32)}`;
    db.prepare('INSERT INTO env_gate_tickets (ticket_hash, user_id, host, to_path, expires_at) VALUES (?, ?, ?, ?, ?)').run(sha256(ticket), session.userId, host, to, clock() + TICKET_MS);
    const action = `${scheme(host)}://${host}${basePath}/gate-enter`;
    res.setHeader('Content-Security-Policy', `default-src 'none'; form-action ${scheme(host)}://${host}; script-src 'sha256-${crypto.createHash('sha256').update(SUBMIT).digest('base64')}'`);
    return send(res, 200, 'text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><title>Opening ${esc(env.name)}</title><form method="post" action="${esc(action)}"><input type="hidden" name="ticket" value="${ticket}"><button>Open the ${esc(env.name)} site</button></form><script>${SUBMIT}</script>`);
  }
  const SUBMIT = 'document.forms[0].submit()';

  // ---- branch previews ----------------------------------------------------------------------------------------

  const urlOf = (slug) => (env.previews ? `${scheme(env.previews.host)}://${env.previews.host.replace('{branch}', slug)}/` : null);
  const toPublic = (r) => ({ slug: r.slug, branch: r.branch, sha: r.sha, status: r.status, url: urlOf(r.slug), createdAt: r.created_at, builtAt: r.built_at, job: r.job_id, error: r.error });

  function previews(ctx) {
    if (!env.previews) return { on: false, previews: [] };
    return { on: env.previews.branches, host: env.previews.host, previews: db.prepare('SELECT * FROM env_previews ORDER BY created_at DESC').all().map(toPublic) };
  }

  async function addPreview(ctx) {
    if (!env.previews?.branches) throw new HttpError(409, 'not-set-up', 'Branch previews are off on this server (environment.previews).');
    const branch = ctx.body?.branch;
    if (!isBranch(branch ?? '')) throw badRequest('branch is the name of a branch on the remote.');
    const d = decide(rules.get(), { user: ctx.user, action: 'preview', from: 'branch', to: env.name, files: null, at: clock() });
    if (d.effect !== 'allow') {
      audit.log(ctx, 'env.preview', { ok: false, target: branch, detail: { rule: d.rule?.id ?? null, words: d.words } });
      throw new HttpError(403, 'rule', d.words, { rule: d.rule, words: d.words });
    }
    const slug = slugOf(branch);
    const other = db.prepare('SELECT branch FROM env_previews WHERE slug = ?').get(slug);
    if (other && other.branch !== branch) throw new HttpError(409, 'taken', `The preview address ${slug} is the branch ${other.branch}'s. Remove that preview first.`);
    db.prepare("INSERT INTO env_previews (slug, branch, status, created_by, created_at) VALUES (?, ?, 'building', ?, ?) ON CONFLICT(slug) DO UPDATE SET status = 'building', error = NULL").run(slug, branch, ctx.user.id, nowIso(clock()));
    const job = jobs.enqueue({
      kind: 'env-preview',
      user: ctx.user,
      target: slug,
      run: async (step) => {
        let sha = null;
        await step('fetch', async (log) => {
          const r = await ops.fetch();
          sha = await ops.sha(ops.remoteRef(branch));
          log(sha ? `${branch} is at ${sha}\n` : `${r.error ?? `no branch ${branch} on ${env.remote}`}\n`);
          return sha ? 0 : { code: 1, reason: `(there is no branch ${branch} on ${env.remote})` };
        });
        const dir = path.join(previewsDir, slug);
        await step('checkout', async (log) => {
          await removeTree(dir);
          fs.mkdirSync(previewsDir, { recursive: true, mode: 0o700 });
          await app.git.git(['worktree', 'add', '--detach', '--force', dir, sha]);
          const nm = path.join(config.contentRoot, 'node_modules');
          if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, 'node_modules'), 'dir');
          log(`checked out ${sha} in ${dir}\n`);
          return 0;
        });
        if (config.commands.build) {
          await step('build', async (log) => {
            const { code } = await runCommand(config.commands.build, { cwd: dir, env: { ...config.commands.env, MARKSTAGE_BUILD_TIME: nowIso(clock()) }, timeoutSeconds: config.commands.timeoutSeconds, onOutput: log });
            return code;
          });
        }
        db.prepare("UPDATE env_previews SET status = 'ready', sha = ?, built_at = ?, error = NULL WHERE slug = ?").run(sha, nowIso(clock()), slug);
      },
      onFail: async () => db.prepare("UPDATE env_previews SET status = 'failed', error = 'The preview did not build: see the job log.' WHERE slug = ?").run(slug),
    });
    db.prepare('UPDATE env_previews SET job_id = ? WHERE slug = ?').run(job, slug);
    audit.log(ctx, 'env.preview', { target: branch, detail: { slug, job } });
    ctx.status = 202;
    return { preview: toPublic(db.prepare('SELECT * FROM env_previews WHERE slug = ?').get(slug)), job };
  }

  async function removeTree(dir) {
    if (!fs.existsSync(dir)) return;
    await app.git.git(['worktree', 'remove', '--force', dir], { allowFail: true });
    fs.rmSync(dir, { recursive: true, force: true });
    await app.git.git(['worktree', 'prune'], { allowFail: true });
  }

  async function removePreview(ctx) {
    const r = db.prepare('SELECT * FROM env_previews WHERE slug = ?').get(ctx.params.slug);
    if (!r) throw notFound('No such preview.');
    if (r.created_by !== ctx.user.id && !atLeast(ctx.user, 'administrator')) throw forbidden('Only who made the preview, an administrator or the owner removes it.');
    await removeTree(path.join(previewsDir, r.slug));
    db.prepare('DELETE FROM env_previews WHERE slug = ?').run(r.slug);
    audit.log(ctx, 'env.preview.remove', { target: r.branch, detail: { slug: r.slug } });
    return { removed: r.slug };
  }

  function routes(router) {
    router.add('GET', '/env/previews', (ctx) => previews(ctx));
    router.add('POST', '/env/previews', (ctx) => addPreview(ctx));
    router.add('DELETE', '/env/previews/:slug', (ctx) => removePreview(ctx));
  }

  /** Is this a host the gate answers (so the CMS's host check lets it through to handle)? */
  const answers = (host) => Boolean(hostOf(String(host ?? '').toLowerCase()));

  return { handle, gatePage, routes, answers, gateUser };
}
