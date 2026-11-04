// Authors (#/authors, editor src/admin/authors/, and the author field of Post settings) in a real browser, against a
// real server on 127.0.0.1 whose site keeps its authors as files (markstage.config `authors`): the list, its search
// and the archived ones in the URL; one author open at #/authors/<slug> with the slug and the author page to copy
// and open; Back and Forward; a new author, an edited profile (the server's words under a wrong field), archived and
// brought back; delete refused to leave posts behind, so they are given to another author in the same change; a new
// slug that takes the posts with it; and in the editor, the author picked from a searchable list, a new one added
// inline, and an author the site does not have shown as a warning, not an error.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Port: MARKSTAGE_E2E_PORT_BASE (default 18231, odd) +95. Screenshots (light and dark) go to MARKSTAGE_E2E_SHOTS.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { AUTHORS_PORT as PORT, SHOTS, pw, skip, blank } from './support.mjs';

const BASE = `http://127.0.0.1:${PORT}`;
const SITE_CONFIG = `export default {
  siteUrl: 'https://example.com',
  authors: { coAuthors: 'coAuthors' },
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/', settings: [{ type: 'text', key: 'author', label: 'Author' }] },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
};
`;
const person = (id, name, more = {}) => `${JSON.stringify({ id, name, ...more }, null, 2)}\n`;

