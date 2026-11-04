// The SEO check's headings against the real built page, in a browser, on a running site:
//   node packages/editor/test/seo-h1.browser.mjs <editor address of an entry> [more…]
//   (e.g. http://127.0.0.1:<port>/markstage/#/e/<collection>/<id>; a server with sign-in needs MARKSTAGE_COOKIE)
// For each entry the built page's H1s are read from the site. The panel must not say "no main heading" when the
// page has one, and its outline must start with that H1 (the layout draws the title as the H1). Not in `npm test`:
// it needs the site running.
import { chromium } from 'playwright';

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('usage: node packages/editor/test/seo-h1.browser.mjs <editor address of an entry> [more…]');
  process.exit(2);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (process.env.MARKSTAGE_COOKIE) {
  const u = new URL(urls[0]);
  await context.addCookies([{ name: '__Host-markstage', value: process.env.MARKSTAGE_COOKIE, domain: u.hostname, path: '/', secure: true }]);
}
let failed = 0;
for (const url of urls) {
  const page = await context.newPage();
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}side=seo`);
  await page.waitForSelector('#ms-seo-headings .ms-seo-tree', { timeout: 30000 });
  // the panel has read the built page: "What Google sees" shows its tags (or why it could not)
  await page.waitForFunction(() => !document.querySelector('#ms-seo-google .is-busy') && document.querySelector('#ms-seo-google .ms-seo-sec__body')?.childElementCount, null, { timeout: 30000 });
  const path = squash(await page.locator('.ms-head__url').innerText());
  const built = await page.evaluate(async (p) => {
    const html = await (await fetch(p, { cache: 'no-store' })).text();
    return [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('h1')].map((h) => h.textContent ?? '');
  }, path);
  const text = await page.locator('#ms-seo-headings').innerText();
  const first = await page.locator('#ms-seo-headings .ms-seo-tree__item').first().innerText();
  const problems = [];
  if (built.length && /no main heading/i.test(text)) problems.push('says "no main heading" although the page has one');
  const [, level, words] = /^(H\d)\s*([\s\S]*)$/.exec(first.trim()) ?? [];
  if (built.length && (level !== 'H1' || squash(words) !== squash(built[0])))
    problems.push(`outline starts with "${squash(first)}", the page's H1 is "${squash(built[0])}"`);
  if (!built.length && !/no main heading/i.test(text)) problems.push('the page has no H1 and the panel does not say so');
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${path}: page H1 "${squash(built[0] ?? '')}"${problems.length ? `: ${problems.join('; ')}` : ''}`);
  failed += problems.length ? 1 : 0;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
