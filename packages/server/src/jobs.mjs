// Build/deploy jobs: one at a time, each a list of steps with a log, kept in the database. Site commands run as
// argv arrays (no shell), in the content repo, with a small allowlisted environment and a timeout.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { newId, notFound, nowIso } from './util.mjs';

const MAX_LOG = 1024 * 1024;
const FAILED_WORDS = { rollback: 'A rollback', 'media-replace': 'Replacing an image', replace: 'A find and replace', bulk: 'A change to many entries', redirects: 'A redirects change', undo: 'An undo', backup: 'A backup', publish: 'A publish', unpublish: 'An unpublish', delete: 'A delete', schedule: 'A scheduled publish', site: 'The site rebuild', protect: 'Password-protecting a page', unprotect: 'Removing a page password', move: 'A move', design: 'A design change', 'code-injection': 'Code on a page', 'env-plan': 'Preparing a promotion', 'env-promote': 'A promotion', 'env-sync': 'A sync', 'env-rollback': 'A rollback', 'env-preview': 'A branch preview', 'library-sync': 'A synced Library item', 'media-import': 'A media import', import: 'An import', release: 'A release', 'release-rollback': 'Rolling back a release', 'release-preview': 'A release preview' };
/** The alert a failed job raises: a backup's (a safety alert), the deploy step's (the host), or a publish's. */
export const failedKind = (kind, step = null) => (kind === 'backup' ? 'backup.failed' : kind.startsWith('env-') ? 'env.promote-failed' : step === 'deploy' ? 'deploy.failed' : 'publish.failed');
export const ENV_ALLOW = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ', 'NODE_OPTIONS', 'npm_config_cache'];

/**
 * Run a command; resolves {code, timedOut}. Output (stdout and stderr) goes to onOutput, stdout alone also to
 * onStdout (a hook that answers in JSON). The whole process group dies on timeout.
 */
export function runCommand(argv, { cwd, env = {}, timeoutSeconds = 900, stdin = null, onOutput = () => {}, onStdout = null }) {
  return new Promise((resolve) => {
    const base = Object.fromEntries(ENV_ALLOW.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env: { ...base, ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      onOutput(`could not start ${argv[0]}: ${e.message}\n`);
      return resolve({ code: -1, timedOut: false });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      onOutput(`\n[markstage] timed out after ${timeoutSeconds} s, stopping\n`);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutSeconds * 1000);
    child.stdout.on('data', (d) => {
      onStdout?.(d.toString('utf8'));
      onOutput(d.toString('utf8'));
    });
    child.stderr.on('data', (d) => onOutput(d.toString('utf8')));
    child.on('error', (e) => onOutput(`could not start ${argv[0]}: ${e.message}\n`));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, timedOut });
    });
  });
}

const rowToJob = (r, since = 0) =>
  r && {
    id: r.id,
    kind: r.kind,
    status: r.status,
    collection: r.collection,
    entryId: r.entry_id,
    userId: r.user_id,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    steps: JSON.parse(r.steps),
    log: r.log.slice(since),
    logOffset: r.log.length,
    error: r.error,
  };

