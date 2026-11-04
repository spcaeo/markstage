// The Topic map and links (#/topic-map, #/links, editor src/admin/topics/ and src/admin/links/, and the topic part of a page's
// settings) in a real browser, against a real server on 127.0.0.1 whose site keeps its topics as files (markstage.config
// `topics`): the topics list and one topic's board, a page moved with its "Move to" list and another dragged in; a
// page put in a topic from its own settings; the Link inbox, where Accept links the words on the other page (one
// commit, Undo on the toast) and Skip is remembered (and brought back); Health filtered by topic and kind in the URL,
// with a one-click fix and "Open at the sentence"; Back and Forward; the copy and open icons on page addresses; a
// topic as its journey (which page links to which, with the words, a link at its sentence, a missing link, one group
// at a time), readable in the light and the dark theme; the topic as a river (the Flow view): calm until a card is
// pointed at, a page's step with its To fix box, the trail, folding, the View popover, all in the URL with Back and
// Forward, by keyboard, with the layout check (flow-check.mjs) at 1280, 1512 and 1920 in both themes.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Port: MARKSTAGE_E2E_PORT_BASE (default 18231, odd) +5. Screenshots (light and dark) go to MARKSTAGE_E2E_SHOTS.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { flowCheck, flowContrast } from './flow-check.mjs';
import { LINKS_PORT as PORT, SHOTS, pw, skip, foldNav, blank } from './support.mjs';

const BASE = `http://127.0.0.1:${PORT}`;
const SITE_CONFIG = `export default {
  siteUrl: 'https://example.com',
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '/{id}/' },
  ],
  pageTypes: { types: [{ id: 'service', label: 'Service page', collections: ['pages'] }] },
  topics: { money: ['service'], follow: ['docs.example.com'] },
};
`;
const post = (title, body) => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-03-01T10:00:00.000Z'\n---\n\n${body}\n`;
const TOPIC = { title: 'Editing', pillar: 'posts/guide', money: null, anchors: ['the editing guide'], keywords: ['editing'], members: [], groups: [{ id: 'modes', name: 'Modes', lead: 'posts/canvas', members: [] }] };

