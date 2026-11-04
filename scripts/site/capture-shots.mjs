#!/usr/bin/env node
// Takes the public site's screenshots (site/media/*.webp) from the real editor, on a copy of examples/blog:
//
//   node scripts/site/capture-shots.mjs            all of them
//   node scripts/site/capture-shots.mjs canvas     only the named ones
//
// 1. Copies examples/blog to .wt-shots/site (git-ignored, inside the repo so it finds node_modules), as its own
//    git repo with a bare remote, and adds a made-up post and pictures (scripts/site/shots-seed.mjs).
// 2. Runs the blog's `astro dev` on 127.0.0.1:DEV_PORT: the editor in dev mode draws the canvas inside the real page.
// 3. Builds the editor for the copy and runs a Markstage server on 127.0.0.1:SERVER_PORT with a made-up owner, whose
//    password is made here and never printed. Its Library, releases, environments, Inbox and history are captured.
// 4. Writes each shot as WebP (sharp) under site/media/ and as PNG under docs/screenshots/ (for the README), then
//    closes the browser and stops both servers by their process (never by name), and removes .wt-shots.
//    hero-dark (the editor in its dark theme) goes to docs/screenshots/ only.
// Ports: odd five-digit, checked free first (SHOTS_PORT_BASE, default 18421: dev +0, server +2).
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTACT_FORM, DEMO_POST, LIBRARY, MESSAGES, PICTURES, thumbPage } from './shots-seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const WORK = path.join(ROOT, '.wt-shots');
const SITE = path.join(WORK, 'site');
const DATA = path.join(WORK, 'data');
const EDITOR = path.join(WORK, 'editor');
const OUT = path.join(ROOT, 'site', 'media');
const README_OUT = path.join(ROOT, 'docs', 'screenshots');
const BASE_PORT = Number(process.env.SHOTS_PORT_BASE ?? 18421);
const DEV_PORT = BASE_PORT;
const SERVER_PORT = BASE_PORT + 2;
const DEV = `http://127.0.0.1:${DEV_PORT}`;
const SERVER = `http://127.0.0.1:${SERVER_PORT}`;
const SITE_HOST = 'www.example.com';
const OWNER = { name: 'Jordan Example', email: 'jordan@example.com', password: `Shots-${crypto.randomBytes(12).toString('base64url')}` };
const VIEW = { width: 1440, height: 900 };
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);

