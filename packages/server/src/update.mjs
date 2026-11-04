// Updating Markstage itself (docs/OPERATIONS.md "Updating Markstage itself"), for an install that is a git checkout
// of the Markstage repo (DEPLOY.md, option 2). Never over HTTP: `markstage-server update` in a terminal.
//   update --check          the newer releases (tags vX.Y.Z on the remote) and what changed in them
//   update [--to vX.Y.Z]    copy the database aside, switch the checkout, install, check that it loads; any failure
//                           puts the checkout back as it was. Then restart the service.
//   update --rollback       back to the version before the last update; --with-data also puts its database copy
//                           back (stop the server first: the data written since is lost)
// The history and the database copies live in <dataDir>/updates/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const DEFAULT_INSTALL = ['npm', 'ci', '--omit=dev', '--workspace', '@markstage/server', '--workspace', '@markstage/core'];

const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};
const parts = (v) => (TAG.exec(v.startsWith('v') ? v : `v${v}`) ?? []).slice(1).map(Number);

export class UpdateError extends Error {}

/**
 * The updater for one install. `installDir`: the Markstage checkout; `dataDir`: the server's data dir; `install`:
 * argv that installs the dependencies in the checkout; `remote`: the git remote to fetch from; `log`: output.
 */
export function createUpdater({ installDir, dataDir, install = DEFAULT_INSTALL, remote = 'origin', log = console.log, env = process.env }) {
  const git = (...args) => execFileSync('git', ['-C', installDir, ...args], { encoding: 'utf8', env: { ...env, GIT_TERMINAL_PROMPT: '0', LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const updates = path.join(dataDir, 'updates');
  const historyFile = path.join(updates, 'history.json');
  const history = () => (fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : []);
  const versionAt = (ref) => JSON.parse(git('show', `${ref}:packages/server/package.json`)).version;

  function assertCheckout() {
    if (!fs.existsSync(path.join(installDir, '.git')) || !fs.existsSync(path.join(installDir, 'packages/server/package.json'))) {
      throw new UpdateError(`${installDir} is not a git checkout of Markstage. In Docker: pull the new image and restart the container; to go back, start the previous image tag.`);
    }
  }

  function current() {
    return { version: versionAt('HEAD'), commit: git('rev-parse', 'HEAD') };
  }

  /** The release tags newer than what runs now, newest first, each with its changelog. */
  function check() {
    assertCheckout();
    git('fetch', '--tags', '--quiet', remote);
    const now = current();
    const tags = git('tag', '--list', 'v*').split('\n').filter((t) => TAG.test(t));
    const ahead = tags.filter((t) => newer(parts(t), parts(now.version))).sort((a, b) => (newer(parts(a), parts(b)) ? -1 : 1));
    return { current: now, releases: ahead.map((t) => ({ tag: t, changes: changesTo(t) })) };
  }

  /** What changed between HEAD and `ref`: the commit subjects (and CHANGELOG.md's new lines when there is one). */
  function changesTo(ref) {
    const subjects = git('log', '--format=%s', `HEAD..${ref}`).split('\n').filter(Boolean);
    let notes = [];
    try {
      const before = (() => {
        try {
          return git('show', 'HEAD:CHANGELOG.md');
        } catch {
          return '';
        }
      })();
      notes = git('show', `${ref}:CHANGELOG.md`).split('\n').filter((l) => l.trim() && !before.includes(l));
    } catch {
      // no changelog at that release
    }
    return { subjects, notes };
  }

  /** A consistent copy of the database before the switch (the server may be running). */
  function copyDb(label) {
    fs.mkdirSync(updates, { recursive: true, mode: 0o700 });
    const src = path.join(dataDir, 'markstage.db');
    if (!fs.existsSync(src)) return null;
    // two tries in the same second (a failed one, then another) must not collide
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    let to = path.join(updates, `${stamp}-${label}.db`);
    for (let n = 2; fs.existsSync(to); n++) to = path.join(updates, `${stamp}-${label}-${n}.db`);
    const db = new DatabaseSync(src);
    try {
      db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    return to;
  }

  /** Install and check that the new code loads with this config; throws with the output on failure. */
  function installAndCheck() {
    const run = (argv, what) => {
      try {
        execFileSync(argv[0], argv.slice(1), { cwd: installDir, env: { ...env, MARKSTAGE_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      } catch (e) {
        throw new UpdateError(`${what} failed: ${(e.stderr || e.stdout || e.message).toString().trim().slice(-2000)}`);
      }
    };
    run(install, 'Installing the dependencies');
    run([process.execPath, path.join(installDir, 'packages/server/bin/markstage-server.mjs'), 'check'], 'The check of the new version');
  }

  /** Switch to `ref`; on any failure switch back. Returns {from, to}. */
  function switchTo(ref, record) {
    const from = current();
    git('checkout', '--quiet', '--detach', ref);
    try {
      installAndCheck();
    } catch (e) {
      git('checkout', '--quiet', '--detach', from.commit);
      try {
        installAndCheck();
      } catch (e2) {
        throw new UpdateError(`${e.message}\nPutting ${from.version} back also failed: ${e2.message}`);
      }
      throw new UpdateError(`${e.message}\nNothing changed: ${from.version} is still installed.`);
    }
    const to = current();
    record?.(from, to);
    return { from, to };
  }

  function update({ to } = {}) {
    assertCheckout();
    if (git('status', '--porcelain', '--untracked-files=no')) throw new UpdateError('The Markstage checkout has local changes. Commit or remove them first (git status).');
    const c = check();
    const target = to ?? c.releases[0]?.tag;
    if (!target) return { upToDate: true, current: c.current };
    if (!TAG.test(target)) throw new UpdateError(`Give a release tag like v1.2.3 (not "${target}").`);
    try {
      git('rev-parse', '--verify', '--quiet', `${target}^{commit}`);
    } catch {
      throw new UpdateError(`There is no release ${target}.`);
    }
    const changes = changesTo(target);
    const db = copyDb(`before-${c.current.version}`);
    let done;
    try {
      done = switchTo(target, (from, now) => {
        fs.writeFileSync(historyFile, JSON.stringify([...history(), { at: new Date().toISOString(), from, to: now, db }], null, 2) + '\n', { mode: 0o600 });
      });
    } catch (e) {
      // nothing was switched, so the copy is not needed
      if (db) fs.rmSync(db, { force: true });
      throw e;
    }
    log(`Updated ${done.from.version} → ${done.to.version}.`);
    return { ...done, changes, db };
  }

  function rollback({ withData = false } = {}) {
    assertCheckout();
    const h = history();
    const last = h.at(-1);
    if (!last) throw new UpdateError('No update to go back from.');
    const now = current();
    if (now.commit !== last.to.commit) throw new UpdateError(`The checkout is at ${now.commit.slice(0, 12)}, not the last update (${last.to.commit.slice(0, 12)}). Go back by hand: git checkout ${last.from.commit}.`);
    if (withData && !last.db) throw new UpdateError('The last update kept no database copy.');
    const done = switchTo(last.from.commit);
    if (withData) {
      const live = path.join(dataDir, 'markstage.db');
      copyDb(`before-rollback-${now.version}`);
      fs.copyFileSync(last.db, live);
      for (const ext of ['-wal', '-shm']) fs.rmSync(live + ext, { force: true });
    }
    fs.writeFileSync(historyFile, JSON.stringify(h.slice(0, -1), null, 2) + '\n', { mode: 0o600 });
    log(`Back to ${done.to.version}${withData ? ', with the database from before the update' : ''}.`);
    return { ...done, withData };
  }

  return { check, update, rollback, current };
}
