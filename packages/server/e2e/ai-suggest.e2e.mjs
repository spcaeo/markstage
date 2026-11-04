// AI suggestions in a real browser at 1440, against real servers whose AI is the stub provider (no API call leaves
// the machine): alt text for an image on the canvas, in the image block's settings panel, for a cover in Post
// settings and for an image field in the pages editor, the search title and description in the SEO check, a region's
// title and description, and a promotion's summary next to its Reason.
// Each is at its own URL (Back and Forward open and close it), shows the value now next to the suggestion (with a
// copy icon), and takes Accept, Edit then accept or Dismiss; accepting is a change like typing, saved with ⌘S, and
// Undo (the toast's, or ⌘Z: on the canvas, in Post settings, in the pages editor and in the Reason box) takes it back. Too many, failed, and a server with
// no key say so in plain words; the off state names the env var, never a value.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: its own (support.mjs AI_SUGGEST_PORTS: the server with the stub, one with no key, a staging environment).
// Screenshots (light and dark) go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, client, fakeCodec, makeFixture, makePng } from '../test/helpers.mjs';
import * as stubCore from '../test/stub-core.mjs';
import { STAGING, commit, envConfig, makeEnvFixture, page as envPage, plan as makePlan, sh } from '../test/env-fixture.mjs';
import { buildEditor } from './build-editor.mjs';
import { AI_SUGGEST_PORTS, SHOTS, pw, skip, blank } from './support.mjs';

const [PORT, OFF_PORT, ENV_PORT] = AI_SUGGEST_PORTS;
const at = (port) => `http://127.0.0.1:${port}`;
// the stub provider (src/ai/provider.mjs): fixed answers, no network; enough asks a minute for the whole file
const AI = { provider: 'stub', perMinute: 60 };
// no key from the shell reaches these servers: the one with no `ai` must be off, and nothing may call out
delete process.env.MARKSTAGE_AI_KEY;

// a picture for the screenshots: the canvas and the cover ask for files the site's dev server would serve
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320" viewBox="0 0 1200 640"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6c58a"/><stop offset="1" stop-color="#9cc4e4"/></linearGradient></defs><rect width="1200" height="640" fill="url(#s)"/><rect y="420" width="1200" height="220" fill="#2f6f9f"/><path d="M180 420h260l-40 50H220z" fill="#7a4b2a"/><rect x="300" y="300" width="8" height="120" fill="#3b2a1e"/><path d="M308 300l90 100h-90z" fill="#fff"/><path d="M700 430h300l-50 45H740z" fill="#a3362c"/><circle cx="960" cy="150" r="56" fill="#fde7b0"/></svg>`;

// the site's own config: the posts, and a French region that may have its own title and description
const SITE_CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  locales: [{ code: 'en-CA', prefix: '' }, { code: 'fr-CA', prefix: '/fr', overrides: ['title', 'description'] }],
};
`;

const POST = `---\ntitle: A morning at the harbour\nauthor: alice\ndate: '2026-03-02T10:00:00.000Z'\nmodified: '2026-03-03T10:00:00.000Z'\nexcerpt: Boats, gulls and coffee.\ncover: harbour.png\n---\n\nWe walked down early.\n\n![](../../assets/uploads/harbour.png)\n\nThe boats came in.\n`;
// the stub's triggers: a 429 and a 502
const RATE = `---\ntitle: STUB-RATE notes\nauthor: alice\ndate: '2026-03-04T10:00:00.000Z'\nmodified: '2026-03-04T10:00:00.000Z'\n---\n\nShort.\n`;
// a page with a picture in its first section (the pages editor's image field: src and alt)
const HOME = { title: 'Home', uri: '/', sections: [{ discriminant: 'hero', value: { heading: 'Welcome aboard', picture: { src: 'harbour.png', alt: '' } } }] };
const FAIL = `---\ntitle: STUB-FAIL notes\nauthor: alice\ndate: '2026-03-05T10:00:00.000Z'\nmodified: '2026-03-05T10:00:00.000Z'\n---\n\nShort.\n`;

