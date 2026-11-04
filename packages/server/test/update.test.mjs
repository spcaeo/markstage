// Updating Markstage itself (docs/OPERATIONS.md): against a local "origin" with three releases (the second one's
// check fails), the updater lists what is newer with its changelog, copies the database aside, switches and checks,
// puts the old version back when the new one does not load, refuses a checkout with local changes, and rolls back
// (with the database copy when asked). No network: the remote is a bare repo on disk.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, test } from 'node:test';
import { MIGRATIONS, openDb } from '../src/db.mjs';
import { createUpdater, UpdateError } from '../src/update.mjs';
import { TMP_ROOT, makeFixture } from './helpers.mjs';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' };
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const BIN = (ok) => `if (process.argv[2] === 'check') { ${ok ? "console.log('ok')" : "console.error('boom: the new version cannot read the config'); process.exit(1)"}; }\n`;

describe('markstage-server update', () => {
  let run;
  let install;
  let data;
  let u;
  const rows = () => {
    const db = new DatabaseSync(path.join(data, 'markstage.db'));
    try {
      return db.prepare('SELECT name FROM t ORDER BY name').all().map((r) => r.name);
    } finally {
      db.close();
    }
  };
  const release = (src, version, ok, changelog) => {
    fs.writeFileSync(path.join(src, 'packages/server/package.json'), JSON.stringify({ name: '@markstage/server', version }));
    fs.writeFileSync(path.join(src, 'packages/server/bin/markstage-server.mjs'), BIN(ok));
    if (changelog) fs.writeFileSync(path.join(src, 'CHANGELOG.md'), changelog);
    g(src, 'add', '-A');
    g(src, 'commit', '-q', '-m', `Release ${version}`);
    g(src, 'tag', `v${version}`);
  };

  before(() => {
    run = path.join(TMP_ROOT, `update-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    const src = path.join(run, 'src');
    fs.mkdirSync(path.join(src, 'packages/server/bin'), { recursive: true });
    g(run, 'init', '-q', '-b', 'main', src);
    release(src, '0.1.0', true, '# Changes\n\n## 0.1.0\n- First\n');
    fs.writeFileSync(path.join(src, 'packages/server/feature.mjs'), 'export default 2;\n');
    g(src, 'add', '-A');
    g(src, 'commit', '-q', '-m', 'Find and replace across the site');
    release(src, '0.2.0', true, '# Changes\n\n## 0.2.0\n- Find and replace across the site\n\n## 0.1.0\n- First\n');
    release(src, '0.3.0', false);
    execFileSync('git', ['clone', '-q', '--bare', src, path.join(run, 'origin.git')], { env: ENV });
    install = path.join(run, 'install');
    execFileSync('git', ['clone', '-q', path.join(run, 'origin.git'), install], { env: ENV });
    g(install, 'checkout', '-q', '--detach', 'v0.1.0');
    data = path.join(run, 'data');
    fs.mkdirSync(data, { mode: 0o700 });
    const db = new DatabaseSync(path.join(data, 'markstage.db'));
    db.exec("CREATE TABLE t (name TEXT); INSERT INTO t VALUES ('before');");
    db.close();
    u = createUpdater({ installDir: install, dataDir: data, install: [process.execPath, '-e', ''], log: () => {} });
  });

  test('not a git checkout (Docker): says how to update instead', () => {
    const bad = createUpdater({ installDir: data, dataDir: data, log: () => {} });
    assert.throws(() => bad.check(), (e) => e instanceof UpdateError && /not a git checkout of Markstage\. In Docker: pull the new image/.test(e.message));
  });

  test('check: what is newer, newest first, with what changed', () => {
    const c = u.check();
    assert.equal(c.current.version, '0.1.0');
    assert.deepEqual(c.releases.map((r) => r.tag), ['v0.3.0', 'v0.2.0']);
    const two = c.releases[1].changes;
    assert.deepEqual(two.subjects, ['Release 0.2.0', 'Find and replace across the site']);
    assert.deepEqual(two.notes, ['## 0.2.0', '- Find and replace across the site'], 'only the new changelog lines');
  });

  test('a release that does not load is not left installed', () => {
    const at = g(install, 'rev-parse', 'HEAD');
    assert.throws(() => u.update({ to: 'v0.3.0' }), /The check of the new version failed: boom[\s\S]*Nothing changed: 0\.1\.0 is still installed\./);
    assert.equal(g(install, 'rev-parse', 'HEAD'), at);
    assert.equal(fs.existsSync(path.join(data, 'updates')) ? fs.readdirSync(path.join(data, 'updates')).filter((f) => f.endsWith('.db')).length : 0, 0, 'no database copy left from the failed try');
    assert.throws(() => u.update({ to: 'v9.9.9' }), /There is no release v9\.9\.9/);
    assert.throws(() => u.update({ to: 'main' }), /release tag like v1\.2\.3/);
  });

  test('update: the database copied aside first, then switched; local changes are refused', () => {
    fs.appendFileSync(path.join(install, 'packages/server/package.json'), ' ');
    assert.throws(() => u.update({ to: 'v0.2.0' }), /local changes/);
    g(install, 'checkout', '--', 'packages/server/package.json');
    const r = u.update({ to: 'v0.2.0' });
    assert.deepEqual([r.from.version, r.to.version], ['0.1.0', '0.2.0']);
    assert.equal(g(install, 'rev-parse', 'HEAD'), g(install, 'rev-parse', 'v0.2.0^{commit}'));
    assert.ok(fs.existsSync(path.join(install, 'packages/server/feature.mjs')));
    assert.match(path.basename(r.db), /-before-0\.1\.0(-\d+)?\.db$/);
    const copy = new DatabaseSync(r.db, { readOnly: true });
    assert.deepEqual(copy.prepare('SELECT name FROM t').all().map((x) => x.name), ['before']);
    copy.close();
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'updates/history.json'), 'utf8')).length, 1);
  });

  test('rollback with the data: the version before and its database; then nothing left to go back from', () => {
    const db = new DatabaseSync(path.join(data, 'markstage.db'));
    db.exec("INSERT INTO t VALUES ('after')");
    db.close();
    assert.deepEqual(rows(), ['after', 'before']);
    const r = u.rollback({ withData: true });
    assert.equal(r.to.version, '0.1.0');
    assert.equal(g(install, 'rev-parse', 'HEAD'), g(install, 'rev-parse', 'v0.1.0^{commit}'));
    assert.deepEqual(rows(), ['before'], 'the database from before the update');
    assert.ok(fs.readdirSync(path.join(data, 'updates')).some((f) => /-before-rollback-0\.2\.0(-\d+)?\.db$/.test(f)), 'what was there is kept too');
    assert.throws(() => u.rollback(), /No update to go back from/);
  });
});

test('the real CLI: version, and check loads the config and the code without touching the database', () => {
  const fx = makeFixture({ checks: false });
  const bin = new URL('../bin/markstage-server.mjs', import.meta.url).pathname;
  const env = { ...process.env, MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
  assert.match(execFileSync(process.execPath, [bin, 'version'], { encoding: 'utf8', env }), /^Markstage v\d+\.\d+\.\d+( · build \d+)?( · \w{3} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M [A-Z]{2,5}(\+\d+)?)?( \([0-9a-f]{12}\))?\n$/);
  assert.match(execFileSync(process.execPath, [bin, 'check'], { encoding: 'utf8', env }), /^Configuration OK; Markstage \d+\.\d+\.\d+ loads\.\n$/);
  assert.equal(fs.existsSync(path.join(fx.data, 'markstage.db')), false, 'no database made or migrated');
  fs.writeFileSync(path.join(fx.data, 'config.json'), '{ "contentRoot": "relative" }');
  assert.throws(() => execFileSync(process.execPath, [bin, 'check'], { encoding: 'utf8', env, stdio: 'pipe' }), /contentRoot/);
});

test('every migration only adds, so the version before an update runs on the newer database (update --rollback)', () => {
  for (const [i, m] of MIGRATIONS.entries()) {
    // a function step changes values only (migration 21 lowercases emails): older code reads them as they are
    if (typeof m === 'function') continue;
    const statements = m.replace(/--.*$/gm, '').split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const st of statements) {
      const ok = /^CREATE (UNIQUE )?INDEX /i.test(st) || /^CREATE TABLE /i.test(st) || (/^ALTER TABLE \w+ ADD COLUMN /i.test(st) && (!/NOT NULL/i.test(st) || /DEFAULT/i.test(st)));
      assert.ok(ok, `migration ${i + 1} must only add (a new column may be empty or have a default): ${st.slice(0, 80)}`);
    }
  }
  // and a database newer than the code opens as it is
  const dir = path.join(TMP_ROOT, `newer-db-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  openDb(dir).close();
  const db = new DatabaseSync(path.join(dir, 'markstage.db'));
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  db.exec('CREATE TABLE from_the_future (x TEXT)');
  db.close();
  const again = openDb(dir);
  assert.equal(again.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length + 1);
  again.close();
});

test('migration 21 lowercases every email; two accounts that differ only in letter case stop it with a clear message', () => {
  const dir = path.join(TMP_ROOT, `emails-db-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  openDb(dir).close();
  const file = path.join(dir, 'markstage.db');
  const add = (db, id, email) => db.prepare("INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, 'X', 'editor', '2026-01-01T00:00:00.000Z')").run(id, email);
  let db = new DatabaseSync(file);
  db.exec('PRAGMA user_version = 20');
  add(db, 'u_1', 'Mixed.Case@Example.test');
  add(db, 'u_2', ' plain@example.test');
  db.close();
  db = openDb(dir);
  assert.deepEqual(db.prepare('SELECT id, email FROM users ORDER BY id').all().map((r) => [r.id, r.email]), [['u_1', 'mixed.case@example.test'], ['u_2', 'plain@example.test']]);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  // two rows the database's ASCII-only NOCASE rule told apart, which lowercasing would merge: refused, nothing changed
  db.exec('PRAGMA user_version = 20');
  add(db, 'u_3', 'Émile@example.test');
  add(db, 'u_4', 'émile@example.test');
  db.close();
  assert.throws(() => openDb(dir), /Two accounts have the same email in different letter cases: "Émile@example.test" and "émile@example.test"/);
  db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20, 'the step did not run');
  assert.equal(db.prepare("SELECT email FROM users WHERE id = 'u_3'").get().email, 'Émile@example.test', 'nothing changed');
  db.close();
});
