// Library sections dropped onto the page itself in the pages editor, in a real browser at 1440, against a real
// server whose preview draws the page with its sections marked (data-ms-section) and runs the page agent: a drag
// over the page shows a line between two sections that says where it lands, and the drop puts the copy there and
// saves (a synced item lands as a synced copy); Undo puts the file back byte for byte; a locked section and a page
// whose layout is locked take nothing and say why; Insert… and a place chosen by name, from the keyboard; and a drop
// the server refuses (the site's own check, 422) is taken out again with the server's words.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: the Library's (support.mjs LIBRARY_PORTS: +12 the server, +14 the preview, +70 to +80 its dev servers),
// free again once library.e2e.mjs is done: the files run one at a time. Screenshots (light and dark) go to
// MARKSTAGE_E2E_SHOTS when it is set.
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

// stands in for `astro dev`: a page's sections as tall blocks, each marked as the astro integration marks them
const FAKE_DEV = `import fs from 'node:fs';
import http from 'node:http';
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  for (const f of fs.readdirSync('src/content/pages')) {
    const d = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
    if (d.uri !== url) continue;
    const tint = { hero: '#eef1ff', cta: '#14181f', credentials: '#f6f7f9', prose: '#fff' };
    const body = (d.sections ?? []).map((s, i) => {
      const v = s.value ?? {};
      const dark = s.discriminant === 'cta';
      return '<section data-ms-section="' + i + '" style="min-height:300px;box-sizing:border-box;padding:56px 64px;background:' + (tint[s.discriminant] ?? '#fff') + ';color:' + (dark ? '#fff' : 'inherit') + '"><h2 data-ms-field="sections.' + i + '.value.heading" data-ms-kind="text" style="margin:0 0 8px;font-size:32px">' + esc(v.heading ?? s.discriminant) + '</h2>' + (v.lead ? '<p style="margin:0;max-width:60ch">' + esc(v.lead) + '</p>' : '') + '</section>';
    });
    const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>' + esc(d.title) + '</title></head><body style="margin:0;font:17px/1.55 system-ui;color:#14181f">' + body.join('') + '</body></html>';
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  }
  res.writeHead(404).end('not found');
}).listen(Number(process.argv[2]), '127.0.0.1');
`;

// the site's own entry check: a page with a section it does not know (marked NOT-ON-THIS-SITE) is refused
const VALIDATE = `let t = '';
process.stdin.on('data', (d) => (t += d));
process.stdin.on('end', () => {
  if (process.env.MARKSTAGE_COLLECTION !== 'pages' || !t.includes('NOT-ON-THIS-SITE')) return;
  console.log(JSON.stringify({ issues: [{ severity: 'error', message: 'sections: the "Retired banner" section is not built by this site any more' }] }));
  process.exit(1);
});
`;

