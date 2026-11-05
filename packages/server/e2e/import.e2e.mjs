// Import a site (#/import, editor src/admin/import/) in a real browser, against a real server on 127.0.0.1 whose site
// is a copy of examples/blog: a WordPress export (the WXR fixture) uploaded, the dry run's plan in plain words with
// nothing written, its tabs in the URL (Back and Forward), the run as a job with its steps, then the report and the
// review list, with the posts, authors, images and moved addresses written in the copy. The old site's files are on
// a small local server reached through the test seam only.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: MARKSTAGE_E2E_PORT_BASE +18 (Markstage) and +20 (the old site). Screenshots go to MARKSTAGE_E2E_SHOTS.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { fixture, oldFiles } from '../test/site-import.mjs';
import { buildEditor } from './build-editor.mjs';
import { IMPORT_PORTS, SHOTS, blank, pw, skip } from './support.mjs';

const [PORT, OLD_PORT] = IMPORT_PORTS;
const BASE = `http://127.0.0.1:${PORT}`;
const OLD = `http://127.0.0.1:${OLD_PORT}`;
const BLOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/blog');

/** examples/blog without its build output, its config's one import made local (the server needs no packages). */
function copyBlog(to) {
  fs.rmSync(path.join(to, 'src'), { recursive: true, force: true });
  fs.cpSync(BLOG, to, { recursive: true, filter: (src) => !/[/\\](node_modules|dist|\.astro)([/\\]|$)/.test(src) });
  const cfg = path.join(to, 'markstage.config.mjs');
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace("import { defineConfig } from '@markstage/astro';", 'const defineConfig = (c) => c;'));
}

