// More than one server process on one data dir (docs/SCALING.md). Every process registers here with a heartbeat;
// what must hold across processes lives in the database, never in one process's memory:
//
// - leases: a lock with an owner (this process), taken in one write transaction, so two processes never both hold
//   one. A lease is let go by its owner, or taken over only once its owner has stopped. Whether a process stopped is
//   never decided by the wall clock alone (it jumps: an NTP step, a VM pause, a laptop asleep, a SIGSTOP):
//   - on this machine (identity.mjs: the hostname, plus on Linux the pid namespace and the boot id), a process runs
//     while its pid answers and started when it said it did (a new process with the old pid is not it);
//   - on another machine (another container), while its heartbeat keeps moving, timed by this process's own
//     monotonic clock once it has seen it (at the first sight, by the heartbeat's age).
// - fencing: work done under a lease checks it is still this process's before each step (a job step, a git write,
//   a webhook send), and stops, saying so, when it is not.
// - the primary role: one lease ("primary") held by one `serve` process at a time. Its holder runs what must run
//   once for the whole server: the scheduler, scheduled releases, backups, alert digests, webhook and form retries,
//   integration refreshes, the sweeps, the preview listener and its dev server, and the share-link listener. When it
//   stops, another process takes the role on its next heartbeat.
// - reaping: work a stopped process left (a job, a site translation) is marked as a restart marks it today (failed,
//   or paused with a reason), so it never stays "running" for ever, and a new run can start.
//
// The limits' recent hits are in limits.mjs, the repo's lock file in file-lock.mjs.
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { tx } from '../db.mjs';
import { HttpError, newId } from '../util.mjs';
import { machineId, pidAlive, pidStart } from './identity.mjs';
import { createHits } from './limits.mjs';

export { pidAlive } from './identity.mjs';

/** How long a heartbeat may stand still before its process counts as stopped (config `processes.leaseSeconds`). */
export const LEASE_MS = 30_000;

// a wait keeps the process alive (a command-line run waiting for a lock must not end half-way)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MACHINE = machineId();

/**
 * The cluster of one server process. `db`: the data dir's database; `leaseMs`; `now`: the clock leases and
 * heartbeats use (real time: a test's fake app clock never makes a live process look stopped); `clock`: the app's
 * clock, which the limits' windows use (as they always did); `mono`: a clock that never jumps (tests move it).
 */