describe('Library sections dropped onto the page', { skip }, () => {
  let fx, app, browser, ctx, page, ed, owner, items;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const file = (id) => path.join(fx.site, `src/content/pages/${id}.json`);
  const bytes = (id) => fs.readFileSync(file(id));
  const pageData = (id) => JSON.parse(fs.readFileSync(file(id), 'utf8'));
  const frame = () => page.frameLocator('.msp-frame');
  const status = (s) => page.locator(`.ms-status[data-status="${s}"]`);
  /** both themes, the whole window */
  const shots = async (name) => {
    if (!SHOTS) return;
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `canvas-drop-${name}-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const open = async (where) => {
    await blank(page);
    await page.goto(`${BASE}/markstage/${where}`);
  };
  /** the editor open on page `id` with the picker at the end, the page drawn with `n` sections */
  const openPage = async (id, extra = '') => {
    const n = pageData(id).sections.length;
    await open(`#/p/pages/${id}?add=${n}${extra}`);
    await page.getByRole('group', { name: 'From the Library' }).waitFor();
    await frame().locator(`[data-ms-section="${n - 1}"]`).waitFor();
    // the page agent has answered (page:ready): the editor drew it as editable
    await page.waitForFunction(() => document.querySelector('.msp-frame')?.contentWindow && document.querySelector('.ms-status')?.dataset.status !== 'loading');
    return n;
  };
  /** a section's name as the outline gives it: "2. Prose: …" */
  const label = async (i) => {
    const row = page.locator(`.msp-sec[data-index="${i}"]`);
    return `${(await row.locator('.msp-sec__kind').textContent()).trim()}: ${(await row.locator('.msp-sec__title').textContent()).trim()}`;
  };
  /** a drag from Library item `id` in the picker to `y` pixels below the top of section `i` on the page; `at` runs mid-drag */
  const dragOnto = async (id, i, y, at) => {
    const src = page.getByRole('group', { name: 'From the Library' }).locator(`[data-lib="${id}"]`);
    const box = await sectionBox(i);
    await src.hover();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + y, { steps: 12 });
    await page.locator('.msp-dropsheet:not([hidden])').waitFor();
    // the page agent's rects come back and the line or the reason is drawn
    await page.mouse.move(box.x + box.width / 2 + 4, box.y + y, { steps: 2 });
    await page.waitForFunction(() => [...document.querySelectorAll('.msp-dropsheet__line, .msp-dropsheet__no')].some((e) => !e.hidden));
    try {
      return await at?.();
    } finally {
      await page.mouse.up();
    }
  };
  /** section `i` scrolled to the middle of the page's window, and where it is then */
  const sectionBox = async (i) => {
    const el = frame().locator(`[data-ms-section="${i}"]`);
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    return el.boundingBox();
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    const about = JSON.parse(fs.readFileSync(path.join(SITE, 'about-us.json'), 'utf8'));
    // the third section locked by an editor (where the editor's padlock keeps it)
    about.sections[2].value._lock = { edit: true, by: 'Olive Owner' };
    fs.writeFileSync(file('about-us'), `${JSON.stringify(about, null, 2)}\n`);
    // a page whose layout an editor locked
    const fixed = { ...about, title: 'Fixed', uri: '/fixed/', _lock: { layout: true, by: 'Olive Owner' } };
    fs.writeFileSync(file('fixed'), `${JSON.stringify(fixed, null, 2)}\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Two real pages');
    fs.writeFileSync(path.join(fx.run, 'validate.mjs'), VALIDATE);
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
      overrides: {
        port: PORT,
        editorDir,
        preview: { origin: `http://127.0.0.1:${PREVIEW_PORT}`, port: PREVIEW_PORT, ports: DEV_PORTS, command: [process.execPath, fake, '{port}'], settleFile: null, settleMs: 50 },
        validate: { command: [process.execPath, path.join(fx.run, 'validate.mjs')], timeoutSeconds: 10 },
      },
    });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    ed = client(BASE);
    await ed.login(owner.email, owner.password);
    const make = async (d) => {
      const r = await ed.post('/library', d);
      assert.equal(r.status, 201, r.text);
      return r.json;
    };
    items = {
      cta: await make({ kind: 'section', name: 'Talk to us', synced: true, collection: 'pages', folder: 'Calls to action', body: { value: about.sections[3] } }),
      hero: await make({ kind: 'section', name: 'Our story hero', collection: 'pages', folder: 'Heroes', body: { value: about.sections[0] } }),
      retired: await make({ kind: 'section', name: 'Retired banner', collection: 'pages', folder: 'Old', body: { value: { discriminant: 'cta', value: { heading: 'Last chance NOT-ON-THIS-SITE', lead: 'This section was retired.' } } } }),
    };
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${BASE}/markstage/#/library`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('searchbox', { name: 'Search the Library' }).waitFor();
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('the canvas never sits blank: "Preparing the preview…" until the page reports in; the preview\'s expired page makes one automatic retry with a fresh URL', async () => {
    const previews = [];
    const count = (r) => /\/markstage\/api\/preview\/pages\//.test(r.url()) && previews.push(r.url());
    page.on('request', count);
    try {
      await openPage('about-us');
      const notice = page.locator('.msp-wait');
      assert.equal(await notice.isHidden(), true, 'the notice is gone once the page said ready');
      assert.equal(previews.length, 1);
      // the preview's own 403 page (a used ticket, no cookie) tells the editor; the editor opens the frame again on a
      // fresh preview URL, and the notice shows while it waits
      const shown = await page.evaluate(() => {
        const f = document.querySelector('.msp-frame');
        window.dispatchEvent(new MessageEvent('message', { data: { markstage: 'preview-expired' }, origin: new URL(f.src).origin, source: f.contentWindow }));
        const n = document.querySelector('.msp-wait');
        return { hidden: n.hidden, text: n.innerText };
      });
      assert.equal(shown.hidden, false, 'the notice is back while the frame is opened again');
      assert.match(shown.text, /Preparing the preview/);
      await page.waitForFunction(() => document.querySelector('.msp-wait').hidden);
      assert.equal(previews.length, 2, 'a fresh preview URL was asked for');
      await frame().locator('[data-ms-section="0"]').waitFor();
    } finally {
      page.off('request', count);
    }
  });

  test('a synced item dragged onto the page at 1440: the line says where, it lands there as a synced copy and is drawn; ⌘Z and a save put the file back byte for byte', async () => {
    const was = bytes('about-us');
    const n = await openPage('about-us');
    const first = await label(0);
    // just above the second section's middle: before it, so after the first
    const tag = await dragOnto(items.cta.id, 1, 60, async () => {
      const t = (await page.locator('.msp-dropsheet__tag').textContent()).trim();
      await shots('line');
      return t;
    });
    assert.equal(tag, `Drop here: after ${first}`);
    await page.waitForURL(/sec=1/);
    assert.ok(!hash().includes('add='), hash());
    await status('saved').waitFor();
    await page.getByText(`Added “Talk to us” (synced) after ${first}.`).waitFor();
    const d = pageData('about-us');
    assert.equal(d.sections.length, n + 1);
    assert.deepEqual(d.sections[1]._synced, { id: items.cta.id, version: items.cta.syncVersion }, 'a synced copy, with the version the server writes');
    assert.equal(d.sections[1].value.heading, items.cta.body.value.value.heading);
    await page.locator('.msp-sec[data-index="1"] .msp-sec__synced').waitFor();
    // the site draws the page again with it in place (the outline and the page agree)
    await frame().locator('[data-ms-section="1"] h2', { hasText: items.cta.body.value.value.heading }).waitFor({ timeout: 15000 });
    await frame().locator(`[data-ms-section="${n}"]`).waitFor();
    await shots('dropped');
    // ⌘Z takes it out (the page has that to save), and the save puts the file back as it was
    await page.locator('.msp-outline').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(() => !document.querySelector('.msp-sec[data-index="1"] .msp-sec__synced'));
    await page.keyboard.press('ControlOrMeta+s');
    await status('saved').waitFor();
    await page.waitForFunction((len) => document.querySelectorAll('.msp-sec[data-index]').length === len, n);
    await page.waitForTimeout(300);
    assert.deepEqual(bytes('about-us'), was, 'byte for byte as before the drop');
  });

  test('a locked section takes no drop in its middle and says why; near its edge it goes above it; a page whose layout is locked takes none', async () => {
    const was = bytes('about-us');
    await openPage('about-us');
    const locked = await label(2);
    const above = await label(1);
    const box = await sectionBox(2);
    const why = await dragOnto(items.hero.id, 2, 150, async () => {
      assert.equal(await page.locator('.msp-dropsheet__line').isHidden(), true);
      const t = (await page.locator('.msp-dropsheet__no').textContent()).trim();
      await shots('locked');
      // near its top edge: above it
      await page.mouse.move(box.x + box.width / 2, box.y + 12, { steps: 3 });
      await page.locator('.msp-dropsheet__line:not([hidden])').waitFor();
      assert.equal((await page.locator('.msp-dropsheet__tag').textContent()).trim(), `Drop here: after ${above}`);
      // and back in its middle, where it is let go
      await page.mouse.move(box.x + box.width / 2, box.y + 150, { steps: 3 });
      await page.locator('.msp-dropsheet__no:not([hidden])').waitFor();
      return t;
    });
    assert.equal(why, `${locked}. Locked by Olive Owner: can't be changed. Drop it above or below this section.`);
    // nothing landed, nothing saved
    await page.waitForTimeout(400);
    assert.deepEqual(bytes('about-us'), was);
    assert.equal(await page.locator('.msp-sec[data-index]').count(), pageData('about-us').sections.length);
    // the page's layout locked: the whole page says so, and Insert… lists no place to choose
    const n = await openPage('fixed');
    const fixedWas = bytes('fixed');
    const whole = await dragOnto(items.hero.id, 1, 100, async () => (await page.locator('.msp-dropsheet__no').textContent()).trim());
    assert.equal(whole, 'The layout of this page is locked by Olive Owner: no section can be added, deleted or reordered.');
    await page.locator(`[data-places="${items.hero.id}"]`).click();
    await page.waitForURL(new RegExp(`ins=${items.hero.id}`));
    const menu = page.getByRole('menu', { name: 'Where to put “Our story hero”' });
    await menu.getByText('The layout of this page is locked by Olive Owner').waitFor();
    assert.equal(await menu.locator('[role=menuitem][aria-disabled=true]').count(), n + 1);
    await shots('layout-locked');
    // a click on a place does nothing either
    await menu.locator('[role=menuitem]').first().click({ force: true });
    await page.waitForTimeout(300);
    assert.deepEqual(bytes('fixed'), fixedWas);
  });

  test('the keyboard: Insert… on an item, a place chosen by name, the note read out says where it went; the toast’s Undo puts the file back', async () => {
    const was = bytes('about-us');
    const n = await openPage('about-us');
    const second = await label(1);
    const locked = await label(2);
    const places = page.locator(`[data-places="${items.hero.id}"]`);
    await places.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`ins=${items.hero.id}`));
    const menu = page.getByRole('menu', { name: 'Where to put “Our story hero”' });
    assert.equal(await menu.locator('[role=menuitem]').count(), n + 1);
    // the locked section is named in its place, with why
    await menu.getByText(`${locked}. Locked by Olive Owner: can't be changed.`).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), `At the top, before ${await label(0)}`);
    // the open list is in the URL: a reload draws it again
    await page.reload();
    await menu.waitFor();
    await menu.locator('[role=menuitem]').first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), `After ${second}`);
    await shots('insert-list');
    await page.keyboard.press('Enter');
    await status('saved').waitFor();
    // the note is in the live region screen readers read out
    await page.locator('[role=status][aria-live=polite]', { hasText: `Added “Our story hero” after ${second}.` }).waitFor();
    assert.ok(!hash().includes('ins=') && !hash().includes('add='), hash());
    assert.ok(hash().includes('sec=2'), hash());
    const d = pageData('about-us');
    assert.equal(d.sections.length, n + 1);
    assert.deepEqual(d.sections[2], items.hero.body.value);
    // Undo on the toast: out again and saved, the file as it was
    await page.locator('.ms-toast', { hasText: 'Added “Our story hero”' }).getByRole('button', { name: 'Undo' }).click();
    await page.getByText('Took “Our story hero” out again.').waitFor();
    await status('saved').waitFor();
    assert.deepEqual(bytes('about-us'), was, 'byte for byte as before');
    // Escape closes the list, back on its button
    await open(`#/p/pages/about-us?add=${n}&ins=${items.hero.id}`);
    await menu.waitFor();
    await menu.locator('[role=menuitem]').first().focus();
    await page.keyboard.press('Escape');
    await page.waitForURL((u) => !u.hash.includes('ins='));
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.places), items.hero.id);
  });

  test('a drag near the bottom of the page scrolls it, and the line follows the sections; let go elsewhere, nothing lands', async () => {
    const was = bytes('about-us');
    await openPage('about-us');
    const win = page.frames().find((f) => f.url().includes('/about-us/'));
    await win.evaluate(() => window.scrollTo(0, 0));
    const f = await page.locator('.msp-frame').boundingBox();
    const src = page.getByRole('group', { name: 'From the Library' }).locator(`[data-lib="${items.hero.id}"]`);
    await src.hover();
    await page.mouse.down();
    try {
      await page.mouse.move(f.x + f.width / 2, f.y + f.height - 12, { steps: 12 });
      await page.locator('.msp-dropsheet:not([hidden])').waitFor();
      await page.mouse.move(f.x + f.width / 2 + 4, f.y + f.height - 10, { steps: 2 });
      // the pointer rests there: the page goes on scrolling, to its end
      await win.waitForFunction(() => window.scrollY > 0 && window.scrollY + innerHeight >= document.documentElement.scrollHeight - 1, null, { polling: 100 });
      // the line follows: over the last section, now in sight, it is drawn at the end of the page
      const end = `Drop here: at the end, after ${await label(3)}`;
      await page.mouse.move(f.x + f.width / 2, f.y + f.height - 120, { steps: 2 });
      await page.waitForFunction((t) => document.querySelector('.msp-dropsheet__tag')?.textContent === t && !document.querySelector('.msp-dropsheet__line').hidden, end);
    } finally {
      // let go over the header: no drop
      await page.mouse.move(f.x + f.width / 2, 20, { steps: 6 });
      await page.mouse.up();
    }
    await page.locator('.msp-dropsheet').waitFor({ state: 'hidden' });
    await page.waitForTimeout(300);
    assert.deepEqual(bytes('about-us'), was);
  });

  test('a drop the server refuses (the site’s own check) is taken out again, in the server’s words', async () => {
    const was = bytes('about-us');
    const n = await openPage('about-us');
    await dragOnto(items.retired.id, 0, 40);
    const words = 'The site cannot use this entry: sections: the "Retired banner" section is not built by this site any more';
    await page.locator('.ms-banner', { hasText: words }).waitFor();
    await page.getByText(`“Retired banner” was not added: ${words}`).waitFor();
    await shots('refused');
    assert.deepEqual(bytes('about-us'), was, 'nothing written');
    assert.equal(await page.locator('.msp-sec[data-index]').count(), n, 'and not in the outline');
    assert.ok(!hash().includes('sec='), hash());
    // nothing left to save: the page is as its file
    assert.equal(await page.locator('.ms-status').getAttribute('data-status'), 'saved');
    await page.keyboard.press('ControlOrMeta+s');
    await page.waitForTimeout(300);
    assert.deepEqual(bytes('about-us'), was);
  });
});
