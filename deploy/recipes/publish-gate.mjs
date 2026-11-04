#!/usr/bin/env node
// Optional publish gate (recipe): check the fresh build in a real browser at phone and desktop width, and only
// then run the real deploy. Copy it into the site repo (e.g. scripts/publish-gate.mjs), add `playwright` as a dev
// dependency (`npx playwright install chromium`), and point Markstage's deploy command at it:
//
//   "deploy": ["node", "scripts/publish-gate.mjs", "--baseline", "/srv/site/current/public",
//              "--", "markstage-deploy", "--to", "/srv/site"]
//
// Errors (the page scrolls sideways, an image is wider than the screen) fail the job, so Markstage reverts the
// change and the live site stays as it was. With --baseline (the live release), an error the live site already has
// is reported but does not block: a publish is stopped only by what it makes worse. Warnings (text under 12px, tap
// targets under 24px) go to the job log only.
// Options before `--`:  --dist dist  --baseline <dir>  --widths 390,1440  --pages /,/about/  (default: every page)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split < 0 ? argv : argv.slice(0, split);
const next = split < 0 ? [] : argv.slice(split + 1);
const opt = (name, fallback) => (own.includes(`--${name}`) ? own[own.indexOf(`--${name}`) + 1] : fallback);
const dist = path.resolve(opt('dist', 'dist'));
const baseline = opt('baseline', null) && fs.existsSync(opt('baseline')) ? fs.realpathSync(opt('baseline')) : null;
const widths = opt('widths', '390,1440').split(',').map(Number);

function allPages(dir, base = '/') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return allPages(path.join(dir, e.name), `${base}${e.name}/`);
    return e.name === 'index.html' ? [base] : [];
  });
}
// redirect stubs (meta refresh) have nothing to check and navigate away mid-check
const isRedirect = (p) => /<meta[^>]+http-equiv=["']?refresh/i.test(fs.readFileSync(path.join(dist, p, 'index.html'), 'utf8').slice(0, 2000));
const pages = opt('pages', null)?.split(',') ?? allPages(dist).filter((p) => !isRedirect(p));

// a build folder, served on a free loopback port for the browser
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2' };
async function serve(root) {
  const server = http.createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) return res.writeHead(400).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// runs in the page: what overflows at this width
const inspect = () => {
  const vw = document.documentElement.clientWidth;
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`;
  const visible = (el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  const errors = [];
  const warnings = [];
  // a real sideways scroll, not just a wide element the site clips
  window.scrollTo(100000, window.scrollY);
  if (window.scrollX > 0) errors.push(`page scrolls sideways on a ${vw}px screen`);
  window.scrollTo(0, window.scrollY);
  for (const img of document.images) if (visible(img) && img.getBoundingClientRect().width > vw + 1) errors.push(`image wider than the screen: ${img.currentSrc || img.src}`);
  const small = new Set();
  for (const el of document.querySelectorAll('p, li, td, th, a, span, label')) {
    if (visible(el) && el.textContent.trim() && parseFloat(getComputedStyle(el).fontSize) < 12) small.add(label(el));
  }
  if (small.size) warnings.push(`text under 12px: ${[...small].slice(0, 5).join(', ')}`);
  const tiny = new Set();
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea')) {
    const r = el.getBoundingClientRect();
    if (visible(el) && r.width && (r.width < 24 || r.height < 24) && getComputedStyle(el).display !== 'inline') tiny.add(label(el));
  }
  if (tiny.size) warnings.push(`tap targets under 24px: ${[...tiny].slice(0, 5).join(', ')}`);
  return { errors, warnings };
};

async function check(page, origin, p) {
  await page.goto(origin + p, { waitUntil: 'load' });
  // a script may still navigate after load: settle and try once more
  return page.evaluate(inspect).catch(async () => (await page.waitForLoadState('load'), page.evaluate(inspect)));
}

const browser = await chromium.launch();
const fresh = await serve(dist);
const live = baseline ? await serve(baseline) : null;
let blocking = 0;
let known = 0;
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const queue = [...pages];
    // four tabs at a time
    await Promise.all(
      [1, 2, 3, 4].map(async () => {
        const page = await context.newPage();
        for (let p = queue.shift(); p; p = queue.shift()) {
          const { errors, warnings } = await check(page, fresh.origin, p);
          for (const w of warnings) console.log(`warning ${width}px ${p}: ${w}`);
          if (!errors.length) continue;
          // only pages with errors are checked again, on the live release
          const before = live && fs.existsSync(path.join(baseline, p, 'index.html')) ? (await check(page, live.origin, p)).errors : [];
          for (const e of errors) {
            const old = before.includes(e);
            console.log(`${old ? 'live    ' : 'ERROR   '} ${width}px ${p}: ${e}${old ? ' (already on the live site)' : ''}`);
            if (old) known++;
            else blocking++;
          }
        }
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
  fresh.close();
  live?.close();
}
console.log(`publish gate: ${pages.length} page(s) at ${widths.join(' and ')}px: ${blocking} new error(s), ${known} already live`);
if (blocking) process.exit(1);
if (next.length) process.exit(spawnSync(next[0], next.slice(1), { stdio: 'inherit' }).status ?? 1);
