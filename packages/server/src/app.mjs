// Markstage server: wires the modules together and runs every request through the same checks, in this order:
//   security headers -> Host allowlist -> route match -> session -> Origin check (writes) -> sign-in required ->
//   CSRF token (writes) -> body (size-limited JSON) -> handler -> JSON answer or plain-words error.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAudit } from './audit.mjs';
import { createAuthors } from './authors/index.mjs';
import { createPageTypes } from './page-types.mjs';
import { createLinks } from './links/index.mjs';
import { isWithin } from './config.mjs';
import { authRoutes } from './auth/routes.mjs';
import { ssoRoutes } from './auth/sso.mjs';
import { createBackup } from './backup.mjs';
import { createLimiter } from './auth/limiter.mjs';
import { COOKIE, createChallenges, createSessions } from './auth/sessions.mjs';
import { compatRoutes } from './compat.mjs';
import { createConverter, loadCore } from './content/converter.mjs';
import { bulkRoutes } from './content/bulk.mjs';
import { taxonomyRoutes } from './content/taxonomy.mjs';
import { createEntries } from './content/entries.mjs';
import { createLockRules } from './content/lock-rules.mjs';
import { findRoutes } from './content/find.mjs';
import { undoRoutes } from './content/undo.mjs';
import { createMany } from './content/many.mjs';
import { createGit } from './content/git.mjs';
import { createAutosaveHistory } from './content/autosaves.mjs';
import { historyRoutes } from './content/history.mjs';
import { applySiteConfig } from './site-config.mjs';
import { createSiteFiles, SITE_FILE_TYPES } from './site-files.mjs';
import { moveRoutes } from './move.mjs';
import { moveManyRoutes } from './move-many.mjs';
import { createRedirectsHook } from './redirects/hook.mjs';
import { redirectsRoutes } from './redirects/routes.mjs';
import { createVerify } from './verify.mjs';
import { healthRoutes } from './health.mjs';
import { createAddressCheck } from './health-addresses.mjs';
import { createFormSubmit } from './forms/submit.mjs';
import { inboxRoutes } from './forms/inbox.mjs';
import { createFormSettings } from './forms/settings.mjs';
import { createGeo } from './geo/index.mjs';
import { createEnvironments } from './env/index.mjs';
import { createTokens } from './env/tokens.mjs';
import { createNotices } from './notices.mjs';
import { createAlertRules } from './notify/rules.mjs';
import { createAlerts } from './notify/send.mjs';
import { preflightRoutes } from './preflight.mjs';
import { injectRoutes } from './design/inject.mjs';
import { createDesign } from './design/routes.mjs';
import { createEditLink, editLinkRoutes } from './edit-link.mjs';
import { createStore } from './content/store.mjs';
import { lightIndexRoutes } from './content/light-index.mjs';
import { createMediaUses } from './media/uses.mjs';
import { openDb } from './db.mjs';
import { APP_CSP, clientIp, cookie, createRouter, loopbackAliases, parseCookies, readJson, securityHeaders, sendError, sendJson, sendNoRobots } from './http.mjs';
import { createAfterDeploy } from './after-deploy.mjs';
import { createJobs } from './jobs.mjs';
import { libraryRoutes } from './library.mjs';
import { createLibrary } from './library/items.mjs';
import { libraryItemRoutes } from './library/routes.mjs';
import { loadSharpCodec } from './media/codec.mjs';
import { mediaRoutes } from './media/routes.mjs';
import { createPreview } from './preview/routes.mjs';
import { createReleases } from './releases/index.mjs';
import { createMcp } from './mcp/index.mjs';
import { createAi } from './ai/index.mjs';
import { createTranslate } from './translate/index.mjs';
import { createTranslations } from './content/translations.mjs';
import { createImport } from './import/index.mjs';
import { createIntegrations } from './integrations/index.mjs';
import { createCustomRoles } from './custom-roles/index.mjs';
import { createCluster } from './cluster/index.mjs';
import { createFileLock, createRepoLock } from './cluster/file-lock.mjs';
import { createWebhooks } from './webhooks/index.mjs';
import { createPageGate, protectRoutes } from './protect.mjs';
import { createPresence } from './presence.mjs';
import { createScheduler, publishRoutes } from './publish.mjs';
import { createUsers, userRoutes } from './users.mjs';
import { HttpError, createBusyLease, forbidden, newToken, notFound, nowIso, safeEqual, unauthorized } from './util.mjs';

