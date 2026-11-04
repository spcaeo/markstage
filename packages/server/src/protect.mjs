// Password-protected pages (WordPress feature) for a static site. The entry gets `protected: true`; the site's build
// writes those pages to a private folder instead of the public one; the web server sends requests it cannot find
// publicly to Markstage (or asks it via nginx `auth_request`), and Markstage serves the page only to a visitor who
// typed the page password. The password hash lives in the data dir, never in the repo.
//
// Editor API (signed in):  PUT    collections/:c/entries/:id/protection {version, password}
//                          DELETE collections/:c/entries/:id/protection?version=
// Visitor side (site host): GET  <page path>                -> the page (valid cookie) or the password form
//                           POST /markstage/unlock           form: path, password -> 303 back with a page cookie
//                           GET  /markstage/page-auth        nginx auth_request: X-Original-URI -> 204 | 401
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, verifyPassword } from './auth/passwords.mjs';
import { isInside } from './config.mjs';
import { clientIp, readRaw } from './http.mjs';
import { HttpError, forbidden, invalid, sha256 } from './util.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PAGE_PATH = /^\/[A-Za-z0-9/_.~-]*$/;

/** A request path as a safe page path ("/a/b/"), or null (encoded tricks, dot segments, odd characters). */
export function pagePath(raw) {
  let p;
  try {
    p = decodeURIComponent(String(raw ?? '').split('?')[0]);
  } catch {
    return null;
  }
  if (!PAGE_PATH.test(p) || p.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  return p.endsWith('/') || path.extname(p) ? p : `${p}/`;
}

export function protectRoutes(router, app, entries, deployJob) {
  const { db, store, converter } = app;

  const setFlag = (c, text, on) =>
    c.format === 'md' ? converter.setFrontmatter(text, { protected: on ? true : null }) : converter.applyJsonChanges(text, [on ? { path: 'protected', value: true } : { path: 'protected', delete: true }]);

  async function change(ctx, on) {
    const c = store.collection(ctx.params.c);
    const id = ctx.params.id;
    const version = on ? ctx.body.version : ctx.query.get('version');
    let pwHash = null;
    if (on) {
      const pw = ctx.body.password;
      if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) throw invalid({ password: 'Use 8 to 200 characters.' });
      pwHash = await hashPassword(pw);
    }
    const out = await entries.saveEntry(ctx, c, id, {
      version,
      message: `${on ? 'Protect' : 'Unprotect'} ${c.id}/${id}`,
      action: on ? 'entry.protect' : 'entry.unprotect',
      allowStatus: true,
      check: (summary, rights) => {
        if (!rights.publish) throw forbidden('Your role cannot change who can see this page.');
      },
      build: (cur) => ({ text: setFlag(c, cur.text, on) }),
    });
    const prev = db.prepare('SELECT pw_version FROM protected_pages WHERE collection = ? AND entry_id = ?').get(c.id, id);
    if (on) {
      // a new password bumps the version, so every cookie for the old one stops working
      db.prepare(
        `INSERT INTO protected_pages (collection, entry_id, pw_hash, pw_version, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(collection, entry_id) DO UPDATE SET pw_hash = excluded.pw_hash, pw_version = excluded.pw_version, updated_at = excluded.updated_at`,
      ).run(c.id, id, pwHash, (prev?.pw_version ?? 0) + 1, new Date(app.clock()).toISOString());
    }
    // on unprotect the row stays: if the rebuild fails, the revert restores the flag and the old password still works
    // a live page moves between the public and the private build output: rebuild
    const job = out.commit && out.summary.status === 'published' ? deployJob(ctx, c, id, on ? 'protect' : 'unprotect', out) : null;
    if (job) ctx.status = 202;
    return { ok: true, version: out.version, protected: on, job };
  }

  router.add('PUT', '/collections/:c/entries/:id/protection', (ctx) => change(ctx, true));
  router.add('DELETE', '/collections/:c/entries/:id/protection', (ctx) => change(ctx, false));
}