describe('topics and links in a browser', { skip, timeout: 240_000 }, () => {
  let fx, app, browser, ctx, page, owner;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const topic = () => JSON.parse(read('markstage/topics/editing.json'));
  const hashIs = (h) => page.waitForFunction((want) => decodeURIComponent(location.hash) === want, h);
  const hashHas = (part) => page.waitForFunction((want) => decodeURIComponent(location.hash).includes(want), part);
  const toast = (text) => page.locator('.ms-toast', { hasText: text }).waitFor();
  /** waits until the site's files say so (a change is saved on the server, then committed) */
  const until = async (ok, what) => {
    for (let i = 0; i < 100; i++) {
      if (ok()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`timed out: ${what}`);
  };
  const shots = async (name) => {
    if (!SHOTS) return;
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `links-${name}-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const open = async (where) => {
    await blank(page);
    await page.goto(`${BASE}/markstage/${where}`);
  };
  const zone = (label) => page.locator(`section.ms-tb-zone[aria-label="${label}"]`);

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    const blog = (id, title, body) => fs.writeFileSync(path.join(fx.site, `src/content/blog/${id}.md`), post(title, body));
    blog('guide', 'The editing guide', 'Everything about editing pages. Start with [canvas basics](/blog/canvas/).');
    blog('canvas', 'Canvas basics', 'The canvas shows the page as it will look. Read the [editing guide](/blog/guide/) first.');
    blog('shortcuts', 'Keyboard shortcuts for editors', 'Shortcuts save time when you edit every day. See [a blog](https://blog.example.org/x) for more.');
    blog('notes', 'Field notes', 'These notes talk about keyboard shortcuts for editors and about other habits, at some length here.');
    fs.mkdirSync(path.join(fx.site, 'src/content/pages'), { recursive: true });
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/services.json'), `${JSON.stringify({ title: 'Editing services', pageType: 'service', sections: [] }, null, 2)}\n`);
    fs.mkdirSync(path.join(fx.site, 'markstage/topics'), { recursive: true });
    fs.writeFileSync(path.join(fx.site, 'markstage/topics/editing.json'), `${JSON.stringify(TOPIC, null, 2)}\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Topics');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      siteUrl: 'https://example.com',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      topics: { collections: ['posts', 'pages'], money: { pageTypes: ['service'], paths: [] }, follow: ['docs.example.com'], sponsored: [], enough: 3 },
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await foldNav(ctx);
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/topic-map')}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await hashIs('#/topic-map');
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('the topics list and one board: Move to, a drag, the picked page in the URL; Back and Forward', async () => {
    await open('#/topic-map');
    const card = page.locator('a.ms-topic-card', { hasText: 'Editing' });
    await card.waitFor();
    // named so it never clashes with a site's own ordering screen, which it may call "Topics"
    await page.locator('.ms-adm-title', { hasText: 'Topic map' }).waitFor();
    assert.equal(await page.title().then((t) => t.startsWith('Topic map')), true);
    assert.match(await card.innerText(), /2 pages/);
    assert.match(await page.locator('.ms-topics__loose').innerText(), /\d+ pages are in no topic yet\. Open a topic to drag them in\./);
    await card.click();
    await hashIs('#/topic-map/editing');
    // a topic opens as its journey; the board is the Arrange view
    await page.locator('.ms-jr-col[data-col="pillar"] .ms-jr-card', { hasText: 'The editing guide' }).waitFor();
    assert.equal(await page.locator('.ms-tb-views [aria-selected="true"]').innerText(), 'Journey');
    await page.getByRole('tab', { name: 'Arrange' }).click();
    await hashIs('#/topic-map/editing?view=arrange');
    await zone('The main page').locator('.ms-tb-card', { hasText: 'The editing guide' }).waitFor();
    await zone('Lead of “Modes”').locator('.ms-tb-card', { hasText: 'Canvas basics' }).waitFor();
    // a page address: copy and open (on the site's own address)
    const addr = zone('The main page').locator('.ms-copyable').first();
    await addr.hover();
    assert.equal(await addr.getByRole('button', { name: 'Copy page address' }).count(), 1);
    assert.equal(await addr.getByRole('link', { name: 'Open page address in a new tab' }).or(addr.getByRole('button', { name: 'Open page address in a new tab' })).count(), 1);
    assert.match(await addr.innerText(), /\/blog\/guide\//);
    // Move to… (keyboard and touch)
    const loose = zone('Not in a topic');
    await loose.locator('.ms-tb-card', { hasText: 'Keyboard shortcuts for editors' }).getByLabel('Move “Keyboard shortcuts for editors” to').selectOption({ label: 'In “Modes”' });
    await toast('Moved “Keyboard shortcuts for editors”.');
    await zone('In “Modes”').locator('.ms-tb-card', { hasText: 'Keyboard shortcuts for editors' }).waitFor();
    assert.deepEqual(topic().groups[0].members, ['posts/shortcuts']);
    await hashHas('page=posts/shortcuts');
    // a drag from the pages in no topic onto the topic's own pages
    await loose.locator('.ms-tb-card', { hasText: 'Field notes' }).dragTo(zone('Pages without a group').locator('.ms-tb-zone__list'));
    await toast('Moved “Field notes”.');
    await zone('Pages without a group').locator('.ms-tb-card', { hasText: 'Field notes' }).waitFor();
    assert.deepEqual(topic().members, ['posts/notes']);
    await shots('board');
    // the search in the pages in no topic is in the URL
    await page.getByPlaceholder('Find a page in no topic').fill('editing');
    await hashHas('q=editing');
    await loose.locator('.ms-tb-card', { hasText: 'Editing services' }).waitFor();
    // out again (the page's own settings put it back in, below)
    await zone('Pages without a group').locator('.ms-tb-card', { hasText: 'Field notes' }).getByLabel('Move “Field notes” to').selectOption({ label: 'Not in a topic' });
    await toast('Took “Field notes” out of “Editing”.');
    await until(() => topic().members.length === 0, 'notes out of the topic');
    // Back to the list, Forward to the board
    await open('#/topic-map');
    await card.click();
    await hashIs('#/topic-map/editing');
    await page.goBack();
    await hashIs('#/topic-map');
    await card.waitFor();
    await page.goForward();
    await hashIs('#/topic-map/editing');
    await page.locator('.ms-jr-col[data-col="pillar"] .ms-jr-card').waitFor();
  });

  test('a page put in a topic from its own settings; its links shown there', async () => {
    await open('#/e/posts/notes?s=1');
    const box = page.locator('section.ms-topicbox');
    await box.waitFor();
    await box.getByLabel('Link topic', { exact: true }).selectOption({ label: 'Editing' });
    await toast('Put in the topic “Editing”.');
    await until(() => topic().members.includes('posts/notes'), 'notes in the topic');
    await box.locator('.ms-topicbox__count').waitFor();
    assert.match(await box.locator('.ms-topicbox__count').innerText(), /No page links here in its text yet\./);
    await shots('page-box');
  });

  test('Link inbox: Accept links the words on the other page, Undo takes it back; Skip is remembered and brought back', async () => {
    await open('#/links');
    const card = page.locator('.ms-sugg', { hasText: 'Field notes' }).filter({ hasText: 'keyboard shortcuts for editors' }).first();
    await card.waitFor();
    assert.equal(await page.locator('.ms-links-tabs [aria-selected="true"]').innerText().then((t) => t.startsWith('Link inbox')), true);
    assert.equal(await card.locator('mark').innerText(), 'keyboard shortcuts for editors');
    // the open suggestion is in the URL
    const id = await card.getAttribute('data-suggestion');
    await card.getByRole('button', { name: 'Accept' }).focus();
    await hashHas(`s=${id}`);
    await shots('inbox');
    await card.getByRole('button', { name: 'Accept' }).click();
    await toast('Linked “keyboard shortcuts for editors” on “Field notes”.');
    assert.match(read('src/content/blog/notes.md'), /\[keyboard shortcuts for editors\]\(\/blog\/shortcuts\/\)/);
    assert.match(fx.git('log', '-1', '--format=%s'), /notes|link/i);
    await page.locator('.ms-toast').getByRole('button', { name: 'Undo' }).click();
    await toast('Undone.');
    await until(() => !read('src/content/blog/notes.md').includes('](/blog/shortcuts/)'), 'the link undone');
    // the suggestion is back; Skip it
    const again = page.locator(`[data-suggestion="${id}"]`);
    await again.waitFor();
    await again.getByRole('button', { name: 'Skip' }).click();
    await again.waitFor({ state: 'detached' });
    await open(`#/links?s=${id}`);
    await page.locator('.ms-links-inbox, .ms-adm-state').first().waitFor();
    assert.equal(await page.locator(`[data-suggestion="${id}"]`).count(), 0, 'a skipped suggestion stays skipped');
    await page.getByRole('tab', { name: /Skipped/ }).click();
    await hashHas('view=skipped');
    const row = page.locator('.ms-links-skips li', { hasText: 'keyboard shortcuts for editors' });
    await row.waitFor();
    await row.getByRole('button', { name: 'Bring back' }).click();
    await toast('It will be suggested again.');
    await page.goBack();
    await hashIs(`#/links?s=${id}`);
    await page.locator(`[data-suggestion="${id}"]`).waitFor();
  });

  test('Health: topic and kind in the URL, a one-click fix, the page at the sentence; Back and Forward', async () => {
    await open('#/links?view=health&topic=editing');
    await page.locator('.ms-lh-row').first().waitFor();
    assert.equal(await page.getByLabel('Topic', { exact: true }).inputValue(), 'editing');
    const outside = page.locator('.ms-lh-row[data-kind="outside-follow"]');
    await outside.waitFor();
    assert.match(await outside.innerText(), /Keyboard shortcuts for editors/);
    // the outside link: copy and open
    assert.equal(await outside.getByRole('button', { name: 'Copy link address' }).count(), 1);
    await shots('health');
    // the kind filter, then Back and Forward
    await page.locator('.ms-links-kinds button', { hasText: 'No links in' }).click();
    await hashHas('kind=no-links-in');
    await page.waitForFunction(() => [...document.querySelectorAll('.ms-lh-row')].every((r) => r.getAttribute('data-kind') === 'no-links-in'));
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('kind='));
    await outside.waitFor();
    await page.goForward();
    await hashHas('kind=no-links-in');
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('kind='));
    // the one-click fix: the outside link marked nofollow on the page itself
    await outside.getByRole('button', { name: 'Mark it nofollow' }).click();
    await toast('Done: mark it nofollow.');
    await until(() => /rel="nofollow"/.test(read('src/content/blog/shortcuts.md')), 'the rel on the outside link');
    // the page at the sentence
    const weak = page.locator('.ms-lh-row[data-kind="no-pillar-link"]', { hasText: 'Keyboard shortcuts for editors' });
    await weak.getByRole('button', { name: /^Open/ }).click();
    await hashHas('#/e/posts/shortcuts');
    await page.locator('.ms-status').first().waitFor();
  });
  test('Journey: which page links to which, with the words; a link where it is; a missing link; Back and Forward', async () => {
    await open('#/topic-map/editing');
    const col = (c) => page.locator(`.ms-jr-col[data-col="${c}"]`);
    const jcard = (title) => page.locator('.ms-jr-card', { hasText: title });
    await col('pillar').locator('.ms-jr-card', { hasText: 'The editing guide' }).waitFor();
    assert.equal(await col('lead').locator('.ms-jr-card', { hasText: 'Canvas basics' }).count(), 1);
    assert.equal(await col('member').locator('.ms-jr-card', { hasText: 'Keyboard shortcuts for editors' }).count(), 1);
    // links in and out: right-aligned, tabular digits; a page nobody links to says so
    const num = jcard('The editing guide').locator('.ms-jr-card__nums dd').first();
    assert.deepEqual(await num.evaluate((n) => [getComputedStyle(n).textAlign, getComputedStyle(n).fontVariantNumeric]), ['right', 'tabular-nums']);
    await jcard('Keyboard shortcuts for editors').locator('.ms-jr-tag', { hasText: 'No links in' }).waitFor();
    assert.match(await jcard('The editing guide').locator('.ms-jr-card__state').innerText(), /^Published · Updated /);
    // a page address: copy and open
    const addr = jcard('The editing guide').locator('.ms-copyable').first();
    await addr.hover();
    assert.equal(await addr.getByRole('button', { name: 'Copy page address' }).count(), 1);
    // no visit counts are made up
    assert.match(await page.locator('.ms-jr-off').innerText(), /Not shown: visits \(Markstage keeps no visit counts\)/);
    assert.equal(await jcard('The editing guide').locator('.ms-jr-card__nums').getAttribute('aria-description'), 'No visit counts: Markstage keeps none. No form messages: this site has none yet.');
    // the gaps, in plain words
    assert.match(await page.locator('.ms-jr-gaps').innerText(), /1 article does not link up to its group page\./);
    // the main page links back down to the lead: a lighter line
    assert.ok((await page.locator('path.ms-jr-line.is-back').count()) >= 1);
    await shots('journey');
    // the chip on the line from the lead up to the main page: the link where it is
    const chip = page.locator('.ms-jr-chips .ms-jr-chip', { hasText: 'editing guide' });
    await chip.click();
    await hashHas('link=lp_');
    const drawer = page.locator('.ms-adm-drawer');
    await drawer.getByRole('heading', { name: '1 link between two pages' }).waitFor();
    assert.equal(await drawer.locator('.ms-jr-link__sentence mark').first().innerText(), 'editing guide');
    await drawer.getByRole('heading', { name: 'And 1 link back' }).waitFor();
    assert.match(await drawer.locator('.ms-jr-link__section').first().innerText(), /Near the top of the page/);
    await shots('journey-link');
    const linked = await page.evaluate(() => location.hash);
    await drawer.getByRole('button', { name: 'Open at the sentence' }).first().click();
    await hashIs('#/e/posts/canvas?b=0&find=editing+guide');
    await page.goBack();
    await page.waitForFunction((h) => location.hash === h, linked);
    await drawer.locator('.ms-jr-link__sentence').first().waitFor();
    // the missing link up to the group lead: dashed, with what would add it
    assert.ok((await page.locator('path.ms-jr-line.is-missing').count()) >= 1);
    await page.locator('.ms-jr-chips .ms-jr-chip.is-missing').click();
    await drawer.getByRole('heading', { name: 'Missing link' }).waitFor();
    assert.match(await drawer.innerText(), /“Keyboard shortcuts for editors” does not link to its group lead, “Canvas basics”, yet\./);
    assert.equal(await drawer.getByRole('button', { name: 'Skip' }).count(), 1);
    await drawer.getByRole('button', { name: 'Close' }).click();
    await page.waitForFunction(() => !location.hash.includes('link='));
    // a card picked: the pages it links with say so, with the words; "+" lists every link
    await jcard('The editing guide').locator('.ms-jr-card__title').click();
    await hashHas('page=posts/guide');
    await jcard('Canvas basics').locator('.ms-jr-card__rel', { hasText: 'Linked from the picked page: “canvas basics”' }).waitFor();
    await jcard('The editing guide').getByRole('button', { name: 'Show every link of “The editing guide”' }).click();
    await hashHas('details=1');
    await drawer.getByRole('heading', { name: /^Links out \(\d+\)$/ }).waitFor();
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('details='));
    // one group at a time
    await page.locator('.ms-jr-groups button', { hasText: 'Modes' }).click();
    await hashHas('group=modes');
    await page.waitForFunction(() => ![...document.querySelectorAll('.ms-jr-card')].some((c) => c.textContent.includes('Field notes')));
    await page.goBack();
    await jcard('Field notes').waitFor();
    // readable in both themes: the text on the map against what is behind it
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      const worst = await page.evaluate(() => {
        const rgb = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
        const bg = (n) => {
          for (let e = n; e; e = e.parentElement) {
            const c = rgb(getComputedStyle(e).backgroundColor);
            if (c.length && (c[3] === undefined || c[3] > 0.5)) return c;
          }
          return [255, 255, 255];
        };
        let low = 21;
        let what = '';
        for (const n of document.querySelectorAll('.ms-adm-title, .ms-tb-title, .ms-jr-col__title, .ms-jr-card__title, .ms-jr-chip__text, .ms-jr-gap, .ms-jr-tag')) {
          const a = lum(rgb(getComputedStyle(n).color));
          const b = lum(bg(n));
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          if (ratio < low) (low = ratio), (what = `${n.className}: ${n.textContent}`);
        }
        return { low, what };
      });
      assert.ok(worst.low >= 4.5, `${scheme}: ${worst.what} has a contrast of ${worst.low.toFixed(2)}`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    // from a 1280px window up: every column in view (no sideways scroll), and no title, address or link words cut short
    const size = page.viewportSize();
    for (const width of [1280, 1512, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      const fit = await page.evaluate(() => {
        const box = document.querySelector('.ms-jr-scroll');
        const cut = [...document.querySelectorAll('.ms-jr-card__title, .ms-jr-card__url .ms-copyable__text, .ms-jr-chip, .ms-jr-chip__text')].filter((n) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 || getComputedStyle(n).textOverflow === 'ellipsis');
        return { sideways: box.scrollWidth - box.clientWidth, cut: cut.map((n) => n.textContent) };
      });
      assert.equal(fit.sideways, 0, `${width}px: the map scrolls sideways`);
      assert.deepEqual(fit.cut, [], `${width}px: cut short`);
    }
    if (size) await page.setViewportSize(size);
  });
  test('Flow: the river, calm; a page’s step with To fix; the trail; folding; View; Back and Forward; the layout check', async () => {
    // the topic names its service page (its edit form), so the river has its goal
    await open('#/topic-map/editing?action=edit');
    await page.getByLabel('Its service page').selectOption('pages/services');
    await page.getByRole('button', { name: 'Save topic' }).click();
    await toast('Saved');
    await open('#/topic-map/editing?view=flow');
    const card = (title) => page.locator('.ms-fl-card', { hasText: title });
    const check = async (what) => {
      const r = await page.evaluate(flowCheck);
      assert.deepEqual(r.fail, [], `${what}: the layout check`);
      assert.ok(r.leastText >= 12, `${what}: text ${r.leastText}px on screen`);
      // readable in either theme: the words against what is behind them
      const c = await page.evaluate(flowContrast);
      assert.ok(c.low >= 4.5, `${what}: ${c.what} has a contrast of ${c.low.toFixed(2)}`);
      return r;
    };
    await card('The editing guide').waitFor();
    // the river: the service page as the goal on top, the main page, the group lead with its article under it
    await page.locator('.ms-fl-goal', { hasText: 'Editing services' }).waitFor();
    const [goal, main, lead, article] = await Promise.all([page.locator('.ms-fl-goal'), card('The editing guide'), card('Canvas basics'), card('Keyboard shortcuts for editors')].map((l) => l.evaluate((e) => ({ x: +e.dataset.x, y: +e.dataset.y }))));
    assert.ok(goal.y < main.y && main.y < lead.y && lead.y < article.y, 'goal, main page, lead, article: top down');
    assert.equal(article.x - lead.x, 24, 'the article stacked under its lead, indented');
    assert.match(await card('Canvas basics').locator('.ms-fl-card__foot').innerText(), /Modes/);
    assert.equal(await card('Keyboard shortcuts for editors').locator('.ms-fl-dot').count(), 1, 'a red dot: its missing link');
    // calm: no line across the map until a card is pointed at, then its links, thin and grey
    assert.equal(await page.locator('path.ms-fl-ln.is-hover').count(), 0);
    await card('The editing guide').hover();
    await page.waitForFunction(() => document.querySelectorAll('path.ms-fl-ln.is-hover').length >= 1);
    assert.equal(await card('Canvas basics').evaluate((e) => e.classList.contains('is-near')), true);
    await page.mouse.move(2, 2);
    await page.waitForFunction(() => !document.querySelector('path.ms-fl-ln.is-hover'));
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await check(`river, ${scheme}`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await shots('flow-river');

    // a page picked: Comes from, the page, Goes to; To fix under it; Both ways; the side panel with its details only
    await card('Canvas basics').click();
    await hashHas('page=posts/canvas');
    const heads = page.locator('.ms-fl-colhead');
    await heads.first().waitFor();
    assert.deepEqual(await heads.allInnerTexts(), ['Comes from · 0', 'A1 · the page', 'Goes to · 0', 'Both ways ⇄ · 1']);
    assert.equal(await page.locator('.ms-fl-note').count(), 2, 'an empty side says so');
    const fix = page.locator('.ms-fl-fix');
    assert.match(await fix.innerText(), /To fix · 2/);
    assert.match(await fix.innerText(), /A2 should link to A1 \(its group lead\)/);
    assert.match(await fix.innerText(), /A1 should link to S \(the service page\)/);
    assert.equal(await fix.getByRole('button', { name: /^Skip/ }).count(), 2);
    assert.equal(await card('The editing guide').locator('.ms-fl-both').count(), 1, 'the main page links both ways');
    const panel = page.locator('.ms-fl-side');
    await panel.getByRole('heading', { name: 'Canvas basics' }).waitFor();
    assert.equal(await panel.locator('.ms-fl-rows, .ms-fl-row').count(), 0, 'no Connections list');
    assert.match(await panel.innerText(), /Group lead in Modes/);
    const nums = panel.locator('.ms-jr-panel__nums dd').first();
    assert.deepEqual(await nums.evaluate((n) => [getComputedStyle(n).textAlign, getComputedStyle(n).fontVariantNumeric]), ['right', 'tabular-nums']);
    await panel.locator('.ms-copyable').first().hover();
    assert.equal(await panel.getByRole('button', { name: 'Copy page address' }).count(), 1);
    await page.locator('.ms-fl-trail').getByRole('button', { name: '← All pages' }).waitFor();
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await check(`step, ${scheme}`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await shots('flow-step');

    // walk on: the page clicked is the new centre, the trail keeps the way back; Back and Forward
    await card('The editing guide').click();
    await hashHas('page=posts/guide');
    await hashHas('trail=posts/canvas');
    const trail = page.locator('.ms-fl-trail');
    await trail.getByRole('button', { name: 'Back to A1: Canvas basics' }).waitFor();
    assert.match(await trail.innerText(), /Trail:\s*A1\s*→\s*M\s*The editing guide/);
    await page.goBack();
    await page.waitForFunction(() => decodeURIComponent(location.hash).includes('page=posts/canvas') && !location.hash.includes('trail='));
    await page.goForward();
    await hashHas('trail=posts/canvas');
    await trail.getByRole('button', { name: 'Back to A1: Canvas basics' }).click();
    await page.waitForFunction(() => decodeURIComponent(location.hash).includes('page=posts/canvas') && !location.hash.includes('trail='));
    // Esc: back to the river
    await page.locator('.ms-fl-card.is-picked').focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.hash.includes('page='));
    await card('Keyboard shortcuts for editors').waitFor();

    // by keyboard: Tab to a card (its focus shows), Enter shows its step
    await card('Canvas basics').focus();
    await page.keyboard.press('Tab');
    assert.deepEqual(await page.evaluate(() => [document.activeElement.textContent.includes('Keyboard shortcuts'), document.activeElement.matches(':focus-visible'), getComputedStyle(document.activeElement).outlineStyle]), [true, true, 'solid']);
    await page.keyboard.press('Enter');
    await hashHas('page=posts/shortcuts');
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('page='));

    // folded groups: their lead only, "N pages ▸" opens one (the URL keeps which)
    await open('#/topic-map/editing?view=flow&open=none');
    await page.locator('.ms-fl-card.is-folded', { hasText: 'Canvas basics' }).waitFor();
    assert.equal(await card('Keyboard shortcuts for editors').count(), 0);
    const fold = page.getByRole('button', { name: /^Open Modes: \d+ pages?$/ });
    assert.match(await fold.innerText(), /Modes · \d+ pages? ▸/);
    await fold.click();
    await page.waitForFunction(() => location.hash.includes('open=modes'));
    await card('Keyboard shortcuts for editors').waitFor();
    await check('one group opened');
    await page.goBack();
    await page.waitForFunction(() => location.hash.includes('open=none'));
    await page.locator('.ms-fl-card.is-folded', { hasText: 'Canvas basics' }).waitFor();

    // one group alone; the View popover (all off at first): side links, deep links, ages, the date
    await open('#/topic-map/editing?view=flow');
    await page.locator('.ms-fl-groups button', { hasText: 'Modes' }).click();
    await hashHas('group=modes');
    await page.waitForFunction(() => ![...document.querySelectorAll('.ms-fl-card')].some((c) => c.textContent.includes('Field notes')));
    await page.goBack();
    await card('Field notes').waitFor();
    await page.getByRole('button', { name: /^View/ }).click();
    await hashHas('options=1');
    const pop = page.locator('#ms-fl-options');
    for (const b of ['Show side links', 'Show deep links']) assert.equal(await pop.getByRole('button', { name: b }).getAttribute('aria-pressed'), 'false');
    await pop.getByRole('button', { name: 'Show deep links' }).click();
    await hashHas('deep=1');
    await page.waitForFunction(() => document.querySelector('#ms-fl-options button[aria-pressed="true"]')?.textContent === 'Show deep links');
    await pop.getByRole('button', { name: /^New/ }).click();
    await hashHas('age=new');
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('age='));
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('deep='));
    assert.equal(await page.locator('path.ms-fl-ln.is-deep').count(), 0);

    // reduced motion: no movement when the view changes
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await card('Canvas basics').click();
    await hashHas('page=posts/canvas');
    assert.equal(await page.locator('.ms-fl-world').evaluate((w) => w.getAnimations().length), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // from a 1280px window up: the layout check on the river and on a step, nothing cut, no "…", no sideways scroll
    const size = page.viewportSize();
    for (const width of [1280, 1512, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const where of ['#/topic-map/editing?view=flow', '#/topic-map/editing?view=flow&page=posts/canvas']) {
        await open(where);
        await page.locator('.ms-fl-world [data-x]').first().waitFor();
        await page.waitForTimeout(250);
        await check(`${width}px ${where}`);
        assert.doesNotMatch(await page.locator('.ms-fl-wrap').innerText(), /…/, `${width}px: "…" on the screen`);
      }
    }
    if (size) await page.setViewportSize(size);
  });
});