const git = (...args) =>
  execFileSync('git', ['-c', 'user.name=Alex Rivera', '-c', 'user.email=alex@example.com', ...args], { cwd: SITE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listening(port) {
  try {
    return execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
  } catch {
    return false;
  }
}

async function up(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {
      /* not yet */
    }
    await sleep(300);
  }
  throw new Error(`${url} did not answer within ${ms / 1000} s`);
}

/** The example blog as its own repo, with a history and a remote, plus the made-up post. */
function makeSite(pictures) {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const blog = path.join(ROOT, 'examples', 'blog');
  const skip = new Set(['node_modules', 'dist', '.astro', '.markstage', 'uploads', 'test']);
  fs.cpSync(blog, SITE, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
  // the search preview and the share links name the example address, not the dev server's
  const cfg = path.join(SITE, 'markstage.config.mjs');
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace("siteName: 'Example blog',", `siteName: 'Example blog',\n  siteUrl: 'https://${SITE_HOST}',`));
  fs.writeFileSync(path.join(SITE, '.gitignore'), 'node_modules/\ndist/\n.astro/\n.markstage/\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Example blog: posts, authors and the editor config');
  const uploads = path.join(SITE, 'public', 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  fs.writeFileSync(path.join(uploads, 'calendar-cover.png'), pictures['calendar-cover.png']);
  fs.writeFileSync(path.join(SITE, 'src/content/posts/content-calendar.md'), DEMO_POST);
  git('add', '-A');
  git('-c', 'user.name=Sam Lee', '-c', 'user.email=sam@example.com', 'commit', '-q', '-m', 'New post: Plan a content calendar your whole team keeps');
  const hello = path.join(SITE, 'src/content/posts/hello-markstage.md');
  fs.writeFileSync(hello, fs.readFileSync(hello, 'utf8').replace('Only the blocks\nyou change are rewritten', 'Only the blocks you\nchange are rewritten, so a review shows exactly what moved'));
  git('commit', '-q', '-am', 'Hello post: say what a review shows');
  const remote = path.join(WORK, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '-u', 'origin', 'main');
  git('push', '-q', 'origin', 'main:staging');
}

/** PNG bytes of each picture in shots-seed.mjs, drawn by the browser. */
async function drawPictures(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  const out = {};
  for (const p of PICTURES) {
    await page.setContent(p.html);
    out[p.name] = await page.screenshot({ type: 'png' });
  }
  await page.close();
  return out;
}

/** A screenshot to site/media/<name>.webp (under about 250 KB; `site: false` skips it) and docs/screenshots/<name>.png. */
async function save(buffer, name, { quality = 82, site = true } = {}) {
  const sharp = (await import('sharp')).default;
  // the README's copy: at most 1920 px wide (sharp on a 2x shot), a 256-colour palette keeps the editor's flat UI sharp
  fs.mkdirSync(README_OUT, { recursive: true });
  const png = await sharp(buffer).resize({ width: 1920, withoutEnlargement: true }).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(README_OUT, `${name}.png`), png);
  console.log(`  docs/screenshots/${name}.png ${Math.round(png.length / 1024)} KB`);
  if (!site) return;
  let q = quality;
  let webp;
  for (;;) {
    webp = await sharp(buffer).webp({ quality: q, effort: 6 }).toBuffer();
    if (webp.length <= 250 * 1024 || q <= 50) break;
    q -= 8;
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.webp`), webp);
  const { width, height } = await sharp(webp).metadata();
  console.log(`  ${name}.webp ${width}x${height} ${Math.round(webp.length / 1024)} KB`);
}

function start(argv, opts) {
  const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.log = () => log.slice(-3000);
  return child;
}

/** Stops a server we started, and checks its port is free again. */
async function stop(child, port) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 40 && listening(port); i++) await sleep(250);
  if (listening(port)) child.kill('SIGKILL');
}

async function editorPage(browser, { folded = true, scale = 1, colorScheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: scale, colorScheme });
  // in the top page only: the canvas's sandboxed frames have no localStorage
  if (folded) await ctx.addInitScript(() => {
    try {
      if (window === window.top) localStorage.setItem('markstage.drawer', JSON.stringify({ folded: true }));
    } catch {
      // about:blank has no storage
    }
  });
  // the first-visit hint at the foot of the canvas, already seen (packages/editor/src/hint.ts)
  await ctx.addInitScript(() => {
    try {
      if (window === window.top) localStorage.setItem('markstage.hint.closed', '1');
    } catch {
      // about:blank has no storage
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  return page;
}

async function settle(page, ms = 1200) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

/** Dev mode (astro dev): the canvas on the real page, the outline and the search checks. */
async function devShots(browser) {
  const entry = `${DEV}/markstage/#/e/posts/content-calendar`;
  const canvasReady = (page) => page.locator('.ms-canvas > .ProseMirror').first().waitFor({ timeout: 90_000 });
  if (want('canvas') || want('hero')) {
    const page = await editorPage(browser, { scale: 2 });
    await page.goto(entry);
    await canvasReady(page);
    await settle(page, 2500);
    const shot = await page.screenshot({ type: 'png' });
    if (want('hero')) await save(shot, 'hero', { quality: 78 });
    if (want('canvas')) {
      // the text, the list and the table under the cover
      await page.locator('.ms-canvas > .ProseMirror > h2').first().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 120);
      await settle(page, 1200);
      await save(await page.screenshot({ type: 'png', scale: 'css' }), 'canvas');
    }
    await page.context().close();
  }
  if (want('hero-dark')) {
    // the editor's System theme follows the browser: dark, and the canvas draws the blog in its own dark colours
    const page = await editorPage(browser, { scale: 2, colorScheme: 'dark' });
    await page.goto(entry);
    await canvasReady(page);
    await settle(page, 2500);
    await save(await page.screenshot({ type: 'png' }), 'hero-dark', { site: false });
    await page.context().close();
  }
  const panels = [
    ['outline', '[data-sections]'],
    ['seo', '[data-seo]'],
  ];
  for (const [name, button] of panels) {
    if (!want(name)) continue;
    const page = await editorPage(browser);
    await page.goto(entry);
    await canvasReady(page);
    await settle(page);
    await page.locator(button).first().click();
    await settle(page, 1800);
    await save(await page.screenshot({ type: 'png' }), name);
    await page.context().close();
  }
}

/** The server's config: the copy, the built editor, the dev server as the preview, a contact form. */
function serverConfig() {
  return {
    contentRoot: SITE,
    publicOrigin: SERVER,
    port: SERVER_PORT,
    editorDir: EDITOR,
    siteHosts: [SITE_HOST],
    preview: { devServer: DEV },
    forms: { contact: CONTACT_FORM },
    commands: { build: [process.execPath, '-e', '0'], deploy: [process.execPath, '-e', '0'], timeoutSeconds: 60 },
    login: { ipMaxAttempts: 1000 },
  };
}

async function api(method, p, body, jar, contentType = 'application/octet-stream') {
  const headers = { Origin: SERVER };
  if (jar.cookie) headers.Cookie = jar.cookie;
  if (jar.csrf && method !== 'GET') headers['X-CSRF-Token'] = jar.csrf;
  let payload = body;
  if (body && !Buffer.isBuffer(body)) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  } else if (Buffer.isBuffer(body)) headers['Content-Type'] = contentType;
  const res = await fetch(`${SERVER}/markstage/api/${p}`, { method, headers, body: payload });
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  if (cookies.length) jar.cookie = cookies.join('; ');
  const json = await res.json().catch(() => null);
  if (json?.csrfToken) jar.csrf = json.csrfToken;
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** A message through the site's contact form, as a visitor's browser sends it (on the site's host). */
async function sendMessage(m) {
  const { request } = await import('node:http');
  const payload = new URLSearchParams({ ...m, pageUrl: `https://${SITE_HOST}/posts/hello-markstage/`, referrerURL: 'https://www.google.com/' }).toString();
  await new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: SERVER_PORT, path: '/markstage/forms/contact', method: 'POST', headers: { Host: SITE_HOST, Origin: `https://${SITE_HOST}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        res.resume();
        res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error(`form: ${res.statusCode}`))));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** Each Library item's card picture: its own blocks drawn with the blog's CSS (PUT library/:id/thumb). */
async function libraryPictures(browser, jar) {
  const css = fs.readFileSync(path.join(SITE, 'src/styles/blog.css'), 'utf8');
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const { items } = await api('GET', 'library?perPage=200', undefined, jar);
  for (const { id } of items) {
    const item = await api('GET', `library/${id}`, undefined, jar);
    const { html, width, height } = thumbPage(item, css);
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    await api('PUT', `library/${id}/thumb`, await page.screenshot({ type: 'png' }), jar, 'image/png');
  }
  await page.close();
}

async function seedServer(pictures, browser) {
  const env = { ...process.env, MARKSTAGE_DATA_DIR: DATA, NODE_ENV: 'development' };
  const code = execFileSync(process.execPath, [path.join(ROOT, 'packages/server/bin/markstage-server.mjs'), 'setup-code'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const setupCode = /setup code[^:]*:\s*(\S+)/.exec(code)?.[1];
  if (!setupCode) throw new Error('No setup code from markstage-server setup-code');
  const jar = {};
  await api('POST', 'auth/setup', { setupCode, email: OWNER.email, name: OWNER.name, password: OWNER.password }, jar);
  for (const p of PICTURES.filter((x) => x.name !== 'calendar-cover.png')) {
    await api('POST', `media?filename=${encodeURIComponent(p.name)}&alt=${encodeURIComponent(p.alt)}`, pictures[p.name], jar);
  }
  for (const item of LIBRARY) await api('POST', 'library', item, jar);
  await libraryPictures(browser, jar);
  const release = await api('POST', 'releases', { name: 'Friday posts', description: 'This week’s three posts, live together on Friday morning.' }, jar);
  const changes = {
    'content-calendar': 'A weekly rhythm for drafting, reviewing and publishing posts, kept next to the posts themselves.',
    'keyboard-shortcuts': 'The few keys worth learning, with a printable list.',
    'a-draft': 'A draft that goes live with the others on Friday.',
  };
  for (const [id, description] of Object.entries(changes)) {
    const entry = await api('GET', `collections/posts/entries/${id}`, undefined, jar);
    const { draft, status, publishAt, ...frontmatter } = entry.frontmatter ?? {};
    await api('POST', `releases/${release.id}/items`, { kind: 'entry', collection: 'posts', id, version: entry.version, frontmatter: { ...frontmatter, description } }, jar).catch((e) => console.error(`  release item ${id}: ${e.message}`));
  }
  for (const m of MESSAGES) {
    await sendMessage({ ...m, started: String(Date.now() - 60_000) });
    await sleep(150);
  }
}

/** about:blank first, so the editor loads anew; the editor may still be moving, so a few tries (e2e/support.mjs). */
async function blank(page) {
  for (let i = 0; ; i++) {
    try {
      return await page.goto('about:blank', { waitUntil: 'commit', timeout: 5000 });
    } catch (e) {
      if (i >= 4) throw e;
      await page.waitForTimeout(300);
    }
  }
}

async function signIn(page) {
  await page.goto(`${SERVER}/markstage/#/sign-in`);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.hash.startsWith('#/sign-in'), { timeout: 30_000 });
}

/** Server shots: each `[name, hash]` opened signed in, the drawer open. */
const SERVER_SHOTS = [
  ['home', '#/'],
  ['library', '#/library'],
  ['releases', '#/releases'],
  ['environments', '#/environments'],
  ['inbox', '#/inbox'],
  ['history', '#/revisions/posts/hello-markstage'],
  ['media', '#/media'],
];

/** What each server shot does before it is taken. */
const ACTIONS = {
  // the older saved version, compared with the text now, side by side
  history: (page) => page.locator('ol.ms-adm-revs[aria-label^="Saved versions"] a.ms-adm-rev').nth(1).click({ timeout: 5000 }),
  // the first message, open
  inbox: (page) => page.locator('tbody a.ms-adm-rowlink').first().click({ timeout: 5000 }),
  // fetch the shared remote, so the branches show what is ahead and behind
  environments: (page) => page.getByRole('button', { name: 'Look for changes' }).click({ timeout: 5000 }),
};

/** The "signed in from a new device" notices of a fresh owner, marked seen. */
async function dismissNotices(page) {
  for (let i = 0; i < 8; i++) {
    const seen = page.locator('.ms-notices button[aria-label^="Seen"], .ms-notices button:text-is("Seen")').first();
    if (!(await seen.isVisible().catch(() => false))) return;
    await seen.click();
    await page.waitForTimeout(500);
  }
}

async function serverShots(browser) {
  const page = await editorPage(browser, { folded: false });
  await signIn(page);
  await settle(page, 1500);
  await dismissNotices(page);
  for (const [name, hash] of SERVER_SHOTS) {
    if (!want(name)) continue;
    await blank(page);
    await page.goto(`${SERVER}/markstage/${hash}`);
    await settle(page, 2500);
    await ACTIONS[name]?.(page).catch((e) => console.error(`  ${name}: ${e.message}`));
    await settle(page, 1500);
    await save(await page.screenshot({ type: 'png' }), name);
  }
  await page.context().close();
}

async function main() {
  for (const port of [DEV_PORT, SERVER_PORT]) if (listening(port)) throw new Error(`Port ${port} is in use: set SHOTS_PORT_BASE to another free odd port.`);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  let dev;
  let server;
  try {
    const pictures = await drawPictures(browser);
    makeSite(pictures);
    console.log(`Dev server on ${DEV}`);
    dev = start([process.execPath, path.join(ROOT, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', '127.0.0.1', '--port', String(DEV_PORT), '--ignore-lock'], { cwd: SITE });
    await up(`${DEV}/`, 90_000).catch((e) => {
      throw new Error(`${e.message}\n${dev.log()}`);
    });
    await devShots(browser);
    if (SERVER_SHOTS.some(([n]) => want(n))) {
      console.log('Building the editor for the server');
      execFileSync(process.execPath, [path.join(ROOT, 'packages/astro/bin/markstage.mjs'), 'build-editor', '--out', EDITOR], { cwd: SITE, stdio: ['ignore', 'ignore', 'inherit'] });
      fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(serverConfig(), null, 2), { mode: 0o600 });
      console.log(`Markstage server on ${SERVER}`);
      server = start([process.execPath, path.join(ROOT, 'packages/server/bin/markstage-server.mjs'), 'serve'], { cwd: ROOT, env: { ...process.env, MARKSTAGE_DATA_DIR: DATA, NODE_ENV: 'development' } });
      await up(`${SERVER}/markstage/api/auth/me`, 60_000).catch((e) => {
        throw new Error(`${e.message}\n${server.log()}`);
      });
      await seedServer(pictures, browser);
      await serverShots(browser);
    }
  } catch (e) {
    if (server) console.error(server.log());
    throw e;
  } finally {
    await browser.close();
    await stop(server, SERVER_PORT);
    await stop(dev, DEV_PORT);
    if (!process.env.SHOTS_KEEP) fs.rmSync(WORK, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
