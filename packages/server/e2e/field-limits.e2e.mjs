// A field-limited custom role in the editor (editor src/field-access.ts, the entry's can.fields), in a real browser at
// 1440 against a real server whose site has a French region: a French translator opens a post and sees what their role
// changes in the banner; the title, the text, the excerpt, the tags and the US region's fields are greyed out (still
// readable), the French ones are not, and there is no "Click any text to edit" hint; typing on the canvas changes
// nothing; a French title saved with ⌘S changes only that key in the file (the text is not sent); the Source view is
// read-only. The owner, on the same post, has nothing greyed out. Light and dark. The test people are made up here,
// with generated passwords; the browser opened here is closed in `after`.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: its own (support.mjs FIELDS_UI_PORT). Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, client, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { FIELDS_UI_PORT as PORT, SHOTS, pw, skip } from './support.mjs';

const BASE = `http://127.0.0.1:${PORT}`;

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
const HARBOUR = `---
title: The harbour
author: alice
date: '2026-03-02T10:00:00.000Z'
excerpt: Boats and gulls.
tags:
  - sea
locales:
  fr-CA:
    title: Le port
---

Boats rock in the harbour.
`;
const LOCALES = {
  list: [
    { code: 'en-CA', prefix: '', default: true, label: 'English (Canada)', variety: null, hasSpelling: false, overrides: [] },
    { code: 'en-US', prefix: '/en-us', default: false, label: 'English (US)', variety: null, hasSpelling: false, overrides: ['title', 'description'] },
    { code: 'fr-CA', prefix: '/fr', default: false, label: 'Français (Canada)', variety: null, hasSpelling: false, overrides: ['title', 'description'] },
  ],
  xDefault: 'en-CA',
  overridesKey: 'locales',
};
const TRANSLATOR = {
  id: 'translator-fr',
  name: 'French translator',
  base: 'contributor',
  rules: [{ id: 'fr-words', name: 'Edits the French words of posts', action: ['entry.edit'], collections: ['posts'], fields: ['locales.fr-CA.**'], effect: 'allow' }],
};

