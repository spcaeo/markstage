// Site settings → Search & AI and Tracking in a real browser (editor site-settings/head/), against a real server on
// 127.0.0.1: the switches and the addresses they make (with copy and open icons), pages to leave out, feeds (an open
// feed is in the URL), a refusal in words under the field, Save writing the file in the content repo, Undo, a reload
// showing what was saved, a stale save asking to reload; Tracking checks each ID as it is typed and keeps the other
// part's settings; an editor does not see the parts. Light and dark, desktop and phone width when MARKSTAGE_E2E_SHOTS
// is set. The test people are made up here; the browser opened here is closed in `after`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { HEAD_UI_PORT, SHOTS, pw, skip } from './support.mjs';

const BASE = `http://127.0.0.1:${HEAD_UI_PORT}`;
const SITE = 'https://www.example.com';
const FILE = 'src/site/head.json';
const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
const SITE_CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  head: {},
};
`;

describe('Site settings → Search & AI and Tracking', { skip }, () => {
  let fx, app, owner, ed, browser, ctx, page;
  const params = () => Object.fromEntries(new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? ''));
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(fx.site, FILE), 'utf8'));
  const bar = () => page.locator('.ms-hk__bar');
  const saveBtn = (name) => bar().getByRole('button', { name });
  /**
   * Light and dark: this window as it is (1380 wide, tall enough to show the whole screen), and with `phone` the same
   * address as it was last loaded or saved, in a new 400 wide window (the editor changes its layout at load, so a
   * window is never resized mid-way).
   */
  const shot = async (name, { phone = false } = {}) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, `head-${name}-1380-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    if (!phone) return;
    for (const s of ['light', 'dark']) {
      const c = await browser.newContext({ viewport: { width: 400, height: 2400 }, colorScheme: s, storageState: await ctx.storageState() });
      try {
        const p = await c.newPage();
        await p.goto(page.url());
        await p.locator('.ms-hk').waitFor();
        await p.waitForTimeout(300);
        await p.screenshot({ path: path.join(SHOTS, `head-${name}-400-${s}.png`) });
      } finally {
        await c.close();
      }
    }
  };
  async function signIn(p, who, to) {
    await p.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await p.getByLabel('Email').fill(who.email);
    await p.getByLabel('Password', { exact: true }).fill(who.password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Site config');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Example Co',
      siteUrl: SITE,
      head: { file: FILE },
      collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' }],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: HEAD_UI_PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { core: await loadCore(), codec: fakeCodec });
    await app.listen(HEAD_UI_PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'olive@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    ed = await addUser(app, { email: 'edie@example.test', name: 'Edie Editor', role: 'editor', authorSlug: 'alice', password: pass() });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1380, height: 1500 }, colorScheme: 'light' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await signIn(page, owner, '#/settings/search-ai');
  });
  after(async () => {
    await browser?.close();
    await app?.jobs.idle();
    await app?.close();
  });

  test('Search & AI loads with its switches on and the addresses they make, each with copy and open', async () => {
    await page.getByRole('heading', { name: 'Search & AI', level: 2 }).waitFor();
    const tabs = await page.locator('.ms-site-settings__parts a').allTextContents();
    assert.ok(tabs.includes('Search & AI') && tabs.includes('Tracking'));
    assert.equal(await page.locator('.ms-site-settings__parts a[aria-current="page"]').textContent(), 'Search & AI');
    for (const name of ['A Markdown copy of every page', 'A bundle of the whole site (OKF)', 'An llms.txt file']) assert.equal(await page.getByLabel(name).isChecked(), true, name);
    // one sentence under each switch
    assert.match(await page.locator('.ms-hk__switch').first().locator('.ms-hk__hint').textContent(), /\.md added/);
    const addrs = await page.locator('.ms-hk__addrs .ms-copyable__text').allTextContents();
    assert.deepEqual(addrs, [`${SITE}/index.md`, `${SITE}/okf/index.md`, `${SITE}/llms.txt`, `${SITE}/llms-full.txt`]);
    const one = page.locator('.ms-hk__addrs li').nth(2);
    await one.hover();
    assert.equal(await one.getByRole('link', { name: /^Open the address of Short file/ }).getAttribute('href'), `${SITE}/llms.txt`);
    await one.getByRole('button', { name: /^Copy the address of Short file/ }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${SITE}/llms.txt`);
    assert.equal(await page.locator('input[type="text"] ~ .ms-copyable__tools, .ms-hk__field .ms-copyable').count(), 0, 'no copy icon on a box someone types in');
    assert.equal(await saveBtn('Save the settings').isDisabled(), true, 'nothing to save yet');
    await shot('1-search-ai', { phone: true });
  });

  test('a switch off hides its addresses; a page to leave out: a wrong address is refused in words under it, nothing is written', async () => {
    await page.getByLabel('A bundle of the whole site (OKF)').uncheck();
    assert.equal(await page.locator('.ms-hk__addrs li').count(), 3, 'the bundle’s address is gone');
    assert.equal(await saveBtn('Save the settings').isEnabled(), true);
    await page.getByRole('button', { name: 'Leave out a page' }).click();
    const box = page.getByLabel('Address of page 1 to leave out');
    await box.fill('thank-you');
    await saveBtn('Save the settings').click();
    await page.locator('.ms-hk__msg', { hasText: /“thank-you” is not a page path/ }).waitFor();
    assert.equal(await box.getAttribute('aria-invalid'), 'true');
    assert.ok(!fs.existsSync(path.join(fx.site, FILE)), 'nothing written');
    await shot('2-refused');
    await box.fill('/thank-you/');
    assert.equal(await page.locator('.ms-hk__msg', { hasText: /is not a page path/ }).count(), 0, 'the message goes when it is typed again');
  });

  test('a feed: Add a feed opens it (in the URL); a bad address and no kind are refused; Save writes the file, Undo puts it back', async () => {
    await page.getByRole('button', { name: 'Add a feed' }).click();
    await page.waitForURL((u) => u.hash.includes('feed=rss'));
    assert.equal(params().feed, 'rss');
    const form = page.locator('.ms-hk__feed.is-picked');
    assert.equal(await form.getByLabel('Address', { exact: true }).inputValue(), '/rss.xml');
    assert.equal(await form.getByLabel('Posts').isChecked(), true, 'the first kind is ticked');
    assert.equal(await form.getByLabel('How many items').inputValue(), '50');
    await form.getByLabel('Title').fill('Example Co blog');
    assert.equal(await page.locator('.ms-hk__feed.is-picked strong').textContent(), 'Example Co blog');
    await form.getByLabel('Address', { exact: true }).fill('rss');
    await form.getByLabel('Posts').uncheck();
    await saveBtn('Save the settings').click();
    await page.locator('.ms-hk__msg', { hasText: /address ends in \.xml/ }).waitFor();
    await page.locator('.ms-hk__msg', { hasText: /lists at least one collection/ }).waitFor();
    assert.ok(!fs.existsSync(path.join(fx.site, FILE)), 'nothing written');
    await form.getByLabel('Address', { exact: true }).fill('/rss.xml');
    await form.getByLabel('Posts').check();
    await shot('3-feed');
    await saveBtn('Save the settings').click();
    await page.getByText('The settings are saved. The site builds them now.').waitFor();
    assert.deepEqual(onDisk(), {
      markdown: { pages: true, okf: false, llms: true, skip: ['/thank-you/'] },
      feeds: [{ id: 'rss', title: 'Example Co blog', path: '/rss.xml', collections: ['posts'], limit: 50 }],
    });
    assert.match(fx.git('log', '-1', '--format=%an|%s', '--', FILE).trim(), /^Olive Owner\|Site settings: search and AI$/);
    // Undo: the file is as it was (an empty object: it did not exist before)
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByText('Undone: the settings are as they were.').waitFor();
    assert.deepEqual(onDisk(), {});
    assert.equal(await page.getByLabel('A bundle of the whole site (OKF)').isChecked(), true, 'the screen shows it too');
  });

  test('saved again, a reload shows the saved values and the open feed; a feed is removed in the draft and saved', async () => {
    await page.getByLabel('A bundle of the whole site (OKF)').uncheck();
    await page.getByRole('button', { name: 'Leave out a page' }).click();
    await page.getByLabel('Address of page 1 to leave out').fill('/thank-you/');
    await page.getByRole('button', { name: 'Add a feed' }).click();
    const form = page.locator('.ms-hk__feed.is-picked');
    await form.getByLabel('Title').fill('Example Co blog');
    await form.getByLabel('How many items').fill('20');
    await saveBtn('Save the settings').click();
    await page.getByText('The settings are saved. The site builds them now.').waitFor();
    await app.jobs.idle();
    await page.reload();
    await page.getByRole('heading', { name: 'Search & AI', level: 2 }).waitFor();
    assert.equal(params().feed, 'rss', 'the open feed is in the URL');
    assert.equal(await page.getByLabel('A bundle of the whole site (OKF)').isChecked(), false);
    assert.equal(await page.getByLabel('Address of page 1 to leave out').inputValue(), '/thank-you/');
    const open = page.locator('.ms-hk__feed.is-picked');
    assert.equal(await open.getByLabel('Title').inputValue(), 'Example Co blog');
    assert.equal(await open.getByLabel('How many items').inputValue(), '20');
    assert.equal(await open.locator('.ms-copyable__text').textContent(), `${SITE}/rss.xml`, 'the feed’s address is shown in full');
    await shot('4-feed-saved', { phone: true });
    // closing the row is a URL change, nothing is lost
    await open.getByRole('button', { name: 'Close' }).click();
    await page.waitForURL((u) => !u.hash.includes('feed='));
    assert.equal(await page.locator('.ms-hk__feed.is-picked').count(), 0);
    await page.goBack();
    await page.locator('.ms-hk__feed.is-picked').waitFor();
    // removing the feed and the page: saved
    await page.getByRole('button', { name: 'Remove the feed Example Co blog' }).click();
    await page.getByRole('button', { name: 'Stop leaving out page 1' }).click();
    await saveBtn('Save the settings').click();
    await page.getByText('The settings are saved. The site builds them now.').waitFor();
    assert.deepEqual(onDisk().feeds, []);
    assert.deepEqual(onDisk().markdown.skip, []);
    await app.jobs.idle();
  });

  test('a save when someone else changed the file asks to reload, and the reload shows theirs', async () => {
    await page.reload();
    await page.getByRole('heading', { name: 'Search & AI', level: 2 }).waitFor();
    await page.getByLabel('An llms.txt file').uncheck();
    // another person saves meanwhile
    const theirs = { ...onDisk(), markdown: { ...onDisk().markdown, pages: false } };
    fs.writeFileSync(path.join(fx.site, FILE), `${JSON.stringify(theirs, null, 2)}\n`);
    await saveBtn('Save the settings').click();
    await page.getByText('Someone else changed these settings; reload to see theirs.').waitFor();
    assert.deepEqual(onDisk(), theirs, 'their file is untouched');
    await shot('5-stale');
    await page.getByRole('button', { name: 'Reload the settings' }).click();
    await page.getByRole('button', { name: 'Save the settings' }).waitFor();
    assert.equal(await page.getByLabel('A Markdown copy of every page').isChecked(), false, 'theirs is shown');
    assert.equal(await page.getByLabel('An llms.txt file').isChecked(), true, 'not the unsaved change');
  });

  test('Tracking: each ID is checked as it is typed, Save waits for a good one, the load choice is saved, and the other part’s settings stay', async () => {
    const before = onDisk();
    await page.locator('.ms-site-settings__parts a', { hasText: 'Tracking' }).click();
    await page.getByRole('heading', { name: 'Tracking', level: 2 }).waitFor();
    assert.equal(page.url().includes('#/settings/tracking'), true);
    await page.getByLabel('Google Tag Manager').waitFor();
    const labels = await page.locator('.ms-hk__field > label').allTextContents();
    assert.deepEqual(labels, ['Google Tag Manager', 'Google Analytics 4', 'Ahrefs Web Analytics', 'Skald Analytics', 'Plausible Analytics']);
    const gtm = page.getByLabel('Google Tag Manager');
    assert.equal(await gtm.getAttribute('placeholder'), 'GTM-ABC1234');
    // a hint under every field
    assert.match(await page.locator('.ms-hk__field').first().locator('.ms-hk__hint').textContent(), /tagmanager\.google\.com/);
    assert.equal(await page.getByLabel('On the first click, key or scroll (faster pages)').isChecked(), true, 'the faster choice is the default');
    await page.getByText(/Cookie consent banners belong inside your tag manager/).waitFor();
    await gtm.fill('UA-123');
    await page.locator('.ms-hk__msg', { hasText: '“UA-123” is not a Google Tag Manager ID (such as GTM-ABC1234).' }).waitFor();
    assert.equal(await gtm.getAttribute('aria-invalid'), 'true');
    assert.equal(await saveBtn('Save the tracking').isDisabled(), true, 'Save waits while an ID is wrong');
    await shot('5-tracking-wrong');
    await gtm.fill('GTM-ABC1234');
    assert.equal(await page.locator('.ms-hk__msg', { hasText: /is not a Google Tag Manager ID/ }).count(), 0);
    await page.getByLabel('Plausible Analytics').fill('example.com');
    await page.getByLabel('At once').check();
    assert.equal(await saveBtn('Save the tracking').isEnabled(), true);
    await shot('6-tracking');
    await saveBtn('Save the tracking').click();
    await page.getByText(/The tracking is saved/).waitFor();
    assert.deepEqual(onDisk(), { ...before, tracking: { gtm: 'GTM-ABC1234', plausible: 'example.com', gtmLoad: 'at-once' } }, 'only the tracking changed');
    assert.match(fx.git('log', '-1', '--format=%s', '--', FILE).trim(), /^Site settings: tracking$/);
    await app.jobs.idle();
    await page.reload();
    await page.getByRole('heading', { name: 'Tracking', level: 2 }).waitFor();
    assert.equal(await page.getByLabel('Google Tag Manager').inputValue(), 'GTM-ABC1234');
    assert.equal(await page.getByLabel('Plausible Analytics').inputValue(), 'example.com');
    assert.equal(await page.getByLabel('At once').isChecked(), true);
    await shot('7-tracking-saved', { phone: true });
    // emptying every tool and the default load takes the tracking out of the file
    await page.getByLabel('Google Tag Manager').fill('');
    await page.getByLabel('Plausible Analytics').fill('');
    await page.getByLabel('On the first click, key or scroll (faster pages)').check();
    await saveBtn('Save the tracking').click();
    await page.getByText(/The tracking is saved/).waitFor();
    assert.deepEqual(onDisk(), before);
    await app.jobs.idle();
  });

  test('an editor does not see the parts: not in the list, and the address says so', async () => {
    // another browser: the owner stays signed in in the first one
    const other = await browser.newContext({ viewport: { width: 1380, height: 900 } });
    const p = await other.newPage();
    p.on('pageerror', (e) => console.error('page error:', e.message));
    try {
      await signIn(p, ed, '#/settings/tokens');
      await p.locator('.ms-site-settings__parts a', { hasText: 'Tokens' }).waitFor();
      assert.deepEqual(await p.locator('.ms-site-settings__parts a').allTextContents(), ['Tokens']);
      for (const part of ['search-ai', 'tracking']) {
        await p.goto(`${BASE}/markstage/#/settings/${part}`);
        await p.getByText(/Not available to you/).waitFor();
        assert.equal(await p.getByRole('button', { name: /^Save/ }).count(), 0);
      }
      // the server says no too
      const r = await p.evaluate(async () => {
        const csrf = await fetch('/markstage/api/auth/me', { credentials: 'same-origin' }).then((x) => x.json()).then((j) => j.csrfToken);
        const res = await fetch('/markstage/api/head', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ version: null, settings: {} }) });
        return res.status;
      });
      assert.equal(r, 403);
    } finally {
      await other.close();
    }
  });
});
