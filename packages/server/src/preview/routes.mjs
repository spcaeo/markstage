// Preview render on its own origin. A preview runs the author's HTML and the site's own scripts, so it is served
// from `preview.origin`, never from the CMS origin, where such a script could act with the viewer's session.
//
//   CMS      GET  /markstage/api/preview/:c/:id      -> { url } (dev mode: the site's dev server URL)
//   CMS      PUT  /markstage/api/preview/:c/:id/state  the editor's unsaved state for the preview only (no autosave)
//   CMS      GET  /markstage/preview-auth?to=<path>  signed in: a page that posts a one-time ticket to the preview
//                                                    origin (in the form body, never in a URL); else "sign in first"
//   preview  POST /markstage/preview-enter           ticket -> preview cookie bound to the CMS session -> 303 `to`;
//                                                    a repeat (ticket used) with a live preview cookie -> 303 `to` too
//   preview  GET  /markstage/preview/:c/:id/         preview that entry with the caller's autosave -> 303 its page
//   preview  GET  /markstage/preview-agent.js        the measuring script added to every proxied page (agent.mjs)
//   preview  *    anything else (and the HMR socket) proxied to the site's dev server, but for the dev server's
//                 own tools and files outside the site (dev-paths.mjs)
//
// The preview cookie dies with the CMS session (sign-out, revoke, timeout, disabled user).
//
// With several server processes (docs/SCALING.md) the preview listener and its dev server run in the one holding the
// primary role; the CMS side runs in every process. The unsaved states pushed by the editor are in the database
// (preview_states), so the listener shows a state pushed to any process, and it looks every second for a new one of
// the entry it shows (a push or an autosave elsewhere) to refresh the frame as it does for its own.
import http from 'node:http';
import net from 'node:net';
import { COOKIE } from '../auth/sessions.mjs';
import { clientIp, cookie, loopbackAliases, parseCookies, readRaw, SAFE_PATH, sendJson, sendNoRobots } from '../http.mjs';
import { can } from '../roles.mjs';
import { HttpError, badRequest, conflict, forbidden, newToken, notFound, sha256 } from '../util.mjs';
import { createAgent } from './agent.mjs';
import { createDevPaths } from './dev-paths.mjs';
import { createGallery } from './gallery.mjs';
import { createPreviewSite } from './site.mjs';

