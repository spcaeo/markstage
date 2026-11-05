// The page around the canvas, on a server (docs/CANVAS-FIDELITY.md "On a server"). In `astro dev` the editor reads an
// entry's page from the dev server on its own origin. A built editor served by this server has no such page on its
// origin: the site is built elsewhere and previews have an origin of their own, which the editor's code must never
// read as its own. So the server reads the entry's last built page from disk and hands it over as data:
//
//   GET /markstage/api/preview/:c/:id/shell  signed in (anyone who may read the entry) ->
//        { html, sheets: [{path, text}], from: 'site' | 'draft', builtAt, path, frame }
//        404 not-built (no build has the entry yet: the editor shows its sheet of paper, with a quiet note)
//        413 too-large; ETag (also in the answer, `etag`): the editor keeps the last answers in its memory and asks
//        with If-None-Match, a repeat (each open, each save) is a 304. Never stored by the browser (no-store): a draft's
//        or a protected page's HTML is not left on the disk after sign-out.
//   GET /markstage/shell-frame                the empty frame the page's first <head> scripts run in (first-paint.ts):
//        CSP `sandbox allow-scripts` (no origin: no cookies, no storage, no access to the editor), no network
//
// Which build: the site's own output (verify.public, then verify.private for a protected page), or the draft's
// preview build (a share link's "as if published" build, releases/builds.mjs), whichever is newer for the entry.
//
// Safety: the answer is JSON (never a page on the CMS origin); the editor parses it, removes every script, frame and
// handler and makes it inert, as it does with the dev server's page (canvas-shell/dom.ts sanitize). Files are read
// only inside the build folder (staticFileIn: no `..`, links followed must stay inside). Stylesheets are the page's
// own <link rel=stylesheet> to a .css file of the same build: nothing is fetched by address, so an @import or url()
// in the CSS, or a link to another host, never makes this server ask anyone for anything. Sizes are capped.
import fs from 'node:fs';
import path from 'node:path';
import { isRedirectStub } from '../verify.mjs';
import { staticFileIn } from '../static-file.mjs';
import { HttpError, sha1 } from '../util.mjs';

export const SHELL_LIMITS = Object.freeze({ html: 4 * 1024 * 1024, sheet: 2 * 1024 * 1024, css: 8 * 1024 * 1024, sheets: 64 });
/** answers kept (by file, size and time), so an open after a save costs a stat: at most 32, and 64 MB in all */
const CACHE = 32;
export const CACHE_BYTES = 64 * 1024 * 1024;
const SITE = 'http://site.invalid';

// the frame's own document: it waits for the page's head (from the editor, its parent only) and writes it in place
const FRAME_HTML =
  '<!doctype html><meta charset="utf-8"><title>Markstage</title>' +
  "<script>addEventListener('message',function f(e){if(e.source!==parent||!e.data||typeof e.data.ms!=='string'||typeof e.data.html!=='string')return;removeEventListener('message',f);document.open();document.write(e.data.html);document.close()})</script>";
const FRAME_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)));

/** The attributes of one start tag (`<link …>`), names lowercased, values decoded. */
function attrsOf(tag) {
  const out = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<[a-z]+/i, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/**
 * The site paths of the page's stylesheets (`<link rel=stylesheet>`), in order, as the editor will look them up:
 * resolved against the page's own path. A link to any other host (or a scheme) is left out: never fetched.
 */
export function sheetPaths(html, pagePath, max = SHELL_LIMITS.sheets) {
  // a Set, and no further than `max` distinct .css files: a page a writer fills with links (raw HTML, MDX) costs one
  // pass over the tags up to there, never a pass per link (security review, 5 Nov 2026)
  const out = new Set();
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrsOf(tag);
    if (!(a.rel ?? '').toLowerCase().split(/\s+/).includes('stylesheet') || !a.href) continue;
    const p = sheetPath(a.href, pagePath);
    if (!p || path.extname(p).toLowerCase() !== '.css') continue;
    out.add(p);
    if (out.size >= max) break;
  }
  return [...out];
}

/** A stylesheet's href as a path on the site (no query, no hash), or null when it is not on the site itself. */
export function sheetPath(href, pagePath) {
  let u;
  try {
    u = new URL(href, `${SITE}${pagePath}`);
  } catch {
    return null;
  }
  return u.origin === SITE ? u.pathname : null;
}

