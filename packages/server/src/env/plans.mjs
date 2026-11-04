// Promotion and sync plans (docs/ENVIRONMENTS.md, docs/API-ENV.md): what a branch would bring to this environment,
// worked out before anything changes. A plan is prepared in a job: fetch the shared remote, compare, merge with no
// working copy (git merge-tree), clear what the content-aware merge can, and name the rest as conflicts. Once no
// conflict is open, the merge commit is made (on no branch), built in a throwaway work tree, checked, compared page
// by page with the live build, shot before and after, and summed up. Nothing reaches this environment's branch
// until the plan is run (run.mjs).
//
// The target server owns the plan: `to` is always this environment. A plan expires 7 days after it was made, and
// goes stale when this environment's branch moves (an editor published): "Re-plan" makes a fresh one.
import fs from 'node:fs';
import path from 'node:path';
import { atLeast } from '../roles.mjs';
import { runCommand } from '../jobs.mjs';
import { entryEnv, parseIssues } from '../content/validate.mjs';
import { HttpError, badRequest, conflict, forbidden, newId, notFound, nowIso } from '../util.mjs';
import { isBranch } from './config.mjs';
import { GROUPS } from './conflicts.mjs';
import { comparePages, screenshots } from './pages.mjs';
import { decide } from './rules.mjs';
import { summarize } from './summary.mjs';

const DAY = 86_400_000;
export const EXPIRE_DAYS = 7;
export const STATUSES = ['preparing', 'conflicts', 'ready', 'blocked', 'running', 'done', 'failed', 'cancelled', 'stale', 'expired'];
// a plan in one of these can still go stale or expire
const OPEN = new Set(['conflicts', 'ready', 'blocked']);
const MAX_TEXT = 2 * 1024 * 1024;
const short = (s) => (s ? s.slice(0, 7) : '');