export const PREVIEW_COOKIE = '__Host-markstage-preview';
const TICKET_MS = 60_000;
/** Pushed preview states kept at most (oldest dropped first); each lives until the entry changes. */
const MAX_STATES = 200;
/** How often the listener looks for a new state of the entry it shows, pushed or autosaved on another process. */
const WATCH_MS = 1000;
const STATE_MS = 6 * 3600_000;
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate']);

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A small plain page (our own pages on either origin; the site's pages are the dev server's). */
function page(res, status, title, body, csp, referrer = 'no-referrer', script = '') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', csp);
  res.removeHeader('X-Frame-Options');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', referrer);
  res.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(title)}</title>` +
      `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222}h1{font-size:1.25rem}</style>` +
      `<h1>${esc(title)}</h1>${body}${script}`,
  );
}

/** Is this a page load (it may change which state the clone shows), rather than an asset or a fetch? */
function isDocument(req) {
  const dest = req.headers['sec-fetch-dest'];
  if (dest) return dest === 'document' || dest === 'iframe';
  return req.method === 'GET' && /text\/html/.test(req.headers.accept ?? '');
}

/**
 * The Cookie header without Markstage's own cookies: the site's code never sees them. Every one of ours is named
 * `__Host-markstage` or `__Host-markstage-…` (session, preview, device), so a new one is left out too.
 */
const siteCookies = (raw) =>
  String(raw ?? '')
    .split(/;\s*/)
    .filter((c) => c && !c.startsWith(`${COOKIE}=`) && !c.startsWith(`${COOKIE}-`))
    .join('; ');

export function createPreview(app, entries) {
  const { config, db, store, sessions, users, audit } = app;
  const pv = config.preview;
  const base = config.basePath;
  const site = pv.origin ? createPreviewSite(app) : null;
  // the dev server's own tools and files outside the site never reach it (dev-paths.mjs; review 3 Nov, S4)
  const devPaths = site ? createDevPaths(site.dir) : null;
  const gallery = createGallery(app);
  const cmsOrigins = [config.publicOrigin, ...loopbackAliases(config.publicOrigin)];
  const previewOrigins = pv.origin ? [pv.origin, ...loopbackAliases(pv.origin)] : [];
  const previewHosts = new Set(previewOrigins.map((o) => new URL(o).host));
  const framedBy = `frame-ancestors ${cmsOrigins.join(' ')}`;
  const agent = createAgent(config, cmsOrigins);
  const OWN_CSP = `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; ${framedBy}`;
  const ENTRY = new RegExp(`^${base}/preview/([a-z][a-z0-9-]{0,39})/([a-z0-9][a-z0-9-]{0,99})/?$`);
  const coll = (id) => config.collections.find((c) => c.id === id);
  /**
   * An entry's page in a region (`?region=en-US`, a locale code of the site config): that locale's copy, e.g.
   * /en-us/blog/x/. No region: the address as is. Unknown region: undefined.
   */
  function regionPath(url, region) {
    if (!region) return url;
    const i = config.locales?.list.findIndex((l) => l.code.toLowerCase() === String(region).toLowerCase()) ?? -1;
    return i < 0 ? undefined : app.site.pathsOf(url)[i];
  }
  /** whose state the clone shows now: { userId, c, id } */
  let shown = null;
  let refreshTimer = null;
  // the server is closing: a request still on its way ends quietly (no error logged for a stop asked for)
  let closing = false;
  /** `${userId}/${c}/${id}` -> { version, text, css, at }: unsaved state pushed by the editor, newer than any autosave */
  const pushed = {
    get(key) {
      const r = db.prepare('SELECT * FROM preview_states WHERE key = ?').get(key);
      return r ? { version: r.version, text: r.text, css: r.css ? JSON.parse(r.css) : null, at: r.at } : undefined;
    },
    set(key, { version, text, css, at }) {
      db.prepare('INSERT INTO preview_states (key, version, text, css, at, rev) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(key) DO UPDATE SET version = excluded.version, text = excluded.text, css = excluded.css, at = excluded.at, rev = rev + 1').run(key, version, text, css ? JSON.stringify(css) : null, at);
      db.prepare('DELETE FROM preview_states WHERE key NOT IN (SELECT key FROM preview_states ORDER BY at DESC LIMIT ?)').run(MAX_STATES);
    },
    delete: (key) => void db.prepare('DELETE FROM preview_states WHERE key = ?').run(key),
  };
  const stateKey = (userId, cId, id) => `${userId}/${cId}/${id}`;
  /** What the shown entry's state is now, wherever it was pushed or autosaved: a change means "refresh". */
  const stateMark = (s) =>
    s ? JSON.stringify([db.prepare('SELECT rev, at FROM preview_states WHERE key = ?').get(stateKey(s.userId, s.c, s.id)) ?? null, db.prepare('SELECT saved_at FROM autosaves WHERE user_id = ? AND collection = ? AND entry_id = ?').get(s.userId, s.c, s.id)?.saved_at ?? null]) : null;
  let watched = null;
  let watcher = null;

  // --- CMS side ------------------------------------------------------------------------------------------------
  function apiRoutes(router) {
    // the section gallery's throwaway pages (gallery.mjs), before /preview/:c/:id would take its path
    gallery.routes(router);
    router.add('GET', '/preview/:c/:id', (ctx) => {
      const c = coll(ctx.params.c);
      if (!c) throw notFound('No such collection.');
      const summary = store.summarize(c, ctx.params.id, store.read(c, ctx.params.id).text);
      if (!summary.url) throw new HttpError(409, 'no-url', 'This collection has no page URL to preview.');
      // `locale` is the editor's name for the same thing
      const region = ctx.query.get('region') ?? ctx.query.get('locale');
      const at = regionPath(summary.url, region);
      if (at === undefined) throw new HttpError(422, 'invalid', `Unknown region "${region}".`, { regions: config.locales?.list.map((l) => l.code) ?? [] });
      if (config.devNoAuth || !pv.origin) {
        if (!pv.devServer) throw notFound('Preview is not set up on this server (preview.origin).');
        return { url: pv.devServer + at, devServer: true };
      }
      return { url: `${pv.origin}${base}/preview/${c.id}/${ctx.params.id}/${region ? `?region=${encodeURIComponent(region)}` : ''}` };
    });

    // the editor's current, unsaved state (same body as an autosave), shown by the preview only: nothing is stored
    // on disk. It is dropped when the entry changes (a save, someone else's save) or by a later autosave.
    router.add('PUT', '/preview/:c/:id/state', (ctx) => {
      const c = coll(ctx.params.c);
      if (!c) throw notFound('No such collection.');
      const file = store.read(c, ctx.params.id);
      entries.assertEditable(ctx, c, store.summarize(c, ctx.params.id, file.text));
      if (ctx.body.baseVersion !== file.version) throw conflict('This entry changed since you opened it. Reload to see the latest.', { version: file.version });
      // `css` alone (Design & Code: unsaved stylesheets, owner/administrator) keeps the entry as saved
      const hasContent = ['doc', 'frontmatter', 'source', 'data', 'changes'].some((k) => ctx.body[k] !== undefined);
      const css = app.design?.unsaved(ctx, ctx.body.css) ?? null;
      if (!hasContent && !css) throw badRequest('Send the unsaved entry (doc, frontmatter, data, changes or source) or css.');
      // 422 for an unsafe link, as an autosave
      const text = hasContent ? entries.textFromBody(c, file.text, ctx.body).text : null;
      // code added to a page runs on the preview origin: the same rule as a save
      if (text !== null && entries.injectionChanged(c, file.text, text) && !can(ctx.user, 'code.inject')) throw forbidden('Only an owner or administrator can change the code added to this page.');
      const key = stateKey(ctx.user.id, c.id, ctx.params.id);
      pushed.set(key, { version: file.version, text, css, at: app.clock() });
      refresh(ctx.user.id, c.id, ctx.params.id);
      return { ok: true };
    });

    router.add('DELETE', '/preview/:c/:id/state', (ctx) => {
      pushed.delete(stateKey(ctx.user.id, ctx.params.c, ctx.params.id));
      refresh(ctx.user.id, ctx.params.c, ctx.params.id);
      return { ok: true };
    });
  }

  /** An autosave was written: it now holds the newest state, so a pushed one is dropped. */
  function autosaved(userId, cId, id) {
    const key = stateKey(userId, cId, id);
    const state = pushed.get(key);
    // unsaved stylesheets stay; the entry's text is now the autosave's
    if (state?.css) pushed.set(key, { ...state, text: null });
    else pushed.delete(key);
    refresh(userId, cId, id);
  }

  /** GET /markstage/preview-auth?to=<path> on the CMS origin. */
  function authPage(req, res, url) {
    if (!site) return page(res, 404, 'Preview is not set up', '<p>This server has no preview origin.</p>', OWN_CSP);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed', message: 'GET only.' });
    const to = url.searchParams.get('to') ?? '';
    if (!SAFE_PATH.test(to)) return page(res, 400, 'Bad preview link', '<p>Open the preview again from the editor.</p>', OWN_CSP);
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const s = token ? sessions.lookup(token) : null;
    const framed = OWN_CSP.replace(framedBy, "frame-ancestors 'self'");
    if (!s) return page(res, 401, 'Sign in first', `<p>Sign in to Markstage, then open the preview again.</p><p><a href="${esc(base)}/" target="_top">Sign in</a></p>`, framed);
    const ticket = newToken(32);
    db.prepare('INSERT INTO preview_tickets (ticket_hash, session_id, user_id, to_path, expires_at) VALUES (?, ?, ?, ?, ?)').run(sha256(ticket), s.id, s.userId, to, app.clock() + TICKET_MS);
    const nonce = newToken(16);
    page(
      res,
      200,
      'Opening the preview',
      `<form method="post" action="${esc(pv.origin)}${esc(base)}/preview-enter"><input type="hidden" name="ticket" value="${ticket}"><input type="hidden" name="to" value="${esc(to)}">` +
        `<p>Opening the preview…</p><button>Continue</button></form><script nonce="${nonce}">document.forms[0].submit()</script>`,
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action ${pv.origin}; frame-ancestors 'self'`,
      // browsers send `Origin: null` on a cross-origin form post from a no-referrer page, and preview-enter checks
      // Origin; strict-origin sends the origin only (never the path with `to`)
      'strict-origin',
    );
  }

  // --- preview side --------------------------------------------------------------------------------------------
  /** The signed-in viewer on the preview origin, or null. */
  function viewer(req) {
    const token = parseCookies(req.headers.cookie)[PREVIEW_COOKIE];
    if (!token || token.length > 100) return null;
    const row = db.prepare('SELECT * FROM preview_sessions WHERE token_hash = ?').get(sha256(token));
    if (!row) return null;
    if (!sessions.alive(row.session_id)) {
      db.prepare('DELETE FROM preview_sessions WHERE token_hash = ?').run(row.token_hash);
      return null;
    }
    const user = users.get(row.user_id);
    return user && !user.disabled ? { row, user: users.toPublic(user) } : null;
  }

  /**
   * The 403 page of the hand-off: one click opens the preview again (preview-auth mints a fresh ticket). When framed
   * by the editor it also tells the editor so (the editor retries by itself; docs/API-PREVIEW.md).
   */
  function refused(res, title, text, to) {
    const again = `${config.publicOrigin}${base}/preview-auth?to=${encodeURIComponent(to)}`;
    const nonce = newToken(16);
    const tell = `<script nonce="${nonce}">if(window.parent!==window)window.parent.postMessage({markstage:'preview-expired'},${JSON.stringify(config.publicOrigin)})</script>`;
    page(res, 403, title, `<p>${text}</p><p><a href="${esc(again)}">Open the preview again</a></p>`, OWN_CSP.replace("default-src 'none';", `default-src 'none'; script-src 'nonce-${nonce}';`), 'no-referrer', tell);
  }

  /**
   * POST /markstage/preview-enter. The ticket (one use, 60 s) from the CMS's own page signs the viewer in. A repeat
   * of the post, as a browser does after a cold first page (the frame reloaded, back, a second tab), finds the ticket
   * used: with a live preview cookie it still goes to `to`, so the writer never sees a dead end; without one, the 403
   * page has a link that starts over. The ticket path keeps the Origin check (the CMS's page only); the cookie path
   * takes `null` too (a no-referrer page posts with Origin: null).
   */
  async function enter(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed', message: 'POST only.' });
    const origin = req.headers.origin;
    const fromCms = cmsOrigins.includes(origin);
    if (!fromCms && origin !== 'null') return page(res, 403, 'Not available to you', '<p>Open the preview from the editor.</p>', OWN_CSP);
    const form = new URLSearchParams((await readRaw(req, 4096)).toString('utf8'));
    const hash = sha256(form.get('ticket') ?? '');
    const t = fromCms ? db.prepare('SELECT * FROM preview_tickets WHERE ticket_hash = ?').get(hash) : null;
    if (t) db.prepare('DELETE FROM preview_tickets WHERE ticket_hash = ?').run(hash);
    const formTo = form.get('to') ?? '';
    const to = SAFE_PATH.test(t?.to_path ?? '') ? t.to_path : SAFE_PATH.test(formTo) ? formTo : '/';
    const go = () => {
      res.statusCode = 303;
      res.setHeader('Location', to);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
    };
    if (!t || t.expires_at < app.clock() || !sessions.alive(t.session_id)) {
      // the ticket is gone but this browser is already in: on to the page
      if (viewer(req)) return go();
      if (!fromCms) return page(res, 403, 'Not available to you', '<p>Open the preview from the editor.</p>', OWN_CSP);
      return refused(res, 'This preview link has expired', 'The link was already used or is older than a minute.', to);
    }
    const token = newToken(32);
    db.prepare('INSERT INTO preview_sessions (token_hash, session_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(sha256(token), t.session_id, t.user_id, app.clock());
    audit.log({ user: users.toPublic(users.get(t.user_id)), ip: clientIp(req, config.trustProxy), userAgent: req.headers['user-agent'] ?? '' }, 'preview.enter', { target: to });
    res.appendHeader('Set-Cookie', cookie(PREVIEW_COOKIE, token, { maxAge: Math.floor(sessions.absoluteMs / 1000) }));
    go();
  }

  /** GET /markstage/preview/:c/:id/: remember the entry for this viewer, then go to its page. */
  function select(res, who, cId, id, region) {
    const c = coll(cId);
    let summary = null;
    try {
      if (c) summary = store.summarize(c, id, store.read(c, id).text);
    } catch {
      // unknown entry: same answer as no rights
    }
    if (!summary) return page(res, 404, 'Not available to you', '<p>This entry does not exist or is not available to you.</p>', OWN_CSP);
    if (!summary.url) return page(res, 409, 'No page to preview', '<p>This collection has no page URL.</p>', OWN_CSP);
    const at = regionPath(summary.url, region);
    if (at === undefined) return page(res, 400, 'Unknown region', '<p>This site has no such region. Open the preview again from the editor.</p>', OWN_CSP);
    db.prepare('UPDATE preview_sessions SET collection = ?, entry_id = ? WHERE token_hash = ?').run(c.id, id, who.row.token_hash);
    res.statusCode = 303;
    res.setHeader('Location', new URL(at, pv.origin).pathname);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  }

  /** { repoRelativePath: text } for the viewer's chosen entry: their autosave on top of the current file. */
  function stateFiles(userId, cId, id) {
    const c = cId && coll(cId);
    if (!c) return {};
    let file;
    try {
      file = store.read(c, id);
    } catch {
      return {};
    }
    const key = stateKey(userId, c.id, id);
    const state = pushed.get(key);
    if (state && state.version === file.version && app.clock() - state.at < STATE_MS) {
      const css = state.css ?? {};
      if (state.text !== null) return { ...css, [file.rel]: state.text };
      // only stylesheets pushed: the entry is the writer's autosave, else as saved
      return { ...css, ...savedState(userId, c, id, file) };
    }
    pushed.delete(key);
    return savedState(userId, c, id, file);
  }

  /** The writer's autosave of the entry as { rel: text }, or {} for the saved file. */
  function savedState(userId, c, id, file) {
    const row = db.prepare('SELECT payload FROM autosaves WHERE user_id = ? AND collection = ? AND entry_id = ?').get(userId, c.id, id);
    if (!row) return {};
    try {
      return { [file.rel]: entries.textFromBody(c, file.text, JSON.parse(row.payload)).text };
    } catch (e) {
      // an unsafe link is shown to the writer; an autosave with nothing usable in it is ignored
      if (e instanceof HttpError && e.status === 422) throw e;
      return {};
    }
  }

  /** Pass one request to the dev server; resolves when the answer is finished. */
  function forward(req, res, port) {
    return new Promise((resolve) => {
      // the browser left while this waited for the clone (a page with many frames, navigated away): 'close' has
      // fired already and would never fire again, so waiting for it would hold the clone's lock for good
      if (res.destroyed || req.destroyed || res.writableEnded) return resolve();
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
      headers.host = `127.0.0.1:${port}`;
      if (headers.origin) headers.origin = `http://127.0.0.1:${port}`;
      delete headers.referer;
      headers.cookie = siteCookies(req.headers.cookie);
      if (!headers.cookie) delete headers.cookie;
      // plain bodies (loopback: compression gains nothing), so pages can get the agent
      headers['accept-encoding'] = 'identity';
      const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (r) => {
        const out = {};
        for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k) && k !== 'x-frame-options') out[k] = v;
        if (out.location) out.location = String(out.location).replace(`http://127.0.0.1:${port}`, '');
        out['x-robots-tag'] = 'noindex, nofollow';
        out['cache-control'] = 'no-store';
        // only the editor may frame a preview; the site's own CSP (if any) still applies alongside
        out['content-security-policy'] = [out['content-security-policy'], framedBy].flat().filter(Boolean);
        if (req.method === 'HEAD' || r.statusCode === 204 || r.statusCode === 304 || !agent.wants(r.headers)) {
          res.writeHead(r.statusCode, out);
          return r.pipe(res);
        }
        delete out['content-length'];
        delete out.etag;
        agent.pipeInjected(
          r,
          res,
          (length) => res.writeHead(r.statusCode, length === null ? out : { ...out, 'content-length': length }),
          () => page(res, 502, 'The preview is not answering', '<p>Try again in a moment.</p>', OWN_CSP),
        );
      });
      res.on('close', resolve);
      up.on('error', () => {
        if (!res.headersSent) page(res, 502, 'The preview is not answering', '<p>Try again in a moment.</p>', OWN_CSP);
        else if (!res.writableEnded) res.destroy();
        resolve();
      });
      req.pipe(up);
    });
  }

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // never for search engines: every answer, its own pages and errors too (proxied pages get it again in forward)
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (closing) return sendJson(res, 503, { error: 'unavailable', message: 'The preview is shutting down.' });
    if (!previewHosts.has(String(req.headers.host ?? ''))) return sendJson(res, 421, { error: 'bad-host', message: 'This server does not answer for that host name.' });
    let url;
    try {
      url = new URL(req.url ?? '/', pv.origin);
    } catch {
      return sendJson(res, 400, { error: 'bad-request', message: 'Bad URL.' });
    }
    try {
      if (url.pathname === '/robots.txt' && (req.method === 'GET' || req.method === 'HEAD')) return sendNoRobots(res);
      if (url.pathname === `${base}/preview-enter`) return await enter(req, res);
      if (url.pathname === agent.src && req.method === 'GET' && agent.serve(res)) return;
      const who = viewer(req);
      if (!who) {
        if (req.method === 'GET' && (isDocument(req) || ENTRY.test(url.pathname))) {
          res.statusCode = 303;
          res.setHeader('Location', `${config.publicOrigin}${base}/preview-auth?to=${encodeURIComponent(url.pathname + url.search)}`);
          return res.end();
        }
        return sendJson(res, 401, { error: 'unauthorized', message: 'Open the preview from the editor.' });
      }
      const m = ENTRY.exec(url.pathname);
      if (m && req.method === 'GET') return select(res, who, m[1], m[2], url.searchParams.get('region'));
      // Markstage's own addresses never reach the clone's dev server (whose integration, if it ever answered there,
      // has an editor page and API without sign-in)
      if (url.pathname === base || url.pathname.startsWith(`${base}/`)) return sendJson(res, 404, { error: 'not-found', message: 'Not found.' });
      if (devPaths.refusal(url)) return sendJson(res, 404, { error: 'not-found', message: 'Not found.' });
      if (!isDocument(req)) return await forward(req, res, await site.start());
      await site.lock.run(async () => {
        const files = stateFiles(who.user.id, who.row.collection, who.row.entry_id);
        const wasRunning = site.running;
        const at = Date.now();
        const changed = await site.show({ ...gallery.files(), ...files });
        shown = { userId: who.user.id, c: who.row.collection, id: who.row.entry_id };
        watched = stateMark(shown);
        const port = await site.start();
        if (changed && wasRunning) await site.settle(at);
        await forward(req, res, port);
      });
    } catch (e) {
      if (res.headersSent || closing) return res.destroy();
      if (e instanceof HttpError) return page(res, e.status, 'This draft cannot be previewed yet', `<p>${esc(e.message)}</p>`, OWN_CSP);
      console.error('[markstage] preview:', e?.stack ?? e);
      // the site's own error (e.g. an entry its schema refuses) is what the writer needs to see
      const detail = String(e?.message ?? '')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replaceAll(`${site.dir}/`, '')
        .slice(-3000);
      page(res, 500, 'The preview could not start', `<p>The site's preview server stopped with this message:</p><pre style="white-space:pre-wrap;font-size:13px">${esc(detail)}</pre>`, OWN_CSP);
    }
  }

  /** The dev server's HMR websocket, for signed-in viewers only. */
  function upgrade(req, socket, head) {
    const refuse = (status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.on('error', () => socket.destroy());
    if (!previewHosts.has(String(req.headers.host ?? ''))) return refuse('421 Misdirected Request');
    // a page on another origin must not open a socket into someone's preview
    if (req.headers.origin && !previewOrigins.includes(req.headers.origin)) return refuse('403 Forbidden');
    if (!viewer(req)) return refuse('401 Unauthorized');
    let at;
    try {
      at = new URL(req.url ?? '/', pv.origin);
    } catch {
      return refuse('400 Bad Request');
    }
    if (devPaths.refusal(at)) return refuse('404 Not Found');
    if (!site.running) return refuse('503 Service Unavailable');
    site.touch();
    const port = site.port;
    const up = net.connect(port, '127.0.0.1', () => {
      const headers = { ...req.headers, host: `127.0.0.1:${port}`, cookie: siteCookies(req.headers.cookie) };
      if (headers.origin) headers.origin = `http://127.0.0.1:${port}`;
      const lines = Object.entries(headers).flatMap(([k, v]) => (v === '' || v == null ? [] : [v].flat().map((x) => `${k}: ${x}`)));
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('close', () => up.destroy());
  }

  /** After an autosave: if the clone shows this user's state of this entry, rewrite it so HMR refreshes the frame. */
  function refresh(userId, cId, id) {
    if (!site?.running || shown?.userId !== userId || shown.c !== cId || shown.id !== id) return;
    watched = stateMark(shown);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      site.lock
        .run(async () => {
          if (shown?.userId === userId && shown.c === cId && shown.id === id) await site.show({ ...gallery.files(), ...stateFiles(userId, cId, id) });
        })
        .catch(() => {});
    }, 300);
  }

  const sweep = () => {
    db.prepare('DELETE FROM preview_tickets WHERE expires_at < ?').run(app.clock());
    db.prepare('DELETE FROM preview_states WHERE at < ?').run(app.clock() - STATE_MS);
    for (const r of db.prepare('SELECT token_hash, session_id FROM preview_sessions').all()) {
      if (!sessions.alive(r.session_id)) db.prepare('DELETE FROM preview_sessions WHERE token_hash = ?').run(r.token_hash);
    }
  };
  let sweeper = null;
  /** The listener's process: a state of the shown entry pushed or autosaved on another process refreshes the frame. */
  const watch = () => {
    if (!site?.running || !shown) return;
    const now = stateMark(shown);
    if (watched === null) watched = now;
    else if (now !== watched) refresh(shown.userId, shown.c, shown.id);
  };

  let server = null;
  /** the warm-up started with the listener (preview.warm): its seconds, or null when off or failed */
  let warming = Promise.resolve(null);
  return {
    site,
    get warming() {
      return warming;
    },
    apiRoutes,
    authPage,
    refresh,
    autosaved,
    handle,
    listen(port = pv.port, host = config.host) {
      if (!site) return Promise.resolve(null);
      closing = false;
      sweeper = setInterval(sweep, 600_000);
      sweeper.unref();
      watcher = setInterval(watch, WATCH_MS);
      watcher.unref();
      server = http.createServer(handle);
      server.on('upgrade', upgrade);
      server.headersTimeout = 30_000;
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address()));
      }).then((addr) => {
        // the site's dev server comes up in the background; the listener answers meanwhile (a page waits for it)
        if (pv.warm) {
          warming = site.warm().catch((e) => {
            if (!closing) console.error(`[markstage] preview warm-up failed: ${String(e?.message ?? e).split('\n')[0]}`);
            return null;
          });
        }
        return addr;
      });
    },
    async close() {
      closing = true;
      clearInterval(sweeper);
      clearInterval(watcher);
      clearTimeout(refreshTimer);
      if (server) {
        server.closeAllConnections?.();
        await new Promise((r) => server.close(() => r()));
      }
      await site?.close();
    },
  };
}