const EDITOR = {
  api: '/markstage/api/',
  siteName: 'Test site',
  collections: [
    {
      id: 'posts',
      label: 'Posts',
      format: 'md',
      dir: 'src/content/blog',
      hasUrl: true,
      titleKey: 'title',
      settings: [
        { type: 'textarea', key: 'excerpt', label: 'Excerpt' },
        { type: 'image', key: 'cover', label: 'Cover image', alt: 'coverAlt' },
        { type: 'seo', label: 'Search', title: 'seo.title', description: 'seo.description' },
      ],
    },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
  ],
  locales: {
    list: [
      { code: 'en-CA', prefix: '', default: true, label: 'English (Canada)', variety: null, hasSpelling: false, overrides: [] },
      { code: 'fr-CA', prefix: '/fr', default: false, label: 'Français (Canada)', variety: null, hasSpelling: false, overrides: ['title', 'description'] },
    ],
    xDefault: 'en-CA',
    overridesKey: 'locales',
  },
  compat: null,
  canvas: { articleClass: '', bodyClass: '' },
};

/** A fixture site with the harbour post (and the stub's triggers), its server on `port`; `ai` in its config or not. */
async function siteServer(port, ai) {
  const fx = makeFixture({ checks: false });
  fs.writeFileSync(path.join(fx.site, 'src/content/blog/harbour.md'), POST);
  fs.writeFileSync(path.join(fx.site, 'src/content/blog/rate.md'), RATE);
  fs.writeFileSync(path.join(fx.site, 'src/content/blog/fail.md'), FAIL);
  fs.writeFileSync(path.join(fx.site, 'src/content/pages/home.json'), `${JSON.stringify(HOME, null, 2)}\n`);
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
  // the picture the AI looks at (the canvas's and the cover's)
  fs.writeFileSync(path.join(fx.site, 'src/assets/uploads/harbour.png'), makePng());
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Harbour');
  if (ai) {
    const cfgPath = path.join(fx.data, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), ai }, null, 2));
  }
  const editorDir = await buildEditor(path.join(fx.run, 'editor'), EDITOR);
  const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port, editorDir, collections: [] } });
  const app = await createMarkstage(config, { codec: fakeCodec });
  await app.listen(port, '127.0.0.1');
  app.backup.stop();
  const owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
  return { fx, app, owner, base: at(port) };
}