export function createPlans(app, { ops, words, rules, deps = {} }) {
  const { db, config, clock, audit, jobs } = app;
  const env = config.environment;
  const shotsDir = (id) => path.join(config.dataDir, 'env', 'plans', id, 'shots');

  function load(id) {
    const r = typeof id === 'string' ? db.prepare('SELECT * FROM env_plans WHERE id = ?').get(id) : null;
    if (!r) throw notFound('No such plan.');
    return { ...r, data: JSON.parse(r.data) };
  }

  /** Write the plan's changed columns and data; every write is a new version. */
  function save(p, changes = {}) {
    Object.assign(p, changes);
    p.rev += 1;
    db.prepare('UPDATE env_plans SET from_sha = ?, to_sha = ?, base_sha = ?, merged_sha = ?, status = ?, rev = ?, reason = ?, job_id = ?, run_job_id = ?, run_by = ?, finished_at = ?, data = ? WHERE id = ?').run(
      p.from_sha, p.to_sha, p.base_sha, p.merged_sha, p.status, p.rev, p.reason, p.job_id, p.run_job_id, p.run_by, p.finished_at, JSON.stringify(p.data), p.id,
    );
    return p;
  }

  /** A plan that has sat too long expires; one whose target branch moved goes stale. */
  async function refresh(p, head = null) {
    if (!OPEN.has(p.status)) return p;
    if (clock() >= Date.parse(p.expires_at)) return save(p, { status: 'expired', data: { ...p.data, note: `Not run within ${EXPIRE_DAYS} days. Re-plan to see what it would bring now.` } });
    const now = head ?? (await app.git.head());
    if (p.to_sha && now !== p.to_sha) return save(p, { status: 'stale', data: { ...p.data, note: `${env.name} moved since this plan was made (it is at ${short(now)}, the plan was for ${short(p.to_sha)}). Re-plan.` } });
    return p;
  }

  const approvalsOf = (p) =>
    db
      .prepare('SELECT * FROM env_approvals WHERE plan_id = ? ORDER BY at')
      .all(p.id)
      .map((a) => {
        const u = app.users.get(a.user_id);
        // the approver's role now, not when they approved (a demoted approver no longer counts)
        return { userId: a.user_id, name: u?.name ?? null, role: u && !u.disabled ? u.role : null, sha: a.sha, note: a.note, at: a.at };
      });

  function checksState(p) {
    const list = p.data.checks;
    if (!list) return { done: false, passed: [], failed: [] };
    return { done: true, passed: list.filter((c) => c.status !== 'failed').map((c) => c.id), failed: list.filter((c) => c.status === 'failed' && c.blocking).map((c) => c.id) };
  }

  /** The rules' answer for this person running this plan now. */
  function decisionFor(p, user, { reason = null, at = clock() } = {}) {
    const d = decide(rules.get(), {
      user: { id: user.id, role: user.role, name: user.name },
      action: p.action,
      from: p.from_env,
      to: p.to_env,
      files: p.data.files ? p.data.files.list.map((f) => ({ path: f.path, kinds: f.kinds })) : null,
      at,
      sha: p.merged_sha,
      author: p.author_id,
      approvals: approvalsOf(p).filter((a) => a.role).map((a) => ({ userId: a.userId, role: a.role, sha: a.sha })),
      checks: checksState(p),
      stagingSince: p.data.fromAt ? Date.parse(p.data.fromAt) : null,
      reason: reason ?? p.reason,
    });
    return { effect: d.effect, rule: d.rule, words: d.words, missing: d.missing };
  }

  /** The plan as the API shows it to `viewer` (its decision is theirs). Conflict texts only on one plan's GET. */
  function toPublic(p, viewer, { full = true } = {}) {
    const author = p.author_id ? app.users.get(p.author_id) : null;
    const runner = p.run_by ? app.users.get(p.run_by) : null;
    const files = p.data.files ?? null;
    const groups = files ? Object.fromEntries(GROUPS.map((g) => [g, files.list.filter((f) => f.group === g)])) : null;
    return {
      id: p.id,
      action: p.action,
      from: { env: p.from_env, branch: p.from_branch, sha: p.from_sha },
      to: { env: p.to_env, branch: p.to_branch, sha: p.to_sha },
      base: p.base_sha,
      merged: p.merged_sha,
      author: author ? { id: author.id, name: author.name } : null,
      createdAt: p.created_at,
      expiresAt: p.expires_at,
      status: p.status,
      note: p.data.note ?? null,
      error: p.data.error ?? null,
      version: `r${p.rev}`,
      reason: p.reason,
      job: p.job_id,
      runJob: p.run_job_id,
      runBy: runner ? { id: runner.id, name: runner.name } : null,
      finishedAt: p.finished_at,
      newer: p.data.newer ?? null,
      files: files && { count: files.list.length, groups: full ? groups : Object.fromEntries(GROUPS.map((g) => [g, groups[g].length])), autoMerged: files.autoMerged ?? [] },
      conflicts: (p.data.conflicts ?? []).map((c) => (full ? stripOids(c) : { id: c.id, path: c.path, entry: c.entry, kind: c.kind, words: c.words, resolved: c.resolved, take: c.take })),
      checks: p.data.checks ?? null,
      pages: p.data.pages ?? null,
      shots: p.data.shots ?? null,
      summary: p.data.summary ?? null,
      decision: viewer ? decisionFor(p, viewer) : null,
      approvals: approvalsOf(p).map((a) => ({ ...a, current: a.sha === p.merged_sha })),
      link: `#/environments/plans/${p.id}`,
    };
  }
  const stripOids = ({ oids, ...c }) => c;

  // ---- making a plan ----------------------------------------------------------------------------------------

  /** The environment a branch is: a peer whose branch it is, this one, or a plain branch. */
  const envOfBranch = (b) => (b === env.branch ? env.name : Object.entries(env.peers).find(([, p]) => p.branch === b)?.[0] ?? 'branch');

  async function create(ctx, body) {
    const action = body.action;
    if (!['promote', 'sync'].includes(action)) throw badRequest('action is "promote" (bring a branch up to here) or "sync" (bring content down from upstream).');
    if (body.to !== undefined && body.to !== null && body.to !== env.name) throw badRequest(`This server is ${env.name}: a plan to ${body.to} is made on that environment's server (it runs the promotion).`);
    const source = action === 'sync' ? (body.source ?? env.upstream) : body.source;
    if (!source) throw badRequest(action === 'sync' ? `${env.name} has no upstream to sync from (environment.upstream).` : 'source is the branch to promote, such as "staging" or "my-change".');
    if (!isBranch(source)) throw badRequest(`"${source}" is not a branch name.`);
    const branch = await ops.branch();
    if (source === branch) throw badRequest(`${source} is this environment's own branch.`);
    const p = { action, from_env: envOfBranch(source), from_branch: source, to_env: env.name, to_branch: branch };
    // a dry run before anything is fetched: refused now when no rule could ever let this person do it
    const dry = decide(rules.get(), { user: ctx.user, action, from: p.from_env, to: p.to_env, files: null, at: clock() });
    if (dry.effect === 'deny') {
      audit.log(ctx, `env.${action}`, { ok: false, target: `${p.from_env}->${p.to_env}`, detail: { branch: source, rule: dry.rule?.id ?? null, words: dry.words, stage: 'plan' } });
      throw new HttpError(403, 'rule', dry.words, { rule: dry.rule, words: dry.words });
    }
    const id = newId('pl');
    const now = clock();
    db.prepare('INSERT INTO env_plans (id, action, from_env, from_branch, to_env, to_branch, author_id, created_at, expires_at, status, reason, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, action, p.from_env, source, p.to_env, branch, ctx.user.id, nowIso(now), nowIso(now + EXPIRE_DAYS * DAY), 'preparing', cleanReason(body.reason), JSON.stringify({ token: ctx.token?.id ?? null }),
    );
    const plan = load(id);
    plan.job_id = prepareJob(plan, ctx.user);
    save(plan);
    audit.log(ctx, 'env.plan', { target: id, detail: { action, from: p.from_env, branch: source, to: p.to_env } });
    ctx.status = 202;
    return { plan: toPublic(plan, ctx.user), job: plan.job_id };
  }

  const cleanReason = (r) => {
    if (r === undefined || r === null) return null;
    const s = String(r).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (s.length > 500) throw badRequest('The reason is at most 500 characters.');
    return s || null;
  };

  /** The job that prepares a plan (and, with no conflict open, checks it). */
  function prepareJob(plan, user) {
    return jobs.enqueue({
      kind: 'env-plan',
      user,
      target: plan.id,
      notice: { text: (error) => `Preparing the plan ${plan.from_branch} → ${plan.to_env} failed. ${error}` },
      run: async (step) => {
        const p = load(plan.id);
        await analyse(step, p);
        if (p.status === 'preparing') await checkStage(step, p, user);
      },
      onFail: async () => failPlan(plan.id, 'Preparing it failed: see the job log.'),
    });
  }

  function failPlan(id, words) {
    const p = load(id);
    if (p.status === 'preparing') save(p, { status: 'failed', finished_at: nowIso(clock()), data: { ...p.data, error: words } });
  }

  /** Fetch, compare, dry-merge, clear what merges block by block, and name the conflicts. */
  async function analyse(step, p) {
    await step('fetch', async (log) => {
      const r = await ops.fetch();
      log(r.ok ? `fetched ${env.remote}\n` : `${r.error}\n`);
      return r.ok ? 0 : { code: 1, reason: `(the remote was not reached: ${r.error})` };
    });
    await step('compare', async (log) => {
      const from = await ops.sha(ops.remoteRef(p.from_branch));
      if (!from) throw new Error(`There is no branch "${p.from_branch}" on ${env.remote}.`);
      const to = await app.git.head();
      const base = await ops.mergeBase(to, from);
      if (!base) throw new Error(`${p.from_branch} and ${p.to_branch} share no history: they cannot be merged.`);
      const fromAt = (await app.git.git(['show', '-s', '--format=%cI', from])).stdout.trim();
      Object.assign(p, { from_sha: from, to_sha: to, base_sha: base });
      p.data.fromAt = fromAt;
      if (await ops.isAncestor(from, to)) {
        save(p, { status: 'done', finished_at: nowIso(clock()), data: { ...p.data, files: { list: [], autoMerged: [] }, conflicts: [], note: `Nothing to bring: ${p.to_env} already has everything on ${p.from_branch}.` } });
        log('nothing to bring\n');
        return 0;
      }
      const list = (await ops.changes(base, from)).map((f) => words.fileOf(f.path, f.status, f.from ? { from: f.from } : {}));
      const merge = await ops.dryMerge(to, from);
      const here = p.to_env;
      const incoming = p.from_env === 'branch' ? `the branch ${p.from_branch}` : p.from_env;
      const conflicts = [];
      const auto = [];
      for (const c of merge.conflicts) {
        const [b, o, t] = await Promise.all([ops.text(c.base), ops.text(c.ours), ops.text(c.theirs)]);
        const m = words.tryMerge(c.path, b, o, t);
        if (m?.text !== undefined) {
          auto.push({ path: c.path, text: m.text });
          continue;
        }
        const who = await ops.lastTouch(`${base}..${to}`, c.path);
        conflicts.push({ ...words.describe({ index: conflicts.length, path: c.path, base: b, ours: o, theirs: t, who, here, incoming, merge: m }), oids: { base: c.base, ours: c.ours, theirs: c.theirs } });
      }
      log(`${list.length} files; ${auto.length} merged block by block; ${conflicts.length} conflicts\n`);
      p.data = { ...p.data, files: { list, autoMerged: auto.map((a) => a.path) }, tree: merge.tree, auto, conflicts };
      save(p, { status: conflicts.length ? 'conflicts' : 'preparing' });
      return 0;
    });
  }

  /** The text each conflict was resolved to (null: the file goes). */
  async function resolutionsOf(p) {
    const out = (p.data.auto ?? []).map((a) => ({ path: a.path, text: a.text }));
    for (const c of p.data.conflicts ?? []) {
      if (c.take === 'text') out.push({ path: c.path, text: c.merged });
      else out.push({ path: c.path, text: await ops.text(c.take === 'ours' ? c.oids.ours : c.oids.theirs) });
    }
    return out;
  }

  /** Make the merge, build it in a work tree, check it, compare its pages, shoot them, and sum it all up. */
  async function checkStage(step, p, user) {
    await step('merge', async (log) => {
      const merged = await ops.commitMerge({ ours: p.to_sha, theirs: p.from_sha, tree: p.data.tree, resolutions: await resolutionsOf(p), message: `${p.action === 'sync' ? 'Sync' : 'Promote'} ${p.from_branch} (${short(p.from_sha)}) into ${p.to_env}`, author: user });
      log(`merge commit ${merged} (on no branch until the plan runs)\n`);
      save(p, { merged_sha: merged });
      return 0;
    });
    const checks = [];
    let wt = null;
    try {
      wt = await ops.worktree(p.merged_sha);
      const afterDir = config.verify?.public ? path.join(wt.dir, path.relative(config.contentRoot, config.verify.public)) : null;
      const build = config.commands.build;
      let built = !build;
      if (build) {
        await step('build', async (log) => {
          log(`$ ${build.join(' ')}   (in a work tree of ${short(p.merged_sha)})\n`);
          let out = '';
          const { code, timedOut } = await runCommand(build, { cwd: wt.dir, env: { ...config.commands.env, MARKSTAGE_BUILD_TIME: nowIso(clock()) }, timeoutSeconds: config.commands.timeoutSeconds, onOutput: (s) => (log(s), (out = (out + s).slice(-4000))) });
          built = code === 0 && !timedOut;
          checks.push({ id: 'build', label: 'The site builds', blocking: true, status: built ? 'passed' : 'failed', words: built ? 'The merged site builds.' : `The build failed${timedOut ? ' (timed out)' : ''}: ${out.trim().split('\n').slice(-3).join(' ').slice(0, 300)}` });
          return 0;
        });
      }
      await step('checks', async (log) => {
        await entryChecks(p, wt.dir, afterDir, built, checks, log);
        if (built && afterDir && config.verify?.public) {
          const pages = comparePages(config.verify.public, afterDir);
          p.data.pages = pages;
          checks.push({ id: 'redirects', label: 'Removed pages have a redirect', blocking: true, status: pages.removedWithoutRedirect.length ? 'failed' : 'passed', words: pages.removedWithoutRedirect.length ? `Removed without a redirect: ${pages.removedWithoutRedirect.slice(0, 10).join(', ')}${pages.removedWithoutRedirect.length > 10 ? ` and ${pages.removedWithoutRedirect.length - 10} more` : ''}.` : 'Every removed page has a redirect.' });
          log(`${pages.changed.length} pages changed, ${pages.added.length} added, ${pages.removed.length} removed\n`);
        } else p.data.pages = null;
        return 0;
      });
      if (built && afterDir && p.data.pages) {
        await step('screenshots', async (log) => {
          fs.rmSync(shotsDir(p.id), { recursive: true, force: true });
          const shots = await screenshots({ beforeDir: config.verify.public, afterDir, pages: p.data.pages, outDir: shotsDir(p.id), deps: deps.shots ?? {} });
          p.data.shots = shots;
          log(`${shots.words}\n`);
          return 0;
        }, { soft: true });
      } else p.data.shots = { status: 'not-available', words: built ? 'Page comparison needs verify.public (the build output folder) in the server config.' : 'No screenshots: the build failed.', pages: [] };
    } finally {
      if (wt) await wt.done();
    }
    p.data.checks = checks;
    await step('summary', async (log) => {
      p.data.summary = await summarize(config, { action: p.action, from: { env: p.from_env }, to: { env: p.to_env }, files: p.data.files, conflicts: p.data.conflicts, checks: p.data.checks, pages: p.data.pages }, deps.ai ?? {});
      log(`${p.data.summary.text}\n`);
      return 0;
    });
    const failed = checks.some((c) => c.status === 'failed' && c.blocking);
    save(p, { status: failed ? 'blocked' : 'ready' });
    tellApprovers(p);
  }

  /** The site's entry checks on every changed entry, then the after-build checks on the build. */
  async function entryChecks(p, dir, afterDir, built, checks, log) {
    const entries = [];
    for (const f of p.data.files.list) {
      if (f.status === 'removed') continue;
      const c = config.collections.find((x) => f.path.startsWith(`${x.dir.replace(/\/+$/, '')}/`) && f.path.endsWith(x.ext));
      if (!c) continue;
      const text = await ops.text(`${p.merged_sha}:${f.path}`);
      if (text !== null) entries.push({ c, id: f.path.slice(c.dir.replace(/\/+$/, '').length + 1, -c.ext.length), text });
    }
    for (const check of config.checks) {
      const afterBuild = check.after === 'build';
      if (afterBuild && !built) {
        checks.push({ id: check.id, label: check.label, blocking: check.blocking, status: 'skipped', words: 'Not run: the build failed.' });
        continue;
      }
      const bad = [];
      for (const e of entries.slice(0, 500)) {
        let out = '';
        const { code, timedOut } = await runCommand(check.command, {
          cwd: dir,
          env: { ...entryEnv(config, e.c, e.id), ...(afterBuild ? { MARKSTAGE_DIST: afterDir ?? '' } : {}) },
          timeoutSeconds: check.timeoutSeconds,
          stdin: e.text,
          onOutput: (s) => (out.length < 50_000 ? (out += s) : null),
        });
        if (code !== 0 || timedOut) bad.push({ entry: `${e.c.id}/${e.id}`, issues: parseIssues(out).slice(0, 5).map((i) => i.message) });
      }
      const status = bad.length ? (check.blocking ? 'failed' : 'warned') : 'passed';
      log(`${status} ${check.label} (${entries.length} entries)\n`);
      checks.push({ id: check.id, label: check.label, blocking: check.blocking, status, words: bad.length ? `${bad.map((b) => `${b.entry}${b.issues.length ? `: ${b.issues.join('; ')}` : ''}`).slice(0, 10).join(' · ')}` : `${entries.length} changed entr${entries.length === 1 ? 'y' : 'ies'} pass.`, entries: bad.map((b) => b.entry) });
    }
  }

  /** A ready plan that needs an approval tells the people who can give one. */
  function tellApprovers(p) {
    if (p.status !== 'ready') return;
    const author = p.author_id ? app.users.get(p.author_id) : null;
    if (!author) return;
    const d = decisionFor(p, author);
    if (d.effect !== 'needs' || !d.missing.some((m) => m.kind === 'approval')) return;
    app.notices.tell({ kind: 'env.approval-needed', level: 'info', text: `${author.name}'s ${p.action} of ${p.from_branch} to ${p.to_env} waits for an approval: ${d.missing.find((m) => m.kind === 'approval').words}.`, link: `#/environments/plans/${p.id}`, to: 'administrators' });
  }

  // ---- deciding a plan --------------------------------------------------------------------------------------

  const mayEdit = (ctx, p) => {
    if (ctx.user.id !== p.author_id && !atLeast(ctx.user, 'administrator')) throw forbidden('Only the person who made the plan, an administrator or the owner can change it.');
  };
  const checkVersion = (ctx, p, v) => {
    if (v !== `r${p.rev}`) throw conflict('The plan changed since you loaded it.', { current: toPublic(p, ctx.user) });
  };

  async function resolve(ctx, id, body) {
    const p = await refresh(load(id));
    mayEdit(ctx, p);
    checkVersion(ctx, p, body.version);
    if (!['conflicts', 'ready', 'blocked'].includes(p.status)) throw conflict(`The plan is ${p.status}: its conflicts can no longer change.`, { current: toPublic(p, ctx.user) });
    const c = (p.data.conflicts ?? []).find((x) => x.id === body.conflictId);
    if (!c) throw notFound('No such conflict in this plan.');
    if (!['ours', 'theirs', 'text'].includes(body.take)) throw badRequest(`take is "ours" (keep ${p.to_env}'s), "theirs" (take ${p.from_branch}'s) or "text" (the text you give).`);
    if (body.take === 'text' && (typeof body.text !== 'string' || body.text.length > MAX_TEXT)) throw badRequest('text is the file as it should be (at most 2 MB).');
    if (body.take !== 'text' && (body.take === 'ours' ? c.oids.ours : c.oids.theirs) === null && c.kind !== 'removed-here' && c.kind !== 'removed-incoming') throw badRequest('That side has no file.');
    Object.assign(c, { take: body.take, merged: body.take === 'text' ? body.text : null, resolved: true });
    const open = p.data.conflicts.filter((x) => !x.resolved).length;
    // a changed resolution is a different merge: it is checked again, and earlier approvals no longer match it
    const recheck = !open;
    save(p, { status: recheck ? 'preparing' : 'conflicts', merged_sha: recheck ? null : p.merged_sha, data: { ...p.data, checks: recheck ? undefined : p.data.checks, summary: recheck ? undefined : p.data.summary } });
    if (recheck) {
      const author = app.users.get(p.author_id);
      const user = author ? app.users.toPublic(author) : ctx.user;
      p.job_id = jobs.enqueue({ kind: 'env-plan', user: ctx.user, target: p.id, run: (step) => checkStage(step, load(p.id), user), onFail: async () => failPlan(p.id, 'Checking it failed: see the job log.') });
      save(p);
    }
    audit.log(ctx, 'env.resolve', { target: p.id, detail: { conflict: c.id, path: c.path, take: body.take } });
    return { plan: toPublic(p, ctx.user), job: recheck ? p.job_id : null };
  }

  async function approve(ctx, id, body) {
    const p = await refresh(load(id));
    if (p.status !== 'ready') throw conflict(`The plan is ${p.status}: only a ready plan is approved.`, { current: toPublic(p, ctx.user) });
    if (ctx.user.id === p.author_id) throw forbidden('You made this plan: someone else approves it.');
    if (body.sha !== p.merged_sha) throw conflict('The plan changed since you looked: approve the version it has now.', { current: toPublic(p, ctx.user) });
    const note = cleanReason(body.note);
    db.prepare('INSERT INTO env_approvals (plan_id, user_id, role, sha, note, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(plan_id, user_id, sha) DO UPDATE SET note = excluded.note, at = excluded.at').run(p.id, ctx.user.id, ctx.user.role, p.merged_sha, note, nowIso(clock()));
    save(p);
    audit.log(ctx, 'env.approve', { target: p.id, detail: { sha: p.merged_sha, from: p.from_sha, to: p.to_sha } });
    return { plan: toPublic(p, ctx.user) };
  }

  async function cancel(ctx, id, body) {
    const p = load(id);
    mayEdit(ctx, p);
    if (body?.version !== undefined) checkVersion(ctx, p, body.version);
    if (['running', 'done', 'cancelled'].includes(p.status)) throw conflict(`The plan is ${p.status}.`, { current: toPublic(p, ctx.user) });
    save(p, { status: 'cancelled', finished_at: nowIso(clock()) });
    audit.log(ctx, 'env.cancel', { target: p.id });
    return { plan: toPublic(p, ctx.user) };
  }

  async function get(ctx, id) {
    const p = await refresh(load(id));
    const newest = p.from_sha && OPEN.has(p.status) ? await ops.sha(ops.remoteRef(p.from_branch)) : null;
    if (newest && newest !== p.from_sha && p.data.newer !== newest) save(p, { data: { ...p.data, newer: newest } });
    return toPublic(p, ctx.user);
  }

  async function list(ctx, status) {
    if (status && !STATUSES.includes(status)) throw badRequest(`status is one of ${STATUSES.join(', ')}.`);
    const rows = status ? db.prepare('SELECT * FROM env_plans WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status) : db.prepare('SELECT * FROM env_plans ORDER BY created_at DESC LIMIT 200').all();
    const head = await app.git.head();
    const out = [];
    for (const r of rows) out.push(toPublic(await refresh({ ...r, data: JSON.parse(r.data) }, head), ctx.user, { full: false }));
    return { plans: status ? out.filter((x) => x.status === status) : out };
  }

  /** A screenshot of a plan, by its file name. */
  function shot(id, file) {
    load(id);
    if (!/^\d{1,3}-\d{3,4}-(before|after)\.png$/.test(file)) throw notFound('No such screenshot.');
    const abs = path.join(shotsDir(id), file);
    if (!fs.existsSync(abs)) throw notFound('No such screenshot.');
    return abs;
  }

  return { create, resolve, approve, cancel, get, list, shot, load, save, refresh, decisionFor, toPublic, envOfBranch, cleanReason, checksState };
}