export function createShellPage(app) {
  const { config, store } = app;
  const cache = new Map();
  let cacheBytes = 0;

  /**
   * The entry's page in one build folder: { file, size, at } or null (a redirect stub is not its page). Its size comes
   * from a stat first: a page over the limit is never read (answered 413), and the stub check reads its head only.
   */
  function pageIn(dir, url) {
    if (!dir) return null;
    const file = staticFileIn(dir, url);
    if (!file || path.extname(file) !== '.html') return null;
    const st = fs.statSync(file);
    if (st.size <= SHELL_LIMITS.html && isRedirectStub(file)) return null;
    return { dir, file, size: st.size, at: st.mtimeMs };
  }

  /** Every build that has the entry's page, newest first. */
  function builds(c, id, url) {
    const found = [];
    for (const dir of [config.verify?.public, config.verify?.private]) {
      const p = pageIn(dir, url);
      if (p) {
        found.push({ ...p, from: 'site' });
        break;
      }
    }
    const draft = app.releases?.builds?.lastBuilt(`e_${c.id}_${id}`);
    if (draft) {
      const p = pageIn(draft.dir, url);
      if (p) found.push({ ...p, from: 'draft', at: Math.max(p.at, Date.parse(draft.builtAt) || 0) });
    }
    return found.sort((a, b) => b.at - a.at);
  }

  /** The stylesheets of the page: each a .css file of the same build, within the limits. */
  function sheetsOf(dir, html, url) {
    const sheets = [];
    const stats = [];
    let total = 0;
    for (const p of sheetPaths(html, url)) {
      if (sheets.length >= SHELL_LIMITS.sheets) break;
      if (path.extname(p).toLowerCase() !== '.css') continue;
      const file = staticFileIn(dir, p);
      if (!file) continue;
      const st = fs.statSync(file);
      if (st.size > SHELL_LIMITS.sheet || total + st.size > SHELL_LIMITS.css) continue;
      total += st.size;
      stats.push([file, st.size, st.mtimeMs]);
      sheets.push({ path: p, text: fs.readFileSync(file, 'utf8') });
    }
    return { sheets, stats };
  }

  const same = (stats) =>
    stats.every(([file, size, at]) => {
      try {
        const st = fs.statSync(file);
        return st.size === size && st.mtimeMs === at;
      } catch {
        return false;
      }
    });

  /** The answer for the newest build of the entry: { body, etag }, from the cache while nothing changed. */
  function answer(build, url) {
    if (build.size > SHELL_LIMITS.html) throw new HttpError(413, 'too-large', 'This page is too large to draw around the canvas.');
    const key = `${build.file}\0${build.size}\0${build.at}\0${build.from}`;
    const hit = cache.get(key);
    if (hit && same(hit.stats)) return hit;
    drop(key);
    const html = fs.readFileSync(build.file, 'utf8');
    const { sheets, stats } = sheetsOf(build.dir, html, url);
    const payload = { html, sheets, from: build.from, builtAt: new Date(build.at).toISOString(), path: url, frame: `${config.basePath}/shell-frame` };
    const tag = sha1(JSON.stringify(payload));
    const body = JSON.stringify({ ...payload, etag: tag });
    // a string's size in memory: up to two bytes a character
    const out = { body, etag: `"${tag}"`, stats: [[build.file, build.size, build.at], ...stats], bytes: body.length * 2 };
    cache.set(key, out);
    cacheBytes += out.bytes;
    while (cache.size > CACHE || cacheBytes > CACHE_BYTES) drop(cache.keys().next().value);
    return out;
  }

  function drop(key) {
    const old = cache.get(key);
    if (!old) return;
    cache.delete(key);
    cacheBytes -= old.bytes;
  }

  function routes(router) {
    router.add('GET', '/preview/:c/:id/shell', (ctx) => {
      // a collection of this site, an entry in it (a 404 otherwise, as the entry's own route answers)
      const c = store.collection(ctx.params.c);
      const summary = store.summarize(c, ctx.params.id, store.read(c, ctx.params.id).text);
      const url = summary.url;
      if (!url || !url.startsWith('/') || url.startsWith('//')) throw new HttpError(409, 'no-url', 'This entry has no page.');
      if (!config.verify?.public) throw new HttpError(404, 'not-built', 'The page around the text shows here once this server knows the site’s build folder (verify.public).');
      const [newest] = builds(c, ctx.params.id, url);
      if (!newest) throw new HttpError(404, 'not-built', 'The page around the text shows here after the site’s next build.');
      const { body, etag } = answer(newest, url);
      const res = ctx.res;
      res.setHeader('ETag', etag);
      // never on the browser's disk (a draft's, a protected page's HTML); the editor keeps it in memory and asks again
      // with If-None-Match
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Vary', 'Cookie');
      if (ctx.req.headers['if-none-match'] === etag) {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(body);
    });
  }

  /** GET /markstage/shell-frame: framed by the editor only, sandboxed by its own header, nothing loaded. */
  function frame(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      return res.end();
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', FRAME_CSP);
    res.removeHeader('X-Frame-Options');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(req.method === 'HEAD' ? undefined : FRAME_HTML);
  }

  /** What the answer cache holds (tests): answers and their bytes. */
  const cacheStats = () => ({ entries: cache.size, bytes: cacheBytes });

  return { routes, frame, cacheStats };
}