describe('importing a site in a browser', { skip, timeout: 240_000 }, () => {
  let fx, app, old, browser, ctx, page, owner, wxrFile;
  const hits = [];
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const shot = async (name) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `import-${name}.png`), fullPage: true });
  };

  before(async () => {
    // the old site: its uploads, nothing else
    const files = oldFiles();
    old = http.createServer((req, res) => {
      hits.push(req.url);
      const f = files[req.url.split('?')[0]];
      res.writeHead(f ? 200 : 404, { 'Content-Type': f?.type ?? 'text/plain' });
      res.end(f?.body ?? 'not here');
    });
    await new Promise((ok) => old.listen(OLD_PORT, '127.0.0.1', ok));

    fx = makeFixture({ checks: false });
    copyBlog(fx.site);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'The example blog');
    wxrFile = path.join(fx.run, 'example.WordPress.2024-05-10.xml');
    fs.writeFileSync(wxrFile, fixture('wordpress.xml', OLD));

    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Example blog',
      siteUrl: 'https://example.com',
      collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/posts', hasUrl: true, titleKey: 'title' }],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    const outbound = { allow: (ip, port) => ip === '127.0.0.1' && port === OLD_PORT };
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore(), outbound });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: `t-${crypto.randomBytes(12).toString('base64url')}` });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/import')}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/import'));
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
    await new Promise((ok) => (old ? old.close(ok) : ok()));
  });

  test('choose WordPress, upload the export: the plan in plain words, nothing written or fetched', async () => {
    const headBefore = fx.git('rev-parse', 'HEAD').trim();
    await blank(page);
    await page.goto(`${BASE}/markstage/#/import`);
    await page.locator('.ms-imp-source', { hasText: 'WordPress' }).click();
    await page.waitForURL(/#\/import\?source=wordpress$/);
    await page.getByLabel('Export file').setInputFiles(wxrFile);
    await page.getByRole('button', { name: 'Read it and make the plan' }).click();
    await page.waitForURL(/#\/import\/im_[\w-]+$/);
    const sentence = page.locator('.ms-imp-sentence');
    await sentence.waitFor();
    // the fixture's three posts go to the blog's posts; its one page has no collection here
    assert.equal(await sentence.textContent(), '3 posts, 1 page, 2 images, 1 file; 2 images need alt text; 3 blocks we could not convert');
    const lines = await page.locator('.ms-imp-lines li').allTextContents();
    assert.ok(lines.includes('3 entries to create, 0 to update, 0 unchanged, 0 left out.'), lines.join('\n'));
    assert.ok(lines.some((l) => /1 page left out: no collection is chosen for it\./.test(l)), lines.join('\n'));
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), headBefore);
    assert.equal(hits.length, 0, 'the plan fetched nothing from the old site');
    await shot('plan');

    // the tabs are in the URL; Back and Forward walk them
    await page.getByRole('button', { name: /^To review \(\d+\)$/ }).click();
    await page.waitForURL(/show=review/);
    await page.locator('.ms-imp-review li').first().waitFor();
    assert.ok((await page.locator('.ms-imp-review').textContent()).includes('could not be converted'));
    await page.getByRole('button', { name: /^Pages and posts \(3\)$/ }).click();
    await page.waitForURL(/show=entries/);
    await page.goBack();
    await page.waitForURL(/show=review/);
    await page.goForward();
    await page.waitForURL(/show=entries/);
    assert.equal(await page.locator('.ms-adm-table tbody tr').count(), 3);
  });

  test('run it: the steps, then the report; the posts, authors, images and moved addresses are in the site', async () => {
    const rid = hash().split('/')[2].split('?')[0];
    await page.getByRole('button', { name: 'Run the import' }).click();
    await page.locator('.ms-adm-h3', { hasText: 'The import is done' }).waitFor({ timeout: 60_000 });
    assert.equal(hash(), `#/import/${rid}`);
    const lines = await page.locator('.ms-imp-lines li').allTextContents();
    assert.equal(lines[0], '3 entries created, 0 updated, 0 unchanged, 0 left out.');
    assert.equal(lines[1], '3 images and files brought in.');
    // the heading in sentence case, never shouted in capitals
    const heading = page.locator('.ms-adm-h3', { hasText: 'The import is done' });
    assert.equal(await heading.evaluate((h) => getComputedStyle(h).textTransform), 'none');
    // no "it is running" note once it is done: the page said so while it ran; the toast says it is done
    await page.locator('.ms-toasts', { hasText: 'The import is done.' }).waitFor();
    assert.equal(await page.locator('.ms-toasts', { hasText: /running/i }).count(), 0);
    // the release line once, beside the drawer's
    assert.equal(await page.locator('.ms-release:visible').count(), 1);
    await shot('report');

    const post = read('src/content/posts/moving-day.md');
    assert.match(post, /^draft: true$/m);
    assert.match(post, /^author: alice$/m);
    assert.match(post, /^ {2}src: \/uploads\//m);
    assert.match(post, /^description: How we moved in one day\.$/m, 'the blog’s excerpt key');
    assert.match(read('src/content/authors/alice.json'), /Alice Example/);
    assert.ok(fs.readdirSync(path.join(fx.site, app.config.media.dir), { recursive: true }).some((f) => /truck/.test(String(f))));
    assert.ok(hits.some((h) => h.endsWith('/truck.jpg')));

    // the review list links to where to look; a picture without alt text opens in the library
    await page.getByRole('button', { name: /^See the review list/ }).click();
    await page.waitForURL(/show=review/);
    const pic = page.locator('.ms-imp-review a', { hasText: 'Open the picture' }).first();
    await pic.waitFor();
    assert.match(await pic.getAttribute('href'), /^#\/media\?item=/);
    const entry = page.locator('.ms-imp-review a[href^="#/e/posts/"]').first();
    assert.match(await entry.getAttribute('href'), /^#\/e\/posts\/(moving-day|second-post)$/);
    // a reload keeps the state
    await page.reload();
    await page.locator('.ms-imp-review li').first().waitFor();
    assert.match(hash(), /show=review/);
  });

  test('every admin screen shows the release line once: drawer open, drawer folded, on a phone', async () => {
    const screens = ['#/import', '#/media', '#/jobs', '#/users', '#/redirects', '#/authors', '#/health', '#/audit', '#/trash'];
    // shown and on the screen (the phone's drawer is slid off to the left)
    const visible = () =>
      page.evaluate(() => [...document.querySelectorAll('.ms-release')].filter((f) => {
        const r = f.getBoundingClientRect();
        return f.checkVisibility() && r.width > 0 && r.right > 0 && r.left < innerWidth;
      }).length);
    for (const [width, folded] of [[1440, false], [1440, true], [600, false], [600, true]]) {
      await page.setViewportSize({ width, height: 900 });
      for (const s of screens) {
        await page.goto(`${BASE}/markstage/${s}`);
        await page.locator('.ms-adm-title').waitFor();
        await page.evaluate((f) => document.querySelector('.ms-app')?.classList.toggle('nav-folded', f), folded);
        await page.waitForTimeout(300); // the drawer and the page's padding slide for 200 ms
        assert.equal(await visible(), 1, `${s} at ${width}${folded ? ', drawer folded' : ''}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
