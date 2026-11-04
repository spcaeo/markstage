// The second deep QA pass (2 Nov 2026; its notes are not in this repo): what only a browser can
// prove, each test named by its finding. The site here is shaped like a real one: a post's topic is a select whose
// choices come from another collection (`from: 'clusters'`), the topic decides the address, and the New sheet asks
// for it (newEntry.ask) — the shape that made the New sheet blank in pass 2 (N1: draw() called before it existed).
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: support.mjs QA2_PORTS (the server, its preview) and DEV_PORTS. Screenshots go to MARKSTAGE_E2E_SHOTS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, client, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { DEV_PORTS, FAKE_DEV, QA2_PORTS, SHOTS, pw, skip } from './support.mjs';

const [PORT, PREVIEW_PORT] = QA2_PORTS;
const BASE = `http://127.0.0.1:${PORT}`;

// the same settings in the server's config and the editor's build: a topic from the Topics collection decides the
// address; the New sheet asks for it; the schema needs it
const POST_SETTINGS = `[
        { type: 'slug', key: 'slug', label: 'URL slug' },
        { type: 'textarea', key: 'excerpt', label: 'Excerpt', hint: 'Shown on cards and in lists.' },
        { type: 'select', key: 'cluster', label: 'Topic', from: 'clusters', hint: 'The topic decides the page address and the breadcrumb.' },
        { type: 'tags', key: 'tags', label: 'Tags' },
        { type: 'select', key: 'author', label: 'Author', from: 'authors' },
        { type: 'date', key: 'date', label: 'Publish date' },
      ]`;
const SITE_CONFIG = `const SITE = 'https://www.example.test';
export default {
  siteUrl: SITE,
  collections: [
    {
      id: 'posts', label: 'Articles', format: 'md', dir: 'src/content/blog', hasStatus: true, fields: { slug: 'slug' },
      settings: ${POST_SETTINGS},
      url: ({ id, data }) => ({ forms: '/forms/', crm: '/crm/' }[data.cluster] ?? '/blog/') + (data.slug ?? id) + '/',
      required: ['cluster', 'date', 'author'],
      defaultAuthor: 'site-team',
      newEntry: {
        ask: ['cluster'],
        defaults: ({ title, id, values, now }) => {
          const at = now.toISOString();
          const path = ({ forms: '/forms/', crm: '/crm/' }[values.cluster] ?? '/blog/') + id + '/';
          return { date: at, modified: at, seo: { title, canonical: new URL(path, SITE).href } };
        },
      },
    },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasStatus: true, url: '{uri}', fields: { url: 'uri' } },
    { id: 'authors', label: 'Authors', format: 'json', dir: 'src/content/authors', url: '/author/{id}/', fields: { title: 'name' } },
    { id: 'clusters', label: 'Topics', format: 'json', dir: 'src/content/clusters', url: '{path}' },
  ],
  compat: { collection: 'posts' },
};
`;
const EDITOR_COLLECTIONS = [
  {
    id: 'posts', label: 'Articles', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title', hasStatus: true,
    settings: [
      { type: 'slug', key: 'slug', label: 'URL slug' },
      { type: 'textarea', key: 'excerpt', label: 'Excerpt', hint: 'Shown on cards and in lists.' },
      { type: 'select', key: 'cluster', label: 'Topic', from: 'clusters', hint: 'The topic decides the page address and the breadcrumb.' },
      { type: 'tags', key: 'tags', label: 'Tags' },
      { type: 'select', key: 'author', label: 'Author', from: 'authors' },
      { type: 'date', key: 'date', label: 'Publish date' },
    ],
    newEntry: { ask: ['cluster'] },
  },
  { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true, hasStatus: true },
  { id: 'authors', label: 'Authors', format: 'json', dir: 'src/content/authors', hasUrl: true, titleKey: 'name' },
  { id: 'clusters', label: 'Topics', format: 'json', dir: 'src/content/clusters', hasUrl: true, titleKey: 'title' },
];

