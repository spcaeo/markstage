// Settings → Tokens in a real browser (editor environments/tokens.ts), against a real server on 127.0.0.1: two kinds,
// "Command line" and "AI assistant (MCP)", one or the other; ?new=mcp and ?new=cli open each form (in the URL: reload,
// Back); an AI assistant token reads always and drafts only when ticked; the secret is shown once, never in the URL,
// with the commands to use it and the MCP address with copy and open icons; it reaches /mcp and not /env.
// The test person is made up here. The browser opened here is closed in `after`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { SHOTS, TOKENS_PORT, pw, skip } from './support.mjs';

const BASE = `http://127.0.0.1:${TOKENS_PORT}`;
const READ = 'Read the site: pages, articles, the Library and releases, as you see them';
const DRAFT = 'Write drafts and put changes into a release for you to publish (it never publishes)';
const PUBLISH = 'Ask to publish a release, as you (the site’s checks and publish rules still decide)';

describe('Settings → Tokens: the command line’s and an AI assistant’s', { skip }, () => {
  let fx, app, browser, ctx, page, ed, olive;
  const params = () => Object.fromEntries(new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? ''));
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const card = () => page.locator('section.ms-env-token');
  const box = (words) => card().locator('label.ms-rule__box', { hasText: words }).locator('input');
  const scopesOf = (name) => app.db.prepare('SELECT scopes FROM api_tokens WHERE name = ?').get(name)?.scopes.split(' ');
  const ping = (secret, where = 'mcp') =>
    fetch(`${BASE}/markstage/api/${where}`, where === 'mcp' ? { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) } : { headers: { Authorization: `Bearer ${secret}` } });
  /** Make a token with the open form: its secret, as the page shows it once. */
  async function make(name, tick = []) {
    await card().getByLabel('Name').fill(name);
    for (const w of tick) await box(w).check();
    await card().getByRole('button', { name: 'Make the token' }).click();
    const secret = (await card().locator('.ms-adm-secret .ms-copyable__text').first().textContent()).trim();
    assert.match(secret, /^mst_/);
    assert.equal(page.url().includes(secret), false, 'the secret is never in the URL');
    return secret;
  }

  before(async () => {
    fx = makeFixture({ checks: false });
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Example Co',
      collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' }],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: TOKENS_PORT, editorDir } });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(TOKENS_PORT, '127.0.0.1');
    app.backup.stop();
    // a server with an owner signs in (one with none asks for setup)
    olive = await addUser(app, { email: 'olive@example.test', name: 'Olive Owner', role: 'owner', password: `t-${crypto.randomBytes(12).toString('base64url')}` });
    ed = await addUser(app, { email: 'edie@example.test', name: 'Edie Editor', role: 'editor', authorSlug: 'alice', password: `t-${crypto.randomBytes(12).toString('base64url')}` });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/settings/tokens')}`);
    await page.getByLabel('Email').fill(ed.email);
    await page.getByLabel('Password', { exact: true }).fill(ed.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/settings/tokens'));
  });
  after(async () => {
    await browser?.close();
    await app?.close();
  });

  test('two kinds in words; ?new=mcp opens the AI assistant form (reload keeps it): reading always, drafting only when ticked', async () => {
    await page.locator('.ms-locks__lead').waitFor();
    assert.match(await page.locator('.ms-locks__lead').textContent(), /it is for one of two things, never both/);
    assert.equal(await page.getByRole('button', { name: 'New command line token' }).count(), 1);
    await page.getByRole('button', { name: 'New AI assistant token' }).click();
    await card().waitFor();
    assert.equal(params().new, 'mcp');
    await page.reload();
    await card().waitFor();
    assert.equal((await card().locator('h3').first().textContent()).trim(), 'New AI assistant token');
    assert.equal(await card().getByLabel('Name').inputValue(), 'AI assistant');
    assert.deepEqual([await box(READ).isChecked(), await box(READ).isDisabled(), await box(DRAFT).isChecked()], [true, true, false]);
    // why it cannot be unticked, on screen and for a screen reader
    const why = await box(READ).getAttribute('aria-describedby');
    assert.equal((await page.locator(`#${why}`).textContent()).trim(), 'Reading always comes with it.');
    assert.equal(await card().locator('label.ms-rule__box', { hasText: 'environments' }).count(), 0, 'no command line scope here');
    assert.equal(await card().locator('label.ms-rule__box', { hasText: 'publish a release' }).count(), 0, 'an editor is not offered publishing');
    await shot('tokens-1-mcp-form');
    const secret = await make('Claude on my laptop');
    assert.deepEqual(scopesOf('Claude on my laptop'), ['mcp:read']);
    // what to do with it: the relay's login, the client's config, the address (copy and open)
    const codes = await card().locator('.ms-adm-code .ms-copyable__text').allTextContents();
    // the editor's own address (with its basePath), which the command line keeps with the token
    const editor = `${BASE}/markstage`;
    assert.deepEqual(codes.map((t) => t.trim()), [`npx markstage mcp login ${editor}`, JSON.stringify({ mcpServers: { markstage: { command: 'npx', args: ['markstage', 'mcp', editor] } } }), `${BASE}/markstage/api/mcp`]);
    assert.equal(codes.some((t) => t.includes(secret)), false, 'the secret is in none of them');
    const address = card().locator('.ms-adm-code').last();
    await address.hover();
    assert.equal(await address.getByRole('link', { name: 'Open MCP address in a new tab' }).getAttribute('href'), `${BASE}/markstage/api/mcp`);
    await address.getByRole('button', { name: 'Copy MCP address' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${BASE}/markstage/api/mcp`);
    await shot('tokens-2-mcp-made');
    // opened in a tab, the address says what it is
    const [tab] = await Promise.all([ctx.waitForEvent('page'), address.getByRole('link', { name: 'Open MCP address in a new tab' }).click()]);
    await tab.waitForLoadState();
    assert.match(await tab.locator('body').textContent(), /This is Markstage’s MCP address/);
    await tab.close();
    // it is an AI assistant's token: /mcp yes, /env no
    assert.equal((await ping(secret)).status, 200);
    assert.equal((await ping(secret, 'env')).status, 403);
    await card().getByRole('button', { name: 'Done' }).click();
    await page.waitForURL((u) => !u.hash.includes('new='));
    const row = page.locator('tbody tr', { hasText: 'Claude on my laptop' });
    assert.deepEqual((await row.locator('td').allTextContents()).slice(1, 3).map((t) => t.trim()), ['AI assistant (MCP)', READ]);
  });

  test('drafting ticked: mcp:draft (with read); ?new=cli: the command line’s, with its own command; Back closes the form', async () => {
    await page.getByRole('button', { name: 'New AI assistant token' }).click();
    await card().waitFor();
    await make('Drafting agent', [DRAFT]);
    assert.deepEqual(scopesOf('Drafting agent'), ['mcp:read', 'mcp:draft']);
    await card().getByRole('button', { name: 'Done' }).click();
    const row = page.locator('tbody tr', { hasText: 'Drafting agent' });
    assert.equal((await row.locator('td').nth(2).textContent()).trim(), DRAFT);
    await page.getByRole('button', { name: 'New command line token' }).click();
    await card().waitFor();
    assert.equal(params().new, 'cli');
    assert.equal((await card().locator('h3').first().textContent()).trim(), 'New command line token');
    assert.equal(await card().locator('label.ms-rule__box', { hasText: 'Read the site' }).count(), 0, 'no AI assistant scope here');
    const secret = await make('Laptop');
    assert.deepEqual(scopesOf('Laptop'), ['env:read', 'env:promote']);
    assert.equal((await card().locator('.ms-adm-code .ms-copyable__text').first().textContent()).trim(), `npx markstage login ${BASE}/markstage`);
    assert.equal((await ping(secret)).status, 403, 'a command line token does not reach /mcp');
    await card().getByRole('button', { name: 'Done' }).click();
    await page.waitForURL((u) => !u.hash.includes('new='));
    assert.equal((await page.locator('tbody tr', { hasText: 'Laptop' }).locator('td').nth(1).textContent()).trim(), 'Command line');
    await shot('tokens-3-list');
    // the form is a URL state: Back after opening it closes it again
    await page.getByRole('button', { name: 'New AI assistant token' }).click();
    await card().waitFor();
    await page.goBack();
    await page.waitForURL((u) => !u.hash.includes('new='));
    assert.equal(await card().count(), 0);
  });

  test('an owner may let an assistant publish: never ticked, a plain warning beside it and on the made token; the server refuses an editor', async () => {
    // the server refuses an editor's request too (test/mcp-publish.test.mjs); here the owner signs in
    await ctx.clearCookies();
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/settings/tokens?new=mcp')}`);
    await page.getByLabel('Email').fill(olive.email);
    await page.getByLabel('Password', { exact: true }).fill(olive.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/settings/tokens'));
    await card().waitFor();
    assert.equal(await box(PUBLISH).isChecked(), false, 'never ticked for you');
    // the warning, on screen and read with the box
    const warn = await box(PUBLISH).getAttribute('aria-describedby');
    const words = (await page.locator(`#${warn}`).textContent()).trim();
    assert.match(words, /^It can publish\. With this, the assistant can put releases live on your site without you pressing Publish\./);
    assert.match(words, /revoke it when you are done\.$/);
    await card().getByLabel('Name').fill('Release bot');
    await box(PUBLISH).check();
    await card().locator('.ms-env-token__warn').scrollIntoViewIfNeeded();
    await shot('tokens-4-mcp-publish-warning');
    await card().getByRole('button', { name: 'Make the token' }).click();
    await card().locator('.ms-adm-secret').waitFor();
    assert.deepEqual(scopesOf('Release bot'), ['mcp:read', 'mcp:publish']);
    assert.match(await card().locator('.ms-env-token__warn').first().textContent(), /^This token can publish\. With it, the assistant can put releases live/);
    await card().getByRole('button', { name: 'Done' }).click();
    const row = page.locator('tbody tr', { hasText: 'Release bot' });
    assert.equal((await row.locator('td').nth(2).textContent()).trim(), PUBLISH);
  });
});
