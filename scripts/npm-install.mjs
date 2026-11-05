#!/usr/bin/env node
// The npm packages installed for real (docs/PUBLISHING.md "npm"; CI job "npm install test", on Node 24 and 22.13):
// what a person gets from `npm install @markstage/astro @markstage/server`, before anything is on npm.
//
//   npm run test:npm-install [-- --port 37451] [--keep] [--no-browser] [--astro-node /path/to/node]
//
// 1. `npm pack` the four packages into a temporary folder (the tarballs npm would publish, never a link);
// 2. a new site from examples/starter in the same temporary folder, its @markstage packages taken from those
//    tarballs; `npm install` (the third-party packages come from the registry or npm's cache);
// 3. each @markstage package is a real folder in node_modules (no link back to this checkout) at the repo's version;
// 4. `astro build`, then `markstage build-editor` (the editor's TypeScript compiled by the site's own Vite, from
//    node_modules), whose release line is the packages' version; and `astro dev` (the port after --port, or the
//    first free odd one from 37481), where the post opens in the editor;
// 5. the site made a git repository; `markstage-server init`, a config.json, `markstage-server serve` on a free odd
//    port on 127.0.0.1, `markstage-server setup-code`, and the owner made with that code;
// 6. in Chromium (Playwright from this checkout): sign in, open a post in the editor, type, save; the post's file
//    has the words and the site has a new git commit. Without a browser (--no-browser) the save goes through the API.
// Everything it made is removed at the end, the server stopped and the browser closed, pass or fail (--keep leaves
// the folders). Exits 1 on the first failure.
//
// Markstage runs on Node 22.13 or newer; Astro itself may ask for more (Astro 7.4 wants 22.23.4 or newer on the 22
// line, and refuses to start below it). On a Node older than the installed Astro allows, `astro build` runs with the
// Node named by --astro-node (or MARKSTAGE_ASTRO_NODE), `astro dev` is left out and the last line says so; everything
// Markstage's own (the install, build-editor, the server, the editor, the save) still runs on this Node. Without
// --astro-node it stops and says why.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { copyStarter, withVendor } from './create-site.mjs';
import { PACKAGES, REPO, meetsEngines, packAll } from './lib/npm-packages.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const keep = argv.includes('--keep');
const useBrowser = !argv.includes('--no-browser');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
const POST = 'welcome';
const WORDS = `Installed from npm on Node ${process.versions.node}. `;
const ASTRO_NODE = opt('--astro-node') ?? process.env.MARKSTAGE_ASTRO_NODE ?? null;
const notes = [];

const made = { dir: null, server: null, dev: null, browser: null };
const log = (text) => console.log(`# ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (message) => {
  throw new Error(message);
};
const run = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
/** A command whose output is shown only when it fails. */
function step(what, cmd, args, cwd, env) {
  const started = Date.now();
  try {
    run(cmd, args, cwd, env);
  } catch (e) {
    console.error(`${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim().split('\n').slice(-60).join('\n'));
    fail(`${what} failed (${cmd} ${args.join(' ')})`);
  }
  log(`${what}: ${Math.round((Date.now() - started) / 1000)} s`);
}

const portFree = (p) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
  });
/** The first free odd port from `from` on. */
async function freeOddPort(from) {
  for (let p = from | 1; p < from + 400; p += 2) if (await portFree(p)) return p;
  fail(`no free odd port from ${from}`);
}

async function waitFor(url, ms, proc = made.server) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (proc.exitCode !== null) fail(`${proc.spawnargs.slice(0, 2).map((a) => path.basename(a)).join(' ')} stopped (exit ${proc.exitCode})`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  fail(`${url} did not answer within ${ms / 1000} s`);
}

/** Every installed @markstage/* folder under a node_modules, nested ones included. */
function markstageCopies(nodeModules, out = []) {
  if (!fs.existsSync(nodeModules)) return out;
  for (const name of fs.readdirSync(nodeModules)) {
    const at = path.join(nodeModules, name);
    if (name === '@markstage') for (const p of fs.readdirSync(at)) out.push(path.join(at, p)), markstageCopies(path.join(at, p, 'node_modules'), out);
    else if (name.startsWith('@') && fs.statSync(at).isDirectory()) for (const p of fs.readdirSync(at)) markstageCopies(path.join(at, p, 'node_modules'), out);
    else if (!name.startsWith('.')) markstageCopies(path.join(at, 'node_modules'), out);
  }
  return out;
}