export function createJobs(app) {
  const { db, config, audit, clock } = app;
  const queue = [];
  let running = null;
  const live = new Map(); // id -> { steps, log } while running
  const idle = [];

  // a restart loses running work: say so instead of leaving jobs "running" forever
  const cut = db.prepare("SELECT id, kind, user_id, collection, entry_id FROM jobs WHERE status IN ('queued', 'running')").all();
  db.prepare("UPDATE jobs SET status = 'failed', error = 'The server restarted during this job.', finished_at = ? WHERE status IN ('queued', 'running')").run(nowIso(clock()));
  for (const r of cut) {
    const target = r.collection ? ` (${r.collection}/${r.entry_id})` : '';
    app.notices?.tell({ kind: failedKind(r.kind), text: `${FAILED_WORDS[r.kind] ?? 'A job'}${target} stopped: the server restarted during it. Nothing changed on the live site if it had not finished; run it again.`, link: `#/jobs/${r.id}`, to: r.user_id ? [r.user_id] : 'editors' });
  }

  function persist(id, state, extra = {}) {
    db.prepare('UPDATE jobs SET status = ?, steps = ?, log = ?, started_at = COALESCE(?, started_at), finished_at = ?, error = ? WHERE id = ?').run(
      extra.status ?? 'running',
      JSON.stringify(state.steps),
      state.log,
      extra.startedAt ?? null,
      extra.finishedAt ?? null,
      extra.error ?? null,
      id,
    );
  }

  /**
   * Queue a job. `run(step)` does the work: `await step('build', async (log) => code)` runs one named step;
   * a step that returns non-zero (or throws) fails the job. `onFail(step)` then runs (e.g. the revert).
   */
  function enqueue({ kind, collection = null, entryId = null, user = null, run, onFail = null, onSuccess = null, target = null, notice = null }) {
    const id = newId('j');
    db.prepare('INSERT INTO jobs (id, kind, status, collection, entry_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      kind,
      'queued',
      collection,
      entryId,
      user?.id ?? null,
      nowIso(clock()),
    );
    queue.push({ id, kind, user, run, onFail, onSuccess, notice, target: target ?? (entryId ? `${collection}/${entryId}` : kind) });
    setImmediate(pump);
    return id;
  }

  async function pump() {
    if (running || !queue.length) return;
    const job = queue.shift();
    running = job;
    const state = { steps: [], log: '' };
    live.set(job.id, state);
    const append = (text) => {
      state.log += text;
      if (state.log.length > MAX_LOG) state.log = `[earlier output cut]\n${state.log.slice(-MAX_LOG / 2)}`;
    };
    persist(job.id, state, { startedAt: nowIso(clock()) });

    // soft: a failure is a warning on the step ('warned') and the job goes on (work after the site is live)
    const step = async (name, fn, { soft = false } = {}) => {
      const s = { name, status: 'running', startedAt: nowIso(clock()), finishedAt: null, exitCode: null };
      state.steps.push(s);
      append(`\n== ${name} ==\n`);
      // a step returns its exit code, or { code, reason } to say in plain words why it failed
      let code;
      let reason = null;
      try {
        const out = await fn(append);
        code = typeof out === 'object' && out !== null ? out.code : out;
        reason = out?.reason ?? null;
      } catch (e) {
        append(`${e.message}\n`);
        code = -1;
      }
      s.exitCode = typeof code === 'number' ? code : 0;
      s.status = s.exitCode === 0 ? 'succeeded' : soft ? 'warned' : 'failed';
      s.finishedAt = nowIso(clock());
      persist(job.id, state);
      if (s.exitCode !== 0 && !soft) throw Object.assign(new Error(`${name} failed`), { step: name, reason });
    };

    let error = null;
    let failedStep = null;
    try {
      await job.run(step);
    } catch (e) {
      failedStep = e.step ?? null;
      error = e.step ? `The ${e.step} step failed${e.reason ? ` ${e.reason}` : ''}. The live site was not changed.` : e.message;
      if (job.onFail) {
        try {
          await job.onFail(step);
        } catch (e2) {
          append(`\n[markstage] cleanup after the failure also failed: ${e2.message}\n`);
        }
      }
    }
    if (!error && job.onSuccess) await job.onSuccess();
    // whoever started it hears about a failure even if they left the screen; the scheduler's, every editor (or whom
    // the job names: `notice: {to, text(error)}`)
    if (error) app.notices?.tell({ kind: failedKind(job.kind, failedStep), text: job.notice?.text ? job.notice.text(error) : `${FAILED_WORDS[job.kind] ?? 'A job'}${job.target && job.target !== job.kind ? ` (${job.target})` : ''} did not go live. ${error}`, link: `#/jobs/${job.id}`, to: job.user ? [job.user.id] : job.notice?.to ?? 'editors' });
    persist(job.id, state, { status: error ? 'failed' : 'succeeded', finishedAt: nowIso(clock()), error });
    // `deployed`: the site's deploy step ran and succeeded (the change is live: a webhook's site.live, webhooks/)
    const deployed = state.steps.some((s) => s.name === 'deploy' && s.status === 'succeeded');
    audit.log(job.user ? { user: job.user } : { actorName: 'scheduler' }, error ? 'job.failed' : 'job.succeeded', { target: job.id, ok: !error, detail: { kind: job.kind, entry: job.target, ...(deployed ? { deployed } : {}), ...(failedStep ? { step: failedStep } : {}) } });
    live.delete(job.id);
    running = null;
    if (queue.length) setImmediate(pump);
    else while (idle.length) idle.shift()();
  }

  /**
   * The entries whose files a failed command's output names, each with its title: [{collection, id, title, file}].
   * `words(entries)`: "on “Title” (posts/x)" for the job's error, never a server path alone (the log has it).
   */
  function blame(output) {
    const hits = new Map();
    for (const c of config.collections) {
      const dir = c.dir.split(path.sep).join('/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[\\s/"'(=])${dir}/([a-z0-9][a-z0-9-]{0,99})${c.ext.replace('.', '\\.')}(?![\\w-])`, 'g');
      for (const m of output.matchAll(re)) {
        let title = m[1];
        try {
          title = app.store.summarize(c, m[1], app.store.read(c, m[1]).text).title || m[1];
        } catch {
          // the file may be gone by now: its id is the name then
        }
        hits.set(`${c.id}/${m[1]}`, { collection: c.id, id: m[1], title, file: `${c.dir}/${m[1]}${c.ext}` });
      }
    }
    return [...hits.values()];
  }
  const blameWords = (entries) => {
    if (!entries.length) return null;
    const list = entries.slice(0, 3).map((e) => `“${e.title}” (${e.collection}/${e.id})`);
    return `on ${list.join(', ')}${entries.length > 3 ? ` and ${entries.length - 3} more` : ''}`;
  };

  const kv = (k, v) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  const kvGet = (k) => db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value ?? null;
  /** The entries the last failed build named (kv build.blocked), until a build goes through: {entries, job, at}. */
  function blocked() {
    const raw = kvGet('build.blocked');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Steps that run the site's configured build and deploy commands (skipped when not configured). `afterBuild(step)`
   * runs between them (checks of the fresh build): a failure there still leaves the live site untouched. `changed`:
   * the site paths this deploy changes ('all' for a whole-site change), for the after-deploy hooks (CDN, IndexNow).
   * `buildTime`: the time the build is made as (MARKSTAGE_BUILD_TIME), when not now: a release is built as of its
   * publish time, the same as its preview was (releases/publish.mjs).
   */
  async function buildAndDeploy(step, { afterBuild = null, changed = 'all', buildTime = null } = {}) {
    // the commit this build is made from: once it is deployed, it is what is live (compare `live` in the API)
    const head = await app.git?.head();
    for (const name of ['build', 'deploy']) {
      if (name === 'deploy' && afterBuild) await afterBuild(step);
      const argv = config.commands[name];
      if (!argv) continue;
      await step(name, async (log) => {
        log(`$ ${argv.join(' ')}\n`);
        const env = { ...config.commands.env, MARKSTAGE_BUILD_TIME: buildTime ?? nowIso(clock()) };
        let output = '';
        const { code } = await runCommand(argv, {
          cwd: config.contentRoot,
          env,
          timeoutSeconds: config.commands.timeoutSeconds,
          onOutput: (s) => {
            log(s);
            output = (output + s).slice(-200_000);
          },
        });
        if (code === 0 && name === 'build') db.prepare('DELETE FROM kv WHERE key = ?').run('build.blocked');
        if (code === 0) return { code, reason: null };
        const entries = blame(output);
        // the build names a broken entry: every later build is blocked by it until it is fixed, and the editor
        // says so (Site check-up, Go live, the job) with a link to open it
        if (name === 'build' && entries.length) kv('build.blocked', JSON.stringify({ entries, job: running?.id ?? null, at: nowIso(clock()) }));
        return { code, reason: blameWords(entries) };
      });
    }
    if (head) deployed(head);
    if (config.commands.deploy) await app.afterDeploy?.run(step, changed);
    // the shared remote gets what is live, so the other environments can sync it down (env/index.mjs)
    if (head) await app.environments?.pushLive(step, head);
  }

  /** The commit now live, and the ones live before it (newest last, the last 20): a rollback steps back one. */
  function deployed(head) {
    const past = JSON.parse(kvGet('deploy.history') ?? '[]').filter((h) => h !== head);
    const prev = kvGet('deploy.head');
    if (prev && prev !== head) past.push(prev);
    kv('deploy.history', JSON.stringify(past.slice(-20)));
    kv('deploy.head', head);
    // Site health: what the host serves now, once the queue is idle
    app.addresses?.soon();
  }

  /**
   * Put the release before back live (the site's rollback command, e.g. markstage-deploy rollback). `deploy.head`
   * steps back to the commit live before, so "what else goes live" counts the rolled-back changes again.
   */
  async function rollBack(step) {
    const argv = config.commands.rollback;
    await step('rollback', async (log) => {
      log(`$ ${argv.join(' ')}\n`);
      const { code } = await runCommand(argv, { cwd: config.contentRoot, env: { ...config.commands.env }, timeoutSeconds: config.commands.timeoutSeconds, onOutput: log });
      return code;
    });
    const past = JSON.parse(kvGet('deploy.history') ?? '[]');
    const back = past.pop() ?? null;
    kv('deploy.history', JSON.stringify(past));
    if (back) kv('deploy.head', back);
    else db.prepare("DELETE FROM kv WHERE key = 'deploy.head'").run();
    return back;
  }

  /** Say `sha` is what is live without stepping the history (a rollback's revert commit has the live files). */
  const markLive = (sha) => kv('deploy.head', sha);
  const liveHead = () => kvGet('deploy.head');
  const liveHistory = () => JSON.parse(kvGet('deploy.history') ?? '[]');

  return {
    enqueue,
    buildAndDeploy,
    rollBack,
    markLive,
    liveHead,
    liveHistory,
    blocked,
    get(id, since = 0) {
      const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
      if (!row) throw notFound('No such job.');
      const state = live.get(id);
      const job = rowToJob(state ? { ...row, steps: JSON.stringify(state.steps), log: state.log } : row, Math.max(0, Number(since) || 0));
      // the entries this job's build broke on, while they still block every build
      const b = blocked();
      return b?.job === id ? { ...job, blocked: b.entries } : job;
    },
    list(limit = 20) {
      const n = Math.min(Math.max(Number(limit) || 20, 1), 100);
      return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(n).map((r) => ({ ...rowToJob(r), log: undefined }));
    },
    /** Resolves when no job is queued or running (tests and shutdown). */
    idle: () => (running || queue.length ? new Promise((r) => idle.push(r)) : Promise.resolve()),
  };
}
