// Forms on the site's own host (forms/submit.mjs) and the Inbox (forms/inbox.mjs), on a contact form shaped like a
// real site's one (name, email, phone, service, budget and the rest), with mail caught by a local SMTP sink: nothing leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';
import { ConfigError, loadConfig } from '../src/app.mjs';
import { formsOf } from '../src/forms/config.mjs';
import { readMessage, smtpSink } from './smtp-sink.mjs';
import { checkField, cleanText, greetingName, netOf } from '../src/forms/submit.mjs';
import { CONTACT_CONFIG, SITE, sitePost } from './forms-support.mjs';

const until = async (f, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};

describe('forms on the site and the Inbox', () => {
  let fx, srv, sink, clock, ed, admin, author;
  const rows = () => srv.app.db.prepare('SELECT * FROM form_messages ORDER BY at, rowid').all();
  const lead = (over = {}) => ({
    name: 'jane Doe',
    email: 'jane@client.example',
    number: '+1 (416) 555-0100',
    comment: 'We need our boards moved from Asana, about 40 projects.',
    pageUrl: `https://${SITE}/contact-us/?service=migration`,
    referrerURL: 'https://www.google.com/',
    landingURL: `https://${SITE}/project-tool-migration/`,
    referrerDomain: 'google.com',
    u_source: 'google / organic',
    u_medium: '',
    country_code: '',
    service_type: 'Data migration',
    hp_website: '',
    started: String(clock.now - 20_000),
    ...over,
  });
  const post = (body, opts) => sitePost(srv.port, '/markstage/forms/contact', body, opts);

  before(async () => {
    clock = { now: Date.parse('2026-10-28T10:00:00Z') };
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A site with a contact form');
    sink = await smtpSink();
    srv = await startServer(fx, { clock, overrides: { collections: [], siteHosts: [SITE], notify: { email: { host: '127.0.0.1', port: sink.port, security: 'none', from: 'Sales <sales@example.test>', to: ['team@example.test'] } } } });
    ed = await as(srv, 'editor');
    admin = await as(srv, 'administrator');
    author = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(async () => {
    await srv.close();
    await sink.close();
  });

  test('a visitor sends the contact form: kept, the team is mailed (Reply-To the visitor) and the visitor thanked', async () => {
    const r = await post({ ...lead(), ip: '6.6.6.6', tmpfile: '/etc/passwd', city: 'Nowhere' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { status: 200, message: 'Data stored successfully' });
    assert.equal(r.headers['cache-control'], 'no-store');
    const [m] = rows();
    assert.equal(m.status, 'new');
    assert.equal(m.ip, '127.0.0.1', 'the address is the connection, never the posted "ip"');
    const fields = JSON.parse(m.fields);
    assert.deepEqual(Object.keys(fields), ['name', 'email', 'number', 'comment', 'service_type', 'how_soon', 'approx_budget'], 'only the form\'s fields: no tmpfile, ip or city');
    assert.equal(fields.service_type, 'Data migration');
    assert.deepEqual(JSON.parse(m.meta), { page: `https://${SITE}/contact-us/?service=migration`, referrer: 'https://www.google.com/', landing: `https://${SITE}/project-tool-migration/`, referringDomain: 'google.com', utmSource: 'google / organic' });
    assert.equal(m.service, 'Data migration');
    assert.deepEqual(srv.app.db.prepare('SELECT change FROM form_events WHERE message_id = ?').all(m.id).map((e) => e.change), ['sent from the site']);

    const mails = await until(() => (sink.messages.length >= 2 ? sink.messages.map((x) => readMessage(x.data)).map((x) => ({ ...x, body: x.body.replace(/\r\n/g, '\n') })) : null));
    const team = mails.find((x) => x.headers.to === 'team@example.test');
    const thanks = mails.find((x) => x.headers.to === 'jane@client.example');
    assert.equal(team.headers.subject, 'Inquiry from jane Doe from Example Co website');
    assert.equal(team.headers['reply-to'], 'jane@client.example');
    for (const s of ['Name: jane Doe', 'Phone: +1 (416) 555-0100', 'Message:\nWe need our boards moved', 'Service type: Data migration', 'Came from: https://www.google.com/', 'UTM source: google / organic', `Open it in Markstage: ${srv.config.publicOrigin}/markstage/#/inbox?open=${m.id}`]) assert.ok(team.body.includes(s), s);
    assert.ok(!/Sent by|notify\.email/.test(team.body), 'the team mail carries no editor signature');
    assert.ok(!team.body.includes('/etc/passwd'));
    assert.equal(thanks.headers.subject, 'Thank you for reaching out');
    assert.match(thanks.body, /^Hi Jane Doe,\n\nThanks for contacting Example Co\./);
    assert.equal(thanks.headers['reply-to'], undefined);

    const n = (await ed.get('/notices')).json.items[0];
    assert.equal(n.kind, 'form.message');
    assert.equal(n.link, `#/inbox?open=${m.id}`);
    assert.match(n.text, /^New Contact form message from jane Doe\. “We need our boards/);
  });

  test('only from the site: no Origin, another site, or the CMS host are refused and nothing is kept', async () => {
    const before = rows().length;
    assert.equal((await post(lead(), { origin: null })).status, 403);
    const other = await post(lead(), { origin: 'https://evil.example' });
    assert.equal(other.status, 403);
    assert.equal(other.json.error, 'This form can only be sent from the site.');
    const audit = srv.app.db.prepare("SELECT target, detail FROM audit WHERE action = 'security.origin' ORDER BY id DESC").get();
    assert.deepEqual([audit.target, JSON.parse(audit.detail).origin], ['form.contact', 'https://evil.example']);
    // on the Markstage host the path is the editor's (read only), never the form
    const cms = await sitePost(srv.port, '/markstage/forms/contact', lead(), { host: new URL(srv.base).host, origin: srv.base });
    assert.equal(cms.status, 405);
    assert.equal((await sitePost(srv.port, '/markstage/forms/nope', lead())).status, 404);
    // the site host reaches nothing else of Markstage
    assert.equal((await sitePost(srv.port, '/markstage/api/auth/login', { email: 'x' })).status, 404);
    assert.equal(rows().length, before);
  });

  test('fields are checked in plain words; JSON works too', async () => {
    const before = rows().length;
    const r = await post(lead({ email: 'not-an-address', comment: 'short', number: '12' }));
    assert.equal(r.status, 400);
    assert.deepEqual(r.json.fields, { email: 'Email is not an email address.', number: 'Phone is not a phone number.', comment: 'Message is too short (at least 14 characters).' });
    assert.equal(r.json.error, 'Email is not an email address.');
    assert.equal((await post(lead({ name: '' }))).json.fields.name, 'Name is required.');
    assert.equal(rows().length, before);
    const j = await post(JSON.stringify({ ...lead(), email: 'json@client.example' }));
    assert.equal(j.status, 200, j.text);
    assert.equal(rows().at(-1).email, 'json@client.example');
  });

  test('bots: the honeypot and a form sent within 3 seconds are kept as spam, answered 200, nobody mailed', async () => {
    // the mail of the messages before has gone out
    await until(() => sink.messages.length === 2 * rows().filter((r) => r.status === 'new').length);
    const mails = sink.messages.length;
    const hp = await post(lead({ hp_website: 'http://spam.example', email: 'bot1@spam.example' }));
    assert.deepEqual([hp.status, hp.json.message], [200, 'Data stored successfully']);
    const fast = await post(lead({ started: String(clock.now - 1000), email: 'bot2@spam.example' }));
    assert.equal(fast.status, 200);
    const spam = rows().filter((r) => r.status === 'spam');
    assert.deepEqual(spam.map((r) => [r.email, r.spam]), [['bot1@spam.example', 'honeypot'], ['bot2@spam.example', 'too-fast']]);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(sink.messages.length, mails);
    assert.equal((await ed.get('/inbox')).json.items.some((i) => i.status === 'spam'), false, 'spam is out of the default list');
  });

  test('three a day: from one address, and for one email from anywhere (a trusted proxy\'s hop only)', async () => {
    srv.app.db.exec('DELETE FROM form_messages');
    for (let i = 0; i < 3; i++) assert.equal((await post(lead({ email: `p${i}@client.example` }))).status, 200);
    const fourth = await post(lead({ email: 'p4@client.example' }));
    assert.equal(fourth.status, 429);
    assert.deepEqual(fourth.json, { status: 429, error: "You've already submitted a request today. Please try again tomorrow." });
    // a forged X-Forwarded-For is ignored without trustProxy: still the same address
    assert.equal((await post(lead({ email: 'p5@client.example' }), { headers: { 'X-Forwarded-For': '9.9.9.9' } })).status, 429);
    // a day later it opens again
    clock.now += 86_400_000 + 1000;
    assert.equal((await post(lead({ email: 'p0@client.example', started: String(clock.now - 20_000) }))).status, 200);
    // one email from a new address (the same person on another network): counted by the email too
    srv.app.db.prepare("UPDATE form_messages SET ip = '10.0.0.1' WHERE status = 'new'").run();
    // each message differs: the same words twice within minutes are kept once (N12), which is not what is counted here
    for (let i = 0; i < 2; i++) assert.equal((await post(lead({ email: 'same@client.example', comment: `Message ${i}: we need our boards moved from Asana.`, started: String(clock.now - 20_000) }))).status, 200);
    srv.app.db.prepare("UPDATE form_messages SET ip = '10.0.0.2' WHERE email = 'same@client.example'").run();
    assert.equal((await post(lead({ email: 'same@client.example', comment: 'Message 2: we need our boards moved from Asana.', started: String(clock.now - 20_000) }))).status, 200);
    srv.app.db.prepare("UPDATE form_messages SET ip = '10.0.0.3' WHERE email = 'same@client.example'").run();
    assert.equal((await post(lead({ email: 'SAME@client.example', comment: 'Message 3: we need our boards moved from Asana.', started: String(clock.now - 20_000) }))).status, 429, 'any case of the same address');
  });

  test('the same message twice within a few minutes is kept once; a changed one is new (QA pass 2, N12)', async () => {
    srv.app.db.exec('DELETE FROM form_messages');
    const body = lead({ email: 'twice@client.example', comment: 'Sent twice by a double click.' });
    assert.equal((await post(body)).status, 200);
    clock.now += 1000;
    assert.equal((await post(body)).status, 200, 'the visitor is thanked again');
    assert.equal(rows().length, 1, 'one message');
    assert.deepEqual(srv.app.db.prepare('SELECT change FROM form_events WHERE message_id = ? ORDER BY rowid').all(rows()[0].id).map((e) => e.change), ['sent from the site', 'sent again from the site within a few minutes: kept once']);
    clock.now += 1000;
    assert.equal((await post(lead({ email: 'twice@client.example', comment: 'A different message.' }))).status, 200);
    assert.equal(rows().length, 2, 'a changed message is a new one');
  });

  test('a page with no script: the browser goes on to the thank-you page', async () => {
    srv.app.db.exec('DELETE FROM form_messages');
    const r = await post(lead({ email: 'noscript@client.example' }), { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/thank-you/');
    const bad = await post(lead({ email: 'x' }), { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
    assert.equal(bad.status, 400);
    assert.match(bad.text, /^Email is not an email address\.\n\nGo back to the page to try again\./);
  });

  test('the Inbox: messages and my alerts in one list, filters in the query; authors may not', async () => {
    srv.app.db.exec('DELETE FROM form_messages');
    // the clock moved a day on: sign in again
    [ed, admin, author] = [await as(srv, 'editor'), await as(srv, 'administrator'), await as(srv, 'author', { authorSlug: 'alice' })];
    // (each sign-in from a new browser is an alert of its own: start from none)
    srv.app.db.exec('DELETE FROM notices');
    const ids = [];
    for (const [i, name] of ['Carol', 'alan', 'Bea'].entries()) {
      clock.now += 60_000;
      srv.app.db.prepare("UPDATE form_messages SET ip = 'old'").run();
      const r = await post(lead({ name, email: `${name.toLowerCase()}@client.example`, service_type: i === 2 ? 'Consulting' : 'Data migration', comment: i === 2 ? '=HYPERLINK("http://x.example") for Bea' : `${name} needs help with ${i} boards`, started: String(clock.now - 20_000) }));
      assert.equal(r.status, 200, r.text);
      ids.push(rows().at(-1).id);
    }
    clock.now += 60_000;
    srv.app.notices.tell({ kind: 'schedule.held', level: 'warn', text: 'A scheduled entry is held back: Hello world.', link: '#/entries/posts/hello', to: 'editors' });
    assert.equal((await author.get('/inbox')).status, 403);

    const all = (await ed.get('/inbox')).json;
    assert.deepEqual(all.items.map((i) => [i.kind, i.kind === 'alert' ? i.alertKind : i.from.name]), [['alert', 'schedule.held'], ['message', 'Bea'], ['message', 'alan'], ['message', 'Carol']], 'newest first; the form.message notices are the messages themselves');
    assert.deepEqual([all.total, all.page, all.pages, all.perPage], [4, 1, 1, 50]);
    assert.deepEqual(all.facets.forms, [{ id: 'contact', label: 'Contact', count: 3 }]);
    assert.deepEqual(all.facets.services, [{ value: 'Data migration', count: 2 }, { value: 'Consulting', count: 1 }]);
    assert.equal(all.facets.status.new, 4);
    const bea = all.items[1];
    assert.deepEqual([bea.status, bea.form, bea.formLabel, bea.from, bea.service, bea.assignee, bea.imported], ['new', 'contact', 'Contact', { name: 'Bea', email: 'bea@client.example' }, 'Consulting', null, null]);
    assert.match(all.items[2].summary, /^alan needs help with 1 boards/);
    assert.deepEqual((await ed.get('/inbox?kind=message')).json.items.map((i) => i.from.name), ['Bea', 'alan', 'Carol']);
    assert.deepEqual((await ed.get('/inbox?kind=alert')).json.items.map((i) => i.summary), ['A scheduled entry is held back: Hello world.']);
    // a sign-in from a new device is under Alerts only: never among the messages, nor in the list of everything (QA F27)
    srv.app.notices.tell({ kind: 'signin.new-device', level: 'warn', text: 'Edna signed in from a new device: a browser, 2026-11-02T23:50:15Z.', link: '#/account', to: [ed.user.id] });
    assert.ok((await ed.get('/inbox?kind=alert')).json.items.some((i) => i.summary.startsWith('Edna signed in from a new device')));
    assert.ok(!(await ed.get('/inbox')).json.items.some((i) => i.summary?.startsWith('Edna signed in')), 'the list of everything leaves the device alert out');
    assert.ok(!(await ed.get('/inbox?kind=message')).json.items.some((i) => i.summary?.startsWith('Edna signed in')));
    assert.deepEqual((await ed.get('/inbox?service=Consulting')).json.items.map((i) => i.from.name), ['Bea'], 'a message-only filter leaves the alerts out');
    assert.deepEqual((await ed.get('/inbox?q=bea%40')).json.items.map((i) => i.from.name), ['Bea']);
    assert.deepEqual((await ed.get('/inbox?q=held%20back')).json.items.map((i) => i.kind), ['alert']);
    assert.deepEqual((await ed.get('/inbox?q=100%25')).json.items, [], 'a % is literal');
    const today = new Date(clock.now).toISOString().slice(0, 10);
    const yesterday = new Date(clock.now - 86_400_000).toISOString().slice(0, 10);
    assert.equal((await ed.get(`/inbox?from=${today}&to=${today}`)).json.total, 4);
    assert.equal((await ed.get(`/inbox?to=${yesterday}`)).json.total, 0);
    for (const bad of ['status=deleted', 'kind=note', 'from=28-10-2026']) assert.equal((await ed.get(`/inbox?${bad}`)).status, 400, bad);
    // each person's alerts are their own copy
    const adminAlert = (await admin.get('/inbox?kind=alert')).json.items;
    assert.deepEqual([adminAlert.length, adminAlert[0].alertKind], [1, 'schedule.held']);
    assert.notEqual(adminAlert[0].id, all.items[0].id);
  });

  test('a message: its fields and where it came from, handled with a version, given to a person, notes and history', async () => {
    const ids = rows().filter((r) => r.status === 'new').map((r) => r.id);
    const me = (await ed.get('/auth/me')).json.user;
    const adminUser = (await admin.get('/auth/me')).json.user;
    const authorUser = (await author.get('/auth/me')).json.user;
    const one = (await ed.get(`/inbox/${ids[0]}`)).json;
    assert.deepEqual(one.fields.map((f) => f.label), ['Name', 'Email', 'Phone', 'Message', 'Service type']);
    assert.equal(one.meta.utmSource, 'google / organic');
    assert.equal(one.meta.ip, undefined, 'an editor does not see the address');
    assert.equal((await admin.get(`/inbox/${ids[0]}`)).json.meta.ip, 'old');
    assert.deepEqual([one.version, one.notes, one.history.map((h) => [h.by, h.change])], ['r1', [], [[null, 'sent from the site']]]);

    const done = await ed.patch(`/inbox/${ids[0]}`, { status: 'handled', version: 'r1' });
    assert.equal(done.status, 200, done.text);
    assert.deepEqual([done.json.status, done.json.version, done.json.history.at(-1).change, done.json.history.at(-1).by.name], ['handled', 'r2', 'marked it handled', me.name]);
    const stale = await admin.patch(`/inbox/${ids[0]}`, { status: 'spam', version: 'r1' });
    assert.deepEqual([stale.status, stale.json.error, stale.json.current.status, stale.json.current.version], [409, 'stale', 'handled', 'r2']);

    assert.equal((await ed.patch(`/inbox/${ids[0]}`, { assigneeId: authorUser.id, version: 'r2' })).status, 400, 'only to someone who reads the Inbox');
    const given = await ed.patch(`/inbox/${ids[0]}`, { assigneeId: adminUser.id, version: 'r2' });
    assert.deepEqual([given.json.assignee, given.json.version, given.json.history.at(-1).change], [{ id: adminUser.id, name: adminUser.name }, 'r3', `gave it to ${adminUser.name}`]);
    const told = (await admin.get('/notices')).json.items.find((n) => n.kind === 'form.assigned');
    assert.equal(told.link, `#/inbox?open=${ids[0]}`);
    assert.match(told.text, new RegExp(`^${me.name} gave you a Contact form message from Carol\\.`));
    assert.deepEqual((await ed.get(`/inbox?assignee=${adminUser.id}`)).json.items.map((i) => i.id), [ids[0]]);
    assert.deepEqual((await ed.get('/inbox?assignee=none&kind=message')).json.items.map((i) => i.id), [ids[2], ids[1]]);
    assert.deepEqual((await ed.get('/inbox?status=handled&kind=message')).json.items.map((i) => i.id), [ids[0]]);

    const note = await ed.post(`/inbox/${ids[0]}/notes`, { text: 'Called her back.\r\nShe wants a quote.' });
    assert.equal(note.status, 201, note.text);
    assert.deepEqual([note.json.text, note.json.by.name], ['Called her back.\nShe wants a quote.', me.name]);
    assert.equal((await ed.post(`/inbox/${ids[0]}/notes`, { text: '  ' })).status, 400);
    const after = (await ed.get(`/inbox/${ids[0]}`)).json;
    assert.deepEqual([after.notes.length, after.history.map((h) => h.change), after.version], [1, ['sent from the site', 'marked it handled', `gave it to ${adminUser.name}`, 'added a note'], 'r3']);

    const audits = srv.app.db.prepare("SELECT action, target, detail FROM audit WHERE action IN ('inbox.change', 'inbox.note') ORDER BY id").all();
    assert.deepEqual(audits.map((a) => a.action), ['inbox.change', 'inbox.change', 'inbox.note']);
    assert.deepEqual(JSON.parse(audits[0].detail).status, { from: 'new', to: 'handled' });
    assert.ok(!audits.some((a) => a.detail.includes('needs') || a.detail.includes('quote')), 'no message or note text in the audit');

    // an alert in the Inbox: handled is seen; it is the viewer's alone
    const alert = (await ed.get('/inbox?kind=alert')).json.items[0];
    assert.equal((await ed.patch(`/inbox/${alert.id}`, { assigneeId: adminUser.id })).status, 400);
    assert.equal((await ed.post(`/inbox/${alert.id}/notes`, { text: 'x' })).status, 400);
    assert.equal((await admin.get(`/inbox/${alert.id}`)).status, 404, "another person's alert is not there");
    const seen = await ed.patch(`/inbox/${alert.id}`, { status: 'handled' });
    assert.deepEqual([seen.json.status, seen.json.version], ['handled', 'seen']);
    assert.equal((await ed.get('/notices')).json.items.some((n) => n.id === alert.id), false);
  });

  test('owners and administrators export (CSV) and delete; editors may not', async () => {
    const ids = rows().map((r) => r.id);
    assert.equal((await ed.get('/inbox.csv')).status, 403);
    const csv = await admin.get('/inbox.csv?kind=message');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition'), /filename="inbox.csv"/);
    // (fetch's text() drops the byte-order mark the file starts with)
    const text = csv.text;
    assert.ok(text.startsWith('reference,form,at,status,assigned to,name,email,number,comment,service_type,how_soon,approx_budget,page,referrer,landing,referringDomain,utmSource,utmMedium,utmCampaign,location,notes,imported from,imported id\r\n'), text.slice(0, 300));
    assert.ok(text.includes(`"'=HYPERLINK(""http://x.example"") for Bea"`), 'a cell starting with = is made text');
    assert.ok(text.includes(',alan needs help with 1 boards,'));
    assert.ok(text.includes('She wants a quote.'), 'the notes are in it');
    assert.equal(JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'inbox.export'").get().detail).count, 3);
    assert.equal((await ed.del(`/inbox/${ids[0]}`)).status, 403);
    assert.equal((await admin.del(`/inbox/${ids[0]}`)).status, 200);
    assert.equal((await ed.get(`/inbox/${ids[0]}`)).status, 404);
    assert.equal(JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'inbox.delete'").get().detail).status, 'handled');
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM form_events WHERE message_id = ?').get(ids[0]).n, 0, 'its history went with it');
  });

  test("the thank-you mail: changed in Settings (kept in the data dir), turned off, put back to the site's own", async () => {
    srv.app.db.exec('DELETE FROM form_messages');
    await new Promise((r) => setTimeout(r, 200));
    sink.messages.length = 0;
    const thanks = () => sink.messages.map((x) => readMessage(x.data)).filter((x) => x.headers.to.endsWith('@client.example')).map((x) => ({ ...x, body: x.body.replace(/\r\n/g, '\n') }));
    assert.equal((await ed.get('/site/forms')).status, 403);
    const v = (await admin.get('/site/forms')).json;
    const own = { subject: 'Thank you for reaching out', text: 'Hi {name},\n\nThanks for contacting {siteName}. We will be in touch within 48 hours.' };
    assert.deepEqual(v, { version: 'default', siteName: 'Example Co', variables: ['{name}', '{siteName}'], forms: [{ id: 'contact', label: 'Contact', canReply: true, reply: own, fromConfig: own, changed: false }] });
    assert.equal((await ed.put('/site/forms/contact/reply', { version: v.version, on: false })).status, 403);
    assert.equal((await admin.put('/site/forms/contact/reply', { version: 'stale', on: false })).status, 409);
    assert.equal((await admin.put('/site/forms/quote/reply', { version: v.version, on: false })).status, 404);
    assert.match((await admin.put('/site/forms/contact/reply', { version: v.version, on: true, subject: '', text: 'x' })).json.message, /subject is required/);

    const r = await admin.put('/site/forms/contact/reply', { version: v.version, on: true, subject: 'Thanks, {name}', text: 'Hi {name},\r\n\r\nWe got it at {siteName}.' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.forms[0].reply, r.json.forms[0].changed], [{ subject: 'Thanks, {name}', text: 'Hi {name},\n\nWe got it at {siteName}.' }, true]);
    assert.equal(fs.statSync(path.join(fx.data, 'forms-settings.json')).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'forms.reply'").get().detail).to, r.json.forms[0].reply);
    assert.equal((await post(lead({ email: 'thanks1@client.example' }))).status, 200);
    const [m] = await until(() => (thanks().length ? thanks() : null));
    assert.deepEqual([m.headers.subject, m.headers.from, m.body.trim()], ['Thanks, Jane Doe', 'Sales <sales@example.test>', 'Hi Jane Doe,\n\nWe got it at Example Co.']);

    const off = await admin.put('/site/forms/contact/reply', { version: r.json.version, on: false });
    assert.deepEqual([off.json.forms[0].reply, off.json.forms[0].changed], [null, true]);
    sink.messages.length = 0;
    assert.equal((await post(lead({ email: 'thanks2@client.example' }))).status, 200);
    await until(() => sink.messages.length >= 1);
    await new Promise((res) => setTimeout(res, 200));
    assert.deepEqual(thanks(), [], 'off: no thank-you mail (the team still hears)');

    const back = await admin.del('/site/forms/contact/reply', { body: { version: off.json.version } });
    assert.deepEqual([back.status, back.json.forms[0].reply, back.json.forms[0].changed], [200, own, false]);
  });

  test('retention: leads are kept forever unless keepDays is set; spam after 30 days, addresses and browsers cleared after 30 days', async () => {
    srv.app.db.exec('DELETE FROM form_messages');
    const add = srv.app.db.prepare("INSERT INTO form_messages (id, form, at, status, fields, meta, ip, user_agent) VALUES (?, ?, ?, ?, '{}', '{}', '1.2.3.4', 'UA')");
    const ago = (d) => new Date(clock.now - d * 86_400_000).toISOString();
    add.run('fm_ten_years', 'contact', ago(3653), 'handled');
    add.run('fm_spam', 'contact', ago(31), 'spam');
    add.run('fm_month', 'contact', ago(31), 'new');
    add.run('fm_new', 'contact', ago(1), 'new');
    add.run('fm_gone_form', 'retired', ago(3653), 'read');
    assert.deepEqual(srv.app.forms.sweep(), { deleted: 1, cleared: 3 });
    assert.deepEqual(rows().map((r) => [r.id, r.ip]), [['fm_ten_years', null], ['fm_gone_form', null], ['fm_month', null], ['fm_new', '1.2.3.4']]);
    // a message from the first Inbox ('read') is handled
    assert.equal((await admin.get('/inbox/fm_gone_form')).json.status, 'handled');
    assert.equal((await admin.get('/inbox?status=handled&kind=message')).json.total, 2);
  });
});

describe('a lead is stored first; the mail is only a notice on top', () => {
  let fx, srv, sink, port, clock, admin;
  const row = (id) => srv.app.db.prepare('SELECT * FROM form_messages WHERE id = ?').get(id);
  const lead = (email) => ({ name: 'Dee', email, number: '+1 416 555 0199', comment: 'Please call me about a migration.', service_type: 'Data migration', started: String(clock.now - 20_000) });
  const post = (body) => sitePost(srv.port, '/markstage/forms/contact', body);

  before(async () => {
    clock = { now: Date.parse('2026-10-28T10:00:00Z') };
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG.replace("message: 'Data stored successfully',", "message: 'Data stored successfully', keepDays: 365,"));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A site with a contact form');
    // the mail server is down: a port nothing listens on
    const probe = await smtpSink({ from: 18601 });
    port = probe.port;
    await probe.close();
    srv = await startServer(fx, { clock, overrides: { collections: [], siteHosts: [SITE], notify: { email: { host: '127.0.0.1', port, security: 'none', from: 'Sam Sales <sales@example.test>', to: ['sales@example.test'] } } } });
    admin = await as(srv, 'administrator');
  });
  after(async () => {
    await srv.close();
    await sink?.close();
  });

  test('the mail server down: the visitor is answered, the lead is kept and marked, shown in the Inbox and Site health, tried again', async () => {
    const r = await post(lead('dee@client.example'));
    assert.deepEqual([r.status, r.json.message], [200, 'Data stored successfully'], 'the answer depends on the store only');
    const second = await post(lead('dee2@client.example'));
    assert.equal(second.status, 200);
    const [a, b] = srv.app.db.prepare('SELECT id FROM form_messages ORDER BY at, rowid').all().map((x) => x.id);
    await until(() => row(a).alert === 'failed' && row(b).alert === 'failed');
    assert.equal(row(a).alert_tries, 1);
    assert.equal(row(a).alert_next_at, new Date(clock.now + 5 * 60_000).toISOString(), 'again in 5 minutes');
    assert.match(row(a).alert_error, /ECONNREFUSED|refused|connect/i);

    const list = (await admin.get('/inbox?alert=failed')).json;
    assert.deepEqual([list.total, list.facets.alertFailed, list.items[0].alert], [2, 2, 'failed']);
    const one = (await admin.get(`/inbox/${a}`)).json;
    assert.deepEqual([one.alertTries, one.history.map((h) => h.change)[1]], [1, `the team alert was not sent: ${row(a).alert_error.slice(0, 200)}`]);
    assert.equal((await admin.get('/site/health')).json.forms.alertFailed, 2);
    assert.equal((await admin.get('/inbox?alert=sent')).status, 400);

    // not due yet: nothing is tried; one that has used up its tries is given up (still in the Inbox)
    srv.app.db.prepare('UPDATE form_messages SET alert_tries = 11, alert_next_at = ? WHERE id = ?').run(new Date(clock.now - 1000).toISOString(), b);
    assert.equal(await srv.app.forms.retry(), 1);
    assert.deepEqual([row(b).alert, row(b).alert_tries, row(b).alert_next_at], ['failed', 12, null]);
    assert.equal((await admin.get(`/inbox/${b}`)).json.history.at(-1).change, 'gave up sending the team alert after 12 tries');

    // the mail server is back; five minutes on, the retry goes out
    sink = await smtpSink({ from: port });
    assert.equal(sink.port, port);
    clock.now += 5 * 60_000 + 1000;
    assert.equal(await srv.app.forms.retry(), 1, 'only the one still due');
    assert.deepEqual([row(a).alert, row(a).alert_error, row(a).alert_next_at], ['sent', null, null]);
    const mail = readMessage(sink.messages[0].data);
    assert.deepEqual([mail.headers.to, mail.headers['reply-to'], mail.headers.from], ['sales@example.test', 'dee@client.example', 'Sam Sales <sales@example.test>']);
    assert.equal((await admin.get(`/inbox/${a}`)).json.history.at(-1).change, 'the team alert went out (try 2)');
    assert.equal((await admin.get('/site/health')).json.forms.alertFailed, 1, 'the given-up one stays counted');
  });

  test('keepDays, when a form sets it, deletes older messages; a new lead with the mail up is marked sent', async () => {
    const add = srv.app.db.prepare("INSERT INTO form_messages (id, form, at, status, fields, meta) VALUES (?, 'contact', ?, 'handled', '{}', '{}')");
    add.run('fm_two_years', new Date(clock.now - 730 * 86_400_000).toISOString());
    add.run('fm_month_old', new Date(clock.now - 30 * 86_400_000).toISOString());
    assert.equal(srv.app.forms.sweep().deleted, 1);
    assert.equal(row('fm_two_years'), undefined);
    assert.ok(row('fm_month_old'));
    clock.now += 86_400_000;
    admin = await as(srv, 'administrator');
    const r = await post(lead('eve@client.example'));
    assert.equal(r.status, 200);
    const id = srv.app.db.prepare("SELECT id FROM form_messages WHERE email = 'eve@client.example'").get().id;
    await until(() => row(id).alert === 'sent');
  });
});

describe('form helpers', () => {
  test('text is kept without control characters; one line unless it is a long text', () => {
    assert.equal(cleanText('a\u0000b‮ c\r\nd '), 'ab c d');
    assert.equal(cleanText('line 1\r\nline 2​ ', true), 'line 1\nline 2');
  });
  test('a visitor is greeted by name, but never by a link or an address', () => {
    assert.equal(greetingName('jane'), 'Jane');
    assert.equal(greetingName('Win big at http://spam.example'), '');
    assert.equal(greetingName('www.spam.example'), '');
    assert.equal(greetingName('spam.example'), '');
    assert.equal(greetingName('a@b.c'), '');
  });
  test('field checks', () => {
    const f = { key: 'site', label: 'Site', type: 'url', required: false, min: 0, max: 200, options: null };
    assert.deepEqual(checkField(f, 'javascript:alert(1)'), { error: 'Site is not a web address.' });
    assert.deepEqual(checkField(f, 'https://ok.example/'), { value: 'https://ok.example/' });
    assert.deepEqual(checkField({ ...f, type: 'text', options: ['A', 'B'] }, 'C'), { error: 'Site: choose one of the options.' });
  });
});

describe('forms config', () => {
  const fail = (m) => {
    throw new ConfigError(m);
  };
  test('a form is checked at start, in plain words', () => {
    assert.equal(formsOf(undefined, fail), null);
    assert.throws(() => formsOf({ contact: { fields: {} } }, fail), /forms\.contact\.fields must name at least one field/);
    assert.throws(() => formsOf({ Contact: { fields: { a: {} } } }, fail), /"Contact" is not a form id/);
    assert.throws(() => formsOf({ c: { fields: { a: { type: 'file' } } } }, fail), /forms\.c\.fields\.a\.type must be one of text, email, tel, textarea, url/);
    assert.throws(() => formsOf({ c: { fields: { a: {} }, reply: { subject: 'x', text: 'y' } } }, fail), /reply needs an email field/);
    assert.throws(() => formsOf({ c: { fields: { a: {} }, honeypot: 'a' } }, fail), /honeypot must be the name of a posted value that is not a field/);
    assert.throws(() => formsOf({ c: { fields: { a: {} }, thanks: 'https://elsewhere.example/' } }, fail), /thanks must be a path on the site/);
    assert.throws(() => formsOf({ c: { fields: { a: {} }, meta: { ip: 'ip' } } }, fail), /meta\.ip: unknown/);
    const f = formsOf({ c: { fields: { email: {}, note: { type: 'textarea' } } } }, fail).c;
    assert.deepEqual([f.email, f.name, f.fields[0].type, f.fields[1].max, f.perDay, f.keepDays], ['email', null, 'email', 5000, 3, null], 'kept forever unless keepDays is set');
    assert.equal(formsOf({ c: { fields: { a: {} }, keepDays: 365 } }, fail).c.keepDays, 365);
    assert.throws(() => formsOf({ c: { fields: { a: {} }, keepDays: 0 } }, fail), /keepDays must be a whole number from 1/);
  });
  test('siteHosts: host names only, never the Markstage host', () => {
    const fx = makeFixture({ checks: false });
    const load = (overrides) => loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: 18999, ...overrides } });
    assert.throws(() => load({ siteHosts: ['https://www.example.test'] }), /siteHosts must be host names/);
    assert.throws(() => load({ siteHosts: ['127.0.0.1:18999'] }), /siteHosts must not include the Markstage host itself/);
    assert.deepEqual(load({ siteHosts: ['WWW.Example.test'], protectedPages: { hosts: ['example.test'] } }).siteHosts, ['www.example.test', 'example.test']);
  });
});

describe('a flood: the form is never turned off', () => {
  let fx, srv, sink, clock;
  const from = (ip) => ({ headers: { 'X-Forwarded-For': ip } });
  const body = (i, over = {}) => ({ name: `Visitor ${i}`, email: `v${i}@client.example`, number: '+1 (416) 555-0100', comment: 'We need our boards moved from Asana, about 40 projects.', hp_website: '', started: String(clock.now - 20_000), ...over });
  const post = (b, opts) => sitePost(srv.port, '/markstage/forms/contact', b, opts);
  const rows = (where = '1') => srv.app.db.prepare(`SELECT * FROM form_messages WHERE ${where} ORDER BY at, rowid`).all();
  before(async () => {
    clock = { now: Date.parse('2026-10-28T10:00:00Z') };
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG.replace("thanks: '/thank-you/',", "thanks: '/thank-you/', perHour: 10, perDay: 50,"));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A site with a contact form');
    sink = await smtpSink();
    srv = await startServer(fx, { clock, overrides: { collections: [], siteHosts: [SITE], trustProxy: true, notify: { email: { host: '127.0.0.1', port: sink.port, security: 'none', from: 'Sales <sales@example.test>', to: ['team@example.test'] } } } });
  });
  after(async () => {
    // the last mails' outcomes are written once the SMTP talk ends, a moment after the sink has them
    await new Promise((r) => setTimeout(r, 200));
    await srv.close();
    await sink.close();
  });

  test('past perHour (real messages only) a message is held: the visitor is answered, nobody mailed, the administrators told once; it goes out when the hour calms down', async () => {
    const admin = await as(srv, 'administrator');
    const ed = await as(srv, 'editor');
    for (let i = 0; i < 10; i++) assert.equal((await post(body(i), from(`198.51.100.${i + 1}`))).status, 200);
    // spam never counts toward the hour
    for (let i = 0; i < 3; i++) assert.equal((await post(body(100 + i, { hp_website: 'http://spam.example' }), from(`198.51.100.${50 + i}`))).status, 200);
    assert.equal(rows("status = 'spam'").length, 3);
    await until(() => sink.messages.length >= 20);
    const mailsBefore = sink.messages.length;
    const r = await post(body(11, { skald_vid: 'v-11' }), from('198.51.100.11'));
    assert.equal(r.status, 200, 'the visitor is answered like always');
    assert.deepEqual(r.json, { status: 200, message: 'Data stored successfully' });
    const held = rows("status = 'held'");
    assert.equal(held.length, 1);
    assert.equal(srv.app.db.prepare('SELECT change FROM form_events WHERE message_id = ?').get(held[0].id).change, 'held: the form got more than 10 messages in an hour; the team is told once it calms down');
    assert.equal((await post(body(12), from('198.51.100.12'))).status, 200);
    assert.equal(rows("status = 'held'").length, 2);
    await new Promise((r) => setTimeout(r, 150));
    // the only mail is the alert to the administrators' address: no team mail, no thank-you for a held message
    const extra = sink.messages.slice(mailsBefore).map((x) => readMessage(x.data));
    assert.deepEqual(extra.map((m) => [m.headers.to, m.headers.subject]), [['team@example.test', 'Example Co: The Contact form got more than 10 messages in an hour.']]);
    const mailsHeld = sink.messages.length;
    const told = (await admin.get('/notices')).json.items.filter((n) => n.kind === 'form.held');
    assert.equal(told.length, 1, 'the administrators hear once an hour');
    assert.match(told[0].text, /^The Contact form got more than 10 messages in an hour\. New ones are kept in the Inbox as held/);
    assert.equal(told[0].link, '#/inbox?status=held');
    assert.equal((await ed.get('/notices')).json.items.filter((n) => n.kind === 'form.held').length, 0, 'editors are not');
    assert.equal(srv.app.audit.list({ action: 'forms.held' }).items.length, 1);
    // the Inbox lists them, counts them, and nobody can set "held" by hand
    const inbox = await admin.get('/inbox?status=held');
    assert.deepEqual(inbox.json.items.map((i) => [i.kind, i.status, i.from.name]).sort(), [['message', 'held', 'Visitor 11'], ['message', 'held', 'Visitor 12']], 'messages only: the alert about the hold is not a held item');
    assert.equal(inbox.json.facets.status.held, 2);
    assert.equal((await admin.get('/inbox')).json.items.filter((i) => i.status === 'held').length, 2, 'held messages are in the plain list too');
    const detail = (await admin.get(`/inbox/${held[0].id}`)).json;
    assert.equal((await admin.patch(`/inbox/${held[0].id}`, { status: 'held', version: detail.version })).status, 400);
    assert.equal((await admin.patch(`/inbox/${held[0].id}`, { status: 'handled', version: detail.version })).status, 200, 'a person may still mark it handled');
    // the hour passes: the held message goes out on the retry tick, the team mailed and the visitor thanked
    const second = rows("status = 'held'")[0];
    clock.now += 3_600_000 + 1000;
    assert.equal(await srv.app.forms.retry(), 1);
    const [went] = rows(`id = '${second.id}'`);
    assert.equal(went.status, 'new');
    assert.equal(srv.app.db.prepare('SELECT change FROM form_events WHERE message_id = ? ORDER BY rowid').all(went.id).at(-1).change, 'let through: the hour is under the limit again; the team is told now');
    const mails = await until(() => (sink.messages.length >= mailsHeld + 2 ? sink.messages.slice(mailsHeld).map((x) => readMessage(x.data)) : null));
    assert.deepEqual(mails.map((m) => m.headers.to).sort(), ['team@example.test', 'v12@client.example']);
    assert.equal(await srv.app.forms.retry(), 0, 'nothing left to let through');
    assert.equal((await post(body(13), from('198.51.100.13'))).status, 200);
    assert.equal(rows("id = (SELECT id FROM form_messages ORDER BY rowid DESC LIMIT 1)")[0].status, 'new', 'a calm hour: stored as new again');
    await until(() => sink.messages.length >= mailsHeld + 4);
  });

  test('one network is capped like one address: 60 a day from an IPv4 /24 or an IPv6 /64, spam included', async () => {
    srv.app.db.exec('DELETE FROM form_messages');
    for (let i = 1; i <= 60; i++) assert.equal((await post(body(200 + i, { hp_website: 'x' }), from(`203.0.113.${i}`))).status, 200);
    const over = await post(body(261, { hp_website: 'x' }), from('203.0.113.61'));
    assert.equal(over.status, 429, 'the 61st address of the /24 is refused');
    assert.equal((await post(body(262), from('203.0.114.1'))).status, 200, 'the next /24 is not');
    srv.app.db.exec('DELETE FROM form_messages');
    for (let i = 1; i <= 60; i++) assert.equal((await post(body(300 + i, { hp_website: 'x' }), from(`2001:db8:1:2:${i.toString(16)}::1`))).status, 200);
    assert.equal((await post(body(361, { hp_website: 'x' }), from('2001:db8:1:2:ffff::1'))).status, 429, 'the /64 is full');
    assert.equal((await post(body(362), from('2001:db8:1:3::1'))).status, 200, 'another /64 is not');
  });

  test('netOf: a /24 for IPv4 (mapped too), a /64 for IPv6, nothing for junk', () => {
    assert.equal(netOf('203.0.113.9'), '203.0.113.0/24');
    assert.equal(netOf('::ffff:203.0.113.9'), '203.0.113.0/24');
    assert.equal(netOf('2001:DB8:0001:2:3:4:5:6'), '2001:db8:1:2::/64');
    assert.equal(netOf('2001:db8::1'), '2001:db8:0:0::/64');
    assert.equal(netOf('::1'), '0:0:0:0::/64');
    assert.equal(netOf('fe80::1%eth0'), null);
    assert.equal(netOf(''), null);
    assert.equal(netOf(null), null);
  });
});
