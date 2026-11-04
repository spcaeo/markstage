// The Inbox's Odoo marks in a real browser (inbox/crm.ts, list.ts, item.ts), against a real server on 127.0.0.1 and
// a stand-in Odoo (test/fake-odoo.mjs), never a real one. A message Odoo did not take shows "Not sent to Odoo", why on
// hover or focus with a copy icon; the "not sent to Odoo" filter has its count and is in the URL (reload, Back);
// the drawer's "Send to Odoo again" says the server's words when it is refused, and the lead's id when it goes.
// Test users and the Odoo sign-in are made up here. The browser opened here is closed in `after`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { addUser, fakeCodec, makeFixture } from '../test/helpers.mjs';
import { CONTACT_CONFIG, SITE, sitePost } from '../test/forms-support.mjs';
import { fakeOdoo } from '../test/fake-odoo.mjs';
import { writeMmdb } from '../test/mmdb-writer.mjs';
import { buildEditor } from './build-editor.mjs';
import { INBOX_ODOO_PORTS, SHOTS, pw, skip } from './support.mjs';

const [PORT, ODOO_PORT] = INBOX_ODOO_PORTS;
const BASE = `http://127.0.0.1:${PORT}`;
const ENV = 'MSTEST_E2E_ODOO';
const DOWN = 'Not sent: it answered HTTP 502';

