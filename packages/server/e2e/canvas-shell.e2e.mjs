// The canvas drawn inside the entry's own page (docs/CANVAS-FIDELITY.md), in a real browser against the example
// blog's real `astro dev` (examples/blog, canvas.shell on): the page's header and frame around the canvas, nothing of
// them clickable, one title (the editor's, in place of the page's), the body at the page's width and size at 1440
// and at 390 (the fidelity guard, packages/editor/scripts/canvas-fidelity.mjs), the frame following the canvas when
// a panel narrows it, "What readers see" in the URL, and a block pack's live part of the page (the example blog's
// list of contents, EditorPack.shell) following the headings as they are typed, with its Post settings switch.
// Nothing is saved. Every browser opened here is closed in
// `after`, and the dev server is stopped.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Port: MARKSTAGE_E2E_PORT_BASE (default 18231) + 99, the example blog's dev server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { checkFidelity, report } from '../../editor/scripts/canvas-fidelity.mjs';
import { CANVAS_SHELL_PORT, SHOTS, pw, skip, blank } from './support.mjs';

const BASE = `http://127.0.0.1:${CANVAS_SHELL_PORT}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const blog = path.join(root, 'examples/blog');
const ID = 'hello-markstage';

async function up(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not answer within ${ms / 1000} s`);
}

