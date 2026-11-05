// The repo's lock across server processes (docs/SCALING.md): a lock file in the data dir, made with an exclusive
// create (O_EXCL: one process wins), naming its owner: its process id, pid, when that pid started, and its machine.
// A lock is removed by another process only once its owner has stopped: on this machine when its pid is gone or
// belongs to a newer process, elsewhere when its heartbeat stood still (cluster/index.mjs). Never by the file's age
// alone: a clock that jumped, or a paused owner, would give it two holders. (Only a file that names nobody, left by a
// process that died between making it and writing it, goes by its age.) That removal is decided inside the
// database's write transaction, so two waiters never both remove it (and so never remove the fresh one the other
// just made). Every git write checks the file still names this process (fencing) and stops, saying so, if not.
//
// Within one process the lock is shared: a git write inside a repo-lock section (the usual case) does not wait for
// itself. Callers in one process are put in order by the repo lock's own queue (createRepoLock), as before.
import fs from 'node:fs';
import { HttpError, createLock } from '../util.mjs';

// a wait keeps the process alive (a command-line run waiting for a lock must not end half-way)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createFileLock(file, cluster, { timeoutMs = 10 * 60_000 } = {}) {
  let held = 0;
  const stamp = () => {
    const t = cluster.now() / 1000;
    fs.utimesSync(file, t, t);
  };

  /** What the lock file says, with its time stamp, or null when there is none. */
  function read() {
    try {
      const st = fs.statSync(file);
      let info = null;
      try {
        info = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // just made, not written yet (or not ours to read): only its age counts
      }
      return { ...(info ?? {}), mtimeMs: st.mtimeMs };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  const stale = (info) => (info.owner ? !cluster.aliveProcess(info) : cluster.now() - info.mtimeMs > cluster.leaseMs);

  function tryTake(what) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify({ owner: cluster.id, pid: cluster.pid, pidStart: cluster.pidStart, host: cluster.host, machine: cluster.machine, what, since: new Date(cluster.now()).toISOString() }));
      } finally {
        fs.closeSync(fd);
      }
      stamp();
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    // looks stale: decided again inside the write transaction, where no other waiter can act in between
    const seen = read();
    if (!seen || !stale(seen)) return false;
    cluster.exclusive(() => {
      const info = read();
      if (info && stale(info)) {
        fs.rmSync(file, { force: true });
        console.error(`[markstage] ${file}: the lock of a server process that stopped (${info.owner ?? 'unknown'}, ${info.what ?? 'repo'}) was let go.`);
      }
    });
    return false;
  }

  // the owner's heartbeat keeps the lease
  cluster.onBeat(() => {
    if (!held) return;
    const info = read();
    if (info?.owner === cluster.id) stamp();
    else console.error(`[markstage] ${file}: this process held the repo lock, but the file now names ${info?.owner ?? 'nobody'}.`);
  });

  return {
    file,
    /** Take it (waiting while another process holds it), or share it when this process holds it already. */
    async acquire(what = 'repo') {
      if (held) {
        held++;
        return;
      }
      const until = Date.now() + timeoutMs;
      for (let delay = 10; !tryTake(what); delay = Math.min(delay * 2, 200)) {
        if (Date.now() > until) {
          const info = read();
          throw new HttpError(503, 'busy', `The site's files are held by another server process (${info?.what ?? 'repo'}). Try again in a moment.`);
        }
        await sleep(delay);
      }
      held = 1;
    },
    release() {
      if (!held) return;
      held--;
      if (held) return;
      if (read()?.owner === cluster.id) fs.rmSync(file, { force: true });
    },
    /**
     * Fencing: throw (503 "lost") unless the file still names this process. Every write under the lock calls it
     * first, so a process that was paused while another took the lock stops instead of writing beside it.
     */
    check(doing = 'the change') {
      if (held && read()?.owner === cluster.id) return;
      console.error(`[markstage] ${file}: this process no longer holds the repo lock (another server process took it while this one was paused); ${doing} stopped here.`);
      throw new HttpError(503, 'lost', `Another server process took the site's files over while this one was paused, so ${doing} stopped here. Try again in a moment.`);
    },
    /** Run fn holding it (checked first: see check). */
    async hold(fn, what) {
      await this.acquire(what);
      try {
        this.check();
        return await fn();
      } finally {
        this.release();
      }
    },
    get held() {
      return held > 0;
    },
    read,
  };
}

/**
 * The repo lock (app.repoLock): `await repoLock.run(() => work())` runs one at a time, in this process (in order,
 * as before) and across every process on the data dir (the lock file).
 */
export function createRepoLock(fileLock) {
  const local = createLock();
  return {
    run: (fn) => local.run(() => fileLock.hold(fn, 'repo')),
    file: fileLock,
  };
}
