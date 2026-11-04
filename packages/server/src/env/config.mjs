// Config for Environments (docs/ENVIRONMENTS.md "Configuration"): which environment this server is, and the AI
// wording of a promotion's summary. Both live in the server's config.json (in the data dir), never in the repo.
//
//   environment: {name, branch, upstream, promoteTo, ribbon, remote, peers: {<env>: {branch, origin}},
//                 previews: {branches, host}, mail: 'sink'|'actor', gate, keep: [purge|indexNow|webhook|slack|webhooks]}
//   ai: {provider: 'anthropic', model, keyFile, endpoint?, perMinute?, perDay?}   the key: MARKSTAGE_AI_KEY or keyFile
//       (outside the repo), for the promotion summary and the AI suggestions (ai/, docs/API-AI.md)
//
// A server with no `environment` is production on the branch it has checked out. Every other environment is safe
// by default: noindex on every answer, mail only to the sink or to the person who did it, forms say "Test form:
// not sent", no CDN purge, IndexNow, Slack or webhook unless `keep` lists them, and the site behind sign-in (gate).
import path from 'node:path';

const NAME = /^[a-z][a-z0-9-]{0,29}$/;
// a branch name git accepts, and nothing a shell or a ref expression could read as more
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]{1,100}(?<![./])$/;
// `webhooks`: the site's own webhooks (webhooks/), besides the alert `webhook`
const KEEP = ['purge', 'indexNow', 'webhook', 'slack', 'webhooks'];
const MODELS = /^claude-[a-z0-9.-]{1,60}$/;

export const isBranch = (b) => typeof b === 'string' && BRANCH.test(b) && !b.endsWith('.lock');

/** The environment this server is, checked; `loopback(host)` and `production` (NODE_ENV) come from config.mjs. */
export function checkEnvironment(e, { fail, isLoopback, production }) {
  if (e === undefined || e === null) {
    return Object.freeze({ name: 'production', production: true, branch: null, upstream: null, promoteTo: null, ribbon: null, remote: 'origin', peers: {}, previews: null, mail: 'real', gate: false, keep: KEEP, configured: false });
  }
  if (typeof e !== 'object' || Array.isArray(e)) fail('environment must be an object like { "name": "staging", "branch": "staging" }.');
  const known = ['name', 'branch', 'upstream', 'promoteTo', 'ribbon', 'remote', 'peers', 'previews', 'mail', 'gate', 'keep'];
  const odd = Object.keys(e).filter((k) => !known.includes(k));
  if (odd.length) fail(`environment has keys it does not know: ${odd.join(', ')} (it takes ${known.join(', ')}).`);
  if (!NAME.test(e.name ?? '')) fail('environment.name must be a short lowercase name such as "staging" or "production".');
  const prod = e.name === 'production';
  if (!isBranch(e.branch)) fail('environment.branch must be the git branch this server runs, such as "main" or "staging".');
  for (const k of ['upstream']) if (e[k] !== undefined && e[k] !== null && !isBranch(e[k])) fail(`environment.${k} must be a branch name.`);
  if (e.promoteTo !== undefined && e.promoteTo !== null && (!NAME.test(e.promoteTo) || e.promoteTo === e.name)) fail('environment.promoteTo must be another environment\'s name, such as "production".');
  if (e.ribbon !== undefined && e.ribbon !== null && !/^#[0-9a-f]{6}$/i.test(e.ribbon)) fail('environment.ribbon must be a colour like "#b45309".');
  const remote = e.remote ?? 'origin';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/.test(remote)) fail('environment.remote must be a git remote name such as "origin".');
  const peers = {};
  for (const [name, p] of Object.entries(e.peers ?? {})) {
    if (!NAME.test(name) || name === e.name) fail(`environment.peers: "${name}" must be another environment's name.`);
    if (!p || !isBranch(p.branch)) fail(`environment.peers.${name}.branch must be its branch name.`);
    let origin = null;
    if (p.origin !== undefined && p.origin !== null) {
      try {
        origin = new URL(p.origin);
      } catch {
        fail(`environment.peers.${name}.origin is not a URL.`);
      }
      if (origin.origin !== String(p.origin).replace(/\/+$/, '')) fail(`environment.peers.${name}.origin must be an origin only (https://cms.example.com).`);
      if (origin.protocol !== 'https:' && (production || !isLoopback(origin.hostname))) fail(`environment.peers.${name}.origin must be https.`);
    }
    peers[name] = { branch: p.branch, origin: origin?.origin ?? null };
  }
  if (e.promoteTo && !peers[e.promoteTo]) fail(`environment.promoteTo "${e.promoteTo}" must be listed in environment.peers with its branch.`);
  let previews = null;
  if (e.previews !== undefined && e.previews !== null) {
    const pv = e.previews;
    if (prod) fail('Branch previews belong on staging, not production.');
    if (typeof pv !== 'object' || typeof pv.host !== 'string' || !/^\{branch\}\.[a-z0-9.-]+(:\d+)?$/i.test(pv.host)) fail('environment.previews.host must be like "{branch}.staging.example.com".');
    previews = { branches: pv.branches !== false, host: pv.host.toLowerCase() };
  }
  const mail = prod ? 'real' : (e.mail ?? 'actor');
  if (!prod && !['sink', 'actor'].includes(mail)) fail('environment.mail is "sink" (mail goes to a local catcher) or "actor" (only to the person who did it).');
  const keep = e.keep ?? (prod ? KEEP : []);
  if (!Array.isArray(keep) || keep.some((k) => !KEEP.includes(k))) fail(`environment.keep lists what stays on outside production: ${KEEP.join(', ')}.`);
  return Object.freeze({
    name: e.name,
    production: prod,
    branch: e.branch,
    upstream: e.upstream ?? null,
    promoteTo: e.promoteTo ?? null,
    ribbon: e.ribbon ?? (prod ? null : '#b45309'),
    remote,
    peers,
    previews,
    mail,
    gate: prod ? false : e.gate !== false,
    keep: prod ? KEEP : keep,
    configured: true,
  });
}

