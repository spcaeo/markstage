// The lists screen in a real browser (admin/entries.ts), against a real server on 127.0.0.1 with test users made up
// here: every filter, the sort, the page and the ticked rows are in the URL, and reload, Back and Forward give them
// back; sortable headers; the row's drawer with copy on values, copy and open on the address; numbers right-aligned
// in tabular figures; the ticked rows' bar (Go live, Move to trash with Undo, Change many…); a phone's rows.
// The browser opened here is closed in `after`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { ENTRIES_PORT, SHOTS, pw, skip, foldNav } from './support.mjs';

const BASE = `http://127.0.0.1:${ENTRIES_PORT}`;
const PARTS = 54;

describe('the lists screen in a browser', { skip }, () => {
  let fx, app, browser, ctx, page, owner, writer;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const params = () => Object.fromEntries(new URLSearchParams(decodeURIComponent(new URL(page.url()).hash).split('?')[1] ?? ''));
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  const rows = () => page.locator('table.ms-adm-entries tbody tr');
  const titles = async () => (await page.locator('table.ms-adm-entries tbody tr .ms-adm-rowlink').allTextContents()).map((t) => t.trim());
  /** Waits until the table shows what the URL asks for (the first title as given). */
  const settled = async (first) => page.locator('table.ms-adm-entries tbody tr').first().locator('.ms-adm-rowlink', { hasText: first }).waitFor();
  /** Each column header's label and width, and where the table starts on the page. */
  const columns = () => page.locator('table.ms-adm-entries thead th').evaluateAll((ths) => ths.map((th) => [/ms-adm-col--(\w+)/.exec(th.className)?.[1] ?? 'tick', Math.round(th.getBoundingClientRect().width)]));
  const tableTop = () => page.locator('table.ms-adm-entries').evaluate((t) => Math.round(t.getBoundingClientRect().top + window.scrollY));
  let widths = null;
  const cookie = async () => (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  async function signIn(who, to) {
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }

  before(async () => {
    fx = makeFixture({ checks: false });
    // 54 more posts: "Part 1" to "Part 54", by alice and bob, every third a draft, a few tagged, each its own date
    for (let n = 1; n <= PARTS; n++) {
      const day = String(1 + (n % 28)).padStart(2, '0');
      const month = n <= 28 ? '03' : '04';
      const words = Array.from({ length: n * 3 }, (_, i) => `word${i}`).join(' ');
      fs.writeFileSync(
        path.join(fx.site, `src/content/blog/part-${n}.md`),
        `---\ntitle: Part ${n}\nauthor: ${n % 2 ? 'alice' : 'bob'}\ndate: '2026-${month}-${day}T10:00:00.000Z'\nmodified: '2026-${month}-${day}T12:00:00.000Z'\n${n % 5 ? '' : 'tags:\n  - series\n'}${n % 3 ? '' : 'draft: true\n'}---\n\n${words}\n`,
      );
    }
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A series');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: ENTRIES_PORT, editorDir } });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(ENTRIES_PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    writer = await addUser(app, { email: 'alice@example.test', name: 'Alice Author', role: 'author', password: pass(), authorSlug: 'alice' });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await foldNav(ctx);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    await browser?.close();
    await app?.close();
  });

  test('the list: newest change first, 50 to a page, counts on the status chips, numbers right-aligned', async () => {
    await signIn(owner, '#/entries');
    await rows().first().waitFor();
    assert.equal(await rows().count(), 50);
    // the newest change first: Part 54 (27 April), then Part 53
    assert.deepEqual((await titles()).slice(0, 2), ['Part 54', 'Part 53']);
    assert.equal(await page.locator('th', { hasText: 'Last edited' }).getAttribute('aria-sort'), 'descending');
    // title first and bold, then the pill, when it was last edited, and one number column; the New button
    assert.equal(await page.locator('table.ms-adm-entries tbody tr').first().locator('.ms-adm-rowlink').evaluate((e) => getComputedStyle(e).fontWeight), '600');
    assert.equal(await page.locator('table.ms-adm-entries tbody tr').first().locator('.ms-adm-pill').textContent(), 'Draft', 'Part 54 is a draft (every third)');
    assert.equal(await page.getByRole('link', { name: 'New post' }).getAttribute('href'), '#/new/posts');
    await page.getByText(`1–50 of ${PARTS + 4}`).waitFor();
    const chip = (name) => page.getByRole('group', { name: 'Status' }).getByRole('button', { name: new RegExp(`^${name} `) });
    assert.equal((await chip('All').textContent()).trim(), `All ${PARTS + 4}`);
    assert.equal((await chip('Drafts').textContent()).trim(), `Drafts ${Math.floor(PARTS / 3) + 2}`);
    // the Words column: right-aligned, tabular figures, header too
    const wordsHead = page.locator('table.ms-adm-entries th', { hasText: 'Words' });
    const style = (loc) => loc.evaluate((e) => [getComputedStyle(e).textAlign, getComputedStyle(e).fontVariantNumeric]);
    assert.deepEqual(await style(wordsHead), ['right', 'tabular-nums']);
    assert.deepEqual(await style(page.locator('table.ms-adm-entries tbody td.ms-num').first()), ['right', 'tabular-nums']);
    assert.equal((await style(page.locator('.ms-adm-paging .ms-num')))[1], 'tabular-nums');
    assert.equal((await style(chip('All').locator('.ms-num')))[1], 'tabular-nums');
    // set column widths: the next views must not move them
    assert.equal(await page.locator('table.ms-adm-entries').evaluate((t) => getComputedStyle(t).tableLayout), 'fixed');
    widths = await columns();
    assert.deepEqual(widths.map(([l]) => l), ['tick', 'title', 'status', 'modified', 'words', 'more']);
    // the title column keeps at least 240 px, so a title never wraps one word per line; the whole title is the tooltip
    assert.ok(widths[1][1] >= 240, `title column ${widths[1][1]} px`);
    assert.equal(await rows().first().locator('td').nth(1).locator('.ms-adm-sub').count(), 0);
    assert.match(await rows().first().locator('td.ms-adm-col--title').getAttribute('title'), /^Part 54\nBy bob\n\/blog\/part-54\//);
    await shot('entries-01-list');
  });

  test('filters, sort and page are in the URL; Back and Forward walk them; a reload keeps the view', async () => {
    await page.goto(`${BASE}/markstage/#/entries?c=posts`);
    await rows().first().waitFor();
    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Drafts / }).click();
    await page.waitForURL(/status=draft/);
    await page.getByRole('combobox', { name: 'Filter by author' }).selectOption('bob');
    await page.waitForURL(/author=bob/);
    // drafts by bob: every 6th part, and Bob Draft
    const bobDrafts = Array.from({ length: PARTS }, (_, i) => i + 1).filter((n) => n % 6 === 0).length + 1;
    await page.getByText(`1–${bobDrafts} of ${bobDrafts}`).waitFor();
    // the title header: A to Z (numbers in their order), then Z to A
    await page.getByRole('button', { name: 'Title', exact: true }).click();
    await page.waitForURL(/sort=title/);
    await settled('Bob Draft');
    assert.deepEqual((await titles()).slice(0, 3), ['Bob Draft', 'Part 6', 'Part 12']);
    assert.equal(await page.locator('th', { hasText: 'Title' }).getAttribute('aria-sort'), 'ascending');
    await page.getByRole('button', { name: 'Title', exact: true }).click();
    await page.waitForURL(/sort=-title/);
    await settled('Part 54');
    assert.equal(await page.locator('th', { hasText: 'Title' }).getAttribute('aria-sort'), 'descending');
    assert.deepEqual(params(), { c: 'posts', status: 'draft', author: 'bob', sort: '-title' });
    await page.reload();
    await settled('Part 54');
    assert.equal(await page.getByRole('combobox', { name: 'Filter by author' }).inputValue(), 'bob');
    assert.equal(await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Drafts / }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await columns(), widths, 'the columns keep their widths in a filtered, sorted view');
    await shot('entries-02-filtered');
    // Back: A to Z again; Back: by any status order; Forward returns
    await page.goBack();
    await page.waitForURL((u) => /sort=title/.test(decodeURIComponent(u.hash)) && !/sort=-title/.test(decodeURIComponent(u.hash)));
    await settled('Bob Draft');
    await page.goBack();
    await page.waitForURL((u) => !/sort=/.test(u.hash));
    await page.goForward();
    await page.waitForURL(/sort=title/);
    await settled('Bob Draft');
  });

  test('an older list that comes back late never draws under a newer view (Back and Forward quickly)', async () => {
    await page.goto(`${BASE}/markstage/#/entries?c=posts&sort=title`);
    await settled('Bob Draft');
    // the newest-first list answers late: it is asked for, then the view goes Back to A to Z before it comes
    let late = 0;
    const hold = async (route) => {
      late++;
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue().catch(() => {});
    };
    await page.route((u) => u.pathname.endsWith('/collections/posts/entries') && u.searchParams.get('sort') === '-modified', hold);
    await page.evaluate(() => (location.hash = '#/entries?c=posts'));
    await page.waitForFunction(() => !location.hash.includes('sort='));
    await page.goBack();
    await page.waitForFunction(() => decodeURIComponent(location.hash).includes('sort=title'));
    await settled('Bob Draft');
    await page.waitForTimeout(1600);
    await page.unroute((u) => u.pathname.endsWith('/collections/posts/entries') && u.searchParams.get('sort') === '-modified', hold);
    assert.equal(late, 1, 'the newest-first list was asked for');
    assert.equal((await titles())[0], 'Bob Draft', 'A to Z still, as the URL says');
    assert.equal(await page.locator('th', { hasText: 'Title' }).getAttribute('aria-sort'), 'ascending');
  });

  test('the search and the pages: words narrow it and start again at page 1; Next and Previous are history entries', async () => {
    await page.goto(`${BASE}/markstage/#/entries?c=posts&sort=title`);
    await settled('Bob Draft');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForURL(/page=2/);
    await page.getByText(`51–${PARTS + 4} of ${PARTS + 4}`).waitFor();
    await page.goBack();
    await page.waitForURL((u) => !/page=/.test(u.hash));
    await page.getByText(`1–50 of ${PARTS + 4}`).waitFor();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForURL(/page=2/);
    await page.getByRole('searchbox', { name: 'Search entries' }).fill('part 1');
    await page.waitForURL((u) => /q=part/.test(u.hash) && !/page=/.test(u.hash));
    // Part 1, Part 10 to Part 19
    await page.getByText('1–11 of 11').waitFor();
    assert.deepEqual((await titles()).slice(0, 3), ['Part 1', 'Part 10', 'Part 11']);
    await page.getByRole('combobox', { name: 'Filter by tag' }).selectOption('series');
    await page.waitForURL(/tag=series/);
    await page.getByText('1–2 of 2').waitFor();
    assert.deepEqual(await titles(), ['Part 10', 'Part 15']);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.waitForURL((u) => !/q=|tag=/.test(u.hash));
    await page.getByText(`1–50 of ${PARTS + 4}`).waitFor();
  });

  test('the row’s drawer: the address copies and opens, the author and title copy; it is in the URL', async () => {
    await page.goto(`${BASE}/markstage/#/entries?c=posts&sort=title&q=hello`);
    await settled('Hello World');
    const row = rows().first();
    await row.hover();
    await row.getByRole('button', { name: 'Details of “Hello World”' }).click();
    await page.waitForURL(/item=hello-world/);
    const d = page.locator('.ms-adm-drawer');
    const address = d.locator('.ms-copyable', { hasText: '/blog/hello-world/' });
    await address.hover();
    await address.getByRole('button', { name: 'Copy address' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '/blog/hello-world/');
    assert.match(await address.getAttribute('class'), /is-done/);
    assert.equal(await address.getByRole('link', { name: 'Open address in a new tab' }).getAttribute('href'), `${BASE}/blog/hello-world/`);
    await d.locator('.ms-copyable', { hasText: 'alice' }).hover();
    await d.getByRole('button', { name: 'Copy author' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'alice');
    await d.getByRole('button', { name: 'Copy title' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Hello World');
    assert.equal(await d.getByRole('link', { name: 'Open', exact: true }).getAttribute('href'), '#/e/posts/hello-world');
    await shot('entries-04-drawer');
    // a reload keeps it open; Escape closes it
    await page.reload();
    await d.getByRole('button', { name: 'Copy title' }).waitFor();
    await d.focus();
    await page.keyboard.press('Escape');
    await page.waitForURL((u) => !/item=/.test(u.hash));
    // the slug finds it
    await page.goto(`${BASE}/markstage/#/entries?c=posts&sort=title&q=hello-world`);
    await settled('Hello World');
    assert.equal(await rows().count(), 1);
    // the title opens the entry
    await row.getByRole('link', { name: 'Hello World' }).click();
    await page.waitForURL(/#\/e\/posts\/hello-world/);
  });

  test('ticked rows are in the URL and go to Change many entries; an author sees no ticks', async () => {
    await page.goto(`${BASE}/markstage/#/entries?c=posts&sort=title&q=part 2`);
    await settled('Part 2');
    // the ticked rows' bar keeps its place: ticking does not move the table under the cursor
    const top = await tableTop();
    await page.getByRole('checkbox', { name: 'Tick “Part 2”' }).check();
    await page.getByText('1 selected').waitFor();
    assert.equal(await tableTop(), top);
    await page.getByRole('checkbox', { name: 'Tick “Part 20”' }).check();
    await page.waitForURL(/sel=part-2(%2C|,)part-20/);
    await page.reload();
    await page.getByText('2 selected').waitFor();
    assert.ok(await page.getByRole('checkbox', { name: 'Tick “Part 20”' }).isChecked());
    assert.equal(await tableTop(), top);
    assert.deepEqual(await columns(), widths, 'and the columns keep their widths');
    await shot('entries-03-ticked');
    await page.getByRole('button', { name: 'Change many…' }).click();
    await page.waitForURL(/#\/bulk\?items=/);
    assert.equal(new URLSearchParams(decodeURIComponent(new URL(page.url()).hash).split('?')[1]).get('items'), 'posts/part-2,posts/part-20');
    // a collection that is not there, or not yours: "Not available to you"
    await page.goto(`${BASE}/markstage/#/entries?c=nope`);
    await page.getByText('Not available to you').waitFor();
    // an author: the list, no ticks
    await page.evaluate(() => fetch('/markstage/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } }));
    await ctx.clearCookies();
    await signIn(writer, '#/entries?c=posts&author=alice');
    await rows().first().waitFor();
    assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'New post' }).count(), 1, 'an author may start a post');
  });

  test('the date and needs-attention filters are in the URL; nothing matching says so with Clear filters', async () => {
    await page.evaluate(() => fetch('/markstage/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } }));
    await ctx.clearCookies();
    await signIn(owner, '#/entries?c=posts');
    await rows().first().waitFor();
    // every fixture entry has a description but the series: 54 without one
    await page.getByRole('combobox', { name: 'Needs attention' }).selectOption('no-description');
    await page.waitForURL(/attention=no-description/);
    await page.getByText(`1–50 of ${PARTS + 3}`).waitFor();
    await page.getByRole('combobox', { name: 'Filter by date' }).selectOption('7d');
    await page.waitForURL(/date=7d/);
    await page.getByText('Nothing matches').waitFor();
    await shot('entries-05-nothing-matches');
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await page.waitForURL((u) => !/attention=|date=/.test(u.hash));
    await page.getByText(`1–50 of ${PARTS + 4}`).waitFor();
  });

  test('ticked rows: Go live publishes the drafts; Move to trash takes them out, and Undo brings them back', async () => {
    await page.goto(`${BASE}/markstage/#/entries?c=posts&sort=title&q=part 3`);
    await settled('Part 3');
    // Part 3 is a draft (every third): Go live
    await page.getByRole('checkbox', { name: 'Tick “Part 3”' }).check();
    await page.getByRole('button', { name: 'Go live' }).click();
    await page.getByRole('button', { name: 'Go live' }).last().click();
    await page.locator('.ms-toast', { hasText: '1 going live.' }).waitFor();
    await app.jobs.idle();
    assert.equal((await (await fetch(`${BASE}/markstage/api/collections/posts/entries?q=part 3&sort=title`, { headers: { cookie: await cookie() } })).json()).items[0].status, 'published');
    // Move to trash, then Undo
    await page.goto(`${BASE}/markstage/#/entries?c=posts&sort=title&q=part 4`);
    await settled('Part 4');
    await page.getByRole('checkbox', { name: 'Tick “Part 4”' }).check();
    await page.getByRole('checkbox', { name: 'Tick “Part 40”' }).check();
    await page.getByText('2 selected').waitFor();
    await shot('entries-06-selected');
    await page.getByRole('button', { name: 'Move to trash' }).click();
    await page.getByRole('button', { name: 'Move to trash' }).last().click();
    const toast = page.locator('.ms-toast', { hasText: 'Moved 2 to the trash.' });
    await toast.waitFor();
    await page.waitForFunction(() => !document.querySelector('input[aria-label=\'Tick “Part 4”\']'));
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/part-4.md')));
    await app.jobs.idle();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await page.locator('.ms-toast', { hasText: 'Brought 2 back as drafts.' }).waitFor();
    await page.getByRole('checkbox', { name: 'Tick “Part 4”' }).waitFor();
    assert.ok(fs.existsSync(path.join(fx.site, 'src/content/blog/part-4.md')));
  });

  test('the open entry’s menu: Duplicate opens a draft copy; Move to the trash takes it out and shows the list', async () => {
    await page.goto(`${BASE}/markstage/#/e/posts/part-5`);
    await page.locator('[data-more]').waitFor();
    await page.waitForTimeout(800);
    await page.locator('[data-more]').click();
    await page.getByRole('menuitem', { name: 'Duplicate…' }).or(page.locator('.ms-menu:not([hidden]) button', { hasText: 'Duplicate…' })).first().click();
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await page.waitForURL(/#\/e\/posts\/part-5-copy/);
    assert.ok(fs.existsSync(path.join(fx.site, 'src/content/blog/part-5-copy.md')));
    assert.match(fs.readFileSync(path.join(fx.site, 'src/content/blog/part-5-copy.md'), 'utf8'), /title: Part 5 \(copy\)/);
    // the copy to the trash: the list of posts shows, the file is gone
    await page.waitForTimeout(800);
    await page.locator('[data-more]').click();
    await page.locator('.ms-menu:not([hidden]) button', { hasText: 'Move to the trash…' }).click();
    await page.getByRole('button', { name: 'Move to the trash', exact: true }).click();
    await page.waitForURL(/#\/entries\?c=posts/);
    await page.locator('.ms-toast', { hasText: '“Part 5 (copy)” is in the trash.' }).waitFor();
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/part-5-copy.md')));
    await rows().first().waitFor();
  });

  test('on a phone the table is a list of rows with the title, the pill and the last edit, and no sideways scroll', async () => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto(`${BASE}/markstage/#/entries?c=posts`);
    await rows().first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
    const first = rows().first();
    assert.equal(await first.locator('.ms-adm-rowlink').isVisible(), true);
    assert.equal(await first.locator('.ms-adm-pill').isVisible(), true);
    assert.equal(await first.locator('td.ms-adm-col--modified').isVisible(), true);
    assert.equal(await first.locator('td.ms-adm-col--words').isVisible(), false);
    assert.equal(await page.locator('table.ms-adm-entries thead').isVisible(), false);
    await shot('entries-07-phone');
    await page.setViewportSize({ width: 1360, height: 900 });
  });
});
