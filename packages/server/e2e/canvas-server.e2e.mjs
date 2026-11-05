// The canvas drawn inside the entry's real page on a server (docs/CANVAS-FIDELITY.md "On a server"), in a real
// browser: the example blog (examples/blog, canvas.shell on) built by Astro into dist/, the editor built by
// `markstage build-editor`, both served by a Markstage server with a signed-in owner; the built site itself served
// on its own port as readers get it. The canvas sits inside the built page's header and frame with the page's CSS,
// and measures as that page does at 1440 and 390 (the fidelity guard,
// packages/editor/scripts/canvas-fidelity.mjs). A word typed and saved changes that one line of the file, and the
// page is drawn around the canvas again. The page's scripts never run on the CMS origin: an inline script, an
// event handler and a stylesheet or @import on another host in the built page do nothing; its first <head> script
// runs in the sandboxed frame only (no cookies there). A new draft no build has yet gets the sheet of paper and a
// quiet note. Every browser opened here is closed in `after`, and the servers are stopped.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: support.mjs CANVAS_SERVER_PORTS (the server, the built site); the stand-in "other host" takes a free port.
// Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { buildEditor } from '../../astro/src/build-editor.mjs';
import { checkFidelity, report } from '../../editor/scripts/canvas-fidelity.mjs';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { staticFileIn } from '../src/static-file.mjs';
import { addUser, fakeCodec, freePort, makeFixture } from '../test/helpers.mjs';
import { CANVAS_SERVER_PORTS, SHOTS, blank, pw, skip } from './support.mjs';

const [PORT, SITE_PORT] = CANVAS_SERVER_PORTS;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXAMPLE = path.join(REPO, 'examples/blog');
const ID = 'hello-markstage';
// the built post the hostile bits are put in (not one the guard measures: its page would load them as a reader's does)
const HOSTILE = 'keyboard-shortcuts';
const HELLO = `src/content/posts/${ID}.md`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };

