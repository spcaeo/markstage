// The Environments screens' words, with no DOM: a plan's status and title, which side a conflict's choice keeps, a
// rule as a sentence people read ("Owners or administrators may promote from staging to production"), and whether a
// plan can run now. Kept apart so test/environments.test.ts checks them.
import type { Plan, PlanStatus, Rule } from './api';
import { fmtDateTime } from '../dates';

export const STATUS_WORDS: Record<PlanStatus, string> = {
  preparing: 'Preparing',
  conflicts: 'Conflicts to decide',
  ready: 'Ready',
  blocked: 'Blocked by a check',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  stale: 'Out of date',
  expired: 'Expired',
};
/** the statuses a plan can still move on from */
export const OPEN_STATUSES: PlanStatus[] = ['preparing', 'conflicts', 'ready', 'blocked', 'running'];

export const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '—');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** An environment's name as a word: 'production' → 'Production'; a plain branch is "a branch", a release "a release". */
export const envWord = (name: string) => (name === 'branch' ? 'a branch' : name === 'local' ? 'a laptop' : name === 'release' ? 'a release' : name === '*' ? 'anywhere' : cap(name));

/** Where a plan comes from, in words: the environment, or the branch when it is not one. */
export const fromWord = (p: Pick<Plan, 'from'>) => (p.from.env === 'branch' ? p.from.branch : envWord(p.from.env));

/** "Promote staging to Production", "Sync Production into Staging", "Promote my-change to Staging". */
export function planTitle(p: Pick<Plan, 'action' | 'from' | 'to'>): string {
  return p.action === 'sync' ? `Sync ${fromWord(p)} into ${envWord(p.to.env)}` : `Promote ${fromWord(p)} to ${envWord(p.to.env)}`;
}

/** A conflict's two choices: keep this environment's text (ours) or take the incoming one (theirs). */
export function sideWord(p: Pick<Plan, 'from' | 'to'>, side: 'ours' | 'theirs'): string {
  return side === 'ours' ? `${envWord(p.to.env)}’s` : `${fromWord(p)}’s`;
}

export const ROLE_PLURAL: Record<string, string> = { owner: 'the owner', administrator: 'administrators', editor: 'editors', author: 'authors', contributor: 'contributors' };
export const ACTION_WORDS: Record<string, string> = { promote: 'promote', sync: 'sync', rollback: 'roll back', preview: 'preview', 'publish-release': 'publish a release' };
export const KIND_WORDS: Record<string, string> = {
  pages: 'pages',
  menus: 'menus',
  media: 'media',
  data: 'data files',
  content: 'any content',
  sections: 'sections',
  templates: 'templates',
  styles: 'styles',
  config: 'config',
  deploy: 'deploy files',
  code: 'other code',
};
const DAY_WORDS: Record<string, string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