describe('AI suggestions in a browser', { skip }, () => {
  let on, off, env, browser, ctx, page, scheme;
  const read = (rel) => fs.readFileSync(path.join(on.fx.site, rel), 'utf8');
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const params = () => Object.fromEntries(new URLSearchParams(hash().split('?')[1] ?? ''));
  const card = (scope = page) => scope.locator('.ms-ai');
  /** Waits until the card has an answer (or a refusal): its state. */
  const settled = async (scope = page) => {
    await scope.locator('.ms-ai[data-ai-state]:not([data-ai-state="loading"])').waitFor();
    const state = await card(scope).getAttribute('data-ai-state');
    // a refusal says why in the test's output
    if (!['ready', 'off'].includes(state)) console.log(`card ${state}: ${await card(scope).locator('.ms-ai__state').textContent()}`);
    return state;
  };
  /** Light and dark, with the card in view. */
  const shot = async (name) => {
    if (!SHOTS) return;
    await card().last().evaluate((e) => e.scrollIntoView({ block: 'center' }));
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `ai-${name}-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: scheme });
  };
  const suggestCalls = [];
  const saved = () => page.locator('.ms-status[data-status="saved"]').waitFor();

  async function signIn(base, who, to) {
    await page.goto(`${base}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }

  before(async () => {
    on = await siteServer(PORT, AI);
    off = await siteServer(OFF_PORT, null);
    // a staging environment with a promotion ready to run (my-change brings a pricing page)
    const efx = makeEnvFixture();
    const editorDir = await buildEditor(path.join(efx.run, 'editor'), { ...EDITOR, siteName: 'Env site', locales: undefined });
    fs.writeFileSync(path.join(efx.stagingData, 'config.json'), JSON.stringify(envConfig(efx, 'staging', { environment: STAGING(null), extra: { ai: AI } }), null, 2));
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: efx.stagingData, NODE_ENV: 'test' }, overrides: { port: ENV_PORT, editorDir } });
    const app = await createMarkstage(config, { codec: fakeCodec, core: stubCore });
    await app.listen(ENV_PORT, '127.0.0.1');
    app.backup.stop();
    const owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
    const c = client(at(ENV_PORT));
    await c.login(owner.email, owner.password);
    sh(efx.laptop, 'checkout', '-q', '-b', 'my-change');
    commit(efx.laptop, { 'src/content/pages/pricing.json': envPage('Pricing', '/pricing/', 'Plans and prices') }, 'A pricing page', { push: 'my-change' });
    const p = await makePlan(c, { app }, { action: 'promote', source: 'my-change' });
    assert.equal(p.status, 'ready');
    env = { app, owner, plan: p, base: at(ENV_PORT) };

    browser = await pw.chromium.launch();
    scheme = 'light';
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    for (const b of [on.base, off.base, env.base]) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: b });
    // the pictures (the site's dev server would serve them); the AI routes are the server's own
    await ctx.route(/\/(src\/assets\/uploads\/)?harbour\.png$/, (r) => r.fulfill({ contentType: 'image/svg+xml', body: PICTURE }));
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('request', (r) => r.url().endsWith('/api/ai/suggest') && suggestCalls.push(r.postDataJSON()));
  });
  after(async () => {
    await browser?.close();
    await on?.app.close();
    await off?.app.close();
    await env?.app.close();
  });

  test('alt text for an image on the canvas: its own URL, the card under the alt line, Back and Forward, Accept, ⌘Z, ⌘S', async () => {
    await signIn(on.base, on.owner, '#/e/posts/harbour');
    const img = page.locator('.ProseMirror .ms-image').first();
    await img.click();
    await img.locator('.ms-image__altbtn').click();
    await img.getByRole('button', { name: 'Suggest alt text' }).click();
    assert.deepEqual([params().suggest, params().img], ['alt', '1']);
    assert.equal(await settled(img), 'ready');
    const c = card(img);
    assert.equal((await c.locator('.ms-ai__now .ms-ai__val').textContent()).trim(), 'Empty');
    const suggested = (await c.locator('.ms-ai__suggested .ms-copyable__text').textContent()).trim();
    assert.equal(suggested, 'A photo: harbour.png');
    assert.equal(await c.locator('.ms-ai__note').textContent(), 'Written by AI (stub): read it before you accept. Nothing changes until you do.');
    assert.deepEqual(suggestCalls.at(-1), { kind: 'alt', image: '../../assets/uploads/harbour.png', collection: 'posts', id: 'harbour' });
    // the copy icon gives the suggestion
    await c.locator('.ms-ai__suggested').hover();
    await c.getByRole('button', { name: 'Copy the suggested alt text' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), suggested);
    await shot('canvas-alt');

    // Dismiss closes it; Back opens it again (asked again: nothing was kept), Forward closes it
    await c.getByRole('button', { name: 'Dismiss', exact: true }).click();
    assert.equal(params().suggest, undefined);
    assert.equal(await card().count(), 0);
    await page.goBack();
    await page.waitForFunction(() => location.hash.includes('suggest=alt'));
    assert.equal(await settled(img), 'ready');
    await page.goForward();
    await page.waitForFunction(() => !location.hash.includes('suggest='));
    assert.equal(await card().count(), 0);

    // a deep link opens it too; Accept writes the alt text as typing does (unsaved), ⌘Z takes it back
    await page.goto(`${on.base}/markstage/#/e/posts/harbour?suggest=alt&img=1`);
    assert.equal(await settled(img), 'ready');
    await card(img).locator('[data-ai-accept]').click();
    assert.equal(params().suggest, undefined, 'accepted: the card is gone from the URL');
    await img.locator('.ms-image__altbtn').click();
    assert.equal((await img.locator('.ms-image__alt').textContent()).trim(), suggested);
    assert.equal(await page.locator('.ms-status').getAttribute('data-status'), 'dirty');
    await page.locator('.ProseMirror p').first().click();
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await img.locator('img').getAttribute('alt'), '');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    assert.equal(await img.locator('img').getAttribute('alt'), suggested);
    await page.keyboard.press('ControlOrMeta+s');
    await saved();
    assert.ok(read('src/content/blog/harbour.md').includes(`![${suggested}](../../assets/uploads/harbour.png)`), 'saved through the one save path');
  });

  test('alt text in the image block’s settings panel: its own URL, Edit then accept, ⌘Z, Back, a deep link', async () => {
    await page.goto(`${on.base}/markstage/#/e/posts/harbour`);
    const img = page.locator('.ProseMirror .ms-image').first();
    await img.locator('img').click();
    const panel = page.locator('.ms-panel:not(.ms-drawer):not(.ms-checks)');
    await panel.locator('.ms-panel__title', { hasText: 'Image settings' }).waitFor();
    const block = params().b;
    assert.ok(block, 'the image block is selected');
    await panel.getByRole('button', { name: 'Suggest alt text' }).click();
    assert.deepEqual([params().b, params().suggest, params().img, params().at], [block, 'alt', '1', 'panel']);
    assert.equal(await settled(panel), 'ready');
    assert.equal(await card(img).count(), 0, 'not on the canvas too: the panel is its place');
    const c = card(panel);
    // the alt text saved by the canvas's test is the one there now
    assert.equal((await c.locator('.ms-ai__now .ms-ai__val').textContent()).trim(), 'A photo: harbour.png');
    assert.deepEqual(suggestCalls.at(-1), { kind: 'alt', image: '../../assets/uploads/harbour.png', collection: 'posts', id: 'harbour' });
    await shot('panel-alt');
    await c.getByRole('button', { name: 'Edit then accept' }).click();
    await c.getByLabel('Yours').fill('Two boats tied up at the harbour wall');
    await c.locator('[data-ai-accept]').click();
    assert.equal(params().at, undefined, 'accepted: the card is gone from the URL');
    const alt = panel.getByLabel('Alt text', { exact: true });
    assert.equal(await alt.inputValue(), 'Two boats tied up at the harbour wall');
    assert.equal(await img.locator('img').getAttribute('alt'), 'Two boats tied up at the harbour wall');
    // a change on the canvas: ⌘Z takes it back, ⇧⌘Z puts it back
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await img.locator('img').getAttribute('alt'), 'A photo: harbour.png');
    assert.equal(await alt.inputValue(), 'A photo: harbour.png');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    assert.equal(await alt.inputValue(), 'Two boats tied up at the harbour wall');
    // Back opens it again; another block closes it
    await page.goBack();
    assert.equal(params().at, 'panel');
    assert.equal(await settled(panel), 'ready');
    await page.locator('.ProseMirror p').last().click();
    await page.waitForFunction(() => !location.hash.includes('suggest='));
    await page.keyboard.press('ControlOrMeta+s');
    await saved();
    assert.ok(read('src/content/blog/harbour.md').includes('![Two boats tied up at the harbour wall](../../assets/uploads/harbour.png)'));
    // a deep link selects the block and opens the card in its panel
    await blank(page);
    await page.goto(`${on.base}/markstage/#/e/posts/harbour?b=${block}&suggest=alt&img=1&at=panel`);
    assert.equal(await settled(panel), 'ready');
    await card(panel).getByRole('button', { name: 'Dismiss', exact: true }).click();
    assert.equal(params().suggest, undefined);
    assert.equal(params().b, block, 'the block stays selected');
  });

  test('alt text for a cover in Post settings: Edit then accept, ⌘Z and ⇧⌘Z, the toast’s Undo, ⌘S', async () => {
    await page.goto(`${on.base}/markstage/#/e/posts/harbour?s=1`);
    const pick = page.locator('[data-setting="cover"]');
    await pick.getByRole('button', { name: 'Suggest alt text' }).click();
    assert.deepEqual([params().s, params().suggest, params().field], ['1', 'alt', 'cover']);
    assert.equal(await settled(pick), 'ready');
    assert.deepEqual(suggestCalls.at(-1), { kind: 'alt', image: 'harbour.png', collection: 'posts', id: 'harbour' });
    await shot('cover-alt');
    await card(pick).getByRole('button', { name: 'Edit then accept' }).click();
    const box = card(pick).getByLabel('Yours');
    await box.fill('Fishing boats at the harbour wall, at dawn');
    await card(pick).locator('[data-ai-accept]').click();
    const alt = pick.getByLabel('Alt text', { exact: true });
    assert.equal(await alt.inputValue(), 'Fishing boats at the harbour wall, at dawn');
    // the focus is back on the button that asked: ⌘Z there takes it back, ⇧⌘Z puts it back
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Suggest alt text');
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await alt.inputValue(), '');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    assert.equal(await alt.inputValue(), 'Fishing boats at the harbour wall, at dawn');
    // Undo on the toast puts it back
    await page.locator('.ms-toast').filter({ hasText: 'Alt text of cover image set' }).getByRole('button', { name: 'Undo' }).click();
    assert.equal(await alt.inputValue(), '');
    // again, and saved
    await page.goBack();
    assert.equal(params().suggest, 'alt');
    assert.equal(await settled(pick), 'ready');
    await card(pick).getByRole('button', { name: 'Edit then accept' }).click();
    await card(pick).getByLabel('Yours').fill('Fishing boats at the harbour wall, at dawn');
    await card(pick).locator('[data-ai-accept]').click();
    await page.keyboard.press('ControlOrMeta+s');
    await saved();
    assert.match(read('src/content/blog/harbour.md'), /^coverAlt: Fishing boats at the harbour wall, at dawn$/m);
  });

  test('alt text for an image field in the pages editor: its own URL, Dismiss, Back, Accept, ⌘Z, ⌘S', async () => {
    await page.goto(`${on.base}/markstage/#/p/pages/home?sec=0`);
    const field = page.locator('fieldset.msp-image[data-path="sections.0.value.picture"]');
    await field.getByRole('button', { name: 'Suggest alt text' }).click();
    assert.deepEqual([params().sec, params().suggest, params().field], ['0', 'alt', 'sections.0.value.picture']);
    assert.equal(await settled(field), 'ready');
    assert.deepEqual(suggestCalls.at(-1), { kind: 'alt', image: 'harbour.png', collection: 'pages', id: 'home' });
    const c = card(field);
    assert.equal((await c.locator('.ms-ai__now .ms-ai__val').textContent()).trim(), 'Empty');
    assert.equal((await c.locator('.ms-ai__suggested .ms-copyable__text').textContent()).trim(), 'A photo: harbour.png');
    await shot('pages-alt');
    await c.getByRole('button', { name: 'Dismiss', exact: true }).click();
    assert.equal(params().suggest, undefined);
    assert.equal(await card().count(), 0);
    await page.goBack();
    assert.equal(params().field, 'sections.0.value.picture');
    assert.equal(await settled(field), 'ready');
    await card(field).locator('[data-ai-accept]').click();
    assert.equal(params().suggest, undefined, 'accepted: the card is gone from the URL');
    const alt = field.locator('.ms-field', { has: page.locator('.ms-field__label', { hasText: /^Alt text$/ }) }).locator('input');
    assert.equal(await alt.inputValue(), 'A photo: harbour.png');
    // the focus is back on the button that asked: ⌘Z there is the page's undo
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Suggest alt text');
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await alt.inputValue(), '');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    assert.equal(await alt.inputValue(), 'A photo: harbour.png');
    await page.keyboard.press('ControlOrMeta+s');
    await saved();
    assert.equal(JSON.parse(read('src/content/pages/home.json')).sections[0].value.picture.alt, 'A photo: harbour.png');
    // a deep link opens it; another section's params close it
    await blank(page);
    await page.goto(`${on.base}/markstage/#/p/pages/home?sec=0&suggest=alt&field=sections.0.value.picture`);
    assert.equal(await settled(field), 'ready');
  });

  test('the SEO check: Suggest title and description, both next to what is there now, Accept, ⌘Z, ⌘S', async () => {
    await page.goto(`${on.base}/markstage/#/e/posts/harbour?side=seo`);
    const seo = page.locator('.ms-seo');
    await seo.getByRole('button', { name: 'Suggest title and description' }).click();
    assert.deepEqual([params().side, params().suggest], ['seo', 'seo']);
    assert.equal(await settled(seo), 'ready');
    const sent = suggestCalls.at(-1);
    assert.deepEqual([sent.kind, sent.collection, sent.id, sent.title], ['seo', 'posts', 'harbour', 'A morning at the harbour']);
    assert.match(sent.text, /We walked down early\.\n\n[\s\S]*The boats came in\./, 'the text as it is now');
    const c = card(seo);
    assert.deepEqual(await c.locator('.ms-ai__label').allTextContents(), ['Search title', 'Search description']);
    assert.equal((await c.locator('[data-ai-field="title"] .ms-ai__now').textContent()).replace('Now', '').trim(), 'Empty: the title is used');
    const [title, description] = (await c.locator('.ms-ai__suggested .ms-copyable__text').allTextContents()).map((t) => t.trim());
    assert.deepEqual([title, description], ['A morning at the harbour | stub', 'Stub description of A morning at the harbour.']);
    await shot('seo');
    await c.locator('[data-ai-accept]').click();
    const serpTitle = (t) => page.waitForFunction((want) => document.querySelector('.ms-seo .ms-seo-serp__title')?.textContent === want, t);
    await serpTitle('A morning at the harbour | stub');
    // the focus is back on the button that asked: ⌘Z there takes both back (one step), ⇧⌘Z puts them back
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Suggest title and description');
    await page.keyboard.press('ControlOrMeta+z');
    await serpTitle('A morning at the harbour');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await serpTitle('A morning at the harbour | stub');
    await page.keyboard.press('ControlOrMeta+s');
    await saved();
    assert.match(read('src/content/blog/harbour.md'), /^seo:\n {2}title: A morning at the harbour \| stub\n {2}description: Stub description of A morning at the harbour\.$/m);
  });

  test('a region’s title and description: Draft translation, Dismiss, Back, Accept, ⌘Z, under locales.fr-CA', async () => {
    await page.goto(`${on.base}/markstage/#/e/posts/harbour?s=1`);
    const box = page.locator('.ms-locales');
    await box.getByRole('button', { name: 'Draft translation for Français (Canada)' }).click();
    assert.deepEqual([params().suggest, params().loc], ['translate', 'fr-CA']);
    assert.equal(await settled(box), 'ready');
    const sent = suggestCalls.at(-1);
    // the base title and the search description (saved above) as the writer sees them
    assert.deepEqual(sent, { kind: 'translate', collection: 'posts', id: 'harbour', locale: 'fr-CA', fields: { title: 'A morning at the harbour', description: 'Stub description of A morning at the harbour.' } });
    await shot('translate');
    await card(box).getByRole('button', { name: 'Dismiss', exact: true }).click();
    assert.equal(params().suggest, undefined);
    await page.goBack();
    assert.equal(await settled(box), 'ready');
    await card(box).locator('[data-ai-accept]').click();
    assert.equal(await box.getByLabel('Title on Français (Canada)').inputValue(), 'A morning at the harbour (stub)');
    assert.equal(await box.getByLabel('Description on Français (Canada)').inputValue(), 'Stub description of A morning at the harbour. (stub)');
    // one step: ⌘Z takes both back, ⇧⌘Z puts both back
    await page.keyboard.press('ControlOrMeta+z');
    assert.deepEqual([await box.getByLabel('Title on Français (Canada)').inputValue(), await box.getByLabel('Description on Français (Canada)').inputValue()], ['', '']);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    assert.equal(await box.getByLabel('Title on Français (Canada)').inputValue(), 'A morning at the harbour (stub)');
    await page.keyboard.press('ControlOrMeta+s');
    await saved();
    assert.match(read('src/content/blog/harbour.md'), /^locales:\n {2}fr-CA:\n {4}title: A morning at the harbour \(stub\)$/m);
  });

  test('too many, and a failure, in plain words; nothing changes', async () => {
    await page.goto(`${on.base}/markstage/#/e/posts/rate?side=seo&suggest=seo`);
    assert.equal(await settled(page.locator('.ms-seo')), 'rate');
    assert.equal(await card().locator('.ms-ai__state').textContent(), 'The AI provider is busy with this site’s key. Try again in a little while.');
    assert.equal(await card().getByRole('button', { name: 'Try again' }).isDisabled(), true, 'not before the wait');
    await shot('rate');
    await page.goto(`${on.base}/markstage/#/e/posts/fail?side=seo&suggest=seo`);
    assert.equal(await settled(page.locator('.ms-seo')), 'failed');
    assert.equal(await card().locator('.ms-ai__state').textContent(), 'The AI provider answered with an error (500). Try again in a moment. Nothing was changed.');
    assert.equal(await card().getByRole('button', { name: 'Try again' }).isDisabled(), false);
    await shot('failed');
  });

  test('a promotion plan: Summarize changes beside the Reason, Accept fills it, ⌘Z in the box takes it back', async () => {
    const to = `#/environments/plans/${env.plan.id}`;
    await signIn(env.base, env.owner, to);
    await page.getByRole('button', { name: 'Summarize changes' }).click();
    assert.equal(params().suggest, 'summary');
    assert.equal(await settled(), 'ready');
    assert.deepEqual(suggestCalls.at(-1), { kind: 'summary', plan: env.plan.id });
    const text = (await card().locator('.ms-ai__suggested .ms-copyable__text').textContent()).trim();
    assert.match(text, /^Stub summary: \d+ files\.$/);
    await shot('plan-summary');
    await card().locator('[data-ai-accept]').click();
    const reason = page.locator('#ms-env-run-reason');
    assert.equal(await reason.inputValue(), text.slice(0, 500));
    assert.equal(params().suggest, undefined);
    await reason.focus();
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await reason.inputValue(), '');
    await page.goBack();
    assert.equal(await settled(), 'ready');
  });

  test('with no key: off, the env var by name with a copy icon, no suggestion asked for', async () => {
    const before = suggestCalls.length;
    await signIn(off.base, off.owner, '#/e/posts/harbour?side=seo&suggest=seo');
    assert.equal(await settled(page.locator('.ms-seo')), 'off');
    const words = await card().locator('.ms-ai__state').textContent();
    assert.equal(words, 'AI suggestions are off on this server. To turn them on, set MARKSTAGE_AI_KEY where the server runs (the key itself stays out of the content repo), then restart it.');
    await card().locator('.ms-ai__env').hover();
    await card().getByRole('button', { name: 'Copy the environment variable name' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'MARKSTAGE_AI_KEY');
    assert.equal(suggestCalls.length, before, 'no suggestion asked for');
    await shot('off');
  });
});
