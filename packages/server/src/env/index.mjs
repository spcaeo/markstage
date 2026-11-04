// Environments (docs/ENVIRONMENTS.md, routes in docs/API-ENV.md): this server's environment, the branches on the
// shared remote, promotion and sync plans, rollbacks, and the promotion rules. Every signed-in person may look; what
// they may do is the rules' answer (rules.mjs), asked when a plan is made and again when it runs.
//
//   GET    /env                         this environment, its branch against the remote and upstream, the handoff
//   GET    /env/branches                the branches on the remote, each against this environment
//   POST   /env/plans                   {action: promote|sync, source?, to?, reason?} -> 202 {plan, job}
//   GET    /env/plans?status=           {plans}
//   GET    /env/plans/:pid              the plan (conflicts with both texts, checks, pages, shots, summary, decision)
//   GET    /env/plans/:pid/shots/:file  a screenshot (PNG), by its name in plan.shots ("1-1440-after.png")
//   POST   /env/plans/:pid/resolve      {conflictId, take: ours|theirs|text, text?, version}
//   POST   /env/plans/:pid/approve      {sha, note?}
//   POST   /env/plans/:pid/run          {reason?, version} -> 202 {plan, job} | 403 {error: 'rule', rule, words}
//   POST   /env/plans/:pid/cancel       {version?}
//   POST   /env/rollback                {reason?} -> 202 {job, from, to}
//   GET    /env/rules                   {version, groups, rules, starter, kinds, actions, envs}
//   PUT    /env/rules                   {version, groups, rules} (owner, administrator)
//   POST   /env/rules/check             {action, from, to, userId?, files?, at?} -> the decision with its trace
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { atLeast } from '../roles.mjs';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../util.mjs';
import { createConflictWords } from './conflicts.mjs';
import { createGitOps } from './git-ops.mjs';
import { createPlans } from './plans.mjs';
import { ACTIONS, KINDS, STARTER, checkRules, decide, kindsOf, namesPerson } from './rules.mjs';
import { createRunner } from './run.mjs';
import { createSiteGate } from './site.mjs';

const FACTS_FOR = 30_000;
/** A fetch asked for with GET /env?fetch=1 runs at most this often (review 3 Nov, S9). */
const FETCH_EVERY = 30_000;

/** The rules file: <dataDir>/promotion-rules.json (0600), the starter rules until someone saves. */
function createRulesFile(app) {
  const file = path.join(app.config.dataDir, 'promotion-rules.json');
  let cache = null;
  function read() {
    if (cache) return cache;
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = { rev: doc.rev ?? 1, groups: doc.groups ?? {}, rules: doc.rules ?? [], saved: true };
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`[markstage] ${file} could not be read (${e.message}); the starter rules apply until it is fixed.`);
      cache = { rev: 0, groups: structuredClone(STARTER.groups), rules: structuredClone(STARTER.rules), saved: false };
    }
    return cache;
  }
  function write(doc) {
    const next = { rev: read().rev + 1, groups: doc.groups, rules: doc.rules };
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
    cache = { ...next, saved: true };
    return cache;
  }
  return { get: read, write };
}

