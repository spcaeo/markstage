// Running a plan, and rolling back (docs/API-ENV.md). The rules are asked again when the plan runs, with the time,
// the runner's role and the approvals as they are then: a freeze that began after the plan was made refuses it
// (403 naming the rule). The run is one job: merge into this environment's branch, build, check, deploy, push. If
// anything fails before the site is live, the branch goes back to where it was and the live site is unchanged.
//
// A rollback puts the release before back live (commands.rollback) and then commits, on this environment's branch,
// the files of that release, so the branch equals the live site again; the commit is pushed to the shared remote.
// A job started with a personal token checks the token before each step: revoking it stops the rest.
import { runCommand } from '../jobs.mjs';
import { HttpError, conflict, nowIso } from '../util.mjs';
import { decide } from './rules.mjs';

const short = (s) => (s ? s.slice(0, 7) : '');

export function createRunner(app, { ops, plans, rules, tokens }) {
  const { config, clock, audit, jobs } = app;
  const env = config.environment;

  /** Steps that stop when the token that started the job is revoked. */
  const guarded = (step, tokenId) => (name, fn, o) =>
    step(name, async (log) => {
      if (!tokens.alive(tokenId)) {
        log('The personal token that started this job was revoked or expired: stopping.\n');
        return { code: 1, reason: '(the token that started it was revoked)' };
      }
      return fn(log);
    }, o);

  function refuse(ctx, action, target, d, detail = {}) {
    audit.log(ctx, `env.${action}`, { ok: false, target, detail: { rule: d.rule?.id ?? null, words: d.words, missing: d.missing?.map((m) => m.kind) ?? [], ...detail } });
    throw new HttpError(403, 'rule', d.words, { rule: d.rule, words: d.words, missing: d.missing ?? [] });
  }

  async function run(ctx, id, body) {
    const p = await plans.refresh(plans.load(id));
    if (body.version !== `r${p.rev}`) throw conflict('The plan changed since you loaded it.', { current: plans.toPublic(p, ctx.user) });
    if (p.status !== 'ready') throw conflict(p.status === 'stale' || p.status === 'expired' ? `The plan is ${p.status}: ${p.data.note} ` : `The plan is ${p.status}; only a ready plan runs.`, { current: plans.toPublic(p, ctx.user) });
    const reason = plans.cleanReason(body.reason) ?? p.reason;
    const d = plans.decisionFor(p, ctx.user, { reason });
    if (d.effect !== 'allow') refuse(ctx, p.action, p.id, d, { stage: 'run', from: p.from_sha, to: p.to_sha });
    const tokenId = ctx.token?.id ?? null;
    const runner = ctx.user;
    const kind = p.action === 'sync' ? 'env-sync' : 'env-promote';
    // claimed in one write transaction: of two runs asked at once (on two server processes), one runs
    app.cluster.exclusive(() => {
      const now = app.db.prepare('SELECT status, rev FROM env_plans WHERE id = ?').get(p.id);
      if (now?.status !== 'ready' || now.rev !== p.rev) throw conflict('The plan changed since you loaded it.', { current: plans.toPublic(plans.load(p.id), ctx.user) });
      plans.save(p, { status: 'running', reason, run_by: runner.id });
    });
    p.run_job_id = jobs.enqueue({
      kind,
      user: runner,
      target: p.id,
      notice: { text: (error) => `${p.action === 'sync' ? 'The sync' : 'The promotion'} of ${p.from_branch} to ${p.to_env} did not go live. ${error}` },
      run: async (raw) => {
        const step = guarded(raw, tokenId);
        await step('rules', async (log) => {
          // asked again now: the job may have waited behind others, and a freeze may have begun
          const u = app.users.get(runner.id);
          const now = plans.decisionFor(plans.load(p.id), u && !u.disabled ? u : { ...runner, role: null }, { reason });
          log(`${now.words}\n`);
          return now.effect === 'allow' ? 0 : { code: 1, reason: `(${now.words})` };
        });
        await step('merge', (log) =>
          app.repoLock.run(async () => {
            const head = await app.git.head();
            if (head !== p.to_sha) return { code: 1, reason: `(${env.name} moved to ${short(head)} after the plan was made: re-plan)` };
            const r = await app.git.git(['merge', '--ff-only', '--quiet', p.merged_sha], { allowFail: true });
            log(r.ok ? `${p.to_branch} is now at ${p.merged_sha}\n` : r.stderr);
            return r.ok ? 0 : { code: 1, reason: '(the merge did not apply to the working copy)' };
          }),
        );
        await jobs.buildAndDeploy(step, { afterBuild: afterBuildOf(p), changed: 'all' });
      },
      onFail: async (raw) => {
        // back to where it was, unless someone has committed on top since
        await app.repoLock.run(async () => {
          if ((await app.git.head()) === p.merged_sha) await app.git.git(['reset', '--keep', '--quiet', p.to_sha], { allowFail: true });
        });
        const now = plans.load(p.id);
        plans.save(now, { status: 'failed', finished_at: nowIso(clock()), data: { ...now.data, error: `It did not go live; ${p.to_env} is unchanged. See the job log.` } });
        audit.log({ user: runner }, `env.${p.action}`, { ok: false, target: p.id, detail: { from: p.from_sha, to: p.to_sha, merged: p.merged_sha, job: now.run_job_id } });
        void raw;
      },
      onSuccess: async () => {
        const now = plans.load(p.id);
        plans.save(now, { status: 'done', finished_at: nowIso(clock()) });
        audit.log({ user: runner }, `env.${p.action}`, { target: p.id, detail: { from: p.from_sha, to: p.to_sha, merged: p.merged_sha, release: jobs.liveHead(), branch: p.from_branch, reason } });
        app.notices.tell({ kind: 'env.promoted', level: 'info', text: `${runner.name} ${p.action === 'sync' ? 'synced' : 'promoted'} ${p.from_branch} (${short(p.from_sha)}) to ${p.to_env}: it is live.${reason ? ` Reason: ${reason}` : ''}`, link: `#/environments/plans/${p.id}`, to: [runner.id, p.author_id] });
      },
    });
    plans.save(p);
    audit.log(ctx, `env.${p.action}.start`, { target: p.id, detail: { rule: d.rule?.id ?? null, job: p.run_job_id } });
    ctx.status = 202;
    return { plan: plans.toPublic(p, ctx.user), job: p.run_job_id };
  }

  /** The site's after-build checks on the entries the plan changes (null when there are none). */
  function afterBuildOf(p) {
    const targets = [];
    for (const f of p.data.files?.list ?? []) {
      const c = config.collections.find((x) => f.path.startsWith(`${x.dir.replace(/\/+$/, '')}/`) && f.path.endsWith(x.ext));
      if (!c || targets.length >= 200) continue;
      const id = f.path.slice(c.dir.replace(/\/+$/, '').length + 1, -c.ext.length);
      let after = null;
      try {
        after = app.store.read(c, id).text;
      } catch {
        after = null;
      }
      try {
        targets.push(app.verify.expect(c, id, after, null));
      } catch {
        // an entry that does not read is left to the build's own checks
      }
    }
    return app.verify.afterBuild(targets);
  }

  async function rollback(ctx, body) {
    if (!config.commands.rollback) throw new HttpError(409, 'not-set-up', 'This server has no rollback command (commands.rollback in config.json).');
    const back = jobs.liveHistory().at(-1);
    if (!back) throw new HttpError(409, 'nothing-to-roll-back', 'There is no earlier release to go back to.');
    const reason = plans.cleanReason(body?.reason);
    const d = decide(rules.get(), { user: ctx.user, action: 'rollback', from: env.name, to: env.name, files: null, at: clock(), reason });
    if (d.effect !== 'allow') refuse(ctx, 'rollback', env.name, d);
    const tokenId = ctx.token?.id ?? null;
    const user = ctx.user;
    const before = jobs.liveHead();
    let revert = null;
    let to = null;
    const job = jobs.enqueue({
      kind: 'env-rollback',
      user,
      target: env.name,
      run: async (raw) => {
        const step = guarded(raw, tokenId);
        await step('rules', async () => {
          const u = app.users.get(user.id);
          const again = decide(rules.get(), { user: u && !u.disabled ? u : { ...user, role: null }, action: 'rollback', from: env.name, to: env.name, files: null, at: clock(), reason });
          return again.effect === 'allow' ? 0 : { code: 1, reason: `(${again.words})` };
        });
        to = await jobs.rollBack(step);
        await step('revert', (log) =>
          app.repoLock.run(async () => {
            if (!to) return { code: 1, reason: '(no release to go back to)' };
            const head = await app.git.head();
            revert = await ops.commitLike({ parent: head, like: to, message: `Roll back to ${short(to)}: the branch equals the live site again${reason ? `\n\nReason: ${reason}` : ''}`, author: user });
            const r = await app.git.git(['merge', '--ff-only', '--quiet', revert], { allowFail: true });
            if (!r.ok) return { code: 1, reason: '(the revert commit did not apply to the working copy)' };
            jobs.markLive(revert);
            log(`${env.branch ?? 'the branch'} is at ${revert}, with the files of ${to}\n`);
            return 0;
          }),
        );
        // the build folder matches what is live again, so the next plan compares its pages with the live ones
        if (config.commands.build) {
          await step('rebuild', async (log) => {
            const { code } = await runCommand(config.commands.build, { cwd: config.contentRoot, env: { ...config.commands.env, MARKSTAGE_BUILD_TIME: nowIso(clock()) }, timeoutSeconds: config.commands.timeoutSeconds, onOutput: log });
            return code;
          }, { soft: true });
        }
        await pushLive(step, revert);
      },
      onSuccess: async () => {
        audit.log({ user }, 'env.rollback', { target: env.name, detail: { from: before, to, revert, reason } });
        app.notices.tell({ kind: 'site.rollback', level: 'warn', text: `${user.name} rolled ${env.name} back to ${short(to)}.${reason ? ` Reason: ${reason}` : ''}`, link: '#/environments', to: 'editors' });
      },
      onFail: async () => audit.log({ user }, 'env.rollback', { ok: false, target: env.name, detail: { from: before, to, revert } }),
    });
    ctx.status = 202;
    return { job, from: before, to: back };
  }

  /** Push what is live to the shared remote (a soft step: the site is live already; a miss is a warning). */
  async function pushLive(step, sha) {
    if (!sha || !(await ops.hasRemote())) return;
    const branch = await ops.branch();
    await step('push', async (log) => {
      const r = await ops.push(sha, branch);
      log(r.ok ? `pushed ${short(sha)} to ${env.remote}/${branch}\n` : `${r.stderr}\n[markstage] ${env.remote}/${branch} has commits this server does not have: sync first, then the next deploy pushes.\n`);
      return r.ok ? 0 : 1;
    }, { soft: true });
  }

  return { run, rollback, pushLive };
}
