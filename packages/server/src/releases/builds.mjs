// Preview builds "as if published" (docs/API-RELEASES.md "Preview"): the commit the site is at, checked out in the
// data dir, the release's files (or one draft, published) written over it, and the site's own build run there with
// the time it would go live as (MARKSTAGE_BUILD_TIME). One folder per target (`r_<release>`, `e_<collection>_<id>`),
// made again when what it is built from changes (its key: the commit, the files, the build time). The live site and
// the repo are never touched.
import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '../jobs.mjs';
import { nowIso } from '../util.mjs';

export function createReleaseBuilds(app) {
  const { db, config, clock, jobs } = app;
  const root = path.join(config.dataDir, 'releases', 'builds');
  const outRel = config.verify?.public ? path.relative(config.contentRoot, path.resolve(config.contentRoot, config.verify.public)) : null;
  const dirOf = (target) => path.join(root, target);
  const row = (target) => db.prepare('SELECT * FROM release_builds WHERE target = ?').get(target) ?? null;

  /**
   * {status: none|building|ready|failed, fresh, builtAt, buildTime, job, error, head, content}; `fresh`: built from this
   * key; `head` and `content`: the site's commit and what the target wrote over it, when it was built.
   */
  function state(target, key) {
    const r = row(target);
    if (!r) return { status: 'none', fresh: false, builtAt: null, buildTime: null, job: null, error: null, head: null, content: null };
    return { status: r.status, fresh: r.key === key, builtAt: r.built_at, buildTime: r.build_time, job: r.job_id, error: r.error, head: r.head, content: r.content };
  }

  /** The folder with the built site, when the build of this key is ready; else null. */
  function outDir(target, key) {
    const r = row(target);
    return r && r.status === 'ready' && r.key === key && outRel !== null ? path.join(dirOf(target), outRel) : null;
  }

  async function removeTree(dir) {
    if (!fs.existsSync(dir)) return;
    await app.git.git(['worktree', 'remove', '--force', dir], { allowFail: true });
    fs.rmSync(dir, { recursive: true, force: true });
    await app.git.git(['worktree', 'prune'], { allowFail: true });
  }

  /**
   * Build `target` from {key, head, content?, files: [{rel, bytes}], buildTime, label, user, after?(step, dir)} unless
   * that key is built or building already. Returns the job id (null when there is nothing to do).
   */
  function ensure(target, { key, head, content = null, files, buildTime, label, user = null, after = null }) {
    const r = row(target);
    if (r && r.key === key && ['ready', 'building'].includes(r.status)) return r.status === 'building' ? r.job_id : null;
    db.prepare("INSERT INTO release_builds (target, key, status, build_time, head, content) VALUES (?, ?, 'building', ?, ?, ?) ON CONFLICT(target) DO UPDATE SET key = excluded.key, status = 'building', build_time = excluded.build_time, head = excluded.head, content = excluded.content, error = NULL, built_at = NULL").run(target, key, buildTime, head, content);
    const mine = () => row(target)?.key === key;
    const dir = dirOf(target);
    const job = jobs.enqueue({
      kind: 'release-preview',
      user,
      target: label,
      notice: { to: user ? [user.id] : 'editors', text: (error) => `The preview of ${label} did not build. ${error.replace(' The live site was not changed.', '')} The live site is not affected.` },
      run: async (step) => {
        await step('checkout', async (log) => {
          await removeTree(dir);
          fs.mkdirSync(root, { recursive: true, mode: 0o700 });
          await app.git.git(['worktree', 'add', '--detach', '--force', dir, head]);
          const nm = path.join(config.contentRoot, 'node_modules');
          if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, 'node_modules'), 'dir');
          for (const f of files) {
            const abs = path.resolve(dir, f.rel);
            if (!abs.startsWith(`${dir}${path.sep}`)) throw new Error(`${f.rel} is not a file in the site.`);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, f.bytes);
          }
          log(`checked out ${head}; ${files.length} file${files.length === 1 ? '' : 's'} written over it\n`);
          return 0;
        });
        if (config.commands.build) {
          await step('build', async (log) => {
            log(`$ ${config.commands.build.join(' ')} (built as of ${buildTime})\n`);
            const { code } = await runCommand(config.commands.build, { cwd: dir, env: { ...config.commands.env, MARKSTAGE_BUILD_TIME: buildTime }, timeoutSeconds: config.commands.timeoutSeconds, onOutput: log });
            return code;
          });
        }
        if (after) await after(step, dir);
        // a newer build of this target was asked for meanwhile: it says when it is ready
        if (mine()) db.prepare("UPDATE release_builds SET status = 'ready', built_at = ?, job_id = ? WHERE target = ?").run(nowIso(clock()), job, target);
      },
      onFail: async () => {
        if (mine()) db.prepare("UPDATE release_builds SET status = 'failed', error = 'The preview did not build: see the job log.' WHERE target = ?").run(target);
      },
    });
    db.prepare('UPDATE release_builds SET job_id = ? WHERE target = ?').run(job, target);
    return job;
  }

  /** Forget a target's build and remove its folder (a release that went live, a link no longer shown). */
  async function remove(target) {
    await removeTree(dirOf(target));
    db.prepare('DELETE FROM release_builds WHERE target = ?').run(target);
  }

  // a build cut by a restart, or whose server process stopped (its job failed: jobs.mjs), is not building any more
  app.cluster.onReap(({ startup, alone, jobs: cut }) => {
    if (startup && alone) db.prepare("UPDATE release_builds SET status = 'failed', error = 'The server restarted during the build.' WHERE status = 'building'").run();
    else for (const j of cut) db.prepare("UPDATE release_builds SET status = 'failed', error = 'The server process running the build stopped.' WHERE status = 'building' AND job_id = ?").run(j);
  });

  return { state, outDir, ensure, remove, dirOf, servable: () => outRel !== null };
}
