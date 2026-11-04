// The Releases screens (editor src/releases/) in a real browser, against a real server whose site builds a page per
// live post and has a share origin (test/release-site.mjs). Every state has its URL: the list and its New panel, a
// release by its opaque id, its tab, each panel; one no one can open says "Not available to you". A page's unsaved
// changes go into a release from the More menu and leave the editor, never touching the site; a Library change goes
// in from the Library, and a synced item is refused in the server's words (a release made for it is cancelled). The
// preview is built, then says in the server's words when the site moved on. A share link's address is shown once,
// with copy and open, never in the editor's own URL; a visitor's views are counted, right-aligned; Turn off ends it.
// Scheduled, unscheduled, then published: the page is live with the words typed in the editor. A draft's own share
// links. Test users are made up here; the browsers opened here are closed in `after`.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: the server takes a free one; the share origin is RELEASES_UI_PORT, MARKSTAGE_E2E_PORT_BASE +2 (support.mjs).
// Screenshots (light and dark) go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { TMP_ROOT, addUser, client } from '../test/helpers.mjs';
import { releaseServer } from '../test/release-site.mjs';
import { buildEditor } from './build-editor.mjs';
import { RELEASES_UI_PORT, SHOTS, pw, skip, blank } from './support.mjs';

describe('the Releases screens in a browser', { skip }, () => {
  let fx, srv, clock, shareOrigin, browser, ctx, page, owner, ed, rid, lid, shared;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const open = async (where) => {
    await blank(page);
    await page.goto(`${srv.base}/markstage/${where}`);
  };
  const title = (text) => page.locator('h1.ms-adm-title', { hasText: text }).waitFor();
  const shots = async (name) => {
    if (!SHOTS) return;
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `releases-${name}-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  before(async () => {
    const editorDir = await buildEditor(path.join(TMP_ROOT, `releases-ui-editor-${crypto.randomBytes(4).toString('hex')}`), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    ({ fx, srv, clock, shareOrigin } = await releaseServer({ sharePort: RELEASES_UI_PORT, overrides: { editorDir } }));
    // the browser's clock is the real one: the schedule's time picker and the server must agree on "now"
    clock.now = Date.now();
    srv.app.backup?.stop?.();
    owner = await addUser(srv.app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    ed = client(srv.base);
    await ed.login(owner.email, owner.password);
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await open('#/releases');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await title('Go live');
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await srv?.close();
  });

  test('the list and its New panel by URL; a new release opens by its opaque id; one no one can open is not available', async () => {
    await open('#/releases');
    await page.getByText('No releases yet').waitFor();
    await page.getByRole('button', { name: 'New release…' }).click();
    assert.equal(hash(), '#/releases?do=new');
    await page.getByLabel('Name', { exact: true }).fill('Spring launch');
    await page.getByLabel('What it is for (optional)').fill('The spring pricing and its post.');
    await page.getByRole('button', { name: 'Make the release' }).click();
    await title('Spring launch');
    rid = /^#\/releases\/([^/?]+)$/.exec(hash())?.[1];
    const made = (await ed.get('/releases')).json.releases;
    assert.deepEqual(made.map((r) => r.id), [rid], 'the URL holds the release’s id, nothing else');
    await page.getByText('Nothing in it yet').waitFor();
    // reload keeps it; the list links to it
    await page.reload();
    await title('Spring launch');
    await open('#/releases?status=open');
    await page.getByRole('link', { name: 'Spring launch' }).waitFor();
    assert.equal(await page.locator('.ms-rel-table td.ms-num').first().evaluate((td) => getComputedStyle(td).textAlign), 'right');
    await shots('list');
    await open('#/releases/rel_nobody');
    await page.getByText('Not available to you').waitFor();
  });

  test('a page’s unsaved changes go into the release from the More menu, not on the site, and leave the editor', async () => {
    const before = read('src/content/blog/bob-draft.md');
    await open('#/e/posts/bob-draft');
    const sheet = page.locator('.ms-sheet .ProseMirror');
    await sheet.getByText('A draft by Bob.').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Ready for spring.');
    await page.waitForFunction(() => document.querySelector('.ms-status')?.dataset.status !== 'saved');
    await page.locator('[data-more]').click();
    await page.getByRole('menuitem', { name: 'Add with my changes to a release…' }).click();
    assert.equal(hash(), '#/releases/add?c=posts&id=bob-draft');
    await page.getByText('with your unsaved changes').waitFor();
    const choice = page.getByRole('radio', { name: /Spring launch/ });
    assert.equal(await choice.isChecked(), true, 'the only open release is chosen');
    await page.getByRole('radio', { name: /A new release/ }).check();
    assert.match(hash(), /to=new/);
    await choice.check();
    assert.match(hash(), new RegExp(`to=${rid}`));
    await shots('add');
    await page.getByRole('button', { name: 'Add to the release' }).click();
    await page.waitForFunction(() => location.hash.split('?')[0] === '#/e/posts/bob-draft');
    await page.getByText('Added to “Spring launch”.').waitFor();
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    // the editor shows the page as saved; the site has not changed; the release has the words
    await page.waitForFunction(() => !document.querySelector('.ms-sheet .ProseMirror')?.textContent?.includes('Ready for spring.'));
    assert.equal(read('src/content/blog/bob-draft.md'), before);
    const r = (await ed.get(`/releases/${rid}`)).json;
    assert.deepEqual(r.items.map((i) => [i.kind, i.entryId]), [['entry', 'bob-draft']]);
    assert.match((await ed.get(`/releases/${rid}/items/${r.items[0].id}`)).json.text, /A draft by Bob\. Ready for spring\./);
    await page.getByRole('button', { name: 'Open the release' }).click();
    await title('Spring launch');
    await page.locator('.ms-rel-itemtable').getByRole('link', { name: 'Bob Draft', exact: true }).waitFor();
  });

  test('a page (sections) goes in with its unsaved data, and the editor shows it as saved', async () => {
    const before = read('src/content/pages/about.json');
    await open('#/p/pages/about?sec=0');
    await page.locator('[data-path="sections.0.value.heading"] input, [data-path="sections.0.value.heading"] textarea').first().fill('We are here for spring');
    await page.waitForFunction(() => document.querySelector('.ms-status')?.dataset.status !== 'saved');
    await page.locator('[data-more]').click();
    await page.getByRole('menuitem', { name: 'Add with my changes to a release…' }).click();
    assert.equal(hash(), '#/releases/add?c=pages&id=about');
    await page.getByRole('button', { name: 'Add to the release' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/p/pages/about'));
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    assert.equal(await page.locator('[data-path="sections.0.value.heading"] input, [data-path="sections.0.value.heading"] textarea').first().inputValue(), 'We are here');
    assert.equal(read('src/content/pages/about.json'), before);
    const it = (await ed.get(`/releases/${rid}`)).json.items.find((i) => i.entryId === 'about');
    assert.equal(JSON.parse((await ed.get(`/releases/${rid}/items/${it.id}`)).json.text).sections[0].value.heading, 'We are here for spring');
  });

  test('a Library change goes in from the Library; a synced item is refused in the server’s words, and a release made for it is cancelled', async () => {
    const note = (await ed.post('/library', { kind: 'snippet', name: 'Launch note', shared: true, body: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Now open.' }] }] } } })).json;
    const sync = (await ed.post('/library', { kind: 'section', name: 'Talk to us', synced: true, body: { value: { discriminant: 'hero', value: { heading: 'Hi' } } } })).json;
    assert.ok(note.id && sync.id);
    await open(`#/library?open=${note.id}`);
    await page.getByRole('button', { name: 'Add to a release…' }).click();
    assert.equal(hash(), `#/releases/add?lib=${note.id}`);
    // nothing changed yet: said, nothing sent
    await page.getByRole('button', { name: 'Add to the release' }).click();
    await page.getByText('Change something first').waitFor();
    await page.getByLabel('Name', { exact: true }).fill('Launch note (spring)');
    await page.getByRole('button', { name: 'Add to the release' }).click();
    await page.waitForFunction((id) => location.hash === `#/library?open=${id}`, note.id);
    const r = (await ed.get(`/releases/${rid}`)).json;
    assert.deepEqual(r.items.map((i) => i.kind).sort(), ['entry', 'entry', 'library']);
    assert.equal(r.items.find((i) => i.kind === 'library').title, 'Launch note (spring)');
    assert.equal((await ed.get(`/library/${note.id}`)).json.name, 'Launch note', 'the Library keeps it as it is until the release goes live');

    const words = 'A synced item changes every page that uses it at once. Change it in the Library, not in a release.';
    await open(`#/releases/add?lib=${sync.id}&to=${rid}`);
    await page.getByRole('button', { name: 'Add to the release' }).click();
    await page.locator('.ms-adm-form__err', { hasText: words }).waitFor();
    await open(`#/releases/add?lib=${sync.id}&to=new`);
    await page.getByLabel('The new release’s name').fill('Only the synced one');
    await page.getByRole('button', { name: 'Add to the release' }).click();
    await page.locator('.ms-adm-form__err', { hasText: words }).waitFor();
    await page.waitForTimeout(300);
    const left = (await ed.get('/releases')).json.releases.find((x) => x.name === 'Only the synced one');
    assert.equal(left?.status, 'cancelled', 'the release made for it is not left open and empty');
  });

  test('the preview: built, up to date, then stale in the server’s words once the site moved on', async () => {
    await open(`#/releases/${rid}`);
    await page.getByRole('button', { name: 'Build the preview' }).click();
    await page.locator('.ms-rel-preview .ms-adm-outcome.is-ok', { hasText: 'Up to date' }).waitFor({ timeout: 60_000 });
    await shots('release');
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/with-html.md'), read('src/content/blog/with-html.md').replace('Intro.', 'Intro, changed.'));
    fx.git('commit', '-q', '-am', 'Another change went live');
    await page.reload();
    await page.locator('.ms-rel-preview .ms-adm-outcome.is-warn', { hasText: 'The site changed since this preview was built (another change went live). It is not what would go live now: build it again.' }).waitFor();
    await page.getByRole('button', { name: 'Build it again' }).click();
    await page.locator('.ms-rel-preview .ms-adm-outcome.is-ok', { hasText: 'Up to date' }).waitFor({ timeout: 60_000 });
  });

  test('a share link: shown once with copy and open, never in the editor’s URL; a visit counts, right-aligned; turned off it ends', async () => {
    await page.getByRole('button', { name: 'Share it…' }).click();
    assert.equal(hash(), `#/releases/${rid}?tab=links&do=share`);
    await page.getByLabel('Label (optional)').fill('For the client');
    await page.getByRole('button', { name: 'Make the link' }).click();
    await page.getByRole('heading', { name: 'Copy the link now' }).waitFor();
    const url = (await page.locator('.ms-rel-secret .ms-rel-url').innerText()).trim();
    assert.ok(url.startsWith(`${shareOrigin}/share/`), url);
    const token = url.slice(`${shareOrigin}/share/`.length);
    lid = new URLSearchParams(hash().split('?')[1]).get('made');
    assert.ok(lid && !page.url().includes(token), 'the URL names the link, not its secret');
    await page.locator('.ms-rel-secret').getByRole('button', { name: 'Copy the share link' }).waitFor({ state: 'attached' });
    await page.locator('.ms-rel-secret').getByRole('link', { name: 'Open the share link in a new tab' }).or(page.locator('.ms-rel-secret').getByRole('button', { name: 'Open the share link in a new tab' })).waitFor({ state: 'attached' });
    await shots('share-once');

    // someone with no account opens it: the release's preview, with the words typed in the editor
    const visitor = await browser.newContext();
    const v = await visitor.newPage();
    await v.goto(url);
    await v.getByText('A draft by Bob. Ready for spring.').waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Done' }).click();
    assert.equal(hash(), `#/releases/${rid}?tab=links`);
    const views = page.locator('.ms-rel-linktable tbody td.ms-num').first();
    await page.reload();
    await views.waitFor();
    assert.ok(Number(await views.innerText()) >= 1, 'the visit is counted');
    assert.equal(await views.evaluate((td) => getComputedStyle(td).textAlign), 'right');
    assert.equal(await page.locator('.ms-rel-linktable thead th.ms-num').evaluate((th) => getComputedStyle(th).textAlign), 'right');
    // the made= panel opened again: the address is gone for good
    await open(`#/releases/${rid}?tab=links&do=share&made=${lid}`);
    await page.getByText('The address is not shown again').waitFor();
    await page.getByRole('button', { name: 'Close' }).first().click().catch(() => undefined);
    await open(`#/releases/${rid}?tab=links`);
    await page.getByRole('button', { name: 'Turn off' }).click();
    await page.getByRole('button', { name: 'Turn it off' }).click();
    await page.locator('.ms-rel-linktable').getByText('Turned off', { exact: true }).first().waitFor();
    const res = await v.reload();
    assert.equal(res.status(), 410);
    await visitor.close();
  });

  test('scheduled, unscheduled, then published now: the page is live with the words typed in the editor', async () => {
    await open(`#/releases/${rid}`);
    await page.getByRole('button', { name: 'Schedule…' }).click();
    assert.equal(hash(), `#/releases/${rid}?do=schedule`);
    const at = new Date(Date.now() + 2 * 3_600_000);
    const p = (n) => String(n).padStart(2, '0');
    await page.getByLabel('Goes live at (your time)').fill(`${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`);
    await page.locator('.ms-adm-drawer').getByRole('button', { name: 'Schedule' }).click();
    await page.locator('.ms-rel-golive h2', { hasText: 'Scheduled' }).waitFor();
    assert.equal(await page.locator('.ms-adm-head .ms-rel-status').innerText(), 'Scheduled');
    assert.equal((await ed.get(`/releases/${rid}`)).json.status, 'scheduled');
    await page.getByRole('button', { name: 'Unschedule' }).click();
    await page.locator('.ms-rel-golive h2', { hasText: 'Go live' }).waitFor();
    await page.getByRole('button', { name: 'Publish now' }).click();
    await page.locator('.ms-adm-outcome.is-ok', { hasText: 'Live.' }).waitFor({ timeout: 90_000 });
    assert.equal(await page.locator('.ms-adm-head .ms-rel-status').innerText(), 'Live');
    assert.match(read('src/content/blog/bob-draft.md'), /A draft by Bob\. Ready for spring\./);
    assert.match(fs.readFileSync(path.join(fx.live, 'blog/bob-draft/index.html'), 'utf8'), /Ready for spring\./);
    assert.equal(JSON.parse(read('src/content/pages/about.json')).sections[0].value.heading, 'We are here for spring');
    await page.getByRole('button', { name: 'Roll back…' }).click();
    assert.equal(hash(), `#/releases/${rid}?do=rollback`);
    await shots('live');
  });

  test('a draft’s own share links, by its URL; a live page says why it has none', async () => {
    await open('#/share/posts/carol-draft');
    await title('Share links');
    await page.getByRole('button', { name: 'New share link…' }).click();
    assert.equal(hash(), '#/share/posts/carol-draft?do=share');
    await page.getByRole('button', { name: 'Make the link' }).click();
    await page.getByRole('heading', { name: 'Copy the link now' }).waitFor();
    const url = (await page.locator('.ms-rel-secret .ms-rel-url').innerText()).trim();
    assert.ok(url.startsWith(`${shareOrigin}/share/`) && !page.url().includes(url.split('/share/')[1]));
    shared = (await ed.get('/share-links?collection=posts&id=carol-draft')).json.links;
    assert.equal(shared.length, 1);
    await open('#/share/posts/hello-world');
    await page.getByText('This page is live: share its address on the site instead.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'New share link…' }).count(), 0);
  });
});
