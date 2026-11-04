// `markstage-server env …` on the server itself (docs/API-ENV.md "Command line"): the same plans as the API, with the
// same rules, as the person named by --as (an account on this server). It refuses while the running server has a
// job going, so two builds never share the work tree.
//   env status                                   this environment against the remote and upstream
//   env sync    [--run] [--reason "…"] --as <email>
//   env promote <branch> [--run] [--reason "…"] --as <email>
import { nowIso } from '../util.mjs';

const value = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

/** Print a plan as a person reads it. */
export function planWords(p) {
  const lines = [`Plan ${p.id}: ${p.action} ${p.from.branch} (${p.from.env}) → ${p.to.env}: ${p.status}${p.note ? ` (${p.note})` : ''}`];
  if (p.summary) lines.push(`  ${p.summary.text}`);
  for (const c of p.conflicts ?? []) lines.push(`  conflict ${c.id}${c.resolved ? ` (resolved: ${c.take})` : ''}: ${c.words}`);
  for (const c of p.checks ?? []) lines.push(`  ${c.status.padEnd(7)} ${c.label}${c.status === 'passed' ? '' : `: ${c.words}`}`);
  if (p.decision) lines.push(`  ${p.decision.words}`);
  return lines.join('\n');
}

export async function envCommand(app, args, out = console.log) {
  const [sub, ...rest] = args;
  if (sub === 'status') {
    const s = await app.environments.status({ query: new URLSearchParams('fetch=1') });
    out(`${s.name}${s.production ? ' (production)' : ''} on ${s.branch} at ${s.head?.slice(0, 7) ?? '-'}; live ${s.live?.slice(0, 7) ?? '-'}`);
    out(`  remote ${s.remote.name}: ${s.remote.ok ? `fetched ${s.remote.lastFetchAt}` : `not reached (${s.remote.error})`}${s.remote.ahead || s.remote.behind ? `; ${s.remote.ahead} to push, ${s.remote.behind} not here` : ''}`);
    if (s.upstream) out(`  upstream ${s.upstream}: ${s.behind ?? '?'} commits to sync down, ${s.ahead ?? '?'} here only`);
    if (s.promoteTo) out(`  promotes to ${s.promoteTo}${s.handoff ? `: ${s.handoff.url}` : ''}`);
    return 0;
  }
  if (sub !== 'sync' && sub !== 'promote') throw new Error('Usage: markstage-server env status | sync [--run] --as <email> | promote <branch> [--run] [--reason "…"] --as <email>');
  const email = value(rest, '--as');
  const row = email ? app.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) : null;
  if (!row || row.disabled) throw new Error('Say who runs it: --as <email of an account on this server>.');
  const busy = app.db.prepare("SELECT id, kind FROM jobs WHERE status IN ('queued', 'running')").get();
  if (busy) throw new Error(`The server is running a job (${busy.kind}, ${busy.id}). Try again when it is done.`);
  const user = app.users.toPublic(row);
  const ctx = { user, ip: null, userAgent: 'markstage-server env', status: 200, query: new URLSearchParams(), params: {} };
  const source = sub === 'promote' ? rest.find((a) => !a.startsWith('--') && rest[rest.indexOf(a) - 1] !== '--as' && rest[rest.indexOf(a) - 1] !== '--reason') : undefined;
  if (sub === 'promote' && !source) throw new Error('Usage: markstage-server env promote <branch> [--run] [--reason "…"] --as <email>');
  const made = await app.environments.plans.create(ctx, { action: sub, source, reason: value(rest, '--reason') ?? null });
  await app.jobs.idle();
  let p = await app.environments.plans.get(ctx, made.plan.id);
  out(planWords(p));
  if (!rest.includes('--run')) {
    out(`\nNot run (add --run). Or open ${app.config.publicOrigin}${app.config.basePath}/#/environments/plans/${p.id}`);
    return p.status === 'ready' ? 0 : 1;
  }
  if (p.status !== 'ready') return 1;
  const r = await app.environments.runner.run(ctx, p.id, { version: p.version, reason: value(rest, '--reason') ?? null });
  await app.jobs.idle();
  const job = app.jobs.get(r.job);
  p = await app.environments.plans.get(ctx, p.id);
  out(`\n${job.status === 'succeeded' ? 'Live' : 'Not live'} at ${nowIso(app.clock())}: ${p.status}${job.error ? `. ${job.error}` : ''}`);
  return job.status === 'succeeded' ? 0 : 1;
}