/** "a, b or c" (or "and"). */
export function list(items: string[], last = 'or'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`;
}

type Names = (id: string) => string;

/** Who a rule is for, in words. */
export function whoWords(who: Rule['who'], name: Names): string {
  const parts = [...(who?.roles ?? []).map((r) => ROLE_PLURAL[r] ?? r), ...(who?.users ?? []).map(name), ...(who?.groups ?? []).map((g) => `the ${g} group`)];
  if (!who || !['roles', 'users', 'groups'].some((k) => who[k as keyof typeof who] !== undefined)) return 'Anyone';
  return parts.length ? cap(list(parts)) : 'Nobody (an empty list)';
}

/** A pattern of `what`: a kind in words, or the path as it is. */
const pattern = (p: string) => KIND_WORDS[p] ?? p;
const dateWords = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? fmtDateTime(t) : iso;
};

/**
 * A rule as people read it: the sentence (who may do what, from where to where) and the lines under it (what may
 * change, when, what it needs). `name` turns a user id into their name.
 */
export function ruleWords(r: Rule, name: Names): { sentence: string; lines: string[] } {
  const who = whoWords(r.who, name);
  const deny = r.effect === 'deny';
  // a deny for everyone reads "Nobody may…", for some "Editors may not…"; one with freezes holds while a freeze is set
  const nobody = deny && who === 'Anyone';
  const verb = nobody ? 'may' : deny ? 'may not' : r.effect === 'allow-with-approval' ? 'may, with an approval,' : 'may';
  // "publish a release" says where it is from already: "from a release" would say it twice
  const places = r.action.includes('publish-release') ? (r.from ?? []).filter((f) => f !== 'release') : (r.from ?? []);
  const from = places.length ? ` from ${list(places.map(envWord))}` : '';
  const to = r.to?.length ? ` to ${list(r.to.map(envWord))}` : '';
  const during = deny && r.when?.freezes ? ' while a freeze is set' : '';
  const sentence = `${nobody ? 'Nobody' : who} ${verb} ${list(r.action.map((a) => ACTION_WORDS[a] ?? a))}${from}${to}${during}.`;
  // what may change and when: limits of an allow ("Only…"), the cases a deny covers ("When…", "Except when…", "On…")
  const lines: string[] = [];
  if (r.what?.only?.length) lines.push(`${deny ? 'When' : 'Only when'} every file is ${list(r.what.only.map(pattern))}.`);
  if (r.what?.not?.length) lines.push(`${deny ? 'Except when' : 'Not when'} a file is ${list(r.what.not.map(pattern))}.`);
  if (r.what?.any?.length) lines.push(`When a file is ${list(r.what.any.map(pattern))}.`);
  for (const w of r.when?.windows ?? []) {
    const days = w.days?.length ? w.days.map((d) => DAY_WORDS[d] ?? d).join(', ') : deny ? 'every day' : 'Every day';
    lines.push(`${deny ? 'On' : 'Only'} ${days}, ${w.from ?? '00:00'} to ${w.to ?? '24:00'} (${w.tz ?? 'UTC'}).`);
  }
  if (r.when?.freezes) {
    if (!r.when.freezes.length) lines.push(r.effect === 'deny' ? 'No freeze is set now.' : 'Not during a freeze (none set).');
    for (const f of r.when.freezes) lines.push(`Freeze from ${dateWords(f.from)}${f.until ? ` until ${dateWords(f.until)}` : ' until it is lifted'}${f.words ? `: ${f.words}` : ''}.`);
  }
  const q = r.requires ?? {};
  const needs: string[] = [];
  if (q.approvals) {
    const by = [...(q.approvals.roles ?? []).map((x) => ROLE_PLURAL[x] ?? x), ...(q.approvals.users ?? []).map(name)];
    needs.push(`${q.approvals.count} approval${q.approvals.count === 1 ? '' : 's'}${by.length ? ` from ${list(by)}` : ''} (never the author’s own)`);
  }
  if (q.checks === 'all') needs.push('every check passing');
  else if (q.checks?.length) needs.push(`these checks passing: ${q.checks.join(', ')}`);
  if (q.stagingMinutes) needs.push(`${q.stagingMinutes >= 60 && q.stagingMinutes % 60 === 0 ? `${q.stagingMinutes / 60} hour${q.stagingMinutes === 60 ? '' : 's'}` : `${q.stagingMinutes} minutes`} on staging first`);
  if (q.reason) needs.push('a reason');
  if (needs.length) lines.push(`Needs ${list(needs, 'and')}.`);
  return { sentence, lines };
}

/** What a decision still needs, as one sentence: "Still needs 1 more approval … and a reason." */
export const needsWords = (missing: { words: string }[]) => (missing.length ? `Still needs ${list(missing.map((m) => m.words), 'and')}.` : '');

const NOT_READY: Partial<Record<PlanStatus, string>> = {
  preparing: 'The plan is still being prepared.',
  conflicts: 'Decide the conflicts first.',
  blocked: 'A blocking check failed: fix it on the branch, then plan it again.',
  running: 'It is running.',
  done: 'It is done.',
  failed: 'It did not go through: plan it again.',
  cancelled: 'It was cancelled.',
  stale: 'It is out of date: plan it again.',
  expired: 'It expired: plan it again.',
};

/**
 * The rules' answer in one sentence, each thing said once: "Not yet: needs 1 more approval … Rule: <its name>." An
 * allow or a deny is the rules' own words, with the rule's name when they leave it out.
 */
export function decisionWords(d: NonNullable<Plan['decision']>): string {
  const rule = d.rule && !d.words.includes(d.rule.name) ? ` Rule: ${d.rule.name}.` : '';
  if (d.effect === 'needs' && d.missing.length) return `Not yet: needs ${list(d.missing.map((m) => m.words), 'and')}.${d.rule ? ` Rule: ${d.rule.name}.` : ''}`;
  const lead = d.effect === 'allow' ? 'Allowed' : d.effect === 'deny' ? 'Not allowed' : 'Not yet';
  return `${d.words.startsWith(lead) ? '' : `${lead}. `}${d.words}${rule}`;
}

/**
 * A plan's status word as the button stands: a ready plan the rules still hold back says what it waits for
 * ("Needs approval"); "Ready" only when it can run (a reason, typed in the form, aside).
 */
export function planStatusWord(p: Pick<Plan, 'status' | 'decision'>): string {
  const d = p.decision;
  if (p.status !== 'ready' || !d || d.effect === 'allow') return STATUS_WORDS[p.status] ?? p.status;
  if (d.effect === 'deny') return 'Not allowed';
  const left = d.missing.filter((m) => m.kind !== 'reason');
  if (!left.length) return STATUS_WORDS.ready;
  return left.some((m) => m.kind === 'approval') ? 'Needs approval' : 'Not yet';
}

/** Can the person run this plan now, with the reason they typed? The server asks the rules again either way. */
export function runnable(p: Pick<Plan, 'status' | 'decision'>, reason: string): { ok: boolean; why: string } {
  if (p.status !== 'ready') return { ok: false, why: NOT_READY[p.status] ?? `The plan is ${STATUS_WORDS[p.status].toLowerCase()}.` };
  const d = p.decision;
  if (!d) return { ok: false, why: 'The rules have not answered yet.' };
  if (d.effect === 'allow') return { ok: true, why: d.words };
  if (d.effect === 'needs') {
    const left = d.missing.filter((m) => !(m.kind === 'reason' && reason.trim()));
    if (!left.length) return { ok: true, why: d.words };
    return { ok: false, why: needsWords(left) };
  }
  return { ok: false, why: d.words };
}

/** A new rule's id: unique among `taken`, from its name. */
export function ruleId(name: string, taken: string[]): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'rule';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The header badge (badge.ts): a server's environment links to #/environments and, outside production, runs a ribbon
 * across the window; a laptop (astro dev) says LOCAL and its branch, with nowhere to go and no ribbon. */
/** The place chip: where this copy of the site is, in plain words, and its colour. */
export function placeWords(info: { name: string; production: boolean; local?: boolean; branch: string | null }): { label: string; tone: 'grey' | 'amber' | 'green'; title: string } {
  if (info.local) return { label: 'On my computer', tone: 'grey', title: `This copy runs on your computer${info.branch ? ` (branch ${info.branch})` : ''}. Nothing here reaches the site until it goes live.` };
  if (info.production) return { label: 'Live site', tone: 'green', title: 'This is the live site: what you publish here is what visitors see.' };
  return { label: info.name === 'staging' ? 'Staging' : info.name.charAt(0).toUpperCase() + info.name.slice(1), tone: 'amber', title: 'A copy for review. Nothing here is on the live site yet.' };
}

/** The top bar's chip, from placeWords: its words, colour, link and whether the ribbon shows. */
export function badgeWords(info: { name: string; production: boolean; local?: boolean; branch: string | null }) {
  const place = placeWords(info);
  const on = info.branch ? `, on the branch ${info.branch}` : '';
  return {
    label: place.label,
    tone: place.tone,
    branch: info.branch ?? '',
    title: info.local ? `This copy runs on your computer${on}. Nothing here is on the site until it is committed and promoted.` : `${place.label}${on}: open Staging & live`,
    aria: `Place: ${place.label}${info.branch ? `, branch ${info.branch}` : ''}`,
    link: !info.local,
    ribbon: !info.local && !info.production,
  };
}
