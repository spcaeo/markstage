// Share links (docs/API-RELEASES.md "Share links"): a release's preview, or one draft as it would go live, for
// people without an account. A link is an unguessable token (only its hash is kept) that expires (7 days by
// default, 30 at most) and can be turned off; then it answers 410. It is served on its own origin (share.origin),
// never the CMS's: the site's own scripts run there. Opening the link sets a cookie for that link alone and moves
// to the page, so the token leaves the address bar; after that the browser sees that link's build and nothing
// else: no API, no other link, no editor. Every answer says noindex, no-store, no-referrer; every page view is
// audited.
//
//   GET  /share/<token>  the link: a cookie for it, 303 to its page | 404 no such link | 410 expired or turned off
//   GET  <site path>     with the cookie: the build's file (503 while it is being built, it reloads itself)
//   GET  /robots.txt     Disallow: / (whatever the build has)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { clientIp, loopbackAliases, parseCookies } from '../http.mjs';
import { atLeast } from '../roles.mjs';
import { statusText } from '../publish.mjs';
import { HttpError, badRequest, forbidden, newId, newToken, notFound, nowIso, sha1, sha256 } from '../util.mjs';
import { OPEN } from './store.mjs';
import { staticFileIn } from '../static-file.mjs';

const COOKIE = 'ms_share';
const TOKEN = /^\/share\/([A-Za-z0-9_-]{40,60})$/;
// a link's address is tried at most this often per address a minute (guessing is hopeless anyway; this keeps it so)
const PER_MINUTE = 30;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const DAY = 86_400_000;
/** A share link's address holds its token: anything logged says /share/[link] in its place. */
export const redactShare = (s) => String(s).replace(/\/share\/[A-Za-z0-9_-]+/g, '/share/[link]');

/** The static file at a site path in `dir`, or null (never outside it, links followed: static-file.mjs). */
const fileOf = (dir, p) => staticFileIn(dir, p);

