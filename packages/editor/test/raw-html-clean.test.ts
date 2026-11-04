// A raw HTML block of an entry is drawn cleaned (src/views/core.ts uses canvas-shell/dom.ts cleanHtml): a meta
// refresh, a frame, a form, an event handler and a javascript: address never reach the editor's document; plain
// markup stays. Run in a real browser document (headless Chromium through Playwright), since nothing else parses HTML
// the way the editor's page does. The test ships dom.ts to the page with its types stripped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';

const src = fs.readFileSync(path.join(import.meta.dirname, '../src/canvas-shell/dom.ts'), 'utf8');
const js = stripTypeScriptTypes(src).replace(/^export /gm, '');

/** Clean `html` as the raw views do and give back the drawn markup. */
async function drawn(html: string, opts?: { controls: boolean }): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>t</title><div id="host"></div>');
    await page.addScriptTag({ content: `${js}\nwindow.__clean = (h, o) => { const host = document.getElementById('host'); if (o) { host.innerHTML = h; sanitize(host, o); } else host.replaceChildren(cleanHtml(h)); return host.innerHTML; };` });
    return await page.evaluate(([h, o]) => (window as unknown as { __clean: (h: string, o?: unknown) => string }).__clean(h, o), [html, opts] as const);
  } finally {
    await browser.close();
  }
}

test('a raw HTML block: meta refresh, frames, scripts, styles, forms, handlers and javascript: links are dropped; plain markup is kept', async () => {
  const html = [
    '<meta http-equiv="refresh" content="0;url=https://example.org/">',
    '<base href="https://example.org/">',
    '<iframe src="/markstage/"></iframe>',
    '<script>document.title = "x"</script>',
    '<style>body{display:none}</style>',
    '<link rel="stylesheet" href="https://example.org/x.css">',
    '<form id="auth" action="https://example.org/steal"><label>Password <input type="password" name="pw"></label><button>Sign in</button></form>',
    '<img src="x.png" onerror="alert(1)" alt="pic">',
    '<a href="javascript:alert(1)">bad</a>',
    '<a href=" JAVAscript:alert(1)">bad2</a>',
    '<a href="data:text/html,<script>alert(1)</script>">bad3</a>',
    '<a id="location" name="top" href="https://example.org/" target="_blank">ok</a>',
    '<div class="box" data-x="1" autofocus tabindex="0"><p>Hello <strong>there</strong></p><table><tr><td>cell</td></tr></table></div>',
    '<svg viewBox="0 0 2 2"><use xlink:href="javascript:alert(1)"></use><circle r="1"></circle></svg>',
  ].join('');
  const out = await drawn(html);
  for (const gone of ['<meta', '<base', '<iframe', '<script', '<style', '<link', '<form', '<input', '<button', '<label', 'onerror', 'javascript:', 'data:text/html', 'autofocus', 'id="', 'name="']) assert.ok(!out.toLowerCase().includes(gone), `${gone} must not be drawn: ${out}`);
  for (const kept of ['<img src="x.png" alt="pic">', '<a>bad</a>', '<a>bad2</a>', '<a>bad3</a>', 'href="https://example.org/" target="_blank">ok</a>', '<div class="box" data-x="1" tabindex="0"><p>Hello <strong>there</strong></p>', '<td>cell</td>', '<circle r="1"></circle>']) assert.ok(out.includes(kept), `${kept} must be kept: ${out}`);
  assert.ok(!out.includes('xlink:href'), `the javascript: use is dropped: ${out}`);
});

test('the page shell keeps its forms (a newsletter box is the site\'s), still without scripts, handlers or bad addresses', async () => {
  const out = await drawn('<form id="news" action="/subscribe"><input name="email" onfocus="x()"><button formaction="javascript:x()">Go</button></form><script>x()</script>', { controls: true });
  assert.equal(out, '<form id="news" action="/subscribe"><input name="email"><button>Go</button></form>');
});

