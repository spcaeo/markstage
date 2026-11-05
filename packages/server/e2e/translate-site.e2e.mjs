// Translate the site with AI (#/translate, editor src/translations/site.ts) in a real browser at 1440, against a real
// server with the stub AI (no call leaves the machine) and a French region of its own words: from the Languages
// screen, the choices in the URL, the plan (a dry run: nothing written), the run and its report, the drafts kept
// beside the site and not in any page (nothing published), a draft reviewed in Post settings and saved, and a second
// run that skips what waits for review. Light and dark.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: its own (support.mjs TRANSLATE_SITE_PORT). Screenshots go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { SHOTS, TRANSLATE_SITE_PORT as PORT, blank, pw, skip } from './support.mjs';

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
    { code: 'fr-CA', prefix: '/fr', label: 'Français (Canada)', overrides: ['title', 'description'] },
  ],
};
`;
const LOCALES = {
  list: [
    { code: 'en-CA', prefix: '', default: true, label: 'English (Canada)', variety: null, hasSpelling: false, overrides: [] },
    { code: 'fr-CA', prefix: '/fr', default: false, label: 'Français (Canada)', variety: null, hasSpelling: false, overrides: ['title', 'description'] },
  ],
  xDefault: 'en-CA',
  overridesKey: 'locales',
};
const post = (title, excerpt, fr = null) => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-03-02T10:00:00.000Z'\nexcerpt: ${excerpt}\n${fr ? `locales:\n  fr-CA:\n    title: ${fr[0]}\n    description: ${fr[1]}\n` : ''}---\n\nText.\n`;

