// Alerts out of the editor (docs/DEPLOY.md "Alerts"): a failed publish sends one mail (over STARTTLS, signed in)
// naming the entry, the error and the job's link, to the listed addresses and the owner and administrators; Slack and
// the webhook hear it too. "Send a test alert" reports each channel. A relay without STARTTLS gets nothing in plain
// text. Secrets come from the environment or files, never config.json. The SMTP server is a local sink.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { compose } from '../src/notify/smtp.mjs';
import { as, freePort, makeFixture, startServer } from './helpers.mjs';
import { readMessage, smtpSink, testCertificate } from './smtp-sink.mjs';

describe('alerts by email, Slack and webhook', () => {
  let fx, srv, sink, hooks, cert, admin, editor;
  const heard = [];
  let slackAnswer = 200;
  const account = { user: 'alerts@example.test', pass: `t-${crypto.randomBytes(12).toString('base64url')}` };

  before(async () => {
    fx = makeFixture();
    cert = testCertificate(fx.run);
    sink = await smtpSink({ tlsOptions: cert, account });
    const port = await freePort();
    hooks = http.createServer((req, res) => {
      let t = '';
      req.on('data', (d) => (t += d));
      req.on('end', () => {
        heard.push({ path: req.url, body: JSON.parse(t) });
        res.writeHead(req.url === '/slack' ? slackAnswer : 200).end('ok');
      });
    });
    await new Promise((r) => hooks.listen(port, '127.0.0.1', r));
    fs.writeFileSync(path.join(fx.run, 'ca.pem'), cert.cert);
    fs.writeFileSync(path.join(fx.run, 'slack.url'), `http://127.0.0.1:${port}/slack\n`);
    srv = await startServer(fx, {
      env: { MARKSTAGE_SMTP_USER: account.user, MARKSTAGE_SMTP_PASSWORD: account.pass },
      overrides: {
        notify: {
          email: { host: '127.0.0.1', port: sink.port, security: 'starttls', from: 'Markstage <cms@example.test>', to: ['ops@example.test'], roles: ['owner', 'administrator'], caFile: path.join(fx.run, 'ca.pem') },
          slack: { webhookFile: path.join(fx.run, 'slack.url') },
          webhook: { url: `http://127.0.0.1:${port}/hook` },
        },
      },
    });
    admin = await as(srv, 'administrator');
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(async () => {
    await srv.close();
    await sink.close();
    await new Promise((r) => hooks.close(r));
  });

  const until = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error('timed out waiting');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  test('a failed publish: one mail over STARTTLS with the entry, the error and the job link; Slack and the webhook too', async () => {
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    let job;
    try {
      const e = await editor.get('/collections/posts/entries/hello-world');
      const r = await editor.post('/collections/posts/entries/hello-world/publish', { version: e.json.version });
      assert.equal(r.status, 202, r.text);
      job = r.json.job;
      await srv.app.jobs.idle();
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
    }
    await until(() => sink.messages.length >= 1 && heard.length >= 2);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(sink.messages.length, 1, 'exactly one mail');
    const m = sink.messages[0];
    assert.equal(m.tls, true, 'sent only after STARTTLS');
    assert.equal(m.user, account.user, 'signed in');
    assert.equal(m.from, 'cms@example.test');
    assert.deepEqual(m.to.sort(), ['ops@example.test', admin.user.email.toLowerCase()].sort(), 'the listed address and the administrator (not the editor)');
    const { headers, body } = readMessage(m.data);
    assert.equal(headers.subject, 'Markstage: A publish (posts/hello-world) did not go live.', 'no site name: Markstage');
    assert.match(body, /Sent by Markstage at http/);
    assert.match(headers.from, /^Markstage <cms@example\.test>$/);
    assert.match(body, /posts\/hello-world/);
    assert.match(body, /The build step failed/);
    assert.match(body, new RegExp(`Open it in Markstage: ${srv.base.replace(/[.]/g, '\\.')}/markstage/#/jobs/${job}`));
    assert.doesNotMatch(m.data, new RegExp(account.pass), 'the password is never in the mail');
    assert.deepEqual(heard.map((h) => h.path).sort(), ['/hook', '/slack']);
    assert.match(heard.find((h) => h.path === '/slack').body.text, /<http:\/\/127\.0\.0\.1:\d+\/markstage\/#\/jobs\/j_[^|]+\|Open in Markstage>$/);
  });

  test('send a test alert: administrators only; each channel says what it answered; audited', async () => {
    assert.equal((await editor.post('/site/notify/test', {})).status, 403);
    slackAnswer = 500;
    const before = sink.messages.length;
    const r = await admin.post('/site/notify/test', {});
    slackAnswer = 200;
    assert.equal(r.status, 200, r.text);
    const by = Object.fromEntries(r.json.channels.map((c) => [c.channel, c]));
    assert.equal(by.email.ok, true, by.email.detail);
    assert.match(by.email.detail, /^sent to /);
    assert.deepEqual([by.slack.ok, by.slack.detail], [false, 'answered 500']);
    assert.equal(by.webhook.ok, true);
    assert.equal(sink.messages.length, before + 1);
    assert.match(readMessage(sink.messages.at(-1).data).body, /A test alert from Markstage, sent by administrator-/);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'notify.test'").get().n, 1);
    assert.deepEqual((await admin.get('/site/health')).json.alerts, { email: true, slack: true, webhook: true });
  });
});

test('a relay without STARTTLS gets nothing in plain text; a wrong password is said plainly', async () => {
  const fx = makeFixture({ checks: false });
  const plain = await smtpSink({ account: { user: 'u@example.test', pass: 'right-one' } });
  const pass = `t-${crypto.randomBytes(9).toString('base64url')}`;
  const srv = await startServer(fx, { env: { MARKSTAGE_SMTP_USER: 'u@example.test', MARKSTAGE_SMTP_PASSWORD: pass }, overrides: { notify: { email: { host: '127.0.0.1', port: plain.port, from: 'cms@example.test', to: ['ops@example.test'] } } } });
  try {
    const admin = await as(srv, 'administrator');
    const r = (await admin.post('/site/notify/test', {})).json.channels[0];
    assert.equal(r.ok, false);
    assert.match(r.detail, /does not offer STARTTLS, so nothing was sent/);
    assert.deepEqual(plain.sessions.flatMap((s) => s.commands).filter((c) => ['AUTH', 'MAIL', 'DATA'].includes(c)), [], 'no password and no mail in plain text');
  } finally {
    await srv.close();
  }
  // security "none" (a relay on this machine, development only): the relay refuses the password
  const srv2 = await startServer(fx, { env: { MARKSTAGE_SMTP_USER: 'u@example.test', MARKSTAGE_SMTP_PASSWORD: 'wrong-one' }, overrides: { notify: { email: { host: '127.0.0.1', port: plain.port, security: 'none', from: 'cms@example.test', to: ['ops@example.test'] } } } });
  try {
    const admin = await as(srv2, 'administrator');
    const r = (await admin.post('/site/notify/test', {})).json.channels[0];
    assert.equal(r.ok, false);
    assert.match(r.detail, /refused the user name and password: 535/);
    assert.doesNotMatch(r.detail, /wrong-one/);
  } finally {
    await srv2.close();
    await plain.close();
  }
});

test('config: secrets from the environment or files only; https and TLS; plain words for each mistake', () => {
  const fx = makeFixture({ checks: false });
  const env = { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
  const mail = { host: 'smtp.example.com', from: 'cms@example.com', to: ['ops@example.com'] };
  const load = (notify, extra = {}) => loadConfig({ env: { ...env, ...extra }, overrides: { notify } });
  assert.throws(() => load({ email: { ...mail, password: 'x' } }), /MARKSTAGE_SMTP_PASSWORD or a file/);
  assert.throws(() => load({ email: { ...mail, security: 'none' } }), /only for a relay on this machine/);
  assert.throws(() => load({ email: { ...mail, from: 'not an address' } }), /notify\.email\.from must be an address/);
  assert.throws(() => load({ email: { ...mail, to: ['ops@example.com\r\nBcc: x@y.z'] } }), /notify\.email\.to must be a list of addresses/);
  assert.throws(() => load({ email: { ...mail, roles: ['boss'] } }), /roles must be a list of roles/);
  assert.throws(() => load({ email: mail }, { MARKSTAGE_SMTP_PASSWORD: 'p' }), /no user/);
  assert.throws(() => load({ slack: { webhookFile: 'relative.url' } }), /absolute path/);
  assert.throws(() => load({ slack: { webhookFile: path.join(fx.site, 'slack.url') } }), /outside the site repo/);
  assert.throws(() => load({ webhook: { url: 'http://hooks.example/x' } }), /must be https/);
  assert.throws(() => load({ sms: {} }), /unknown \(email, slack, webhook, digestHour\)/);
  const c = load({ email: { ...mail, port: 465 } }, { MARKSTAGE_SMTP_USER: 'u', MARKSTAGE_SMTP_PASSWORD: 'secret-pass', MARKSTAGE_SLACK_WEBHOOK: 'https://hooks.slack.com/services/T/B/X' });
  assert.equal(c.notify.email.security, 'tls', 'port 465 is implicit TLS');
  assert.equal(c.notify.email.auth.pass, 'secret-pass');
  assert.doesNotMatch(JSON.stringify(c), /secret-pass/, 'the password never shows in the config as JSON');
  assert.equal(c.notify.slack, 'https://hooks.slack.com/services/T/B/X');
  assert.deepEqual(load({ email: { host: 'smtp.example.com', from: 'cms@example.com' } }).notify.email.roles, ['owner', 'administrator'], 'no addresses: the owner and administrators');
});

test('the message: line breaks never reach a header; the body cannot end the DATA early', () => {
  const m = compose({ from: 'Märk <cms@example.com>', to: ['a@example.com'], subject: 'Bad\r\nBcc: x@evil.example', text: 'line\n.\nmore' });
  assert.match(m, /^Subject: Bad Bcc: x@evil\.example\r$/m);
  assert.doesNotMatch(m, /^Bcc:/m);
  assert.match(m, /^From: =\?UTF-8\?B\?[^?]+\?= <cms@example\.com>\r$/m);
  assert.equal(m.split('\r\n').filter((l) => l === '.').length, 1, 'only the end of DATA is a lone dot');
});

// the owner reads these as the site's alerts: named for the site, with Markstage only as the editor's name
describe('alert mail is named for the site', () => {
  let fx, srv, sink;
  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), `export default {\n  siteName: 'Example Co',\n  collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' }],\n};\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A site with a name');
    sink = await smtpSink();
    srv = await startServer(fx, { overrides: { collections: [], notify: { email: { host: '127.0.0.1', port: sink.port, security: 'none', from: 'Markstage <cms@example.test>', to: ['ops@example.test'] } } } });
  });
  after(async () => {
    await srv.close();
    await sink.close();
  });

  test('subject "<siteName>: …", footer "Sent by the <siteName> editor (Markstage)"; without a name it stays Markstage', async () => {
    const admin = await as(srv, 'administrator');
    const r = await admin.post('/site/notify/test', {});
    assert.equal(r.status, 200, r.text);
    const { headers, body } = readMessage(sink.messages.at(-1).data);
    assert.match(headers.subject, /^Example Co: A test alert from Markstage/);
    assert.match(body, /Sent by the Example Co editor \(Markstage\) at http/);
  });
});
