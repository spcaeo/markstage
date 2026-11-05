// Who hears about what (notify/rules.mjs): the site's rules (Settings → Alerts), each person's choices (My alerts),
// the daily digest, and the safety alerts that can't be turned off (an invite, a role change, a sign-in from a new
// device). Mail is caught by a local SMTP sink: nothing leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { addUser, as, client, makeFixture, startServer } from './helpers.mjs';
import { readMessage, smtpSink } from './smtp-sink.mjs';
import { deviceName } from '../src/auth/routes.mjs';

const until = async (f, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('alert rules and personal choices', () => {
  let fx, srv, sink, clock, owner, admin, ed, ed2, author;
  const mails = () => sink.messages.map((m) => readMessage(m.data)).map((m) => ({ ...m, to: m.headers.to.split(', ').sort(), body: m.body.replace(/\r\n/g, '\n') }));
  const notices = (kind) => srv.app.db.prepare('SELECT user_id FROM notices WHERE kind = ? ORDER BY user_id').all(kind).map((r) => r.user_id);
  const tell = (kind, to = 'editors') => srv.app.notices.tell({ kind, level: 'info', text: `A ${kind} happened.`, link: '#/x', to });
  // the mail of what came before has landed, then start clean
  const fresh = async () => {
    await settle();
    sink.messages.length = 0;
    srv.app.db.exec('DELETE FROM notices');
  };

  before(async () => {
    clock = { now: Date.parse('2026-10-28T06:00:00Z') };
    fx = makeFixture({ checks: false });
    sink = await smtpSink();
    srv = await startServer(fx, { clock, overrides: { notify: { email: { host: '127.0.0.1', port: sink.port, security: 'none', from: 'Sales <sales@example.test>', to: ['sales@example.test'], roles: ['owner', 'administrator'] } } } });
    owner = await as(srv, 'owner');
    admin = await as(srv, 'administrator');
    ed = await as(srv, 'editor');
    ed2 = await as(srv, 'editor');
    author = await as(srv, 'author', { authorSlug: 'alice' });
    await settle();
  });
  after(async () => {
    await srv.close();
    await sink.close();
  });

  test('Settings → Alerts: every kind with its defaults; editors read, only owner and administrator change', async () => {
    assert.equal((await author.get('/site/alerts')).status, 403);
    const r = (await ed.get('/site/alerts')).json;
    assert.equal(r.version, 'default');
    assert.deepEqual(r.channels, { email: { on: true, from: 'sales@example.test', senderName: 'Sales', host: '127.0.0.1', status: null, detail: null, lastAt: null }, slack: { on: false }, webhook: { on: false } });
    assert.deepEqual(r.kinds.map((k) => k.kind), ['publish.failed', 'deploy.failed', 'backup.failed', 'site.rollback', 'schedule.held', 'schedule.released', 'schedule.late', 'release.published', 'release.blocked', 'webhook.failed', 'form.message', 'form.assigned', 'form.held', 'health.broken', 'integration.failed', 'lock.changed', 'user.invited', 'user.role', 'roles.changed', 'env.promoted', 'env.promote-failed', 'env.approval-needed', 'env.rules-changed', 'signin.new-device']);
    const form = r.kinds.find((k) => k.kind === 'form.message');
    assert.deepEqual(form, { kind: 'form.message', label: 'A new message from a site form', group: 'Forms', safety: false, on: true, roles: ['owner', 'administrator', 'editor'], users: [], extra: ['sales@example.test'], channels: ['email', 'slack', 'webhook'] });
    assert.deepEqual(r.kinds.find((k) => k.kind === 'signin.new-device').extra, [], 'a personal alert goes to no shared address');
    assert.deepEqual(r.kinds.filter((k) => k.safety).map((k) => k.kind), ['backup.failed', 'user.invited', 'user.role', 'roles.changed', 'env.rules-changed', 'signin.new-device']);
    assert.deepEqual(r.people.find((p) => p.id === ed.user.id), { id: ed.user.id, name: ed.user.email.split('@')[0], role: 'editor' }, 'the people a rule can name');
    assert.equal((await ed.put('/site/alerts', { version: r.version, kinds: [] })).status, 403);
  });

  test('a rule is checked in plain words; safety alerts stay on and by mail; stale is refused', async () => {
    const v = (await admin.get('/site/alerts')).json.version;
    const bad = async (body, re) => {
      const x = await admin.put('/site/alerts', { version: v, kinds: [], ...body });
      assert.equal(x.status, 400, x.text);
      assert.match(x.json.message, re);
    };
    await bad({ kinds: { 'form.message': { on: false } } }, /kinds must be a list/);
    await bad({ kinds: [{ kind: 'form.sent', on: false }] }, /"form.sent" is not a kind of alert/);
    await bad({ kinds: [{ kind: 'user.role', on: false }] }, /A user's role changed.*safety alert and can't be turned off/);
    await bad({ kinds: [{ kind: 'signin.new-device', channels: ['slack'] }] }, /safety alert: it always goes by email/);
    await bad({ kinds: [{ kind: 'form.message', roles: ['visitor'] }] }, /roles must be a list of roles/);
    await bad({ kinds: [{ kind: 'form.message', userIds: ['u_nobody'] }] }, /people must be users of this site/);
    await bad({ kinds: [{ kind: 'form.message', extra: ['not an address'] }] }, /other addresses must be up to 20 email addresses \(“not an address” is not one\)/);
    await bad({ kinds: [{ kind: 'form.message', channels: ['sms'] }] }, /channels are a list of email, slack, webhook/);
    await bad({ senderName: 'Bad <bad@example.test>' }, /sender name is a plain name/);
    const stale = await admin.put('/site/alerts', { version: 'stale', kinds: [{ kind: 'schedule.late', on: false }] });
    assert.deepEqual([stale.status, stale.json.error, stale.json.current.version], [409, 'stale', v]);
    assert.equal(fs.existsSync(path.join(fx.data, 'alert-rules.json')), false, 'nothing written');
  });

  test('by default: the roles in the editor, mail to who got it before (owner, administrator) and the listed address', async () => {
    await fresh();
    assert.equal(tell('form.message'), 4);
    const ids = [owner, admin, ed, ed2].map((c) => c.user.id);
    assert.deepEqual(notices('form.message'), [...ids].sort());
    const [m] = await until(() => (sink.messages.length ? mails() : null));
    await settle();
    assert.equal(mails().length, 1, 'one mail');
    assert.deepEqual(m.to, [admin.user.email, owner.user.email, 'sales@example.test'].sort());
  });

  test('a changed rule: who, which channels, off; kept in the data dir (0600), audited with before and after', async () => {
    const v = (await admin.get('/site/alerts')).json.version;
    const r = await admin.put('/site/alerts', { version: v, kinds: [{ kind: 'form.message', on: true, roles: ['owner'], userIds: [ed.user.id], extra: ['Leads@Example.test'], channels: ['email', 'slack', 'webhook'] }, { kind: 'schedule.late', on: false }] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.changed, ['form.message', 'schedule.late']);
    assert.notEqual(r.json.version, v);
    const form = r.json.kinds.find((k) => k.kind === 'form.message');
    assert.deepEqual([form.roles, form.users, form.extra], [['owner'], [{ id: ed.user.id, name: ed.user.email.split('@')[0] }], ['leads@example.test']]);
    const file = path.join(fx.data, 'alert-rules.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).kinds['form.message'].addresses, ['leads@example.test']);
    const audit = JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'site.alerts'").get().detail);
    assert.deepEqual(audit.changed.map((c) => [c.kind, c.from.on, c.to.on]), [['form.message', true, true], ['schedule.late', true, false]]);
    assert.deepEqual(audit.changed[0].to.roles, ['owner']);

    await fresh();
    assert.equal(tell('form.message'), 2);
    assert.deepEqual(notices('form.message'), [owner.user.id, ed.user.id].sort());
    const [m] = await until(() => (sink.messages.length ? mails() : null));
    // the editor reads it in the editor (their default), the owner by mail, and the listed address
    assert.deepEqual(m.to, [owner.user.email, 'leads@example.test'].sort());

    await fresh();
    assert.equal(tell('schedule.late'), 0, 'off: nobody, no mail');
    await settle();
    assert.equal(sink.messages.length, 0);
    // the same rules again: nothing changes, nothing audited
    const same = await admin.put('/site/alerts', { version: r.json.version, kinds: [{ kind: 'schedule.late', on: false }] });
    assert.deepEqual(same.json.changed, []);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'site.alerts'").get().n, 1);

    // without the email channel: still in the editor, no mail
    const noMail = await admin.put('/site/alerts', { version: same.json.version, kinds: [{ kind: 'form.message', channels: [] }] });
    assert.deepEqual(noMail.json.kinds.find((k) => k.kind === 'form.message').channels, []);
    await fresh();
    assert.equal(tell('form.message'), 2);
    await settle();
    assert.equal(sink.messages.length, 0);
    await admin.put('/site/alerts', { version: noMail.json.version, kinds: [{ kind: 'form.message', channels: ['email'] }] });
  });

  test('the sender name: mail comes from it; Send a test per channel; each channel shows how its last send went', async () => {
    const cur = (await admin.get('/site/alerts')).json;
    const r = await admin.put('/site/alerts', { version: cur.version, senderName: 'Example Co Site', kinds: [] });
    assert.deepEqual([r.status, r.json.changed, r.json.channels.email.senderName], [200, ['senderName'], 'Example Co Site']);
    assert.deepEqual(JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'site.alerts' ORDER BY id DESC").get().detail).senderName, { from: null, to: 'Example Co Site' });

    await fresh();
    assert.equal((await ed.post('/site/notify/test', { channel: 'email' })).status, 403);
    assert.equal((await admin.post('/site/notify/test', { channel: 'sms' })).status, 400);
    const slack = await admin.post('/site/notify/test', { channel: 'slack' });
    assert.deepEqual([slack.status, slack.json.error], [409, 'not-set-up']);
    const t = await admin.post('/site/notify/test', { channel: 'email' });
    assert.equal(t.status, 200, t.text);
    assert.deepEqual(t.json.channels.map((c) => [c.channel, c.ok]), [['email', true]]);
    const [m] = await until(() => (sink.messages.length ? mails() : null));
    assert.equal(m.headers.from, 'Example Co Site <sales@example.test>');
    assert.match(m.headers.subject, /^Markstage: A test alert from Markstage, sent by \S+ from Settings → Alerts\.$/);
    assert.ok(m.body.includes('/markstage/#/settings/alerts'));
    const email = (await admin.get('/site/alerts')).json.channels.email;
    assert.deepEqual([email.status, email.detail, email.lastAt], ['ok', t.json.channels[0].detail, new Date(clock.now).toISOString()]);
  });

  test('My alerts: the kinds that can reach me; on or off, now, digest or the editor only; safety ones locked; audited', async () => {
    const mine = (await ed.get('/me/alerts')).json;
    assert.equal(mine.digestHour, 8);
    const kinds = mine.kinds.map((k) => k.kind);
    for (const k of ['publish.failed', 'form.message', 'form.assigned', 'site.rollback', 'user.role', 'signin.new-device']) assert.ok(kinds.includes(k), k);
    for (const k of ['schedule.late', 'backup.failed', 'health.broken']) assert.ok(!kinds.includes(k), `${k}: off, or not for an editor`);
    assert.deepEqual(mine.kinds.find((k) => k.kind === 'form.message'), { kind: 'form.message', label: 'A new message from a site form', group: 'Forms', on: true, delivery: 'editor', locked: false });
    assert.deepEqual(mine.kinds.find((k) => k.kind === 'user.role'), { kind: 'user.role', label: "A user's role changed, or their account was turned off", group: 'People', on: true, delivery: 'now', locked: true });
    assert.equal((await admin.get('/me/alerts')).json.kinds.find((k) => k.kind === 'publish.failed').delivery, 'now');
    assert.deepEqual((await author.get('/me/alerts')).json.kinds.map((k) => k.kind), ['publish.failed', 'deploy.failed', 'user.role', 'env.promoted', 'env.promote-failed', 'signin.new-device'], 'an author: what is about them');

    assert.equal((await ed.put('/me/alerts', { kinds: { 'form.message': 'now' } })).status, 400);
    assert.match((await ed.put('/me/alerts', { kinds: [{ kind: 'signin.new-device', on: false }] })).json.message, /safety alert and can't be turned off/);
    assert.match((await ed.put('/me/alerts', { kinds: [{ kind: 'user.role', delivery: 'editor' }] })).json.message, /safety alert: it comes by email, at once or in the daily digest/);
    assert.equal((await ed.put('/me/alerts', { kinds: [{ kind: 'form.message', delivery: 'loud' }] })).status, 400);
    assert.equal((await ed.put('/me/alerts', { version: 'stale', kinds: [] })).status, 409);
    const r = await ed.put('/me/alerts', { version: mine.version, kinds: [{ kind: 'form.message', on: true, delivery: 'now' }, { kind: 'site.rollback', on: false, delivery: 'editor' }, { kind: 'signin.new-device', on: true, delivery: 'digest' }] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.changed, ['form.message', 'site.rollback', 'signin.new-device']);
    assert.notEqual(r.json.version, mine.version);
    assert.deepEqual(r.json.kinds.find((k) => k.kind === 'site.rollback'), { kind: 'site.rollback', label: 'The site was rolled back', group: 'Publishing', on: false, delivery: 'editor', locked: false });
    const audit = JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'me.alerts' ORDER BY id DESC").get().detail);
    assert.deepEqual(audit.changes[1], { kind: 'site.rollback', from: 'editor', to: 'off' });

    await fresh();
    tell('form.message');
    const [m] = await until(() => (sink.messages.length ? mails() : null));
    assert.ok(m.to.includes(ed.user.email), 'now by mail');
    await fresh();
    tell('site.rollback');
    assert.equal(notices('site.rollback').includes(ed.user.id), false, 'off: not even in the editor');
    assert.equal(notices('site.rollback').includes(ed2.user.id), true);
  });

  test('the daily digest: once a day at the digest hour, one mail with everything, then empty', async () => {
    await owner.put('/me/alerts', { kinds: [{ kind: 'publish.failed', on: true, delivery: 'digest' }] });
    await fresh();
    tell('publish.failed', []);
    srv.app.notices.tell({ kind: 'publish.failed', text: 'A publish (posts/hello-world) did not go live.', link: '#/jobs/j_1', to: [] });
    await settle();
    assert.ok(!mails().some((m) => m.to.includes(owner.user.email)), 'not now');
    assert.equal(notices('publish.failed').filter((u) => u === owner.user.id).length, 2, 'still in the editor');
    // the next day (the clock only moves on), before and after the digest hour (server time)
    clock.now = new Date(new Date(clock.now + 86_400_000).setHours(7, 0, 0, 0)).getTime();
    assert.equal(await srv.app.alertRules.sendDigests(), 0, 'before the hour');
    clock.now = new Date(new Date(clock.now).setHours(9, 0, 0, 0)).getTime();
    await fresh();
    assert.equal(await srv.app.alertRules.sendDigests(), 1);
    const [d] = mails();
    assert.deepEqual(d.to, [owner.user.email]);
    assert.equal(d.headers.subject, 'Markstage: your daily alerts (2)');
    assert.equal(d.headers.from, 'Example Co Site <sales@example.test>');
    assert.match(d.body, /^Your alerts since the last digest \(2\):\n\n- A publish\.failed happened\.\n {2}http:\/\/127\.0\.0\.1:\d+\/markstage\/#\/x\n/);
    assert.ok(d.body.includes('- A publish (posts/hello-world) did not go live.'));
    assert.ok(d.body.includes('/markstage/#/my-alerts'));
    assert.equal(await srv.app.alertRules.sendDigests(), 0, 'once a day');
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM alert_digest').get().n, 0);
    // a day passed: sign in again (the same browsers, so no new-device alerts)
    for (const c of [owner, admin, ed, ed2, author]) await c.login(c.user.email, c.user.password);
    assert.deepEqual(notices('signin.new-device'), []);
  });

  test('safety: an invite and a role change reach the administrators and the person, whatever they chose', async () => {
    await admin.put('/me/alerts', { kinds: [{ kind: 'user.invited', on: true, delivery: 'now' }] });
    await fresh();
    const inv = await admin.post('/users', { email: 'new-person@example.test', name: 'New Person', role: 'author' });
    assert.equal(inv.status, 201, inv.text);
    assert.deepEqual(notices('user.invited'), [owner.user.id, admin.user.id].sort());
    const n = srv.app.db.prepare("SELECT text, link FROM notices WHERE kind = 'user.invited'").get();
    assert.equal(n.text, `${admin.user.email.split('@')[0]} invited New Person (new-person@example.test) as author.`);
    assert.equal(n.link, `#/users/${inv.json.user.id}`);

    await fresh();
    assert.equal((await admin.patch(`/users/${author.user.id}`, { role: 'editor' })).status, 200);
    assert.deepEqual(notices('user.role'), [owner.user.id, admin.user.id, author.user.id].sort(), 'the person too');
    assert.match(srv.app.db.prepare("SELECT text FROM notices WHERE kind = 'user.role'").get().text, /changed author-\w+'s role from author to editor\.$/);
    const [m] = await until(() => (sink.messages.length ? mails() : null));
    assert.ok(m.to.includes(author.user.email), 'by mail to the person');
    await fresh();
    assert.equal((await admin.patch(`/users/${author.user.id}`, { name: 'Same Role' })).status, 200);
    assert.deepEqual(notices('user.role'), [], 'no change of role, no alert');
  });

  test('safety: a sign-in from a new device tells the person (not their first device, not a known one)', async () => {
    const u = await addUser(srv.app, { email: 'traveller@example.test', role: 'editor' });
    await fresh();
    const home = client(srv.base);
    await home.login(u.email, u.password);
    assert.deepEqual(notices('signin.new-device'), [], 'the first device is the account being set up');
    await home.post('/auth/logout', {});
    await home.login(u.email, u.password);
    assert.deepEqual(notices('signin.new-device'), [], 'a known device');
    const away = client(srv.base);
    const signed = await away.post('/auth/login', { email: u.email, password: u.password }, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' } });
    assert.equal(signed.status, 200, signed.text);
    assert.deepEqual(notices('signin.new-device'), [u.id]);
    const text = srv.app.db.prepare("SELECT text FROM notices WHERE kind = 'signin.new-device'").get().text;
    // the time is ISO: the editor shows it in the reader's own zone (QA pass 2, N13)
    // the test clock, not a fixed date: the digest steps above move it by the machine's own zone (setHours)
    const at = new Date(clock.now).toISOString().replace(/\.\d{3}Z$/, 'Z');
    assert.equal(text, `traveller signed in from a new device: Safari on macOS at 127.0.0.1, ${at}. If it wasn't you, change your password and sign out your other sessions.`);
    const [m] = await until(() => (sink.messages.length ? mails() : null));
    assert.deepEqual(m.to, ['traveller@example.test'], 'theirs only: not the shared address');
    assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'), 'Safari on macOS');
    assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'), 'Edge on Windows');
    assert.equal(deviceName(''), 'a browser');
  });
});