/** 1 to 3: the tarballs, a new site that installs them, and proof that they are copies at the repo's version. */
function installSite(dir) {
  const tgz = path.join(dir, 'tarballs');
  const packed = packAll(tgz);
  for (const p of packed) log(`packed ${p.filename}: ${p.entryCount} files, ${(p.size / 1024).toFixed(0)} KB`);
  const site = path.join(dir, 'site');
  copyStarter(site);
  const deps = Object.fromEntries(packed.map((p) => [p.name, `file:${path.join(tgz, p.filename)}`]));
  const file = path.join(site, 'package.json');
  // the integration and the server, as a site adds them; core and editor too (overrides), since npm cannot fetch
  // them from the registry before the first publish
  fs.writeFileSync(file, `${JSON.stringify(withVendor(JSON.parse(fs.readFileSync(file, 'utf8')), deps, { name: 'npm-install-test' }), null, 2)}\n`);
  step('npm install', NPM, ['install', '--no-audit', '--no-fund', '--prefer-offline'], site);
  for (const p of PACKAGES) {
    const at = path.join(site, 'node_modules/@markstage', p);
    if (fs.lstatSync(at).isSymbolicLink()) fail(`node_modules/@markstage/${p} is a link, not an installed copy`);
    const real = fs.realpathSync(at);
    if (real.startsWith(`${REPO}${path.sep}`)) fail(`node_modules/@markstage/${p} resolves into the checkout (${real})`);
    const v = JSON.parse(fs.readFileSync(path.join(at, 'package.json'), 'utf8')).version;
    if (v !== VERSION) fail(`@markstage/${p} installed at ${v}, not ${VERSION}`);
    for (const t of ['test', 'e2e']) if (fs.existsSync(path.join(at, t))) fail(`@markstage/${p} has a ${t}/ folder`);
  }
  const copies = markstageCopies(path.join(site, 'node_modules'));
  if (copies.length !== PACKAGES.length) fail(`one copy of each @markstage package expected, found:\n${copies.join('\n')}`);
  log(`installed ${PACKAGES.map((p) => `@markstage/${p}@${VERSION}`).join(', ')} as copies`);
  return site;
}

/** The Node `astro` needs, when this one is older than the installed Astro allows: null when this one will do. */
function astroNode(site) {
  const engines = JSON.parse(fs.readFileSync(path.join(site, 'node_modules/astro/package.json'), 'utf8')).engines?.node;
  if (!engines || meetsEngines(process.versions.node, engines)) return null;
  if (!ASTRO_NODE) fail(`Astro here needs Node ${engines}, and this is ${process.versions.node}: pass --astro-node <a node that Astro allows> (or set MARKSTAGE_ASTRO_NODE) to run astro build with it`);
  const other = run(ASTRO_NODE, ['-p', 'process.versions.node'], site).trim();
  if (!meetsEngines(other, engines)) fail(`--astro-node is Node ${other}; Astro here needs ${engines}`);
  notes.push(`astro build ran on Node ${other} and astro dev was left out: Astro ${JSON.parse(fs.readFileSync(path.join(site, 'node_modules/astro/package.json'), 'utf8')).version} needs Node ${engines}`);
  return { bin: ASTRO_NODE, version: other };
}

/** 4: the site builds, and the editor builds from node_modules. */
function build(site, dir, other) {
  if (other) {
    // npm and the build's own children find that Node first on the PATH
    const env = { PATH: `${path.dirname(other.bin)}${path.delimiter}${process.env.PATH}` };
    step(`astro build (on Node ${other.version})`, other.bin, [path.join(site, 'node_modules/astro/bin/astro.mjs'), 'build'], site, env);
  } else step('astro build', NPM, ['run', 'build'], site);
  for (const p of ['welcome', 'writing-in-markdown']) if (!fs.existsSync(path.join(site, 'dist/posts', p, 'index.html'))) fail(`the build has no posts/${p}/`);
  const editorDir = path.join(dir, 'editor');
  step('markstage build-editor', path.join(site, 'node_modules/.bin/markstage'), ['build-editor', '--out', editorDir], site);
  const built = JSON.parse(fs.readFileSync(path.join(editorDir, 'markstage-editor.json'), 'utf8'));
  if (built.markstage !== VERSION) fail(`the editor build says Markstage ${built.markstage}, not ${VERSION}`);
  if (!built.release?.startsWith(`v${VERSION}`)) fail(`the editor's release line is "${built.release}", not v${VERSION}`);
  if (!fs.existsSync(path.join(editorDir, 'preview-agent.js'))) fail('the editor build has no preview-agent.js');
  log(`editor built: ${built.js}, release line "${built.release}"`);
  return editorDir;
}