describe('a field-limited role in the editor: what it may not change is greyed out', { skip, timeout: 180_000 }, () => {
  let fx, app, browser, ctx, page, owner, tess;
  const file = () => fs.readFileSync(path.join(fx.site, 'src/content/blog/harbour.md'), 'utf8');
  const field = (key) => page.locator(`.ms-settings [data-setting="${key}"]`);
  const status = (s) => page.locator(`.ms-status[data-status="${s}"]`);
  /** Light and dark. */
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `field-limits-${name}-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
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
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/harbour.md'), HARBOUR);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'The harbour, in French too');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
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
            { type: 'tags', key: 'tags', label: 'Tags' },
          ],
        },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      locales: LOCALES,
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
    tess = await addUser(app, { email: 'tess@example.test', name: 'Tess Translator', role: 'contributor' });
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    assert.equal((await c.post('/roles', TRANSLATOR)).status, 201);
    assert.equal((await c.patch(`/users/${tess.id}`, { customRole: 'translator-fr' })).status, 200);
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    await browser?.close();
    await app?.close();
  });

  test('the translator: the banner says what the role changes; the rest is greyed out, still readable', async () => {
    await signIn(tess, '#/e/posts/harbour?s=1');
    await field('locales').waitFor();
    assert.equal((await page.locator('.ms-banner:not(.ms-presence)').innerText()).trim(), 'Your role changes only locales.fr-CA.** here. The rest is greyed out.');
    // the title and the text: shown, not editable
    assert.equal(await page.locator('.ms-title').textContent(), 'The harbour');
    assert.equal(await page.locator('.ms-title').getAttribute('contenteditable'), null);
    assert.equal(await page.locator('.ProseMirror').getAttribute('contenteditable'), 'false');
    assert.equal(await page.locator('.ms-hint').count(), 0, 'no "Click any text to edit" on a text that is not theirs');
    // the excerpt and the tags: greyed out, read-only, with why; a tag has no remove button
    for (const key of ['excerpt', 'tags']) {
      assert.match(await field(key).getAttribute('class'), /\bis-locked\b/, key);
      assert.equal(await field(key).locator('.ms-field__locked').textContent(), 'Your role can’t change this.');
    }
    assert.equal(await field('excerpt').locator('textarea').evaluate((t) => t.readOnly), true);
    assert.equal(await field('excerpt').locator('textarea').inputValue(), 'Boats and gulls.', 'still readable');
    assert.equal(await field('tags').locator('.ms-tag__x').count(), 0);
    assert.equal(await field('tags').locator('input').evaluate((t) => t.readOnly), true);
    // the regions: the French fields are theirs, the US ones are not
    const fr = page.getByLabel('Title on Français (Canada)');
    const us = page.getByLabel('Title on English (US)');
    assert.equal(await fr.evaluate((t) => t.readOnly), false);
    assert.equal(await page.getByLabel('Description on Français (Canada)').evaluate((t) => t.readOnly), false);
    assert.equal(await us.evaluate((t) => t.readOnly), true);
    assert.match(await us.locator('xpath=ancestor::div[contains(@class,"ms-field")][1]').getAttribute('class'), /\bis-locked\b/);
    assert.equal(await page.locator('.ms-settings .ms-field.is-locked').count(), 4, 'excerpt, tags, and the US title and description');
    // an AI draft only for the region they translate
    assert.equal(await page.getByRole('button', { name: 'Draft translation for Français (Canada)' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Draft translation for English (US)' }).count(), 0);
    // the drawer's greyed-out styles hold in both themes: a dashed border on a read-only box
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      assert.equal(await field('excerpt').locator('textarea').evaluate((t) => getComputedStyle(t).borderStyle), 'dashed', s);
      assert.equal(await fr.evaluate((t) => getComputedStyle(t).borderStyle), 'solid', s);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await shot('drawer');
    await page.getByLabel('Description on Français (Canada)').scrollIntoViewIfNeeded();
    await shot('regions');
  });

  test('typing on the canvas or in a greyed-out field changes nothing; a French title is saved alone', async () => {
    await page.locator('.ProseMirror p').first().click();
    await page.keyboard.type('xyz');
    await field('excerpt').locator('textarea').click();
    await page.keyboard.type('more');
    await field('tags').locator('input').click();
    await page.keyboard.press('Backspace');
    assert.equal(await page.locator('.ProseMirror p').first().textContent(), 'Boats rock in the harbour.');
    assert.equal(await field('excerpt').locator('textarea').inputValue(), 'Boats and gulls.');
    assert.equal(await field('tags').locator('.ms-tag').count(), 1);
    await status('saved').waitFor();
    const before = file();
    const sent = [];
    page.on('request', (r) => r.method() === 'PUT' && r.url().includes('/entries/harbour') && sent.push(JSON.parse(r.postData() ?? '{}')));
    await page.getByLabel('Title on Français (Canada)').fill('Le port au matin');
    await status('dirty').waitFor();
    await page.keyboard.press('ControlOrMeta+s');
    await status('saved').waitFor();
    // the save carries the French title alone, never the text
    assert.deepEqual(sent.map((b) => [Object.keys(b).sort(), b.frontmatter]), [[['frontmatter', 'version'], { locales: { 'fr-CA': { title: 'Le port au matin' } } }]]);
    assert.equal(file(), before.replace('    title: Le port\n', '    title: Le port au matin\n'), 'only the French title changed in the file');
    await shot('saved');
  });

  test('the Source view is read-only for a role that changes some fields only', async () => {
    await page.locator('[data-view="source"]').click();
    const content = page.locator('.cm-content');
    await content.waitFor();
    assert.equal(await content.getAttribute('aria-readonly'), 'true');
    await content.click();
    await page.keyboard.type('xyz');
    assert.ok(!(await content.textContent()).includes('xyz'));
    assert.equal(await page.locator('.ms-status').getAttribute('data-status'), 'saved');
    await page.locator('[data-view="visual"]').click();
    await page.locator('.ProseMirror').waitFor();
  });

  test('the owner, on the same post: nothing greyed out', async () => {
    await ctx.clearCookies();
    await page.emulateMedia({ colorScheme: 'dark' });
    await signIn(owner, '#/e/posts/harbour?s=1');
    await field('locales').waitFor();
    assert.equal(await page.locator('.ms-settings .is-locked').count(), 0);
    assert.equal(await page.locator('.ProseMirror').getAttribute('contenteditable'), 'true');
    assert.equal(await page.locator('.ms-hint').count(), 1, 'the first text this browser may change has the hint');
    assert.equal(await page.locator('.ms-title').getAttribute('contenteditable'), 'plaintext-only');
    assert.equal(await page.getByLabel('Title on English (US)').evaluate((t) => t.readOnly), false);
    assert.equal(await page.locator('.ms-banner:not(.ms-presence)').isVisible(), false);
    await page.locator('[data-view="source"]').click();
    await page.locator('.cm-content').waitFor();
    assert.equal(await page.locator('.cm-content').getAttribute('aria-readonly'), null);
    await page.emulateMedia({ colorScheme: 'light' });
  });
});
