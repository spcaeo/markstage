// The pieces several server processes share (src/cluster/, docs/SCALING.md), in one test process: two clusters on
// one database stand for two processes. Leases (one holder; on this machine a holder runs while its pid answers and
// started when it said, elsewhere while its heartbeat moves by this process's own clock; never two holders after a
// clock jump), fencing, stepping down, the repo's lock file (exclusive create, a stopped owner's lock let go), the
// limits' hits (one write transaction per count, a flood stays small), nested transactions, and two processes
// opening a new data dir at once. The review's proof scripts (jump, stepdown, flood) are tests here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { openDb, tx } from '../src/db.mjs';
import { createCluster, pidAlive } from '../src/cluster/index.mjs';
import { createFileLock } from '../src/cluster/file-lock.mjs';
import { limitKey } from '../src/cluster/limits.mjs';
import { createJobs } from '../src/jobs.mjs';
import { createLimiter } from '../src/auth/limiter.mjs';
import { TMP_ROOT } from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A pid that was a real process and is gone now. */
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

/** A process row as another process would have left it (`machine`: where its pid means something). */
function ghostOn(db, { host = 'elsewhere', machine = null, pid, pidStart = null, seenAt = Date.now() }) {
  const id = `p_ghost${crypto.randomBytes(3).toString('hex')}`;
  db.prepare('INSERT INTO server_processes (id, pid, host, kind, port, started_at, seen_at, machine, pid_start) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, pid, host, 'serve', 1, seenAt, seenAt, machine, pidStart);
  return id;
}

function dataDir() {
  const dir = path.join(TMP_ROOT, `cluster-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

describe('the server processes’ shared pieces', () => {
  const open = [];
  /** Two "processes": two connections to one database, each with its cluster (`opts`: their clocks). */
  function pair(leaseMs = 600, opts = {}) {
    const dir = dataDir();
    const dbA = openDb(dir);
    const dbB = openDb(dir);
    const a = createCluster(dbA, { leaseMs, ...opts });
    const b = createCluster(dbB, { leaseMs, ...opts });
    // their heartbeats run, as in a server
    a.ready();
    b.ready();
    open.push({ a, b, dbA, dbB });
    return { dir, a, b, dbA, dbB };
  }
  after(async () => {
    for (const { a, b, dbA, dbB } of open) {
      await a.close();
      await b.close();
      dbA.close();
      dbB.close();
    }
  });

  test('a lease has one holder; it is seen from the other process; let go, the other takes it', () => {
    const { a, b } = pair();
    assert.equal(a.take('jobs', 'a job'), true);
    assert.equal(b.take('jobs'), false);
    assert.equal(a.take('jobs'), false, 'not re-entrant: the same process waits too');
    assert.deepEqual({ ...b.holder('jobs'), since: 0 }, { owner: a.id, what: 'a job', since: 0, mine: false });
    a.release('jobs');
    assert.equal(b.take('jobs'), true);
    assert.equal(b.holder('jobs').mine, true);
  });

  test('the heartbeat goes on: each process’s row and leases are kept fresh, beat after beat', async () => {
    const { a, b, dbB } = pair(600);
    assert.equal(a.take('long', 'a long job'), true);
    const seen = () => dbB.prepare('SELECT seen_at FROM server_processes WHERE id = ?').get(a.id).seen_at;
    const s0 = seen();
    await sleep(350);
    const s1 = seen();
    await sleep(350);
    assert.ok(s1 > s0 && seen() > s1, 'moved on each beat (every 100 ms with a 600 ms lease)');
    await sleep(500);
    assert.equal(b.take('long'), false, 'held past its first lease: the heartbeat renews it');
    assert.equal(b.holder('long').owner, a.id);
    a.release('long');
  });

  test('a lease whose holder runs on another machine and stopped beating frees itself once its heartbeat stood still for a lease, not before', async () => {
    const { a, b, dbA } = pair(600);
    const ghost = ghostOn(dbA, { machine: 'container-b', pid: process.pid });
    dbA.prepare('INSERT INTO leases (name, owner, what, since, expires_at) VALUES (?, ?, ?, ?, ?)').run('import', ghost, 'an import', Date.now(), Date.now() + 600);
    assert.equal(b.take('import'), false, 'its heartbeat is fresh');
    await sleep(700);
    assert.equal(b.holder('import'), null, 'stood still for a lease: nobody’s');
    assert.equal(b.take('import'), true);
    // the stopped process is forgotten (by the other's heartbeat, or this reap)
    b.reap();
    assert.equal(b.list().some((p) => p.id === ghost), false);
    assert.equal(b.list().find((p) => p.you).id, b.id);
    assert.equal(b.list().some((p) => p.id === a.id), true);
  });

  test('a holder on this machine whose pid still answers keeps its lease and its lock, however long it was silent (a halt, a SIGSTOP)', async () => {
    const { dir, a, b } = pair(600);
    const la = createFileLock(path.join(dir, 'repo.lock'), a);
    const lb = createFileLock(path.join(dir, 'repo.lock'), b, { timeoutMs: 300 });
    assert.equal(a.take('import', 'an import'), true);
    await la.acquire('commit');
    a.halt(); // no heartbeat any more; its pid (this test's) answers, and started when it said
    await sleep(800);
    assert.equal(b.reap().dead.includes(a.id), false);
    assert.equal(b.take('import'), false);
    assert.equal(b.holder('import').owner, a.id);
    await assert.rejects(lb.acquire('other'), (e) => e.status === 503 && e.code === 'busy');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'repo.lock'), 'utf8')).owner, a.id);
  });

  test('a clock jump forward or back never gives a lease or the repo lock two holders (reviewer: jump.mjs)', async () => {
    let skew = 0;
    const now = () => Date.now() + skew;
    const { dir, a, b } = pair(30_000, { now });
    const la = createFileLock(path.join(dir, 'repo.lock'), a, { timeoutMs: 2000 });
    const lb = createFileLock(path.join(dir, 'repo.lock'), b, { timeoutMs: 300 });
    assert.equal(a.take('jobs', 'build'), true);
    await la.acquire('commit');
    assert.equal(b.take('jobs', 'build2'), false);
    for (const jump of [40_000, -40_000, 3_600_000]) {
      skew = jump; // an NTP step, a VM pause, a laptop asleep: both processes are alive
      assert.equal(b.reap().dead.includes(a.id), false, `jump ${jump}: A is not taken for stopped`);
      assert.equal(b.take('jobs', 'build2'), false, `jump ${jump}: the job lease stays A's`);
      assert.equal(b.holder('jobs').owner, a.id);
      await assert.rejects(lb.acquire('commit'), (e) => e.status === 503 && e.code === 'busy', `jump ${jump}: the repo lock stays A's`);
      assert.doesNotThrow(() => a.check('jobs'), 'A still holds what it holds');
      assert.doesNotThrow(() => la.check());
      assert.equal(la.held && !lb.held, true);
    }
    la.release();
    a.release('jobs');
  });

  test('a process on another machine is timed by this process’s own clock once seen: a wall clock jump does not stop it, standing still does', () => {
    let skew = 0;
    let m = 0;
    const now = () => Date.now() + skew;
    const { b, dbA } = pair(30_000, { now, mono: () => m });
    const ghost = ghostOn(dbA, { machine: 'container-b', pid: process.pid, seenAt: now() });
    const beat = () => dbA.prepare('UPDATE server_processes SET seen_at = ? WHERE id = ?').run(now(), ghost);
    assert.equal(b.alive(ghost), true, 'first sight: a fresh heartbeat');
    skew = 40_000;
    m += 1000;
    assert.equal(b.alive(ghost), true, 'the wall clock jumped, but this process saw it beat a second ago');
    beat();
    m += 20_000;
    assert.equal(b.alive(ghost), true, 'it beat (after the jump too)');
    m += 29_000;
    assert.equal(b.alive(ghost), true, 'still within a lease of its last beat');
    m += 2000;
    assert.equal(b.alive(ghost), true, 'stood still for a lease by this clock, but the wall clock does not agree yet');
    skew += 31_000;
    assert.equal(b.alive(ghost), false, 'stood still for a lease by both clocks');
  });

  test('a pid that answers but started at another time is a new process: the old one’s row and leases go', () => {
    const { b, dbA } = pair(30_000);
    const reused = ghostOn(dbA, { machine: b.machine, pid: process.pid, pidStart: 'Mon Jan 1 00:00:00 2001', seenAt: Date.now() - 10 * 60_000 });
    const fresh = ghostOn(dbA, { machine: b.machine, pid: process.pid, pidStart: 'Mon Jan 1 00:00:00 2001', seenAt: Date.now() });
    dbA.prepare('INSERT INTO leases (name, owner, what, since, expires_at) VALUES (?, ?, ?, ?, ?)').run('jobs', reused, 'a job', Date.now(), Date.now());
    assert.ok(b.pidStart, 'this system tells when a pid started');
    assert.equal(b.alive(reused), false);
    assert.equal(b.alive(fresh), true, 'a fresh heartbeat needs no asking');
    assert.equal(b.take('jobs'), true);
    // the repo lock file says the same
    assert.equal(b.aliveProcess({ owner: 'p_x', pid: process.pid, machine: b.machine, pidStart: 'Mon Jan 1 00:00:00 2001' }), false);
    assert.equal(b.aliveProcess({ owner: 'p_x', pid: process.pid, machine: b.machine, pidStart: b.pidStart }), true);
  });

  test('two containers that share a hostname never read each other’s pids: a process in another pid namespace is judged by its heartbeat', async () => {
    const { a, b, dbA } = pair(600);
    const pid = deadPid(); // not a process here: in its own pid namespace it would be
    // a row with this hostname from a process whose machine differs (another namespace), and one that does not say
    const other = ghostOn(dbA, { host: os.hostname(), machine: `${b.machine} pid:[4026532999]`, pid });
    const unsaid = `p_old${crypto.randomBytes(3).toString('hex')}`;
    dbA.prepare('INSERT INTO server_processes (id, pid, host, kind, port, started_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(unsaid, pid, os.hostname(), 'serve', 1, Date.now(), Date.now());
    dbA.prepare('INSERT INTO leases (name, owner, what, since, expires_at) VALUES (?, ?, ?, ?, ?)').run('primary', other, 'serve', Date.now(), Date.now() + 600);
    const dead = b.reap().dead;
    assert.equal(dead.includes(other) || dead.includes(unsaid), false, 'not stopped at once: their heartbeats are fresh');
    assert.equal(b.take('primary'), false);
    assert.equal(b.list().filter((p) => [other, unsaid].includes(p.id)).length, 2);
    await sleep(800);
    b.reap();
    assert.equal(b.list().filter((p) => [other, unsaid].includes(p.id)).length, 0, 'stopped once their heartbeats stood still');
    assert.equal(b.list().some((p) => p.id === a.id), true);
    assert.equal(b.take('primary'), true);
    b.release('primary');
  });

  test('fencing: a lease or the repo lock taken over while its holder was paused stops the holder’s next step, write and job step', async () => {
    const { dir, a, b, dbA } = pair(60_000);
    const steal = (name) => dbA.prepare('UPDATE leases SET owner = ? WHERE name = ?').run(b.id, name);
    assert.equal(a.take('webhooks.send'), true);
    steal('webhooks.send');
    assert.throws(() => a.check('webhooks.send', 'the send'), (e) => e.status === 503 && e.code === 'lost' && /so the send stopped here/.test(e.message));
    assert.equal(a.renew('webhooks.send'), false);
    // the repo lock: the file now names another process; the next git write under it stops before it runs
    const file = path.join(dir, 'repo.lock');
    const la = createFileLock(file, a);
    await la.acquire('commit');
    fs.writeFileSync(file, JSON.stringify({ owner: b.id, pid: process.pid, pidStart: b.pidStart, machine: b.machine, what: 'commit' }));
    let wrote = false;
    await assert.rejects(la.hold(async () => (wrote = true), 'git add'), (e) => e.status === 503 && e.code === 'lost');
    assert.equal(wrote, false);
    la.release();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).owner, b.id, 'the other holder’s file is left alone');
    // a job: its next step does not run, and it fails saying why
    const jobs = createJobs({ db: dbA, config: { collections: [] }, audit: { log() {} }, clock: Date.now, cluster: a });
    let second = false;
    const id = jobs.enqueue({
      kind: 'site',
      run: async (step) => {
        await step('build', async () => (steal('jobs'), 0));
        await step('deploy', async () => ((second = true), 0));
      },
    });
    await jobs.idle();
    assert.equal(second, false, 'the deploy step never ran');
    const job = jobs.get(id);
    assert.equal(job.status, 'failed');
    assert.match(job.error, /Another server process took this over while this one was paused, so the job stopped here/);
    assert.equal(b.holder('jobs').owner, b.id, 'the lease stays with the process that took it');
  });

  test('a process stepping down never takes the primary role back while a role stops (reviewer: stepdown.mjs)', async () => {
    const dir = dataDir();
    const db = openDb(dir);
    const c = createCluster(db, { leaseMs: 600 }); // a beat every 100 ms
    let starts = 0;
    let stops = 0;
    let running = false;
    try {
      c.ready();
      await c.serve(1, {
        primary: {
          start: async () => {
            starts++;
            running = true;
          },
          // stopping takes a moment (the preview's dev server exits, a webhook send finishes): beats run meanwhile
          stop: async () => {
            stops++;
            await sleep(400);
            running = false;
          },
        },
      });
      assert.equal(c.holds('primary'), true);
      await c.close();
      await sleep(300);
      assert.deepEqual({ starts, stops, running }, { starts: 1, stops: 1, running: false });
      assert.equal(db.prepare("SELECT owner FROM leases WHERE name = 'primary'").get(), undefined);
      assert.equal(c.holds('primary'), false);
    } finally {
      c.halt();
      db.close();
    }
  });

  test('a lease whose holder’s pid is gone frees itself at once, and its in-flight hits go with it', (t) => {
    const { a, b, dbA } = pair(60_000);
    const pid = deadPid();
    assert.equal(pidAlive(pid), false);
    const ghost = ghostOn(dbA, { machine: a.machine, pid });
    dbA.prepare('INSERT INTO leases (name, owner, what, since, expires_at) VALUES (?, ?, ?, ?, ?)').run('jobs', ghost, 'a job', Date.now(), Date.now() + 60_000);
    dbA.prepare('INSERT INTO limit_hits (bucket, key, at, expires_at, owner) VALUES (?, ?, ?, ?, ?)').run('ai.busy', 'u1', Date.now(), Date.now() + 60_000, ghost);
    const seen = [];
    b.onReap((out) => seen.push(out));
    assert.equal(b.holder('jobs'), null);
    assert.equal(b.take('jobs'), true, 'a whole lease early');
    b.reap();
    assert.deepEqual(seen.map((s) => [s.dead, s.alone, s.startup]), [[[ghost], false, false]], 'the modules hear which process stopped; the other one still runs');
    assert.equal(dbA.prepare('SELECT COUNT(*) AS n FROM limit_hits WHERE owner = ?').get(ghost).n, 0);
    t.diagnostic(`dead pid ${pid}`);
  });

  test('acquire waits for a lease and gives up with 503 after its time', async () => {
    const { a, b } = pair(60_000);
    assert.equal(a.take('git.fetch'), true);
    const t0 = Date.now();
    await assert.rejects(b.acquire('git.fetch', null, { timeoutMs: 150 }), (e) => e.status === 503 && e.code === 'busy');
    assert.ok(Date.now() - t0 >= 150);
    setTimeout(() => a.release('git.fetch'), 50);
    const got = await b.critical('git.fetch', async () => b.holder('git.fetch').mine);
    assert.equal(got, true);
    assert.equal(b.holder('git.fetch'), null, 'let go after');
  });

  test('the repo lock file: one holder across processes, shared within one, a stopped owner’s let go', async () => {
    const { dir, a, b, dbA } = pair(600);
    const file = path.join(dir, 'repo.lock');
    const la = createFileLock(file, a, { timeoutMs: 5_000 });
    const lb = createFileLock(file, b, { timeoutMs: 200 });
    await la.acquire('save');
    await la.acquire('commit'); // the same process: shared
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).owner, a.id);
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
    await assert.rejects(lb.acquire('other'), (e) => e.status === 503 && /held by another server process \(save\)/.test(e.message));
    la.release();
    assert.ok(fs.existsSync(file), 'still held once');
    la.release();
    assert.equal(fs.existsSync(file), false);
    // one after the other, in order, never both
    const order = [];
    const run = (l, name) => l.hold(async () => {
      order.push(`${name} in`);
      await sleep(30);
      order.push(`${name} out`);
    }, name);
    const lb2 = createFileLock(file, b, { timeoutMs: 5_000 });
    await Promise.all([run(la, 'a'), run(lb2, 'b')]);
    assert.ok(['a in,a out,b in,b out', 'b in,b out,a in,a out'].includes(order.join(',')), order.join(','));
    // a lock left by a process on this machine whose pid is gone: taken at once
    fs.writeFileSync(file, JSON.stringify({ owner: 'p_gone', pid: deadPid(), host: a.host, machine: a.machine, what: 'commit' }), { mode: 0o600 });
    await lb.acquire('after a crash');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).owner, b.id);
    lb.release();
    // a lock whose owner is unknown and whose stamp is older than the lease: let go once the lease ran out
    fs.writeFileSync(file, '{}', { mode: 0o600 });
    const old = (Date.now() - 5_000) / 1000;
    fs.utimesSync(file, old, old);
    await lb.acquire('stale');
    lb.release();
    // the lock of a process on another machine that stopped beating: held until its heartbeat stood still a lease
    const ghost = ghostOn(dbA, { machine: 'container-b', pid: process.pid });
    fs.writeFileSync(file, JSON.stringify({ owner: ghost, pid: process.pid, host: 'elsewhere', machine: 'container-b', what: 'commit' }), { mode: 0o600 });
    const t0 = Date.now();
    const lb3 = createFileLock(file, b, { timeoutMs: 5_000 });
    await lb3.acquire('after the lease');
    assert.ok(Date.now() - t0 >= 400, `waited ${Date.now() - t0} ms for the lease`);
    lb3.release();
  });

  test('the limits’ hits: one count per transaction, the window, once per window, in-flight hits are the process’s', () => {
    const { a, b, dbA } = pair(60_000);
    let now = 1_000_000;
    const ha = createCluster(dbA, { leaseMs: 60_000, clock: () => now }).hits;
    for (let i = 0; i < 3; i++) assert.equal(a.hits.take('t', 'k', 60_000, 3, { at: now }), null);
    const over = b.hits.take('t', 'k', 60_000, 3, { at: now });
    assert.deepEqual(over, { bucket: 't', n: 3, oldest: now });
    assert.equal(b.hits.take('t', 'k', 60_000, 3, { at: now + 60_001 }), null, 'a minute on: room again');
    // `also`: every bucket must have room, and each gets the hit
    assert.equal(a.hits.take('w', 'k', 60_000, 1, { at: now, also: [['c', 60_000, 5]] }), null);
    assert.equal(a.hits.take('w', 'k', 60_000, 1, { at: now, also: [['c', 60_000, 5]] }).bucket, 'w');
    assert.equal(a.hits.count('c', 'k', 60_000, now).n, 1, 'a refused take records nothing');
    // once per window, whichever process asks
    assert.equal(ha.once('told', 'k', 60_000), true);
    assert.equal(b.hits.once('told', 'k', 60_000, now + 10), false);
    now += 60_000;
    assert.equal(b.hits.once('told', 'k', 60_000, now), true);
    // in flight: dropped by its own process only
    a.hits.add('busy', 'u', 60_000, { at: now, mine: true });
    b.hits.drop('busy', 'u');
    assert.equal(a.hits.count('busy', 'u', 60_000, now).n, 1);
    a.hits.drop('busy', 'u');
    assert.equal(a.hits.count('busy', 'u', 60_000, now).n, 0);
  });

  test('a flood stays small: refused tries write nothing, an IPv6 /64 is one key, passed hits of every key go within a minute (reviewer: flood.mjs)', () => {
    const { dbA } = pair(60_000);
    let now = 5_000_000;
    const hits = createCluster(dbA, { leaseMs: 60_000, clock: () => now }).hits;
    const rows = () => dbA.prepare("SELECT COUNT(*) AS n FROM limit_hits WHERE bucket = 'share.try'").get().n;
    assert.equal(limitKey('2001:db8:1:2::9'), limitKey('2001:DB8:1:2:ffff::1'));
    assert.notEqual(limitKey('2001:db8:1:3::9'), limitKey('2001:db8:1:2::9'));
    assert.equal(limitKey('203.0.113.9'), '203.0.113.9');
    assert.equal(limitKey('::ffff:203.0.113.9'), '::ffff:203.0.113.9');
    assert.equal(limitKey(null), '-');
    let refused = 0;
    for (let n = 0; n < 2000; n++) if (hits.take('share.try', limitKey(`2001:db8::${n.toString(16)}`), 60_000, 30)) refused++;
    assert.deepEqual({ refused, rows: rows() }, { refused: 1970, rows: 30 });
    // addresses in other networks each get their own window; a minute on, one write deletes every passed hit
    for (let n = 0; n < 50; n++) hits.take('share.try', `198.51.100.${n}`, 60_000, 30);
    assert.equal(rows(), 80);
    now += 60_001;
    assert.equal(hits.take('share.try', '192.0.2.1', 60_000, 30), null);
    assert.equal(rows(), 1);
    // sign-in misses from rotating addresses in one /64 count as one address
    const limiter = createLimiter(dbA, { ipWindowSeconds: 600, ipMaxAttempts: 3 }, () => now, hits);
    for (let n = 1; n <= 3; n++) {
      limiter.ipCheck(`2001:db8:5:6::${n}`);
      limiter.ipFailure(`2001:db8:5:6::${n}`);
    }
    assert.throws(() => limiter.ipCheck('2001:db8:5:6:abcd::1'), (e) => e.status === 429);
    assert.doesNotThrow(() => limiter.ipCheck('2001:db8:5:7::1'), 'another /64 is another address');
  });

  test('tx inside tx is a savepoint: the inner error undoes the inner part only', () => {
    const { dbA } = pair();
    dbA.exec('CREATE TABLE t (v TEXT)');
    tx(dbA, () => {
      dbA.prepare('INSERT INTO t VALUES (?)').run('outer');
      assert.throws(() =>
        tx(dbA, () => {
          dbA.prepare('INSERT INTO t VALUES (?)').run('inner');
          throw new Error('no');
        }),
      );
      tx(dbA, () => dbA.prepare('INSERT INTO t VALUES (?)').run('inner ok'));
    });
    assert.deepEqual(dbA.prepare('SELECT v FROM t ORDER BY rowid').all().map((r) => r.v), ['outer', 'inner ok']);
    assert.throws(() => tx(dbA, () => {
      dbA.prepare('INSERT INTO t VALUES (?)').run('gone');
      throw new Error('no');
    }));
    assert.equal(dbA.prepare('SELECT COUNT(*) AS n FROM t').get().n, 2);
  });

  test('three processes opening a new data dir at once: each migration runs once (a second run of one would fail), all open it', async () => {
    const dir = dataDir();
    const script = `import { openDb } from ${JSON.stringify(new URL('../src/db.mjs', import.meta.url).href)};
const db = openDb(process.argv[1]);
console.log(db.prepare('PRAGMA user_version').get().user_version);
db.close();`;
    const run = () =>
      new Promise((resolve) => {
        const out = [];
        import('node:child_process').then(({ spawn }) => {
          const c = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
          c.stdout.on('data', (d) => out.push(d));
          c.stderr.on('data', (d) => out.push(d));
          c.on('close', (code) => resolve({ code, text: Buffer.concat(out).toString() }));
        });
      });
    const [x, y, z] = await Promise.all([run(), run(), run()]);
    for (const r of [x, y, z]) assert.equal(r.code, 0, r.text);
    assert.equal(new Set([x.text, y.text, z.text]).size, 1, 'the same version');
    const db = openDb(dir);
    try {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'leases'").get());
    } finally {
      db.close();
    }
  });
});