export { loadConfig, ConfigError } from './config.mjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEV_USER = 'u_dev';
const STATIC_TYPES = { ...SITE_FILE_TYPES, '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json' };


/**
 * Build the server. `deps` lets tests swap the converter core, the image codec and the clock:
 * { core: module|null, codec: object|null, clock: () => ms, outbound: {lookup, allow} (library/fetch.mjs), ai: {fetch, env} (ai/),
 *   translate: {sleep} (translate/run.mjs: how a run waits for the AI limits), cluster: {leaseMs, now} (cluster/) }.
 */
export async function createMarkstage(config, deps = {}) {
  const clock = deps.clock ?? (() => Date.now());
  // collections, page URLs and groups from the site's markstage.config (before anything reads config.collections)
  let site;
  ({ config, site } = await applySiteConfig(config, deps.siteConfig));
  const db = openDb(config.dataDir);
  const app = { config, db, clock, site, outbound: deps.outbound ?? {} };
  // this process among the others on the data dir: leases, limits, the primary role (cluster/, docs/SCALING.md)
  app.cluster = createCluster(db, { leaseMs: deps.cluster?.leaseMs ?? config.processes.leaseSeconds * 1000, now: deps.cluster?.now, clock });
  app.audit = createAudit(db, clock);
  app.users = createUsers(db, clock);
  // custom roles (custom-roles/): a person's role, ready to answer, rides on them from users.toPublic
  app.customRoles = createCustomRoles(app);
  app.users.customRoleOf = app.customRoles.customRoleOf;
  app.sessions = createSessions(db, config, clock);
  app.challenges = createChallenges(db, clock);
  app.limiter = createLimiter(db, config.login, clock, app.cluster.hits);
  app.tokens = createTokens(app);
  const packs = [];
  for (const file of config.packs ?? []) {
    const mod = await import(pathToFileURL(file).href);
    packs.push(...[mod.default ?? mod.pack].flat().filter(Boolean));
  }
  app.packs = packs;
  app.converter = createConverter('core' in deps ? deps.core : await loadCore(), { packs });
  app.codec = 'codec' in deps ? deps.codec : await loadSharpCodec();
  // the repo's lock across processes: a lock file in the data dir (cluster/file-lock.mjs); every git write and every
  // repo-lock section holds it
  const repoFile = createFileLock(path.join(config.dataDir, 'repo.lock'), app.cluster);
  app.git = createGit(config, { lock: repoFile, critical: app.cluster.critical });
  app.repoLock = createRepoLock(repoFile);
  // one import (a media zip, a Library pack or export) at a time per server, across its processes: a second one is
  // answered 409 busy
  app.importLock = createBusyLease(app.cluster, 'import');
  app.store = createStore(config, app.converter, clock, app.site);
  app.alerts = createAlerts(app);
  app.alertRules = createAlertRules(app);
  app.notices = createNotices(app);
  app.jobs = createJobs(app);
  app.afterDeploy = createAfterDeploy(app);
  app.verify = createVerify(app);
  app.environments = createEnvironments(app, deps.env);

  const api = createRouter();
  authRoutes(api, app);
  // single sign-on through the server's OpenID Connect providers (config.json sso)
  ssoRoutes(api, app);
  app.alerts.routes(api);
  app.alertRules.routes(api);
  userRoutes(api, app);
  app.tokens.routes(api);
  app.environments.routes(api);
  app.notices.routes(api);
  inboxRoutes(api, app);
  app.formSettings = createFormSettings(app);
  app.formSettings.routes(api);
  app.locks = createLockRules(app);
  app.library = createLibrary(app);
  const entries = createEntries(app);
  entries.routes(api);
  // the light index of every entry for the editor's boot (content/light-index.mjs)
  lightIndexRoutes(api, app);
  app.autosaves = createAutosaveHistory(app, entries);
  app.autosaves.routes(api);
  const history = historyRoutes(api, app, entries);
  const lifecycle = publishRoutes(api, app, entries, history);
  preflightRoutes(api, app, entries, history);
  healthRoutes(api, app);
  app.locks.routes(api);
  app.addresses = createAddressCheck(app);
  app.addresses.routes(api);
  protectRoutes(api, app, entries, lifecycle.deployJob);
  app.design = createDesign(app);
  app.design.routes(api);
  injectRoutes(api, app, entries, lifecycle.deployJob);
  app.redirectsHook = createRedirectsHook(app);
  moveRoutes(api, app, entries);
  moveManyRoutes(api, app, entries);
  redirectsRoutes(api, app, entries);
  // "Edit this page" on the live site: its cookie, and the entry at a page address
  app.editLink = createEditLink(app);
  editLinkRoutes(api, app);
  app.many = createMany(app, entries);
  // the site's authors as files (authors/): their screen's routes, and the check every entry write makes
  app.authors = await createAuthors(app);
  app.authors.routes(api);
  // page frames and types (page-types.mjs): the check every entry write makes, the type's locks and checks
  app.pageTypes = await createPageTypes(app, entries);
  app.pageTypes.routes(api);
  // topics and internal links (links/): topic files, the link map, suggestions both ways, the link health
  app.links = await createLinks(app, entries);
  app.links.routes(api);
  findRoutes(api, app, app.many);
  taxonomyRoutes(api, app, bulkRoutes(api, app, app.many));
  undoRoutes(api, app, app.many);
  app.presence = createPresence(app, entries);
  app.presence.routes(api);
  app.backup = createBackup(app);
  app.backup.routes(api);
  // where each media file is used, kept per entry version (media/uses.mjs)
  app.mediaUses = createMediaUses(app);
  mediaRoutes(api, app);
  libraryRoutes(api, app, app.library);
  libraryItemRoutes(api, app, app.library);
  app.preview = createPreview(app, entries);
  app.preview.apiRoutes(api);
  app.releases = createReleases(app, entries);
  app.releases.routes(api);
  // the MCP server: an AI agent with a token, through these same routes (mcp/index.mjs)
  app.mcp = createMcp(app, api);
  api.add('POST', '/mcp', app.mcp.handle, { auth: false, token: true });
  api.add('GET', '/mcp', app.mcp.explain, { auth: false });
  // AI suggestions: words for a person to read and save, never a commit (ai/index.mjs); deps.ai = {fetch, env}
  app.ai = createAi(app, deps.ai);
  app.ai.routes(api);
  // translation status per entry and locale, from git (content/translations.mjs)
  app.translations = createTranslations(app);
  app.translations.routes(api);
  // AI drafts of a whole site in one region, for people to review: a plan, its run, its report (translate/)
  app.translate = createTranslate(app, entries, deps.translate);
  app.translate.routes(api);
  // entries and media from another system's JSON: a plan, then its run (import/)
  app.imports = createImport(app, entries);
  app.imports.routes(api);
  // webhooks: signed events to the site's own addresses, from the audit (webhooks/)
  app.webhooks = createWebhooks(app);
  app.webhooks.routes(api);
  // integration fields: options fetched from the site's JSON addresses on a schedule, checked on save (integrations/)
  app.integrations = createIntegrations(app);
  app.integrations.routes(api);
  app.customRoles.routes(api);
  const compat = createRouter();
  if (config.compat.collection) compatRoutes(compat, app, entries);
  app.scheduler = createScheduler(app);
  const gate = config.protectedPages.dir ? createPageGate(app) : null;
  app.geo = createGeo(config);
  app.forms = createFormSubmit(app);
  const siteHosts = new Set(config.siteHosts);

  const allowedOrigins = new Set([config.publicOrigin, ...loopbackAliases(config.publicOrigin)]);
  const allowedHosts = new Set([config.publicHost, ...loopbackAliases(config.publicOrigin).map((o) => new URL(o).host), ...(config.allowedHosts ?? [])]);
  const apiPrefix = `${config.basePath}/api`;
  const devCsrf = newToken(24);

  if (config.devNoAuth && !app.users.get(DEV_USER)) {
    db.prepare('INSERT INTO users (id, email, name, role, author_slug, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').run(DEV_USER, 'dev@markstage.invalid', 'Developer', 'owner', null, nowIso(clock()));
  }
  // what processes that stopped left (at a start alone: what the restart cut), then the heartbeat
  app.cluster.ready();

  /** A write must come from our own origin: Origin header, or Referer when a browser left Origin out. */
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (origin) return allowedOrigins.has(origin);
    try {
      return allowedOrigins.has(new URL(req.headers.referer).origin);
    } catch {
      return false;
    }
  }

  async function runApi(router, routePath, req, res, url) {
    const ctx = { req, res, url, query: url.searchParams, params: {}, ip: clientIp(req, config.trustProxy), userAgent: req.headers['user-agent'] ?? '', status: 200, user: null, session: null, body: {} };
    try {
      const m = router.match(req.method, routePath);
      if (!m) throw notFound('Unknown API route.');
      if (m.methodNotAllowed) throw new HttpError(405, 'method-not-allowed', 'This route does not take that method.');
      const { route, params } = m;
      ctx.params = params;

      const maxAge = Math.floor(app.sessions.absoluteMs / 1000);
      ctx.setSessionCookie = (token) => res.appendHeader('Set-Cookie', cookie(COOKIE, token, { maxAge }));
      ctx.clearSessionCookie = () => {
        res.appendHeader('Set-Cookie', cookie(COOKIE, '', { maxAge: 0 }));
        app.editLink.clear(res);
      };

      if (config.devNoAuth) {
        ctx.user = app.users.toPublic(app.users.get(DEV_USER));
        ctx.session = { id: null, csrf: devCsrf };
      } else {
        const token = parseCookies(req.headers.cookie)[COOKIE];
        const s = token ? app.sessions.lookup(token) : null;
        if (s) {
          ctx.session = s;
          ctx.user = app.users.toPublic(app.users.get(s.userId));
        }
        // the laptop CLI: a personal token, for the Environments routes only (env/tokens.mjs)
        if (!s && req.headers.authorization) app.tokens.authenticate(ctx, String(req.headers.authorization), routePath, req.method);
      }

      const unsafe = !SAFE_METHODS.has(req.method);
      // a bearer token is not sent by a browser on its own, so the Origin and CSRF checks are for cookie sessions (a
      // token-only route, /mcp, never acts on a session and checks a browser's Origin itself)
      if (unsafe && !ctx.token && !route.opts.token && !sameOrigin(req)) {
        app.audit.log(ctx, 'security.origin', { ok: false, target: routePath, detail: { origin: req.headers.origin ?? null } });
        throw forbidden('Cross-site request refused.');
      }
      const needsAuth = route.opts.auth !== false;
      if (needsAuth && !ctx.user) throw unauthorized();
      // dev mode keeps the Origin and Host checks but has no session to bind a token to
      if (unsafe && needsAuth && !config.devNoAuth && !ctx.token && !safeEqual(req.headers['x-csrf-token'] ?? '', ctx.session.csrf)) {
        app.audit.log(ctx, 'security.csrf', { ok: false, target: routePath });
        throw forbidden('Missing or wrong CSRF token. Reload the page.');
      }
      if (unsafe && !route.opts.rawBody) ctx.body = await readJson(req, config.maxBodyBytes);

      const result = await route.handler(ctx);
      // a route that writes its own answer (a file, a CSV) finishes it before it returns: one that set its own type
      // and left a stream running would be answered {ok: true} here first
      if (result === undefined && res.hasHeader('Content-Type') && !res.writableEnded) {
        res.removeHeader('Content-Type');
        throw new Error(`${routePath}: the route returned before its answer was written (await the stream).`);
      }
      if (!res.headersSent && !res.writableEnded) sendJson(res, ctx.status, result ?? { ok: true });
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(`[markstage] ${req.method} ${routePath}:`, err?.stack ?? err);
      if (!res.headersSent) sendError(res, err);
      else res.destroy();
    }
  }

  const siteFiles = createSiteFiles(config, app.sessions);

  /** The editor app (`markstage build-editor` output, editorDir) under the base path, or a placeholder until it is built. */
  function serveEditor(req, res, url) {
    securityHeaders(res, { secure: config.secure, kind: 'app' });
    // the editor frames previews from their own origin
    // the editor frames previews from their own origin, and the screen check talks to them (QA F14)
    if (config.preview.origin) res.setHeader('Content-Security-Policy', APP_CSP.replace("frame-src 'self'", `frame-src 'self' ${config.preview.origin}`).replace("connect-src 'self'", `connect-src 'self' ${config.preview.origin}`));
    if (!SAFE_METHODS.has(req.method)) return sendJson(res, 405, { error: 'method-not-allowed', message: 'Read only.' });
    if (url.pathname === config.basePath) {
      res.statusCode = 308;
      res.setHeader('Location', `${config.basePath}/`);
      return res.end();
    }
    let file = null;
    if (config.editorDir) {
      let rel;
      try {
        rel = decodeURIComponent(url.pathname.slice(config.basePath.length + 1)) || 'index.html';
      } catch {
        rel = 'index.html';
      }
      const abs = path.resolve(config.editorDir, rel);
      const inside = isWithin(config.editorDir, abs);
      file = inside && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : path.join(config.editorDir, 'index.html');
    }
    res.setHeader('Cache-Control', 'no-cache');
    if (file && fs.existsSync(file)) {
      res.setHeader('Content-Type', STATIC_TYPES[path.extname(file)] ?? 'application/octet-stream');
      return fs.createReadStream(file).pipe(res);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><title>Markstage</title><p>Markstage server is running. The editor is not built yet.</p>');
  }

  /**
   * The site's link-card data (site config editor.linkCards) at its own path on the CMS origin, where the editor asks
   * for it: the file from the last build (verify.public). Read only, that one path, JSON, at most 5 MB; 404 when there
   * is no build yet (the editor then shows what it knows of the page).
   */
  function serveLinkCards(req, res) {
    if (!SAFE_METHODS.has(req.method)) return sendJson(res, 405, { error: 'method-not-allowed', message: 'Read only.' });
    const out = config.verify?.public ? path.resolve(config.verify.public) : null;
    const file = out ? path.resolve(out, `.${config.linkCards.url}`) : null;
    let ok = false;
    try {
      ok = Boolean(file && isWithin(out, file) && path.extname(file) === '.json' && fs.statSync(file).isFile() && fs.statSync(file).size <= 5 * 1024 * 1024);
    } catch {
      ok = false;
    }
    if (!ok) return sendJson(res, 404, { error: 'not-found', message: 'No link-card data in the last build.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    securityHeaders(res, { secure: config.secure });
    // outside production nothing is for search engines (env/config.mjs)
    if (!config.environment.production) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    let url;
    try {
      url = new URL(req.url ?? '/', config.publicOrigin);
    } catch {
      return sendJson(res, 400, { error: 'bad-request', message: 'Bad URL.' });
    }
    // the site's own host names only ever reach its forms and the protected-page gate, never the CMS
    const host = String(req.headers.host ?? '').toLowerCase();
    if (siteHosts.has(host)) {
      if (await app.forms.handle(req, res, url)) return;
      if (await app.environments.site.handle(req, res, url)) return;
      if (gate?.hosts.has(String(req.headers.host))) return gate.handle(req, res, url);
      return sendJson(res, 404, { error: 'not-found', message: 'Not found.' });
    }
    // a branch preview's host (staging): the gate answers it, never the CMS
    if (app.environments.site.answers(host)) return app.environments.site.handle(req, res, url);
    // DNS-rebinding guard: only our own host names reach the app
    if (!allowedHosts.has(String(req.headers.host ?? ''))) {
      return sendJson(res, 421, { error: 'bad-host', message: 'This server does not answer for that host name.' });
    }
    // the CMS itself is never for search engines, in production too
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (url.pathname === '/robots.txt' && SAFE_METHODS.has(req.method)) return sendNoRobots(res);
    const p = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    if (p.startsWith(`${apiPrefix}/`)) return runApi(api, p.slice(apiPrefix.length), req, res, url);
    if (config.compat.collection && p.startsWith('/studio-api/')) return runApi(compat, p, req, res, url);
    if (url.pathname === `${config.basePath}/preview-auth`) return app.preview.authPage(req, res, url);
    if (url.pathname === `${config.basePath}/gate`) {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      return app.environments.site.gatePage(req, res, url, token ? app.sessions.lookup(token) : null);
    }
    if (url.pathname === config.basePath || url.pathname.startsWith(`${config.basePath}/`)) return serveEditor(req, res, url);
    if (config.linkCards && url.pathname === config.linkCards.url) return serveLinkCards(req, res);
    // the site's fonts and images the built editor draws with (site-files.mjs)
    if (siteFiles.handle(req, res, url)) return;
    sendJson(res, 404, { error: 'not-found', message: 'Not found.' });
  }

  let server = null;
  let sweeper = null;
  let retrier = null;
  /**
   * What runs once for the whole server, in the process holding the primary role (cluster/): the timers, the
   * preview's listener and dev server, the share links' listener. With one process, that is this one, from the start.
   */
  async function startPrimary() {
    app.scheduler.start();
    app.releases.start();
    void app.library.moveOld();
    app.backup.start();
    app.alertRules.start();
    app.webhooks.start();
    app.integrations.start();
    sweeper = setInterval(() => {
      app.sessions.sweep();
      app.forms.sweep();
      app.limiter.sweep();
      app.cluster.hits.sweep();
      app.presence.sweep();
    }, 3_600_000);
    sweeper.unref();
    // a team alert that failed is tried again when due (forms/submit.mjs)
    retrier = setInterval(() => void app.forms.retry().catch((e) => console.error(`[markstage] form alert retry: ${e.message}`)), 60_000);
    retrier.unref();
    await app.preview.listen();
    await app.releases.share.listen();
  }
  async function stopPrimary() {
    app.scheduler.stop();
    app.releases.stop();
    app.backup.stop();
    app.alertRules.stop();
    await app.webhooks.stop();
    await app.integrations.stop();
    clearInterval(sweeper);
    clearInterval(retrier);
    await app.preview.close();
    await app.releases.share.close();
  }
  Object.assign(app, {
    handle,
    entries,
    history,
    listen(port = config.port, host = config.host) {
      server = http.createServer(handle);
      server.headersTimeout = 30_000;
      server.requestTimeout = 120_000;
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address()));
      }).then(async (addr) => {
        await app.cluster.serve(addr.port, { primary: { start: startPrimary, stop: stopPrimary } });
        return addr;
      });
    },
    async close() {
      // the primary role's work stops and the role is let go (another process takes it)
      await app.cluster.stepDown();
      // a send started by an event on this process (not the primary's timer) finishes before the database closes
      await app.webhooks.stop();
      app.geo.close();
      await app.jobs.idle();
      // a site translation that is going stops between two asks, paused (Resume carries on after a restart)
      await app.translate.stop();
      if (server) await new Promise((r) => server.close(() => r()));
      await app.cluster.close();
      db.close();
    },
  });
  return app;
}
