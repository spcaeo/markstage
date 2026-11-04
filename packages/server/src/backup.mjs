// Backups (docs/OPERATIONS.md "Backups"): on a schedule, a copy of everything needed to start again in a second place
// (config `backup.dir`: another disk or a mounted share), then optionally shipped further by the operator's command.
// Each backup is a folder `markstage-backup-YYYYMMDD-HHMMSS` holding:
//   markstage.db   the database (users, sessions, media records, jobs, audit), copied consistently while it runs
//   site.bundle    the site repo with every branch and its history, uploads included (they are committed)
//   config.json    the server config (it may hold keys: the backup folder is private, 0700)
//   manifest.json  when, the commit, each file's size and sha256
// The newest `keep` are kept. A failed backup is told to the administrators. Site health shows the last one.
//   POST /site/backup   back up now (owner, administrator): {job}
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from './jobs.mjs';
import { can } from './roles.mjs';
import { HttpError, forbidden, nowIso } from './util.mjs';

const NAME = /^markstage-backup-\d{8}-\d{6}$/;
const HOUR = 3_600_000;

/** "20261028-130501" in UTC. */
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** The file's sha256 by streaming it (a repo bundle can be hundreds of megabytes; it never sits in memory). */
const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });

export function createBackup(app) {
  const { config, db, clock, git, repoLock, jobs, audit } = app;
  const b = config.backup;
  const get = () => JSON.parse(db.prepare("SELECT value FROM kv WHERE key = 'backup.last'").get()?.value ?? 'null');
  const set = (v) => db.prepare("INSERT INTO kv (key, value) VALUES ('backup.last', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(v));
  let timer = null;
  let soon = null;
  let queued = false;

  /** Write one backup folder; returns {name, dir, bytes, commit}. */
  async function make(log) {
    fs.mkdirSync(b.dir, { recursive: true, mode: 0o700 });
    const name = `markstage-backup-${stampOf(clock())}`;
    const final = path.join(b.dir, name);
    const tmp = path.join(b.dir, `.${name}.partial`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { mode: 0o700 });
    try {
      // a consistent copy of the live database (SQLite writes it from one snapshot)
      db.exec(`VACUUM INTO '${path.join(tmp, 'markstage.db').replace(/'/g, "''")}'`);
      log('database copied\n');
      // under the repo lock, so no commit lands half-way
      const commit = await repoLock.run(async () => {
        await git.git(['bundle', 'create', path.join(tmp, 'site.bundle'), '--all']);
        return git.head();
      });
      log(`site repo bundled at ${commit ?? '(no commits)'}\n`);
      const cfg = path.join(config.dataDir, 'config.json');
      if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(tmp, 'config.json'));
      const files = [];
      for (const f of fs.readdirSync(tmp).sort()) files.push({ name: f, bytes: fs.statSync(path.join(tmp, f)).size, sha256: await sha256(path.join(tmp, f)) });
      fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ at: nowIso(clock()), commit, files }, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, final);
      const bytes = files.reduce((n, f) => n + f.bytes, 0);
      log(`${name}: ${files.map((f) => `${f.name} ${f.bytes} B`).join(', ')}\n`);
      return { name, dir: final, bytes, commit };
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  }

  /** Keep the newest `keep` backup folders (only folders this server named), remove the rest. */
  function prune(log) {
    const all = fs.readdirSync(b.dir).filter((f) => NAME.test(f) && fs.statSync(path.join(b.dir, f)).isDirectory()).sort();
    for (const old of all.slice(0, Math.max(0, all.length - b.keep))) {
      fs.rmSync(path.join(b.dir, old), { recursive: true, force: true });
      log(`removed ${old} (keeping ${b.keep})\n`);
    }
  }

  /** Queue a backup job. `user` null: the schedule. Returns the job id. */
  function enqueue(user = null) {
    queued = true;
    return jobs.enqueue({
      kind: 'backup',
      user,
      target: 'backup',
      notice: { to: 'administrators', text: (error) => `The backup did not finish. ${error} The last good one stays as it was.` },
      run: async (step) => {
        let made = null;
        try {
          await step('backup', async (log) => {
            made = await make(log);
            prune(log);
            return 0;
          });
          if (b.command) {
            await step('ship', async (log) => {
              log(`$ ${[...b.command, made.dir].join(' ')}\n`);
              return (await runCommand([...b.command, made.dir], { cwd: b.dir, env: config.commands.env, timeoutSeconds: b.timeoutSeconds, onOutput: log })).code;
            });
          }
          set({ at: nowIso(clock()), ok: true, name: made.name, bytes: made.bytes, commit: made.commit, shipped: b.command ? true : null });
        } catch (e) {
          set({ ...(get() ?? {}), failedAt: nowIso(clock()), error: e.reason ?? e.message, ok: false, ...(made ? { at: nowIso(clock()), name: made.name, bytes: made.bytes, shipped: false } : {}) });
          throw e;
        } finally {
          queued = false;
        }
      },
    });
  }

  /** The schedule: a backup when the last good one is older than `everyHours` (and none is queued). */
  function tick(now = clock()) {
    if (!b || queued) return null;
    const last = get();
    const lastTry = Math.max(Date.parse(last?.at ?? 0) || 0, Date.parse(last?.failedAt ?? 0) || 0);
    if (last?.ok && now - Date.parse(last.at) < b.everyHours * HOUR) return null;
    // after a failure, try again an hour later, not on every tick
    if (last && !last.ok && now - lastTry < HOUR) return null;
    return enqueue(null);
  }

  /** For Site health: whether it is set up, how often, and the last one. */
  function status() {
    if (!b) return { on: false };
    const last = get();
    const due = last?.ok ? new Date(Date.parse(last.at) + b.everyHours * HOUR).toISOString() : null;
    return { on: true, everyHours: b.everyHours, keep: b.keep, ships: Boolean(b.command), last, due, late: Boolean(last?.ok && clock() - Date.parse(last.at) > (b.everyHours + 2) * HOUR) };
  }

  function routes(router) {
    router.add('POST', '/site/backup', (ctx) => {
      if (!can(ctx.user, 'site.backup')) throw forbidden('Only an owner or administrator can start a backup.');
      if (!b) throw new HttpError(409, 'not-set-up', 'Backups are not set up on this server (config backup.dir, docs/DEPLOY.md).');
      const job = enqueue(ctx.user);
      audit.log(ctx, 'site.backup', { target: 'backup', detail: { job } });
      ctx.status = 202;
      return { job };
    });
  }

  return {
    make,
    now: enqueue,
    tick,
    status,
    routes,
    start() {
      if (!b) return;
      const safeTick = () => {
        try {
          tick();
        } catch (e) {
          console.error('[markstage] backup:', e.message);
        }
      };
      timer = setInterval(safeTick, 10 * 60_000);
      timer.unref();
      // a server that was down past the time catches up soon after it starts
      soon = setTimeout(safeTick, 30_000);
      soon.unref();
    },
    stop: () => {
      clearInterval(timer);
      clearTimeout(soon);
    },
  };
}