export function createCluster(db, { leaseMs = LEASE_MS, now = Date.now, clock = Date.now, mono = () => performance.now() } = {}) {
  const id = newId('p');
  const host = os.hostname();
  const machine = MACHINE;
  const pid = process.pid;
  const myStart = pidStart(pid);
  const beatMs = Math.max(100, Math.floor(leaseMs / 6));
  const started = now();
  let kind = 'cli';
  let port = null;
  let timer = null;
  let closed = false;
  let stopping = false;
  let beating = null;
  const reapers = [];
  const onBeat = [];
  /** name -> {start, stop, held} */
  const roles = new Map();
  /** another machine's process -> {seen: its last heartbeat, at: when this process saw it change (mono)} */
  const watched = new Map();
  /** pid -> {start, at}: when the system says that pid started, asked again after a few seconds */
  const starts = new Map();

  const register = () =>
    db
      .prepare('INSERT INTO server_processes (id, pid, host, kind, port, started_at, seen_at, machine, pid_start) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, port = excluded.port, seen_at = excluded.seen_at')
      .run(id, pid, host, kind, port, started, now(), machine, myStart);

  function startOf(p) {
    const c = starts.get(p);
    if (c && mono() - c.at < 5000) return c.start;
    const start = pidStart(p);
    starts.set(p, { start, at: mono() });
    return start;
  }

  /**
   * Is the process of this row running? This one is while it is open. One on this machine while its pid answers and
   * started when it said (a clock that jumped, or a pause, never makes it look stopped). One elsewhere while its
   * heartbeat moves.
   */
  function aliveRow(r, t = now()) {
    if (!r) return false;
    if (r.id === id) return !closed;
    if (r.machine && r.machine === machine) {
      if (!pidAlive(r.pid)) return false;
      // a heartbeat that looks old (a jump, a pause, or a new process that got the pid): ask when the pid started
      if (Math.abs(t - r.seen_at) > leaseMs && r.pid_start) {
        const s = startOf(r.pid);
        if (s && s !== r.pid_start) return false;
      }
      return true;
    }
    const m = mono();
    const w = watched.get(r.id);
    if (!w || w.seen !== r.seen_at) {
      watched.set(r.id, { seen: r.seen_at, at: m });
      // the first sight is judged by the heartbeat's age (a process that just started has seen nothing move yet)
      return w ? true : t - r.seen_at <= leaseMs;
    }
    // stood still: stopped once this process's own clock says so and the wall clock agrees
    return m - w.at <= leaseMs || t - r.seen_at <= leaseMs;
  }
  const rowOf = (owner) => db.prepare('SELECT * FROM server_processes WHERE id = ?').get(owner);
  const alive = (owner) => (owner === id ? !closed : aliveRow(rowOf(owner)));
  /**
   * Is the process a lock file names running ({owner, pid, machine, pidStart})? On this machine by its pid and when
   * it started, whatever its row says; elsewhere by its heartbeat.
   */
  function aliveProcess(info) {
    if (info.owner === id) return !closed;
    if (info.machine && info.machine === machine && Number.isInteger(info.pid)) {
      if (!pidAlive(info.pid)) return false;
      const s = info.pidStart ? startOf(info.pid) : null;
      return !(s && s !== info.pidStart);
    }
    return alive(info.owner);
  }

  // ---- leases ---------------------------------------------------------------------------------------------------

  /**
   * Take the lease `name` now, or false while another live process (or this one) holds it. `what` says what it is
   * for (shown to people waiting). Never waits. A lease is taken over only once its owner has stopped, never because
   * the clock says its time ran out (a clock that jumped would give it two holders).
   */
  function take(name, what = null) {
    const t = now();
    return tx(db, () => {
      const r = db.prepare('SELECT * FROM leases WHERE name = ?').get(name);
      if (r && alive(r.owner)) return false;
      db.prepare('INSERT INTO leases (name, owner, what, since, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, what = excluded.what, since = excluded.since, expires_at = excluded.expires_at').run(name, id, what, t, t + leaseMs);
      return true;
    });
  }
  /** Keep holding it: false when it is not this process's any more (another process took it). */
  const renew = (name) => Number(db.prepare('UPDATE leases SET expires_at = ? WHERE name = ? AND owner = ?').run(now() + leaseMs, name, id).changes) === 1;
  /**
   * Fencing: throw (503 "lost") unless the lease is still this process's. Work done under a lease calls it before
   * each step, so a process that was paused while another took over stops instead of doing the work twice.
   */
  function check(name, doing = 'the work') {
    if (renew(name)) return;
    console.error(`[markstage] this process no longer holds the ${name} lease (another server process took it over while this one was paused); ${doing} stopped here.`);
    throw new HttpError(503, 'lost', `Another server process took this over while this one was paused, so ${doing} stopped here. Try again in a moment.`);
  }
  const release = (name) => void db.prepare('DELETE FROM leases WHERE name = ? AND owner = ?').run(name, id);
  /** Who holds it now: {owner, what, since, mine} or null (a lease whose owner stopped is nobody's). */
  function holder(name) {
    const r = db.prepare('SELECT * FROM leases WHERE name = ?').get(name);
    if (!r || !alive(r.owner)) return null;
    return { owner: r.owner, what: r.what, since: r.since, mine: r.owner === id };
  }

  /** Wait for the lease (polling, never blocking the event loop), at most `timeoutMs`; then 503. */
  async function acquire(name, what = null, { timeoutMs = 10 * 60_000, words = 'Another server process is busy with this. Try again in a moment.' } = {}) {
    const until = Date.now() + timeoutMs;
    for (let delay = 20; !take(name, what); delay = Math.min(delay * 2, 500)) {
      if (closed) throw new HttpError(503, 'stopping', 'The server is stopping.');
      if (Date.now() > until) throw new HttpError(503, 'busy', words);
      await sleep(delay);
    }
  }
  /** Run `fn` holding the lease `name` (waiting for it first): one process at a time, whole. */
  async function critical(name, fn, opts = {}) {
    await acquire(name, opts.what ?? null, opts);
    try {
      return await fn();
    } finally {
      release(name);
    }
  }

  // ---- reaping ----------------------------------------------------------------------------------------------------

  /**
   * Forget the processes that stopped (their rows, leases and in-flight hits), then let each module mark the work
   * they left: `fn({dead, alone, startup, jobs})`. `alone`: no other process runs on this data dir (at a start that
   * is the restart of before, and the old sweeps apply as they were). Modules add what they found (`jobs`: the
   * jobs failed) for the ones after them.
   */
  function reap({ startup = false } = {}) {
    const t = now();
    const out = tx(db, () => {
      const rows = db.prepare('SELECT * FROM server_processes WHERE id != ?').all(id);
      const dead = rows.filter((r) => !aliveRow(r, t)).map((r) => r.id);
      for (const d of dead) {
        watched.delete(d);
        db.prepare('DELETE FROM server_processes WHERE id = ?').run(d);
        db.prepare('DELETE FROM leases WHERE owner = ?').run(d);
        db.prepare('DELETE FROM limit_hits WHERE owner = ?').run(d);
      }
      return { dead, alone: rows.length === dead.length, startup, jobs: [] };
    });
    if (!startup && !out.dead.length) return out;
    for (const fn of reapers) {
      try {
        fn(out);
      } catch (e) {
        console.error(`[markstage] after a server process stopped: ${e?.stack ?? e}`);
      }
    }
    return out;
  }

  // ---- the heartbeat and the roles --------------------------------------------------------------------------------

  /** One heartbeat. `strict`: a role that cannot start throws (the first claim, when the server starts). */
  function beat({ strict = false } = {}) {
    if (closed || beating) return beating;
    // reset once it settles (a beat with nothing to wait for settles after this assignment, never before it)
    const p = beatOnce(strict).finally(() => {
      if (beating === p) beating = null;
    });
    beating = p;
    return p;
  }
  async function beatOnce(strict) {
    try {
      register();
      db.prepare('UPDATE leases SET expires_at = ? WHERE owner = ?').run(now() + leaseMs, id);
      for (const fn of onBeat) fn();
      reap();
      for (const [name, r] of roles) {
        // a process that is stopping never takes a role (back), even in a beat that runs while a role stops
        if (closed || stopping) break;
        if (r.held && !renew(name)) {
          r.held = false;
          console.error(`[markstage] this process lost the ${name} role to another one; it stops what that role runs.`);
          await r.stop();
        } else if (!r.held && take(name, `${kind} on port ${port}`)) {
          await claimed(name, r);
        }
      }
    } catch (e) {
      if (e?.role && strict) throw e;
      console.error(`[markstage] server heartbeat: ${e?.stack ?? e}`);
    }
  }

  /** The role is ours: start what it runs. One that cannot start (its port taken) is let go again, and says why. */
  async function claimed(name, r) {
    r.held = true;
    try {
      await r.start();
    } catch (e) {
      r.held = false;
      release(name);
      try {
        await r.stop();
      } catch {
        // what did start is stopped as far as it can be
      }
      throw Object.assign(e, { role: name });
    }
  }

  /**
   * Stop what the roles run and let them go (another process takes them on its next heartbeat). From the first line
   * on, this process never takes a role again: a heartbeat that runs while a role is stopping leaves them alone. The
   * heartbeat itself goes on until close(): a job still finishing keeps its lease, and its process is seen running.
   */
  async function stepDown() {
    stopping = true;
    await beating;
    const held = [...roles].filter(([, r]) => r.held);
    roles.clear();
    for (const [name, r] of held) {
      r.held = false;
      release(name);
      try {
        await r.stop();
      } catch (e) {
        console.error(`[markstage] stopping the ${name} role: ${e?.message ?? e}`);
      }
    }
  }

  function startBeat() {
    clearInterval(timer);
    timer = setInterval(() => void beat(), beatMs);
    timer.unref();
  }

  register();

  return {
    id,
    pid,
    host,
    machine,
    pidStart: myStart,
    leaseMs,
    now,
    hits: createHits(db, { owner: id, clock }),
    alive,
    aliveProcess,
    take,
    renew,
    check,
    release,
    holder,
    acquire,
    critical,
    /** One write transaction (the database's write lock is the one lock every process shares). */
    exclusive: (fn) => tx(db, fn),
    reap,
    /**
     * Every module is set up: mark what stopped processes left (at a start alone, what the restart cut), then start
     * the heartbeat.
     */
    ready() {
      const out = reap({ startup: true });
      startBeat();
      return out;
    },
    /** fn(out) after each reap (see reap). */
    onReap: (fn) => reapers.push(fn),
    /** fn() on each heartbeat (renew what this process holds outside the database). */
    onBeat: (fn) => onBeat.push(fn),
    beat,
    /**
     * This process serves on `port`: it may hold the roles. `start()` and `stop()` run what a role runs; the first
     * claim happens now (a single process holds the primary role before it answers its first request).
     */
    async serve(p, list) {
      if (stopping) return;
      kind = 'serve';
      port = p;
      register();
      for (const [name, fns] of Object.entries(list)) roles.set(name, { ...fns, held: false });
      // the first claim's failure (the preview's port taken) stops the start, as it did with one process
      await beating;
      await beat({ strict: true });
    },
    /** Does this process hold the role now? */
    holds: (name) => Boolean(roles.get(name)?.held),
    /** The server processes on this data dir now: [{id, pid, host, kind, port, startedAt, seenAt, primary, you}]. */
    list() {
      const primary = holder('primary')?.owner ?? null;
      return db
        .prepare('SELECT * FROM server_processes ORDER BY started_at')
        .all()
        .filter((r) => aliveRow(r))
        .map((r) => ({ id: r.id, pid: r.pid, host: r.host, kind: r.kind, port: r.port, startedAt: new Date(r.started_at).toISOString(), seenAt: new Date(r.seen_at).toISOString(), primary: r.id === primary, you: r.id === id }));
    },
    /** A clean stop: the roles' work stopped, every lease let go, this process forgotten. */
    stepDown,
    async close() {
      if (closed) return;
      // the heartbeat stops first: nothing more runs on this process's behalf once it closes
      clearInterval(timer);
      await stepDown();
      await beating;
      closed = true;
      try {
        db.prepare('DELETE FROM leases WHERE owner = ?').run(id);
        db.prepare('DELETE FROM limit_hits WHERE owner = ?').run(id);
        db.prepare('DELETE FROM server_processes WHERE id = ?').run(id);
      } catch {
        // the database closed under us: the others reap this process after its lease
      }
    },
    /** Tests: stop the heartbeat as a crash would, leaving every row and lease behind. */
    halt() {
      clearInterval(timer);
      stopping = true;
      closed = true;
    },
  };
}
