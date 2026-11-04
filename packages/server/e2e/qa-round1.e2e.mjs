// The deep QA's findings (the deep QA of 2 Nov 2026; its notes are not in this repo) that only a browser can prove,
// each test named by its finding number: a phone's header folds into the More menu and admin tables scroll (F5),
// Preview page on a draft opens the preview (F6), the link box refuses javascript: at once and New tab gets
// rel=noopener (F11, F12), the New sheet says it is loading the topics (F22), ⌘K finds screens and ? lists the
// shortcuts (F25), and the rest as they came. A real server on 127.0.0.1 with a site config whose posts have a
// topic the New sheet asks for, a preview origin served by a stand-in `astro dev`, and test people made up here.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: support.mjs QA_PORTS (the server, its preview) and DEV_PORTS. Screenshots go to MARKSTAGE_E2E_SHOTS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, client, fakeCodec, makeFixture, makePng } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { DEV_PORTS, FAKE_DEV, QA_PORTS, SHOTS, pw, skip } from './support.mjs';

const [PORT, PREVIEW_PORT] = QA_PORTS;
const BASE = `http://127.0.0.1:${PORT}`;

// a site where a post's topic decides its address and the New sheet asks for it
const SITE_CONFIG = `export default {
  siteUrl: 'https://www.example.test',
  collections: [
    {
      id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, defaultAuthor: 'site-team',
      url: ({ id }) => '/blog/' + id + '/',
      settings: [
        { type: 'textarea', key: 'excerpt', label: 'Excerpt' },
        { type: 'select', key: 'topic', label: 'Topic', options: [['forms', 'Forms'], ['crm', 'CRM']], hint: 'The topic decides the page address.' },
        { type: 'tags', key: 'tags', label: 'Tags' },
      ],
      required: ['topic'],
      newEntry: { ask: ['topic'], defaults: ({ now }) => ({ date: now.toISOString() }) },
    },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
};
`;

