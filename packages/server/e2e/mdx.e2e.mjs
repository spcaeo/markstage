// An MDX guide in the editor (docs/MDX.md), in a real browser at 1440 against a real server, on a copy of the example
// blog's guide (examples/blog/src/content/guides/writing-in-mdx.mdx): the imports and the export are quiet locked
// lines, each component a card with its name and settings; the Callout's settings open in the side panel, the
// Chart's data shows as code (read-only), its height as a number. A paragraph edited and the Callout's type changed,
// then saved: the commit's diff is exactly those two lines. Deleting everything leaves the imports. A file the MDX
// reader cannot read opens read-only in Source mode, with a plain message. The test people are made up here, with
// generated passwords; the browser opened here is closed in `after`.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: its own (support.mjs MDX_PORT). Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { MDX_PORT as PORT, SHOTS, pw, skip } from './support.mjs';

const BASE = `http://127.0.0.1:${PORT}`;
const GUIDE = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/blog/src/content/guides/writing-in-mdx.mdx'), 'utf8');
const BROKEN = `---
title: Half written
---
Text.

<Callout type="tip">
`;
const SITE_CONFIG = `export default {
  collections: [
    { id: 'guides', label: 'Guides', format: 'mdx', dir: 'src/content/guides', url: '/guides/{id}/' },
  ],
};
`;

