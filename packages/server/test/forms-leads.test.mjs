// A real contact form message also goes to Skald as a lead (src/forms/leads.mjs), signed as Skald's own
// skald-lead.cjs signs it, against a stand-in lead hook here. Never the real Skald. Spam never goes; the visitor's
// address and visitor id go with it; a failed send is tried again and shown in the message's history and Site
// health; the secret is found nowhere it is not needed. Made-up people on documentation addresses; the secret is made
// up here.
// With SKALD_LEAD_CJS=<path to Skald's skald-lead.cjs> (downloaded from Skald, never committed), one more test sends
// the same lead with Skald's own file and checks that both are signed and shaped the same.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';
import { CONTACT_CONFIG, SITE, sitePost } from './forms-support.mjs';
import { leadOf, signatureOf, visitorId, visitorIp } from '../src/forms/leads.mjs';
import { formsOf } from '../src/forms/config.mjs';

const ENV = 'MSTEST_SKALD';
const VID = `skv_${'A1b2C3d4E5f6G7h8I9j0K-'.slice(0, 22)}`;

/** A stand-in lead hook: checks each signature with `secret` (within 5 minutes), answers `next` (default 200). */
async function fakeSkald(secret) {
  const got = [];
  const answers = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const sig = String(req.headers['x-skald-signature'] ?? '');
      const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig);
      const want = m ? crypto.createHmac('sha256', secret).update(`${m[1]}.${body}`).digest('hex') : '';
      const signed = Boolean(m) && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
      got.push({ path: req.url, signed, t: m ? Number(m[1]) : null, type: req.headers['content-type'], body: JSON.parse(body || 'null') });
      const status = !signed ? 401 : answers.shift() ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { ok: true } : { error: status === 401 ? 'bad signature' : 'try later' }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}/traffic-hooks/${SITE}/lead`, got, answers, close: () => new Promise((ok) => server.close(ok)) };
}

describe('lead hook settings and the lead itself', () => {
  test('forms.<id>.leads: checked, with words for each mistake; the secret is never in it', () => {
    const fail = (m) => {
      throw new Error(m);
    };
    const form = (leads) => formsOf({ contact: { fields: { name: {}, email: { type: 'email' } }, leads } }, fail).contact.leads;
    assert.deepEqual(form({ kind: 'skald', url: 'https://app.skaldanalytics.com/traffic-hooks/x/lead', vid: 'skald_vid' }), { kind: 'skald', url: 'https://app.skaldanalytics.com/traffic-hooks/x/lead', action: 'contact', env: 'SKALD_LEAD', vid: 'skald_vid', test: null });
    assert.throws(() => form({ kind: 'segment', url: 'https://x.example/' }), /leads\.kind must be 'skald'/);
    assert.throws(() => form({ kind: 'skald', url: 'http://x.example/lead' }), /must be https/);
    assert.throws(() => form({ kind: 'skald', url: 'https://x.example/lead?key=1' }), /plain address/);
    assert.throws(() => form({ kind: 'skald', url: 'https://x.example/lead', secret: 's' }), /leads\.secret: unknown/);
    assert.throws(() => form({ kind: 'skald', url: 'https://x.example/lead', vid: 'email' }), /not a field/);
    assert.throws(() => form({ kind: 'skald', url: 'https://x.example/lead', action: 'Big Deal' }), /short lowercase word/);
    assert.equal(form({ kind: 'skald', url: 'http://127.0.0.1:9/lead' }).url, 'http://127.0.0.1:9/lead', 'http on this machine only');
  });

  test('the address and visitor id as Skald takes them', () => {
    assert.equal(visitorIp('203.0.113.7'), '203.0.113.7');
    assert.equal(visitorIp('203.0.113.7, 10.0.0.1'), '203.0.113.7');
    assert.equal(visitorIp('203.0.113.7:4431'), '203.0.113.7');
    assert.equal(visitorIp('[2001:db8::1]:443'), '2001:db8::1');
    assert.equal(visitorIp('unknown'), null);
    assert.equal(visitorId(VID), VID);
    assert.equal(visitorId('skv_short'), null);
    const f = { leads: { action: 'contact' } };
    assert.deepEqual(leadOf(f, { id: 'fm_1', email: 'a@client.example', name: 'Ann', ip: '203.0.113.7' }, { vid: VID, test: true }), { external_ref: 'fm_1', action: 'contact', email: 'a@client.example', name: 'Ann', ip: '203.0.113.7', vid: VID, test: true });
    assert.deepEqual(leadOf(f, { id: 'fm_2', email: null, name: null, ip: null }, { vid: 'nope' }), { external_ref: 'fm_2', action: 'contact' });
  });

  test('the signature is HMAC-SHA256 over "<t>.<body>", hex', () => {
    const body = '{"external_ref":"fm_1","action":"contact"}';
    assert.equal(signatureOf('s3cret', body, 1700000000), `t=1700000000,v1=${crypto.createHmac('sha256', 's3cret').update(`1700000000.${body}`).digest('hex')}`);
  });
});

describe('a contact form message to Skald as a lead', () => {
  let fx, srv, skald, clock, admin, ed;
  const secret = `sk-${crypto.randomBytes(18).toString('base64url')}`;
  let n = 0;
  const lead = (over = {}) => ({
    name: 'Ann Example',
    email: `ann-${crypto.randomBytes(3).toString('hex')}@client.example`,
    number: '+1 416 555 0101',
    comment: 'We would like a quote for our boards, please.',
    pageUrl: `https://${SITE}/contact-us/`,
    started: String(clock.now - 20_000),
    ...over,
  });
  const post = (body, ip = `203.0.113.${++n}`) => sitePost(srv.port, '/markstage/forms/contact', body, { headers: { 'X-Forwarded-For': ip } });
  const last = () => srv.app.db.prepare('SELECT * FROM form_messages ORDER BY rowid DESC LIMIT 1').get();
  const leadRow = (id) => srv.app.db.prepare('SELECT * FROM form_leads WHERE message_id = ?').get(id);
  const events = (id) => srv.app.db.prepare('SELECT change FROM form_events WHERE message_id = ? ORDER BY id').all(id).map((e) => e.change);
  const settle = () => new Promise((r) => setTimeout(r, 150));

  before(async () => {
    clock = { now: Date.parse('2026-10-30T10:00:00Z') };
    skald = await fakeSkald(secret);
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG.replace("message: 'Data stored successfully',", `message: 'Data stored successfully', leads: { kind: 'skald', url: '${skald.url}', env: '${ENV}', vid: 'skald_vid', test: 'skald_test' },`));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A contact form that also sends leads to Skald');
    process.env[`${ENV}_SECRET`] = secret;
    srv = await startServer(fx, { clock, overrides: { collections: [], siteHosts: [SITE], trustProxy: true } });
    admin = await as(srv, 'administrator');
    ed = await as(srv, 'editor');
  });
  after(async () => {
    delete process.env[`${ENV}_SECRET`];
    await srv?.close();
    await skald.close();
  });

  test('a real message: stored, answered, then one signed lead with its id, who, the visitor’s address and visitor id', async () => {
    const r = await post(lead({ email: 'ann@client.example', skald_vid: VID }), '203.0.113.50');
    assert.equal(r.status, 200, r.text);
    await settle();
    const m = last();
    assert.equal(skald.got.length, 1);
    const g = skald.got[0];
    assert.equal(g.signed, true, 'signed with the secret');
    assert.equal(g.t, Math.floor(clock.now / 1000), 'the signature carries the time');
    assert.equal(g.path, `/traffic-hooks/${SITE}/lead`);
    assert.equal(g.type, 'application/json');
    assert.deepEqual(g.body, { external_ref: m.id, action: 'contact', email: 'ann@client.example', name: 'Ann Example', ip: '203.0.113.50', vid: VID });
    assert.deepEqual([leadRow(m.id).state, leadRow(m.id).tries], ['sent', 1]);
    assert.deepEqual(events(m.id).slice(-1), ['sent to Skald as a lead']);
    const one = (await ed.get(`/inbox/${m.id}`)).json;
    assert.equal(one.lead.state, 'sent');
    assert.equal(one.lead.name, 'Skald');
  });

  test('spam never goes: the honeypot, and a form sent too fast', async () => {
    skald.got.length = 0;
    assert.equal((await post(lead({ hp_website: 'http://spam.example' }))).status, 200);
    const a = last();
    assert.equal((await post(lead({ started: String(clock.now - 500) }))).status, 200);
    const b = last();
    await settle();
    assert.deepEqual([a.status, b.status], ['spam', 'spam']);
    assert.equal(skald.got.length, 0, 'nothing sent');
    assert.equal(leadRow(a.id), undefined);
    assert.equal(leadRow(b.id), undefined);
  });

  test('a test lead from the team ("skald_test" = 1); a visitor id that is not one is left out', async () => {
    skald.got.length = 0;
    assert.equal((await post(lead({ skald_vid: 'not-a-visitor-id', skald_test: '1' }))).status, 200);
    await settle();
    const m = last();
    assert.equal(skald.got[0].body.test, true);
    assert.equal('vid' in skald.got[0].body, false);
    assert.deepEqual(events(m.id).slice(-1), ['sent to Skald as a lead (a test lead)']);
  });

  test('Skald down: the visitor’s answer is a success at once; tried again with waits, in the history and Site health, then it goes', async () => {
    skald.got.length = 0;
    skald.answers.push(503);
    assert.equal((await post(lead())).status, 200);
    await settle();
    const m = last();
    let l = leadRow(m.id);
    assert.deepEqual([l.state, l.tries], ['failed', 1]);
    assert.equal(l.next_at, new Date(clock.now + 5 * 60_000).toISOString(), 'again in 5 minutes');
    assert.match(events(m.id).at(-1), /^not sent to Skald as a lead: it answered 503: try later$/);
    assert.equal((await admin.get('/site/health')).json.forms.leads.failed, 1);
    assert.equal(await srv.app.forms.leads.retry(), 0, 'not before its time');
    clock.now += 5 * 60_000;
    assert.equal(await srv.app.forms.leads.retry(), 1);
    l = leadRow(m.id);
    assert.deepEqual([l.state, l.tries], ['sent', 2]);
    assert.deepEqual(events(m.id).slice(-1), ['sent to Skald as a lead (try 2)']);
    assert.equal(skald.got.length, 2);
    assert.equal(skald.got[1].body.external_ref, m.id, 'the same id: Skald never counts it twice');
    assert.equal((await admin.get('/site/health')).json.forms.leads.failed, 0);
  });

  test('no secret: not sent, in words that name the variable; the secret is in no table, history or audit row', async () => {
    delete process.env[`${ENV}_SECRET`];
    try {
      skald.got.length = 0;
      assert.equal((await post(lead())).status, 200);
      await settle();
      const m = last();
      assert.equal(skald.got.length, 0);
      assert.match(leadRow(m.id).error, /MSTEST_SKALD_SECRET is not set/);
      const h = (await admin.get('/site/health')).json.forms.leads.forms[0];
      assert.deepEqual([h.on, h.kind], [false, 'skald']);
    } finally {
      process.env[`${ENV}_SECRET`] = secret;
    }
    const dump = JSON.stringify(['form_leads', 'form_events', 'form_messages', 'audit'].flatMap((t) => srv.app.db.prepare(`SELECT * FROM ${t}`).all()));
    assert.equal(dump.includes(secret), false);
  });

  test('Skald’s own skald-lead.cjs signs and shapes the same lead the same way', { skip: process.env.SKALD_LEAD_CJS ? false : 'set SKALD_LEAD_CJS to Skald\'s downloaded skald-lead.cjs to run it' }, async () => {
    const { skaldLead } = createRequire(import.meta.url)(path.resolve(process.env.SKALD_LEAD_CJS));
    skald.got.length = 0;
    const realFetch = globalThis.fetch;
    // its address is Skald's: send it to the stand-in instead, nothing else changed
    globalThis.fetch = (u, opts) => realFetch(skald.url, opts);
    const prev = process.env.SKALD_LEAD_SECRET;
    process.env.SKALD_LEAD_SECRET = secret;
    try {
      assert.equal(await skaldLead('fm_same', 'contact', { email: 'b@client.example', name: 'Bo', ip: '203.0.113.9, 10.0.0.2', vid: VID, test: true }), true);
    } finally {
      globalThis.fetch = realFetch;
      if (prev === undefined) delete process.env.SKALD_LEAD_SECRET;
      else process.env.SKALD_LEAD_SECRET = prev;
    }
    const theirs = skald.got[0];
    assert.equal(theirs.signed, true, 'the stand-in checks both with the same rule');
    const ours = leadOf({ leads: { action: 'contact' } }, { id: 'fm_same', email: 'b@client.example', name: 'Bo', ip: '203.0.113.9, 10.0.0.2' }, { vid: VID, test: true });
    assert.deepEqual(ours, theirs.body, 'the same fields and values');
    const body = JSON.stringify(theirs.body);
    assert.equal(signatureOf(secret, body, theirs.t), (() => `t=${theirs.t},v1=${crypto.createHmac('sha256', secret).update(`${theirs.t}.${body}`).digest('hex')}`)());
  });
});
