// Times the requests and screens of the performance review (2 Nov 2026, section 2;
// its notes are not in this repo) on a big test site (generate-big-site.mjs), with the Markstage of this checkout.
//
//   node scripts/perf/measure.mjs <site> <work> [--port 18437] [--runs 5] [--label main] [--only <regex>]
//
// --only times just the rows whose name matches (the media index always runs); the result goes to result-only.json.
// <work> is a new folder for the data dir, the built editor, backups and the result (<work>/result.json).
// It starts its own server on 127.0.0.1:<port>, signs in as a new owner and closes everything when done.
// A request slower than 10 s is timed 3 times instead of 5. "cpu" is this process's CPU (the server runs in it).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const [siteArg, workArg] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : d;
};
if (!siteArg || !workArg) {
  console.error('usage: node scripts/perf/measure.mjs <site> <work> [--port 18437] [--runs 5] [--label main]');
  process.exit(2);
}
const site = path.resolve(siteArg);
const work = path.resolve(workArg);
const PORT = Number(opt('port', 18437));
const RUNS = Number(opt('runs', 5));
const LABEL = opt('label', 'run');
const ONLY = opt('only', null) ? new RegExp(opt('only', null)) : null;
const wanted = (name) => !ONLY || ONLY.test(name);
const BASE = `http://127.0.0.1:${PORT}`;
for (const d of ['data', 'backups']) fs.mkdirSync(path.join(work, d), { recursive: true, mode: 0o700 });

const server = path.join(root, 'packages/server/src');
const { loadConfig, createMarkstage } = await import(path.join(server, 'app.mjs'));
const { client, addUser } = await import(path.join(root, 'packages/server/test/helpers.mjs'));
const { blank } = await import(path.join(root, 'packages/server/e2e/support.mjs'));

// the editor, built from the big site as the server serves it
const editorDir = path.join(work, 'editor');
const t0 = Date.now();
execFileSync(process.execPath, [path.join(root, 'packages/astro/bin/markstage.mjs'), 'build-editor', '--out', editorDir, '--root', site], { cwd: site, stdio: 'ignore' });
const editorBuild = Date.now() - t0;

const config = loadConfig({
  env: { MARKSTAGE_DATA_DIR: path.join(work, 'data'), NODE_ENV: 'test' },
  overrides: { port: PORT, contentRoot: site, editorDir, media: { dir: 'public/uploads', url: '/uploads/{path}' }, backup: { dir: path.join(work, 'backups'), keep: 2 }, commands: { build: ['npm', 'run', 'build'], timeoutSeconds: 600 }, login: { ipMaxAttempts: 10000 } },
});
let start = Date.now();
const app = await createMarkstage(config);
await app.listen(PORT, '127.0.0.1');
app.backup?.stop?.();
const startMs = Date.now() - start;
const owner = await addUser(app, { email: 'owner@example.test', name: 'Perf Owner', role: 'owner', password: `p-${crypto.randomBytes(12).toString('base64url')}` });
const c = client(BASE);
await c.login(owner.email, owner.password);

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
const rows = [];
/** Times `fn` RUNS times (3 when the first is over 10 s): p50, p95, this process's CPU per run, the answer's size. */
async function time(name, fn) {
  if (!wanted(name)) return null;
  const ms = [];
  const cpu = [];
  let size = 0;
  let status = 0;
  for (let i = 0; i < RUNS; i++) {
    const c0 = process.cpuUsage();
    const s = performance.now();
    const r = await fn();
    ms.push(performance.now() - s);
    const d = process.cpuUsage(c0);
    cpu.push((d.user + d.system) / 1000);
    status = r?.status ?? status;
    size = r?.text?.length ?? (r?.json ? JSON.stringify(r.json).length : size);
    if (i === 0 && ms[0] > 10_000 && RUNS > 3) i = RUNS - 3;
  }
  const row = { name, runs: ms.length, p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), cpu: Math.round(pct(cpu, 50)), kb: Math.round(size / 1024), status, rss: Math.round(process.memoryUsage().rss / 1048576) };
  rows.push(row);
  console.log(`${name.padEnd(48)} ${String(row.p50).padStart(7)} ms  p95 ${String(row.p95).padStart(7)}  cpu ${String(row.cpu).padStart(6)}  ${row.kb} KB  ${status}`);
  return row;
}
const get = (p) => () => c.get(p);

