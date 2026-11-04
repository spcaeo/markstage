// Page frames and types (docs/API-PAGE-TYPES.md) in a real browser at 1440, against a real server whose site has the
// three frames and four page types (a money page with a locked booking section and its checks, a pillar, a plain
// page, an article that links to its hub and to a money page): the Page box at the top of Post settings (the type,
// the frame "as its collection" or its own, what the type still needs, Check again) and its frame saved with ⌘S;
// an author sees the type but may not change it; the New sheet's type cards, in the URL, a new post of the type;
// a JSON page's Page box above its sections, the type's lock on its booking section, another type chosen; and the
// publish sheet's row for the type's checks. Light and dark. The browser opened here is closed in `after`.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: MARKSTAGE_E2E_PORT_BASE (default 18231, odd) +1 the server, +3 its preview; its dev servers take DEV_PORTS.
// Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { framesConfigOf, pageTypesClientConfig, pageTypesConfigOf } from '@markstage/core/page-types';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { DEV_PORTS, PAGE_TYPES_PORTS, SHOTS, pw, skip, blank } from './support.mjs';

const [PORT, PREVIEW_PORT] = PAGE_TYPES_PORTS;
const BASE = `http://127.0.0.1:${PORT}`;
const COLLECTIONS = [
  { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/', frame: 'reading', settings: [{ type: 'textarea', key: 'excerpt', label: 'Excerpt' }] },
  { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' }, frame: 'full' },
];
const TYPES = {
  types: [
    {
      id: 'money',
      label: 'Money page',
      description: 'Sells one service: a booking button, questions and answers, Service structured data.',
      collections: ['pages'],
      frame: 'full',
      template: 'lib_money-page',
      locks: { pages: { booking: ['remove'] } },
      checks: [
        { id: 'booking', label: 'A booking button', section: 'booking', level: 'block' },
        { id: 'faq', label: 'Questions and answers', section: 'faq' },
        { id: 'service', label: 'Service structured data', jsonld: 'Service' },
      ],
    },
    { id: 'pillar', label: 'Pillar page', description: 'The hub of a topic: links down to its articles.', collections: ['pages'], frame: 'reading' },
    { id: 'plain', label: 'Plain page', description: 'Legal and thank-you pages.', collections: ['pages'], frame: 'plain' },
    {
      id: 'article',
      label: 'Article',
      description: 'Teaches one thing: links up to its hub and on to a money page.',
      collections: ['posts'],
      checks: [
        { id: 'hub', label: 'Links to its hub', linksTo: { pageType: 'pillar', sameField: 'cluster' } },
        { id: 'money', label: 'Links to a money page', linksTo: { pageType: 'money' } },
      ],
    },
  ],
};
const SITE_CONFIG = `export default ${JSON.stringify({ siteUrl: 'https://example.com', frames: true, collections: COLLECTIONS, pageTypes: TYPES }, null, 2)};\n`;
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const TEMPLATE = { id: 'lib_money-page', name: 'Money page', description: 'Hero, booking, questions', collection: 'pages', body: { data: { title: 'A service', sections: [{ discriminant: 'hero', value: { heading: 'A service' } }, { discriminant: 'booking', value: { label: 'Book a call' } }, { discriminant: 'faq', value: { heading: 'Questions' } }] } } };

// stands in for `astro dev`: a page's sections, each heading marked as the astro integration marks it
const FAKE_DEV = `import fs from 'node:fs';
import http from 'node:http';
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  for (const f of fs.readdirSync('src/content/pages')) {
    const d = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
    if (d.uri !== url) continue;
    const body = (d.sections ?? []).map((s, i) => '<section data-ms-section="' + i + '" style="min-height:200px;padding:48px 64px;border-bottom:1px solid #ddd"><h2 data-ms-field="sections.' + i + '.value.heading" data-ms-kind="text" style="margin:0">' + esc(s.value?.heading ?? s.discriminant) + '</h2></section>');
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><html><head><title>' + esc(d.title) + '</title></head><body style="margin:0;font:17px/1.55 system-ui">' + body.join('') + '</body></html>');
  }
  res.writeHead(404).end('not found');
}).listen(Number(process.argv[2]), '127.0.0.1');
`;

describe('page frames and types in a browser', { skip, timeout: 240_000 }, () => {
  let fx, app, browser, ctx, page, owner, alice;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const box = () => page.locator('.ms-pagebox');
  const status = (s) => page.locator(`.ms-status[data-status="${s}"]`);
  const shots = async (name) => {
    if (!SHOTS) return;
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `page-types-${name}-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const open = async (where) => {
    await blank(page);
    await page.goto(`${BASE}/markstage/${where}`);
  };
  async function signIn(who, to) {
    await page.context().clearCookies();
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }
  /** The checks the box shows: [label, 'is-ok' | 'is-warn' | 'is-block']. */
  const checks = () => box().locator('.ms-pagebox__check').evaluateAll((els) => els.map((e) => [e.querySelector('.ms-pagebox__label').textContent, [...e.classList].find((c) => c.startsWith('is-'))]));

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/typed.md'), "---\ntitle: Moving guide\nauthor: alice\npageType: article\ncluster: basics\ndate: '2026-03-01T10:00:00.000Z'\ndraft: true\n---\n\nStart with [the basics](/basics/).\n");
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/services.json'), json({ title: 'Services', uri: '/services/', pageType: 'money', sections: [{ discriminant: 'hero', value: { heading: 'We move offices' } }, { discriminant: 'booking', value: { heading: 'Book a call' } }] }));
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/basics.json'), json({ title: 'Basics', uri: '/basics/', pageType: 'pillar', cluster: 'basics', sections: [{ discriminant: 'hero', value: { heading: 'The basics' } }] }));
    fs.mkdirSync(path.join(fx.site, 'markstage/library/template'), { recursive: true });
    fs.writeFileSync(path.join(fx.site, 'markstage/library/template/lib_money-page.json'), json(TEMPLATE));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Typed pages');
    // the editor's config as the site's build gives it (core's client config of the same frames and types)
    const fail = (m) => {
      throw new Error(m);
    };
    const frames = framesConfigOf(true, COLLECTIONS, fail);
    const cc = pageTypesClientConfig({ frames, pageTypes: pageTypesConfigOf(TYPES, { collections: COLLECTIONS, frames, fail }) });
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      siteUrl: 'https://example.com',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title', settings: COLLECTIONS[0].settings },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true, addressKey: 'uri' },
      ],
      ...cc,
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    fs.copyFileSync(new URL('../../editor/dist/preview-agent.js', import.meta.url), path.join(editorDir, 'preview-agent.js'));
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    const config = loadConfig({
      env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' },
      overrides: { port: PORT, editorDir, collections: [], preview: { origin: `http://127.0.0.1:${PREVIEW_PORT}`, port: PREVIEW_PORT, ports: DEV_PORTS, command: [process.execPath, fake, '{port}'], settleFile: null, settleMs: 50 } },
    });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', authorSlug: 'olive', password: pass() });
    alice = await addUser(app, { email: 'alice@example.test', name: 'Alice Example', role: 'author', authorSlug: 'alice', password: pass() });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await signIn(owner, '#/e/posts/typed');
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('an article: the Page box in Post settings, what its type needs, its frame chosen and saved', async () => {
    await open('#/e/posts/typed?s=1');
    await box().waitFor();
    assert.equal(await box().getByLabel('Page type').inputValue(), 'article');
    assert.equal(await box().getByRole('radio', { name: 'As its collection (Reading)' }).isChecked(), true);
    await box().locator('.ms-pagebox__check').first().waitFor();
    assert.deepEqual(await checks(), [['Links to its hub', 'is-ok'], ['Links to a money page', 'is-warn']]);
    assert.match(await box().locator('.ms-pagebox__check.is-warn').innerText(), /Link to a money page from the text\./);
    await shots('post');
    await box().getByRole('radio', { name: 'Plain' }).check();
    assert.match(await box().locator('.ms-pagebox__frames').innerText(), /the text alone/);
    await page.keyboard.press('ControlOrMeta+s');
    await status('saved').waitFor();
    assert.match(read('src/content/blog/typed.md'), /\nframe: plain\n/);
    // the link to a money page added in the file, then checked again
    const t = read('src/content/blog/typed.md').replace('Start with [the basics](/basics/).', 'Start with [the basics](/basics/), then [hire us](/services/).');
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/typed.md'), t);
    fx.git('commit', '-q', '-am', 'A link to the service');
    await open('#/e/posts/typed?s=1');
    await box().locator('.ms-pagebox__check').first().waitFor();
    await box().getByRole('button', { name: 'Check again' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.ms-pagebox__check.is-ok').length === 2);
  });

  test('a page type chosen on the New sheet is in the URL and in the new post', async () => {
    await open('#/new/posts');
    await page.locator('.ms-new__type', { hasText: 'Article' }).click();
    await page.waitForFunction(() => location.hash === '#/new/posts?type=article');
    assert.equal(await page.locator('.ms-new__type.is-on strong').textContent(), 'Article');
    await page.reload();
    await page.locator('.ms-new__type.is-on', { hasText: 'Article' }).waitFor();
    await shots('new');
    await page.getByLabel('Title').fill('Packing a server room');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/e/posts/packing-a-server-room'));
    assert.match(read('src/content/blog/packing-a-server-room.md'), /\npageType: article\n/);
  });

  test('a JSON page: the Page box above its sections, its type’s lock on the booking section, another type', async () => {
    await open('#/p/pages/services');
    await box().waitFor();
    assert.equal(await box().getByLabel('Page type').inputValue(), 'money');
    assert.equal(await box().getByRole('radio', { name: 'As its type (Full width)' }).isChecked(), true);
    await box().locator('.ms-pagebox__check').first().waitFor();
    assert.deepEqual(await checks(), [['A booking button', 'is-ok'], ['Questions and answers', 'is-warn'], ['Service structured data', 'is-warn']]);
    // the booking section is locked by the type: Delete greyed in its menu
    const booking = page.locator('.msp-outline .ms-order__row').nth(1);
    await booking.locator('.ms-padlock.is-locked').waitFor();
    await booking.locator('.ms-order__grip').click();
    const menu = page.getByRole('menu').last();
    await menu.waitFor();
    assert.equal(await menu.getByRole('menuitem', { name: 'Delete' }).getAttribute('aria-disabled'), 'true');
    await page.keyboard.press('Escape');
    await shots('page');
    // a pillar page has no such lock: the money page's holds until the new type is saved (as on the server)
    await box().getByLabel('Page type').selectOption('pillar');
    assert.equal(await box().getByRole('radio', { name: 'As its type (Reading)' }).isChecked(), true);
    assert.equal(await booking.locator('.ms-padlock.is-locked').count(), 1);
    await page.keyboard.press('ControlOrMeta+s');
    await status('saved').waitFor();
    assert.equal(JSON.parse(read('src/content/pages/services.json')).pageType, 'pillar');
    await page.waitForFunction(() => !document.querySelectorAll('.msp-outline .ms-order__row')[1]?.querySelector('.ms-padlock.is-locked'));
    // back to a money page for the publish sheet
    await box().getByLabel('Page type').selectOption('money');
    await page.keyboard.press('ControlOrMeta+s');
    await status('saved').waitFor();
    assert.equal(JSON.parse(read('src/content/pages/services.json')).pageType, 'money');
  });

  test('the publish sheet: the type’s checks in one row', async () => {
    await open('#/publish/pages/services');
    const row = page.locator('.ms-adm-pf', { hasText: 'Money page' });
    await row.waitFor();
    assert.match(await row.innerText(), /2 of 3 to add/);
    assert.match(await row.innerText(), /Questions and answers: Add a “faq” section: this page has none\./);
    await shots('publish');
  });

  test('an author sees the type but may not change it', async () => {
    await signIn(alice, '#/e/posts/typed');
    await open('#/e/posts/typed?s=1');
    await box().waitFor();
    assert.equal(await box().getByLabel('Page type').isDisabled(), true);
    assert.match(await box().innerText(), /Only an owner, administrator or editor can change what type of page this is\./);
  });
});
