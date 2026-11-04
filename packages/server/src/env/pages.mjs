// What a plan does to the built site: the pages whose HTML changed, the new ones and the removed ones (a removed
// page the new build turns into a redirect stub is not "removed"), from two build folders. Then, when Playwright is
// installed, before and after screenshots of the pages that changed, at 1440 and 390 wide, each build served from
// its folder on a loopback port for the time it takes. Every browser is closed when the shots are done, or fail.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { isRedirectStub } from '../verify.mjs';
import { realInside } from '../static-file.mjs';

const MAX_HTML = 5 * 1024 * 1024;
const MAX_SHOTS = 40;
const WIDTHS = [1440, 390];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.ico': 'image/x-icon' };

/** Every HTML page in a build folder: Map(site path -> file). */
function htmlPages(dir) {
  const out = new Map();
  if (!dir || !fs.existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.endsWith('.html')) {
        const rel = path.relative(dir, abs).split(path.sep).join('/');
        out.set(rel === 'index.html' ? '/' : rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`, abs);
      }
    }
  };
  walk(dir);
  return out;
}

const digest = (file) => {
  const st = fs.statSync(file);
  return st.size > MAX_HTML ? `size:${st.size}` : crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
};

/** {changed, added, removed, removedWithoutRedirect} as site paths, sorted. */
export function comparePages(beforeDir, afterDir) {
  const before = htmlPages(beforeDir);
  const after = htmlPages(afterDir);
  const changed = [];
  const added = [];
  const removed = [];
  const removedWithoutRedirect = [];
  for (const [p, f] of after) {
    if (!before.has(p)) {
      if (!isRedirectStub(f)) added.push(p);
    } else if (digest(f) !== digest(before.get(p))) {
      // a page that became a redirect is a removed page with its redirect
      if (isRedirectStub(f) && !isRedirectStub(before.get(p))) removed.push(p);
      else changed.push(p);
    }
  }
  for (const [p, f] of before) {
    if (after.has(p) || isRedirectStub(f)) continue;
    removed.push(p);
    removedWithoutRedirect.push(p);
  }
  const sort = (a) => a.sort();
  return { changed: sort(changed), added: sort(added), removed: sort(removed), removedWithoutRedirect: sort(removedWithoutRedirect) };
}

/** Serve a build folder on a loopback port (GET only, inside the folder only). Resolves {base, close}. */
function serve(dir) {
  const root = fs.realpathSync(dir);
  const server = http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      p = '/';
    }
    let file = path.resolve(root, `.${p}`);
    if (p.endsWith('/')) file = path.join(file, 'index.html');
    else if (!path.extname(file) && fs.existsSync(path.join(file, 'index.html'))) file = path.join(file, 'index.html');
    // inside the folder by its real path too: a symlink in a build never serves a file from elsewhere (S5)
    const inside = (file === root || file.startsWith(`${root}${path.sep}`)) && realInside(root, file);
    if (req.method !== 'GET' || !inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) }));
  });
}

/** Playwright's chromium, or null when it is not installed. `deps.playwright` (tests) is used as it is. */
async function chromiumOf(deps) {
  if ('playwright' in deps) return deps.playwright?.chromium ?? null;
  for (const name of ['playwright', '@playwright/test']) {
    try {
      const m = await import(name);
      return (m.chromium ?? m.default?.chromium) || null;
    } catch {
      // not installed: try the next, then say so
    }
  }
  return null;
}

/**
 * Before and after screenshots of the changed pages (at most 40), into `outDir`:
 * {status: 'done'|'not-available'|'failed', words, pages: [{path, kind, shots: [{width, before, after}]}]}.
 */
export async function screenshots({ beforeDir, afterDir, pages, outDir, deps = {} }) {
  const list = [...pages.changed.map((p) => ({ path: p, kind: 'changed' })), ...pages.added.map((p) => ({ path: p, kind: 'added' }))].slice(0, MAX_SHOTS);
  if (!list.length) return { status: 'done', words: 'No page looks different.', pages: [] };
  const chromium = await chromiumOf(deps);
  if (!chromium) return { status: 'not-available', words: 'Screenshots need Playwright on the server (npm i -D playwright, then npx playwright install chromium).', pages: [] };
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const servers = [];
  let browser = null;
  try {
    const before = await serve(beforeDir);
    servers.push(before);
    const after = await serve(afterDir);
    servers.push(after);
    browser = await chromium.launch();
    const out = [];
    for (const [i, item] of list.entries()) {
      const shots = [];
      for (const width of WIDTHS) {
        const names = {};
        for (const [side, srv] of [['before', before], ['after', after]]) {
          if (side === 'before' && item.kind === 'added') continue;
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          try {
            await page.goto(srv.base + item.path, { waitUntil: 'load', timeout: 30_000 });
            names[side] = `${i + 1}-${width}-${side}.png`;
            await page.screenshot({ path: path.join(outDir, names[side]), fullPage: true });
          } finally {
            await page.close();
          }
        }
        shots.push({ width, before: names.before ?? null, after: names.after ?? null });
      }
      out.push({ path: item.path, kind: item.kind, shots });
    }
    const more = pages.changed.length + pages.added.length - list.length;
    return { status: 'done', words: `${out.length} page${out.length === 1 ? '' : 's'} shot at ${WIDTHS.join(' and ')} wide${more > 0 ? ` (${more} more not shot)` : ''}.`, pages: out };
  } catch (e) {
    return { status: 'failed', words: `The screenshots failed: ${e.message.split('\n')[0]}`, pages: [] };
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const s of servers) await s.close();
  }
}
