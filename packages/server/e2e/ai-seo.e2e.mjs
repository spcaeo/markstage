// AI link suggestions and fixes for search problems, in a real browser at 1440, against real servers whose AI is the
// stub provider (no API call leaves the machine), on a site that keeps topics (its link index):
//   - Post settings → Topic and links → "Suggest links with AI": pages of the site with the words to link, beside the
//     page's own suggestions; Add link is one change on the canvas (⌘Z), saved by ⌘S as only that link; Dismiss.
//   - The SEO check → "Suggest a fix" on a problem it found (vague link words, a heading out of order, no
//     description): the fix as a diff, Accept, Edit then accept, Reject; ⌘S saves only what changed.
// Each state is at its URL (s=1&suggest=links, side=seo&suggest=fix&fix=<id>); Back and Forward walk them. With AI
// off, the buttons are not there, and a link that asks anyway says why, naming the variable to set.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: support.mjs AI_SEO_PORTS. Screenshots (light and dark) go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { AI_SEO_PORTS, SHOTS, blank, pw, skip } from './support.mjs';

const [PORT, OFF_PORT] = AI_SEO_PORTS;
// no key from the shell reaches these servers: the one with no `ai` must be off, and nothing may call out
delete process.env.MARKSTAGE_AI_KEY;

const SITE_CONFIG = `export default {
  collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' }],
  topics: { follow: [] },
};
`;
const post = (title, body) => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-03-01T10:00:00.000Z'\nmodified: '2026-03-02T10:00:00.000Z'\n---\n\n${body}\n`;
const FIRST = 'These notes talk about keyboard shortcuts for editors and canvas basics, every day.';
const LINKED = 'To learn more, [click here](/blog/guide/).';
const NOTES = post('Field notes', `${FIRST}\n\n${LINKED}\n\n#### Habits\n\nWrite a little every morning.`);
const TOPIC = { title: 'Editing', pillar: 'posts/guide', money: null, anchors: [], keywords: ['editing'], members: ['posts/notes', 'posts/canvas', 'posts/shortcuts'], groups: [] };
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
      settings: [{ type: 'seo', label: 'Search', title: 'seo.title', description: 'seo.description' }],
    },
  ],
  topics: { collections: ['posts'], money: { pageTypes: [], paths: [] }, follow: [], sponsored: [], enough: 3 },
  compat: null,
  canvas: { articleClass: '', bodyClass: '' },
};

async function siteServer(port, ai) {
  const fx = makeFixture({ checks: false });
  const blog = (id, text) => fs.writeFileSync(path.join(fx.site, `src/content/blog/${id}.md`), text);
  blog('guide', post('The editing guide', 'Everything about editing pages.'));
  blog('canvas', post('Canvas basics', 'The canvas shows the page as it will look.'));
  blog('shortcuts', post('Keyboard shortcuts for editors', 'Shortcuts save time.'));
  blog('notes', NOTES);
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
  fs.mkdirSync(path.join(fx.site, 'markstage/topics'), { recursive: true });
  fs.writeFileSync(path.join(fx.site, 'markstage/topics/editing.json'), `${JSON.stringify(TOPIC, null, 2)}\n`);
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Notes');
  if (ai) {
    const cfgPath = path.join(fx.data, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')), ai }, null, 2));
  }
  const editorDir = await buildEditor(path.join(fx.run, 'editor'), EDITOR);
  const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port, editorDir, collections: [] } });
  const app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
  await app.listen(port, '127.0.0.1');
  app.backup.stop();
  const owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner' });
  return { fx, app, owner, base: `http://127.0.0.1:${port}` };
}

