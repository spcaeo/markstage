// The comparison pages in a real browser: the filter's states live in the address (?show=git&diff=1), a click
// changes it, the back button brings the last view back, and no page scrolls sideways at 390, 1440 or 1920 pixels.
// site/ is served to Chromium through page routes, so no server or port is used. Skipped when Playwright has no
// browser installed (npx playwright install chromium); the browser is closed at the end, pass or fail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { REPO_ROOT } from './build-site.mjs';

const SITE = path.join(REPO_ROOT, 'site');
const BASE = 'http://site.test/markstage/';
const TYPES = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain' };

let browser = null;
let why = '';
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch();
} catch (err) {
  why = `no browser for Playwright (${String(err.message).split('\n')[0]})`;
}

async function open(url, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route('http://site.test/**', (route) => {
    let p = new URL(route.request().url()).pathname.replace(/^\/markstage/, '');
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(SITE, p);
    if (!file.startsWith(SITE) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[p.split('.').pop()] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  // the star count on the GitHub button is not part of this test
  await ctx.route(/^https?:\/\/(?!site\.test)/, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto(BASE + url);
  return { page, ctx };
}

const query = (page) => new URL(page.url()).search;
const shown = (page, sel) => page.$$eval(sel, (els) => els.filter((el) => el.offsetParent !== null || el.getClientRects().length > 0).map((el) => el.getAttribute('data-p')));

describe('the comparison filter and layout in a browser', { skip: !browser && why }, () => {
  after(async () => {
    await browser?.close();
  });

  test('/compare/full/: ?show and ?diff set the view, clicks change the address, back brings it back', async () => {
    const { page, ctx } = await open('compare/full/?show=git');
    try {
      assert.equal(await page.getAttribute('.cmp-filter [data-show="git"]', 'aria-pressed'), 'true');
      // the lead three are not git-based: the lead table gives way to a note
      assert.equal(await page.isVisible('table:has(#cap-lead)'), false);
      assert.equal(await page.isVisible('.cmp-wrap:has(#cap-lead) + .cmp-empty'), true);
      const a = await shown(page, 'table:has(#cap-a) thead th[data-p]');
      assert.ok(a.includes('markstage') && a.includes('tinacms') && a.length === 10, a.join());
      // Group B has no git-based product: its table gives way to a note
      assert.equal(await page.isVisible('table:has(#cap-b)'), false);
      await page.click('.cmp-filter [data-show="hosted"]');
      assert.equal(query(page), '?show=hosted');
      const hosted = await shown(page, 'table:has(#cap-a) thead th[data-p]');
      assert.deepEqual(hosted, ['markstage', 'cloudcannon']);
      const rowsBefore = (await page.$$('table:has(#cap-a) tr[data-row]:not([hidden])')).length;
      await page.check('.cmp-filter [data-diff]');
      assert.equal(query(page), '?show=hosted&diff=1');
      const rowsAfter = (await page.$$('table:has(#cap-a) tr[data-row]:not([hidden])')).length;
      assert.ok(rowsAfter < rowsBefore, `rows ${rowsBefore} → ${rowsAfter}`);
      await page.goBack();
      assert.equal(query(page), '?show=hosted');
      assert.equal(await page.isChecked('.cmp-filter [data-diff]'), false);
      assert.equal((await page.$$('table:has(#cap-a) tr[data-row]:not([hidden])')).length, rowsBefore);
      await page.goBack();
      assert.equal(query(page), '?show=git');
      assert.equal(await page.getAttribute('.cmp-filter [data-show="git"]', 'aria-pressed'), 'true');
      await page.click('.cmp-filter [data-show="all"]');
      assert.equal(query(page), '');
      assert.equal((await shown(page, 'table:has(#cap-b) thead th[data-p]')).length, 13);
    } finally {
      await ctx.close();
    }
  });

  test('/compare/: ?show=app shows only the self-hosted apps (and Markstage), and hides the other groups', async () => {
    const { page, ctx } = await open('compare/?show=app');
    try {
      const cards = await shown(page, '[data-filter-scope] .pcard');
      assert.deepEqual(cards.sort(), ['emdash', 'payload', 'statamic', 'strapi', 'studiocms']);
      assert.equal(await page.isVisible('#kind-git'), false);
      assert.match(await page.textContent('[data-filter-scope] .cmp-filter-count'), /Showing 5 of 18 products/);
      // the lead cards stay
      assert.equal((await shown(page, '.pcards.four .pcard')).length, 4);
    } finally {
      await ctx.close();
    }
  });

  test('no page scrolls sideways at 390, 1440 and 1920 pixels', async () => {
    for (const width of [390, 1440, 1920])
      for (const url of ['compare/', 'compare/full/', 'compare/full/?show=lead', 'alternatives/ghost/', 'roadmap/']) {
        const { page, ctx } = await open(url, { width });
        try {
          const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
          assert.ok(scroll <= inner, `${url} at ${width}: ${scroll}px wide`);
        } finally {
          await ctx.close();
        }
      }
  });
});
