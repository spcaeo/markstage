// The preview site: a private git clone of the content repo (never the repo itself), with one user's unsaved state
// written on top of HEAD, served by the site's own dev server on a loopback port. Started on demand, stopped when
// idle, unless `preview.warm` (the default): then it is started with Markstage, asked for the home page once (warm()),
// and kept running, so the first page a writer opens after a restart or a deploy does not wait for it. One clone per
// server; callers serialize "show this state, then render" through `lock`.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { isInside, isWithin } from '../config.mjs';
import { promisify } from 'node:util';
import { ENV_ALLOW } from '../jobs.mjs';
import { createLock, sha1 } from '../util.mjs';

const exec = promisify(execFile);
const OUTPUT_CAP = 64 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The first odd port in [lo, hi] that nothing listens on (checked by binding it). */
export async function freeOddPort([lo, hi], host = '127.0.0.1') {
  for (let p = lo % 2 ? lo : lo + 1; p <= hi; p += 2) {
    const free = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.listen(p, host, () => s.close(() => resolve(true)));
    });
    if (free) return p;
  }
  throw new Error(`No free odd port between ${lo} and ${hi} for the preview dev server.`);
}

/** Copy a directory cheaply: a copy-on-write clone where the file system has one, else a plain copy. */
async function copyTree(from, to) {
  try {
    if (process.platform === 'darwin') await exec('cp', ['-cR', from, to]);
    else await exec('cp', ['-a', '--reflink=auto', from, to]);
  } catch {
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  }
}

/**
 * After copying node_modules from `from` to `to`: a package linked from outside it by a relative link (a `file:`
 * dependency such as ../markstage/packages/astro) would point somewhere else from the copy's folder, so it is
 * linked again by its absolute path. Links inside node_modules (.bin, workspaces) stay as they are.
 */
export function relinkOutside(from, to) {
  const relink = (dir) => {
    let names;
    try {
      names = fs.readdirSync(path.join(to, dir));
    } catch {
      return;
    }
    for (const name of names) {
      const rel = path.join(dir, name);
      const at = path.join(to, rel);
      const st = fs.lstatSync(at);
      if (st.isDirectory() && name.startsWith('@') && !dir) relink(rel);
      if (!st.isSymbolicLink()) continue;
      const link = fs.readlinkSync(at);
      if (path.isAbsolute(link)) continue;
      const target = path.resolve(path.dirname(path.join(from, rel)), link);
      if (isInside(from, target)) continue;
      fs.unlinkSync(at);
      fs.symlinkSync(target, at);
    }
  };
  relink('');
}