export function createEnvironments(app, deps = {}) {
  const { config } = app;
  const env = config.environment;
  const ops = createGitOps(app);
  const words = createConflictWords(app);
  const rules = createRulesFile(app);
  const plans = createPlans(app, { ops, words, rules, deps });
  const runner = createRunner(app, { ops, plans, rules, tokens: app.tokens });
  const site = createSiteGate(app, { ops, rules, plans });
  const envNames = () => [...new Set([env.name, 'production', 'staging', ...Object.keys(env.peers)])];

  const signedIn = (ctx) => {
    if (!ctx.user?.role) throw forbidden('Your account has no role on this site.');
  };

  // the git facts of the status, kept per HEAD, branch and last fetch for a short while (a boot asks for them)
  let facts = null;
  async function gitFacts(branch, head, last) {
    const key = `${branch}\0${head}\0${last.lastFetchAt}`;
    if (facts?.key === key && Date.now() - facts.at < FACTS_FOR) return facts.value;
    const remote = await ops.hasRemote();
    const own = remote ? await ops.sha(ops.remoteRef(branch)) : null;
    const upstreamHead = remote && env.upstream ? await ops.sha(ops.remoteRef(env.upstream)) : null;
    const up = await ops.counts(head, upstreamHead);
    const mine = await ops.counts(head, own);
    facts = { key, at: Date.now(), value: { remote, own, upstreamHead, up, mine } };
    return facts.value;
  }

  // Who may make this server fetch the remote, and see git's own words when that fails (review 3 Nov 2026, S9): the
  // server's own CLI (no user), administrators and owners, and anyone an allowing rule names for promote or sync.
  // Everyone else sees that a fetch failed, not git's message (it can name the remote's host and path).
  const seesGitErrors = (user) => !user || atLeast(user, 'administrator');
  function mayFetch(user) {
    if (seesGitErrors(user)) return true;
    const doc = rules.get();
    return doc.rules.some((r) => r.effect !== 'deny' && r.action?.some((a) => a === 'promote' || a === 'sync') && namesPerson(r, user, doc.groups));
  }
  const fetchWords = (user, last) => (last.error && !seesGitErrors(user) ? 'The remote could not be reached. An administrator can see why.' : last.error);
  /** ?fetch=1: for those who may, and at most once per FETCH_EVERY for the whole server. */
  async function fetchIfAsked(ctx) {
    if (ctx.query.get('fetch') !== '1') return;
    if (!mayFetch(ctx.user)) throw forbidden('Only people who can promote or sync can check the remote now. It is checked when a plan is made.');
    const at = Date.parse(ops.lastFetch().lastFetchAt ?? '');
    if (Number.isFinite(at) && app.clock() - at < FETCH_EVERY && app.clock() >= at) return;
    await ops.fetch();
  }

  async function status(ctx) {
    await fetchIfAsked(ctx);
    const branch = await ops.branch();
    const head = await app.git.head();
    const last = ops.lastFetch();
    const { remote, own, upstreamHead, up, mine } = await gitFacts(branch, head, last);
    const target = env.promoteTo ? env.peers[env.promoteTo] : null;
    return {
      name: env.name,
      production: env.production,
      configured: env.configured,
      branch,
      upstream: env.upstream,
      promoteTo: env.promoteTo,
      ribbon: env.ribbon,
      head,
      live: app.jobs.liveHead(),
      upstreamHead,
      // against the upstream: what this environment has that it has not (ahead), and what it would bring down (behind)
      ahead: up.ahead,
      behind: up.behind,
      remote: { name: env.remote, ok: remote ? last.ok : false, lastFetchAt: last.lastFetchAt, error: remote ? fetchWords(ctx.user, last) : `No remote named "${env.remote}".`, head: own, ahead: mine.ahead, behind: mine.behind },
      // whether this person may ask for a fresh check (?fetch=1), so the screen offers it only to them
      canFetch: mayFetch(ctx.user),
      peers: Object.entries(env.peers).map(([name, p]) => ({ name, branch: p.branch, origin: p.origin })),
      previews: env.previews ? { on: env.previews.branches, host: env.previews.host } : null,
      mail: env.mail,
      gate: env.gate,
      // staging -> production: the plan is made on production's server; this opens it there, pre-filled (no secrets)
      handoff: target?.origin ? { to: env.promoteTo, url: `${target.origin}${config.basePath}/#/environments?plan=promote&source=${encodeURIComponent(branch)}&sha=${head ?? ''}` } : null,
      canRollback: Boolean(config.commands.rollback) && app.jobs.liveHistory().length > 0,
    };
  }

  async function branches(ctx) {
    const head = await app.git.head();
    const list = await ops.branches();
    const out = [];
    for (const b of list.slice(0, 200)) out.push({ ...b, env: plans.envOfBranch(b.name), ...(await ops.counts(head, b.sha)) });
    const last = ops.lastFetch();
    return { branches: out, remote: env.remote, lastFetch: { ...last, error: fetchWords(ctx?.user, last) } };
  }

  function rulesView() {
    const r = rules.get();
    return { version: `r${r.rev}`, saved: r.saved, groups: r.groups, rules: r.rules, starter: STARTER, kinds: KINDS, actions: ACTIONS, envs: envNames(), people: app.users.list().filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name, role: u.role })) };
  }

  function putRules(ctx) {
    if (!atLeast(ctx.user, 'administrator')) throw forbidden('Only the owner and administrators change the promotion rules.');
    const now = rules.get();
    if (ctx.body.version !== `r${now.rev}`) throw conflict('The rules changed since you loaded them.', { current: rulesView() });
    const clean = checkRules(ctx.body, { users: app.users.list().map((u) => u.id), envs: envNames(), fail: (w) => { throw badRequest(w); } });
    const before = new Map(now.rules.map((r) => [r.id, JSON.stringify(r)]));
    const after = new Map(clean.rules.map((r) => [r.id, JSON.stringify(r)]));
    const diff = { added: [...after.keys()].filter((k) => !before.has(k)), removed: [...before.keys()].filter((k) => !after.has(k)), changed: [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k)), groups: JSON.stringify(now.groups) !== JSON.stringify(clean.groups) };
    rules.write(clean);
    app.audit.log(ctx, 'env.rules', { target: 'promotion-rules', detail: diff });
    const parts = [diff.added.length && `added ${diff.added.join(', ')}`, diff.removed.length && `removed ${diff.removed.join(', ')}`, diff.changed.length && `changed ${diff.changed.join(', ')}`, diff.groups && 'changed the groups'].filter(Boolean);
    app.notices.tell({ kind: 'env.rules-changed', level: 'warn', text: `${ctx.user.name} changed the promotion rules on ${env.name}${parts.length ? `: ${parts.join('; ')}` : ''}.`, link: '#/settings/environments/rules', to: 'administrators' });
    return rulesView();
  }

  /** A dry run: what the rules say for this person (or another, for an administrator) and request, with the trace. */
  function checkRequest(ctx) {
    const b = ctx.body ?? {};
    let user = ctx.user;
    if (b.userId && b.userId !== ctx.user.id) {
      if (!atLeast(ctx.user, 'administrator')) throw forbidden('Only the owner and administrators ask for someone else.');
      const u = app.users.get(b.userId);
      if (!u) throw notFound('No such user.');
      user = app.users.toPublic(u);
    }
    if (!ACTIONS.includes(b.action)) throw badRequest(`That is not something a rule can allow or stop. The actions are: ${ACTIONS.join(', ')}.`);
    const at = b.at ? Date.parse(b.at) : app.clock();
    if (!Number.isFinite(at)) throw badRequest('at is a date and time like "2026-10-30T16:00:00Z".');
    const site = { collections: config.collections, mediaDir: config.media.dir, libraryDir: config.library?.dir, kinds: app.site?.environment?.kinds };
    const files = Array.isArray(b.files) ? b.files.slice(0, 5000).map((p) => ({ path: String(p), kinds: kindsOf(String(p), site) })) : null;
    const doc = b.rules ? checkRules(b.rules, { users: app.users.list().map((u) => u.id), envs: envNames(), fail: (w) => { throw badRequest(w); } }) : rules.get();
    const d = decide(doc, { user, action: b.action, from: b.from ?? 'branch', to: b.to ?? env.name, files, at, reason: b.reason ?? null, checks: b.checks ?? null, approvals: [], sha: null, author: user.id });
    return { ...d, user: { id: user.id, name: user.name, role: user.role }, files };
  }

  function routes(router) {
    router.add('GET', '/env', (ctx) => (signedIn(ctx), status(ctx)));
    router.add('GET', '/env/branches', (ctx) => (signedIn(ctx), branches(ctx)));
    router.add('POST', '/env/plans', (ctx) => (signedIn(ctx), plans.create(ctx, ctx.body ?? {})));
    router.add('GET', '/env/plans', (ctx) => (signedIn(ctx), plans.list(ctx, ctx.query.get('status') || null)));
    router.add('GET', '/env/plans/:pid', (ctx) => (signedIn(ctx), plans.get(ctx, ctx.params.pid)));
    // a param never holds a dot (http.mjs), so the extension is part of the pattern: "1-1440-after.png"
    router.add('GET', '/env/plans/:pid/shots/:file.png', async (ctx) => {
      signedIn(ctx);
      const file = plans.shot(ctx.params.pid, `${ctx.params.file}.png`);
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', 'image/png');
      ctx.res.setHeader('Cache-Control', 'private, max-age=3600');
      await pipeline(fs.createReadStream(file), ctx.res);
    });
    router.add('POST', '/env/plans/:pid/resolve', (ctx) => (signedIn(ctx), plans.resolve(ctx, ctx.params.pid, ctx.body ?? {})));
    router.add('POST', '/env/plans/:pid/approve', (ctx) => (signedIn(ctx), plans.approve(ctx, ctx.params.pid, ctx.body ?? {})));
    router.add('POST', '/env/plans/:pid/run', (ctx) => (signedIn(ctx), runner.run(ctx, ctx.params.pid, ctx.body ?? {})));
    router.add('POST', '/env/plans/:pid/cancel', (ctx) => (signedIn(ctx), plans.cancel(ctx, ctx.params.pid, ctx.body ?? {})));
    router.add('POST', '/env/rollback', (ctx) => (signedIn(ctx), runner.rollback(ctx, ctx.body ?? {})));
    router.add('GET', '/env/rules', (ctx) => (signedIn(ctx), rulesView()));
    router.add('PUT', '/env/rules', (ctx) => {
      if (ctx.token) throw forbidden('The rules are changed in the editor, not with a token.');
      return putRules(ctx);
    });
    router.add('POST', '/env/rules/check', (ctx) => (signedIn(ctx), checkRequest(ctx)));
    site.routes(router);
  }

  return { routes, status, plans, runner, ops, rules, site, pushLive: (step, sha) => runner.pushLive(step, sha), HttpError };
}
