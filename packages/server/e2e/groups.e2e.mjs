// The Groups screen (#/groups/<collection>, editor src/groups/) in a real browser, against a real server on 127.0.0.1
// whose site sorts its posts into topic clusters (markstage.config `groups`) and keeps redirects through a hook: the
// URL keeps the collection, the open group, a grip menu and the move drawer; a group's posts in its page's order
// (the ones its `order` names, then newest first); a post moved to the top by the grip menu (Undo), by Alt+↑ and by
// a drag, each one save of the group's `order`; a post moved to another group (a dry run first, then one commit with
// its new address, the redirect and the links that follow; it leaves the old group's order); and an author, whom the
// server refuses, told why in its words.
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Port: MARKSTAGE_E2E_PORT_BASE (default 18231, odd) +82 (an even offset keeps it odd). Screenshots (light and
// dark) go to MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, client, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { PORT_BASE, SHOTS, pw, skip, blank } from './support.mjs';

const PORT = PORT_BASE + 82;
const BASE = `http://127.0.0.1:${PORT}`;
const GROUPS = { field: 'cluster', collection: 'clusters', order: 'order', label: 'Topics' };

const SITE_CONFIG = `export default {
  siteName: 'Fixture',
  siteUrl: 'https://example.com',
  collections: [
    {
      id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true,
      url: ({ id, data }) => (data.cluster ? '/' + data.cluster + '/' + id + '/' : '/blog/' + id + '/'),
      settings: [{ type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' }],
      groups: ${JSON.stringify(GROUPS)},
    },
    { id: 'clusters', label: 'Topics', format: 'json', dir: 'src/content/clusters' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  redirects: { command: ['node', 'scripts/redirects.mjs'] },
};
`;
// the site's redirects hook: {from: to} in src/data/redirects.json (docs/API.md "The redirects hook")
const HOOK = `import fs from 'node:fs';
let t = '';
process.stdin.on('data', (d) => (t += d));
process.stdin.on('end', () => {
  const ask = JSON.parse(t);
  const file = 'src/data/redirects.json';
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (ask.action === 'list') return console.log(JSON.stringify({ redirects: Object.entries(map).map(([from, to]) => ({ from, to, status: 301 })) }));
  if (ask.action === 'remove') for (const f of ask.from) delete map[f];
  else for (const r of ask.redirects) map[r.from] = r.to;
  fs.mkdirSync('src/data', { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\\n');
});
`;
const post = (id, title, cluster, date) => `---\ntitle: ${title}\nauthor: alice\ndate: '${date}'\ncluster: ${cluster}\n---\n\n${title}.\n`;

describe('the Groups screen in a browser', { skip }, () => {
  let fx, app, browser, ctx, page, ed, owner, author;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');
  const orderOf = (g) => JSON.parse(read(`src/content/clusters/${g}.json`)).order;
  const rows = () => page.locator('.ms-order__row').evaluateAll((r) => r.map((x) => x.dataset.id));
  const firstIs = (id) => page.waitForFunction((x) => document.querySelector('.ms-order__row')?.dataset.id === x, id);
  const shots = async (name) => {
    if (!SHOTS) return;
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `groups-${name}-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  const open = async (where) => {
    await blank(page);
    await page.goto(`${BASE}/markstage/${where}`);
  };
  const signIn = async (who) => {
    await page.context().clearCookies();
    await open('#/groups');
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // signing in starts the editor again (a reload): the screen is drawn once that is done
    await page.locator('.ms-groups__head h2').waitFor();
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    fs.writeFileSync(path.join(fx.site, 'scripts/redirects.mjs'), HOOK);
    const dir = path.join(fx.site, 'src/content/clusters');
    fs.mkdirSync(dir, { recursive: true });
    for (const [id, title] of [['basics', 'Getting started'], ['advanced', 'Going further']]) fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify({ id, title, order: [] }, null, 2)}\n`);
    // hello-world is in basics already; three more there, newest last; one in advanced that links to "middle"
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/oldest.md'), post('oldest', 'Oldest steps', 'basics', '2025-06-01T10:00:00.000Z'));
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/middle.md'), post('middle', 'Middle steps', 'basics', '2026-03-01T10:00:00.000Z'));
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/newest.md'), post('newest', 'Newest steps', 'basics', '2026-05-01T10:00:00.000Z'));
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/deep.md'), `${post('deep', 'Deep dive', 'advanced', '2026-04-01T10:00:00.000Z')}\nSee [the middle steps](/basics/middle/).\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Topic clusters');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title', settings: [{ type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' }], groups: GROUPS },
        { id: 'clusters', label: 'Topics', format: 'json', dir: 'src/content/clusters', hasUrl: false },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    author = await addUser(app, { email: 'author@example.test', name: 'Arlo Author', role: 'author', authorSlug: 'alice', password: pass() });
    ed = client(BASE);
    await ed.login(owner.email, owner.password);
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await signIn(owner);
  });
  after(async () => {
    await ctx?.close();
    await browser?.close();
    await app?.close();
  });

  test('URL state: the collection and the open group; newest first with no order; reload and Back keep them; an unknown group is not available', async () => {
    await open('#/groups');
    await page.locator('.ms-groups__head h2', { hasText: 'Getting started' }).waitFor();
    assert.equal(hash(), '#/groups/posts');
    // the drawer keeps it under More tools, named as the site calls it
    await page.locator('.ms-nav__group', { hasText: 'Site & team' }).click();
    await page.locator('.ms-nav__more').click();
    await page.getByRole('menuitem', { name: 'Topics' }).waitFor();
    await page.keyboard.press('Escape');
    assert.deepEqual(await rows(), ['newest', 'middle', 'hello-world', 'oldest']);
    assert.equal(await page.locator('.ms-groups__head p').textContent(), 'None has a place of its own yet: they follow, newest first.');
    await page.getByRole('group', { name: 'Topics' }).getByRole('button', { name: 'Going further (1)' }).click();
    await page.waitForURL(/g=advanced/);
    await page.locator('.ms-groups__head h2', { hasText: 'Going further' }).waitFor();
    assert.deepEqual(await rows(), ['deep']);
    await page.reload();
    await page.locator('.ms-groups__head h2', { hasText: 'Going further' }).waitFor();
    assert.equal(await page.locator('.ms-adm-chip[aria-pressed="true"]').textContent(), 'Going further (1)');
    await page.goBack();
    await page.locator('.ms-groups__head h2', { hasText: 'Getting started' }).waitFor();
    await open('#/groups/posts?g=nope');
    await page.getByText('Not available to you').waitFor();
  });

  test('the order: the grip menu (from the URL) and Undo, Alt+↑ and a drag; each one save of the group’s order', async () => {
    await open('#/groups/posts?g=basics&menu=oldest');
    await page.getByRole('menuitem', { name: 'Move to the top' }).click();
    await firstIs('oldest');
    assert.deepEqual(orderOf('basics'), ['oldest']);
    assert.equal(await page.locator('.ms-groups__head p').textContent(), 'The first keeps its place on the page; the rest follow, newest first.');
    assert.equal(await page.locator('.ms-groups__place').textContent(), 'Place 1');
    await page.locator('.ms-toast button', { hasText: 'Undo' }).click();
    await firstIs('newest');
    assert.deepEqual(orderOf('basics'), []);
    // the keyboard: Alt+↑ on hello-world (third) takes it to second, and what is above it keeps its place
    await page.locator('.ms-order__row[data-id="hello-world"]').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForFunction(() => document.querySelectorAll('.ms-order__row')[1]?.dataset.id === 'hello-world');
    assert.deepEqual(orderOf('basics'), ['newest', 'hello-world']);
    // a drag: oldest by its grip to the top
    const grip = await page.locator('.ms-order__row[data-id="oldest"] .ms-order__grip').boundingBox();
    const top = await page.locator('.ms-order__row').first().boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y - 20, { steps: 5 });
    await page.mouse.move(top.x + 40, top.y + 3, { steps: 15 });
    await page.mouse.up();
    await firstIs('oldest');
    assert.deepEqual(orderOf('basics'), ['oldest', 'newest', 'hello-world']);
    assert.deepEqual(await rows(), ['oldest', 'newest', 'hello-world', 'middle']);
    // "Back to newest first" in the grip menu
    await open('#/groups/posts?g=basics&menu=newest');
    await page.getByRole('menuitem', { name: 'Back to newest first' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.ms-groups__place').length === 2);
    assert.deepEqual(orderOf('basics'), ['oldest', 'hello-world']);
    const log = fx.git('log', '--format=%s', '-5').split('\n');
    assert.ok(log.slice(0, 5).every((m) => /clusters\/basics/.test(m)), log.join(' | '));
    await shots('order');
  });

  test('into another group: a dry run, then one commit with the new address, the redirect and the link; it leaves the old order', async () => {
    // middle gets a place first, so the move has to take it out of basics' order
    await open('#/groups/posts?g=basics&menu=middle');
    await page.getByRole('menuitem', { name: 'Move to the top' }).click();
    await firstIs('middle');
    await open('#/groups/posts?g=basics&menu=middle');
    await page.getByRole('menuitem', { name: 'Move to another topic…' }).click();
    await page.waitForURL(/move=middle/);
    await page.selectOption('#ms-groups-to', 'advanced');
    await page.waitForURL(/to=advanced/);
    await page.locator('.ms-groups__plan .ms-adm-facts').waitFor();
    const plan = (await page.locator('.ms-groups__plan').innerText()).replace(/\s+/g, ' ');
    assert.match(plan, /Address from \/basics\/middle\/ to \/advanced\/middle\//);
    assert.match(plan, /Redirects from \/basics\/middle\/ to \/advanced\/middle\//);
    assert.match(plan, /Links to it 1 page has a link that follows to the new address/);
    assert.match(plan, /It leaves this topic’s order; in Going further it follows by date/);
    assert.equal(read('src/content/blog/middle.md').includes('cluster: basics'), true, 'the dry run wrote nothing');
    await shots('move');
    // a reload keeps the drawer and its choice
    await page.reload();
    await page.locator('.ms-groups__plan .ms-adm-facts').waitFor();
    await page.locator('.ms-groups__plan button', { hasText: 'Move to Going further' }).click();
    await page.locator('.ms-adm-drawer').waitFor({ state: 'detached' });
    await page.locator('.ms-toast', { hasText: 'Moved “Middle steps” to Going further: /advanced/middle/, with a redirect from /basics/middle/.' }).waitFor();
    assert.match(read('src/content/blog/middle.md'), /cluster: advanced/);
    assert.match(read('src/content/blog/deep.md'), /\[the middle steps\]\(\/advanced\/middle\/\)/);
    assert.equal(JSON.parse(read('src/data/redirects.json'))['/basics/middle/'], '/advanced/middle/');
    assert.ok(!orderOf('basics').includes('middle'));
    assert.equal(await page.locator('.ms-adm-chip', { hasText: 'Going further' }).textContent(), 'Going further (2)');
    await open('#/groups/posts?g=advanced');
    await page.locator('.ms-order__row[data-id="middle"]').waitFor();
  });

  test('an author: the server refuses the order, and the screen says why in its words', async () => {
    await signIn(author);
    await open('#/groups/posts?g=basics&menu=hello-world');
    await page.getByRole('menuitem', { name: 'Move to the bottom' }).click();
    const t = await page.locator('.ms-toast', { hasText: 'Not changed:' }).textContent();
    assert.ok(t.length > 'Not changed: '.length, t);
    assert.deepEqual(orderOf('basics'), ['oldest', 'hello-world']);
    await signIn(owner);
  });
});
