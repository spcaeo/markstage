// "Edit this page" on the live site in a real browser: a static site on its own origin (another port of 127.0.0.1)
// whose pages carry the build's inline script (core edit-button.mjs), and the Markstage server beside it. A visitor
// makes one request and sees nothing; a signed-in editor gets the link (keyboard-reachable, labelled), which opens
// the entry; the wrong role is told "Not available to you", an address with no entry says so, signing out takes the
// link away, a stale link signs in first and then opens the entry; on plain http the script does nothing, quietly;
// and the bookmarklet opens the entry from a host the cookie cannot reach (localhost).
//
//   npm run test:e2e -w packages/server        (part of `npm test`; e2e/run.mjs)
//
// Ports: MARKSTAGE_E2E_PORT_BASE (default 18231, odd) +84 the server, +86 the site. Screenshots go to
// MARKSTAGE_E2E_SHOTS when it is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { editButtonScript, editLinkOf, normalizeConfig } from '@markstage/core/site-config';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { PORT_BASE, SHOTS, pw, skip } from './support.mjs';

const PORT = PORT_BASE + 84;
const SITE_PORT = PORT_BASE + 86;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const LINK = 'a[aria-label="Edit this page in the editor"]';

const site = { siteName: 'Fixture', siteUrl: SITE, editButton: { cms: BASE } };
const SITE_CONFIG = `export default {
  ...${JSON.stringify(site)},
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '{uri}' },
  ],
};
`;
// the built site: the script exactly as the build adds it, in the <head> of every page
const SCRIPT = `<script>${editButtonScript(normalizeConfig(site, '/tmp/site'))}</script>`;
const pageHtml = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${SCRIPT}</head><body style="margin:0;font:16px system-ui"><nav><a href="/">Home</a> <a href="/about/">About</a></nav><main style="padding:32px"><h1>${title}</h1><p>A page of the site.</p></main></body></html>`;

describe('the edit button on the live site', { skip, timeout: 120_000 }, () => {
  let fx, app, siteServer, browser, owner, contributor;
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const contexts = [];
  /** a browser of its own (cookies and all), closed at the end */
  const fresh = async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(c);
    const page = await c.newPage();
    const errors = [];
    // the site's pages only: the editor's own (a 401 before sign-in) are not what this checks
    const onSite = () => !page.url().startsWith(BASE);
    page.on('pageerror', (e) => onSite() && errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && onSite() && errors.push(m.text()));
    return { c, page, errors };
  };
  const signIn = async (page, who, where = '#/') => {
    await page.goto(`${BASE}/markstage/${where}`);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    const set = page.waitForResponse((r) => r.url().endsWith('/site/edit-button'));
    await page.getByRole('button', { name: 'Sign in' }).click();
    return set;
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Site config');
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Test site',
      siteUrl: SITE,
      collections: [
        { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' },
        { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', hasUrl: true, addressKey: 'uri' },
      ],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [] } });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    contributor = await addUser(app, { email: 'con@example.test', name: 'Cora Contributor', role: 'contributor', password: pass() });
    // the static site: three pages, each with the script
    const titles = { '/': 'Home', '/about/': 'About', '/blog/hello-world/': 'Hello world', '/made-by-code/': 'Made by code' };
    siteServer = http.createServer((req, res) => {
      const t = titles[req.url.split('?')[0]];
      if (!t) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(pageHtml(t));
    });
    await new Promise((r) => siteServer.listen(SITE_PORT, '127.0.0.1', r));
    // plain.test: a host on plain http (not a secure context), for the quiet fallback
    browser = await pw.chromium.launch({ args: ['--host-resolver-rules=MAP plain.test 127.0.0.1'] });
  });
  after(async () => {
    for (const c of contexts) await c.close();
    await browser?.close();
    await new Promise((r) => (siteServer ? siteServer.close(r) : r()));
    await app?.close();
  });

  test('a visitor: one request, no link, no error', async () => {
    const { page, errors } = await fresh();
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(`${SITE}/about/`);
    await page.waitForLoadState('networkidle');
    assert.deepEqual(requests, [`${SITE}/about/`]);
    assert.equal(await page.locator(LINK).count(), 0);
    assert.deepEqual(errors, []);
  });

  test('a signed-in editor: the link, by the keyboard, opens the entry; signing out takes it away', async () => {
    const { page, errors } = await fresh();
    const set = await signIn(page, owner);
    assert.equal((await set.json()).on, true);
    const cookie = (await page.context().cookies(SITE)).find((c) => c.name === '_ed');
    assert.equal(decodeURIComponent(cookie.value), editLinkOf(BASE));
    assert.equal(cookie.httpOnly, false);
    await page.goto(`${SITE}/about/`);
    const link = page.locator(LINK);
    await link.waitFor();
    assert.equal(await link.textContent(), 'Edit this page');
    assert.equal(await link.getAttribute('href'), `${BASE}/markstage/#/edit?to=${encodeURIComponent('/about/')}`);
    // in the corner, inside the screen
    const box = await link.boundingBox();
    assert.ok(box.x + box.width <= 1440 - 16 + 1 && box.y + box.height <= 900 - 16 + 1 && box.x > 1100 && box.y > 800, JSON.stringify(box));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'edit-button-site-1440.png') });
    // the keyboard reaches it (after the page's own links) and Enter opens it
    for (let i = 0; i < 6 && !(await link.evaluate((a) => a === document.activeElement)); i++) await page.keyboard.press('Tab');
    assert.equal(await link.evaluate((a) => a === document.activeElement), true, 'reached by Tab');
    await page.keyboard.press('Enter');
    await page.waitForURL(/#\/p\/pages\/about/);
    assert.deepEqual(errors, []);
    // a post too, and an address no entry has
    await page.goto(`${SITE}/blog/hello-world/`);
    await page.locator(LINK).click();
    await page.waitForURL(/#\/e\/posts\/hello-world/);
    await page.goto(`${SITE}/made-by-code/`);
    await page.locator(LINK).click();
    await page.getByRole('heading', { name: 'No entry has this address' }).waitFor();
    assert.ok(await page.getByRole('button', { name: /Copy the page address/ }).count(), 'the address with its copy icon');
    // signing out clears the cookie: no link
    await page.goto(`${BASE}/markstage/#/`);
    await page.locator('.ms-head__me').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByLabel('Email').waitFor();
    assert.equal((await page.context().cookies(SITE)).some((c) => c.name === '_ed'), false);
    await page.goto(`${SITE}/about/`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator(LINK).count(), 0);
  });

  test('the wrong role is told so; a stale link signs in first, then opens the entry', async () => {
    const { page } = await fresh();
    await signIn(page, contributor);
    await page.goto(`${SITE}/about/`);
    await page.locator(LINK).click();
    await page.getByRole('heading', { name: 'Not available to you' }).waitFor();
    // a link left from an earlier session (the cookie outlived it): sign in, then the entry
    const { c, page: p2 } = await fresh();
    await c.addCookies([{ name: '_ed', value: encodeURIComponent(editLinkOf(BASE)), url: SITE }]);
    await p2.goto(`${SITE}/about/`);
    await p2.locator(LINK).click();
    await p2.getByLabel('Email').fill(owner.email);
    await p2.getByLabel('Password', { exact: true }).fill(owner.password);
    await p2.getByRole('button', { name: 'Sign in' }).click();
    await p2.waitForURL(/#\/p\/pages\/about/);
  });

  test('plain http: the script does nothing, quietly; a cookie with another address draws nothing', async () => {
    const { c, page, errors } = await fresh();
    const plain = `http://plain.test:${SITE_PORT}`;
    await c.addCookies([{ name: '_ed', value: encodeURIComponent(editLinkOf(BASE)), url: plain }]);
    await page.goto(`${plain}/about/`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(() => window.isSecureContext), false);
    assert.equal(await page.locator(LINK).count(), 0);
    await c.addCookies([{ name: '_ed', value: encodeURIComponent('https://evil.example/#/edit?to='), url: SITE }]);
    await page.goto(`${SITE}/about/`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator(LINK).count(), 0);
    assert.deepEqual(errors, []);
  });

  test('the bookmarklet: from #/edit, it opens the entry from a host the cookie cannot reach', async () => {
    const { page } = await fresh();
    await signIn(page, owner, '#/edit');
    await page.getByRole('heading', { name: 'On in this browser' }).waitFor();
    const mark = page.locator('.ms-editlink__mark');
    const href = await mark.getAttribute('href');
    assert.equal(href, `javascript:location.href=${JSON.stringify(editLinkOf(BASE))}+encodeURIComponent(location.pathname)`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'edit-button-page-1440.png') });
    await page.goto(`http://localhost:${SITE_PORT}/about/`);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator(LINK).count(), 0, 'localhost has no cookie');
    // what a click on the bookmark runs, in the page
    await page.evaluate(decodeURIComponent(href.slice('javascript:'.length)));
    await page.waitForURL(/#\/p\/pages\/about/);
  });
});