describe('AI links and fixes in a browser', { skip, timeout: 240_000 }, () => {
  let on, off, browser, ctx, page;
  const read = () => fs.readFileSync(path.join(on.fx.site, 'src/content/blog/notes.md'), 'utf8');
  const params = () => Object.fromEntries(new URLSearchParams(decodeURIComponent(new URL(page.url()).hash).split('?')[1] ?? ''));
  const settled = async (card) => {
    await card.and(page.locator('[data-ai-state]:not([data-ai-state="loading"])')).waitFor();
    return card.getAttribute('data-ai-state');
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `ai-seo-${name}-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  async function signIn(server, to) {
    await blank(page);
    await page.goto(`${server.base}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(server.owner.email);
    await page.getByLabel('Password', { exact: true }).fill(server.owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
    await page.locator('.ProseMirror p').first().waitFor();
  }
  const go = async (server, hash) => {
    await blank(page);
    await page.goto(`${server.base}/markstage/${hash}`);
    await page.locator('.ProseMirror p').first().waitFor();
  };

  before(async () => {
    on = await siteServer(PORT, { provider: 'stub', perMinute: 60 });
    off = await siteServer(OFF_PORT, null);
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    for (const b of [on.base, off.base]) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: b });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await on?.app.close();
    await off?.app.close();
  });

  test('links: Suggest links with AI beside the page’s own; Add link is one change, ⌘Z, ⌘S saves only that link; Back and Forward', async () => {
    await signIn(on, '#/e/posts/notes?s=1');
    const box = page.locator('.ms-topicbox');
    const ask = box.getByRole('button', { name: 'Suggest links with AI' });
    await ask.waitFor();
    // beside today's suggestions: under "Pages to link to"
    assert.equal(await box.locator('.ms-topicbox__sub', { hasText: 'Pages to link to' }).count(), 1);
    await ask.click();
    assert.deepEqual([params().s, params().suggest], ['1', 'links']);
    const card = page.locator('.ms-ai-links');
    assert.equal(await settled(card), 'ready');
    // the pages the text names that it does not link yet: never the guide, linked already
    const items = card.locator('.ms-ai-links__item');
    assert.deepEqual((await items.locator('.ms-ai-links__title').allTextContents()).sort(), ['Canvas basics', 'Keyboard shortcuts for editors']);
    const canvas = items.filter({ hasText: 'Canvas basics' });
    assert.equal(await canvas.locator('.ms-ai-links__words .ms-copyable__text').textContent(), 'canvas basics');
    assert.equal(await canvas.locator('.ms-ai-links__url .ms-copyable__text').textContent(), '/blog/canvas/');
    await shot('links');
    // nothing changed yet
    assert.notEqual(await page.locator('.ms-status').getAttribute('data-status'), 'dirty');

    // Back closes it, Forward opens it again (asked again)
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('suggest='));
    assert.equal(await card.count(), 0);
    await page.goForward();
    await page.waitForFunction(() => location.hash.includes('suggest=links'));
    assert.equal(await settled(card), 'ready');

    // Dismiss takes one off the list; Add link links the words on the canvas
    await items.filter({ hasText: 'Keyboard shortcuts for editors' }).getByRole('button', { name: 'Dismiss' }).click();
    assert.equal(await items.count(), 1);
    await canvas.getByRole('button', { name: 'Add link' }).click();
    await canvas.locator('.ms-ai-links__added').waitFor();
    const link = page.locator('.ProseMirror p a[href="/blog/canvas/"]');
    assert.equal(await link.textContent(), 'canvas basics');
    assert.equal(await page.locator('.ms-status').getAttribute('data-status'), 'dirty');
    // one change: ⌘Z takes it back, ⇧⌘Z puts it back
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await link.count(), 0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    assert.equal(await link.count(), 1);
    const before0 = read();
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    assert.equal(read(), before0.replace('and canvas basics, every', 'and [canvas basics](/blog/canvas/), every'));
  });

  test('fixes: vague link words, a heading out of order, as a diff; Accept, Edit then accept, Reject; ⌘S saves only those', async () => {
    await go(on, '#/e/posts/notes?side=seo');
    const seo = page.locator('.ms-seo');
    const row = seo.locator('.ms-seo-row', { hasText: '“click here” does not say where the link goes' });
    await row.getByRole('button', { name: /^Suggest a fix with AI/ }).click();
    assert.deepEqual([params().side, params().suggest, params().fix], ['seo', 'fix', 'link-1-1']);
    const card = seo.locator('.ms-ai');
    assert.equal(await settled(card), 'ready');
    assert.match(await card.locator('.ms-ai__title').textContent(), /Suggested fix: link words/);
    // the diff: taken out struck through, put in underlined
    assert.deepEqual(await card.locator('[data-ai-field="words"] del').allTextContents(), ['click here']);
    assert.deepEqual(await card.locator('[data-ai-field="words"] ins').allTextContents(), ['The editing guide']);
    assert.deepEqual(await card.locator('[data-ai-field="sentence"] ins').allTextContents(), ['The editing guide']);
    await shot('fix');
    // Back closes it, Forward opens it
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('suggest='));
    await page.goForward();
    await page.waitForFunction(() => location.hash.includes('fix=link-1-1'));
    assert.equal(await settled(card), 'ready');
    await card.getByRole('button', { name: 'Accept', exact: true }).click();
    assert.equal(params().suggest, undefined);
    const para = page.locator('.ProseMirror p').nth(1);
    assert.equal(await para.textContent(), 'To learn more, The editing guide.');
    assert.equal(await para.locator('a[href="/blog/guide/"]').textContent(), 'The editing guide');
    // one change: ⌘Z puts "click here" back
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await para.textContent(), 'To learn more, click here.');
    await page.keyboard.press('ControlOrMeta+Shift+z');

    // the heading: an H4 right after the title (the H1); Edit then accept with the writer's own words
    await seo.locator('.ms-seo-row', { hasText: 'an H2 is skipped' }).getByRole('button', { name: /^Suggest a fix with AI/ }).click();
    assert.equal(params().fix, 'heading-2');
    assert.equal(await settled(card), 'ready');
    assert.deepEqual([await card.locator('[data-ai-field="level"] del').textContent(), await card.locator('[data-ai-field="level"] ins').textContent()], ['H4', 'H2']);
    await card.getByRole('button', { name: 'Edit then accept' }).click();
    await card.getByLabel('Yours').nth(1).fill('Daily habits');
    await card.getByRole('button', { name: 'Accept', exact: true }).click();
    assert.equal(await page.locator('.ProseMirror h2').textContent(), 'Daily habits');
    assert.equal(await page.locator('.ProseMirror h4').count(), 0);

    // no description: Reject changes nothing
    await seo.locator('.ms-seo-row', { hasText: 'No meta description' }).getByRole('button', { name: /^Suggest a fix with AI/ }).click();
    assert.equal(params().fix, 'description');
    assert.equal(await settled(card), 'ready');
    await card.getByRole('button', { name: 'Reject' }).click();
    assert.equal(params().suggest, undefined);
    // the focus is not lost with the card: it goes to the section's own ask button, never to a fix button drawn again
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Suggest title and description');

    const before0 = read();
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    assert.equal(read(), before0.replace(LINKED, 'To learn more, [The editing guide](/blog/guide/).').replace('#### Habits', '## Daily habits'));
    // a link to a fix that is fixed already closes, and says so
    await go(on, '#/e/posts/notes?side=seo&suggest=fix&fix=heading-2');
    await page.locator('.ms-toast', { hasText: 'not on the page any more' }).waitFor();
    assert.equal(params().suggest, undefined);
  });

  test('AI off: no Suggest links, no Suggest a fix; a link that asks anyway says why and names the variable', async () => {
    await signIn(off, '#/e/posts/notes?side=seo');
    await page.locator('.ms-seo-row', { hasText: '“click here”' }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole('button', { name: /^Suggest a fix/ }).count(), 0);
    await go(off, '#/e/posts/notes?s=1');
    await page.locator('.ms-topicbox__sub', { hasText: 'Pages to link to' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Suggest links with AI' }).count(), 0);
    await go(off, '#/e/posts/notes?s=1&suggest=links');
    const card = page.locator('.ms-ai-links');
    assert.equal(await settled(card), 'off');
    assert.match(await card.locator('.ms-ai__state').textContent(), /AI suggestions are off on this server\. To turn them on, set MARKSTAGE_AI_KEY/);
    await card.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(params().suggest, undefined);
  });
});