describe('an MDX guide in the editor: words edited, components as cards, code kept', { skip, timeout: 180_000 }, () => {
  let fx, app, browser, page, owner, base;
  const rel = (id) => `src/content/guides/${id}.mdx`;
  const file = () => fs.readFileSync(path.join(fx.site, rel('writing-in-mdx')), 'utf8');
  const status = (s) => page.locator(`.ms-status[data-status="${s}"]`);
  const card = (name) => page.locator(`.ms-mdx-card[data-name="${name}"]`);
  const shot = async (name) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `mdx-${name}.png`) });
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    // this site has no posts collection, so no compat API on one
    const cfgPath = path.join(fx.data, 'config.json');
    const { compat: _, ...cfg } = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    fs.mkdirSync(path.join(fx.site, 'src/content/guides'), { recursive: true });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    fs.writeFileSync(path.join(fx.site, rel('writing-in-mdx')), GUIDE);
    fs.writeFileSync(path.join(fx.site, rel('half-written')), BROKEN);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Two guides');
    base = fx.git('rev-parse', 'HEAD').trim();
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [{ id: 'guides', label: 'Guides', format: 'md', mdx: true, dir: 'src/content/guides', hasUrl: true, titleKey: 'title' }],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
    browser = await pw.chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/e/guides/writing-in-mdx')}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/e/guides/writing-in-mdx'));
  });
  after(async () => {
    await browser?.close();
    await app?.close();
  });

  test('the code is quiet locked lines, each component a card with its name and settings', async () => {
    await card('Callout').waitFor();
    const esm = page.locator('.ms-mdx-code[data-ms-mdx="esm"]');
    assert.equal(await esm.count(), 2, 'the imports, and the export');
    assert.match(await esm.first().innerText(), /Uses 2 components: Callout, Chart\./);
    assert.equal(await esm.first().getAttribute('contenteditable'), 'false');
    assert.equal(await card('Callout').locator('.ms-mdx-card__props').textContent(), 'type="tip"  title="Try it"');
    assert.equal(await card('Chart').locator('.ms-mdx-card__props').textContent(), 'data={…}  height={160}  unit="saves"');
    // the Callout's text is typed in like any other; the card's head is not
    assert.equal(await card('Callout').locator('.ms-mdx-card__body p').innerText(), 'Click this box. Its settings open on the right: change the type to warn and the box turns orange when you save.');
    assert.equal(await card('Callout').locator('.ms-mdx-card__head').getAttribute('contenteditable'), 'false');
    await card('Callout').scrollIntoViewIfNeeded();
    await shot('card');
  });

  test('the side panel: the Callout’s text settings change; the Chart’s data is code, its height a number', async () => {
    await card('Chart').click();
    const panel = page.locator('.ms-panel.is-open');
    await panel.waitFor();
    assert.equal(await panel.locator('.ms-panel__title').innerText(), 'Component settings');
    assert.equal(await panel.locator('.ms-mdx-prop__name').innerText(), 'The Chart component');
    assert.match(await panel.locator('.ms-mdx-prop[data-prop="data"]').innerText(), /\{saves\}[\s\S]*Code: kept as written/);
    assert.equal(await panel.locator('.ms-mdx-prop[data-prop="data"] input, .ms-mdx-prop[data-prop="data"] textarea').count(), 0, 'code has no box to type in');
    assert.equal(await panel.locator('[data-prop="height"] input').inputValue(), '160');
    assert.equal(await panel.locator('[data-prop="unit"] input').inputValue(), 'saves');

    await card('Callout').locator('.ms-mdx-card__head').click();
    assert.equal(await panel.locator('.ms-mdx-prop__name').innerText(), 'The Callout component');
    const type = panel.locator('[data-prop="type"] input');
    assert.equal(await type.inputValue(), 'tip');
    assert.equal(await panel.locator('[data-prop="title"] input').inputValue(), 'Try it');
    await type.fill('warn');
    await status('dirty').waitFor();
    assert.equal(await card('Callout').locator('.ms-mdx-card__props').textContent(), 'type="warn"  title="Try it"', 'the card follows');
    await shot('panel');
  });

  test('a paragraph and the Callout’s type saved: the diff is exactly those two lines', async () => {
    const first = page.locator('.ProseMirror > p').first();
    await first.click({ position: { x: 2, y: 8 } });
    await page.keyboard.press('Home');
    await page.keyboard.type('Welcome. ');
    await page.keyboard.press('ControlOrMeta+s');
    await status('saved').waitFor();
    const want = GUIDE.replace('This guide is an MDX file.', 'Welcome. This guide is an MDX file.').replace('<Callout type="tip" title="Try it">', '<Callout type="warn" title="Try it">');
    assert.equal(file(), want);
    const diff = fx.git('diff', '--unified=0', base, 'HEAD', '--', rel('writing-in-mdx'));
    const lines = diff.split('\n').filter((l) => /^[-+](?![-+]{2} )/.test(l));
    assert.deepEqual(lines, [
      '-This guide is an MDX file. Markstage opens it like any post: you type the words on the page, and the parts that are code stay exactly as they are written.',
      '+Welcome. This guide is an MDX file. Markstage opens it like any post: you type the words on the page, and the parts that are code stay exactly as they are written.',
      '-<Callout type="tip" title="Try it">',
      '+<Callout type="warn" title="Try it">',
    ]);
  });

  test('select all and delete: the imports and the export stay', async () => {
    await page.locator('.ProseMirror > p').first().click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    assert.equal(await page.locator('.ms-mdx-code[data-ms-mdx="esm"]').count(), 2);
    assert.equal(await status('saved').count(), 1, 'nothing changed');
  });

  test('a file the MDX reader cannot read: read-only in Source mode, with a plain message', async () => {
    await page.goto(`${BASE}/markstage/#/e/guides/half-written`);
    const content = page.locator('.cm-content');
    await content.waitFor();
    assert.match(page.url(), /view=source/);
    assert.equal(await content.getAttribute('aria-readonly'), 'true');
    assert.match(await page.locator('.ms-banner:not(.ms-presence)').innerText(), /This MDX file cannot be shown on the canvas \(line \d+\), so it is open read-only in Source mode\./);
    assert.equal(await page.locator('[data-view="visual"]').isDisabled(), true);
    await content.click();
    await page.keyboard.type('xyz');
    assert.ok(!(await content.textContent()).includes('xyz'));
    assert.equal(fs.readFileSync(path.join(fx.site, rel('half-written')), 'utf8'), BROKEN);
  });
});
