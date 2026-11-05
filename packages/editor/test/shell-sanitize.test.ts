// The page drawn around the canvas is cleaned by canvas-shell/dom.ts `sanitize` (controls kept, as page.ts calls it).
// A javascript: address spelled the way a browser still reads it, and an SVG animation that writes one after the page
// is drawn, must not survive it (security review of server-canvas, 5 Nov 2026: four payloads that did). Run in a real
// browser (headless Chromium) with no CSP, as `astro dev` serves the editor: each payload is parsed as page.ts parses
// the page (DOMParser), cleaned, put in the document and clicked; nothing may run and nothing may navigate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';

const src = fs.readFileSync(path.join(import.meta.dirname, '../src/canvas-shell/dom.ts'), 'utf8');
const js = stripTypeScriptTypes(src).replace(/^export /gm, '');

const PAYLOADS = {
  tab: '<a id="x" href="java&#9;script:window.__ran=1">x</a>',
  control: '<a id="x" href="&#1;javascript:window.__ran=1">x</a>',
  formaction: '<form action="/nowhere"><button id="x" formaction="java&#10;script:window.__ran=1">b</button></form>',
  svgSet: '<svg width="80" height="40"><a id="x"><set attributeName="href" to="javascript:window.__ran=1"/><text y="20">x</text></a></svg>',
  svgAnimate: '<svg width="80" height="40"><a id="x"><animate attributeName="href" values="javascript:window.__ran=1"/><text y="20">x</text></a></svg>',
  xlink: '<svg width="80" height="40"><a id="x" xlink:href="javascript:window.__ran=1"><text y="20">x</text></a></svg>',
  area: '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" usemap="#m" width="40" height="40"><map name="m"><area id="x" shape="rect" coords="0,0,40,40" href=" jAvAsCrIpT:window.__ran=1"></map>',
};

test('javascript: however spelled, and SVG set/animate, do not survive; clicking what is left runs nothing', async () => {
  const browser = await chromium.launch();
  try {
    for (const [name, html] of Object.entries(PAYLOADS)) {
      const page = await browser.newPage();
      await page.setContent('<!doctype html><title>t</title><div id="host"></div>');
      await page.addScriptTag({ content: `${js}\nwindow.__draw = (h) => { const doc = new DOMParser().parseFromString('<!doctype html><body>' + h, 'text/html'); sanitize(doc.body); document.getElementById('host').append(...doc.body.childNodes); return document.getElementById('host').innerHTML; };` });
      const drawn = await page.evaluate((h) => (window as unknown as { __draw: (h: string) => string }).__draw(h), html);
      assert.doesNotMatch(drawn, /script:/i, `${name}: ${drawn}`);
      assert.doesNotMatch(drawn, /<(set|animate)/i, `${name}: ${drawn}`);
      const before = page.url();
      await page.locator('#x').click({ timeout: 2000, force: true }).catch(() => undefined);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => (window as unknown as { __ran?: number }).__ran ?? 0), 0, `${name} ran`);
      // (a form still submits to its own action: the shell holds every submit, page.ts; sanitize's part is the address)
      if (name !== 'formaction') assert.equal(page.url(), before, `${name} navigated`);
      else assert.equal(await page.locator('#x').getAttribute('formaction').catch(() => null), null);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('what the page may keep: relative and fragment addresses, http(s), mailto, tel, an image’s data:image', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>t</title><div id="host"></div>');
    await page.addScriptTag({ content: js });
    const kept = await page.evaluate(() => {
      const w = window as unknown as { safeUrl: (n: string, v: string) => boolean };
      return {
        relative: w.safeUrl('href', 'posts/hello/'),
        rooted: w.safeUrl('href', '/posts/hello/'),
        fragment: w.safeUrl('href', '#top'),
        https: w.safeUrl('href', 'HTTPS://example.com/'),
        mailto: w.safeUrl('href', 'mailto:hi@example.com'),
        tel: w.safeUrl('href', 'tel:+15551234'),
        image: w.safeUrl('src', 'data:image/png;base64,AAAA'),
        colonInPath: w.safeUrl('href', '/a:b'),
        js: w.safeUrl('href', 'javascript:x'),
        vb: w.safeUrl('href', 'vbscript:x'),
        dataPage: w.safeUrl('href', 'data:text/html,<b>x</b>'),
        dataImageLink: w.safeUrl('href', 'data:image/png;base64,AAAA'),
        dataSrcHtml: w.safeUrl('src', 'data:text/html,x'),
        newline: w.safeUrl('formaction', 'java\nscript:x'),
      };
    });
    assert.deepEqual(kept, { relative: true, rooted: true, fragment: true, https: true, mailto: true, tel: true, image: true, colonInPath: true, js: false, vb: false, dataPage: false, dataImageLink: false, dataSrcHtml: false, newline: false });
  } finally {
    await browser.close();
  }
});