const list = (await c.get('/collections/posts/entries?perPage=50')).json;
const one = list.entries?.[0]?.id ?? list.items?.[0]?.id ?? list[0]?.id;
const tag = 'tag-7';
await time('auth/login + auth/me', async () => (await c.login(owner.email, owner.password), c.get('/auth/me')));
await time('collections', get('/collections'));
await time('entries perPage=50', get('/collections/posts/entries?perPage=50'));
await time('… status=draft', get('/collections/posts/entries?perPage=50&status=draft'));
await time('… author=', get('/collections/posts/entries?perPage=50&author=author-3'));
await time('… tag=', get(`/collections/posts/entries?perPage=50&tag=${tag}`));
await time('… q=warehouse', get('/collections/posts/entries?perPage=50&q=warehouse'));
await time('… sort=words', get('/collections/posts/entries?perPage=50&sort=words'));
await time('… attention=no-description', get('/collections/posts/entries?perPage=50&attention=no-description'));
await time('… attention=not-translated', get('/collections/posts/entries?perPage=50&attention=not-translated'));
await time('… attention=alt-text', get('/collections/posts/entries?perPage=50&attention=alt-text'));
await time('… attention=links', get('/collections/posts/entries?perPage=50&attention=links'));
await time('palette boot: entries?perPage=200 × 4', async () => {
  let r;
  for (let p = 1; p <= 4; p++) r = await c.get(`/collections/posts/entries?perPage=200&page=${p}`);
  return r;
});
await time('index (the light index, after round 1)', get('/index'));
await time('site/find?q=warehouse', get('/site/find?q=warehouse'));
await time('translations', get('/translations'));
await time('entry', get(`/collections/posts/entries/${one}`));
await time('entry preflight', get(`/collections/posts/entries/${one}/preflight`));
await time('entry links-in', get(`/collections/posts/entries/${one}/links-in`));
await time('entry page-checks', get(`/collections/posts/entries/${one}/page-checks`));
await time('site/health', get('/site/health'));
await time('site/export/pages (CSV)', get('/site/export/pages'));
await time('links/pages', get('/links/pages'));
await time('links/health', get('/links/health'));
await time('links/inbox', get('/links/inbox'));
await time('topics', get('/topics'));
const idx = performance.now();
const ix = await c.post('/media/index', {});
rows.push({ name: 'media/index (once)', runs: 1, p50: Math.round(performance.now() - idx), status: ix.status, added: ix.json?.added?.length ?? null, skipped: ix.json?.skipped?.length ?? null });
console.log(`media/index (once): ${rows.at(-1).p50} ms ${ix.status}, ${rows.at(-1).added} files added, ${rows.at(-1).skipped} skipped`);
await time('media?perPage=50', get('/media?perPage=50'));
await time('media?unused=1', get('/media?unused=1'));
const m = (await c.get('/media?perPage=1')).json;
const mid = m.items?.[0]?.id ?? m.media?.[0]?.id ?? m[0]?.id;
if (mid) await time('media/:id (usedBy)', get(`/media/${mid}`));
const ticked = (await c.get('/collections/posts/entries?perPage=200')).json;
const picks = (ticked.entries ?? ticked.items ?? []).slice(0, 200).map((e) => ({ collection: 'posts', id: e.id }));
await time('site/bulk/plan (add a tag, 200 ticked)', () => c.post('/site/bulk/plan', { action: 'add', field: 'tags', value: 'perf-tag', entries: picks }));

// one slow screen and another editor at the same time: how long the other one waits
if (wanted('concurrency')) {
const other = client(BASE);
await other.login(owner.email, owner.password);
const health = c.get('/site/health');
const waits = [];
for (let i = 0; i < 8; i++) {
  const s = performance.now();
  const r = await other.get('/collections/posts/entries?perPage=50');
  waits.push({ ms: Math.round(performance.now() - s), status: r.status });
  await new Promise((res) => setTimeout(res, 250));
}
await health;
rows.push({ name: 'concurrency: a list during site/health', waits });
console.log('concurrency:', waits.map((w) => `${w.ms}ms/${w.status}`).join(' '));
}

// the browser: a fresh load until the entries list shows rows, and until a long entry shows its blocks
if (wanted('browser')) {
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/markstage/#/sign-in`);
await page.getByLabel('Email').fill(owner.email);
await page.getByLabel('Password', { exact: true }).fill(owner.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL((u) => !u.hash.startsWith('#/sign-in'));
async function browserTime(name, hash, ready) {
  const ms = [];
  let requests = 0;
  let bytes = 0;
  for (let i = 0; i < RUNS; i++) {
    await blank(page);
    let n = 0;
    let b = 0;
    const onReq = () => n++;
    const onRes = async (r) => {
      try {
        if (r.url().includes('/api/')) b += (await r.body()).length;
      } catch {
        /* gone */
      }
    };
    page.on('request', onReq);
    page.on('response', onRes);
    const s = performance.now();
    await page.goto(`${BASE}/markstage/${hash}`);
    await page.locator(ready).first().waitFor({ timeout: 120_000 });
    ms.push(performance.now() - s);
    await page.waitForLoadState('networkidle').catch(() => {});
    page.off('request', onReq);
    page.off('response', onRes);
    requests = n;
    bytes = b;
  }
  const row = { name, runs: ms.length, p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), requests, apiKb: Math.round(bytes / 1024) };
  rows.push(row);
  console.log(`${name.padEnd(48)} ${String(row.p50).padStart(7)} ms  p95 ${String(row.p95).padStart(7)}  ${requests} requests, ${row.apiKb} KB from the API`);
}
await browserTime('browser: fresh load until the list shows rows', '#/entries?c=posts', 'table tbody tr');
await browserTime('browser: fresh load until a long entry shows', `#/e/posts/${one}`, '.ProseMirror > *');
await browser.close();
}

await app.close();
const result = { label: LABEL, at: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), node: process.version, startMs, editorBuildMs: editorBuild, runs: RUNS, rows };
const outFile = path.join(work, ONLY ? 'result-only.json' : 'result.json');
fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
console.log(`\n${outFile}`);