describe('authors in a browser', { skip, timeout: 240_000 }, () => {
  let fx, app, browser, ctx, page, owner, alice;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const has = (rel) => fs.existsSync(path.join(fx.site, rel));
  const authorOf = (id) => /\nauthor: (.+)\n/.exec(read(`src/content/blog/${id}.md`))?.[1];
  const rows = () => page.locator('.ms-adm-table tbody tr .ms-adm-rowlink').allTextContents();
  const drawer = () => page.locator('.ms-adm-drawer');
  const toast = (text) => page.locator('.ms-toast', { hasText: text }).waitFor();
  const shots = async (name) => {
    if (!SHOTS) return;
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `authors-${name}-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const open = async (where) => {
    await blank(page);
    await page.goto(`${BASE}/markstage/${where}`);
  };
  async function signIn(who, to) {
    await page.context().clearCookies();
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    const dir = path.join(fx.site, 'src/content/authors');
    fs.mkdirSync(dir, { recursive: true });
    // hello-world and with-html (live) are alice's, bob-draft bob's, carol-draft carol's (the fixture's posts)
    fs.writeFileSync(path.join(dir, 'alice.json'), person('alice', 'Alice Example', { designation: 'Editor', website: 'https://alice.example.com' }));
    fs.writeFileSync(path.join(dir, 'bob.json'), person('bob', 'Bob Example', { email: 'bob@example.com' }));
    fs.writeFileSync(path.join(dir, 'carol.json'), person('carol', 'Carol Example'));
    fs.writeFileSync(path.join(dir, 'retired.json'), person('retired', 'Retired Example', { archived: true }));
    // an old free-text author the site has no file for
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/old-guest.md'), "---\ntitle: Old guest post\nauthor: Guest Writer\ndate: '2025-05-01T10:00:00.000Z'\ndraft: true\n---\n\nFrom before.\n");
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Authors');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      siteUrl: 'https://example.com',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title', settings: [{ type: 'author', key: 'author', label: 'Author', coAuthors: 'coAuthors' }] },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      authors: { url: '/author/{slug}/', coAuthors: 'coAuthors', collections: ['posts'], profile: ['name', 'role', 'bio', 'photo', 'email', 'website', 'social', 'seoTitle', 'seoDescription', 'archived'] },
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec, core: await loadCore() });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    alice = await addUser(app, { email: 'alice@example.test', name: 'Alice Example', role: 'author', authorSlug: 'alice', password: pass() });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await signIn(owner, '#/authors');
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('the list and its URL: search, the archived ones, one author open; Back, Forward and a reload keep each state', async () => {
    await open('#/authors');
    await page.locator('.ms-adm-title', { hasText: 'Authors' }).waitFor();
    await page.locator('.ms-adm-rowlink').first().waitFor();
    assert.deepEqual(await rows(), ['Alice Example', 'Bob Example', 'Carol Example']);
    // numbers right-aligned: Posts and Live
    assert.equal(await page.locator('.ms-adm-table tbody tr').first().locator('td.ms-num').allTextContents().then((x) => x.join(',')), '2,2');
    assert.equal(await page.locator('.ms-adm-table tbody tr').first().locator('td.ms-num').first().evaluate((td) => getComputedStyle(td).textAlign), 'right');
    await page.getByPlaceholder('Search by name, role or slug').fill('car');
    await page.waitForURL(/q=car/);
    await page.waitForFunction(() => document.querySelectorAll('.ms-adm-table tbody tr').length === 1);
    assert.deepEqual(await rows(), ['Carol Example']);
    await open('#/authors?show=archived');
    await page.locator('.ms-adm-rowlink', { hasText: 'Retired Example' }).waitFor();
    assert.equal(await page.locator('.ms-adm-chip[aria-pressed="true"]').textContent(), 'Archived (1)');
    await page.getByRole('button', { name: 'Active' }).click();
    await page.waitForURL((u) => !u.hash.includes('show='));
    await page.locator('.ms-adm-rowlink', { hasText: 'Alice Example' }).click();
    await page.waitForURL(/#\/authors\/alice$/);
    await drawer().locator('strong', { hasText: 'Alice Example' }).waitFor();
    // the slug and the author page: copy (and open, for the page), the page on the site's own address
    assert.equal(await drawer().getByRole('button', { name: 'Copy author slug' }).count(), 1);
    assert.equal(await drawer().getByRole('button', { name: 'Copy author page URL' }).count(), 1);
    assert.equal(await drawer().getByRole('link', { name: 'Open author page URL in a new tab' }).or(drawer().getByRole('button', { name: 'Open author page URL in a new tab' })).count(), 1);
    assert.match(await drawer().locator('.ms-adm-facts').innerText(), /https:\/\/example\.com\/author\/alice\//);
    assert.match(await drawer().innerText(), /Hello World/);
    assert.match(await drawer().textContent(), /Posts \(2\)/);
    await shots('open');
    await page.goBack();
    await page.waitForURL((u) => u.hash === '#/authors');
    await page.waitForFunction(() => !document.querySelector('.ms-adm-drawer'));
    await page.goForward();
    await page.waitForURL(/#\/authors\/alice$/);
    await drawer().locator('strong', { hasText: 'Alice Example' }).waitFor();
    await page.reload();
    await drawer().locator('strong', { hasText: 'Alice Example' }).waitFor();
    // the private email shows for editors and above
    await open('#/authors/bob');
    await drawer().locator('dt', { hasText: 'Email (private)' }).waitFor();
    assert.match(await drawer().innerText(), /bob@example\.com/);
    // an author the site does not have
    await open('#/authors/nobody');
    await drawer().getByText('Not available to you').waitFor();
  });

  test('a new author: the form is in the URL, the slug made from the name; the file is one commit; then edit, with the server’s words under a wrong field', async () => {
    await open('#/authors');
    await page.getByRole('button', { name: 'New author' }).click();
    await page.waitForURL(/action=new/);
    await drawer().getByLabel('Name').fill('Dana Writer');
    assert.equal(await drawer().getByLabel('Slug').getAttribute('placeholder'), 'dana-writer');
    await drawer().getByLabel('Role').fill('Staff writer');
    await shots('new');
    await drawer().getByRole('button', { name: 'Add author' }).click();
    await page.waitForURL(/#\/authors\/dana-writer$/);
    await toast('Added Dana Writer.');
    assert.deepEqual(JSON.parse(read('src/content/authors/dana-writer.json')), { id: 'dana-writer', name: 'Dana Writer', designation: 'Staff writer' });
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Add author dana-writer');
    // edit: a deep link opens the form
    await open('#/authors/dana-writer?action=edit');
    await drawer().getByLabel('Website').waitFor();
    await drawer().getByLabel('Website').fill('not a website');
    await drawer().getByRole('button', { name: 'Save profile' }).click();
    // the browser's own check first (type=url)
    await drawer().locator('[data-err="website"]').filter({ hasText: /\S/ }).waitFor();
    await drawer().getByLabel('Website').fill('https://dana.example.com');
    await drawer().getByLabel('Bio').fill('Dana writes about **harbours**.');
    await drawer().getByLabel('Profile links').fill('https://www.linkedin.com/in/dana\nhttps://x.com/dana');
    await drawer().getByLabel('Email (private)').fill('dana@example.com');
    await drawer().getByRole('button', { name: 'Save profile' }).click();
    await page.waitForURL(/#\/authors\/dana-writer$/);
    await toast('Saved Dana Writer.');
    const dana = JSON.parse(read('src/content/authors/dana-writer.json'));
    assert.equal(dana.website, 'https://dana.example.com');
    assert.equal(dana.bio, 'Dana writes about **harbours**.');
    assert.deepEqual(dana.social, ['https://www.linkedin.com/in/dana', 'https://x.com/dana']);
    assert.equal(dana.email, 'dana@example.com');
    await drawer().getByRole('link', { name: 'https://x.com/dana' }).or(drawer().getByText('https://x.com/dana')).first().waitFor();
    // the server's words: a profile link that is not an address
    await open('#/authors/dana-writer?action=edit');
    await drawer().getByLabel('Profile links').fill('dana on mastodon');
    await drawer().getByRole('button', { name: 'Save profile' }).click();
    await drawer().locator('[data-err="social"]', { hasText: 'https://' }).waitFor();
    assert.equal(hash(), '#/authors/dana-writer?action=edit', 'the form stays open');
    await drawer().getByRole('button', { name: 'Cancel' }).click();
    await page.waitForURL(/#\/authors\/dana-writer$/);
  });

  test('archive and bring back: the archived leave the active list and the pickers, their posts keep them', async () => {
    await open('#/authors/dana-writer');
    await drawer().getByRole('button', { name: 'Archive' }).click();
    await toast('Archived Dana Writer.');
    assert.equal(JSON.parse(read('src/content/authors/dana-writer.json')).archived, true);
    await page.waitForFunction(() => ![...document.querySelectorAll('.ms-adm-rowlink')].some((a) => a.textContent === 'Dana Writer'));
    await drawer().getByRole('button', { name: 'Bring back' }).click();
    await toast('Dana Writer is back in the author pickers.');
    assert.ok(!('archived' in JSON.parse(read('src/content/authors/dana-writer.json'))) || JSON.parse(read('src/content/authors/dana-writer.json')).archived === false);
  });

  test('delete: an author with posts gives them to another author first, in one change; the step is in the URL', async () => {
    await open('#/authors/bob');
    await drawer().getByRole('button', { name: 'Delete…' }).click();
    await page.waitForURL(/action=delete/);
    await drawer().getByText('1 post names Bob Example').waitFor();
    assert.match(await drawer().innerText(), /Bob Draft/);
    await drawer().getByRole('button', { name: 'Give the posts and delete' }).click();
    await drawer().locator('[data-err="reassign"]', { hasText: 'Choose who gets the posts.' }).waitFor();
    assert.ok(has('src/content/authors/bob.json'), 'nothing deleted');
    await drawer().getByLabel('Give their 1 post to').selectOption('carol');
    await page.waitForURL(/to=carol/);
    await shots('delete');
    // a reload keeps the step and the choice
    await page.reload();
    await drawer().getByLabel('Give their 1 post to').waitFor();
    assert.equal(await drawer().getByLabel('Give their 1 post to').inputValue(), 'carol');
    await drawer().getByRole('button', { name: 'Give the posts and delete' }).click();
    await page.waitForURL((u) => u.hash === '#/authors');
    await toast('Deleted Bob Example; their posts are by Carol Example now.');
    assert.ok(!has('src/content/authors/bob.json'));
    assert.equal(authorOf('bob-draft'), 'carol');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Delete author bob, 1 entry given to carol');
    assert.deepEqual(await rows(), ['Alice Example', 'Carol Example', 'Dana Writer']);
  });

  test('a new slug takes the posts with it, in one change; the new address is in the URL as it is typed', async () => {
    await open('#/authors/carol?action=rename');
    await drawer().getByLabel('New slug').fill('carol-ann');
    await page.waitForURL(/to=carol-ann/);
    assert.match(await drawer().innerText(), /https:\/\/example\.com\/author\/carol-ann\//);
    assert.equal(await drawer().getByLabel('New slug').evaluate((i) => i === document.activeElement), true, 'typing keeps the focus');
    await drawer().getByRole('button', { name: 'Change slug' }).click();
    await page.waitForURL(/#\/authors\/carol-ann$/);
    await toast('Carol Example’s slug is carol-ann now.');
    assert.ok(has('src/content/authors/carol-ann.json') && !has('src/content/authors/carol.json'));
    assert.equal(JSON.parse(read('src/content/authors/carol-ann.json')).id, 'carol-ann');
    assert.equal(authorOf('carol-draft'), 'carol-ann');
    assert.equal(authorOf('bob-draft'), 'carol-ann');
  });

  test('Post settings: the author picked from a searchable list, a new one added inline, co-authors; an unknown author is a warning', async () => {
    const field = () => page.locator('.ms-settings [data-setting="author"]');
    await open('#/e/posts/with-html?s=1');
    await field().locator('.ms-author__name', { hasText: 'Alice Example' }).waitFor();
    assert.equal(await field().locator('.ms-author__warn').isHidden(), true);
    // search and pick with the keyboard
    const search = field().getByRole('combobox', { name: 'Author: search the authors' });
    await search.fill('dana');
    await page.locator('.ms-author__opt', { hasText: 'Dana Writer' }).waitFor();
    await search.press('Enter');
    await field().locator('.ms-author__current .ms-author__name', { hasText: 'Dana Writer' }).waitFor();
    // a co-author
    const co = field().getByRole('combobox', { name: 'Add a co-author' });
    await co.fill('alice');
    await page.locator('.ms-author__opt', { hasText: 'Alice Example' }).click();
    await field().locator('.ms-author__chip', { hasText: 'Alice Example' }).waitFor();
    await shots('field');
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    assert.equal(authorOf('with-html'), 'dana-writer');
    assert.match(read('src/content/blog/with-html.md'), /\ncoAuthors:\n {2}- alice\n/);
    // a new author, inline
    await search.fill('Eve Newman');
    await page.locator('.ms-author__opt--add', { hasText: 'Add “Eve Newman” as a new author…' }).click();
    const add = field().getByRole('group', { name: 'New author' });
    assert.equal(await add.getByLabel('Slug').inputValue(), 'eve-newman');
    await add.getByLabel('Role (optional)').fill('Guest');
    await add.getByRole('button', { name: 'Add author' }).click();
    await field().locator('.ms-author__current .ms-author__name', { hasText: 'Eve Newman' }).waitFor();
    assert.deepEqual(JSON.parse(read('src/content/authors/eve-newman.json')), { id: 'eve-newman', name: 'Eve Newman', designation: 'Guest' });
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    assert.equal(authorOf('with-html'), 'eve-newman');
    // an old free-text author: a warning, the drawer still works
    await open('#/e/posts/old-guest?s=1');
    await field().locator('.ms-author__warn', { hasText: '“Guest Writer” is not one of the site\'s authors.' }).waitFor();
    await shots('unknown');
  });

  test('an author may change their own profile, not archive or delete it; the list has no New author for them', async () => {
    await signIn(alice, '#/authors/alice');
    await drawer().locator('strong', { hasText: 'Alice Example' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'New author' }).count(), 0);
    assert.equal(await drawer().getByRole('button', { name: 'Archive' }).count(), 0);
    assert.equal(await drawer().getByRole('button', { name: 'Delete…' }).count(), 0);
    await drawer().getByRole('button', { name: 'Edit profile' }).click();
    await drawer().getByLabel('Role').fill('Editor at large');
    await drawer().getByRole('button', { name: 'Save profile' }).click();
    await toast('Saved Alice Example.');
    assert.equal(JSON.parse(read('src/content/authors/alice.json')).designation, 'Editor at large');
    // another author's profile: shown, not editable; a step the URL asks for is not available
    await open('#/authors/dana-writer?action=edit');
    await drawer().getByText('Not available to you').waitFor();
    await open('#/authors/dana-writer');
    await drawer().locator('strong', { hasText: 'Dana Writer' }).waitFor();
    assert.equal(await drawer().getByRole('button', { name: 'Edit profile' }).count(), 0);
    assert.equal(await drawer().locator('dt', { hasText: 'Email (private)' }).count(), 0, 'another author’s email is private');
  });
});
