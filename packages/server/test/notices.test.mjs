// Notices (docs/OPERATIONS.md): a failed publish is told to who started it, until they mark it seen; the scheduler
// holds an entry the publish rules stop (still scheduled, editors told; live on the next run once fixed, or published
// anyway by an editor) and says when it ran late because the
// server was down; a job cut by a restart is told too. Each notice also goes to the webhook and Slack hooks
// (loopback doubles here).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { as, freePort, makeFixture, startServer } from './helpers.mjs';

const finish = async (srv) => srv.app.jobs.idle();

describe('notices', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  let hook;
  const heard = [];
  const clock = { now: Date.now() };

  before(async () => {
    const port = await freePort();
    hook = http.createServer((req, res) => {
      let t = '';
      req.on('data', (d) => (t += d));
      req.on('end', () => {
        heard.push({ path: req.url, body: JSON.parse(t) });
        res.writeHead(200).end('ok');
      });
    });
    await new Promise((r) => hook.listen(port, '127.0.0.1', r));
    fx = makeFixture();
    srv = await startServer(fx, { clock, overrides: { notify: { webhook: `http://127.0.0.1:${port}/hook`, slack: `http://127.0.0.1:${port}/slack` } } });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(async () => {
    await srv.close();
    await new Promise((r) => hook.close(r));
  });

  test('new-device sign-ins: one line however many, with how many more; Seen on it clears them all (QA F27)', async () => {
    const uid = (await alice.get('/auth/me')).json.user.id;
    for (let i = 1; i <= 3; i++) srv.app.notices.tell({ kind: 'signin.new-device', level: 'warn', text: `Alice signed in from a new device: browser ${i}.`, link: '#/account', to: [uid] });
    const items = (await alice.get('/notices')).json.items.filter((n) => n.kind === 'signin.new-device');
    assert.equal(items.length, 1, 'one line for the three');
    assert.equal(items[0].count, 3);
    // the grouped line's time is ISO: the editor shows it in the reader's own zone (QA N13)
    assert.match(items[0].text, /browser 3\. \(3 new devices since \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ; Seen clears them all\.\)$/);
    assert.equal((await alice.post(`/notices/${items[0].id}/seen`, {})).json.seen, 3);
    assert.equal((await alice.get('/notices')).json.items.filter((n) => n.kind === 'signin.new-device').length, 0);
    // the safety alerts went to the hooks too (a moment later); the next test reads the hooks from its own publish
    await new Promise((res) => setTimeout(res, 200));
    heard.length = 0;
  });

  test('a failed publish: told to who started it, until seen; the hooks hear it with the link', async () => {
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      const e = await alice.get('/collections/posts/entries/hello-world');
      const r = await alice.post('/collections/posts/entries/hello-world/publish', { version: e.json.version });
      assert.equal(r.status, 202, r.text);
      await finish(srv);
      const mine = (await alice.get('/notices')).json.items;
      assert.equal(mine.length, 1);
      assert.equal(mine[0].kind, 'publish.failed');
      assert.equal(mine[0].level, 'error');
      assert.match(mine[0].text, /^A publish \(posts\/hello-world\) did not go live\. The build step failed/);
      assert.equal(mine[0].link, `#/jobs/${r.json.job}`);
      assert.equal((await editor.get('/notices')).json.items.length, 0, 'only who started it');
      await new Promise((res) => setTimeout(res, 100));
      const wh = heard.find((h) => h.path === '/hook');
      assert.equal(wh.body.kind, 'publish.failed');
      assert.match(wh.body.url, new RegExp(`/markstage/#/jobs/${r.json.job}$`));
      assert.match(heard.find((h) => h.path === '/slack').body.text, /did not go live.*<http.*\|Open in Markstage>/);
      // seen: gone from the list; someone else's notice cannot be marked
      assert.equal((await editor.post(`/notices/${mine[0].id}/seen`, {})).status, 404);
      assert.equal((await alice.post(`/notices/${mine[0].id}/seen`, {})).status, 200);
      assert.equal((await alice.get('/notices')).json.items.length, 0);
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
    }
  });

  const entry = async (id) => (await editor.get(`/collections/posts/entries/${id}`)).json;
  /** Schedule carol-draft, then add an image without a description (the publish rules stop it), then let it fall due. */
  const holdCarol = async () => {
    const s = await editor.get('/collections/posts/entries/carol-draft/source');
    const sched = await editor.post('/collections/posts/entries/carol-draft/schedule', { version: s.json.version, publishAt: new Date(clock.now + 3_600_000).toISOString() });
    assert.equal(sched.status, 200, sched.text);
    const s2 = await editor.get('/collections/posts/entries/carol-draft/source');
    assert.equal((await editor.put('/collections/posts/entries/carol-draft/source', { version: s2.json.version, source: `${s2.json.source.trimEnd()}\n\n<p><img src="/uploads/z.png"></p>\n` })).status, 200);
    clock.now += 3_600_001;
    const jid = srv.app.scheduler.tick(clock.now);
    assert.ok(jid);
    await finish(srv);
    return (await editor.get(`/jobs/${jid}`)).json;
  };
  const fixCarol = async () => {
    const s = await editor.get('/collections/posts/entries/carol-draft/source');
    assert.equal((await editor.put('/collections/posts/entries/carol-draft/source', { version: s.json.version, source: s.json.source.replaceAll('<img src="/uploads/z.png">', '<img src="/uploads/z.png" alt="Z">') })).status, 200);
  };

  test('scheduled, then edited so the publish rules stop it: held, still scheduled, editors told, nothing built', async () => {
    const job = await holdCarol();
    assert.equal(job.status, 'succeeded', job.log);
    assert.deepEqual(job.steps.map((x) => x.name), ['due'], 'nothing left to build');
    assert.match(job.log, /held, still scheduled \(1 image without a description\)/);
    const e = await entry('carol-draft');
    assert.equal(e.status, 'scheduled', 'not reverted to a draft');
    assert.deepEqual(e.held.reasons, ['1 image without a description']);
    assert.ok(e.publishAt, 'its time is kept');
    const listed = (await editor.get('/collections/posts/entries?status=scheduled')).json.items.find((x) => x.id === 'carol-draft');
    assert.ok(listed?.held, 'lists say it is held too');
    assert.match(fs.readFileSync(`${fx.site}/src/content/blog/carol-draft.md`, 'utf8'), /^draft: true$/m, 'a draft for the site build, so no other build puts it live');
    const n = (await editor.get('/notices')).json.items.find((x) => x.kind === 'schedule.held');
    assert.equal(n.level, 'warn');
    assert.equal(n.link, '#/publish/posts/carol-draft');
    assert.match(n.text, /but is held: 1 image without a description\. It stays scheduled and goes live on the next run once that is fixed/);
    assert.equal((await alice.get('/notices')).json.items.filter((x) => x.kind === 'schedule.held').length, 0, 'authors are not editors');
    await new Promise((res) => setTimeout(res, 100));
    assert.ok(heard.some((h) => h.path === '/hook' && h.body.kind === 'schedule.held'), 'the alert went out');
    assert.match(fx.git('log', '-1', '--format=%an|%s').trim(), /Markstage scheduler\|Hold back posts\/carol-draft: altText blocks publishing \(still scheduled\)/);
    // still stopped: the next tick leaves it held
    assert.equal(srv.app.scheduler.tick(clock.now + 60_000), null);
  });

  test('publish anyway: editors and above only, past the publish rules, audited with them', async () => {
    const e = await entry('carol-draft');
    assert.equal((await alice.post('/collections/posts/entries/carol-draft/publish', { version: e.version, anyway: true })).status, 403);
    const plain = await editor.post('/collections/posts/entries/carol-draft/publish', { version: e.version });
    assert.deepEqual([plain.status, plain.json.error], [422, 'blocked']);
    const r = await editor.post('/collections/posts/entries/carol-draft/publish', { version: e.version, anyway: true });
    assert.equal(r.status, 202, r.text);
    await finish(srv);
    assert.equal((await editor.get(`/jobs/${r.json.job}`)).json.status, 'succeeded');
    const now = await entry('carol-draft');
    assert.equal(now.status, 'published');
    assert.equal(now.held, undefined);
    const a = srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'entry.publish.anyway'").get();
    assert.deepEqual(JSON.parse(a.detail).rules.map((x) => x.rule), ['altText']);
    // back to a plain draft with its image described, for the next test
    assert.equal((await editor.post('/collections/posts/entries/carol-draft/unpublish', { version: now.version })).status, 202);
    await finish(srv);
    await fixCarol();
  });

  test('once fixed, the next run puts a held entry live; a failed deploy holds it again', async () => {
    await holdCarol();
    await fixCarol();
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    let jid;
    try {
      jid = srv.app.scheduler.tick(clock.now + 60_000);
      assert.ok(jid, 'fixed: the next tick takes it');
      await finish(srv);
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
    }
    const failed = (await editor.get(`/jobs/${jid}`)).json;
    assert.equal(failed.status, 'failed');
    assert.match(failed.log, /posts\/carol-draft: held again/);
    assert.ok((await entry('carol-draft')).held?.dueAt, 'held again, as before');
    const ok = srv.app.scheduler.tick(clock.now + 120_000);
    await finish(srv);
    const job = (await editor.get(`/jobs/${ok}`)).json;
    assert.equal(job.status, 'succeeded', job.log);
    assert.equal(job.steps[0].name, 'released');
    const e = await entry('carol-draft');
    assert.equal(e.status, 'published');
    assert.equal(e.held, undefined);
    assert.match(fx.git('log', '-3', '--format=%s'), /Release posts\/carol-draft: nothing holds it back now/);
    assert.match((await editor.get('/notices')).json.items.find((x) => x.kind === 'schedule.released').text, /“Carol Draft” was held back and is going live now/);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'schedule.released'").get().n, 2, 'the failed try and the one that went live');
  });

  test('due while the server was down: it goes live late, and editors hear how late', async () => {
    const d = await editor.get('/collections/posts/entries/bob-draft');
    const at = clock.now + 600_000;
    assert.equal((await editor.post('/collections/posts/entries/bob-draft/schedule', { version: d.json.version, publishAt: new Date(at).toISOString() })).status, 200);
    clock.now = at + 90 * 60_000; // an hour and a half with no tick (inside the session's idle time)
    const jid = srv.app.scheduler.tick(clock.now);
    assert.ok(jid);
    await finish(srv);
    const job = (await editor.get(`/jobs/${jid}`)).json;
    assert.equal(job.status, 'succeeded', job.log);
    assert.match(job.log, /90 min late \(the server was not running\)/);
    assert.equal((await editor.get('/collections/posts/entries/bob-draft')).json.status, 'published');
    const n = (await editor.get('/notices')).json.items.find((x) => x.kind === 'schedule.late');
    assert.match(n.text, /“Bob Draft” was due at .* while the server was not running\. It went out 90 min late\./);
    assert.equal((await editor.post('/notices/seen', {})).json.ok, true);
    assert.equal((await editor.get('/notices')).json.items.length, 0);
  });

  test('a job cut by a restart is told when the server comes back', async () => {
    const ed = srv.app.users.list().find((u) => u.role === 'editor');
    srv.app.db.prepare("INSERT INTO jobs (id, kind, status, collection, entry_id, user_id, created_at) VALUES ('j_cut', 'publish', 'running', 'posts', 'with-html', ?, ?)").run(ed.id, new Date().toISOString());
    await srv.close();
    srv = await startServer(fx, { clock });
    const row = srv.app.db.prepare("SELECT * FROM notices WHERE link = '#/jobs/j_cut'").get();
    assert.equal(row.user_id, ed.id);
    assert.match(row.text, /^A publish \(posts\/with-html\) stopped: the server restarted during it/);
    assert.equal(srv.app.db.prepare("SELECT status FROM jobs WHERE id = 'j_cut'").get().status, 'failed');
  });
});

test('config: notify hooks are https (loopback http only in development)', () => {
  const fx = makeFixture({ checks: false });
  const env = { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
  assert.throws(() => loadConfig({ env, overrides: { notify: { webhook: 'http://hooks.example/x' } } }), /must be https/);
  assert.throws(() => loadConfig({ env, overrides: { notify: { email: 'ops@example.test' } } }), /notify\.email must be an object/);
  assert.deepEqual(loadConfig({ env, overrides: { notify: { slack: 'https://hooks.slack.com/services/T/B/X' } } }).notify, { slack: 'https://hooks.slack.com/services/T/B/X' });
});
