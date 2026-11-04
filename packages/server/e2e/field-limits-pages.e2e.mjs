// What a person may not change on a JSON page in the pages editor (editor src/pages: PageModel.may, the entry's can),
// in a real browser at 1440 against a real server whose preview draws the page with its sections and headings marked
// and runs the page agent: a French translator (a role that changes locales.fr-CA.** only) and a contributor who can
// only read the page see the same greyed page: a banner says why; a heading clicked on the page is not edited there
// (its field opens, greyed, in the panel); the panel's fields are read-only; the Sections list has no Add section and
// its menus grey Move, Duplicate and Delete; typing and ⌘S send nothing. A role that changes the sections edits a
// heading and adds a section; its save sends only section changes. Light and dark. The test people are made up here,
// with generated passwords; the browser opened here is closed in `after`.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: the Library's (support.mjs LIBRARY_PORTS: +12 the server, +14 the preview, +70 to +80 its dev servers), as
// canvas-drop.e2e.mjs reuses them: the files run one at a time. Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, client, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { LIBRARY_PORTS, SHOTS, pw, skip, blank } from './support.mjs';

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
    const body = (d.sections ?? []).map((s, i) => '<section data-ms-section="' + i + '" style="min-height:220px;padding:48px 64px;border-bottom:1px solid #ddd"><h2 data-ms-field="sections.' + i + '.value.heading" data-ms-kind="text" style="margin:0;font-size:30px">' + esc(s.value?.heading ?? s.discriminant) + '</h2></section>');
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>' + esc(d.title) + '</title></head><body style="margin:0;font:17px/1.55 system-ui;color:#14181f">' + body.join('') + '</body></html>';
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  }
  res.writeHead(404).end('not found');
}).listen(Number(process.argv[2]), '127.0.0.1');
`;

const role = (id, name, fields) => ({ id, name, base: 'contributor', rules: [{ id: 'pages', name: `Edits ${fields.join(', ')} of pages`, action: ['entry.edit'], collections: ['pages'], fields, effect: 'allow' }] });

describe('a JSON page in the pages editor: what the person may not change is greyed out', { skip, timeout: 240_000 }, () => {
  let fx, app, browser, ctx, page, owner, tess, rita, sam;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const file = () => path.join(fx.site, 'src/content/pages/about-us.json');
  const bytes = () => fs.readFileSync(file());
  const frame = () => page.frameLocator('.msp-frame');
  const status = (s) => page.locator(`.ms-status[data-status="${s}"]`);
  const panel = () => page.locator('.msp-panel');
  const heading = (i) => panel().locator(`[data-path="sections.${i}.value.heading"]`);
  /** Light and dark, the whole window. */
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `field-limits-pages-${name}-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  /** `who` signed in afresh, on the page with its first section selected and the page drawn by the agent */
  async function openAs(who) {
    await ctx.clearCookies();
    await blank(page);
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/p/pages/about-us?sec=0')}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/p/pages/about-us'));
    await frame().locator('[data-ms-section="0"] h2').waitFor();
    await page.waitForFunction(() => document.querySelector('.msp-frame')?.contentWindow && document.querySelector('.ms-status')?.dataset.status !== 'loading');
    await heading(0).waitFor();
  }
  /** The grip menu of section `i`: each item's words and whether it is greyed. */
  async function menuOf(i) {
    await page.locator('.msp-outline .ms-order__row').nth(i).locator('.ms-order__grip').click();
    const menu = page.getByRole('menu').last();
    await menu.waitFor();
    const items = await menu.getByRole('menuitem').evaluateAll((els) => els.map((e) => [e.textContent.trim(), e.getAttribute('aria-disabled') === 'true']));
    await page.keyboard.press('Escape');
    return Object.fromEntries(items);
  }
  /** What a person who may not change the sections sees, the same for a field-limited role and a read-only one. */
  async function greyed(banner, why) {
    assert.equal((await page.locator('.ms-banner:not(.ms-presence)').innerText()).trim(), banner);
    assert.match(await page.locator('.msp-note').textContent(), new RegExp(`^${why}`));
    // the panel: the section's fields read-only, still readable, with why once
    assert.match(await panel().getAttribute('class'), /\bis-locked\b/);
    assert.equal(await panel().locator('.ms-field__locked').count(), 1);
    assert.equal(await panel().locator('.ms-field__locked').textContent(), why);
    const boxes = panel().locator('input:not([type=checkbox]), textarea');
    assert.ok((await boxes.count()) > 1);
    assert.deepEqual([...new Set(await boxes.evaluateAll((els) => els.map((e) => e.readOnly)))], [true]);
    assert.equal(await heading(0).locator('input, textarea').inputValue(), JSON.parse(bytes().toString()).sections[0].value.heading, 'still readable');
    assert.equal(await panel().locator('button:not([disabled]):not(.ms-copyable__btn)').count(), 0, 'no button that changes anything');
    // the Sections list: no Add section; Move, Duplicate and Delete greyed, with why
    assert.equal(await page.locator('.msp-outline__add').count(), 0);
    assert.equal(await page.locator('.msp-sec__tools').count(), 0, 'no "add below", no padlock to set');
    assert.equal((await page.locator('.msp-outline__frozen').textContent()).trim(), `${why} No section can be added, moved or deleted.`);
    const menu = await menuOf(0);
    for (const k of ['Move down', 'Move to…', 'Duplicate', 'Delete']) assert.equal(menu[k], true, `${k} greyed`);
    // on the page: a heading clicked is not edited there; its field opens, greyed, in the panel
    const h2 = frame().locator('[data-ms-section="2"] h2');
    const words = await h2.textContent();
    await h2.click();
    await page.waitForURL((u) => decodeURIComponent(u.hash).includes('f=sections.2.value.heading'));
    assert.equal(await h2.getAttribute('contenteditable'), null);
    await page.keyboard.type('xyz');
    assert.equal(await h2.textContent(), words);
    assert.equal(await heading(2).locator('input, textarea').evaluate((e) => e.readOnly), true);
    // typing in a field and ⌘S send nothing
    await heading(2).locator('input, textarea').click();
    await page.keyboard.type('xyz');
    assert.equal(await heading(2).locator('input, textarea').inputValue(), words);
    assert.equal(await page.locator('.ms-status').getAttribute('data-status'), 'saved');
  }

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
    // the preview agent as the editor build emits it (npm run build:agent -w packages/editor)
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
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    tess = await addUser(app, { email: 'tess@example.test', name: 'Tess Translator', role: 'contributor', password: pass() });
    rita = await addUser(app, { email: 'rita@example.test', name: 'Rita Reader', role: 'contributor', password: pass() });
    sam = await addUser(app, { email: 'sam@example.test', name: 'Sam Sections', role: 'contributor', password: pass() });
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    for (const r of [role('translator-fr', 'French translator', ['locales.fr-CA.**']), role('section-writer', 'Section writer', ['sections'])]) assert.equal((await c.post('/roles', r)).status, 201);
    assert.equal((await c.patch(`/users/${tess.id}`, { customRole: 'translator-fr' })).status, 200);
    assert.equal((await c.patch(`/users/${sam.id}`, { customRole: 'section-writer' })).status, 200);
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('a French translator: the page, its panel and its sections greyed out; nothing is sent', async () => {
    const was = bytes();
    const sent = [];
    page.on('request', (r) => r.method() === 'PUT' && r.url().includes('/entries/about-us') && sent.push(r.url()));
    await openAs(tess);
    await greyed('Your role changes only locales.fr-CA.** here. The rest is greyed out.', 'Your role can’t change this page’s sections.');
    await shot('translator');
    await page.locator('.msp-outline').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+s');
    await page.waitForTimeout(400);
    assert.deepEqual(sent, [], 'no save');
    assert.deepEqual(bytes(), was);
  });

  test('a contributor who can only read the page: the same greying, with why', async () => {
    await openAs(rita);
    await greyed('You can read this page but not change it.', 'You can read this page but not change it.');
    await shot('read-only');
  });

  test('a role that changes the sections: a heading edited and a section added; the save sends only section changes', async () => {
    const before = JSON.parse(bytes().toString());
    const sent = [];
    page.on('request', (r) => r.method() === 'PUT' && r.url().includes('/entries/about-us') && sent.push(JSON.parse(r.postData() ?? '{}')));
    await openAs(sam);
    assert.equal((await page.locator('.ms-banner:not(.ms-presence)').innerText()).trim(), 'Your role changes only sections here. The rest is greyed out.');
    assert.equal(await panel().locator('.is-locked').count(), 0);
    assert.doesNotMatch(await panel().getAttribute('class'), /\bis-locked\b/);
    const box = heading(0).locator('input, textarea');
    assert.equal(await box.evaluate((e) => e.readOnly), false);
    await box.fill('Who we are');
    await page.locator('.msp-outline__add').click();
    await page.locator('.msp-picker__kind[data-kind="cta"]').click();
    await status('dirty').waitFor();
    await page.locator('.msp-outline').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+s');
    await status('saved').waitFor();
    const paths = sent.flatMap((b) => b.changes.map((ch) => ch.path));
    assert.ok(paths.length && paths.every((p) => p === 'sections' || p.startsWith('sections.')), paths.join(', '));
    const now = JSON.parse(bytes().toString());
    assert.equal(now.sections[0].value.heading, 'Who we are');
    assert.equal(now.sections.length, before.sections.length + 1);
    assert.notEqual(now.modified, before.modified, 'the server stamps the date (not the role’s change)');
    assert.deepEqual({ ...now, sections: null, modified: null }, { ...before, sections: null, modified: null }, 'nothing else in the file changed');
    await shot('sections');
  });
});
