// Single sign-on in a real browser (editor admin/auth.ts and signin.ts), against a real server on 127.0.0.1 and a
// stand-in OpenID Connect provider on loopback (test/fake-oidc.mjs, reached through the test seam only). A site that
// signs in with its provider only: the sign-in screen offers the provider and keeps the password behind "Owner";
// a person the provider's autoCreate makes signs in and edits; their session ends with typing unsaved; "Sign in again"
// offers the provider, the page goes there and comes back to the same entry, and the typing is offered back and
// saved. A refusal reads as a sentence. Test people and the client secret are made up here; the browser opened here
// is closed in `after`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { fakeOidc } from '../test/fake-oidc.mjs';
import { buildEditor } from './build-editor.mjs';
import { SHOTS, SSO_UI_PORT, pw, skip } from './support.mjs';

const BASE = `http://127.0.0.1:${SSO_UI_PORT}`;
const SECRET = crypto.randomBytes(16).toString('hex');
const ENV = { MARKSTAGE_SSO_TEST_SECRET: SECRET };
const KIM = { sub: 'idp-kim', email: 'kim@example.test', email_verified: true, name: 'Kim Editor' };

describe('single sign-on in the editor: the sign-in screen and "Sign in again"', { skip }, () => {
  let fx, app, idp, owner, browser, ctx, page;
  const hash = () => decodeURIComponent(new URL(page.url()).hash);
  const read = () => fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8');
  /** Light and dark. */
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `sso-${name}-${s}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };

  before(async () => {
    Object.assign(process.env, ENV);
    idp = await fakeOidc({ clients: { 'markstage-e2e': SECRET } });
    fx = makeFixture({ checks: false });
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Example Co',
      collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' }],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const sso = { providers: [{ id: 'test', label: 'Test IdP', issuer: idp.issuer, clientId: 'markstage-e2e', domains: ['example.test'], autoCreate: { role: 'editor' } }], passwordLogin: false };
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test', ...ENV }, overrides: { port: SSO_UI_PORT, editorDir, sso } });
    app = await createMarkstage(config, { codec: fakeCodec, outbound: idp.site.outbound });
    await app.listen(SSO_UI_PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'olive@example.test', name: 'Olive Owner', role: 'owner', password: `t-${crypto.randomBytes(12).toString('base64url')}` });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
  });
  after(async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    await browser?.close();
    await app?.close();
    await idp?.close();
  });

  test('the sign-in screen: the provider, no password but the owner’s; a person the provider’s autoCreate makes lands on their entry', async () => {
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/e/posts/hello-world')}`);
    const go = page.getByRole('link', { name: 'Sign in with Test IdP' });
    await go.waitFor();
    assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0, 'no password on a site that signs in with its provider only');
    assert.equal(await page.getByRole('link', { name: 'Owner: sign in with a password' }).count(), 1);
    await shot('sign-in');
    idp.person = KIM;
    await go.click();
    await page.waitForURL((u) => u.hash.startsWith('#/e/posts/hello-world'));
    await page.locator('.ProseMirror p').first().waitFor();
    const kim = app.db.prepare('SELECT id, role, name FROM users WHERE email = ?').get(KIM.email);
    assert.deepEqual([kim.role, kim.name], ['editor', 'Kim Editor'], 'made by autoCreate, as editor');
  });

  test('the session ends with typing unsaved: "Sign in again" offers the provider, comes back to the entry, and the typing is offered back', async () => {
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Typed before the session ended.');
    await page.locator('.ms-status[data-status="dirty"]').waitFor();
    const before = hash();
    // the session ends on the server (an administrator signed them out, or it timed out)
    app.db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)').run(KIM.email);
    await page.keyboard.press('ControlOrMeta+s');
    const dlg = page.locator('dialog.ms-signin');
    await dlg.waitFor();
    const go = dlg.getByRole('button', { name: 'Sign in with Test IdP' });
    await go.waitFor();
    assert.equal(await dlg.locator('input[type="password"]').isVisible(), false, 'no password asked for: the site signs in with its provider');
    await shot('again');
    await go.click();
    // the page went to the provider and came back to the same address, signed in, with no "leave the page?" question
    await page.getByRole('button', { name: 'Restore' }).waitFor();
    assert.equal(hash(), before);
    await shot('restore');
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.keyboard.press('ControlOrMeta+s');
    await page.locator('.ms-status[data-status="saved"]').waitFor();
    assert.match(read(), /Typed before the session ended\./);
    const acts = app.db.prepare("SELECT action FROM audit WHERE action LIKE 'auth.sso%' ORDER BY id").all().map((a) => a.action);
    assert.deepEqual(acts, ['auth.sso.link', 'auth.sso', 'auth.sso']);
  });

  test('a refusal reads as a sentence; the owner signs in with a password behind "Owner"', async () => {
    const other = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const p = await other.newPage();
      await p.goto(`${BASE}/markstage/#/sign-in?sso=domain&provider=test`);
      const alert = p.getByRole('alert');
      await alert.waitFor();
      assert.equal((await alert.textContent()).trim(), 'Signing in with Test IdP did not work. Your email at the provider is not one this site lets in.');
      await p.getByRole('link', { name: 'Owner: sign in with a password' }).click();
      await p.getByLabel('Password', { exact: true }).waitFor();
      await p.getByLabel('Email').fill(owner.email);
      await p.getByLabel('Password', { exact: true }).fill(owner.password);
      await p.getByRole('button', { name: 'Sign in', exact: true }).click();
      await p.waitForURL((u) => !u.hash.startsWith('#/sign-in'));
      assert.ok(app.db.prepare("SELECT 1 FROM audit WHERE action = 'auth.login' AND target = (SELECT id FROM users WHERE email = ?)").get(owner.email));
    } finally {
      await other.close();
    }
  });
});
