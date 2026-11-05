#!/usr/bin/env node
// Records what the live demo reads (docs/DEMO.md): the answers a real Markstage server gives the real editor for the
// example blog, saved as JSON and replayed in the browser by the demo's API stand-in (packages/editor/src/demo/).
//
//   npm run demo:record            writes scripts/demo/recorded/api.json
//
// 1. Copies examples/blog to .wt-demo/site (git-ignored, inside the repo so it finds node_modules) as its own git
//    repo, builds the editor for it and runs a Markstage server on 127.0.0.1 with a made-up owner, whose password is
//    made here and never printed.
// 2. Signs in with Playwright and opens every screen and every post, keeping each JSON answer to a GET under
//    /markstage/api/ (its path and query, status and body). Each entry's source is fetched too.
// 3. Cleans what could tell anything about this machine (its folders, the server's address, the loopback address,
//    the sign-in's tokens) and writes one route per line, so a review reads it.
// 4. Closes the browser, stops the server by its own process (never by name) and removes .wt-demo.
// Port: DEMO_RECORD_PORT (default 23433, odd, checked free first).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listening, start, stop, up } from './lib.mjs';
import { curate, recordedText, scrub, PER_POST, SCREENS, OWNER_NAME, OWNER_EMAIL } from './record-plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const WORK = path.join(ROOT, '.wt-demo');
const SITE = path.join(WORK, 'site');
const DATA = path.join(WORK, 'data');
const EDITOR = path.join(WORK, 'editor');
const OUT = path.join(here, 'recorded', 'api.json');
const PORT = Number(process.env.DEMO_RECORD_PORT ?? 23433);
const SERVER = `http://127.0.0.1:${PORT}`;
const API = '/markstage/api/';
const OWNER = { name: OWNER_NAME, email: OWNER_EMAIL, password: `Demo-${crypto.randomBytes(12).toString('base64url')}` };

