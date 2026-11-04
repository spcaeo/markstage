// A script on the preview origin cannot drive the pages editor (security review 3 Nov 2026, S2). The page in the
// editor's frame is the site's own: its code, a third-party tag or raw HTML in a draft runs there and can post the
// same messages as Markstage's page agent. Here, in a real browser against a real server and preview, such a script
// (run inside the frame, on the preview origin) says the page binds the code injection, SEO, title, address and a
// section's non-text settings, types into them, and presses "save": the editor takes none of those fields, nothing
// is changed, and nothing is saved. A forged edit of a real inline field stays an unsaved change: the frame's "⌘S"
// only hands the keyboard back to the editor, and nothing is sent until the person saves. The test person is made up
// here, with a generated password; the browser opened here is closed in `after`.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: the Library's (support.mjs LIBRARY_PORTS), as field-limits-pages.e2e.mjs reuses them: the files run one at a
// time.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { LIBRARY_PORTS, pw, skip, blank } from './support.mjs';

const [PORT, PREVIEW_PORT] = LIBRARY_PORTS;
const DEV_PORTS = [LIBRARY_PORTS[2], LIBRARY_PORTS.at(-1)];
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core/test/fixtures/site');

// stands in for `astro dev`: a page's sections, each heading marked as the astro integration marks it
const FAKE_DEV = `import fs from 'node:fs';
import http from 'node:http';
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  for (const f of fs.readdirSync('src/content/pages')) {
    const d = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
    if (d.uri !== url) continue;
    const body = (d.sections ?? []).map((s, i) => '<section data-ms-section="' + i + '" style="min-height:220px;padding:48px 64px"><h2 data-ms-field="sections.' + i + '.value.heading" data-ms-kind="text" style="margin:0">' + esc(s.value?.heading ?? s.discriminant) + '</h2></section>');
    const html = '<!doctype html><html><head><title>' + esc(d.title) + '</title></head><body style="margin:0;font:17px/1.55 system-ui">' + body.join('') + '</body></html>';
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  }
  res.writeHead(404).end('not found');
}).listen(Number(process.argv[2]), '127.0.0.1');
`;

// fields no page may name for the editor: code injection, SEO, the title and address, a section's non-text settings
const FORGED = [
  { path: 'codeInjection.head', kind: 'text', value: '<script src="https://evil.example/x.js"></script>' },
  { path: 'codeInjection', kind: 'rich', value: '<script>steal()</script>' },
  { path: 'seo.title', kind: 'text', value: 'Pwned' },
  { path: 'title', kind: 'text', value: 'Pwned' },
  { path: 'uri', kind: 'text', value: '/pwned/' },
  { path: 'exitPopup', kind: 'text', value: 'false' },
  { path: 'sections.0.value.headingLevel', kind: 'text', value: '9' },
  { path: 'sections.0.value.image.src', kind: 'text', value: 'https://evil.example/x.png' },
  { path: 'sections.0.discriminant', kind: 'text', value: 'prose' },
];

describe('a script on the preview origin cannot change fields or save in the pages editor', { skip, timeout: 240_000 }, () => {
  let fx, app, browser, ctx, page, owner;
  const file = () => path.join(fx.site, 'src/content/pages/about-us.json');
  const bytes = () => fs.readFileSync(file());
  const status = () => page.locator('.ms-status').getAttribute('data-status');
  const puts = [];

  /** The preview frame (the page on the preview origin), once the page agent has answered. */
  async function previewFrame() {
    await page.frameLocator('.msp-frame').locator('[data-ms-section="0"] h2').waitFor();
    const f = page.frames().find((fr) => fr.url().startsWith(`http://127.0.0.1:${PREVIEW_PORT}/`));
    assert.ok(f, 'the preview frame');
    return f;
  }
  /** Run, inside the preview page, what a hostile script there would do: post the page agent's messages. */
  const hostile = (f, fields, edits) =>
    f.evaluate(
      ([fields, edits]) => {
        const send = (m) => parent.postMessage(m, '*');
        send({ markstage: 'page:ready', path: location.pathname, sections: [0], fields });
        for (const e of edits) send({ markstage: 'page:edit', path: e.path, value: e.value });
        for (const e of edits) send({ markstage: 'page:pick', path: e.path, kind: 'text' });
        send({ markstage: 'page:key', key: 's' });
      },
      [fields, edits],
    );

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.copyFileSync(path.join(SITE, 'about-us.json'), file());
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A real page');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    fs.copyFileSync(new URL('../../editor/dist/preview-agent.js', import.meta.url), path.join(editorDir, 'preview-agent.js'));
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    const config = loadConfig({
      env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' },
      overrides: { port: PORT, editorDir, preview: { origin: `http://127.0.0.1:${PREVIEW_PORT}`, port: PREVIEW_PORT, ports: DEV_PORTS, command: [process.execPath, fake, '{port}'], settleFile: null, settleMs: 50 } },
    });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: `t-${crypto.randomBytes(12).toString('base64url')}` });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('request', (r) => r.method() === 'PUT' && r.url().includes('/entries/about-us') && puts.push(r.postData()));
    await blank(page);
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/p/pages/about-us')}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/p/pages/about-us'));
    await page.waitForFunction(() => document.querySelector('.ms-status')?.dataset.status === 'saved');
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('forged fields (code injection, SEO, title, address, settings) are not taken, and "save" saves nothing', async () => {
    const was = bytes();
    const f = await previewFrame();
    // the frame has the keyboard, as when the person typed on the page
    await page.frameLocator('.msp-frame').locator('[data-ms-section="0"] h2').click();
    await page.keyboard.press('Escape');
    await hostile(f, FORGED.map(({ path, kind }) => ({ path, kind })), FORGED);
    await page.waitForTimeout(1500);
    assert.deepEqual(puts, [], 'nothing was sent to the server');
    assert.deepEqual(bytes(), was, 'the file is as it was');
    assert.equal(await status(), 'saved', 'no unsaved change either');
    // a forged pick of a page-level key does not open it
    assert.doesNotMatch(decodeURIComponent(new URL(page.url()).hash), /f=(codeInjection|seo|title|uri)/);
  });

  test('a forged edit of a real inline field stays unsaved: the frame’s "⌘S" hands the keyboard back, it does not save', async () => {
    const was = bytes();
    const f = await previewFrame();
    await page.frameLocator('.msp-frame').locator('[data-ms-section="0"] h2').click();
    await page.keyboard.press('Escape');
    await hostile(f, [{ path: 'sections.0.value.heading', kind: 'text' }], [{ path: 'sections.0.value.heading', value: 'Forged heading' }]);
    await page.waitForFunction(() => document.querySelector('.ms-status')?.dataset.status === 'dirty');
    await page.waitForTimeout(1500);
    assert.deepEqual(puts, [], 'the frame’s save key sent nothing');
    assert.deepEqual(bytes(), was);
    // the keyboard is the editor's again (not the frame's), so the person's own ⌘S is what saves
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('msp-frame')), false);
    await page.keyboard.press('ControlOrMeta+s');
    await page.waitForFunction(() => document.querySelector('.ms-status')?.dataset.status === 'saved');
    assert.equal(puts.length, 1, 'saved once, by the person');
    assert.equal(JSON.parse(bytes().toString()).sections[0].value.heading, 'Forged heading');
  });
});