/**
 * 4, in `astro dev`: the editor at /markstage/ from node_modules, compiled by Vite's dev server on the fly. With a
 * browser the post opens on the canvas; without one the editor page and its script answer.
 */
async function devCheck(site, pw) {
  const port = await freeOddPort(opt('--port') ? Number(opt('--port')) + 2 : 37481);
  const base = `http://127.0.0.1:${port}`;
  // the site's own Astro, through its API (the command line may move itself to the background, out of reach)
  const astro = await import(pathToFileURL(createRequire(path.join(site, 'package.json')).resolve('astro')).href);
  made.dev = await astro.dev({ root: site, server: { host: '127.0.0.1', port }, logLevel: 'error' });
  try {
    const html = await (await fetch(`${base}/markstage/`)).text();
    if (!/virtual:markstage\/client|markstage/.test(html)) fail('astro dev: /markstage/ is not the editor page');
    if (pw) {
      const page = await (await made.browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}/markstage/#/e/posts/${POST}`);
      await page.locator('.ProseMirror > p').first().waitFor({ timeout: 60_000 });
      if (errors.length) fail(`astro dev: the editor threw: ${errors.join('; ')}`);
      await page.context().close();
      // let the requests the page left in flight finish, so stopping the server does not cut one off mid-load
      await sleep(1500);
      log('astro dev: the post opens in the editor (Vite compiled it from node_modules)');
    } else log('astro dev: /markstage/ answers');
  } finally {
    await made.dev.stop();
    made.dev = null;
  }
}

