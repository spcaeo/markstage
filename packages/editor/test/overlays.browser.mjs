// The editor's own marks on the canvas never sit on a control, in a browser, on a running site:
//   node packages/editor/test/overlays.browser.mjs <editor address of an entry> [more…]
//   (e.g. http://127.0.0.1:<port>/markstage/#/e/<collection>/<id>; a server with sign-in needs MARKSTAGE_COOKIE)
// Every shown overlay icon (a popup link's badge, a padlock pill, a synced copy's pill) is checked against every
// clickable thing on the sheet (links, buttons, form fields, the FAQ's +, other overlays) and the article's text:
// their boxes may touch but never overlap; a badge
// must also sit beside a link (within 24px), not where its link used to be. Checked
// once the page has settled (the cover and the fonts loaded) and again after the canvas is scrolled to the end.
// Not in `npm test`: it needs the site running.
import { chromium } from 'playwright';

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('usage: node packages/editor/test/overlays.browser.mjs <editor address of an entry> [more…]');
  process.exit(2);
}

const OVERLAYS = '.ms-badge, .ms-padlock, .ms-synced-pill';
const CLICKABLE = 'a, button, input, select, textarea, summary, [role="button"]';

const browser = await chromium.launch();
let failed = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (process.env.MARKSTAGE_COOKIE) {
    const u = new URL(urls[0]);
    await context.addCookies([{ name: '__Host-markstage', value: process.env.MARKSTAGE_COOKIE, domain: u.hostname, path: '/', secure: true }]);
  }
  for (const url of urls) {
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector('.ProseMirror', { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const problems = new Set();
    for (const step of ['settled', 'scrolled']) {
      if (step === 'scrolled') {
        await page.evaluate(async () => {
          const sc = document.querySelector('.ms-sheet')?.closest('.ms-scroll, [class*="scroll"]') ?? document.scrollingElement;
          for (let y = 0; y < sc.scrollHeight; y += 700) (sc.scrollTop = y), await new Promise((r) => setTimeout(r, 30));
        });
      }
      await page.waitForTimeout(600);
      const found = await page.evaluate(({ OVERLAYS, CLICKABLE }) => {
        const shown = (e) => {
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && e.checkVisibility();
        };
        const sheet = document.querySelector('.ms-sheet') ?? document.body;
        const name = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''} “${(e.textContent ?? '').trim().slice(0, 30)}”`;
        const marks = [...sheet.querySelectorAll(OVERLAYS)].filter(shown);
        const things = [...sheet.querySelectorAll(CLICKABLE)].filter(shown);
        const out = [];
        for (const m of marks) {
          const a = m.getBoundingClientRect();
          for (const t of [...things, ...marks]) {
            if (t === m || m.contains(t) || t.contains(m)) continue;
            // a link wrapped over two lines is its two lines, not the box around both; touching edges is fine
            const hit = [...t.getClientRects()].some((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1);
            if (hit) out.push(`${name(m)} covers ${name(t)}`);
          }
        }
        // nor on the article's text: each line's letters (its line box less the line spacing above and below)
        const lines = [];
        const walk = document.createTreeWalker(sheet.querySelector('.ProseMirror') ?? sheet, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.textContent.trim() || n.parentElement.closest(OVERLAYS)) continue;
          const cs = getComputedStyle(n.parentElement);
          const size = parseFloat(cs.fontSize);
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const b of range.getClientRects()) {
            const pad = Math.max(0, (b.height - size) / 2);
            lines.push({ left: b.left, right: b.right, top: b.top + pad, bottom: b.bottom - pad, text: n.textContent.trim().slice(0, 30) });
          }
        }
        for (const m of marks) {
          const a = m.getBoundingClientRect();
          const on = lines.find((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1);
          if (on) out.push(`${name(m)} covers the text “${on.text}”`);
        }
        // and a popup link's badge is beside its link (left behind when the page moved under it, it marks nothing)
        const links = [...sheet.querySelectorAll('.ProseMirror a')].flatMap((l) => [...l.getClientRects()]);
        for (const m of marks.filter((x) => x.matches('.ms-badge'))) {
          const a = m.getBoundingClientRect();
          const gap = (b) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom, 0);
          if (!links.some((b) => gap(b) <= 24)) out.push(`${name(m)} is ${Math.round(Math.min(...links.map(gap)))}px from the nearest link`);
        }
        return out;
      }, { OVERLAYS, CLICKABLE });
      for (const f of found) problems.add(f);
    }
    if (problems.size) {
      failed++;
      console.log(`✖ ${url}`);
      for (const p of problems) console.log(`    ${p}`);
    } else console.log(`✔ ${url}: no mark covers a control or the text`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
