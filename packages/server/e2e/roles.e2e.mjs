// Settings → Roles in a real browser (editor roles/**), against a real server on 127.0.0.1: an empty list; a role made
// with its rules in the promotion rules' form (?role=new, ?rule=<id>; a reload keeps the changes not saved, Back
// closes a rule's form); the rules read as sentences; the dry run asks POST roles/check and shows each rule's part, from
// the URL; an administrator cannot change a role built on administrator or make one; a role removed leaves its people
// on its base. Light and dark. The test people are made up here; the browser opened here is closed in `after`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, client, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { buildEditor } from './build-editor.mjs';
import { ROLES_UI_PORT, SHOTS, pw, skip } from './support.mjs';

const BASE = `http://127.0.0.1:${ROLES_UI_PORT}`;
const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;

describe('Settings → Roles: custom roles, their rules, and the dry run', { skip }, () => {
  let fx, app, owner, admin, tess, browser, ctx, page;
  const params = (p = page) => Object.fromEntries(new URLSearchParams(new URL(p.url()).hash.split('?')[1] ?? ''));
  const rowOf = (id) => app.db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(id);
  /** Light and dark. */
  const shot = async (name) => {
    if (!SHOTS) return;
    for (const s of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: s });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(SHOTS, `roles-${name}-${s}.png`), fullPage: true });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  };
  async function signIn(p, who, to) {
    await p.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent(to)}`);
    await p.getByLabel('Email').fill(who.email);
    await p.getByLabel('Password', { exact: true }).fill(who.password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForURL((u) => u.hash.startsWith(to.split('?')[0]));
  }
  /** The open rule's form: fill it in and keep it. */
  async function fillRule({ name, effect, tick, collections = [], fields }) {
    const form = page.locator('.ms-env-rule.is-editing');
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Effect').selectOption(effect);
    // the starter rule ticks "edit entries": the form shows what is asked, nothing else
    for (const box of await form.locator('input[name="action"]:checked').all()) await box.uncheck();
    for (const t of tick) await form.locator('label.ms-rule__box', { hasText: t }).first().locator('input').check();
    for (const c of collections) await form.locator('label.ms-rule__box', { hasText: c }).locator('input').check();
    if (fields) await form.getByLabel(/Fields its edit may change/).fill(fields);
    await form.getByRole('button', { name: 'Keep these changes' }).click();
    await form.waitFor({ state: 'detached' });
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
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: ROLES_UI_PORT, editorDir } });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(ROLES_UI_PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'olive@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    admin = await addUser(app, { email: 'ada@example.test', name: 'Ada Admin', role: 'administrator', password: pass() });
    tess = await addUser(app, { email: 'tess@example.test', name: 'Tess Translator', role: 'contributor', password: pass() });
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await signIn(page, owner, '#/settings/roles');
  });
  after(async () => {
    await browser?.close();
    await app?.close();
  });

  test('a role made with its rules: ?role=new, ?rule=, a reload keeps what is not saved, Back closes a rule; the rules read as sentences', async () => {
    await page.getByText('No roles of your own yet').waitFor();
    assert.equal(await page.locator('.ms-site-settings__parts a[aria-current="page"]').textContent(), 'Roles');
    await page.getByRole('button', { name: 'New role' }).click();
    assert.equal(params().role, 'new');
    await page.getByLabel('Name', { exact: true }).fill('French translator');
    assert.equal(await page.getByLabel(/Short name/).inputValue(), 'french-translator', 'the short name follows the name');
    await page.getByLabel('Built on').selectOption('contributor');
    await page.getByRole('button', { name: 'Add a rule' }).click();
    assert.ok(params().rule, 'the rule form has its URL');
    await fillRule({ name: 'Edits French words', effect: 'allow', tick: ['edit entries'], collections: ['Posts'], fields: 'locales.fr-ca.**' });
    assert.equal(params().rule, undefined);
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await fillRule({ name: 'Never deletes', effect: 'deny', tick: ['delete entries'] });
    // Back reopens the last rule's form; Back again closes it
    await page.goBack();
    await page.locator('.ms-env-rule.is-editing').waitFor();
    await page.goBack();
    await page.locator('.ms-env-rule.is-editing').waitFor({ state: 'detached' });
    // a reload keeps the role that is not made yet
    await page.reload();
    await page.getByText('Changes not saved').waitFor();
    const sentences = await page.locator('.ms-env-rule__sentence').allTextContents();
    assert.deepEqual(sentences, ['May edit entries in Posts.', 'May not delete entries.']);
    assert.equal((await page.locator('.ms-env-rule__lines li').first().textContent()).trim(), 'Only these fields: locales.fr-ca.**.');
    await shot('new');
    await page.getByRole('button', { name: 'Make the role' }).click();
    await page.getByText('Saved (version 1)').waitFor();
    assert.equal(params().role, 'french-translator');
    const row = rowOf('french-translator');
    assert.equal(row.base, 'contributor');
    assert.deepEqual(JSON.parse(row.rules).map((r) => [r.name, r.effect, r.action, r.collections ?? null, r.fields ?? null]), [
      ['Edits French words', 'allow', ['entry.edit'], ['posts'], ['locales.fr-ca.**']],
      ['Never deletes', 'deny', ['entry.delete'], null, null],
    ]);
    // a mistake is said in the server's words, the changes kept
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await fillRule({ name: 'Manages people', effect: 'allow', tick: ['manage people'] });
    await page.getByRole('button', { name: 'Save' }).click();
    assert.match(await page.getByRole('alert').textContent(), /users\.manage stays with the owner and administrators/);
    await page.getByRole('button', { name: 'Discard changes' }).click();
    assert.equal(await page.locator('.ms-env-rule').count(), 2);
  });

  test('the dry run: a person, an action, an entry; the answer and each rule’s part, from the URL', async () => {
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    assert.equal((await c.patch(`/users/${tess.id}`, { customRole: 'french-translator' })).status, 200);
    await page.getByRole('button', { name: 'All roles' }).click();
    await page.locator('[data-role="french-translator"]').getByText('1 person').waitFor();
    // the panel's choices were made with the people as they were: a reload shows Tess with her role
    await page.reload();
    const panel = page.locator('#try');
    await panel.getByLabel('Person').selectOption({ label: 'Tess Translator (French translator)' });
    await panel.getByLabel('Does').selectOption('entry.edit');
    await panel.getByLabel('In (entries)').selectOption('posts');
    await panel.getByLabel('Entry (its id)').fill('hello-world');
    await panel.getByRole('button', { name: 'Ask' }).click();
    const outcome = panel.locator('.ms-adm-outcome');
    await outcome.waitFor();
    assert.deepEqual([params().as, params().do, params().in, params().entry], [tess.id, 'entry.edit', 'posts', 'hello-world']);
    assert.equal((await outcome.textContent()).trim(), 'Tess Translator may edit entries. Allowed by the rule “Edits French words” of French translator.');
    assert.equal((await panel.locator('.ms-adm-sub', { hasText: 'Only these fields' }).textContent()).trim(), 'Only these fields: locales.fr-ca.**.');
    const trace = await panel.locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.cells].map((td) => td.textContent.trim())));
    assert.deepEqual(trace, [['Edits French words', 'Yes', 'applies'], ['Never deletes', 'No', 'not for entry.edit']]);
    await shot('try');
    // a link opens the same answer
    await page.reload();
    await page.locator('#try .ms-adm-outcome').waitFor();
    assert.match(await page.locator('#try .ms-adm-outcome').textContent(), /^Tess Translator may edit entries/);
    await page.locator('#try').getByLabel('Does').selectOption('entry.delete');
    await page.locator('#try').getByRole('button', { name: 'Ask' }).click();
    await page.locator('#try .ms-adm-outcome.is-bad').waitFor();
    assert.equal((await page.locator('#try .ms-adm-outcome').textContent()).trim(), 'Tess Translator may not delete entries. Refused by the rule “Never deletes” of French translator.');
  });

  test('an administrator: a role on administrator is the owner’s; the owner removes a role and its people keep the base', async () => {
    const c = client(BASE);
    await c.login(owner.email, owner.password);
    assert.equal((await c.post('/roles', { id: 'site-lead', name: 'Site lead', base: 'administrator', rules: [{ id: 'no-backup', name: 'No backups', action: ['site.backup'], effect: 'deny' }] })).status, 201);
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    try {
      const p = await other.newPage();
      await signIn(p, admin, '#/settings/roles');
      const lead = p.locator('[data-role="site-lead"]');
      await lead.getByText('Only the owner changes a role built on administrator.').waitFor();
      assert.equal(await lead.getByRole('button', { name: 'Edit' }).count(), 0);
      assert.equal(await p.locator('[data-role="french-translator"]').getByRole('button', { name: 'Edit' }).count(), 1);
      await p.goto(`${BASE}/markstage/#/settings/roles?role=site-lead`);
      await p.getByText('Only the owner changes a role built on administrator.').waitFor();
      await p.goto(`${BASE}/markstage/#/settings/roles?role=new`);
      const adminOption = p.getByLabel('Built on').locator('option[value="administrator"]');
      await adminOption.waitFor({ state: 'attached' });
      assert.equal(await adminOption.isDisabled(), true);
    } finally {
      await other.close();
    }
    await page.goto(`${BASE}/markstage/#/settings/roles`);
    await page.locator('[data-role="french-translator"]').getByRole('button', { name: 'Remove' }).click();
    const dlg = page.locator('dialog[open]');
    assert.match(await dlg.textContent(), /The person with it keeps Contributor as their role/);
    await dlg.getByRole('button', { name: 'Remove' }).click();
    await page.locator('[data-role="french-translator"]').waitFor({ state: 'detached' });
    const t = app.db.prepare('SELECT role, custom_role FROM users WHERE id = ?').get(tess.id);
    assert.deepEqual([t.role, t.custom_role], ['contributor', null]);
    await shot('list');
  });
});