export function createPreviewSite(app) {
  const { config } = app;
  const pv = config.preview;
  const dir = path.join(pv.dir, 'site');
  const lock = createLock();
  const clock = () => app.clock();

  let proc = null;
  let port = null;
  let starting = null;
  // after close() no dev server may start (or outlive it): one still starting is killed when it is up
  let closed = false;
  let lastUse = 0;
  let output = '';
  let syncedHead = null;
  /** repo-relative path -> sha1 of the text this clone shows instead of HEAD */
  const written = new Map();

  const git = async (cwd, ...args) => (await exec('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();
  const log = (s) => {
    output = (output + s).slice(-OUTPUT_CAP);
  };

  async function ensureClone() {
    if (fs.existsSync(path.join(dir, '.git'))) return;
    fs.mkdirSync(pv.dir, { recursive: true, mode: 0o700 });
    fs.rmSync(dir, { recursive: true, force: true });
    await exec('git', ['clone', '--quiet', '--no-checkout', config.contentRoot, dir]);
    syncedHead = null;
    pushGuarded = false;
  }

  /**
   * The clone fetches from the content repo and never pushes anywhere: its push address is a path that cannot exist,
   * so even a `git push` run in it by hand fails, and what the clone shows (an autosave, the gallery's pages) stays here.
   */
  let pushGuarded = false;
  async function guardPush() {
    if (pushGuarded) return;
    await git(dir, 'config', 'remote.origin.pushurl', path.join(dir, '.git', 'markstage-preview-never-pushes'));
    pushGuarded = true;
  }

  /** The site's installed dependencies, copied (not linked: the dev server writes caches into them). */
  async function ensureModules() {
    const src = path.join(config.contentRoot, 'node_modules');
    if (!fs.existsSync(src)) return;
    const lockFile = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'].map((f) => path.join(config.contentRoot, f)).find((f) => fs.existsSync(f));
    const stamp = sha1(`${lockFile ? fs.readFileSync(lockFile) : ''}|${fs.statSync(src).mtimeMs}`);
    const marker = path.join(pv.dir, 'modules.stamp');
    if (fs.existsSync(path.join(dir, 'node_modules')) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === stamp) return;
    await stop();
    fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
    await copyTree(src, path.join(dir, 'node_modules'));
    relinkOutside(src, path.join(dir, 'node_modules'));
    fs.writeFileSync(marker, stamp);
  }

  /** Bring the clone to the content repo's HEAD (only when HEAD moved). Returns true when files changed. */
  async function syncHead() {
    await ensureClone();
    await guardPush();
    const head = await git(config.contentRoot, 'rev-parse', 'HEAD');
    if (head === syncedHead) return false;
    await git(dir, 'fetch', '--quiet', 'origin', 'HEAD');
    await git(dir, 'reset', '--quiet', '--hard', 'FETCH_HEAD');
    syncedHead = await git(dir, 'rev-parse', 'HEAD');
    written.clear();
    await ensureModules();
    return true;
  }

  /**
   * Make the clone show HEAD plus `files` ({ repoRelativePath: text }). Files shown for an earlier state go back to
   * HEAD. Returns true when anything on disk changed.
   */
  async function show(files) {
    let changed = await syncHead();
    for (const rel of [...written.keys()]) {
      if (rel in files) continue;
      // a file the state added (a first Custom CSS) is not in HEAD: it goes away instead
      await git(dir, 'checkout', '--quiet', 'HEAD', '--', rel).catch(() => fs.rmSync(path.join(dir, rel), { force: true }));
      written.delete(rel);
      changed = true;
    }
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.resolve(dir, rel);
      if (!isWithin(dir, abs) || isInside(path.join(dir, '.git'), abs)) throw new Error(`Refusing to write outside the preview clone: ${rel}`);
      const h = sha1(text);
      if (written.get(rel) === h) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
      written.set(rel, h);
      changed = true;
    }
    return changed;
  }

  /** After a write, wait until the running dev server has re-read the files (see preview.settleFile). */
  async function settle(since) {
    if (!proc) return;
    const file = pv.settleFile ? path.join(dir, pv.settleFile) : null;
    const until = Date.now() + pv.settleMs;
    while (Date.now() < until) {
      try {
        if (file && fs.statSync(file).mtimeMs > since) return;
      } catch {
        // not written yet
      }
      await sleep(50);
    }
  }

  async function waitReady(p, child) {
    const until = Date.now() + pv.startSeconds * 1000;
    while (Date.now() < until) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`The preview dev server stopped while starting:\n${output.slice(-2000)}`);
      const up = await fetch(`http://127.0.0.1:${p}/`, { redirect: 'manual', signal: AbortSignal.timeout(2000) }).then(
        () => true,
        () => false,
      );
      if (up) return;
      await sleep(250);
    }
    throw new Error(`The preview dev server did not answer within ${pv.startSeconds} s:\n${output.slice(-2000)}`);
  }

  /** Start the dev server if it is not running. Returns its port. */
  async function start() {
    lastUse = clock();
    if (closed) throw new Error('The preview is shut down.');
    if (proc) return port;
    starting ??= (async () => {
      await syncHead();
      const p = await freeOddPort(pv.ports);
      const argv = pv.command.map((a) => a.replaceAll('{port}', String(p)));
      const env = { ...Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), ...pv.env, MARKSTAGE_PREVIEW: '1' };
      output = '';
      log(`$ ${argv.join(' ')}\n`);
      const child = spawn(argv[0], argv.slice(1), { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      child.stdout.on('data', (d) => log(d.toString('utf8')));
      child.stderr.on('data', (d) => log(d.toString('utf8')));
      child.on('error', (e) => log(`could not start ${argv[0]}: ${e.message}\n`));
      child.on('exit', () => {
        if (proc === child) {
          proc = null;
          port = null;
        }
      });
      try {
        await waitReady(p, child);
      } catch (e) {
        killGroup(child, 'SIGKILL');
        throw e;
      }
      // a dev server that backgrounds itself would outlive every stop(); refuse it rather than leak it
      if (child.exitCode !== null) throw new Error('The preview dev server detached itself (for Astro, keep --ignore-lock and no --background).');
      if (closed) {
        killGroup(child, 'SIGKILL');
        throw new Error('The preview is shut down.');
      }
      proc = child;
      port = p;
    })().finally(() => {
      starting = null;
    });
    await starting;
    return port;
  }

  function killGroup(child, signal) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  }

  async function stop() {
    const child = proc;
    if (!child) return;
    proc = null;
    port = null;
    const gone = new Promise((r) => child.once('exit', r));
    killGroup(child, 'SIGTERM');
    const t = setTimeout(() => killGroup(child, 'SIGKILL'), 5000);
    await gone;
    clearTimeout(t);
  }

  const idle = () => Boolean(proc) && !pv.warm && clock() - lastUse > pv.idleMinutes * 60_000;
  const idleTimer = setInterval(() => {
    if (idle()) stop();
  }, 30_000);
  idleTimer.unref();

  /**
   * Start the dev server now and ask it for the home page once, so its first real page is warm (Astro compiles the
   * shared layout and components on the first request). Returns the seconds it took; logs one line.
   */
  async function warm() {
    const t0 = Date.now();
    await lock.run(async () => {
      await show({});
      const p = await start();
      await fetch(`http://127.0.0.1:${p}/`, { headers: { accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(pv.startSeconds * 1000) }).then((r) => r.arrayBuffer(), () => null);
    });
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    console.log(`[markstage] Preview warm in ${seconds} s`);
    return seconds;
  }

  return {
    dir,
    lock,
    show,
    settle,
    start,
    stop,
    touch: () => {
      lastUse = clock();
    },
    warm,
    /** Stop idling out now if the idle time has passed (tests call this instead of waiting for the timer). */
    checkIdle: () => (idle() ? stop() : null),
    get port() {
      return port;
    },
    get running() {
      return Boolean(proc);
    },
    get output() {
      return output;
    },
    async close() {
      closed = true;
      clearInterval(idleTimer);
      // a start in progress would set `proc` after stop() looked: wait for it, then stop what it started
      if (starting) await starting.catch(() => {});
      await stop();
    },
  };
}