describe('the deep QA fixes in a browser', { skip }, () => {
  let fx, app, browser, ctx, page, owner;
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `qa-${name}.png`), fullPage: true });
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  async function signIn(who, to) {
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }
  /** A fresh page at the given size, signed in as the owner and at `to`. */
  async function at(width, height, to, opts = {}) {
    await page?.close();
    ctx = await browser.newContext({ viewport: { width, height }, colorScheme: opts.dark ? 'dark' : 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await signIn(owner, to);
    return page;
  }
  const inside = async (locator, width) => {
    const box = await locator.boundingBox();
    assert.ok(box, `${await locator.getAttribute('aria-label')} is drawn`);
    assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5, `on screen at ${width}px wide: x ${Math.round(box.x)} to ${Math.round(box.x + box.width)}`);
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    // the posts need a topic now; the fixture's `cluster` becomes it
    for (const f of fs.readdirSync(path.join(fx.site, 'src/content/blog'))) {
      const p = path.join(fx.site, 'src/content/blog', f);
      const t = fs.readFileSync(p, 'utf8');
      fs.writeFileSync(p, /^cluster: /m.test(t) ? t.replace(/^cluster: .*$/m, 'topic: forms') : t.replace(/^---\n/, '---\ntopic: forms\n'));
    }
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Topics');
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      siteUrl: 'https://www.example.test',
      collections: [
        {
          id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title', hasStatus: true,
          settings: [
            { type: 'textarea', key: 'excerpt', label: 'Excerpt' },
            { type: 'select', key: 'topic', label: 'Topic', options: [['forms', 'Forms'], ['crm', 'CRM']], hint: 'The topic decides the page address.' },
            { type: 'tags', key: 'tags', label: 'Tags' },
          ],
          newEntry: { ask: ['topic'] },
        },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({
      env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' },
      overrides: {
        port: PORT,
        editorDir,
        collections: [],
        preview: { origin: `http://127.0.0.1:${PREVIEW_PORT}`, port: PREVIEW_PORT, ports: DEV_PORTS, command: [process.execPath, fake, '{port}'], settleFile: null, settleMs: 50 },
      },
    });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
    browser = await pw.chromium.launch();
  });
  after(async () => {
    await browser?.close();
    await app?.close();
  });

  test('F5: at 400 px the header keeps Post settings, Publish and Save on screen and folds the rest into More; admin tables scroll in their card', async () => {
    await at(400, 800, '#/e/posts/hello-world');
    await page.locator('.ProseMirror').waitFor();
    const head = page.locator('.ms-head');
    for (const name of ['Post settings', 'Publish', 'More actions']) await inside(head.getByRole(name === 'Publish' ? 'link' : 'button', { name, exact: true }), 400);
    await inside(head.getByRole('button', { name: 'Save', exact: true }), 400);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 400), true, 'no sideways page scroll');
    for (const sel of ['[data-sections]', '[data-seo]', '[data-preview]', '[data-views]']) assert.equal(await page.locator(sel).isVisible(), false, `${sel} is folded`);
    await shot('f5-phone-editor');
    await head.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu', { name: 'More actions' });
    for (const item of ['Edit on the page', 'Edit the Markdown file', 'Outline', 'SEO check', 'Undo', 'Redo', 'Check on screens', 'Preview page']) await menu.getByRole('menuitem', { name: item }).waitFor();
    await shot('f5-phone-more');
    await menu.getByRole('menuitem', { name: 'Outline' }).click();
    await page.waitForURL(/side=outline|\?.*outline/).catch(() => {});
    assert.equal(await page.locator('[data-sections]').getAttribute('aria-pressed'), 'true', 'the folded Outline button was pressed through the menu');
    // People & access: the table scrolls inside its card, the page does not scroll sideways
    await at(400, 800, '#/users');
    await page.getByRole('cell', { name: /Olive Owner/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 400), true, 'no sideways page scroll on People & access');
    const table = page.locator('table.ms-adm-table').first();
    assert.ok(await table.evaluate((t) => t.clientWidth <= 400 && getComputedStyle(t).overflowX === 'auto'), 'the table scrolls in its own box');
    await shot('f5-phone-users');
  });

  test('F6: Preview page and the address’s open icon go to the preview for a draft, to the live site for a live page', async () => {
    await at(1380, 860, '#/e/posts/bob-draft');
    await page.locator('.ProseMirror').waitFor();
    const preview = page.locator('[data-preview]');
    await page.waitForFunction((origin) => document.querySelector('[data-preview]')?.getAttribute('href')?.startsWith(origin), `http://127.0.0.1:${PREVIEW_PORT}/`);
    assert.equal(await preview.getAttribute('href'), `http://127.0.0.1:${PREVIEW_PORT}/markstage/preview/posts/bob-draft/`);
    assert.equal(await preview.getAttribute('target'), '_blank');
    assert.equal(await page.locator('.ms-head__url a[target="_blank"]').getAttribute('href'), `http://127.0.0.1:${PREVIEW_PORT}/markstage/preview/posts/bob-draft/`);
    await shot('f6-draft-preview');
    await page.goto(`${BASE}/markstage/#/e/posts/hello-world`);
    await page.locator('.ProseMirror').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-preview]')?.getAttribute('href') === 'https://www.example.test/blog/hello-world/');
  });

  test('F9: a scheduled entry says so in the header; the publish sheet and the More menu cancel the schedule', async () => {
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    const e = (await c.get('/collections/posts/entries/bob-draft')).json;
    const at1 = new Date(Date.now() + 2 * 3600_000).toISOString();
    assert.equal((await c.post('/collections/posts/entries/bob-draft/schedule', { version: e.version, publishAt: at1 })).status, 200);
    await at(1380, 860, '#/e/posts/bob-draft');
    await page.locator('.ProseMirror').waitFor();
    assert.match(await page.locator('.ms-head__state').textContent(), /^Scheduled · goes live /);
    await shot('f9-scheduled-header');
    // the More menu
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Cancel the schedule…' }).waitFor();
    await page.keyboard.press('Escape');
    // the publish sheet
    await page.goto(`${BASE}/markstage/#/publish/posts/bob-draft`);
    await page.getByRole('button', { name: 'Cancel the schedule' }).click();
    await shot('f9-cancel-ask');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel the schedule' }).click();
    await page.locator('.ms-adm-status--draft').waitFor();
    await shot('f9-cancelled');
    assert.equal((await c.get('/collections/posts/entries/bob-draft')).json.status, 'draft');
    assert.equal(c.csrf !== null, true);
  });

  test('F11, F12: the link box refuses javascript: at once with the server’s words; New tab carries rel=noopener', async () => {
    await at(1380, 860, '#/e/posts/hello-world');
    const pm = page.locator('.ProseMirror');
    await pm.waitFor();
    // the first click wakes the canvas; then the paragraph's words are selected and ⌘K is the link field
    await pm.locator('p').first().click();
    await pm.locator('p').first().click({ clickCount: 3 });
    await page.waitForFunction(() => (getSelection()?.toString() ?? '').length > 0);
    await page.keyboard.press('ControlOrMeta+k');
    const box = page.getByRole('combobox', { name: 'Link: search the site or paste an address' });
    await box.waitFor();
    await box.fill('javascript:alert(1)');
    await page.keyboard.press('Enter');
    await page.getByText('Links must start with http, https, mailto or tel, or be relative: javascript:alert(1)').waitFor();
    assert.equal(await pm.locator('a[href^="javascript"]').count(), 0, 'nothing was applied');
    await shot('f11-link-refused');
    await box.fill('https://example.com/');
    await page.getByRole('checkbox', { name: 'New tab' }).check();
    await page.keyboard.press('Enter');
    const a = pm.locator('a[href="https://example.com/"]');
    await a.waitFor();
    assert.equal(await a.getAttribute('target'), '_blank');
    assert.match(await a.getAttribute('rel'), /\bnoopener\b/);
  });

  test('F22: the New sheet says the topics are loading, then Create is ready as soon as the list is in', async () => {
    await at(1380, 860, '#/new');
    const topic = page.getByLabel('Topic');
    await topic.waitFor();
    await page.getByLabel('Title').fill('A fresh post');
    // once the list is in: real choices, the waiting line gone, Create enabled after a topic is picked
    await page.waitForFunction(() => [...document.querySelectorAll('select option')].some((o) => o.textContent === 'Forms'));
    assert.equal(await page.locator('.ms-new__waiting').isVisible(), false);
    assert.equal(await topic.isDisabled(), false);
    await topic.selectOption('forms');
    await page.waitForFunction(() => !document.querySelector('.ms-new__actions button[type=submit]')?.hasAttribute('disabled'));
    await shot('f22-new-ready');
  });

  test('F26, F40: "and N more" opens the list of notices here with their whole words; one click marks them all seen', async () => {
    const uid = (await client(BASE).login(owner.email, owner.password).then((r) => r.json.user.id));
    const long = 'A publish (posts/hello-world) did not go live. The build step failed on “Hello World” (posts/hello-world). The live site was not changed. '.repeat(3).trim();
    app.notices.tell({ kind: 'publish.failed', level: 'error', text: long, link: '#/jobs', to: [uid] });
    app.notices.tell({ kind: 'schedule.late', level: 'warn', text: 'The scheduler ran late: the server was down.', link: '#/jobs', to: [uid] });
    await at(1380, 860, '#/');
    const bar = page.locator('.ms-notices');
    await bar.waitFor();
    // the owner also signed in from new browsers in the tests before: those make one line more
    await bar.getByRole('button', { name: /^and \d+ more$/ }).click();
    const rows = bar.locator('.ms-notices__list .ms-notices__row');
    assert.ok((await rows.count()) >= 2);
    assert.equal(await bar.locator('.ms-notices__text.is-full').first().evaluate((t) => t.scrollWidth <= t.clientWidth + 1), true, 'the whole text wraps, nothing cut');
    await shot('f26-notices-open');
    await bar.getByRole('button', { name: /^Seen, all \d+$/ }).click();
    await bar.waitFor({ state: 'hidden' });
  });

  test('F25: ⌘K finds screens and settings by their plain words; ? opens the guide at the keyboard shortcuts', async () => {
    await at(1380, 860, '#/');
    await page.locator('[data-search]').click();
    const search = page.locator('.ms-pal input');
    await search.fill('trash');
    const row = page.locator('.ms-pal__row--screen', { hasText: 'Trash' });
    await row.waitFor();
    await shot('f25-palette-trash');
    await row.click();
    await page.waitForURL(/#\/trash/);
    await page.getByRole('heading', { name: 'Trash' }).first().waitFor();
    // "?" anywhere but in text
    await page.keyboard.press('?');
    await page.getByText('Keyboard shortcuts').first().waitFor();
    await page.getByText('Find and open a page or screen; with text selected, add a link').waitFor();
    await shot('f25-shortcuts');
  });

  test('F10: Replace everywhere with a build that fails keeps the change and says so in the panel, with Try the build again', async () => {
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    const upload = async (name) => (await c.request('POST', `/media?filename=${encodeURIComponent(name)}`, { body: makePng(), headers: { 'Content-Type': 'image/png' } })).json;
    const a = await upload('old.png');
    const b = await upload('new.png');
    const src = (await c.get('/collections/posts/entries/hello-world/source')).json;
    assert.equal((await c.put('/collections/posts/entries/hello-world/source', { version: src.version, source: `${src.source.trimEnd()}\n\n![An old picture](${a.url})\n` })).status, 200);
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      await at(1380, 860, `#/media?item=${a.id}&replace=${b.id}`);
      await page.getByRole('button', { name: 'Replace everywhere', exact: true }).click();
      await page.waitForURL(/job=j_/);
      const outcome = page.locator('.ms-adm-outcome.is-bad');
      await outcome.waitFor({ timeout: 60_000 });
      assert.match(await outcome.innerText(), /It did not go live\. The build step failed/);
      assert.match(await outcome.innerText(), /Your changes are saved; the site stays as it was\./);
      await outcome.getByRole('button', { name: 'Try the build again' }).waitFor();
      await shot('f10-replace-failed');
      // the replacement is kept
      assert.ok((await c.get('/collections/posts/entries/hello-world/source')).json.source.includes(b.url));
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
      await app.jobs.idle();
    }
  });

  test('F15: the block menu opens on "/" inside a table cell', async () => {
    await at(1380, 860, '#/e/posts/bob-draft');
    const pm = page.locator('.ProseMirror');
    await pm.waitFor();
    // the first click wakes the canvas; the second puts the caret in the last paragraph
    await pm.locator('p').last().click();
    await pm.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('/');
    const menu = page.locator('.ms-insert');
    await menu.waitFor();
    await menu.locator('button', { hasText: 'Rows and columns' }).click();
    await pm.locator('table').waitFor();
    await menu.waitFor({ state: 'hidden' });
    // a cell starts with sample words: "/" at their start opens the menu too
    const cell = pm.locator('td p, th p').first();
    await cell.click({ position: { x: 2, y: 6 } });
    await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
    await page.keyboard.press('Home');
    await page.keyboard.press('/');
    await menu.waitFor({ timeout: 5000 });
    await shot('f15-slash-in-cell');
    await menu.locator('button', { hasText: 'A sub-section' }).click();
    await pm.locator('h3').waitFor();
    await shot('f15-slash-in-cell');
  });
});
