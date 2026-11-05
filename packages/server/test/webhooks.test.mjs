// Webhooks (docs/API-WEBHOOKS.md): named addresses told of the events they listen to, each POST signed (HMAC-SHA256),
// tried again with backoff and logged; the secret shown once, never in an answer or the log; the address through the
// SSRF guard. Against a receiver on loopback reached through the test seam only. Test people are made up here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';
import { startWebSite } from './web-site.mjs';

/** A receiver: each POST kept (headers and body); it answers `reply.status` with `reply.body`. */
async function receiver() {
  const got = [];
  const reply = { status: 200, body: 'ok' };
  const site = await startWebSite({
    '/hook': async (req) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      got.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), method: req.method });
      return { status: reply.status, type: 'text/plain', body: typeof reply.body === 'function' ? reply.body() : reply.body };
    },
    '/moved': { status: 307, headers: { Location: '/hook' }, body: '' },
  });
  return { site, got, reply };
}

const verify = (secret, header, body) => {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  return crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex') === v1;
};

describe('webhooks', () => {
  let fx, srv, clock, rx, owner, ed, hook, secret;
  const planted = `planted-${crypto.randomBytes(8).toString('hex')}`;
  const deliveries = async (q = '') => (await owner.get(`/webhooks/${hook.id}/deliveries${q}`)).json;

  before(async () => {
    // a server secret by name, to show an answer that echoes it is kept scrubbed
    process.env.MARKSTAGE_HOOKTEST_TOKEN = planted;
    rx = await receiver();
    fx = makeFixture({ checks: false });
    clock = { now: Date.parse('2026-10-29T09:00:00.000Z') };
    srv = await startServer(fx, { outbound: rx.site.outbound, clock });
    owner = await as(srv, 'owner');
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
  });
  after(async () => {
    delete process.env.MARKSTAGE_HOOKTEST_TOKEN;
    await srv?.close();
    await rx?.site.close();
  });

  test('made by an owner: the secret once, never again; the address shown without its query values', async () => {
    assert.equal((await ed.get('/webhooks')).status, 403);
    const r = await owner.post('/webhooks', { name: 'Search index', url: `${rx.site.base}/hook?token=abc123`, events: ['entry.saved', 'entry.published', 'site.live'] });
    assert.equal(r.status, 201, r.text);
    ({ secret } = r.json);
    hook = r.json.webhook;
    assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
    assert.equal(hook.url, `${rx.site.base}/hook?token=[hidden]`);
    const list = await owner.get('/webhooks');
    assert.deepEqual(list.json.items.map((h) => h.id), [hook.id]);
    assert.ok(list.json.events.includes('site.live'));
    for (const t of [list.text, JSON.stringify(srv.app.db.prepare('SELECT * FROM audit').all())]) {
      assert.ok(!t.includes(secret));
      assert.ok(!t.includes('abc123'));
    }
  });

  test('an event: a signed POST naming what changed, never its text or an email', async () => {
    const e = (await ed.get('/collections/posts/entries/hello-world')).json;
    const s = await ed.put('/collections/posts/entries/hello-world', { version: e.version, frontmatter: { excerpt: 'Changed for the hook.' } });
    assert.equal(s.status, 200, s.text);
    await srv.app.webhooks.tick();
    const hit = rx.got.at(-1);
    assert.equal(hit.method, 'POST');
    assert.equal(hit.headers['markstage-event'], 'entry.saved');
    assert.equal(hit.headers['content-type'], 'application/json');
    assert.ok(verify(secret, hit.headers['markstage-signature'], hit.body));
    assert.ok(!verify('whsec_wrong', hit.headers['markstage-signature'], hit.body));
    const body = JSON.parse(hit.body);
    assert.equal(body.event, 'entry.saved');
    assert.equal(body.id, hit.headers['markstage-delivery']);
    assert.deepEqual(body.entry, { collection: 'posts', id: 'hello-world', url: '/blog/hello-world/' });
    assert.deepEqual(body.actor, { id: ed.user.id, name: ed.user.email.split('@')[0] });
    assert.match(body.commit, /^[0-9a-f]{40}$/);
    assert.ok(!hit.body.includes('@example.test'));
    assert.ok(!hit.body.includes('Changed for the hook'));
    const d = (await deliveries()).items[0];
    assert.deepEqual([d.event, d.status, d.attempts, d.answer], ['entry.saved', 'delivered', 1, 200]);
  });

  test('publish: entry.published, then site.live when the deploy is done', async () => {
    const n = rx.got.length;
    const e = (await ed.get('/collections/posts/entries/bob-draft')).json;
    const p = await ed.post('/collections/posts/entries/bob-draft/publish', { version: e.version });
    assert.ok([200, 202].includes(p.status), p.text);
    await srv.app.jobs.idle();
    await srv.app.webhooks.tick();
    const events = rx.got.slice(n).map((g) => g.headers['markstage-event']);
    assert.deepEqual(events, ['entry.published', 'site.live']);
    assert.equal(JSON.parse(rx.got.at(-1).body).job.kind, 'publish');
  });

  test('fencing: when another server process takes the sending over (this one was paused), this one stops before its next send', async () => {
    const lease = () => srv.app.db.prepare("SELECT owner FROM leases WHERE name = 'webhooks.send'").get()?.owner ?? null;
    const db = srv.app.db;
    const c = srv.app.cluster;
    const n = rx.got.length;
    // another live process sends for now: the two tests queue, unsent
    db.prepare('INSERT INTO server_processes (id, pid, host, kind, port, started_at, seen_at, machine, pid_start) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('p_elsewhere', process.pid, c.host, 'serve', 1, Date.now(), Date.now(), c.machine, c.pidStart);
    db.prepare("INSERT INTO leases (name, owner, what, since, expires_at) VALUES ('webhooks.send', 'p_elsewhere', 'webhooks', ?, ?)").run(Date.now(), Date.now() + 60_000);
    for (let i = 0; i < 2; i++) assert.equal((await owner.post(`/webhooks/${hook.id}/test`, {})).status, 202);
    await srv.app.webhooks.tick();
    assert.equal(rx.got.length, n, 'nothing sent while the other holds it');
    db.prepare("DELETE FROM leases WHERE name = 'webhooks.send'").run();
    // this one sends; during its first send, the other takes the lease back (as when it found this one stopped)
    rx.reply.body = () => {
      srv.app.db.prepare("UPDATE leases SET owner = 'p_elsewhere' WHERE name = 'webhooks.send'").run();
      return 'ok';
    };
    try {
      await srv.app.webhooks.tick();
    } finally {
      rx.reply.body = 'ok';
    }
    assert.equal(rx.got.length - n, 1, 'one send, then it stopped');
    assert.equal(lease(), 'p_elsewhere', 'the other process’s lease is left alone');
    assert.equal((await deliveries('?status=pending')).items.length, 1, 'the second is still due, for the holder to send');
    // the other process ends; this one sends what is left
    db.prepare("DELETE FROM leases WHERE name = 'webhooks.send'").run();
    db.prepare("DELETE FROM server_processes WHERE id = 'p_elsewhere'").run();
    await srv.app.webhooks.tick();
    assert.equal(rx.got.length - n, 2);
    assert.equal((await deliveries('?status=pending')).items.length, 0);
  });

  test('a failing address: tried again after 1, 5, 30, 120 and 360 minutes, then given up, and the admins told', async () => {
    rx.reply.status = 500;
    rx.reply.body = () => `oops ${planted} ${secret}`;
    const n = rx.got.length;
    const t = await owner.post(`/webhooks/${hook.id}/test`, {});
    assert.equal(t.status, 202);
    await srv.app.webhooks.tick();
    let d = (await deliveries('?status=pending')).items[0];
    assert.deepEqual([d.event, d.attempts, d.answer], ['ping', 1, 500]);
    assert.equal(Date.parse(d.nextAt) - clock.now, 60_000);
    // the answer is kept scrubbed: the server's secret and the hook's own
    assert.equal(d.answerText, 'oops [hidden] [hidden]');
    for (const minutes of [1, 5, 30, 120, 360]) {
      clock.now += minutes * 60_000;
      await srv.app.webhooks.tick();
    }
    // nine hours on: a session is signed in again
    for (const who of [owner, ed]) await who.login(who.user.email, who.user.password);
    assert.equal(rx.got.length - n, 6);
    d = (await deliveries()).items.find((x) => x.id === t.json.delivery.id);
    assert.deepEqual([d.status, d.attempts, d.nextAt], ['gave-up', 6, null]);
    const notice = srv.app.db.prepare("SELECT * FROM notices WHERE kind = 'webhook.failed'").all();
    assert.equal(notice.length >= 1, true);
    assert.ok(!JSON.stringify(notice).includes(planted));
    // a person tries it once more by hand: taken now
    rx.reply.status = 204;
    rx.reply.body = '';
    const r = await owner.post(`/webhooks/${hook.id}/deliveries/${d.id}/retry`, {});
    assert.equal(r.status, 202);
    await srv.app.webhooks.tick();
    d = (await deliveries()).items.find((x) => x.id === d.id);
    assert.equal(d.status, 'delivered');
    assert.equal((await owner.post(`/webhooks/${hook.id}/deliveries/${d.id}/retry`, {})).status, 409);
  });

  test('a new secret signs from now on; the old one no longer verifies', async () => {
    const r = await owner.post(`/webhooks/${hook.id}/secret`, {});
    const fresh = r.json.secret;
    assert.notEqual(fresh, secret);
    await owner.post(`/webhooks/${hook.id}/test`, {});
    await srv.app.webhooks.tick();
    const hit = rx.got.at(-1);
    assert.ok(verify(fresh, hit.headers['markstage-signature'], hit.body));
    assert.ok(!verify(secret, hit.headers['markstage-signature'], hit.body));
  });

  test('a move names where the entry is now and where it was; an upload names the file', async () => {
    rx.reply.status = 200;
    await owner.patch(`/webhooks/${hook.id}`, { events: ['entry.moved', 'media.added'] });
    const n = rx.got.length;
    const e = (await ed.get('/collections/posts/entries/hello-world')).json;
    assert.equal((await ed.post('/collections/posts/entries/hello-world/move', { version: e.version, newId: 'hello-there' })).status, 202);
    await srv.app.jobs.idle();
    const up = await ed.request('POST', '/media?filename=truck.png', { body: makePng(), headers: { 'Content-Type': 'image/png' } });
    assert.equal(up.status, 201, up.text);
    await srv.app.webhooks.tick();
    const [moved, added] = rx.got.slice(n).map((g) => JSON.parse(g.body));
    assert.deepEqual([moved.event, moved.entry.id, moved.entry.url, moved.from], ['entry.moved', 'hello-there', '/blog/hello-there/', { collection: 'posts', id: 'hello-world' }]);
    assert.deepEqual([added.event, added.media], ['media.added', { id: up.json.id, paths: [up.json.path] }]);
    const back = (await ed.get('/collections/posts/entries/hello-there')).json;
    await ed.post('/collections/posts/entries/hello-there/move', { version: back.version, newId: 'hello-world' });
    await srv.app.jobs.idle();
    await srv.app.webhooks.tick();
  });

  test('only the events it listens to; off is off; removed is removed', async () => {
    const n = rx.got.length;
    await owner.patch(`/webhooks/${hook.id}`, { events: ['entry.deleted'] });
    const e = (await ed.get('/collections/posts/entries/hello-world')).json;
    await ed.put('/collections/posts/entries/hello-world', { version: e.version, frontmatter: { excerpt: 'Again.' } });
    await srv.app.webhooks.tick();
    assert.equal(rx.got.length, n);
    await owner.patch(`/webhooks/${hook.id}`, { events: ['entry.saved'], active: false });
    const e2 = (await ed.get('/collections/posts/entries/hello-world')).json;
    await ed.put('/collections/posts/entries/hello-world', { version: e2.version, frontmatter: { excerpt: 'Off.' } });
    await srv.app.webhooks.tick();
    assert.equal(rx.got.length, n);
    assert.equal((await owner.del(`/webhooks/${hook.id}`)).status, 200);
    assert.equal((await owner.get(`/webhooks/${hook.id}/deliveries`)).status, 404);
  });

  test('a redirect is not followed: the event goes to the address given or nowhere', async () => {
    const r = await owner.post('/webhooks', { name: 'Moved', url: `${rx.site.base}/moved`, events: ['entry.saved'] });
    assert.equal(r.status, 201, r.text);
    const n = rx.got.length;
    const t = await owner.post(`/webhooks/${r.json.webhook.id}/test`, {});
    await srv.app.webhooks.tick();
    const d = (await owner.get(`/webhooks/${r.json.webhook.id}/deliveries`)).json.items.find((x) => x.id === t.json.delivery.id);
    assert.deepEqual([d.status, d.answer], ['pending', 307]);
    assert.equal(rx.got.length, n);
    await owner.del(`/webhooks/${r.json.webhook.id}`);
  });

  test('the address is checked: private and metadata addresses, a sign-in, unknown events', async () => {
    for (const [body, field] of [
      [{ name: 'x', url: 'http://169.254.169.254/latest', events: ['entry.saved'] }, 'url'],
      [{ name: 'x', url: 'http://10.0.0.5/hook', events: ['entry.saved'] }, 'url'],
      [{ name: 'x', url: 'https://user:pass@example.com/hook', events: ['entry.saved'] }, 'url'],
      [{ name: 'x', url: 'ftp://example.com/hook', events: ['entry.saved'] }, 'url'],
      [{ name: 'x', url: 'https://example.com/hook', events: ['entry.eaten'] }, 'events'],
      [{ name: '', url: 'https://example.com/hook', events: ['entry.saved'] }, 'name'],
    ]) {
      const r = await owner.post('/webhooks', body);
      assert.deepEqual([r.status, r.json.field], [422, field], body.url);
    }
  });
});

describe('webhooks without the test seam', () => {
  let srv, owner;
  before(async () => {
    srv = await startServer(makeFixture({ checks: false }));
    owner = await as(srv, 'owner');
  });
  after(() => srv?.close());

  test('https only', async () => {
    const r = await owner.post('/webhooks', { name: 'Plain', url: 'http://example.com/hook', events: ['entry.saved'] });
    assert.deepEqual([r.status, r.json.field], [422, 'url']);
    assert.match(r.json.message, /https/);
    const p80 = await owner.post('/webhooks', { name: 'Port', url: 'https://example.com:80/hook', events: ['entry.saved'] });
    assert.deepEqual([p80.status, p80.json.field], [422, 'url']);
  });
});

describe('webhooks outside production', () => {
  for (const [keep, sent] of [[[], false], [['webhooks'], true]]) {
    test(`staging with keep ${JSON.stringify(keep)}: ${sent ? 'sent' : 'held, never sent'}`, async () => {
      const rx = await receiver();
      const srv = await startServer(makeFixture({ checks: false }), { outbound: rx.site.outbound, overrides: { environment: { name: 'staging', branch: 'main', gate: false, keep } } });
      try {
        const owner = await as(srv, 'owner');
        const h = await owner.post('/webhooks', { name: 'Search index', url: `${rx.site.base}/hook`, events: ['entry.saved'] });
        const t = await owner.post(`/webhooks/${h.json.webhook.id}/test`, {});
        await srv.app.webhooks.tick();
        const d = (await owner.get(`/webhooks/${h.json.webhook.id}/deliveries`)).json.items.find((x) => x.id === t.json.delivery.id);
        assert.equal(d.status, sent ? 'delivered' : 'held');
        assert.equal(rx.got.length, sent ? 1 : 0);
        if (!sent) assert.match(d.error, /staging.*production only/);
      } finally {
        await srv.close();
        await rx.site.close();
      }
    });
  }
});
