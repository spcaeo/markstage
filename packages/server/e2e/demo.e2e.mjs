// The live demo (docs/DEMO.md), as a visitor gets it: the folder `npm run demo:build` writes, served as static files
// (as GitHub Pages serves them) under a base path that is not /markstage/, in a real browser. The editor opens a
// blog post on its page, typing changes the canvas, Save shows the diff of exactly that change, a refresh keeps it,
// Reset demo brings the post back, a change the demo does not make says so with the install link, the strip never
// covers the editor's top bar (1280 and 1920 wide), and nothing is written to the console as an error. Every
// browser opened here is closed in `after`, and the static server is stopped.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Port: MARKSTAGE_E2E_PORT_BASE (default 18231) + 15, the static server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { buildDemo } from '../../../scripts/demo/build-demo.mjs';
import { serveStatic } from '../../../scripts/demo/lib.mjs';
import { DEMO_PORT, blank, pw, skip } from './support.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE_PATH = '/try-markstage/';
const EDITOR = `http://127.0.0.1:${DEMO_PORT}${BASE_PATH}editor/`;
const INSTALL = 'https://example.com/markstage/#install';
const ID = 'hello-markstage';
const HEADING = 'Text and lists';

describe('the live demo, built and served as static files', { skip, timeout: 300_000 }, () => {
  let out, server, browser, page;
  const errors = [];

  const canvas = () => page.locator('.ms-canvas > .ProseMirror');
  const heading = () => canvas().locator('h2', { hasText: HEADING }).first();
  const open = async (hash = `#/e/posts/${ID}`) => {
    await blank(page);
    await page.goto(`${EDITOR}${hash}`);
    if (hash.startsWith('#/e/')) await canvas().first().waitFor({ timeout: 60_000 });
  };

  before(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-demo-e2e-'));
    await buildDemo({ out, base: BASE_PATH, install: INSTALL });
    server = await serveStatic(out, BASE_PATH, DEMO_PORT);
    browser = await pw.chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  });

  after(async () => {
    await browser?.close();
    await new Promise((r) => (server ? server.close(r) : r()));
    if (out) fs.rmSync(out, { recursive: true, force: true });
  });

  test('the build is static files only, with no address under /markstage/', () => {
    for (const part of ['editor/index.html', 'blog/index.html', `blog/posts/${ID}/index.html`, 'data/api.json', 'index.html']) assert.ok(fs.existsSync(path.join(out, part)), part);
    const html = fs.readFileSync(path.join(out, 'editor/index.html'), 'utf8');
    assert.match(html, /noindex/);
    assert.doesNotMatch(html, /"\/markstage\//);
    assert.doesNotMatch(fs.readFileSync(path.join(out, `blog/posts/${ID}/index.html`), 'utf8'), /(href|src)="\/(?!try-markstage\/)[^/]/);
    assert.ok(fs.existsSync(path.join(root, 'scripts/demo/recorded/api.json')));
  });

  test('the editor opens a blog post on its own page, with the demo strip above the top bar', async () => {
    await open();
    // the canvas is drawn inside the post's own page (the blog's build), not on a blank sheet
    await page.locator('.ms-sheet.is-shell .ms-canvas > .ProseMirror').waitFor({ timeout: 20_000 });
    await heading().waitFor();
    const bar = page.locator('.ms-demo-bar');
    assert.match(await bar.innerText(), /Live demo:\s*sample blog, nothing is saved, edits stay in your browser/);
    assert.equal(await bar.locator('a[data-demo="install"]').getAttribute('href'), INSTALL);
    for (const width of [1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const b = await bar.boundingBox();
      const head = await page.locator('.ms-head').first().boundingBox();
      const nav = await page.locator('.ms-nav').first().boundingBox();
      assert.ok(b && head && b.y + b.height <= head.y + 0.5, `at ${width}: the strip ends (${b?.y + b?.height}) above the top bar (${head?.y})`);
      // (the top bar's 1px bottom line sits on the drawer's first pixel, as without the strip)
      if (nav) assert.ok(nav.y >= head.y + head.height - 1.5, `at ${width}: the drawer (${JSON.stringify(nav)}) starts under the top bar (${JSON.stringify(head)})`);
      const covered = await page.evaluate(() => {
        const h = document.querySelector('.ms-head').getBoundingClientRect();
        const hit = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2);
        return !document.querySelector('.ms-head').contains(hit);
      });
      assert.equal(covered, false, `at ${width}: the top bar is not covered`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('typing changes the canvas, and Save shows the git diff of exactly that change', async () => {
    await heading().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' (edited)');
    assert.equal((await canvas().locator('h2').filter({ hasText: `${HEADING} (edited)` }).count()), 1);
    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.locator('dialog.ms-demo-dialog[open]');
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.locator('h2').innerText(), /Saved in this browser/);
    const diff = await dialog.locator('.ms-demo-diff').innerText();
    assert.match(diff, new RegExp(`^diff --git a/src/content/posts/${ID}\\.md b/src/content/posts/${ID}\\.md$`, 'm'));
    const changed = diff.split('\n').filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+) /.test(l));
    assert.deepEqual(changed, [`-## ${HEADING}`, `+## ${HEADING} (edited)`]);
    assert.equal(new URL(page.url()).searchParams.get('changes'), 'last', 'the open diff is in the address');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.waitForURL((u) => !u.searchParams.has('changes'), { timeout: 5000 });
    assert.match(await page.locator('.ms-demo-bar [data-demo="changes"]').textContent(), /^Your changes \(1\)$/);
  });

  test('a refresh keeps the save; Your changes lists it; Reset demo brings the post back', async () => {
    await open();
    await canvas().locator('h2').filter({ hasText: `${HEADING} (edited)` }).first().waitFor({ timeout: 10_000 });
    await page.locator('.ms-demo-bar [data-demo="changes"]').click();
    const all = page.locator('dialog.ms-demo-dialog[open]');
    assert.match(await all.locator('.ms-demo-diff').innerText(), /^\+## Text and lists \(edited\)$/m);
    await all.getByRole('button', { name: 'Close' }).click();
    await page.locator('.ms-demo-bar [data-demo="reset"]').click();
    await Promise.all([page.waitForEvent('load'), page.locator('dialog.ms-demo-dialog[open]').getByRole('button', { name: 'Reset demo' }).click()]);
    await canvas().first().waitFor({ timeout: 60_000 });
    await heading().waitFor();
    assert.equal(await canvas().locator('h2').filter({ hasText: '(edited)' }).count(), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('markstage.demo')), null);
  });

  test('a change the demo does not make (Publish) says so, with the install link, and no endless wait', async () => {
    await open(`#/publish/posts/${ID}`);
    await page.getByRole('button', { name: 'Publish again' }).click();
    const dialog = page.locator('dialog.ms-demo-dialog[open]');
    await dialog.waitFor({ timeout: 10_000 });
    assert.match(await dialog.innerText(), /Not in the demo[\s\S]*Install Markstage to try this/);
    assert.equal(await dialog.getByRole('link', { name: 'How to install' }).getAttribute('href'), INSTALL);
    await dialog.getByRole('button', { name: 'OK' }).click();
    assert.equal(await page.locator('dialog.ms-demo-dialog[open]').count(), 0);
  });

  // found while filming the demo: with the drawer folded to its rail the top bar is 192px wider than with it open
  // at the same window, and at 1280-1440 with unsaved changes it pushed Publish, Save and the account button off
  // the bar (top-bar.css, the rail's steps). The editor is the same as on a server, so this guards both.
  test('the top bar fits with the drawer folded and unsaved changes, at 1280, 1366 and 1440: Save and the account button on screen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      try {
        if (window === window.top) localStorage.setItem('markstage.drawer', JSON.stringify({ folded: true }));
      } catch {
        // about:blank has no storage
      }
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`page (rail): ${e.message}`));
    try {
      await p.goto(`${EDITOR}#/e/posts/${ID}`);
      const h = p.locator('.ms-canvas > .ProseMirror h2', { hasText: HEADING }).first();
      await h.waitFor({ timeout: 60_000 });
      assert.equal(await p.locator('.ms-app.nav-folded').count(), 1, 'the drawer is folded');
      await h.click();
      await p.keyboard.type('x');
      await p.locator('.ms-head .ms-status[data-status="dirty"]').waitFor({ timeout: 5000 });
      for (const width of [1280, 1366, 1440]) {
        await p.setViewportSize({ width, height: 800 });
        await p.waitForTimeout(150);
        const r = await p.evaluate(() => {
          const head = document.querySelector('.ms-head');
          const right = (sel) => Math.round(document.querySelector(sel)?.getBoundingClientRect().right ?? 0);
          return { sw: head.scrollWidth, cw: head.clientWidth, save: right('.ms-head [data-save]'), me: right('.ms-head__me'), w: innerWidth };
        });
        assert.ok(r.sw <= r.cw, `at ${width}: the top bar is ${r.sw - r.cw}px wider than the window`);
        assert.ok(r.save > 0 && r.save <= r.w, `at ${width}: Save is on screen (${r.save} of ${r.w})`);
        assert.ok(r.me > 0 && r.me <= r.w, `at ${width}: the account button is on screen (${r.me} of ${r.w})`);
      }
    } finally {
      await ctx.close();
    }
  });

  test('on a 390px phone the strip and the top bar fit: the three strip buttons, Publish and Save on screen; the strip wears the site’s brand', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`page (390): ${e.message}`));
    try {
      await p.goto(`${EDITOR}#/e/posts/${ID}`);
      await p.locator('.ms-canvas > .ProseMirror h2').first().waitFor({ timeout: 60_000 });
      await p.waitForTimeout(300);
      const r = await p.evaluate(() => {
        const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
        const bar = document.querySelector('.ms-demo-bar');
        const off = [...document.querySelectorAll('.ms-demo-bar .ms-demo-btn, .ms-head [data-save], .ms-head [data-publish]')]
          .filter((b) => b.getBoundingClientRect().width > 0)
          .filter((b) => b.getBoundingClientRect().left < 0 || b.getBoundingClientRect().right > innerWidth + 0.5)
          .map((b) => `${b.textContent.trim()} ${Math.round(b.getBoundingClientRect().right)}`);
        return { off, page: document.documentElement.scrollWidth, bar: [bar.scrollWidth, bar.clientWidth], save: Math.round(box('.ms-head [data-save]')?.right ?? 0), strip: Math.round(box('.ms-demo-bar').bottom), head: Math.round(box('.ms-head').top), install: getComputedStyle(document.querySelector('.ms-demo-bar [data-demo="install"]')).backgroundColor };
      });
      assert.deepEqual(r.off, [], 'every strip button, Publish and Save inside the window');
      assert.ok(r.save > 0, 'Save is drawn');
      assert.equal(r.page, 390, 'no sideways page scroll');
      assert.ok(r.bar[0] <= r.bar[1], `the strip's content fits it (${r.bar[0]} of ${r.bar[1]})`);
      assert.ok(r.strip <= r.head, 'the strip ends above the top bar');
      // the strip's primary button is the site's --brand (site/styles.css), through the demo's tokens
      const hex = /:root\s*\{[^}]*--brand:\s*#([0-9a-f]{6})/i.exec(fs.readFileSync(path.join(root, 'site/styles.css'), 'utf8'))?.[1];
      if (hex) assert.equal(r.install, `rgb(${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`);
    } finally {
      await ctx.close();
    }
  });

  test('nothing was written to the console as an error', () => {
    assert.deepEqual(errors, []);
  });
});