/** The visitor side, answered on the site's own host names (config.protectedPages.hosts). */
export function createPageGate(app) {
  const { db, config, store, limiter, audit } = app;
  const opts = config.protectedPages;
  const cookieMs = (opts.cookieHours ?? 12) * 3_600_000;

  // the cookie signing key: random, made once, kept in the data dir database
  let secret = db.prepare("SELECT value FROM kv WHERE key = 'pageCookieSecret'").get()?.value;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64url');
    db.prepare("INSERT INTO kv (key, value) VALUES ('pageCookieSecret', ?)").run(secret);
  }
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');

  /** The protected entry whose current URL is this path, with its password row. */
  function find(p) {
    for (const row of db.prepare('SELECT * FROM protected_pages').all()) {
      let c;
      try {
        c = store.collection(row.collection);
        const { text } = store.read(c, row.entry_id);
        // the file decides: a reverted or removed flag means not protected, whatever the password table holds
        if (store.fieldsOf(c, text).protected !== true) continue;
        const s = store.summarize(c, row.entry_id, text);
        if (s.url && pagePath(s.url) === p) return { row, url: p };
      } catch {
        // entry gone or collection removed: not served
      }
    }
    return null;
  }

  const cookieName = (url) => `ms_p_${sha256(url).slice(0, 16)}`;
  function validCookie(req, hit) {
    const raw = String(req.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName(hit.url)}=`));
    if (!raw) return false;
    const [exp, mac] = raw.slice(raw.indexOf('=') + 1).split('.');
    if (!(Number(exp) > app.clock())) return false;
    const want = sign(`${hit.url}|${hit.row.pw_version}|${exp}`);
    return mac?.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
  }

  function pageFile(url) {
    const root = fs.realpathSync(opts.dir);
    const candidates = url.endsWith('/') ? [path.join(root, url, 'index.html')] : [path.join(root, url)];
    for (const f of candidates) {
      if (!isInside(root, f) || !fs.existsSync(f)) continue;
      const realF = fs.realpathSync(f);
      if (isInside(root, realF) && fs.statSync(realF).isFile()) return realF;
    }
    return null;
  }

  function headers(res) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
  }

  function form(res, url, status = 200, message = '') {
    headers(res);
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Protected page</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:26rem;margin:15vh auto;padding:0 1rem}input,button{font:inherit;padding:.5rem;width:100%;box-sizing:border-box;margin:.25rem 0}p.e{color:#b00020}</style></head>
<body><h1>This page is protected</h1><p>Enter the password to read it.</p>${message ? `<p class="e" role="alert">${esc(message)}</p>` : ''}
<form method="post" action="${esc(config.basePath)}/unlock"><input type="hidden" name="path" value="${esc(url)}">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Open page</button></form></body></html>`);
  }

  const notFoundPage = (res) => {
    headers(res);
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  };

  const allowedOrigins = new Set(opts.hosts.flatMap((h) => [`https://${h}`, ...(/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h) ? [`http://${h}`] : [])]));

  async function unlock(req, res, ctx) {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      audit.log(ctx, 'security.origin', { ok: false, target: 'page.unlock', detail: { origin: origin ?? null } });
      throw forbidden('Cross-site request refused.');
    }
    const body = new URLSearchParams((await readRaw(req, 4096)).toString('utf8'));
    const url = pagePath(body.get('path'));
    const hit = url && find(url);
    if (!hit) return notFoundPage(res);
    const key = `page:${hit.row.collection}/${hit.row.entry_id}`;
    // the progressive lock is per (page, address): one guesser locks only themselves out; the page for everyone
    // only after login.accountMaxFailures misses in an hour (auth/limiter.mjs)
    limiter.ipCheck(ctx.ip);
    limiter.accountCheck(key, ctx.ip);
    if (!(await verifyPassword(body.get('password') ?? '', hit.row.pw_hash))) {
      const locked = limiter.accountFailure(key, ctx.ip);
      audit.log(ctx, 'page.unlock.fail', { ok: false, target: key, ...(locked ? { detail: { locked: locked.scope, seconds: locked.seconds } } : {}) });
      return form(res, url, 401, 'That password is not right.');
    }
    limiter.accountSuccess(key, ctx.ip);
    const exp = app.clock() + cookieMs;
    headers(res);
    res.setHeader('Set-Cookie', `${cookieName(url)}=${exp}.${sign(`${url}|${hit.row.pw_version}|${exp}`)}; Path=${url}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(cookieMs / 1000)}`);
    res.statusCode = 303;
    res.setHeader('Location', url);
    res.end();
  }

  /** Handle a request on a site host. Everything else on these hosts is 404: the CMS API is not reachable there. */
  async function handle(req, res, url) {
    const ctx = { ip: clientIp(req, config.trustProxy), userAgent: req.headers['user-agent'] ?? '' };
    // the page is the site's own HTML: drop the CMS's API policy headers set earlier; the form sets its own CSP
    for (const h of ['Content-Security-Policy', 'Cross-Origin-Resource-Policy', 'Cross-Origin-Opener-Policy', 'Permissions-Policy']) res.removeHeader(h);
    try {
      if (req.method === 'POST' && url.pathname === `${config.basePath}/unlock`) return await unlock(req, res, ctx);
      if (req.method === 'GET' && url.pathname === `${config.basePath}/page-auth`) {
        const p = pagePath(req.headers['x-original-uri']);
        const hit = p && find(p);
        res.statusCode = hit && validCookie(req, hit) ? 204 : 401;
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return notFoundPage(res);
      const p = pagePath(url.pathname);
      const hit = p && find(p);
      const file = hit && pageFile(p);
      if (!file) return notFoundPage(res);
      if (!validCookie(req, hit)) return form(res, p);
      headers(res);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(fs.readFileSync(file));
    } catch (err) {
      if (!(err instanceof HttpError)) console.error('[markstage] page gate:', err?.stack ?? err);
      headers(res);
      res.statusCode = err instanceof HttpError ? err.status : 500;
      if (err?.extra?.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(err instanceof HttpError ? err.message : 'Something went wrong.');
    }
  }

  return { handle, hosts: new Set(opts.hosts) };
}