export function createShare(app, { rs, builds, pub, entries }) {
  const { db, config, store, clock, audit, converter } = app;
  const sh = config.share;
  const hosts = sh.origin ? new Set([sh.host, ...loopbackAliases(sh.origin).map((o) => new URL(o).host)]) : new Set();
  const nameOf = (uid) => (uid ? (app.users.get(uid)?.name ?? null) : null);

  const kv = (k) => db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value ?? null;
  if (!kv('share.key')) db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run('share.key', newToken(32));
  const key = kv('share.key');
  const sign = (s) => crypto.createHmac('sha256', key).update(s).digest('base64url');

  const tries = new Map(); // address -> the times of its recent /share/ requests
  const sweepTries = setInterval(() => {
    for (const [ip, list] of tries) if (!list.some((t) => t > clock() - 60_000)) tries.delete(ip);
  }, 300_000);
  sweepTries.unref();
  const stateOf = (l) => (l.revoked_at ? 'revoked' : Date.parse(l.expires_at) <= clock() ? 'expired' : 'active');
  const toPublic = (l) => ({
    id: l.id,
    release: l.release_id,
    collection: l.collection,
    entryId: l.entry_id,
    label: l.label,
    state: stateOf(l),
    createdBy: { id: l.created_by, name: nameOf(l.created_by) },
    createdAt: l.created_at,
    expiresAt: l.expires_at,
    revokedAt: l.revoked_at,
    revokedBy: l.revoked_by ? { id: l.revoked_by, name: nameOf(l.revoked_by) } : null,
    views: l.views,
    lastViewAt: l.last_view_at,
  });
  // a build a viewer starts is the link's: its maker hears if it fails
  const creator = (l) => {
    const u = app.users.get(l.created_by);
    return u ? app.users.toPublic(u) : null;
  };
  const linkRow = (lid) => db.prepare('SELECT * FROM share_links WHERE id = ?').get(lid) ?? null;

  // ---- the API (CMS origin) -------------------------------------------------------------------------------------

  function setUp() {
    if (!sh.origin) throw new HttpError(409, 'not-set-up', 'Share links are not set up on this server (share.origin in config.json).');
    if (!builds.servable()) throw new HttpError(409, 'not-set-up', 'Share links show the site’s build, and this server has no build folder (verify.public in config.json).');
  }

  /** {release} or {collection, id}: who may share it, and that it is a thing a link can show. */
  function targetFor(ctx, b) {
    if (b.release !== undefined) {
      const r = rs.must(String(b.release));
      if (!atLeast(ctx.user, 'editor')) throw forbidden('Editors and above share releases.');
      if (!OPEN.includes(r.status)) throw new HttpError(409, 'not-open', `This release is ${r.status}; there is no preview to share.`);
      return { release: r.id };
    }
    let c;
    try {
      c = store.collection(String(b.collection ?? ''));
    } catch {
      throw notFound('No such collection.');
    }
    const cur = store.read(c, String(b.id ?? ''));
    const summary = store.summarize(c, String(b.id), cur.text);
    if (!entries.permissions(ctx, c, summary).edit) throw forbidden('You can only share entries you can edit.');
    if (summary.status === 'published') throw new HttpError(422, 'live', 'This entry is live: share its address on the site instead.');
    if (!summary.url) throw new HttpError(422, 'no-page', 'This entry has no page of its own to show.');
    return { collection: c.id, id: String(b.id) };
  }

  function create(ctx, b = {}) {
    setUp();
    const t = targetFor(ctx, b);
    const days = b.days === undefined ? sh.days : Number(b.days);
    if (!Number.isInteger(days) || days < 1 || days > sh.maxDays) throw badRequest(`A link lasts 1 to ${sh.maxDays} days.`);
    const label = b.label === undefined ? '' : String(b.label).trim();
    if (label.length > 100) throw badRequest('A label is up to 100 characters.');
    const token = newToken(32);
    const id = newId('sl');
    const expires = new Date(clock() + days * DAY).toISOString();
    db.prepare('INSERT INTO share_links (id, token_hash, release_id, collection, entry_id, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, sha256(token), t.release ?? null, t.collection ?? null, t.id ?? null, label, ctx.user.id, nowIso(clock()), expires);
    audit.log(ctx, 'share.create', { target: id, detail: { release: t.release ?? null, entry: t.collection ? `${t.collection}/${t.id}` : null, expiresAt: expires } });
    // the address is shown this once: only its hash is kept
    return { link: toPublic(linkRow(id)), url: `${sh.origin}/share/${token}` };
  }

  function list(ctx, q) {
    const release = q.get('release');
    const c = q.get('collection');
    const id = q.get('id');
    const rows = release ? db.prepare('SELECT * FROM share_links WHERE release_id = ? ORDER BY created_at DESC').all(release) : c && id ? db.prepare('SELECT * FROM share_links WHERE collection = ? AND entry_id = ? ORDER BY created_at DESC').all(c, id) : db.prepare('SELECT * FROM share_links ORDER BY created_at DESC LIMIT 200').all();
    return { links: rows.map(toPublic), on: Boolean(sh.origin) };
  }

  function revoke(ctx, lid) {
    const l = linkRow(lid);
    if (!l) throw notFound('No such link.');
    if (l.created_by !== ctx.user.id && !atLeast(ctx.user, 'editor')) throw forbidden('Only who made the link, or an editor and above, turns it off.');
    if (!l.revoked_at) {
      db.prepare('UPDATE share_links SET revoked_at = ?, revoked_by = ? WHERE id = ?').run(nowIso(clock()), ctx.user.id, lid);
      audit.log(ctx, 'share.revoke', { target: lid });
    }
    return { link: toPublic(linkRow(lid)) };
  }

  // ---- what a link shows ----------------------------------------------------------------------------------------

  /** The build a link shows: {target, key, start()} or {gone: words}. */
  async function showing(l) {
    if (l.release_id) {
      const r = rs.row(l.release_id);
      if (!r) return { gone: 'This release is gone.' };
      if (r.status === 'published') return { gone: 'This release is live now: its pages are on the site.' };
      if (!OPEN.includes(r.status)) return { gone: `This release was ${r.status === 'cancelled' ? 'cancelled' : r.status}.` };
      const pv = await pub.preview(r);
      return { target: pub.target(r), key: pv.key, start: () => pub.buildPreview(r, creator(l)), title: r.name, first: firstPage(r) };
    }
    let c;
    let cur;
    try {
      c = store.collection(l.collection);
      cur = store.read(c, l.entry_id);
    } catch {
      return { gone: 'This page is gone.' };
    }
    const summary = store.summarize(c, l.entry_id, cur.text);
    if (summary.status === 'published') return { gone: 'This page is live now: it is on the site.' };
    const text = statusText(converter, c, cur.text, { draft: null, publishAt: null });
    const head = await app.git.head();
    const k = sha1(`${head}\n${cur.rel}:${sha1(text)}`);
    const target = `e_${c.id}_${l.entry_id}`;
    return { target, key: k, title: summary.title || l.entry_id, first: store.summarize(c, l.entry_id, text).url ?? '/', start: () => builds.ensure(target, { key: k, head, files: [{ rel: cur.rel, bytes: Buffer.from(text, 'utf8') }], buildTime: nowIso(clock()), label: `the shared draft “${summary.title || l.entry_id}”`, user: creator(l) }) };
  }

  /** Where a release's link opens: its first page, else the home page. */
  function firstPage(r) {
    for (const it of rs.items(r.id).filter((i) => i.kind === 'entry')) {
      try {
        const url = store.summarize(store.collection(it.collection), it.entry_id, rs.bytesOf(it).toString('utf8')).url;
        if (url) return url;
      } catch {
        // a collection gone from the config: the next
      }
    }
    return '/';
  }

  // ---- the share origin -----------------------------------------------------------------------------------------

  function headers(res) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (sh.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  function page(res, status, title, words, { refresh = 0 } = {}) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (refresh) {
      res.setHeader('Refresh', String(refresh));
      res.setHeader('Retry-After', String(refresh));
    }
    res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem;color:#222}</style><h1 style="font-size:1.4rem">${esc(title)}</h1><p>${esc(words)}</p></html>`);
  }

  const cookieOf = (l) => {
    const exp = Date.parse(l.expires_at);
    return `${COOKIE}=${l.id}.${exp}.${sign(`${l.id}.${exp}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((exp - clock()) / 1000))}${sh.secure ? '; Secure' : ''}`;
  };
  /** The link a request's cookie names, when its signature is good. */
  function fromCookie(req) {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    const [lid, exp, sig] = String(raw ?? '').split('.');
    if (!lid || !sig) return null;
    const want = sign(`${lid}.${exp}`);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    return linkRow(lid);
  }

  const viewer = (req) => ({ actorName: 'share link', ip: clientIp(req, config.trustProxy), userAgent: req.headers['user-agent'] ?? '' });
  const dead = (req, res, l, how) => {
    audit.log(viewer(req), 'share.refused', { target: l.id, ok: false, detail: { state: stateOf(l), how } });
    page(res, 410, stateOf(l) === 'revoked' ? 'This link was turned off' : 'This link has expired', stateOf(l) === 'revoked' ? 'The person who shared it turned it off. Ask them for a new one.' : 'Share links last a few days. Ask the person who shared it for a new one.');
  };

  async function handle(req, res) {
    headers(res);
    if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) return page(res, 421, 'Not here', 'This server does not answer for that host name.');
    // the CMS's own paths (its API, the MCP endpoint, the editor) are never answered on the share origin, any method
    const asked = String(req.url ?? '/').split(/[?#]/)[0];
    if (asked === config.basePath || asked.startsWith(`${config.basePath}/`)) return page(res, 404, 'Not found', 'There is nothing at this address here.');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return page(res, 405, 'Read only', 'A shared preview can only be looked at.');
    }
    let url;
    try {
      url = new URL(req.url ?? '/', sh.origin);
    } catch {
      return page(res, 400, 'Bad address', 'This address cannot be read.');
    }
    if (url.pathname === '/robots.txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('User-agent: *\nDisallow: /\n');
    }
    // the token is in this address only: never logged or audited (the link's id is), and tried at a limited rate
    if (url.pathname.startsWith('/share/')) {
      const ip = clientIp(req, config.trustProxy) ?? '?';
      const recent = (tries.get(ip) ?? []).filter((t) => t > clock() - 60_000);
      recent.push(clock());
      tries.set(ip, recent);
      if (recent.length > PER_MINUTE) {
        if (recent.length === PER_MINUTE + 1) audit.log(viewer(req), 'share.limited', { ok: false, detail: { perMinute: PER_MINUTE } });
        res.setHeader('Retry-After', '60');
        return page(res, 429, 'Too many tries', 'Wait a minute, then open the link again.');
      }
    }
    const m = TOKEN.exec(url.pathname);
    if (m) {
      const l = db.prepare('SELECT * FROM share_links WHERE token_hash = ?').get(sha256(m[1]));
      if (!l) return page(res, 404, 'No such link', 'Check that the whole address was copied.');
      if (stateOf(l) !== 'active') return dead(req, res, l, 'open');
      const what = await showing(l);
      if (what.gone) return dead410(req, res, l, what.gone);
      audit.log(viewer(req), 'share.open', { target: l.id });
      res.setHeader('Set-Cookie', cookieOf(l));
      res.statusCode = 303;
      res.setHeader('Location', what.first);
      return res.end();
    }
    const l = fromCookie(req);
    if (!l) return page(res, 403, 'Not available to you', 'This preview opens from the link you were given. Open that link again.');
    if (stateOf(l) !== 'active') {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
      return dead(req, res, l, 'view');
    }
    const what = await showing(l);
    if (what.gone) return dead410(req, res, l, what.gone);
    const dir = builds.outDir(what.target, what.key);
    if (!dir) {
      const st = builds.state(what.target, what.key);
      if (st.fresh && st.status === 'failed') return page(res, 503, 'This preview did not build', 'The people who shared it have been told. Try again later.', { refresh: 30 });
      await what.start();
      return page(res, 503, 'Preparing this preview', `“${what.title}” is being built; this page reloads by itself in a few seconds.`, { refresh: 3 });
    }
    let file = fileOf(dir, url.pathname);
    let status = 200;
    if (!file) {
      file = fileOf(dir, '/404.html');
      status = 404;
      if (!file) return page(res, 404, 'Not found', 'There is no page at this address in the preview.');
    }
    res.statusCode = status;
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);
    if (type.startsWith('text/html') && status === 200) {
      db.prepare('UPDATE share_links SET views = views + 1, last_view_at = ? WHERE id = ?').run(nowIso(clock()), l.id);
      audit.log(viewer(req), 'share.view', { target: l.id, detail: { path: url.pathname.slice(0, 300) } });
    }
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  /** The thing shown went live or away: the link has nothing more to show. */
  function dead410(req, res, l, words) {
    audit.log(viewer(req), 'share.refused', { target: l.id, ok: false, detail: { state: 'gone', words } });
    page(res, 410, 'Nothing to show any more', words);
  }

  /** The draft builds no live link shows any more (each release's build goes with it: releases/index.mjs). */
  function shownDrafts() {
    const rows = db.prepare('SELECT DISTINCT collection, entry_id FROM share_links WHERE collection IS NOT NULL AND revoked_at IS NULL AND expires_at > ?').all(nowIso(clock()));
    return new Set(rows.map((r) => `e_${r.collection}_${r.entry_id}`));
  }

  let server = null;
  return {
    shownDrafts,
    create,
    list,
    revoke,
    handle,
    listen(port = sh.port, host = config.host) {
      if (!sh.origin) return Promise.resolve(null);
      server = http.createServer((req, res) =>
        handle(req, res).catch((e) => {
          console.error('[markstage] share:', redactShare(e?.stack ?? e));
          if (!res.headersSent) page(res, 500, 'Something went wrong', 'Try again in a moment.');
          else res.destroy();
        }),
      );
      server.headersTimeout = 30_000;
      server.requestTimeout = 60_000;
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    async close() {
      clearInterval(sweepTries);
      if (!server) return;
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
      server = null;
    },
  };
}
