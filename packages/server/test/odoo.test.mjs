// A contact form message also goes to Odoo as a lead (src/forms/crm.mjs), the way the old WordPress theme sent it
// (functions.php odooInsert): the same model, fields, values and lookups, against a stand-in XML-RPC server here. Never
// a real Odoo. The message is stored first and the visitor's answer never waits on Odoo; a failed push is tried again
// and shown in the Inbox and Site health; "Send to Odoo again" tries at once; the address and sign-in come from the
// environment and are found nowhere they are not needed. Made-up people on documentation addresses; the sign-in is
// made up here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';
import { CONTACT_CONFIG, SITE, sitePost } from './forms-support.mjs';
import { writeMmdb } from './mmdb-writer.mjs';
import { fakeOdoo } from './fake-odoo.mjs';
import { answerXml, callXml, readAnswer, readCall } from '../src/forms/xmlrpc.mjs';
import { descriptionOf, leadOf, settingsOf } from '../src/forms/crm.mjs';
import { formsOf } from '../src/forms/config.mjs';

const ENV = 'MSTEST_ODOO';
/** The keys of the old theme's $leadData (test/odoo-lead-data.php.txt, copied from functions.php), not a commented one. */
const phpLeadKeys = () => {
  const php = fs.readFileSync(new URL('./odoo-lead-data.php.txt', import.meta.url), 'utf8');
  const body = /\$leadData = array\(([\s\S]*?)\n\s*\);/.exec(php)[1];
  return body.split('\n').filter((l) => !/^\s*\/\//.test(l)).flatMap((l) => [.../^\s*'([a-z_]+)'\s*=>/.exec(l)?.slice(1) ?? []]);
};
const PLACES = [
  { cidr: '203.0.113.0/24', data: { city: { names: { en: 'Toronto' } }, country: { iso_code: 'CA', names: { en: 'Canada' } }, subdivisions: [{ iso_code: 'ON', names: { en: 'Ontario' } }] } },
  { cidr: '198.51.100.0/24', data: { city: { names: { en: 'Springfield' } }, country: { iso_code: 'ZZ', names: { en: 'Nowhere Land' } }, subdivisions: [{ names: { en: 'Nowhere' } }] } },
];

describe('XML-RPC as Odoo speaks it', () => {
  test('values both ways: strings with markup, ints, booleans, doubles, nil, arrays, structs; a fault in words', () => {
    const v = ['a <b> & c', 7, -3, true, false, 1.5, null, [1, 'x'], { name: 'n', list: [[['name', '=', 'Example Website']]] }];
    const back = readCall(callXml('execute_kw', v));
    assert.deepEqual(back, { method: 'execute_kw', params: v });
    assert.deepEqual(readAnswer(answerXml({ ok: [1, 2], s: 'é & ü' })), { ok: [1, 2], s: 'é & ü' });
    assert.equal(readAnswer('<?xml version="1.0"?><methodResponse><params><param><value>bare</value></param></params></methodResponse>'), 'bare');
    assert.throws(() => readAnswer(answerXml(null, { faultCode: 1, faultString: 'Traceback…\nodoo.exceptions.UserError: No' })), /^Error: Odoo refused it: odoo\.exceptions\.UserError: No$/);
    assert.throws(() => readAnswer('<methodResponse><params>'), /not well-formed/);
  });
});

describe('a contact form message to Odoo', () => {
  let fx, srv, odoo, clock, ed, admin;
  const secret = { db: `db-${crypto.randomBytes(4).toString('hex')}`, email: `odoo-bot-${crypto.randomBytes(3).toString('hex')}@example.test`, password: `pw-${crypto.randomBytes(12).toString('base64url')}` };
  const setEnv = (vars) => {
    for (const k of ['URL', 'DB', 'EMAIL', 'PASSWORD', 'ENABLE']) delete process.env[`${ENV}_${k}`];
    for (const [k, v] of Object.entries(vars)) process.env[`${ENV}_${k}`] = v;
  };
  const on = () => setEnv({ URL: odoo.url, DB: secret.db, EMAIL: secret.email, PASSWORD: secret.password, ENABLE: 'true' });
  const lead = (over = {}) => ({
    name: 'Ann Example',
    email: `ann-${crypto.randomBytes(3).toString('hex')}@client.example`,
    number: '+1 416 555 0101',
    comment: 'We\'d like a "quote" for <3> boards &\nmore,\n\tplease.',
    pageUrl: `https://${SITE}/contact-us/`,
    referrerURL: 'https://www.google.com/',
    landingURL: `https://${SITE}/project-tool-migration/`,
    referrerDomain: 'google.com',
    u_source: 'google / organic',
    started: String(clock.now - 20_000),
    ...over,
  });
  let n = 0;
  // each message from an address of its own in Toronto (the form takes 3 a day from one address)
  const post = (body, ip = `203.0.113.${++n}`) => sitePost(srv.port, '/markstage/forms/contact', body, { headers: { 'X-Forwarded-For': ip } });
  const row = (id) => srv.app.db.prepare('SELECT * FROM form_messages WHERE id = ?').get(id);
  const last = () => srv.app.db.prepare('SELECT * FROM form_messages ORDER BY rowid DESC LIMIT 1').get();
  const settle = () => new Promise((r) => setTimeout(r, 150));
  const events = (id) => srv.app.db.prepare('SELECT change FROM form_events WHERE message_id = ? ORDER BY id').all(id).map((e) => e.change);

  before(async () => {
    clock = { now: Date.parse('2026-10-29T10:00:00Z') };
    odoo = await fakeOdoo(secret);
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG.replace("message: 'Data stored successfully',", `message: 'Data stored successfully', crm: { kind: 'odoo', env: '${ENV}', source: 'Example Website' },`));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A contact form that also sends to Odoo');
    fs.mkdirSync(path.join(fx.data, 'geoip'), { recursive: true });
    fs.writeFileSync(path.join(fx.data, 'geoip', 'city.mmdb'), writeMmdb({ networks: PLACES }));
    on();
    srv = await startServer(fx, { clock, overrides: { collections: [], siteHosts: [SITE], trustProxy: true } });
    ed = await as(srv, 'editor');
    admin = await as(srv, 'administrator');
  });
  after(async () => {
    setEnv({});
    await srv?.close();
    await odoo.close();
  });

  test('the lead is the old theme’s: crm.lead with its fields and values, the source, country and state looked up by name and code', async () => {
    const r = await post(lead({ email: 'ann@client.example' }));
    assert.equal(r.status, 200, r.text);
    await settle();
    const m = last();
    assert.deepEqual([m.crm, m.crm_id, m.crm_tries], ['sent', '1001', 1]);
    // the calls, in the old order: sign in, the source, the country, the state, the lead
    assert.deepEqual(odoo.calls.map((c) => [c.path, c.method, c.params[3] ?? null, c.params[4] ?? null]), [
      ['/xmlrpc/2/common', 'authenticate', {}, null],
      ['/xmlrpc/2/object', 'execute_kw', 'utm.source', 'search'],
      ['/xmlrpc/2/object', 'execute_kw', 'res.country', 'search'],
      ['/xmlrpc/2/object', 'execute_kw', 'res.country.state', 'search'],
      ['/xmlrpc/2/object', 'execute_kw', 'crm.lead', 'create'],
    ]);
    assert.deepEqual(odoo.calls[0].params, [secret.db, secret.email, secret.password, {}]);
    assert.deepEqual(odoo.calls.slice(1, 4).map((c) => c.params[5]), [[[['name', '=', 'Example Website']]], [[['code', '=', 'CA']]], [[['name', '=', 'Ontario']]]]);
    // every key the PHP sent, with its value; nothing else
    assert.deepEqual(odoo.leads[0], {
      name: 'Ann Example',
      contact_name: 'Ann Example',
      email_from: 'ann@client.example',
      phone: '+1 416 555 0101',
      mobile_country_code: 'CA',
      description: 'We&#039;d like a &quot;quote&quot; for boards &amp; more, please.',
      city: 'Toronto',
      url: `https://${SITE}/contact-us/`,
      referred: 'https://www.google.com/',
      landing_url: `https://${SITE}/project-tool-migration/`,
      refering_domain: 'google.com',
      is_auto_created: true,
      country_id: 38,
      state_id: 512,
      source_id: 7,
    });
    assert.deepEqual(Object.keys(odoo.leads[0]).sort(), phpLeadKeys().sort(), 'the keys of the PHP’s $leadData');
    assert.deepEqual(events(m.id).slice(-1), ['sent to Odoo (lead 1001)']);
    // the Inbox says so, with the lead's id there
    const one = (await ed.get(`/inbox/${m.id}`)).json;
    assert.deepEqual(one.crm, { state: 'sent', name: 'Odoo', leadId: '1001', error: null });
    assert.equal(one.crmError, null);
  });

  test('what Odoo does not have is sent as false (never created): a source, a country, a state; no place at all', async () => {
    odoo.calls.length = 0;
    delete odoo.sources['Example Website'];
    try {
      assert.equal((await post(lead(), '198.51.100.9')).status, 200);
      await settle();
      assert.equal(last().crm, 'sent');
      const l = odoo.leads.at(-1);
      assert.deepEqual([l.source_id, l.country_id, l.state_id, l.city, l.mobile_country_code], [false, false, false, 'Springfield', 'ZZ']);
      assert.deepEqual(odoo.calls.slice(1, 4).map((c) => c.params[5][0][0][2]), ['Example Website', 'ZZ', 'Nowhere']);
      assert.equal(odoo.calls.filter((c) => c.method === 'execute_kw' && c.params[4] === 'create').length, 1, 'only the lead is created');
      // an address the city file does not know: no country or state search, and empty city
      odoo.calls.length = 0;
      assert.equal((await post(lead(), '192.0.2.1')).status, 200);
      await settle();
      assert.deepEqual(odoo.calls.map((c) => (c.method === 'authenticate' ? c.method : c.params[3])), ['authenticate', 'utm.source', 'crm.lead']);
      assert.deepEqual([odoo.leads.at(-1).city, odoo.leads.at(-1).country_id, odoo.leads.at(-1).state_id, odoo.leads.at(-1).mobile_country_code], ['', false, false, '']);
    } finally {
      odoo.sources['Example Website'] = 7;
    }
  });

  test('Odoo down: the visitor’s answer is a success at once; tried again with waits, shown in the Inbox and Site health, then it goes', async () => {
    odoo.mode = 'down';
    const r = await post(lead());
    assert.deepEqual([r.status, r.json.message], [200, 'Data stored successfully']);
    await settle();
    const id = last().id;
    let m = row(id);
    assert.deepEqual([m.crm, m.crm_tries, m.crm_error], ['failed', 1, 'it answered HTTP 502']);
    assert.equal(m.crm_next_at, new Date(clock.now + 5 * 60_000).toISOString(), 'again in 5 minutes');
    // not due yet: nothing tried
    assert.equal(await srv.app.forms.crm.retry(), 0);
    // the Inbox: the message, "not sent", the filter and its count
    const one = (await ed.get(`/inbox/${id}`)).json;
    assert.deepEqual([one.crm.state, one.crmError, one.crmTries], ['failed', 'it answered HTTP 502', 1]);
    const failed = (await ed.get('/inbox?crm=failed')).json;
    assert.deepEqual([failed.items.map((i) => i.id), failed.facets.crmFailed], [[id], 1]);
    // the list says why too (its mark shows it on hover or focus)
    assert.deepEqual(failed.items[0].crm, { state: 'failed', name: 'Odoo', leadId: null, error: 'it answered HTTP 502' });
    assert.equal((await ed.get('/inbox?crm=sent')).status, 400);
    const h = (await admin.get('/site/health')).json.forms.crm;
    assert.deepEqual(h, { forms: [{ form: 'contact', label: 'Contact', kind: 'odoo', name: 'Odoo', on: true, problem: null }], failed: 1 });
    // a fault from Odoo, on the next try: its last line in words
    odoo.mode = 'fault';
    clock.now += 5 * 60_000;
    assert.equal(await srv.app.forms.crm.retry(), 1);
    m = row(id);
    assert.equal(m.crm_tries, 2);
    assert.equal(m.crm_error, 'Odoo refused it: odoo.exceptions.ValidationError: The database is busy, try later (for [hidden])', 'the sign-in email is taken out of what Odoo said');
    assert.equal(m.crm_next_at, new Date(clock.now + 15 * 60_000).toISOString(), 'then 15 minutes');
    // back: the next due try sends it
    odoo.mode = 'ok';
    clock.now += 15 * 60_000;
    await srv.app.forms.crm.retry();
    m = row(id);
    assert.deepEqual([m.crm, m.crm_tries, m.crm_error, m.crm_next_at], ['sent', 3, null, null]);
    assert.deepEqual(events(id).filter((e) => /Odoo/.test(e)), ['not sent to Odoo: it answered HTTP 502', `sent to Odoo (lead ${m.crm_id}, try 3)`]);
    assert.equal((await admin.get('/site/health')).json.forms.crm.failed, 0);
  });

  test('"Send to Odoo again": one try now, audited, as the person; refused when it is there already, or never meant for Odoo', async () => {
    odoo.mode = 'down';
    assert.equal((await post(lead())).status, 200);
    await settle();
    const id = last().id;
    const tried = await ed.post(`/inbox/${id}/crm`, {});
    assert.equal(tried.status, 502);
    assert.equal(tried.json.message, 'Not sent: it answered HTTP 502');
    assert.equal(tried.json.error, 'crm-failed');
    assert.equal(tried.json.message.includes('HTTP 502'), true);
    assert.equal(row(id).crm_tries, 2);
    odoo.mode = 'ok';
    const sent = await ed.post(`/inbox/${id}/crm`, {});
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.deepEqual([sent.json.crm.state, sent.json.crm.leadId], ['sent', row(id).crm_id]);
    const audits = srv.app.db.prepare("SELECT * FROM audit WHERE action = 'inbox.crm' AND target = ? ORDER BY id").all(id);
    assert.deepEqual(audits.map((a) => [a.ok, a.user_name]), [[0, ed.user.email.split('@')[0]], [1, ed.user.email.split('@')[0]]]);
    assert.ok(srv.app.db.prepare('SELECT * FROM form_events WHERE message_id = ? AND by_name = ? AND change LIKE ?').get(id, ed.user.email.split('@')[0], 'sent to Odoo%'));
    const again = await ed.post(`/inbox/${id}/crm`, {});
    assert.deepEqual([again.status, again.json.message], [409, `It is in Odoo already (lead ${row(id).crm_id}).`]);
    // an imported WordPress message is never sent again
    srv.app.db.prepare("INSERT INTO form_messages (id, form, at, status, fields, meta, source, source_id) VALUES ('fm_wp1', 'contact', ?, 'handled', '{}', '{}', 'wordpress', '1')").run(new Date(clock.now).toISOString());
    const wp = await ed.post('/inbox/fm_wp1/crm', {});
    assert.deepEqual([wp.status, wp.json.message], [409, 'This message came from WordPress: it is not sent again.']);
    const author = await as(srv, 'author', { authorSlug: 'alice' });
    assert.equal((await author.post(`/inbox/${id}/crm`, {})).status, 403, 'the Inbox is for editors and above');
  });

  test('switched off (ENABLE not "true"): nothing is marked or sent; a missing setting fails in words that name it, never a value', async () => {
    setEnv({ URL: odoo.url, DB: secret.db, EMAIL: secret.email, PASSWORD: secret.password });
    const calls = odoo.calls.length;
    try {
      assert.equal((await post(lead())).status, 200);
      await settle();
      assert.deepEqual([last().crm, odoo.calls.length], [null, calls], 'not for Odoo, as with ODOO_ENABLE false');
      let h = (await admin.get('/site/health')).json.forms.crm.forms[0];
      assert.deepEqual([h.on, h.problem], [false, `${ENV}_ENABLE is not "true", so nothing is sent to Odoo.`]);
      setEnv({ ENABLE: 'true', URL: odoo.url, DB: secret.db });
      assert.equal((await post(lead())).status, 200);
      await settle();
      assert.deepEqual([last().crm, last().crm_error], ['failed', `${ENV}_EMAIL, ${ENV}_PASSWORD are not set, so nothing is sent to Odoo.`]);
      h = (await admin.get('/site/health')).json.forms.crm.forms[0];
      assert.equal(h.on, false);
      assert.deepEqual(settingsOf({ env: 'X' }, { X_ENABLE: 'true', X_URL: 'http://odoo.example', X_DB: 'd', X_EMAIL: 'e', X_PASSWORD: 'p' }).problem, 'X_URL must be https (http only on this machine).');
      assert.deepEqual(settingsOf({ env: 'X' }, { X_ENABLE: 'true', X_URL: 'https://u:p@odoo.example', X_DB: 'd', X_EMAIL: 'e', X_PASSWORD: 'p' }).problem, 'X_URL must not hold a sign-in: use X_EMAIL and X_PASSWORD.');
      // a wrong password: Odoo says no, in words without it
      setEnv({ ENABLE: 'true', URL: odoo.url, DB: secret.db, EMAIL: secret.email, PASSWORD: `${secret.password}-old` });
      assert.equal((await post(lead())).status, 200);
      await settle();
      assert.equal(last().crm_error, 'Odoo did not accept the sign-in (check the email and password in the environment).');
    } finally {
      on();
    }
  });

  test('spam sends nothing to Odoo', async () => {
    const n = odoo.leads.length;
    assert.equal((await post(lead({ hp_website: 'http://spam.example' }))).status, 200);
    await settle();
    assert.deepEqual([last().status, last().crm], ['spam', null]);
    assert.equal(odoo.leads.length, n);
  });

  test('the sign-in is nowhere: not in the data folder (database, audit, events, its journal), the logs, or an answer', async () => {
    const said = [];
    const was = { error: console.error, log: console.log, warn: console.warn };
    console.error = console.log = console.warn = (...a) => said.push(a.map(String).join(' '));
    try {
      odoo.mode = 'fault';
      assert.equal((await post(lead())).status, 200);
      await settle();
      const id = last().id;
      const r = await admin.post(`/inbox/${id}/crm`, {});
      odoo.mode = 'ok';
      await admin.post(`/inbox/${id}/crm`, {});
      const answers = JSON.stringify([r.json, (await admin.get(`/inbox/${id}`)).json, (await admin.get('/site/health')).json, (await admin.get('/inbox')).json]);
      for (const s of [secret.password, secret.email, secret.db]) assert.equal(answers.includes(s), false, 'not in an answer');
    } finally {
      Object.assign(console, was);
    }
    for (const s of [secret.password, secret.email, secret.db]) assert.equal(said.join('\n').includes(s), false, 'not in the logs');
    srv.app.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.isFile() ? [path.join(dir, d.name)] : []));
    const files = walk(fx.data);
    assert.ok(files.some((f) => f.endsWith('.db')));
    for (const f of files) {
      const bytes = fs.readFileSync(f);
      for (const s of [secret.password, secret.email, secret.db]) assert.equal(bytes.includes(s), false, `${path.relative(fx.data, f)} holds a secret`);
    }
    // and the repo holds only the names of the variables
    const repo = fs.readFileSync(path.join(fx.site, 'markstage.config.mjs'), 'utf8');
    assert.match(repo, new RegExp(`env: '${ENV}'`));
    assert.equal(repo.includes(secret.password), false);
  });
});