/** `mail: 'sink'`: the SMTP host must be this machine (a catcher), so nothing leaves it. */
export function checkSinkMail(environment, notify, { fail, isLoopback }) {
  if (environment.mail !== 'sink' || !notify?.email) return;
  if (!isLoopback(notify.email.host)) fail(`environment.mail is "sink", so notify.email.host must be a mail catcher on this machine (127.0.0.1), not ${notify.email.host}.`);
}

/** Outside production, the outside world hears nothing unless `keep` says so. */
export function quietOutsideProduction(environment, { purge, indexNow, notify }) {
  if (environment.production) return { purge, indexNow, notify };
  const keep = new Set(environment.keep);
  const n = notify ? { ...notify, slack: keep.has('slack') ? notify.slack : null, webhook: keep.has('webhook') ? notify.webhook : null } : notify;
  return { purge: keep.has('purge') ? purge : null, indexNow: keep.has('indexNow') ? indexNow : null, notify: n };
}

/**
 * `ai`: the wording of a promotion's summary, and the AI suggestions (docs/API-AI.md). The key is read when it is
 * used (MARKSTAGE_AI_KEY, else keyFile), so a missing key means the plain facts and suggestions
 * off, never an error at start. `provider: 'stub'` (fixed answers, no network) is for tests only (NODE_ENV=test).
 */
export function checkAi(a, { fail, contentRoot, isInside, env }) {
  if (a === undefined || a === null) return null;
  if (typeof a !== 'object') fail('ai must be { "provider": "anthropic", "model": "claude-sonnet-5-5" } (the key: MARKSTAGE_AI_KEY).');
  const provider = a.provider ?? 'anthropic';
  if (!['anthropic', 'stub'].includes(provider)) fail('ai.provider can only be "anthropic".');
  if (provider === 'stub' && env.NODE_ENV !== 'test') fail('ai.provider "stub" gives made-up suggestions and is for tests only (NODE_ENV=test).');
  const model = a.model ?? 'claude-sonnet-5-5';
  if (!MODELS.test(model)) fail('ai.model must be a Claude model id such as "claude-sonnet-5-5".');
  if (a.keyFile !== undefined && a.keyFile !== null) {
    if (typeof a.keyFile !== 'string' || !path.isAbsolute(a.keyFile)) fail('ai.keyFile must be an absolute path.');
    if (isInside(contentRoot, path.resolve(a.keyFile))) fail('ai.keyFile must be outside the content repo: a file there can be committed, pushed and built into the site.');
  }
  if (a.key !== undefined) fail('ai takes keyFile (a file outside the repo) or MARKSTAGE_AI_KEY, never the key itself in config.json.');
  let endpoint;
  try {
    endpoint = new URL(a.endpoint ?? 'https://api.anthropic.com/v1/messages');
  } catch {
    fail('ai.endpoint is not a URL.');
  }
  if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) fail('ai.endpoint must be https.');
  const count = (k, def, max) => {
    const v = a[k] ?? def;
    if (!Number.isInteger(v) || v < 1 || v > max) fail(`ai.${k} must be a whole number from 1 to ${max}.`);
    return v;
  };
  return Object.freeze({ provider, model, keyFile: a.keyFile ?? null, keyFromEnv: Boolean(env.MARKSTAGE_AI_KEY), endpoint: endpoint.href, timeoutSeconds: Number.isFinite(a.timeoutSeconds) ? a.timeoutSeconds : 30, perMinute: count('perMinute', 10, 600), perDay: count('perDay', 200, 100_000) });
}
