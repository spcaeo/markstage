// Promotion rules (docs/ENVIRONMENTS.md "Promotion rules"): who may promote, sync, roll back or preview, from where to
// where, what may change, when, and what it requires. A pure evaluator: the caller gives the rules and one request,
// and gets the decision with its reason in plain words. Deny wins; with no rule that applies, the answer is deny.
//
//   rule: {id, name, who?: {roles?, users?, groups?}, action: [promote|sync|rollback|preview|publish-release],
//          from?: [env], to?: [env],
//          what?: {only?: [kind|glob], not?: [kind|glob], any?: [kind|glob]},
//          when?: {windows?: [{days, from: 'HH:MM', to: 'HH:MM', tz}], freezes?: [{from, until?, words?}]},
//          requires?: {approvals?: {count, roles?, users?}, checks?: 'all' | [name], stagingMinutes?, reason?: true},
//          effect: allow | allow-with-approval | deny}
//   request: {user: {id, role, name?}, action, from, to, files?: [{path, kinds}], at (ms), sha?, author?,
//             approvals?: [{userId, role, sha}], checks?: {done, passed: [name], failed: [name]} | null,
//             stagingSince? (ms), reason?}
//   decide(doc, request) -> {effect: 'allow'|'needs'|'deny', rule, words, missing: [{kind, words}], trace}
//
// `when`: a rule with windows applies only inside one of them. A freeze makes a deny rule apply (during it) and an
// allow rule not apply (during it). `what`: `only` = every file is one of these, `not` = no file is, `any` = at least
// one is (for a deny: "when the change touches config"). Kinds: pages, menus, media, content (pages, menus, media and
// data), sections, templates, styles, config, deploy, code. A release (releases/) is published from the place
// 'release' to this environment, with the action publish-release.
import { ROLES } from '../roles.mjs';

