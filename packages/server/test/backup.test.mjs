// Backups (docs/OPERATIONS.md "Backups"): a folder in a second place with a consistent copy of the database, the
// site repo as a git bundle (history and uploads) and the config, each file's sha256 in a manifest; the newest
// `keep` stay; the schedule runs one when the last is older than `everyHours`; the operator's command ships it on;
// a failure is told to the administrators; Site health shows the last one. And a restore from it works.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { as, client, makeFixture, startServer } from './helpers.mjs';

const folders = (dir) => fs.readdirSync(dir).filter((f) => /^markstage-backup-/.test(f)).sort();

describe('backups', () => {
  let fx;
  let srv;
  let admin;
  let editor;
  let dir;
  const clock = { now: Date.parse('2026-10-28T09:00:00Z') };

  before(async () => {
    fx = makeFixture({ checks: false });
    dir = path.join(fx.run, 'backups');
    fs.writeFileSync(path.join(fx.run, 'ship.mjs'), "import fs from 'node:fs'; if (process.env.SHIP_FAIL && fs.existsSync(process.env.SHIP_FAIL)) { console.error('the share is not mounted'); process.exit(3); } fs.writeFileSync(process.env.SHIPPED, process.argv.at(-1));\n");
    srv = await startServer(fx, {
      clock,
      overrides: {
        backup: { dir, keep: 2, everyHours: 24, command: [process.execPath, path.join(fx.run, 'ship.mjs')] },
        commands: { build: [process.execPath, 'scripts/build.mjs'], deploy: [process.execPath, 'scripts/deploy.mjs'], timeoutSeconds: 60, env: { LIVE_DIR: fx.live, FAIL_MARKER: fx.failMarker, SHIPPED: path.join(fx.run, 'shipped.txt'), SHIP_FAIL: path.join(fx.run, 'ship-fail') } },
      },
    });
    await signIn();
  });
  after(() => srv.close());
  // the clock jumps by days here, past the session idle time: sign in again after a jump
  const signIn = async () => {
    admin = await as(srv, 'administrator');
    editor = await as(srv, 'editor');
  };

  test('back up now: administrators only; the folder holds the database, the repo and the config, as the manifest says', async () => {
    // two leads in the Inbox (one handled, with a note): a restore must show them as they are
    const lead = srv.app.db.prepare("INSERT INTO form_messages (id, form, at, status, name, email, service, fields, meta) VALUES (?, 'contact', ?, ?, ?, ?, 'Data migration', ?, '{\"page\":\"https://www.example.test/contact-us/\"}')");
    lead.run('fm_backup1', '2026-10-27T10:00:00.000Z', 'new', 'Ann', 'ann@client.example', JSON.stringify({ name: 'Ann', email: 'ann@client.example', comment: 'Forty boards to move.' }));
    lead.run('fm_backup2', '2026-10-27T11:00:00.000Z', 'handled', 'Bo', 'bo@client.example', JSON.stringify({ name: 'Bo', email: 'bo@client.example', comment: 'A quote, please.' }));
    assert.equal((await editor.post('/inbox/fm_backup2/notes', { text: 'Quoted on the phone.' })).status, 201);
    const inbox = async (c) => [(await c.get('/inbox?kind=message')).json.items, (await c.get('/inbox/fm_backup2')).json];
    const [items, detail] = await inbox(admin);
    assert.equal(items.length, 2);
    assert.equal((await editor.post('/site/backup', {})).status, 403);
    const r = await admin.post('/site/backup', {});
    assert.equal(r.status, 202, r.text);
    await srv.app.jobs.idle();
    const job = (await admin.get(`/jobs/${r.json.job}`)).json;
    assert.equal(job.status, 'succeeded', job.log);
    assert.deepEqual(job.steps.map((s) => s.name), ['backup', 'ship']);
    const [name] = folders(dir);
    assert.equal(name, 'markstage-backup-20261028-090000');
    const b = path.join(dir, name);
    assert.equal(fs.readFileSync(path.join(fx.run, 'shipped.txt'), 'utf8'), b, 'the command got the folder');
    assert.equal(fs.statSync(b).mode & 0o777, 0o700);
    const m = JSON.parse(fs.readFileSync(path.join(b, 'manifest.json'), 'utf8'));
    assert.deepEqual(m.files.map((f) => f.name), ['config.json', 'markstage.db', 'site.bundle']);
    for (const f of m.files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(b, f.name))).digest('hex'), f.sha256, f.name);
    assert.equal(m.commit, fx.git('rev-parse', 'HEAD').trim());

    // restore drill: the database opens with the users in it, and the bundle clones to the same commit
    const db = new DatabaseSync(path.join(b, 'markstage.db'), { readOnly: true });
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM users').get().n >= 2);
    db.close();
    const clone = path.join(fx.run, 'restored');
    execFileSync('git', ['clone', '-q', path.join(b, 'site.bundle'), clone]);
    assert.equal(execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), m.commit);
    assert.ok(fs.existsSync(path.join(clone, 'src/content/blog/hello-world.md')));

    // and a server started from the restored folder lets an existing account sign in and sees the same content
    const restored = path.join(fx.run, 'data-restored');
    fs.mkdirSync(restored, { mode: 0o700 });
    fs.copyFileSync(path.join(b, 'markstage.db'), path.join(restored, 'markstage.db'));
    const cfg = JSON.parse(fs.readFileSync(path.join(b, 'config.json'), 'utf8'));
    fs.writeFileSync(path.join(restored, 'config.json'), JSON.stringify({ ...cfg, contentRoot: clone }));
    const again = await startServer({ data: restored, site: clone, run: fx.run }, { clock });
    try {
      const c = client(again.base);
      await c.login(admin.user.email, admin.user.password);
      assert.equal((await c.get('/collections/posts/entries/hello-world')).json.title, 'Hello World');
      assert.equal((await c.get('/users')).json.length, srv.app.users.list().length, 'every account is back');
      assert.deepEqual(await inbox(c), [items, detail], 'the same Inbox: every lead, its status, notes and history');
    } finally {
      await again.close();
    }

    const h = (await admin.get('/site/health')).json.backup;
    assert.deepEqual([h.on, h.last.ok, h.last.name, h.ships, h.late], [true, true, name, true, false]);
  });

  test('the schedule: nothing until the last one is a day old; the newest two are kept', async () => {
    clock.now += 3_600_000;
    assert.equal(srv.app.backup.tick(clock.now), null, 'an hour later: not due');
    clock.now += 24 * 3_600_000;
    const jid = srv.app.backup.tick(clock.now);
    assert.ok(jid, 'a day later: due');
    assert.equal(srv.app.backup.tick(clock.now), null, 'one at a time');
    await srv.app.jobs.idle();
    clock.now += 25 * 3_600_000;
    assert.ok(srv.app.backup.tick(clock.now));
    await srv.app.jobs.idle();
    assert.deepEqual(folders(dir), ['markstage-backup-20261029-100000', 'markstage-backup-20261030-110000']);
  });

  test('a failure: the job fails, administrators are told, health says so, and it tries again an hour later', async () => {
    fs.writeFileSync(path.join(fx.run, 'ship-fail'), '');
    try {
      clock.now += 25 * 3_600_000;
      await signIn();
      const jid = srv.app.backup.tick(clock.now);
      await srv.app.jobs.idle();
      const job = (await admin.get(`/jobs/${jid}`)).json;
      assert.equal(job.status, 'failed');
      assert.match(job.log, /the share is not mounted/);
      const n = (await admin.get('/notices')).json.items.find((x) => x.link === `#/jobs/${jid}`);
      assert.match(n.text, /^The backup did not finish\. .* The last good one stays as it was\.$/);
      assert.equal((await editor.get('/notices')).json.items.filter((x) => x.link === `#/jobs/${jid}`).length, 0, 'editors are not told');
      const h = (await admin.get('/site/health')).json.backup;
      assert.equal(h.last.ok, false);
      assert.match(h.last.error, /ship/);
      assert.equal(srv.app.backup.tick(clock.now + 10 * 60_000), null, 'not on every tick');
    } finally {
      fs.unlinkSync(path.join(fx.run, 'ship-fail'));
    }
    clock.now += 3_600_001;
    assert.ok(srv.app.backup.tick(clock.now));
    await srv.app.jobs.idle();
    assert.equal((await admin.get('/site/health')).json.backup.last.ok, true);
  });
});

test('config: the backup folder is a second place; no backup set up is said plainly', async () => {
  const fx = makeFixture({ checks: false });
  const env = { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
  assert.throws(() => loadConfig({ env, overrides: { backup: { dir: path.join(fx.site, 'backups') } } }), /outside the site repo and the data dir/);
  assert.throws(() => loadConfig({ env, overrides: { backup: { dir: path.join(fx.data, 'b') } } }), /outside the site repo and the data dir/);
  assert.throws(() => loadConfig({ env, overrides: { backup: { dir: 'relative/dir' } } }), /absolute path/);
  assert.throws(() => loadConfig({ env, overrides: { backup: { dir: path.join(fx.run, 'b'), keep: 0 } } }), /keep must be a whole number/);
  assert.throws(() => loadConfig({ env, overrides: { backup: { dir: path.join(fx.run, 'b'), command: 'rclone copy' } } }), /argv/);
  const srv = await startServer(fx);
  try {
    const admin = await as(srv, 'administrator');
    const r = await admin.post('/site/backup', {});
    assert.equal(r.status, 409);
    assert.match(r.json.message, /not set up/);
    assert.deepEqual((await admin.get('/site/health')).json.backup, { on: false });
  } finally {
    await srv.close();
  }
});
