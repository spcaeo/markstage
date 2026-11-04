// The Translations screen (#/translations, editor src/translations/) in a real browser at 1440, against a real server
// whose site has a French region (its own title and description) and a US one (the same language): reached from the
// More menu; what needs work first, with how many per region and status; every filter, the search, the sort, the page
// and the open row in the URL (Back undoes a filter; a link opens the same view); a row's source next to its
// translation with copy icons; "Translate in Post settings" (or "Draft with AI", the stub's) opens the entry at its
// regions, and a translation saved there leaves the list; an entry another person wrote is "View" for an author; a wrong link says so. Light and dark.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: its own (support.mjs TRANSLATIONS_PORT). Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { SHOTS, TRANSLATIONS_PORT as PORT, pw, skip, blank } from './support.mjs';

const BASE = `http://127.0.0.1:${PORT}`;
// no key from the shell reaches this server: its AI is the stub only
delete process.env.MARKSTAGE_AI_KEY;

const SITE_CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  locales: [
    { code: 'en-CA', prefix: '', label: 'English (Canada)' },
    { code: 'en-US', prefix: '/en-us', label: 'English (US)', overrides: ['title', 'description'] },
    { code: 'fr-CA', prefix: '/fr', label: 'Français (Canada)', overrides: ['title', 'description'] },
  ],
};
`;
const post = (title, excerpt, fr = null) =>
  `---\ntitle: ${title}\nauthor: alice\ndate: '2026-03-02T10:00:00.000Z'\nexcerpt: ${excerpt}\n${fr ? `locales:\n  fr-CA:\n    title: ${fr[0]}\n    description: ${fr[1]}\n` : ''}---\n\nText.\n`;

const LOCALES = {
  list: [
    { code: 'en-CA', prefix: '', default: true, label: 'English (Canada)', variety: null, hasSpelling: false, overrides: [] },
    { code: 'en-US', prefix: '/en-us', default: false, label: 'English (US)', variety: null, hasSpelling: false, overrides: ['title', 'description'] },
    { code: 'fr-CA', prefix: '/fr', default: false, label: 'Français (Canada)', variety: null, hasSpelling: false, overrides: ['title', 'description'] },
  ],
  xDefault: 'en-CA',
  overridesKey: 'locales',
};

describe('the Translations screen in a browser', { skip, timeout: 180_000 }, () => {
  let fx, app, browser, ctx, page, owner, author;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const params = () => Object.fromEntries(new URLSearchParams(hash().split('?')[1] ?? ''));
  const rows = () => page.locator('.ms-tr-table tbody tr').evaluateAll((trs) => trs.map((t) => t.dataset.item));
  const chip = (group, name) => page.getByRole('group', { name: group }).getByRole('button', { name });
  const count = async (group, name) => Number((await chip(group, name).locator('.ms-adm-chip__n').textContent()).replace(/\D/g, ''));
  const drawer = () => page.locator('.ms-adm-drawer');
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `translations-${name}-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const listed = () => page.locator('.ms-tr-table, .ms-adm-state:not(.ms-adm-state--loading)').first().waitFor();
  /** the rows once the list shows `want` (it is read again after each change of view) */
  const rowsAre = async (want) => {
    for (let i = 0; i < 100 && JSON.stringify(await rows()) !== JSON.stringify(want); i++) await page.waitForTimeout(50);
    assert.deepEqual(await rows(), want);
  };

  async function signIn(who, to) {
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    const commit = (rel, text, msg) => {
      fs.writeFileSync(path.join(fx.site, rel), text);
      fx.git('add', '-A');
      fx.git('commit', '-q', '-m', msg);
    };
    // translated, then its title changed in a later commit: outdated (its description is still done)
    commit('src/content/blog/harbour.md', post('The harbour', 'Boats and gulls.', ['Le port', 'Bateaux et mouettes.']), 'Harbour, in French too');
    // (two seconds on: newer than the fixture's own entries, which share one second; the save below comes later still)
    process.env.GIT_COMMITTER_DATE = new Date(Date.now() + 2000).toISOString();
    try {
      commit('src/content/blog/harbour.md', post('A morning at the harbour', 'Boats and gulls.', ['Le port', 'Bateaux et mouettes.']), 'A new title');
    } finally {
      delete process.env.GIT_COMMITTER_DATE;
    }
    // translated with its source in one commit: done
    commit('src/content/blog/garden.md', post('The garden', 'Roses.', ['Le jardin', 'Des roses.']), 'Garden');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title', settings: [{ type: 'textarea', key: 'excerpt', label: 'Excerpt' }] },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      locales: LOCALES,
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    // the stub AI (no call leaves the machine): a row that needs work offers Draft with AI
    const cfgPath = path.join(fx.data, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), ai: { provider: 'stub', perMinute: 60 } }, null, 2));
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
    author = await addUser(app, { email: 'carol@example.test', name: 'Carol Author', role: 'author', authorSlug: 'carol' });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    await browser?.close();
    await app?.close();
  });

  test('from the More menu: what needs work, newest change first, with how many per region and status', async () => {
    await signIn(owner, '#/e/posts/harbour');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Languages' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/translations'));
    await page.locator('.ms-tr-table tbody tr').first().waitFor();
    const r = await rows();
    // the newest source change first: the harbour's new title
    assert.equal(r[0], 'posts/harbour/fr-CA');
    assert.ok(!r.includes('posts/garden/fr-CA'), 'done: not in Needs work');
    assert.ok(!r.some((k) => k.endsWith('/en-US')), 'the same language: an empty field is the source, so done');
    const harbour = page.locator('tr[data-item="posts/harbour/fr-CA"]');
    assert.deepEqual((await harbour.locator('.ms-tr-badge').allTextContents()), ['Outdated', 'Outdated', 'Done']);
    assert.equal(await count('Status', /^Needs work/), r.length);
    assert.equal(await count('Status', /^Outdated/), 1);
    assert.equal(await count('Region', /^English \(US\)/), 0);
    assert.equal(await count('Region', /^Français/), r.length);
    await shot('needs');
  });

  test('every filter, the search and the sort in the URL; Back undoes one; a link opens the same view', async () => {
    await chip('Status', /^Outdated/).click();
    assert.equal(params().status, 'outdated');
    await rowsAre(['posts/harbour/fr-CA']);
    await chip('Status', /^Done/).click();
    await page.waitForFunction(() => location.hash.includes('status=done'));
    await page.locator('tr[data-item="posts/garden/fr-CA"]').waitFor();
    await page.goBack();
    await page.waitForFunction(() => location.hash.includes('status=outdated'));
    await rowsAre(['posts/harbour/fr-CA']);
    await chip('Status', /^All/).click();
    await chip('Region', /^Français/).click();
    await page.waitForFunction(() => location.hash.includes('locale=fr-CA'));
    await page.getByRole('combobox', { name: 'Sort' }).selectOption('title');
    await page.waitForFunction(() => location.hash.includes('sort=title'));
    await page.getByRole('searchbox', { name: 'Search titles' }).fill('gard');
    await page.waitForFunction(() => location.hash.includes('q=gard'));
    await rowsAre(['posts/garden/fr-CA']);
    const view = hash();
    assert.deepEqual([params().status, params().locale, params().sort, params().q], ['all', 'fr-CA', 'title', 'gard']);
    await blank(page);
    await page.goto(`${BASE}/markstage/${view}`);
    await rowsAre(['posts/garden/fr-CA']);
    assert.equal(await page.getByRole('searchbox', { name: 'Search titles' }).inputValue(), 'gard');
  });

  test('a row: its source beside its translation with copy icons, then Translate in Post settings; saved, it leaves the list', async () => {
    await page.goto(`${BASE}/markstage/#/translations`);
    await listed();
    await page.getByRole('button', { name: /^Details of “A morning at the harbour” in Français/ }).click();
    assert.equal(params().item, 'posts/harbour/fr-CA');
    const d = drawer();
    const title = d.locator('[data-field="title"]');
    await title.waitFor();
    assert.equal((await title.locator('.ms-tr-badge').textContent()), 'Outdated');
    assert.deepEqual((await title.locator('.ms-copyable__text').allTextContents()).map((t) => t.trim()), ['A morning at the harbour', 'Le port']);
    await title.locator('.ms-tr-field__row').first().hover();
    await title.getByRole('button', { name: 'Copy the source title' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'A morning at the harbour');
    assert.equal(await d.locator('[data-field="description"] .ms-tr-badge').textContent(), 'Done');
    await shot('row');
    // a link to the open row opens it again
    await blank(page);
    await page.goto(`${BASE}/markstage/#/translations?item=posts/harbour/fr-CA`);
    await drawer().locator('[data-field="title"]').waitFor();
    // a link to nothing says so
    await blank(page);
    await page.goto(`${BASE}/markstage/#/translations?item=posts/nowhere/fr-CA`);
    await drawer().getByText('Not available to you').waitFor();

    // Draft with AI: Post settings at that region, with the AI's draft beside its fields
    await page.goto(`${BASE}/markstage/#/translations?item=posts/harbour/fr-CA`);
    await drawer().getByRole('button', { name: 'Draft with AI' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/e/posts/harbour') && u.hash.includes('suggest=translate') && u.hash.includes('loc=fr-CA'));
    await page.locator('.ms-locales .ms-ai[data-ai-state="ready"]').waitFor();
    await page.goBack();
    await page.waitForFunction(() => location.hash.startsWith('#/translations'));
    await drawer().getByRole('button', { name: 'Translate in Post settings' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/e/posts/harbour') && u.hash.includes('s=1'));
    const fr = page.getByLabel('Title on Français (Canada)');
    assert.equal(await fr.inputValue(), 'Le port');
    await fr.fill('Une matinée au port');
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    await page.goBack();
    await page.waitForFunction(() => location.hash.startsWith('#/translations'));
    await page.goto(`${BASE}/markstage/#/translations`);
    await listed();
    assert.ok(!(await rows()).includes('posts/harbour/fr-CA'), 'translated after its source: done');
  });

  test('the same language: the note says an empty field is the source text', async () => {
    await page.goto(`${BASE}/markstage/#/translations?status=all&locale=en-US&item=posts/garden/en-US`);
    await drawer().getByText(/^Same language as the source: an empty field uses the source text/).waitFor();
    assert.equal(await drawer().locator('.ms-adm-facts').getByText('English (US)').count(), 1);
    assert.equal(await drawer().locator('[data-field="title"] .ms-tr-badge').textContent(), 'Done');
  });

  test('an author: another person’s entry is View, not Translate', async () => {
    await page.goto(`${BASE}/markstage/#/sign-in`);
    await ctx.clearCookies();
    await signIn(author, '#/translations?item=posts/hello-world/fr-CA');
    await drawer().locator('[data-field="title"]').waitFor();
    assert.equal(await drawer().getByRole('button', { name: 'Translate in Post settings' }).count(), 0);
    await drawer().getByRole('button', { name: 'View in Post settings' }).waitFor();
  });
});