describe('the Inbox’s Odoo marks in a browser', { skip }, () => {
  let fx, app, odoo, browser, ctx, page, owner;
  const ids = {};
  const pass = () => `t-${crypto.randomBytes(12).toString('base64url')}`;
  const secret = { db: `db-${crypto.randomBytes(4).toString('hex')}`, email: `odoo-bot-${crypto.randomBytes(3).toString('hex')}@example.test`, password: pass() };
  const params = () => Object.fromEntries(new URLSearchParams(decodeURIComponent(new URL(page.url()).hash).split('?')[1] ?? ''));
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const rows = () => page.locator('table.ms-adm-table--rows tbody tr');
  const row = (name) => rows().filter({ hasText: name });
  const crmOf = (id) => app.db.prepare('SELECT crm FROM form_messages WHERE id = ?').get(id)?.crm;
  const toast = (text) => page.locator('.ms-toast', { hasText: text }).last();
  let n = 0;
  /** One message from the site, from a Toronto address of its own; its id once its push to Odoo has ended. */
  async function message(name) {
    const r = await sitePost(PORT, '/markstage/forms/contact', {
      name,
      email: `${name.split(' ')[0].toLowerCase()}@client.example`,
      number: '+1 416 555 0101',
      comment: 'We would like a quote for a migration, please.',
      pageUrl: `https://${SITE}/contact-us/`,
      started: String(Date.now() - 20_000),
    }, { headers: { 'X-Forwarded-For': `203.0.113.${++n}` } });
    assert.equal(r.status, 200, r.text);
    const id = app.db.prepare('SELECT id FROM form_messages ORDER BY rowid DESC LIMIT 1').get().id;
    for (let i = 0; i < 100 && crmOf(id) === 'pending'; i++) await new Promise((res) => setTimeout(res, 20));
    return id;
  }

  before(async () => {
    odoo = await fakeOdoo(secret, ODOO_PORT);
    for (const [k, v] of Object.entries({ URL: odoo.url, DB: secret.db, EMAIL: secret.email, PASSWORD: secret.password, ENABLE: 'true' })) process.env[`${ENV}_${k}`] = v;
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG.replace("message: 'Data stored successfully',", `message: 'Data stored successfully', crm: { kind: 'odoo', env: '${ENV}', source: 'Example Website' },`));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A contact form that also sends to Odoo');
    fs.mkdirSync(path.join(fx.data, 'geoip'), { recursive: true });
    fs.writeFileSync(path.join(fx.data, 'geoip', 'city.mmdb'), writeMmdb({ networks: [{ cidr: '203.0.113.0/24', data: { city: { names: { en: 'Toronto' } }, country: { iso_code: 'CA', names: { en: 'Canada' } }, subdivisions: [{ iso_code: 'ON', names: { en: 'Ontario' } }] } }] }));
    const editorDir = await buildEditor(path.join(fx.run, 'editor'), {
      api: '/markstage/api/',
      siteName: 'Example Co',
      collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasUrl: true, titleKey: 'title' }],
      compat: null,
      canvas: { articleClass: '', bodyClass: '' },
    });
    const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: PORT, editorDir, collections: [], siteHosts: [SITE], trustProxy: true } });
    app = await createMarkstage(config, { codec: fakeCodec });
    await app.listen(PORT, '127.0.0.1');
    app.backup.stop();
    owner = await addUser(app, { email: 'owner@example.test', name: 'Olive Owner', role: 'owner', password: pass() });
    // one lead Odoo took, then two it did not (it is down)
    ids.sent = await message('Ann Sent');
    odoo.mode = 'down';
    ids.bea = await message('Bea Waiting');
    ids.cal = await message('Cal Waiting');
    assert.deepEqual([crmOf(ids.sent), crmOf(ids.bea), crmOf(ids.cal)], ['sent', 'failed', 'failed']);
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${BASE}/markstage/#/sign-in?next=${encodeURIComponent('#/inbox')}`);
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.hash.startsWith('#/inbox'));
  });
  after(async () => {
    await browser?.close();
    await app?.close();
    await odoo?.close();
    for (const k of ['URL', 'DB', 'EMAIL', 'PASSWORD', 'ENABLE']) delete process.env[`${ENV}_${k}`];
  });

  test('the list: "Not sent to Odoo" on the two Odoo did not take, why on hover and on focus, with a copy icon', async () => {
    await rows().first().waitFor();
    assert.equal(await rows().count(), 3);
    assert.equal(await row('Ann Sent').locator('.ms-inbox__crm').count(), 0, 'a lead that went has no mark');
    const mark = row('Bea Waiting').locator('.ms-inbox__crm');
    assert.equal((await mark.locator('.ms-adm-badge').textContent()).trim(), 'Not sent to Odoo');
    const why = mark.locator('.ms-inbox__why');
    assert.equal(await why.isVisible(), false, 'why is hidden until asked for');
    await mark.locator('.ms-adm-badge').hover();
    await why.waitFor({ state: 'visible' });
    assert.equal((await why.locator('.ms-copyable__text').textContent()).trim(), 'it answered HTTP 502');
    await shot('inbox-odoo-1-hover');
    // the copy icon: the reason to the clipboard, a tick for a moment
    await why.getByRole('button', { name: 'Copy why it was not sent to Odoo' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'it answered HTTP 502');
    await why.locator('.ms-copyable.is-done').waitFor(); // the copy icon turns into a tick
    // the keyboard: the badge takes focus and says why; the copy icon is next
    await page.mouse.move(5, 5);
    const other = row('Cal Waiting').locator('.ms-inbox__crm');
    await other.locator('.ms-adm-badge').focus();
    await other.locator('.ms-inbox__why').waitFor({ state: 'visible' });
    const described = await other.locator('.ms-adm-badge').getAttribute('aria-describedby');
    assert.equal(await page.locator(`#${described}`).count(), 1, 'the badge names its reason for screen readers');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Copy why it was not sent to Odoo');
    assert.equal(await other.locator('.ms-inbox__why').isVisible(), true, 'why stays while its copy icon has focus');
  });

  test('the filter: "2 messages not sent to Odoo", in the URL; reload keeps it, Back takes it away', async () => {
    await page.goto(`${BASE}/markstage/#/inbox`);
    const chip = page.locator('.ms-inbox__crmchip');
    await chip.waitFor();
    assert.equal((await chip.textContent()).trim(), '2 messages not sent to Odoo');
    assert.equal(await chip.getAttribute('aria-pressed'), 'false');
    await shot('inbox-odoo-2-list');
    await chip.click();
    await page.waitForFunction(() => location.hash.includes('crm=failed'));
    await page.locator('.ms-inbox__crmchip[aria-pressed="true"]').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('table.ms-adm-table--rows tbody tr').length === 2);
    assert.deepEqual(params(), { crm: 'failed' });
    assert.equal(await row('Ann Sent').count(), 0);
    await page.reload();
    await page.locator('.ms-inbox__crmchip[aria-pressed="true"]').waitFor();
    assert.equal(await rows().count(), 2, 'the reload lists the same two');
    assert.equal((await page.locator('.ms-inbox__crmchip').textContent()).trim(), 'Showing the messages not sent to Odoo');
    await page.goBack();
    await page.waitForFunction(() => !location.hash.includes('crm='));
    await page.waitForFunction(() => document.querySelectorAll('table.ms-adm-table--rows tbody tr').length === 3);
    // "Clear filters" clears it too
    await page.goto(`${BASE}/markstage/#/inbox?crm=failed`);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.waitForFunction(() => !location.hash.includes('crm='));
  });

  test('the drawer: "Send to Odoo again" says the server’s words when Odoo is still down, the lead when it goes', async () => {
    await page.goto(`${BASE}/markstage/#/inbox?crm=failed&open=${ids.bea}`);
    const drawer = page.locator('.ms-adm-drawer');
    const again = drawer.getByRole('button', { name: 'Send to Odoo again' });
    await again.waitFor();
    await page.locator('.ms-inbox__crmchip[aria-pressed="true"]').waitFor();
    assert.equal(await rows().count(), 2, 'the list under the drawer is the filtered one');
    assert.equal((await drawer.locator('.ms-inbox__crmrow .ms-adm-badge').textContent()).trim(), 'Not sent to Odoo');
    assert.match(await drawer.locator('.ms-inbox__crmrow').textContent(), /1 try · tried again /);
    assert.equal((await drawer.locator('.ms-adm-facts .ms-copyable__text', { hasText: 'it answered HTTP 502' }).first().textContent()).trim(), 'it answered HTTP 502');
    await shot('inbox-odoo-3-drawer');
    // still down: the server's words, and two tries now
    await again.click();
    await toast(DOWN).waitFor();
    assert.equal((await toast(DOWN).textContent()).trim().startsWith(DOWN), true);
    await page.waitForFunction(() => /2 tries/.test(document.querySelector('.ms-adm-drawer')?.textContent ?? ''));
    assert.equal(crmOf(ids.bea), 'failed');
    // Odoo is back: it goes, the drawer shows the lead, the filter's count drops
    odoo.mode = 'ok';
    await drawer.getByRole('button', { name: 'Send to Odoo again' }).click();
    const lead = app.db.prepare('SELECT crm_id FROM form_messages WHERE id = ?');
    await toast('Sent to Odoo (lead').waitFor();
    assert.equal(crmOf(ids.bea), 'sent');
    const leadId = lead.get(ids.bea).crm_id;
    assert.equal((await toast('Sent to Odoo (lead').textContent()).trim().startsWith(`Sent to Odoo (lead ${leadId}).`), true);
    await page.waitForFunction((id) => new RegExp(`Sent to Odoo\\s*Yes · lead ${id}`).test(document.querySelector('.ms-adm-drawer')?.textContent ?? ''), leadId);
    assert.deepEqual(params(), { crm: 'failed', open: ids.bea }, 'the drawer stays open on it');
    await page.waitForFunction(() => document.querySelector('.ms-inbox__crmchip')?.textContent?.trim() === 'Showing the messages not sent to Odoo' && document.querySelectorAll('table.ms-adm-table--rows tbody tr').length === 1);
    assert.equal(await drawer.getByRole('button', { name: 'Send to Odoo again' }).count(), 0, 'nothing to send again');
    // its row left the filtered list; the drawer keeps the message's own title
    assert.equal(await row('Bea Waiting').count(), 0);
    await page.waitForFunction(() => document.querySelector('.ms-adm-drawer h2')?.textContent === 'Message · Contact');
    assert.equal(await drawer.getAttribute('aria-label'), 'Message · Contact');
    assert.equal(odoo.leads.at(-1).mobile_country_code, 'CA');
    await shot('inbox-odoo-4-sent');
    // opened straight from a link, under a filter that leaves it out: the same title
    await page.goto(`${BASE}/markstage/#/inbox?crm=failed&open=${ids.sent}`);
    await page.locator('.ms-adm-drawer', { hasText: 'Ann Sent' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.ms-adm-drawer h2')?.textContent === 'Message · Contact');
    assert.equal(await row('Ann Sent').count(), 0);
  });

  test('sent meanwhile from another tab: the refusal is the server’s words, and the drawer shows it as sent', async () => {
    odoo.mode = 'down';
    await page.goto(`${BASE}/markstage/#/inbox?open=${ids.cal}`);
    const drawer = page.locator('.ms-adm-drawer');
    await drawer.getByRole('button', { name: 'Send to Odoo again' }).waitFor();
    // someone else sends it first
    odoo.mode = 'ok';
    assert.equal((await app.forms.crm.push(ids.cal)).ok, true);
    const leadId = app.db.prepare('SELECT crm_id FROM form_messages WHERE id = ?').get(ids.cal).crm_id;
    await drawer.getByRole('button', { name: 'Send to Odoo again' }).click();
    const words = `It is in Odoo already (lead ${leadId}).`;
    await toast(words).waitFor();
    await page.waitForFunction((id) => new RegExp(`Sent to Odoo\\s*Yes · lead ${id}`).test(document.querySelector('.ms-adm-drawer')?.textContent ?? ''), leadId);
    assert.equal(await page.locator('.ms-inbox__crmchip').count(), 0, 'nothing is left unsent: no filter to offer');
  });
});