describe('translate the site with AI in a browser', { skip, timeout: 180_000 }, () => {
  let fx, app, browser, ctx, page, owner, planSkipTab;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const params = () => Object.fromEntries(new URLSearchParams(hash().split('?')[1] ?? ''));
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const blog = () => Object.fromEntries(fs.readdirSync(path.join(fx.site, 'src/content/blog')).map((f) => [f, read(`src/content/blog/${f}`)]));
  const draftsFile = 'markstage/translations/fr-CA.json';
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `translate-site-${name}-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/harbour.md'), post('The harbour', 'Boats and gulls.'));
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/garden.md'), post('The garden', 'Roses.', ['Le jardin', 'Des roses.']));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Locales');
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
    const cfgPath = path.join(fx.data, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), ai: { provider: 'stub', perMinute: 600 } }, null, 2));
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    // every browser this file opened is closed, pass or fail
    await browser?.close();
    await app?.close();
  });

  test('from Languages: the choices in the URL, then the plan, a dry run that writes nothing', async () => {
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/translations')}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/translations'));
    await page.getByRole('button', { name: 'Translate the site with AI' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/translate'));
    await page.getByLabel('Translate into').waitFor();
    // Pages are not edited in the text editor: shown, not offered
    assert.equal(await page.getByRole('checkbox', { name: /^Pages/ }).isDisabled(), true);
    // a choice is the URL's at once; a link opens the form as it was
    await page.getByRole('checkbox', { name: /^Skip entries/ }).uncheck();
    await page.waitForFunction(() => location.hash.includes('all=1'));
    await blank(page);
    await page.goto(`${BASE}/markstage/#/translate?all=1`);
    assert.equal(await page.getByRole('checkbox', { name: /^Skip entries/ }).isChecked(), false);
    await page.getByRole('checkbox', { name: /^Skip entries/ }).check();
    const head = fx.git('rev-parse', 'HEAD').trim();
    await page.getByRole('button', { name: 'Plan it' }).click();
    await page.waitForURL((u) => /^#\/translate\/tr_/.test(u.hash));
    const lines = page.locator('.ms-trs-lines li');
    await lines.first().waitFor();
    // the garden has its French words: skipped; the fixture's four posts and the harbour get a draft
    assert.equal(await lines.first().textContent(), '5 entries to draft in Français (Canada), 1 skipped (of 6).');
    assert.match(await lines.nth(1).textContent(), /tokens in \(with the instructions sent with each ask\) and \d+ out\.$/);
    assert.match(await lines.nth(2).textContent(), /^5 asks of the AI, at most 600 asks a minute: about a minute\.$/);
    planSkipTab = await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Skipped/ }).textContent();
    assert.equal(planSkipTab.trim(), 'Skipped (1)');
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
    assert.equal(fs.existsSync(path.join(fx.site, draftsFile)), false);
    await shot('plan');
    // its tabs are in the URL; Back undoes one
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Skipped/ }).click();
    assert.equal(params().show, 'skipped');
    await page.getByRole('cell', { name: 'It has its own Français (Canada) words already.' }).waitFor();
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('show='));
    await lines.first().waitFor();
  });

  test('the run: its report, the drafts beside the site, and no page changed (nothing published)', async () => {
    const before = blog();
    await page.getByRole('button', { name: 'Run it' }).click();
    await page.getByRole('heading', { name: 'The drafts are ready' }).waitFor();
    const report = await page.locator('.ms-trs-lines li').allTextContents();
    assert.equal(report[0], '5 drafts made in Français (Canada), 5 waiting for review.');
    // the plan's skip is in the report too, with its reason: 5 drafted + 1 skipped + 0 failed = the 6 the plan considered
    assert.equal(report[1], '1 skipped, 0 failed (each with why).');
    const show = page.getByRole('group', { name: 'Show' });
    assert.equal((await show.getByRole('button', { name: /^Skipped/ }).textContent()).trim(), planSkipTab.trim());
    await shot('report');
    await show.getByRole('button', { name: /^Skipped/ }).click();
    await page.getByRole('cell', { name: 'It has its own Français (Canada) words already.' }).waitFor();
    await show.getByRole('button', { name: 'Summary' }).click();
    await page.getByRole('heading', { name: 'The drafts are ready' }).waitFor();
    assert.deepEqual(blog(), before, 'no entry changed');
    const drafts = JSON.parse(read(draftsFile)).drafts;
    assert.deepEqual(Object.keys(drafts).sort(), ['posts/bob-draft', 'posts/carol-draft', 'posts/harbour', 'posts/hello-world', 'posts/with-html']);
    assert.equal(fx.git('log', '-1', '--format=%an|%s').trim(), 'Olive Owner|Draft 5 Français (Canada) translations with AI');
    // nothing was published: no publish job ran, and the harbour's French words are still missing
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 0);
    const status = await page.evaluate(async () => (await (await fetch('/markstage/api/collections/posts/entries/harbour/translations')).json()).locales[0].status);
    assert.equal(status, 'missing');
    await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^To review/ }).click();
    assert.equal(params().show, 'review');
    assert.equal(await page.locator('.ms-trs table tbody tr').count(), 5);
  });

  test('a draft reviewed in Post settings: shown first, accepted, saved; it leaves the list', async () => {
    await page.getByRole('link', { name: 'Review the draft of “The harbour”' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/e/posts/harbour'));
    assert.deepEqual([params().suggest, params().loc], ['translate', 'fr-CA']);
    const box = page.locator('.ms-locales');
    await box.locator('.ms-ai[data-ai-state="ready"]').waitFor();
    assert.match(await box.locator('.ms-ai').textContent(), /Drafted by AI \(stub\) when Olive Owner translated the site/);
    assert.deepEqual((await box.locator('.ms-ai__suggested .ms-copyable__text').allTextContents()).map((t) => t.trim()), ['The harbour (stub)', 'Boats and gulls. (stub)']);
    await box.locator('[data-ai-accept]').click();
    assert.equal(await box.getByLabel('Title on Français (Canada)').inputValue(), 'The harbour (stub)');
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    assert.match(read('src/content/blog/harbour.md'), /^locales:\n {2}fr-CA:\n {4}title: The harbour \(stub\)\n {4}description: Boats and gulls\. \(stub\)$/m);
    await page.goto(`${BASE}/markstage/#/translate/${encodeURIComponent(app.db.prepare('SELECT id FROM translate_runs WHERE status = ?').get('done').id)}?show=review`);
    await page.getByRole('cell', { name: 'Reviewed' }).waitFor();
    assert.equal(await page.getByRole('cell', { name: 'Waiting for review' }).count(), 4);
  });

  test('a second run skips what waits for review and what is translated; nothing new is written', async () => {
    const head = fx.git('rev-parse', 'HEAD').trim();
    await page.goto(`${BASE}/markstage/#/translate`);
    await page.getByRole('button', { name: 'Plan it' }).click();
    await page.waitForURL((u) => /^#\/translate\/tr_/.test(u.hash));
    const first = page.locator('.ms-trs-lines li').first();
    await first.waitFor();
    assert.equal(await first.textContent(), '0 entries to draft in Français (Canada), 6 skipped (of 6).');
    assert.ok(await page.locator('.ms-trs-lines li', { hasText: 'Skipped, 4: An AI draft is already waiting for review.' }).count());
    assert.equal(await page.getByRole('button', { name: 'Run it' }).count(), 0, 'nothing to run');
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
  });
});