describe('the canvas in its page (canvas.shell)', { skip, timeout: 240_000 }, () => {
  let dev, browser, page, pagePath;

  before(async () => {
    dev = spawn(process.execPath, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', '127.0.0.1', '--port', String(CANVAS_SHELL_PORT), '--ignore-lock'], { cwd: blog, stdio: 'ignore' });
    await up(`${BASE}/`, 60_000);
    pagePath = (await (await fetch(`${BASE}/markstage/api/collections/posts/entries/${ID}`)).json()).url;
    browser = await pw.chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(`${BASE}/markstage/#/e/posts/${ID}`);
    await page.locator('.ms-sheet.is-shell .ms-canvas > .ProseMirror').waitFor({ timeout: 60_000 });
  });

  after(async () => {
    await browser?.close();
    dev?.kill();
  });

  test("the page's own frame is around the canvas, and none of it can be clicked", async () => {
    // the page's <body class="frame-full"> (a guide) on its stand-in, the header the layout draws, inert
    assert.equal(await page.locator('.ms-pg-body.frame-full').count(), 1);
    assert.equal(await page.locator('.ms-pg header.site[inert]').count(), 1);
    // one title on the canvas: the editor's (it can be typed in), the page's own hidden
    const titles = await page.locator('.ms-pg h1').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.className));
    assert.deepEqual(titles, ['ms-dochead__title ms-title']);
    // the text column is the page's: the body element's place in the article, not the editor's sheet of paper
    assert.equal(await page.locator('.ms-pg article.post > .ms-canvas > .ProseMirror.post__body').count(), 1);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'canvas-shell-1440.png') });
  });

  test('the canvas measures as the page does, at 1440 and at 390 (the fidelity guard)', async () => {
    const results = await checkFidelity({ playwright: pw, base: BASE, entries: [{ entry: `posts/${ID}`, page: pagePath }], widths: [1440, 390], bodyClass: 'post__body', parts: [['aside', '.aside']], loose: ['pre.astro-code'], shots: SHOTS ?? undefined });
    assert.ok(
      results.every((r) => r.ok),
      report(results),
    );
  });

  test('a panel that narrows the canvas narrows the page: its breakpoints follow the canvas, not the window', async () => {
    const width = () => page.evaluate(() => [document.querySelector('.ms-sheet').clientWidth, getComputedStyle(document.querySelector('.ms-pg')).getPropertyValue('--ms-vw')]);
    const [wide, vw] = await width();
    assert.equal(vw.trim(), `${wide / 100}px`);
    await page.locator('[data-sections]').click();
    await page.waitForFunction((w) => document.querySelector('.ms-sheet').clientWidth < w - 100, wide);
    const [narrow, vw2] = await width();
    assert.equal(vw2.trim(), `${narrow / 100}px`);
    await page.locator('[data-sections]').click();
  });

  test('"What readers see" shows the page\'s own text, in the URL (readers=1), and goes back', async () => {
    await page.locator('[data-readers]').click();
    await page.waitForURL(/readers=1/);
    assert.equal(await page.locator('.ms-sheet.is-readers .ms-pg-readers').isVisible(), true);
    assert.equal(await page.locator('.ms-canvas > .ProseMirror').isVisible(), false);
    assert.equal(await page.locator('[data-readers]').getAttribute('aria-pressed'), 'true');
    // opened from its URL, it is on
    await blank(page);
    await page.goto(`${BASE}/markstage/#/e/posts/${ID}?readers=1`);
    await page.locator('.ms-sheet.is-readers .ms-pg-readers').waitFor();
    await page.locator('[data-readers]').click();
    await page.waitForURL((u) => !u.hash.includes('readers'));
    assert.equal(await page.locator('.ms-canvas > .ProseMirror').isVisible(), true);
    assert.equal(await page.locator('.ms-pg-readers').isVisible(), false);
  });

  test("a pack keeps a part of the page live: the list of contents follows the headings, scrolls to one, and a switch takes it away", async () => {
    // a reading post: the page lists its h2s above the text (examples/blog/markstage/contents.ts)
    await blank(page);
    await page.goto(`${BASE}/markstage/#/e/posts/writing-with-source-mode`);
    await page.locator('.ms-sheet.is-shell .ms-canvas > .ProseMirror').waitFor({ timeout: 60_000 });
    const items = () => page.locator('.ms-pg nav.post__contents a').allTextContents();
    const h2s = await page.locator('.ms-canvas > .ProseMirror > h2').allTextContents();
    await page.waitForFunction((n) => document.querySelectorAll('.ms-pg nav.post__contents a').length === n, h2s.length);
    assert.deepEqual(await items(), h2s);
    // clickable, unlike the rest of the page
    assert.equal(await page.locator('.ms-pg nav.post__contents').evaluate((el) => el.closest('[inert]') === null), true);
    assert.equal(await page.locator('.ms-pg header.site').evaluate((el) => el.closest('[inert]') !== null), true);
    // a new h2 at the end of the text is listed, renamed as it is typed
    await page.locator('.ms-canvas > .ProseMirror > p').last().click();
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## Added heading');
    await page.waitForFunction(() => [...document.querySelectorAll('.ms-pg nav.post__contents a')].some((a) => a.textContent === 'Added heading'));
    await page.keyboard.type(' two');
    await page.waitForFunction(() => [...document.querySelectorAll('.ms-pg nav.post__contents a')].at(-1)?.textContent === 'Added heading two');
    assert.deepEqual(await items(), [...h2s, 'Added heading two']);
    // a click scrolls the canvas to that heading, and the editor stays on the entry
    const before = page.url();
    await page.locator('.ms-pg nav.post__contents a').first().click();
    // the scroll is smooth: wait for it to arrive (a fixed 300 ms was too short on CI, which stopped at 170px)
    const headingTop = () => document.querySelector('.ms-canvas > .ProseMirror > h2').getBoundingClientRect().top - document.querySelector('.ms-scroll').getBoundingClientRect().top;
    await page
      .waitForFunction(() => {
        const t = document.querySelector('.ms-canvas > .ProseMirror > h2').getBoundingClientRect().top - document.querySelector('.ms-scroll').getBoundingClientRect().top;
        return t >= -1 && t < 120;
      }, null, { timeout: 5000 })
      .catch(() => {}); // the assert below names the position if it never arrives
    const top = await page.evaluate(headingTop);
    assert.ok(top >= -1 && top < 120, `the heading is at the top of the canvas (${top}px)`);
    assert.equal(new URL(page.url()).hash.split('?')[0], new URL(before).hash.split('?')[0]);
    // Post settings: "Show contents" off takes the list away, on brings it back (not saved)
    await page.locator('[data-settings]').click();
    const box = page.getByLabel('Show contents', { exact: true });
    assert.equal(await box.isChecked(), true);
    await box.uncheck();
    await page.waitForFunction(() => !document.querySelector('.ms-pg nav.post__contents'));
    await box.check();
    await page.waitForFunction(() => document.querySelectorAll('.ms-pg nav.post__contents a').length > 0);
    assert.deepEqual(await items(), [...h2s, 'Added heading two']);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'canvas-shell-contents.png') });
  });
});