export const ACTIONS = ['promote', 'sync', 'rollback', 'preview', 'publish-release'];
export const EFFECTS = ['allow', 'allow-with-approval', 'deny'];
export const KINDS = ['pages', 'menus', 'media', 'data', 'content', 'sections', 'templates', 'styles', 'config', 'deploy', 'code'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** A glob (`*` within a folder, `**` across folders, `?` one character) as a RegExp over a repo path. */
export function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * The kinds of a repo path, for `what`. `site`: {collections: [{id, dir}], mediaDir, libraryDir, kinds?: {<kind>: [glob]}} (the
 * server config); a site's own `environment.kinds` globs come first.
 */
export function kindsOf(p, site = {}) {
  const out = new Set();
  for (const [kind, globs] of Object.entries(site.kinds ?? {})) if (globs.some((g) => globRe(g).test(p))) out.add(kind);
  if (!out.size) {
    const inDir = (d) => d && (p === d || p.startsWith(`${d.replace(/\/+$/, '')}/`));
    const col = (site.collections ?? []).find((c) => inDir(c.dir));
    if (col) out.add(/menu/i.test(col.id) ? 'menus' : 'pages');
    // the Library's shared items and their pictures are content, like the entries that use them
    else if (inDir(site.libraryDir)) out.add('data');
    else if (inDir(site.mediaDir) || /^public\/.*\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|mp4|webm)$/i.test(p)) out.add('media');
    else if (/(^|\/)menus?(\.[a-z]+)?$|(^|\/)menus?\//i.test(p) && /^src\/(data|content)\//.test(p)) out.add('menus');
    else if (/^src\/(data|content)\//.test(p)) out.add('data');
    else if (/^(deploy|\.github|docker)\/|(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml)$|^scripts\/deploy/i.test(p)) out.add('deploy');
    else if (/^(markstage|astro|vite|tailwind|postcss|keystatic|svelte|vue)\.config\.[a-z]+$|^(package(-lock)?\.json|tsconfig[^/]*\.json|\.npmrc|\.nvmrc|src\/content\.config\.[a-z]+)$/.test(p)) out.add('config');
    else if (/\.(css|scss|sass|less)$/.test(p) || /^src\/styles\//.test(p)) out.add('styles');
    else if (/(^|\/)(sections|blocks)\//.test(p)) out.add('sections');
    else if (/^src\/(layouts|pages|components)\//.test(p) || /\.(astro|svelte|vue|jsx|tsx)$/.test(p)) out.add('templates');
    else out.add('code');
  }
  if (['pages', 'menus', 'media', 'data'].some((k) => out.has(k))) out.add('content');
  return [...out];
}

const matchesFile = (f, pattern) => (KINDS.includes(pattern) ? f.kinds.includes(pattern) : globRe(pattern).test(f.path));
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

/** The day and minute of `at` in `tz`. */
function local(at, tz = 'UTC') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { day: DAYS.indexOf(parts.weekday.toLowerCase().slice(0, 3)), minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Is `at` inside the window? A window that ends before it starts runs over midnight (into the next day). */
export function inWindow(w, at) {
  const { day, minute } = local(at, w.tz);
  const days = (w.days ?? DAYS).map((d) => DAYS.indexOf(d));
  const from = hhmm(w.from ?? '00:00');
  const to = hhmm(w.to ?? '23:59');
  if (from <= to) return days.includes(day) && minute >= from && minute <= to;
  return (days.includes(day) && minute >= from) || (days.includes((day + 6) % 7) && minute <= to);
}

const inFreeze = (f, at) => at >= Date.parse(f.from) && (!f.until || at < Date.parse(f.until));
const windowWords = (w) => `${(w.days ?? DAYS).join(', ')} ${w.from ?? '00:00'}–${w.to ?? '23:59'}${w.tz && w.tz !== 'UTC' ? ` (${w.tz})` : ' UTC'}`;

/**
 * Does the rule apply to this request at all (who, action, where, what, when)? {ok, why}. Custom roles
 * (custom-roles/) ask it too, for their rules' action, what and when.
 */
/** Is the rule for this person? A `who` that names roles, people or groups (even an empty group) is for them only; no `who`: everyone. */
export function namesPerson(rule, user, groups = {}) {
  const who = rule.who ?? {};
  const named = [...(who.users ?? []), ...(who.groups ?? []).flatMap((g) => groups[g] ?? [])];
  const restricted = ['roles', 'users', 'groups'].some((k) => who[k] !== undefined);
  return !restricted || (who.roles ?? []).includes(user.role) || named.includes(user.id);
}

export function applies(rule, req, groups = {}) {
  if (!namesPerson(rule, req.user, groups)) return { ok: false, why: 'not for this person' };
  if (!rule.action.includes(req.action)) return { ok: false, why: `not for ${req.action}` };
  if (rule.from?.length && !rule.from.includes('*') && !rule.from.includes(req.from)) return { ok: false, why: `not from ${req.from}` };
  if (rule.to?.length && !rule.to.includes('*') && !rule.to.includes(req.to)) return { ok: false, why: `not to ${req.to}` };
  const what = rule.what;
  // a dry run before the change is known: a rule about what changes is left out (the plan decides it)
  if (what && !req.files) return { ok: false, why: 'depends on what the change touches' };
  if (what) {
    if (what.only?.length && !req.files.every((f) => what.only.some((p) => matchesFile(f, p)))) return { ok: false, why: `the change is not only ${what.only.join(', ')}` };
    if (what.not?.length && req.files.some((f) => what.not.some((p) => matchesFile(f, p)))) return { ok: false, why: `the change touches ${what.not.join(', ')}` };
    if (what.any?.length && !req.files.some((f) => what.any.some((p) => matchesFile(f, p)))) return { ok: false, why: `the change does not touch ${what.any.join(', ')}` };
  }
  const when = rule.when ?? {};
  if (when.windows?.length && !when.windows.some((w) => inWindow(w, req.at))) return { ok: false, why: `outside its hours (${when.windows.map(windowWords).join('; ')})`, near: true };
  if (when.freezes) {
    // a deny rule with freezes applies only during one (none listed: never yet)
    const frozen = when.freezes.find((f) => inFreeze(f, req.at));
    if (rule.effect === 'deny' && !frozen) return { ok: false, why: 'no freeze now' };
    if (rule.effect !== 'deny' && frozen) return { ok: false, why: `a freeze is on${frozen.words ? ` (${frozen.words})` : ''}`, near: true };
  }
  return { ok: true, why: 'applies' };
}

/** The approvals an allowing rule asks for ({count, roles?, users?}), or null. */
const approvalsOf = (rule) => rule.requires?.approvals ?? (rule.effect === 'allow-with-approval' ? { count: 1, roles: ['owner', 'administrator'] } : null);
/** Does an approval by this person count under `spec`? (No roles or people named: anyone's.) */
const countsUnder = (spec, user) => (!spec.roles?.length && !spec.users?.length) || Boolean(spec.roles?.includes(user.role)) || Boolean(spec.users?.includes(user.id));

/**
 * Could this person's approval count for `action` under some rule? Only then may they approve (review 3 Nov 2026,
 * S10): an approval no rule would count only misleads the list.
 */
export function mayApprove(doc, action, user) {
  return (doc?.rules ?? []).some((rule) => rule.effect !== 'deny' && rule.action?.includes(action) && approvalsOf(rule) && countsUnder(approvalsOf(rule), user));
}

/** What an allowing rule still needs before it allows: [{kind, words}]. */
function missingFor(rule, req) {
  const out = [];
  const r = rule.requires ?? {};
  const approvals = approvalsOf(rule);
  if (approvals) {
    const valid = (req.approvals ?? []).filter((a) => a.sha === req.sha && a.userId !== req.author && ((!approvals.roles?.length && !approvals.users?.length) || approvals.roles?.includes(a.role) || approvals.users?.includes(a.userId)));
    const have = new Set(valid.map((a) => a.userId)).size;
    if (have < approvals.count) {
      const left = approvals.count - have;
      // one more: "from an owner or an administrator"; more: "from owners or administrators"
      const one = (x) => `${/^[aeiou]/.test(x) ? 'an' : 'a'} ${x}`;
      const from = [...(approvals.roles ?? []).map((x) => (left === 1 ? one(x) : `${x}s`)), ...(approvals.users?.length ? [left === 1 ? 'one of the people the rule names' : 'the people the rule names'] : [])].join(' or ') || 'anyone';
      out.push({ kind: 'approval', words: `${left} more approval${left === 1 ? '' : 's'} of this exact version from ${from} (not the author)` });
    }
  }
  if (r.checks) {
    const c = req.checks;
    const needed = r.checks === 'all' ? null : r.checks;
    if (!c?.done) out.push({ kind: 'check', words: 'the checks have not finished' });
    else {
      const failed = (c.failed ?? []).filter((n) => !needed || needed.includes(n));
      const notRun = needed ? needed.filter((n) => !(c.passed ?? []).includes(n) && !(c.failed ?? []).includes(n)) : [];
      if (failed.length) out.push({ kind: 'check', words: `failed checks: ${failed.join(', ')}` });
      if (notRun.length) out.push({ kind: 'check', words: `checks not run: ${notRun.join(', ')}` });
    }
  }
  if (r.stagingMinutes) {
    const on = req.stagingSince ? (req.at - req.stagingSince) / 60_000 : -1;
    if (on < r.stagingMinutes) out.push({ kind: 'staging-time', words: on < 0 ? `this version has not been on staging (it must be there ${r.stagingMinutes} minutes first)` : `${Math.ceil(r.stagingMinutes - on)} more minutes on staging (${r.stagingMinutes} in all)` });
  }
  if (r.reason && !String(req.reason ?? '').trim()) out.push({ kind: 'reason', words: 'a reason' });
  return out;
}

const label = (rule) => ({ id: rule.id, name: rule.name });

export function decide(doc, req) {
  const rules = doc?.rules ?? [];
  const groups = doc?.groups ?? {};
  const trace = [];
  const hits = [];
  // the first allow that would apply but for its hours or a freeze: named when nothing else does
  let near = null;
  for (const rule of rules) {
    const a = applies(rule, req, groups);
    trace.push({ rule: rule.id, matched: a.ok, why: a.why });
    if (a.ok) hits.push(rule);
    else if (a.near) near ??= { rule, why: a.why };
  }
  const deny = hits.find((r) => r.effect === 'deny');
  if (deny) return { effect: 'deny', rule: label(deny), words: `Refused by the rule “${deny.name}”${deny.when?.freezes?.length ? `: ${deny.when.freezes.find((f) => inFreeze(f, req.at))?.words ?? 'a freeze is on'}` : ''}.`, missing: [], trace };
  const allows = hits.map((rule) => ({ rule, missing: missingFor(rule, req) }));
  const ok = allows.find((x) => !x.missing.length);
  if (ok) return { effect: 'allow', rule: label(ok.rule), words: `Allowed by the rule “${ok.rule.name}”.`, missing: [], trace };
  if (allows.length) {
    const best = allows.reduce((a, b) => (b.missing.length < a.missing.length ? b : a));
    return { effect: 'needs', rule: label(best.rule), words: `The rule “${best.rule.name}” allows it once it has: ${best.missing.map((m) => m.words).join('; ')}.`, missing: best.missing, trace };
  }
  return { effect: 'deny', rule: near ? label(near.rule) : null, words: near ? `Not now: the rule “${near.rule.name}” would allow it, but it is ${near.why}.` : `No rule lets ${req.user.name ?? `a ${req.user.role}`} ${req.action} from ${req.from} to ${req.to}${req.files ? ' with this change' : ''}.`, missing: [], trace };
}

/** The rules a new site starts with (docs/ENVIRONMENTS.md "Starter rules"). */
export const STARTER = Object.freeze({
  groups: { developers: [], hotfix: [] },
  rules: [
    { id: 'developers-to-staging', name: 'Developers promote any branch to staging', who: { roles: ['owner', 'administrator'], groups: ['developers'] }, action: ['promote', 'preview'], from: ['branch'], to: ['staging'], effect: 'allow' },
    { id: 'staging-to-production', name: 'Staging to production needs the owner or an administrator, and every check', who: { roles: ['owner', 'administrator'] }, action: ['promote'], from: ['staging'], to: ['production'], requires: { checks: 'all' }, effect: 'allow' },
    { id: 'hotfix-named-only', name: 'Hotfixes only by the people named, with a reason and every check', who: { groups: ['hotfix'] }, action: ['promote'], from: ['branch'], to: ['production'], requires: { checks: 'all', reason: true }, effect: 'allow' },
    { id: 'sync-down', name: 'Editors and above bring production content down', who: { roles: ['owner', 'administrator', 'editor'] }, action: ['sync'], from: ['production', 'staging'], to: ['staging', 'branch'], effect: 'allow' },
    { id: 'rollback', name: 'The owner and administrators roll back', who: { roles: ['owner', 'administrator'] }, action: ['rollback'], effect: 'allow' },
    { id: 'releases', name: 'Editors and above publish releases', who: { roles: ['owner', 'administrator', 'editor'] }, action: ['publish-release'], from: ['release'], effect: 'allow' },
    { id: 'owner-freeze', name: 'Nobody puts changes live on production during a freeze the owner set', action: ['promote', 'publish-release'], to: ['production'], when: { freezes: [] }, effect: 'deny' },
  ],
});

/**
 * Check a rules document (PUT env/rules), in plain words. `users`: the ids that exist; `envs`: the environment names
 * a rule may name (plus 'branch', 'local', 'release' and '*'). Returns the clean document; throws via `fail(words)`.
 */
export function checkRules(doc, { users = [], envs = [], fail }) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.rules)) fail('The rules must be {groups, rules: [...]}.');
  const known = new Set(users);
  const places = new Set(['branch', 'local', 'release', '*', ...envs]);
  const groups = {};
  for (const [g, ids] of Object.entries(doc.groups ?? {})) {
    if (!ID.test(g)) fail(`"${g}" is not a group name (lowercase letters, digits and dashes).`);
    if (!Array.isArray(ids) || ids.some((x) => !known.has(x))) fail(`Group ${g}: the people must be users of this site.`);
    groups[g] = [...new Set(ids)];
  }
  const ids = new Set();
  const list = doc.rules.map((r, i) => {
    const at = `Rule ${i + 1}${r?.name ? ` (“${r.name}”)` : ''}`;
    if (!r || typeof r !== 'object') fail(`${at} must be an object.`);
    if (!ID.test(r.id ?? '') || ids.has(r.id)) fail(`${at}: id must be unique, lowercase letters, digits and dashes.`);
    ids.add(r.id);
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 120) fail(`${at}: give it a name (at most 120 characters).`);
    if (!EFFECTS.includes(r.effect)) fail(`${at}: effect is ${EFFECTS.join(', ')}.`);
    if (!Array.isArray(r.action) || !r.action.length || r.action.some((a) => !ACTIONS.includes(a))) fail(`${at}: action is a list of ${ACTIONS.join(', ')}.`);
    for (const k of ['from', 'to']) if (r[k] !== undefined && (!Array.isArray(r[k]) || r[k].some((e) => !places.has(e)))) fail(`${at}: ${k} is a list of ${[...places].join(', ')}.`);
    const who = r.who ?? {};
    if (who.roles !== undefined && (!Array.isArray(who.roles) || who.roles.some((x) => !ROLES.includes(x)))) fail(`${at}: who.roles is a list of ${ROLES.join(', ')}.`);
    if (who.users !== undefined && (!Array.isArray(who.users) || who.users.some((x) => !known.has(x)))) fail(`${at}: who.users must be users of this site.`);
    if (who.groups !== undefined && (!Array.isArray(who.groups) || who.groups.some((g) => !(g in groups)))) fail(`${at}: who.groups must be groups defined here.`);
    for (const k of ['only', 'not', 'any']) {
      const v = r.what?.[k];
      if (v !== undefined && (!Array.isArray(v) || v.some((p) => typeof p !== 'string' || !p || p.length > 200))) fail(`${at}: what.${k} is a list of kinds (${KINDS.join(', ')}) or paths like "src/layouts/**".`);
    }
    for (const w of r.when?.windows ?? []) {
      if (w.days !== undefined && (!Array.isArray(w.days) || w.days.some((d) => !DAYS.includes(d)))) fail(`${at}: a window's days are ${DAYS.join(', ')}.`);
      if ((w.from !== undefined && !HHMM.test(w.from)) || (w.to !== undefined && !HHMM.test(w.to))) fail(`${at}: a window's from and to are times like "08:00".`);
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: w.tz ?? 'UTC' });
      } catch {
        fail(`${at}: "${w.tz}" is not a time zone (like "America/Toronto").`);
      }
    }
    for (const f of r.when?.freezes ?? []) if (!Date.parse(f.from) || (f.until && !(Date.parse(f.until) > Date.parse(f.from)))) fail(`${at}: a freeze needs a from date, and an until after it (or none: until lifted).`);
    const q = r.requires ?? {};
    if (q.approvals !== undefined && (!Number.isInteger(q.approvals.count) || q.approvals.count < 1 || q.approvals.count > 10)) fail(`${at}: requires.approvals.count is 1 to 10.`);
    if (q.approvals?.roles !== undefined && q.approvals.roles.some((x) => !ROLES.includes(x))) fail(`${at}: requires.approvals.roles is a list of roles.`);
    if (q.approvals?.users !== undefined && q.approvals.users.some((x) => !known.has(x))) fail(`${at}: requires.approvals.users must be users of this site.`);
    if (q.checks !== undefined && q.checks !== 'all' && (!Array.isArray(q.checks) || q.checks.some((c) => typeof c !== 'string'))) fail(`${at}: requires.checks is "all" or a list of check names.`);
    if (q.stagingMinutes !== undefined && (!Number.isInteger(q.stagingMinutes) || q.stagingMinutes < 1 || q.stagingMinutes > 43200)) fail(`${at}: requires.stagingMinutes is 1 to 43200.`);
    return structuredClone(r);
  });
  return { groups, rules: list };
}