describe('the second deep QA pass in a browser', { skip }, () => {
  let fx, app, browser, ctx, page, owner;
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `qa2-${name}.png`), fullPage: true });
  async function signIn(who, to) {
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }
  /** A fresh page at the given size, signed in as `who` (the owner) and at `to`. */
  async function at(width, height, to, opts = {}) {
    await page?.close();
    await ctx?.close();
    ctx = await browser.newContext({ viewport: { width, height }, colorScheme: opts.dark ? 'dark' : 'light', hasTouch: width < 500 });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    if (opts.who !== null) await signIn(opts.who ?? owner, to);
    return page;
  }

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    for (const [dir, files] of [
      ['src/content/clusters', { forms: { title: 'Forms', path: '/forms/' }, crm: { title: 'CRM', path: '/crm/' } }],
      ['src/content/authors', { 'site-team': { name: 'The site team' }, alice: { name: 'Alice Author' } }],
    ]) {
      fs.mkdirSync(path.join(fx.site, dir), { recursive: true });
      for (const [id, data] of Object.entries(files)) fs.writeFileSync(path.join(fx.site, dir, `${id}.json`), `${JSON.stringify(data, null, 2)}\n`);
    }
    // the fixture's posts carry `cluster: basics`: a topic of this site instead
    for (const f of fs.readdirSync(path.join(fx.site, 'src/content/blog'))) {
      const p = path.join(fx.site, 'src/content/blog', f);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/^cluster: .*$/m, 'cluster: forms'));
    }
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Topics and authors');
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      siteUrl: 'https://www.example.test',
      collections: EDITOR_COLLECTIONS,
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

  test('N1: the New sheet whose Topic comes from a collection draws, loads the topics and creates a draft', async () => {
    await at(1380, 860, '#/new/posts');
    const topic = page.getByLabel('Topic');
    await topic.waitFor();
    await page.getByRole('heading', { name: 'Start a new draft' }).waitFor();
    // the list comes from the Topics collection: its entries, by title
    await page.waitForFunction(() => [...document.querySelectorAll('select option')].some((o) => o.textContent === 'Forms'));
    assert.equal(await page.locator('.ms-new__waiting').isVisible(), false, 'the waiting line is gone once the list is in');
    await page.getByLabel('Title').fill('A post made from the sheet');
    await topic.selectOption('crm');
    const create = page.locator('.ms-new__actions button[type=submit]');
    await page.waitForFunction(() => !document.querySelector('.ms-new__actions button[type=submit]')?.hasAttribute('disabled'));
    await shot('n1-new-ready');
    await create.click();
    await page.waitForURL(/#\/e\/posts\/a-post-made-from-the-sheet/);
    await page.locator('.ProseMirror').waitFor();
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    const made = (await c.get('/collections/posts/entries/a-post-made-from-the-sheet')).json;
    assert.equal(made.frontmatter.cluster, 'crm');
    assert.equal(made.url, '/crm/a-post-made-from-the-sheet/');
    assert.equal(made.status, 'draft');
  });

  test('F13: the sign-in page asks the server for nothing but who is signed in, the release line and the sign-in choices', async () => {
    await at(1380, 860, '#/sign-in', { who: null });
    const asked = [];
    page.on('request', (r) => r.url().includes('/markstage/api/') && asked.push(new URL(r.url()).pathname.replace(/^.*\/markstage\/api\//, '')));
    const failed = [];
    page.on('response', (r) => r.url().includes('/markstage/api/') && r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
    await page.goto(`${BASE}/markstage/#/sign-in`);
    await page.getByRole('button', { name: 'Sign in' }).waitFor();
    await page.waitForTimeout(800);
    const other = asked.filter((p) => !/^(auth\/me|release|auth\/sso)$/.test(p.replace(/\?.*$/, '')));
    assert.deepEqual(other, [], `before anyone signed in, nothing but auth/me, release and the sign-in choices is asked: ${asked.join(', ')}`);
    assert.deepEqual(failed, [], 'no request fails before sign-in');
    await shot('f13-sign-in');
  });

  test('F39: the publish sheet at 400 px keeps every part inside the window, the phone check too', async () => {
    await at(400, 800, '#/publish/posts/hello-world');
    await page.locator('ul.ms-adm-pflist').waitFor();
    // the phone check ends with its small picture and a button beside it: the row that reached past the edge
    await page.getByRole('button', { name: 'Open the phone view' }).waitFor({ timeout: 60_000 }).catch(() => {});
    const wide = await page.evaluate(() => [...document.querySelectorAll('.ms-adm *')].filter((e) => e.getBoundingClientRect().right > 400.5 && !e.closest('[hidden]')).map((e) => `${e.tagName.toLowerCase()}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`).slice(0, 6));
    assert.deepEqual(wide, [], 'nothing on the publish sheet reaches past 400 px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 400);
    await shot('f39-publish-phone');
  });

  /** The top bar fits the window: nothing past its right edge, the account button on screen (`when` names the state). */
  const barFits = async (when) => {
    const r = await page.evaluate(() => {
      const head = document.querySelector('.ms-head');
      return { sw: head.scrollWidth, cw: head.clientWidth, me: Math.round(document.querySelector('.ms-head__me')?.getBoundingClientRect().right ?? 0), w: innerWidth };
    });
    assert.ok(r.sw <= r.cw, `${when}: the top bar is ${r.sw - r.cw} px wider than the window`);
    assert.ok(r.me > 0 && r.me <= r.w, `${when}: the account button is on screen (its right edge at ${r.me} of ${r.w})`);
  };

  test('F41: at 1380 px with the drawer open the title keeps at least 320 px and carries its whole words in a tooltip; the controls give up their words first', async () => {
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    const long = 'A long title about automation safety and the prevention of duplicate items in every board';
    assert.equal((await c.post('/collections/posts/entries', { title: long, frontmatter: { cluster: 'forms' } })).status, 201);
    await at(1380, 860, '#/e/posts/a-long-title-about-automation-safety-and-the-prevention-of-duplicate-items-in-every-board');
    await page.locator('.ProseMirror').waitFor();
    const doc = page.locator('.ms-head__doc');
    // the bar settles after the entry has drawn (its buttons fold to icons): measure once it has
    await page.waitForFunction(() => (document.querySelector('.ms-head__doc')?.getBoundingClientRect().width ?? 0) >= 320, null, { timeout: 5000 }).catch(() => {});
    const w = (await doc.boundingBox()).width;
    assert.ok(w >= 320, `the title box is ${Math.round(w)} px wide (at least 320)`);
    assert.equal(await page.locator('.ms-head__title').getAttribute('title'), long, 'the tooltip has the whole title');
    for (const sel of ['[data-sections] span', '[data-seo] span', '[data-library] span', '[data-preview] span']) assert.equal(await page.locator(`.ms-head ${sel}`).isVisible(), false, `${sel} keeps its icon only`);
    await page.locator('.ms-head [data-save]').waitFor({ state: 'visible' });
    await barFits('saved');
    await shot('f41-long-title');
  });

  test('F5: on a phone, Site settings, the Page tree and People & access fit the window; a wide part scrolls inside its own box', async () => {
    const fits = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 400, 'no sideways page scroll');
    const scrollsInside = async (sel) => {
      const box = page.locator(sel).first();
      await box.waitFor();
      const r = await box.evaluate((b) => ({ cw: b.clientWidth, sw: b.scrollWidth, ox: getComputedStyle(b).overflowX, right: Math.round(b.getBoundingClientRect().right) }));
      assert.ok(r.right <= 400 && r.cw <= 400, `${sel} ends inside the window (${r.right})`);
      if (r.sw > r.cw) assert.equal(r.ox, 'auto', `${sel} scrolls in its own box when it is wider than the window`);
    };
    await at(400, 800, '#/settings');
    await page.locator('.ms-site-settings__parts a').first().waitFor();
    await fits();
    await scrollsInside('.ms-site-settings__parts');
    const body = await page.locator('.ms-screen__body').evaluate((b) => ({ cw: b.clientWidth, sw: b.scrollWidth }));
    assert.ok(body.sw <= body.cw + 1, `the settings screen itself is not wider than the window (${body.sw} of ${body.cw})`);
    await shot('f5-phone-settings');
    await at(400, 800, '#/tree');
    await page.locator('.ms-order__row').first().waitFor();
    await fits();
    await scrollsInside('.ms-tree');
    await shot('f5-phone-tree');
    await at(400, 800, '#/users');
    await page.getByRole('cell', { name: /Olive Owner/ }).waitFor();
    await fits();
    await scrollsInside('table.ms-adm-table');
    await shot('f5-phone-users');
  });

  test('N2: after an entry, Messages and Home keep the full search box, the site’s name and no canvas hint', async () => {
    await at(1380, 860, '#/e/posts/hello-world');
    await page.locator('.ProseMirror').waitFor();
    await page.locator('.ms-hint').waitFor();
    // the bar settles after the entry has drawn: give the search box's words a moment to fold away
    await page.locator('.ms-head__search > span').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    assert.equal(await page.locator('.ms-head__search > span').isVisible(), false, 'the editor keeps the search as an icon');
    await page.goto(`${BASE}/markstage/#/inbox`);
    await page.locator('h1.ms-adm-title', { hasText: 'Messages' }).waitFor();
    assert.equal(await page.locator('.ms-head__search > span').isVisible(), true, 'the screen shows the search box with its words');
    assert.equal(await page.locator('.ms-head__brand b').isVisible(), true, 'the site’s name is back');
    assert.equal(await page.locator('.ms-hint').isVisible(), false, 'no canvas hint on a screen');
    await shot('n2-inbox-after-editor');
    await page.goto(`${BASE}/markstage/#/`);
    await page.locator('.ms-home').waitFor().catch(() => {});
    await page.waitForFunction(() => document.querySelector('.ms-app')?.classList.contains('is-home'));
    assert.equal(await page.locator('.ms-head__search > span').isVisible(), true, 'Home shows the search box');
    assert.equal(await page.locator('.ms-hint').isVisible(), false, 'no canvas hint on Home');
  });

  test('N7: in a table cell, a block the cell cannot hold (a heading) goes right after the table instead of nowhere', async () => {
    await at(1380, 860, '#/e/posts/bob-draft');
    const pm = page.locator('.ProseMirror');
    await pm.waitFor();
    await pm.locator('p').last().click();
    await pm.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('/');
    const menu = page.locator('.ms-insert');
    await menu.waitFor();
    await menu.locator('button', { hasText: 'Rows and columns' }).click();
    await pm.locator('table').waitFor();
    const cell = pm.locator('td p').first();
    await cell.click({ position: { x: 2, y: 6 } });
    await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
    await page.keyboard.press('Home');
    await page.keyboard.press('/');
    await menu.waitFor();
    await menu.locator('input').fill('head');
    await page.keyboard.press('Enter');
    await menu.waitFor({ state: 'hidden' });
    // the table sits in its wrapper; the heading comes right after it
    await shot('n7-after-enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.ProseMirror table')].some((t) => {
      let top = t;
      while (top.parentElement && !top.parentElement.classList.contains('ProseMirror')) top = top.parentElement;
      return top.nextElementSibling?.tagName === 'H2';
    }));
    assert.equal(await pm.locator('td h2, th h2').count(), 0, 'no heading inside a cell');
    await shot('n7-heading-after-table');
  });

  test('N16: copy and open icons have a 24 px hit area', async () => {
    await at(1380, 860, '#/account');
    const btn = page.locator('.ms-copyable__btn').first();
    await btn.waitFor({ state: 'attached' });
    const box = await btn.evaluate((b) => ({ w: b.offsetWidth, h: b.offsetHeight }));
    assert.ok(box.w >= 24 && box.h >= 24, `the copy button is ${box.w}×${box.h}`);
  });

  test('N14: an Arabic title and paragraph run right to left', async () => {
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    assert.equal((await c.post('/collections/posts/entries', { title: 'مرحبا بالعالم', id: 'rtl-post', frontmatter: { cluster: 'forms' }, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'هذه فقرة بالعربية.' }] }] } })).status, 201);
    await at(1380, 860, '#/e/posts/rtl-post');
    const pm = page.locator('.ProseMirror');
    await pm.waitFor();
    assert.equal(await page.locator('.ms-title').getAttribute('dir'), 'auto');
    const p = pm.locator('p').first();
    assert.equal(await p.evaluate((el) => getComputedStyle(el).unicodeBidi), 'plaintext');
    // the first letter of the paragraph is drawn at its right end
    const dir = await p.evaluate((el) => {
      const r = document.createRange();
      r.setStart(el.firstChild, 0);
      r.setEnd(el.firstChild, 1);
      const first = r.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return first.left - box.left > box.width / 2 ? 'rtl' : 'ltr';
    });
    assert.equal(dir, 'rtl');
    await shot('n14-rtl');
  });

  test('N4: a title in Arabic or emoji gets a dated address and the New sheet says so; nothing is ever /untitled/', async () => {
    await at(1380, 860, '#/new/posts');
    await page.getByLabel('Title').fill('🚀🚀🚀');
    const note = page.locator('.ms-new__address');
    await page.waitForFunction(() => /\/post-\d{4}-\d{2}-\d{2}\//.test(document.querySelector('.ms-new__address')?.textContent ?? ''));
    assert.match(await note.textContent(), /the title has no letters a–z or digits/);
    await page.waitForFunction(() => [...document.querySelectorAll('select option')].some((o) => o.textContent === 'Forms'));
    await page.getByLabel('Topic').selectOption('forms');
    await shot('n4-new-dated');
    await page.locator('.ms-new__actions button[type=submit]').click();
    await page.waitForURL(/#\/e\/posts\/post-\d{4}-\d{2}-\d{2}/);
    await page.getByText(/created at \/forms\/post-\d{4}-\d{2}-\d{2}\//).waitFor();
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    assert.equal((await c.get('/collections/posts/entries?q=untitled')).json.items.filter((e) => /untitled/.test(e.id)).length, 0);
  });

  test('N8: a topic that is not one of the site’s topics is refused as unknown, with the choices, not as missing', async () => {
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    const r = await c.post('/collections/posts/entries', { title: 'Wrong topic', frontmatter: { cluster: 'does-not-exist' } });
    assert.equal(r.status, 422);
    assert.equal(r.json.message, 'There is no topic “does-not-exist”. Pick one of: crm, forms.');
    assert.deepEqual(r.json.fields, { cluster: 'There is no topic “does-not-exist”.' });
    const none = await c.post('/collections/posts/entries', { title: 'No topic', frontmatter: {} });
    assert.equal(none.status, 422);
    assert.match(none.json.message, /“Topic” is needed/);
  });

  test('N6: one main landmark, one heading level 1 per screen, a skip link first, and dialogs that are named, modal and keep the focus', async () => {
    const visibleH1s = () => page.evaluate(() => [...document.querySelectorAll('h1')].filter((h) => h.offsetParent !== null).length);
    await at(1380, 860, '#/inbox');
    await page.locator('h1.ms-adm-title').waitFor();
    assert.equal(await page.locator('main').count(), 1, 'one <main>');
    assert.equal(await visibleH1s(), 1, 'Messages: one h1');
    assert.equal(await page.locator('.ms-head__title').evaluate((el) => el.tagName), 'DIV', 'the bar’s title is not a heading');
    // the skip link is the first Tab stop and puts the focus on the content, without touching the address
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'ms-skip');
    await shot('n6-skip-link');
    const hash = new URL(page.url()).hash;
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ms-main');
    assert.equal(new URL(page.url()).hash, hash, 'the address did not change');
    await page.goto(`${BASE}/markstage/#/`);
    await page.waitForFunction(() => document.querySelector('.ms-app')?.classList.contains('is-home'));
    assert.equal(await visibleH1s(), 1, 'Home: one h1');
    // bob-draft: a text without a heading of its own (hello-world's text starts with one)
    await page.goto(`${BASE}/markstage/#/e/posts/bob-draft`);
    await page.locator('.ProseMirror').waitFor();
    assert.equal(await visibleH1s(), 1, 'the editor: one h1 (the title)');
    // a confirm box: named by its heading, modal, and Tab stays inside it
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Move to the trash…' }).click();
    const dlg = page.locator('dialog.ms-dialog[open]');
    await dlg.waitFor();
    assert.equal(await dlg.getAttribute('aria-modal'), 'true');
    const labelledBy = await dlg.getAttribute('aria-labelledby');
    assert.ok(labelledBy, 'named by its heading');
    assert.equal(await page.locator(`#${labelledBy}`).evaluate((h) => h.tagName), 'H2');
    const buttons = await dlg.locator('button').count();
    for (let i = 0; i < buttons + 1; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.closest('dialog.ms-dialog') !== null), true, `Tab ${i + 1}: the focus stays in the dialog`);
    }
    await shot('n6-dialog');
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'hidden' });
  });

  test('N9: when someone else saves the page, the banner says so at once with Reload (clean) or Merge now (unsaved changes)', async () => {
    const other = client(BASE);
    await other.login(owner.email, owner.password);
    assert.equal((await other.post('/collections/posts/entries', { title: 'Shared draft', id: 'shared-draft', frontmatter: { cluster: 'forms' } })).status, 201);
    await at(1380, 860, '#/e/posts/shared-draft');
    const pm = page.locator('.ProseMirror');
    await pm.waitFor();
    // another person saves meanwhile
    const e = (await other.get('/collections/posts/entries/shared-draft')).json;
    const put = await other.put('/collections/posts/entries/shared-draft', { version: e.version, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved from elsewhere.' }] }] } });
    assert.equal(put.status, 200, put.text);
    // the next heartbeat (a tab coming back to the front sends one) brings the news
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const banner = page.locator('.ms-presence');
    await banner.getByRole('button', { name: 'Reload' }).waitFor();
    assert.match(await banner.innerText(), /Olive Owner saved this page at .*You are reading an older version/);
    await shot('n9-saved-elsewhere');
    await banner.getByRole('button', { name: 'Reload' }).click();
    await pm.getByText('Saved from elsewhere.').waitFor();
    await banner.waitFor({ state: 'hidden' });
    // with unsaved changes the offer is a merge
    await pm.locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' And more here.');
    const e2 = (await other.get('/collections/posts/entries/shared-draft')).json;
    assert.equal((await other.put('/collections/posts/entries/shared-draft', { version: e2.version, frontmatter: { tags: ['x'] } })).status, 200);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await banner.getByRole('button', { name: 'Merge now' }).waitFor();
    assert.match(await banner.innerText(), /saving merges them into it/);
    await banner.getByRole('button', { name: 'Merge now' }).click();
    await page.waitForFunction(() => /^Saved|Merged/.test(document.querySelector('.ms-status__text')?.textContent ?? '') || document.querySelector('.ms-merge'));
  });

  test('N10: a role change while editing shows a banner at once, and Save asks before trying', async () => {
    const edna = await addUser(app, { email: 'edna@example.test', name: 'Edna Editor', role: 'editor' });
    await at(1380, 860, '#/e/posts/hello-world', { who: edna });
    const pm = page.locator('.ProseMirror');
    await pm.waitFor();
    await pm.locator('p').last().click();
    await page.keyboard.type(' Typed before the change.');
    const owner2 = client(BASE);
    await owner2.login(owner.email, owner.password);
    const id = (await owner2.get('/users?brief=1')).json.find((u) => u.name === 'Edna Editor').id;
    assert.equal((await owner2.patch(`/users/${id}`, { role: 'contributor' })).status, 200);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const banner = page.locator('.ms-presence');
    await banner.getByText(/Your role is now/).waitFor();
    assert.match(await banner.innerText(), /Your role is now contributor\. You can no longer change this page/);
    await shot('n10-role-changed');
    await page.keyboard.press('ControlOrMeta+s');
    const dlg = page.locator('dialog.ms-dialog[open]');
    await dlg.waitFor();
    assert.match(await dlg.innerText(), /Your role is now contributor\. Try to save anyway\?/);
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await dlg.waitFor({ state: 'hidden' });
    assert.equal((await owner2.get('/collections/posts/entries/hello-world')).json.doc.content.some((b) => JSON.stringify(b).includes('Typed before the change')), false, 'nothing was saved');
  });

  test('N11: a title past 300 characters is not cut: the count shows under it and the save is refused with the same words', async () => {
    await at(1380, 860, '#/e/posts/bob-draft');
    await page.locator('.ProseMirror').waitFor();
    const title = page.locator('.ms-title');
    await title.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('T'.repeat(320));
    const over = page.locator('.ms-title__over');
    await over.waitFor();
    assert.equal(await over.textContent(), 'Titles are at most 300 characters (20 over): shorten it to save.');
    assert.equal((await title.textContent()).length, 320, 'nothing was cut');
    await barFits('unsaved changes');
    // and at the other common desktop widths, drawer open
    for (const width of [1280, 1366, 1440, 1536, 1680, 1920]) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(150);
      await barFits(`unsaved changes at ${width} px`);
    }
    // with Post settings open beside the page as well
    await page.locator('.ms-head [data-settings]').click();
    for (const width of [1280, 1366, 1380, 1440, 1536, 1920]) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(150);
      await barFits(`unsaved changes, Post settings open, at ${width} px`);
      if (width === 1280) {
        // what the bar folded away is in the More menu
        await page.locator('.ms-head [data-more]').click();
        const folded = await page.locator('.ms-menu__item--folded').allTextContents();
        for (const word of ['Undo', 'Redo', 'Check on screens']) assert.ok(folded.some((t) => t.includes(word)), `More lists ${word} (${folded.join(', ')})`);
        await page.keyboard.press('Escape');
      }
    }
    // the place chip with a long branch, as astro dev draws it (environments/badge.ts): it gives way before Save does
    await page.evaluate(() => {
      const chip = Object.assign(document.createElement('span'), { className: 'ms-envbadge is-grey is-local', title: 'On my computer' });
      chip.setAttribute('aria-label', 'Place: On my computer, branch a-rather-long-branch-name');
      chip.append(Object.assign(document.createElement('strong'), { textContent: 'On my computer' }), Object.assign(document.createElement('span'), { className: 'ms-envbadge__branch', textContent: 'a-rather-long-branch-name' }));
      document.querySelector('.ms-head__place')?.append(chip);
    });
    for (const open of [true, false]) {
      for (const width of [1280, 1366, 1440, 1536, 1920]) {
        await page.setViewportSize({ width, height: 860 });
        await page.waitForTimeout(150);
        await barFits(`with the place chip, Post settings ${open ? 'open' : 'closed'}, at ${width} px`);
      }
      if (open) await page.locator('.ms-head [data-settings]').click();
    }
    await page.evaluate(() => document.querySelector('.ms-head .ms-envbadge')?.remove());
    await page.setViewportSize({ width: 1380, height: 860 });
    await shot('n11-title-over');
    await page.keyboard.press('ControlOrMeta+s');
    await page.waitForFunction(() => document.querySelector('.ms-status')?.getAttribute('data-status') === 'error');
    assert.equal(await page.locator('.ms-status__text').textContent(), 'Titles are at most 300 characters (20 over): shorten it to save.');
    await barFits('a refused save');
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    assert.equal((await c.get('/collections/posts/entries/bob-draft')).json.title, 'Bob Draft', 'the saved title is unchanged');
  });

  test('N3: text pasted from Word arrives as a heading, real bullets and a clean table', async () => {
    const word = fs.readFileSync(path.join(import.meta.dirname, '../../editor/test/fixtures/word-paste.html'), 'utf8');
    await at(1380, 860, '#/e/posts/bob-draft');
    const pm = page.locator('.ProseMirror');
    await pm.waitFor();
    await pm.locator('p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.evaluate((html) => {
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.setData('text/plain', 'Word Title\nBold lead normal text with a link.\n· First bullet\n· Second bullet\nCell A Cell B\nRed text');
      document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, word);
    await pm.locator('h2', { hasText: 'Word Title' }).waitFor();
    assert.deepEqual(await pm.locator('ul > li').allInnerTexts().then((a) => a.map((t) => t.split('\n')[0])), ['First bullet', 'Second bullet', 'Under the second']);
    assert.deepEqual(await pm.locator('ul ul > li').allInnerTexts(), ['Under the second'], 'the level-2 point is nested under the second');
    assert.deepEqual(await pm.locator('ol > li').allInnerTexts(), ['First step', 'Second step']);
    assert.equal(await pm.locator('table td').count(), 2);
    assert.equal(await pm.locator('[style], [class*="Mso"]').count(), 0, 'no Word styling');
    assert.equal(await pm.evaluate((el) => el.textContent.includes('·')), false, 'no literal bullet dots');
    await shot('n3-word-paste');
  });
});
