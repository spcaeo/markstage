// The Library in a real browser, against a real server on 127.0.0.1 (the editor built with build-editor.mjs), on
// the real page files of core's fixtures (a live site's): the #/library screen (filters and the open item in the URL, a
// pack exported and imported back byte for byte, a WordPress file into "Imported"), the canvas panel (an item
// dragged onto an article and taken back with one ⌘Z; Enter puts one after the caret's block), and the pages
// editor (a synced section added from the outline's picker by the keyboard and by a drag, changed on one page and
// applied to both, a save that changes a copy in place refused, then detached).
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: MARKSTAGE_E2E_PORT_BASE (default 18231, odd) +12 is the server, +14 the preview, and its dev servers take
// a free odd port from +70 to +80 (the server's freeOddPort checks each; even offsets keep an odd base odd), so it
// runs beside admin.e2e.mjs. Screenshots (light and dark) go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, client, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { PORT_BASE, SHOTS, pw, skip, blank } from './support.mjs';

const PORT = PORT_BASE + 12;
const PREVIEW_PORT = PORT_BASE + 14;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core/test/fixtures/site');

// stands in for `astro dev` in the preview: a page's sections as plain blocks, an article's text as paragraphs
const FAKE_DEV = `import fs from 'node:fs';
import http from 'node:http';
const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const page = (title, body) => '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>' + esc(title) + '</title></head><body style="margin:0;font:16px/1.5 system-ui;color:#14181f">' + body + '</body></html>';
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const blog = /^\\/blog\\/([a-z0-9-]+)\\/$/.exec(url);
  if (blog) {
    const text = fs.readFileSync('src/content/blog/' + blog[1] + '.md', 'utf8').replace(/^---[\\s\\S]*?---\\n/, '');
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(blog[1], '<main style="max-width:680px;margin:24px auto">' + text.split('\\n\\n').map((p) => '<p>' + esc(p) + '</p>').join('') + '</main>'));
  }
  for (const f of fs.readdirSync('src/content/pages')) {
    const d = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
    if (d.uri !== url) continue;
    const tint = { hero: '#eef1ff', cta: '#14181f', credentials: '#f6f7f9' };
    const body = (d.sections ?? []).map((s) => {
      const v = s.value ?? {};
      const dark = s.discriminant === 'cta';
      return '<section style="padding:40px 48px;background:' + (tint[s.discriminant] ?? '#fff') + ';color:' + (dark ? '#fff' : 'inherit') + '"><h2 style="margin:0 0 8px">' + esc(v.heading ?? s.discriminant) + '</h2>' + (v.lead ? '<p style="margin:0;max-width:60ch">' + esc(v.lead) + '</p>' : '') + '</section>';
    });
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(d.title, body.join('')));
  }
  res.writeHead(404).end('not found');
}).listen(Number(process.argv[2]), '127.0.0.1');
`;

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const wxr = (blocks) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/"><channel><title>Old site</title>${blocks
    .map((b) => `<item><title><![CDATA[${b.title}]]></title><content:encoded><![CDATA[${b.html}]]></content:encoded><wp:post_id>${b.id}</wp:post_id><wp:post_type><![CDATA[wp_block]]></wp:post_type><wp:status><![CDATA[publish]]></wp:status></item>`)
    .join('')}</channel></rss>\n`;

describe('the Library in a browser', { skip }, () => {
  let fx, app, browser, ctx, page, ed, owner, items;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const pageData = (id) => JSON.parse(fs.readFileSync(path.join(fx.site, `src/content/pages/${id}.json`), 'utf8'));
  const itemFile = (id) => fs.readFileSync(path.join(fx.site, `markstage/library/section/${id}.json`));
  /** both themes, the whole screen (screens scroll inside, so the window is made as tall as the content) */
  const shots = async (name, { tall = 900 } = {}) => {
    if (!SHOTS) return;
    await page.setViewportSize({ width: 1360, height: tall });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `library-${name}-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1360, height: 900 });
  };
  /** the editor loaded afresh at `where` (each test starts from a clean app, not the last test's state) */
  const open = async (where) => {
    await blank(page);
    await page.goto(`${BASE}/markstage/${where}`);
  };
  const saved = async () => {
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
  };
  const signIn = async (who) => {
    await page.context().clearCookies();
    await open(`#/library`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // signing in starts the editor again (a reload): its Library screen is drawn once that is done
    await page.getByRole('searchbox', { name: 'Search the Library' }).waitFor();
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    // two real pages, and the plain fixture article
    const about = fs.readFileSync(path.join(SITE, 'about-us.json'), 'utf8');
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/about-us.json'), about);
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/team.json'), about.replace('"/about-us/"', '"/team/"').replace('"About Us"', '"Team"'));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Two real pages');
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
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    const config = loadConfig({
      env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' },
      overrides: {
        port: PORT,
        editorDir,
        // the dev servers: only the odd ports of this range, each checked free (preview/site.mjs freeOddPort)
    preview: { origin: `http://127.0.0.1:${PREVIEW_PORT}`, port: PREVIEW_PORT, ports: [PORT_BASE + 70, PORT_BASE + 80], command: [process.execPath, fake, '{port}'], settleFile: null, settleMs: 50 },
      },
    });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    ed = client(BASE);
    await ed.login(owner.email, owner.password);
    // the Library: the page's CTA as a synced section, its hero as a plain one, and an article snippet
    const sections = pageData('about-us').sections;
    const make = async (d) => {
      const r = await ed.post('/library', d);
      assert.equal(r.status, 201, r.text);
      return r.json;
    };
    items = {
      cta: await make({ kind: 'section', name: 'Talk to us', synced: true, collection: 'pages', folder: 'Calls to action', body: { value: sections[3] } }),
      hero: await make({ kind: 'section', name: 'Our story hero', collection: 'pages', folder: 'Heroes', tags: ['about'], body: { value: sections[0] } }),
      snip: await make({ kind: 'snippet', name: 'Free call line', folder: 'Lines', body: { doc: { type: 'doc', content: [para('Book a free 30-minute call with us.')] } } }),
    };
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await signIn(owner);
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('#/library: kind, synced, words and the open item are in the URL; reload and Back keep them', async () => {
    await open(`#/library`);
    await page.locator('.ms-lib__name', { hasText: 'Talk to us' }).waitFor();
    assert.equal(await page.getByRole('searchbox').getAttribute('placeholder'), 'Search the Library');
    await shots('screen', { tall: 1000 });
    // Synced: a toggle chip with its count
    const syncedChip = page.locator('.ms-lib__syncedchip');
    assert.equal((await syncedChip.textContent()).trim(), 'Synced (1)');
    await syncedChip.click();
    await page.waitForURL(/synced=1/);
    await page.locator('.ms-lib__syncedchip[aria-pressed="true"]').waitFor();
    await page.locator('.ms-lib__name', { hasText: 'Our story hero' }).waitFor({ state: 'detached' });
    assert.deepEqual(await page.locator('.ms-lib__name').allTextContents(), ['Talk to us']);
    await syncedChip.click();
    await page.waitForURL((u) => !u.hash.includes('synced='));
    await page.locator('.ms-lib__syncedchip[aria-pressed="false"]').waitFor();
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Sections/ }).click();
    await page.waitForURL(/kind=section/);
    // the bar is drawn again when the sections arrive; type into that one
    await page.getByRole('group', { name: 'Show' }).locator('button[aria-pressed="true"]', { hasText: /^Sections/ }).waitFor();
    await page.getByRole('searchbox').fill('story');
    await page.waitForURL(/q=story/);
    await page.locator('.ms-lib__name', { hasText: 'Talk to us' }).waitFor({ state: 'detached' });
    assert.deepEqual(await page.locator('.ms-lib__name').allTextContents(), ['Our story hero']);
    await page.locator('.ms-lib__name', { hasText: 'Our story hero' }).click();
    await page.waitForURL(new RegExp(`open=${items.hero.id}`));
    const url = hash();
    assert.match(url, /^#\/library\?/);
    for (const p of ['kind=section', 'q=story', `open=${items.hero.id}`]) assert.ok(url.includes(p), `${p} in ${url}`);
    await page.reload();
    await page.getByRole('complementary', { name: 'Library item' }).getByText('Our story hero').first().waitFor();
    assert.equal(await page.getByRole('searchbox').inputValue(), 'story');
    await page.goBack();
    await page.waitForURL((u) => !u.hash.includes('open='));
    assert.ok(hash().includes('q=story'));
  });

  test('a pack: two items exported, one deleted, the file imported back gives it again byte for byte; a WordPress file goes into "Imported"', async () => {
    const before = itemFile(items.hero.id);
    await open(`#/library`);
    // a tick puts the item in the URL (pick=) and the list is drawn again
    await page.getByLabel('Pick “Our story hero” to export').click();
    await page.waitForURL(new RegExp(`pick=${items.hero.id}`));
    await page.getByLabel('Pick “Talk to us” to export').click();
    await page.waitForURL(/pick=[^&]+%2C|pick=[^&]+,/);
    const exp = page.getByRole('link', { name: 'Export pack (2)…' });
    const [dl] = await Promise.all([page.waitForEvent('download'), exp.click()]);
    const file = path.join(fx.run, 'library-pack.json');
    await dl.saveAs(file);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(pack.format, 'markstage-pack');
    assert.deepEqual(pack.items.map((i) => i.path).sort(), [`section/${items.cta.id}.json`, `section/${items.hero.id}.json`].sort());
    // the hero is deleted (it is used nowhere), then the pack brings it back; the synced CTA is already here
    assert.equal((await ed.del(`/library/${items.hero.id}`)).status, 200);
    await open(`#/library?import=1&step=file`);
    await page.getByLabel('The file to import').setInputFiles(file);
    await page.getByText('library-pack.json: 2 items.').waitFor();
    assert.equal(await page.getByLabel('When an item is already here').inputValue(), 'skip');
    await shots('import-pack');
    await page.getByRole('button', { name: 'Import 2 items' }).click();
    await page.getByText('Imported 1 item; 1 item already here, kept as they are.').first().waitFor();
    assert.deepEqual(itemFile(items.hero.id), before, 'the same bytes as before the export');
    // a WordPress export: its reusable block lands in "Imported", and Show them filters the list to it
    const xml = path.join(fx.run, 'old-site.xml');
    fs.writeFileSync(xml, wxr([{ id: 7, title: 'Opening hours', html: '<!-- wp:paragraph --><p>Open Monday to Friday, 9 to 5.</p><!-- /wp:paragraph -->' }]));
    await open(`#/library?import=1&step=file`);
    await page.getByLabel('The file to import').setInputFiles(xml);
    await page.getByText('old-site.xml: 1 item.').waitFor();
    await page.getByRole('button', { name: 'Import 1 item' }).click();
    await page.getByRole('button', { name: 'Show them' }).click();
    await page.waitForURL(/folder=Imported/);
    assert.ok(!hash().includes('import='));
    await page.locator('.ms-lib__name', { hasText: 'Opening hours' }).waitFor();
    assert.deepEqual(await page.locator('.ms-lib__group').evaluateAll((g) => g.map((x) => x.getAttribute('aria-label'))), ['Imported']);
  });

  test('the canvas panel: an item dragged onto the article, one ⌘Z takes it back; Enter puts one after the caret’s block', async () => {
    await open(`#/e/posts/hello-world?side=library&lk=snippet`);
    const item = page.locator('.ms-libpanel__item', { hasText: 'Free call line' });
    await item.waitFor();
    const sheet = page.locator('.ms-sheet .ProseMirror');
    const first = sheet.locator('> p', { hasText: 'First paragraph.' });
    await first.waitFor();
    const count = () => sheet.getByText('Book a free 30-minute call with us.').count();
    assert.equal(await count(), 0);
    const box = await first.boundingBox();
    await item.dragTo(sheet, { targetPosition: { x: 40, y: box.y - (await sheet.boundingBox()).y + box.height - 2 } });
    await sheet.getByText('Book a free 30-minute call with us.').waitFor();
    assert.equal(await count(), 1);
    await shots('canvas-panel');
    await sheet.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(() => !document.querySelector('.ms-sheet .ProseMirror')?.textContent?.includes('Book a free 30-minute call'));
    // the keyboard: the caret in the first paragraph, then Enter on the item puts it right after that paragraph
    await first.click();
    // the editor takes the caret from the browser's selectionchange: let it, before the focus moves to the panel
    await page.waitForFunction(() => document.querySelector('.ms-sheet .ProseMirror')?.editor?.state.selection.$from.parent.textContent === 'First paragraph.');
    await item.focus();
    await page.keyboard.press('Enter');
    await sheet.getByText('Book a free 30-minute call with us.').waitFor();
    assert.equal(await first.evaluate((p) => p.nextElementSibling?.textContent), 'Book a free 30-minute call with us.');
    assert.ok(hash().includes('side=library') && hash().includes('lk=snippet'), hash());
    await page.keyboard.press('ControlOrMeta+z');
  });

  test('pages: a synced section from the outline’s picker (keyboard, then a drag and ⌘Z), changed on one page and applied to both', async () => {
    const n = pageData('team').sections.length;
    // team: the picker at the end (add= in the URL), its "From the Library" group, Enter on the synced CTA
    await open(`#/p/pages/team?add=${n}`);
    const group = page.getByRole('group', { name: 'From the Library' });
    await group.waitFor();
    assert.deepEqual(await group.locator('.msp-picker__name').allTextContents(), ['Talk to usSynced', 'Our story hero']);
    await group.locator(`[data-lib="${items.cta.id}"]`).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`sec=${n}`));
    assert.ok(!hash().includes('add='));
    await page.locator('.msp-sec[data-index="' + n + '"] .msp-sec__synced').waitFor();
    await page.locator('.msp-synced', { hasText: 'Synced from the Library: “Talk to us”' }).waitFor();
    await saved();
    const team = pageData('team').sections[n];
    assert.deepEqual(team._synced, { id: items.cta.id, version: items.cta.syncVersion }, 'the marker, with the version the server writes');
    // about-us: drag it into the list above the second section (it is saved at once); ⌘Z and a save take it back
    // out of the file; then again
    await open(`#/p/pages/about-us?add=4`);
    const drag = page.getByRole('group', { name: 'From the Library' }).locator(`[data-lib="${items.cta.id}"]`);
    const row1 = page.locator('.msp-sec[data-index="1"]');
    await drag.dragTo(row1, { targetPosition: { x: 40, y: 3 } });
    await page.waitForURL(/sec=1/);
    assert.ok(await page.locator('.msp-sec[data-index="1"] .msp-sec__synced').isVisible());
    await page.getByText('Added “Talk to us” (synced) after 1. Hero: Our Story.').waitFor();
    assert.equal(pageData('about-us').sections[1]._synced.id, items.cta.id);
    await page.locator('.msp-outline').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(() => !document.querySelector('.msp-sec[data-index="1"] .msp-sec__synced'));
    await saved();
    assert.equal(pageData('about-us').sections.length, 4);
    await open(`#/p/pages/about-us?add=4`);
    await page.getByRole('group', { name: 'From the Library' }).locator(`[data-lib="${items.cta.id}"]`).dragTo(page.locator('.msp-sec[data-index="1"]'), { targetPosition: { x: 40, y: 3 } });
    await page.waitForURL(/sec=1/);
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    assert.equal(pageData('about-us').sections[1]._synced.id, items.cta.id);
    assert.deepEqual((await ed.get(`/library/${items.cta.id}/impact`)).json.pages.map((p) => p.id).sort(), ['about-us', 'team'], 'the pages with a marked copy');
    // a change in the panel: the note says so and offers Apply to every page
    const heading = page.locator('[data-path="sections.1.value.heading"] input, [data-path="sections.1.value.heading"] textarea').first();
    await heading.fill('Ready when you are');
    const note = page.locator('.msp-synced.is-changed');
    await note.waitFor();
    await shots('page-synced-changed');
    await note.getByRole('button', { name: 'Apply to 2 pages' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
    await page.getByText(/^Changed “Talk to us” on 2 pages\./).waitFor();
    assert.equal(pageData('about-us').sections[1].value.heading, 'Ready when you are');
    assert.equal(pageData('team').sections[n].value.heading, 'Ready when you are');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Library: change the section “Talk to us” on 2 pages');
    await page.locator('.msp-synced:not(.is-changed)').waitFor();
  });

  test('pages: a save that changes a copy in place is refused in words; Detach and save keeps it as the page’s own; a locked item’s copy says Locked', async () => {
    const n = pageData('team').sections.length - 1;
    await open(`#/p/pages/team?sec=${n}`);
    const heading = page.locator(`[data-path="sections.${n}.value.heading"] input, [data-path="sections.${n}.value.heading"] textarea`).first();
    await heading.fill('Only on the team page');
    await page.keyboard.press('ControlOrMeta+s');
    const banner = page.locator('.ms-banner', { hasText: '“Talk to us” is synced from the Library' });
    await banner.waitFor();
    assert.equal(pageData('team').sections[n].value.heading, 'Ready when you are', 'nothing written');
    await shots('page-synced-refused');
    await banner.getByRole('button', { name: 'Detach and save' }).click();
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    const team = pageData('team').sections[n];
    assert.equal(team._synced, undefined);
    assert.equal(team.value.heading, 'Only on the team page');
    assert.equal(await page.locator(`.msp-sec[data-index="${n}"] .msp-sec__synced`).count(), 0);
    // the item locked: the server writes its locks on the copy that still follows it, and its row says Locked
    const it = (await ed.get(`/library/${items.cta.id}`)).json;
    assert.equal((await ed.patch(`/library/${items.cta.id}`, { locks: { remove: true }, version: it.version })).status, 200);
    // where the site keeps a section's lock: in its value (_synced stays on the section)
    assert.deepEqual(pageData('about-us').sections[1].value._lock, { remove: true });
    assert.equal(pageData('about-us').sections[1]._lock, undefined);
    await open('#/p/pages/about-us?sec=1');
    await page.locator('.msp-sec[data-index="1"] .ms-padlock.is-locked').waitFor();
    await page.locator('.msp-synced:not(.is-changed)', { hasText: 'Synced from the Library: “Talk to us”, on 1 page.' }).waitFor();
    await shots('page-synced-locked');
  });
});