test('a raw HTML block stays in its box: no fixed or sticky position, no z-index past ±10, and in a line no absolute either (S6)', async () => {
  const out = await drawn('<div class="cover" style="position:fixed;inset:0;z-index:99999;background:#fff">Sign in again</div><p style="position: sticky; top:0">s</p><span style="position:absolute;z-index:5;color:red">a</span><b style="z-index:-50">z</b>');
  assert.ok(!/fixed|sticky|99999|-50/.test(out), `nothing escapes: ${out}`);
  assert.ok(/inset: ?0/.test(out) && out.includes('background'), `the rest of the style is kept: ${out}`);
  assert.ok(/position: ?absolute/.test(out) && /z-index: ?5/.test(out), `a block keeps absolute (its box clips it) and a small z-index: ${out}`);
  assert.ok(out.includes('<b>z</b>'), `an empty style goes: ${out}`);
  const line = await drawnInline('<span style="position:absolute;inset:0;width:100vw">x</span>');
  assert.ok(!line.includes('absolute'), `inside a line, absolute goes too: ${line}`);
});

test('links in a raw view never navigate the editor: click, middle click and Enter (holdLinks, S6)', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>t</title><div id="host"></div>');
    await page.addScriptTag({ content: `${js}\nconst host = document.getElementById('host'); holdLinks(host); host.replaceChildren(cleanHtml('<p><a href="https://example.org/away">plain</a> <a href="#x"><span id="in">inner</span></a></p><svg><a href="https://example.org/svg"><text y="10">svg</text></a></svg>'));\nwindow.__prevented = []; document.addEventListener('click', (e) => window.__prevented.push(e.defaultPrevented)); document.addEventListener('auxclick', (e) => window.__prevented.push(e.defaultPrevented));` });
    const start = page.url();
    await page.locator('a', { hasText: 'plain' }).click();
    await page.locator('span', { hasText: 'inner' }).click();
    await page.locator('a', { hasText: 'plain' }).click({ button: 'middle' });
    await page.locator('a', { hasText: 'plain' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('svg text').click();
    await page.waitForTimeout(200);
    assert.equal(page.url(), start, 'still on the editor');
    const prevented = await page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented);
    assert.ok(prevented.length >= 5 && prevented.every(Boolean), JSON.stringify(prevented));
  } finally {
    await browser.close();
  }
});

/** Clean `html` as the inline raw view does (cleanHtml with inline: true). */
async function drawnInline(html: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>t</title><div id="host"></div>');
    await page.addScriptTag({ content: `${js}\nwindow.__line = (h) => { const host = document.getElementById('host'); host.replaceChildren(cleanHtml(h, document, { inline: true })); return host.innerHTML; };` });
    return await page.evaluate((h) => (window as unknown as { __line: (h: string) => string }).__line(h), html);
  } finally {
    await browser.close();
  }
}

test('the raw block’s box (canvas.css .ms-raw) keeps a fixed piece inside it, in a real browser (S6)', async () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, '../src/styles/canvas.css'), 'utf8');
  const rule = /\.ms \.ProseMirror \.ms-raw \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /contain: paint/);
  assert.match(rule, /isolation: isolate/);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    // a piece whose style the cleaner would not see (a class from the site's CSS): the box alone must hold it
    await page.setContent(`<!doctype html><style>.ms-raw{${rule}} .site-cover{position:fixed;inset:0;z-index:99999;background:red}</style><p style="height:300px">before</p><div class="ms-raw" style="width:200px;height:100px"><div class="site-cover"></div></div>`);
    const r = await page.locator('.site-cover').boundingBox();
    assert.ok(r && r.width <= 200 && r.height <= 100 && r.y >= 300, `clipped to its box: ${JSON.stringify(r)}`);
    assert.equal(await page.evaluate(() => document.elementFromPoint(20, 60)?.tagName), 'P', 'the top of the page is not covered');
  } finally {
    await browser.close();
  }
});