const git = (...args) => execFileSync('git', ['-c', 'user.name=Alex Rivera', '-c', 'user.email=alex@example.com', ...args], { cwd: SITE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The example blog as its own repo, one commit (the History screen shows it). */
function makeSite() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const skip = new Set(['node_modules', 'dist', '.astro', '.markstage', 'uploads', 'test']);
  fs.cpSync(path.join(ROOT, 'examples', 'blog'), SITE, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
  fs.writeFileSync(path.join(SITE, '.gitignore'), 'node_modules/\ndist/\n.astro/\n.markstage/\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Example blog: posts, authors and the editor config');
}

async function api(method, p, body, jar) {
  const headers = { Origin: SERVER, Accept: 'application/json' };
  if (jar.cookie) headers.Cookie = jar.cookie;
  if (jar.csrf && method !== 'GET') headers['X-CSRF-Token'] = jar.csrf;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${SERVER}${API}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  if (cookies.length) jar.cookie = cookies.join('; ');
  const json = await res.json().catch(() => null);
  if (json?.csrfToken) jar.csrf = json.csrfToken;
  return { status: res.status, json };
}

async function signIn(page) {
  await page.goto(`${SERVER}/markstage/#/sign-in`);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.hash.startsWith('#/sign-in'), { timeout: 30_000 });
}

async function settle(page, ms = 1200) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

async function main() {
  if (listening(PORT)) throw new Error(`Port ${PORT} is in use: set DEMO_RECORD_PORT to another free odd port.`);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  let server;
  const routes = new Map();
  const writes = new Set();
  const other = new Set();
  try {
    makeSite();
    console.log('Building the editor for the copy');
    execFileSync(process.execPath, [path.join(ROOT, 'packages/astro/bin/markstage.mjs'), 'build-editor', '--out', EDITOR], { cwd: SITE, stdio: ['ignore', 'ignore', 'inherit'] });
    const config = { contentRoot: SITE, publicOrigin: SERVER, port: PORT, editorDir: EDITOR, siteHosts: ['www.example.com'], commands: { build: [process.execPath, '-e', '0'], deploy: [process.execPath, '-e', '0'], timeoutSeconds: 60 }, login: { ipMaxAttempts: 1000 } };
    fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
    const env = { ...process.env, MARKSTAGE_DATA_DIR: DATA, NODE_ENV: 'development' };
    server = start([process.execPath, path.join(ROOT, 'packages/server/bin/markstage-server.mjs'), 'serve'], { cwd: ROOT, env });
    await up(`${SERVER}${API}auth/me`, 60_000).catch((e) => {
      throw new Error(`${e.message}\n${server.log()}`);
    });
    const code = execFileSync(process.execPath, [path.join(ROOT, 'packages/server/bin/markstage-server.mjs'), 'setup-code'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const setupCode = /setup code[^:]*:\s*(\S+)/.exec(code)?.[1];
    if (!setupCode) throw new Error('No setup code from markstage-server setup-code');
    const jar = {};
    const made = await api('POST', 'auth/setup', { setupCode, email: OWNER.email, name: OWNER.name, password: OWNER.password }, jar);
    if (made.status >= 300) throw new Error(`auth/setup answered ${made.status}: ${made.json?.message ?? ''}`);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // the first-visit hint at the foot of the canvas, already seen
    await ctx.addInitScript(() => {
      try {
        if (window === window.top) localStorage.setItem('markstage.hint.closed', '1');
      } catch {
        // about:blank has no storage
      }
    });
    const page = await ctx.newPage();
    page.on('response', async (res) => {
      const req = res.request();
      const url = new URL(req.url());
      if (url.origin !== SERVER) return;
      if (!url.pathname.startsWith(API)) return void other.add(`${req.method()} ${url.pathname}`);
      const key = url.pathname.slice(API.length) + url.search;
      if (req.method() !== 'GET') return void writes.add(`${req.method()} ${key}`);
      if (res.status() === 304) return;
      const type = res.headers()['content-type'] ?? '';
      if (!type.includes('json')) return void other.add(`GET ${key} (${type})`);
      const body = await res.json().catch(() => undefined);
      if (body === undefined) return;
      routes.set(key, { status: res.status(), body });
    });
    await signIn(page);
    await settle(page, 1500);
    const index = (await api('GET', 'index', null, jar)).json?.items ?? [];
    const posts = index.filter((i) => i.collection === 'posts');
    for (const hash of [...SCREENS, ...posts.flatMap((p) => PER_POST.map((h) => h.replace('{id}', p.id)))]) {
      await page.goto(`${SERVER}/markstage/${hash}`);
      if (hash.startsWith('#/e/')) await page.locator('.ms-canvas > .ProseMirror').first().waitFor({ timeout: 60_000 });
      await settle(page, 1500);
      console.log(`  ${hash}`);
    }
    // what the editor reads only on a click: each entry's source (Source mode, Copy as Markdown) and its history
    for (const p of index) {
      for (const sub of ['', '/source']) {
        const key = `collections/${p.collection}/entries/${p.id}${sub}`;
        if (routes.has(key)) continue;
        const r = await api('GET', key, null, jar);
        if (r.json) routes.set(key, { status: r.status, body: r.json });
      }
    }
    await ctx.close();
  } catch (e) {
    if (server) console.error(server.log());
    throw e;
  } finally {
    await browser.close();
    await stop(server, PORT);
  }
  const clean = curate(new Map([...routes].map(([k, v]) => [k, scrub(v, { roots: [SITE, DATA, EDITOR, WORK, ROOT], origin: SERVER })])));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, recordedText(clean));
  if (!process.env.DEMO_KEEP) fs.rmSync(WORK, { recursive: true, force: true });
  console.log(`${clean.size} answers in ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
  console.log(`writes the editor made while reading (answered by the stand-in):\n  ${[...writes].sort().join('\n  ')}`);
  if (other.size) console.log(`other requests (not recorded):\n  ${[...other].sort().join('\n  ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