describe('forms.<id>.crm in the config', () => {
  const form = (crm) => formsOf({ contact: { fields: { name: {}, email: { type: 'email' }, number: { type: 'tel' }, comment: { type: 'textarea' }, cc: {} }, crm } }, (m) => {
    throw new Error(m);
  }).contact.crm;
  test('defaults, and refusals in words: kind, env, source, fields, and no secrets in it', () => {
    assert.deepEqual(form({ kind: 'odoo', source: 'Example Website' }), { kind: 'odoo', env: 'ODOO', source: 'Example Website', phone: 'number', description: 'comment' });
    assert.equal(form({ kind: 'odoo', source: 'S', env: 'TR_ODOO' }).env, 'TR_ODOO');
    // the country code comes from the visitor's address, never from a field
    assert.throws(() => form({ kind: 'odoo', source: 'S', countryCode: 'cc' }), /crm\.countryCode: unknown/);
    assert.equal(form(undefined), null);
    assert.throws(() => form({ kind: 'hubspot', source: 'S' }), /crm\.kind must be 'odoo'/);
    assert.throws(() => form({ kind: 'odoo', source: 'S', password: 'x' }), /crm\.password: unknown .* The address and sign-in come from the environment\./);
    assert.throws(() => form({ kind: 'odoo', source: 'S', env: 'odoo' }), /crm\.env must be the prefix/);
    assert.throws(() => form({ kind: 'odoo' }), /crm\.source must be text/);
    assert.throws(() => form({ kind: 'odoo', source: 'S', phone: 'mobile' }), /crm\.phone: "mobile" is not one of its fields/);
  });
  test('the description as WordPress sent it; the lead before its lookups', () => {
    assert.equal(descriptionOf('  <b>Hi</b> & "you",\n\tit\'s <3>  '), 'Hi &amp; &quot;you&quot;, it&#039;s');
    const f = { name: 'name', email: 'email', crm: { phone: 'number', description: 'comment' } };
    assert.deepEqual(leadOf(f, { name: 'A', email: 'a@x.example', number: '1', comment: 'c' }, {}, null), { name: 'A', contact_name: 'A', email_from: 'a@x.example', phone: '1', mobile_country_code: '', description: 'c', city: '', url: '', referred: '', landing_url: '', refering_domain: '', is_auto_created: true });
    assert.deepEqual([leadOf(f, {}, {}, { city: 'Laval', region: 'Quebec', countryCode: 'ca' })].map((l) => [l.city, l.mobile_country_code]), [['Laval', 'CA']]);
  });
});