/** 5: git, the server's data dir and config, the server, its setup code and the owner. */
async function serve(site, dir, editorDir) {
  const gitEnv = { GIT_AUTHOR_NAME: 'Markstage npm test', GIT_AUTHOR_EMAIL: 'npm-test@example.com', GIT_COMMITTER_NAME: 'Markstage npm test', GIT_COMMITTER_EMAIL: 'npm-test@example.com' };
  Object.assign(process.env, Object.fromEntries(Object.entries(gitEnv).filter(([k]) => !process.env[k])));
  // dist/ and node_modules/ stay out of git, as the starter's .gitignore says
  run('git', ['init', '-q', '-b', 'main'], site);
  run('git', ['add', '-A'], site);
  run('git', ['commit', '-q', '-m', 'A new site from the starter, installed from npm tarballs'], site);
  const data = path.join(dir, 'data');
  const bin = path.join(site, 'node_modules/.bin/markstage-server');
  run(bin, ['init', data], site);
  if (!fs.existsSync(path.join(data, 'config.json'))) fail('markstage-server init wrote no config.json');
  const port = Number(opt('--port')) || (await freeOddPort(37451));
  const origin = `http://127.0.0.1:${port}`;
  const config = { contentRoot: site, editorDir, commands: { build: ['npm', 'run', 'build'], deploy: null }, checks: [], verify: { public: 'dist' } };
  fs.writeFileSync(path.join(data, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const env = { ...process.env, MARKSTAGE_DATA_DIR: data, MARKSTAGE_PORT: String(port), MARKSTAGE_HOST: '127.0.0.1', MARKSTAGE_PUBLIC_ORIGIN: origin };
  run(bin, ['check'], site, env);
  const out = fs.openSync(path.join(dir, 'server.log'), 'a');
  made.server = spawn(bin, ['serve'], { cwd: site, env, stdio: ['ignore', out, out] });
  await waitFor(`${origin}/markstage/api/auth/me`, 60_000);
  log(`markstage-server serve answers on ${origin}`);

  const page = await (await fetch(`${origin}/markstage/`)).text();
  if (/The editor is not built yet/.test(page) || !page.includes('/markstage/assets/')) fail('/markstage/ is not the built editor');
  const release = await (await fetch(`${origin}/markstage/api/release`)).json();
  if (!release.line?.startsWith(`v${VERSION}`)) fail(`the server's release line is "${release.line}", not v${VERSION}`);

  const code = /code[^:]*:\s*(\S+)/i.exec(run(bin, ['setup-code'], site, env))?.[1];
  if (!code) fail('markstage-server setup-code printed no code');
  const owner = { email: 'owner@example.com', name: 'Npm Owner', password: `Npm-${Math.random().toString(36).slice(2)}-${Date.now()}` };
  const setup = await fetch(`${origin}/markstage/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ setupCode: code, ...owner }) });
  if (setup.status !== 201) fail(`POST auth/setup answered ${setup.status}: ${await setup.text()}`);
  log('the owner was made with the setup code');
  return { origin, owner, cookie: setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

/** 6, in a browser: sign in, open the post, type at the start of its first paragraph, save. */
async function saveInBrowser({ origin, owner }) {
  const page = await (await made.browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/markstage/#/sign-in?next=${encodeURIComponent(`#/e/posts/${POST}`)}`);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => u.hash.startsWith(`#/e/posts/${POST}`), { timeout: 30_000 });
  const first = page.locator('.ProseMirror > p').first();
  await first.waitFor({ timeout: 30_000 });
  log('signed in; the post is open in the editor');
  await first.click({ position: { x: 2, y: 8 } });
  await page.keyboard.press('Home');
  await page.keyboard.type(WORDS);
  await page.keyboard.press('ControlOrMeta+s');
  await page.locator('.ms-status[data-status="saved"]').waitFor({ timeout: 30_000 });
  if (errors.length) fail(`the editor threw: ${errors.join('; ')}`);
  log('typed and saved in the editor');
}

/** 6, without a browser: the same save through the API the editor uses (the post's source, a line added). */
async function saveByApi({ origin, cookie }) {
  const me = await (await fetch(`${origin}/markstage/api/auth/me`, { headers: { Cookie: cookie } })).json();
  const entry = await (await fetch(`${origin}/markstage/api/collections/posts/entries/${POST}/source`, { headers: { Cookie: cookie } })).json();
  const source = entry.source.replace(/\n\n(?=This is a small)/, `\n\n${WORDS}`);
  const res = await fetch(`${origin}/markstage/api/collections/posts/entries/${POST}/source`, {
    method: 'PUT',
    headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': me.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, version: entry.version }),
  });
  if (res.status !== 200) fail(`PUT source answered ${res.status}: ${await res.text()}`);
  log('saved through the API');
}

async function main() {
  log(`Node ${process.versions.node}, npm ${run(NPM, ['--version'], REPO).trim()}, Markstage ${VERSION}`);
  // its real path: on macOS the temporary folder is behind a link (/var -> /private/var), and Astro's dev server
  // mixes the two spellings of a path when the root is not the real one
  made.dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-npm-install-')));
  const pw = useBrowser ? await loadPlaywright() : null;
  if (useBrowser && !pw) fail('Playwright is not installed here (npm ci at the repo root), or pass --no-browser');
  if (pw) made.browser = await pw.chromium.launch();
  const site = installSite(made.dir);
  const other = astroNode(site);
  const editorDir = build(site, made.dir, other);
  if (!other) await devCheck(site, pw);
  const head = () => run('git', ['rev-parse', 'HEAD'], site).trim();
  const server = await serve(site, made.dir, editorDir);
  const before = head();
  if (pw) await saveInBrowser(server);
  else await saveByApi(server);
  const text = fs.readFileSync(path.join(site, 'src/content/posts', `${POST}.md`), 'utf8');
  if (!text.includes(WORDS.trim())) fail(`the post's file does not have the typed words:\n${text.slice(0, 400)}`);
  if (head() === before) fail('the save made no git commit');
  const changed = run('git', ['show', '--name-only', '--format=%s', 'HEAD'], site).trim().split('\n');
  if (!changed.includes(`src/content/posts/${POST}.md`)) fail(`the commit does not change the post: ${changed.join(', ')}`);
  log(`the save is a git commit: "${changed[0]}" (${head().slice(0, 12)})`);
  log(`npm install test passed on Node ${process.versions.node}${notes.length ? ` (${notes.join('; ')})` : ''}`);
}

async function cleanup() {
  await made.browser?.close().catch(() => {});
  await made.dev?.stop().catch(() => {});
  const proc = made.server;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGTERM');
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(10_000)]);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
  }
  if (!made.dir) return;
  if (keep) return log(`kept ${made.dir}`);
  fs.rmSync(made.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

try {
  await main();
} catch (e) {
  console.error(`npm install test failed: ${e.message}`);
  const logFile = made.dir && path.join(made.dir, 'server.log');
  if (logFile && fs.existsSync(logFile)) console.error(`--- server log ---\n${fs.readFileSync(logFile, 'utf8').split('\n').slice(-60).join('\n')}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