describe('the canvas in its built page, on a server', { skip, timeout: 420_000 }, () => {
  let fx, app, site, other, browser, page, owner, state;
  const hits = [];
  const built = (p) => path.join(fx.site, 'dist', p);

  before(async () => {
    // the example blog as the site's repo, built by Astro into dist/ (the server's verify.public)
    fx = makeFixture({ checks: false });
    fs.rmSync(path.join(fx.site, 'src'), { recursive: true });
    fs.cpSync(path.join(EXAMPLE, 'src'), path.join(fx.site, 'src'), { recursive: true });
    fs.cpSync(path.join(EXAMPLE, 'markstage'), path.join(fx.site, 'markstage'), { recursive: true });
    for (const f of ['astro.config.mjs', 'markstage.config.mjs', 'package.json']) fs.copyFileSync(path.join(EXAMPLE, f), path.join(fx.site, f));
    // its CSS as files (/_astro/*.css), not inlined: the server hands those over by path, and that is what is tested
    const astroConfig = path.join(fx.site, 'astro.config.mjs');
    fs.writeFileSync(astroConfig, fs.readFileSync(astroConfig, 'utf8').replace("trailingSlash: 'always',", "trailingSlash: 'always', build: { inlineStylesheets: 'never' },"));
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(fx.site, 'node_modules'));
    fs.appendFileSync(path.join(fx.site, '.gitignore'), 'node_modules\n.astro/\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'The example blog');
    const b = spawnSync(process.execPath, [path.join(REPO, 'node_modules/astro/bin/astro.mjs'), 'build', '--silent'], { cwd: fx.site, encoding: 'utf8', timeout: 240_000 });
    assert.equal(b.status, 0, `astro build: ${b.stderr || b.stdout}`);

    // another host: anything the page names there must never be asked for, by the server or the editor
    const otherPort = await freePort();
    other = http.createServer((req, res) => (hits.push(req.url), res.writeHead(200, { 'Content-Type': 'text/css' }).end('body{color:red}')));
    await new Promise((r) => other.listen(otherPort, '127.0.0.1', r));
    const elsewhere = `http://127.0.0.1:${otherPort}`;
    // a built post, with what must never run or load in the editor: a script, a handler, a stylesheet and an
    // @import on another host; and a first <head> script, which runs in the sandboxed frame only
    const post = built(`posts/${HOSTILE}/index.html`);
    const hostile =
      `<script>document.documentElement.classList.add('js');try{document.cookie;document.documentElement.dataset.cookies='open'}catch(e){document.documentElement.dataset.cookies='none'}</script>` +
      `<link rel="stylesheet" href="${elsewhere}/elsewhere.css"><style>@import url(${elsewhere}/imported.css);</style>`;
    const body = `<script>window.parent.__ran = 'script'</script><img src="/nothing.png" onerror="window.parent.__ran = 'handler'" alt="">`;
    fs.writeFileSync(post, fs.readFileSync(post, 'utf8').replace('</head>', `${hostile}</head>`).replace('</main>', `${body}</main>`));

    // the built site as readers get it
    site = http.createServer((req, res) => {
      const file = staticFileIn(path.join(fx.site, 'dist'), new URL(req.url, SITE).pathname);
      if (!file) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

    const editorDir = (await buildEditor({ root: EXAMPLE, out: path.join(fx.run, 'editor'), logLevel: 'silent' })).out;
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [], compat: { collection: null }, verify: { public: 'dist' } } });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', authorSlug: 'alex-rivera' });

    browser = await pw.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(`#/e/posts/${ID}`)}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(`#/e/posts/${ID}`));
    await page.locator('.ms-sheet.is-shell .ms-canvas > .ProseMirror').waitFor({ timeout: 60_000 });
    state = await ctx.storageState();
  });

  after(async () => {
    await browser?.close();
    await app?.close();
    await new Promise((r) => (site ? site.close(r) : r()));
    await new Promise((r) => (other ? other.close(r) : r()));
  });

  test("the canvas sits inside the built page's header and frame, with the page's CSS, and none of it can be clicked", async () => {
    assert.equal(await page.locator('.ms-pg-body.frame-full').count(), 1);
    assert.equal(await page.locator('.ms-pg header.site[inert]').count(), 1);
    assert.equal(await page.locator('.ms-pg article.post > .ms-canvas > .ProseMirror.post__body').count(), 1);
    const titles = await page.locator('.ms-pg h1').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.className));
    assert.deepEqual(titles, ['ms-dochead__title ms-title']);
    // the header as the built site draws it: the same box and look as on the page itself
    const look = (p, sel) => p.locator(sel).first().evaluate((el) => { const s = getComputedStyle(el); return [Math.round(el.getBoundingClientRect().height), s.fontSize, s.fontFamily, s.borderBottomWidth, s.paddingTop]; });
    const live = await (await browser.newContext({ viewport: { width: await page.evaluate(() => document.querySelector('.ms-sheet').clientWidth), height: 900 } })).newPage();
    await live.goto(`${SITE}/posts/${ID}/`);
    assert.deepEqual(await look(page, '.ms-pg header.site'), await look(live, 'header.site'));
    await live.context().close();
    // the page came from the site's build, through the server's API (never from another origin)
    const r = await page.evaluate(async (id) => (await fetch(`/markstage/api/preview/posts/${id}/shell`)).json(), ID);
    assert.equal(r.from, 'site');
    assert.equal(r.path, `/posts/${ID}/`);
    assert.ok(r.sheets.length >= 1 && r.sheets.every((s) => s.path.startsWith('/_astro/')), JSON.stringify(r.sheets.map((s) => s.path)));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'canvas-server-1440.png') });
  });

  test("the page's scripts never run on the CMS origin; its first head script runs sandboxed; nothing on another host is asked for", async () => {
    await blank(page);
    await page.goto(`${BASE}/markstage/#/e/posts/${HOSTILE}`);
    await page.locator('.ms-sheet.is-shell .ms-canvas > .ProseMirror').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__ran ?? null), null, 'no script and no handler of the page ran in the editor');
    assert.equal(await page.locator('.ms-pg script, .ms-pg [onerror], .ms-pg link, .ms-pg style').count(), 0);
    // the head script ran in the shell frame: its `js` class is on the stand-in, and it had no cookies there
    assert.equal(await page.locator('.ms-pg').evaluate((el) => [el.classList.contains('js'), el.dataset.cookies]).then(String), 'true,none');
    assert.equal(await page.locator('iframe[sandbox]').count(), 0, 'the frame is gone once it answered');
    assert.deepEqual(hits, [], 'nothing was fetched from another host');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'canvas-server-hostile.png') });
  });

  test('the canvas measures as the built page does, at 1440 and 390, light and dark, every run of text readable (the fidelity guard, as canvas-shell.e2e.mjs runs it in astro dev)', async () => {
    const results = await checkFidelity({ playwright: pw, base: BASE, pageBase: SITE, storageState: state, entries: [{ entry: `posts/${ID}`, page: `/posts/${ID}/` }], widths: [1440, 390], themes: ['light', 'dark'], bodyClass: 'post__body', parts: [['aside', '.aside']], loose: ['pre.astro-code'], shots: SHOTS ?? undefined });
    assert.ok(
      results.every((r) => r.ok),
      report(results),
    );
    // the example blog's dark colours are reached by an attribute nothing on its page sets: readers in a dark system get it
    // light, so the canvas stays light in a dark editor, every run of text at least 4.5:1 (canvas-contrast.mjs)
    for (const r of results) assert.ok(r.contrast.count >= 20 && !r.contrast.failures.length, `${r.width} ${r.theme}: ${r.contrast.failures.join('; ')}`);
    assert.deepEqual(hits, []);
  });

  test('a word typed and saved changes that one line of the file; the page is drawn around the canvas again', async () => {
    await blank(page);
    await page.goto(`${BASE}/markstage/#/e/posts/${ID}`);
    await page.locator('.ms-sheet.is-shell .ms-canvas > .ProseMirror').waitFor({ timeout: 60_000 });
    const before = fx.git('rev-parse', 'HEAD').trim();
    const first = page.locator('.ms-canvas > .ProseMirror > p').first();
    await first.click({ position: { x: 4, y: 8 } });
    await page.keyboard.press('Home');
    await page.keyboard.type('Typed on a server. ');
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    const diff = fx.git('diff', '--unified=0', before, 'HEAD', '--', HELLO);
    const lines = diff.split('\n').filter((l) => /^[-+](?![-+])/.test(l));
    assert.equal(lines.length, 2, diff);
    assert.equal(lines[1], lines[0].replace(/^-/, '+Typed on a server. '));
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.ms-sheet.is-shell .ms-pg header.site').count(), 1);
    assert.match(await first.innerText(), /^Typed on a server\. /);
  });

  test('a draft no build has yet: the sheet of paper, and a quiet note that says why', async () => {
    await blank(page);
    await page.goto(`${BASE}/markstage/#/e/posts/a-draft`);
    await page.locator('.ms-canvas > .ProseMirror').waitFor();
    const note = page.locator('.ms-pg-bar[data-shell-note] .ms-pg-bar__note');
    await note.waitFor();
    assert.equal(await note.innerText(), 'The page around the text shows here after the site’s next build.');
    assert.equal(await page.locator('.ms-sheet.is-shell').count(), 0);
    assert.equal(await page.locator('.ms-pg-bar [data-readers]').isVisible(), false);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'canvas-server-not-built.png') });
    // back to a built entry: the page again, the note gone
    await blank(page);
    await page.goto(`${BASE}/markstage/#/e/posts/${ID}`);
    await page.locator('.ms-sheet.is-shell .ms-canvas > .ProseMirror').waitFor({ timeout: 60_000 });
    assert.equal(await page.locator('.ms-pg-bar[data-shell-note]').count(), 0);
  });
});
