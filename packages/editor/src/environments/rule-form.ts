// One promotion rule as a form (Settings → Environments → Rules, ?rule=<id>): its name and effect, who it is for,
// the actions and the environments from and to, what may change, when, and what it needs. `read()` gives the rule as
// the server keeps it (src/env/rules.mjs), or the words of what is missing. The parts (boxes, fields, hours and
// freezes) are exported for the custom roles' rule form too (roles/rule-form.ts), whose rules share this shape.
import { el } from '../admin/ui';
import type { Rule, RulesView } from './api';
import { ACTION_WORDS, envWord, KIND_WORDS, ROLE_PLURAL } from './words';

const ROLES = ['owner', 'administrator', 'editor', 'author', 'contributor'];
const DAYS: [string, string][] = [
  ['mon', 'Mon'],
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
  ['sun', 'Sun'],
];
const EFFECTS: [Rule['effect'], string][] = [
  ['allow', 'Allow'],
  ['allow-with-approval', 'Allow with an approval'],
  ['deny', 'Deny'],
];

let seq = 0;
const uid = (k: string) => `ms-rule-${k}-${++seq}`;

/** A row of checkboxes named `name`, one per [value, label]. */
export function boxes(name: string, legend: string, options: [string, string][], on: string[] = []): HTMLFieldSetElement {
  const f = el('fieldset.ms-rule__boxes', el('legend.ms-field__label', legend));
  for (const [v, l] of options) {
    const id = uid(name);
    f.append(el('label.ms-rule__box', { for: id }, el('input', { id, type: 'checkbox', name, value: v, checked: on.includes(v) }), ` ${l}`));
  }
  return f;
}
export const ticked = (root: HTMLElement, name: string) => [...root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.value);

export function text(name: string, label: string, val = '', opts: { hint?: string; type?: string; placeholder?: string } = {}): HTMLElement {
  const id = uid(name);
  const i = el('input.ms-input', { id, name, type: opts.type ?? 'text', placeholder: opts.placeholder, spellcheck: 'false' });
  i.value = val;
  return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, label), i, opts.hint ? el('p.ms-field__hint', opts.hint) : null);
}
export const field = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!.value.trim();
export const listOf = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** An ISO time as a datetime-local value (this browser's time), and back. */
const toLocal = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '');

/** A list of rows (windows, freezes) with Add and Remove. */
export function rows(label: string, add: string, items: HTMLElement[], make: () => HTMLElement): HTMLElement {
  const list = el('div.ms-rule__rows');
  const wrap = (row: HTMLElement) => {
    const x = el('button.ms-btn.ms-btn--sm.ms-btn--quiet', { type: 'button' }, 'Remove');
    x.addEventListener('click', () => r.remove());
    const r = el('div.ms-rule__row', row, x);
    return r;
  };
  for (const it of items) list.append(wrap(it));
  const b = el('button.ms-btn.ms-btn--sm', { type: 'button' }, add);
  b.addEventListener('click', () => {
    const r = wrap(make());
    list.append(r);
    r.querySelector<HTMLElement>('input')?.focus();
  });
  return el('div.ms-rule__part', el('h4.ms-rule__h', label), list, b);
}

export function windowRow(w: NonNullable<NonNullable<Rule['when']>['windows']>[number] = {}): HTMLElement {
  const row = el('div.ms-rule__window', { 'data-window': '' }, boxes('days', 'Days', DAYS, w.days ?? []), text('wfrom', 'From', w.from ?? '08:00', { type: 'time' }), text('wto', 'To', w.to ?? '17:00', { type: 'time' }), text('tz', 'Time zone', w.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone, { placeholder: 'America/Toronto' }));
  // each row's day boxes are its own
  for (const i of row.querySelectorAll<HTMLInputElement>('input[name="days"]')) i.name = 'wday';
  return row;
}

export function freezeRow(f: NonNullable<NonNullable<Rule['when']>['freezes']>[number] = { from: '' }): HTMLElement {
  return el('div.ms-rule__freeze', { 'data-freeze': '' }, text('ffrom', 'From', toLocal(f.from) || toLocal(new Date().toISOString()), { type: 'datetime-local' }), text('funtil', 'Until (empty: until lifted)', toLocal(f.until), { type: 'datetime-local' }), text('fwords', 'Why', f.words ?? '', { placeholder: 'The launch' }));
}

/** The hours and freezes rows of `root` as a rule's `when` (null: none), or the words of what to fix. A rule that had
 *  a freeze list keeps one, empty or not (`keepFreezeList`). */
export function readWhen(root: HTMLElement, keepFreezeList: boolean): Rule['when'] | null | string {
  const windows = [...root.querySelectorAll<HTMLElement>('[data-window]')].map((w) => ({ days: ticked(w, 'wday'), from: field(w, 'wfrom'), to: field(w, 'wto'), tz: field(w, 'tz') || 'UTC' })).map((w) => (w.days.length ? w : { from: w.from, to: w.to, tz: w.tz }));
  const freezes = [...root.querySelectorAll<HTMLElement>('[data-freeze]')].map((f) => ({ from: fromLocal(field(f, 'ffrom')), until: fromLocal(field(f, 'funtil')) || null, words: field(f, 'fwords') || undefined }));
  if (freezes.some((f) => !f.from)) return 'A freeze needs the time it starts.';
  if (!windows.length && !freezes.length && !keepFreezeList) return null;
  return { ...(windows.length ? { windows } : {}), ...(freezes.length || keepFreezeList ? { freezes } : {}) };
}

export interface RuleForm {
  el: HTMLElement;
  /** the rule as the form has it, or the words of what to fix */
  read(): Rule | string;
}

export function ruleForm(r: Rule, view: RulesView, groups: string[]): RuleForm {
  const places: [string, string][] = [['branch', 'a branch'], ['local', 'a laptop'], ['release', 'a release'], ...view.envs.map((e): [string, string] => [e, envWord(e)]), ['*', 'anywhere']];
  const effect = el('select.ms-input.ms-adm-select', { id: uid('effect'), name: 'effect' });
  for (const [v, l] of EFFECTS) effect.append(el('option', { value: v, selected: v === r.effect }, l));
  const everyone = !r.who || !['roles', 'users', 'groups'].some((k) => (r.who as Record<string, unknown>)[k] !== undefined);
  const evId = uid('everyone');
  const ev = el('input', { id: evId, type: 'checkbox', name: 'everyone', checked: everyone });
  const whoBox = el('div.ms-rule__who', boxes('roles', 'Roles', ROLES.map((x) => [x, ROLE_PLURAL[x] ?? x]), r.who?.roles), view.people.length ? boxes('users', 'People', view.people.map((u) => [u.id, `${u.name} (${u.role})`]), r.who?.users) : '', groups.length ? boxes('groups', 'Groups', groups.map((g) => [g, g]), r.who?.groups) : '');
  const syncWho = () => (whoBox.hidden = ev.checked);
  ev.addEventListener('change', syncWho);
  syncWho();
  const q = r.requires ?? {};
  const checksSel = el('select.ms-input.ms-adm-select', { id: uid('checks'), name: 'checks' });
  for (const [v, l] of [['', 'None'], ['all', 'Every check'], ['some', 'These checks']]) checksSel.append(el('option', { value: v, selected: v === (q.checks === 'all' ? 'all' : q.checks?.length ? 'some' : '') }, l));
  const checkNames = text('checknames', 'Check names (comma between)', Array.isArray(q.checks) ? q.checks.join(', ') : '', { placeholder: 'build, redirects' });
  const syncChecks = () => (checkNames.hidden = checksSel.value !== 'some');
  checksSel.addEventListener('change', syncChecks);
  syncChecks();
  const kinds = view.kinds.map((k) => KIND_WORDS[k] ? `${k} (${KIND_WORDS[k]})` : k).join(', ');
  const root = el('div.ms-rule__form',
    text('name', 'Name', r.name, { placeholder: 'What the rule is for, in a few words' }),
    el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: effect.id }, 'Effect'), effect, el('p.ms-field__hint', 'Deny wins over every allow. With no rule that applies, the answer is no.')),
    el('div.ms-rule__part', el('h4.ms-rule__h', 'Who'), el('label.ms-rule__box', { for: evId }, ev, ' Everyone'), whoBox),
    boxes('action', 'Does what', view.actions.map((a) => [a, ACTION_WORDS[a] ?? a]), r.action),
    el('div.ms-rule__pair', boxes('from', 'From (none ticked: from anywhere)', places, r.from), boxes('to', 'To (none ticked: to anywhere)', places.filter(([v]) => v !== 'branch' && v !== 'local' && v !== 'release'), r.to)),
    el('div.ms-rule__part', el('h4.ms-rule__h', 'What may change'), el('p.ms-field__hint', `Kinds or paths like src/layouts/**, a comma between. Kinds: ${kinds}.`),
      text('only', 'Only when every file is', (r.what?.only ?? []).join(', ')),
      text('not', 'Not when a file is', (r.what?.not ?? []).join(', ')),
      text('any', 'When at least one file is', (r.what?.any ?? []).join(', '))),
    rows('Only in these hours', 'Add hours', (r.when?.windows ?? []).map((w) => windowRow(w)), () => windowRow()),
    rows('Freezes', 'Add a freeze', (r.when?.freezes ?? []).map((f) => freezeRow(f)), () => freezeRow()),
    el('div.ms-rule__part', el('h4.ms-rule__h', 'Needs'),
      text('approvals', 'Approvals (0: none)', String(q.approvals?.count ?? 0), { type: 'number' }),
      boxes('approvers', 'Approved by (none ticked: anyone but the author)', ROLES.map((x) => [x, ROLE_PLURAL[x] ?? x]), q.approvals?.roles),
      el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: checksSel.id }, 'Checks that must pass'), checksSel), checkNames,
      text('staging', 'Minutes on staging first (0: none)', String(q.stagingMinutes ?? 0), { type: 'number' }),
      el('label.ms-rule__box', el('input', { type: 'checkbox', name: 'reason', checked: !!q.reason }), ' A reason')),
  );
  root.querySelector<HTMLInputElement>('[name="approvals"]')!.min = '0';
  // a freeze makes a deny rule apply while it lasts and an allow rule not apply; a deny rule with an empty freeze
  // list applies never (the owner sets freezes there)
  const keepFreezeList = !!r.when?.freezes;

  function read(): Rule | string {
    const name = field(root, 'name');
    if (!name) return 'Give the rule a name.';
    const action = ticked(root, 'action');
    if (!action.length) return 'Tick at least one thing the rule is about (promote, sync, roll back, preview, publish a release).';
    const out: Rule = { id: r.id, name, action, effect: field(root, 'effect') as Rule['effect'] };
    if (!ev.checked) {
      const who: NonNullable<Rule['who']> = {};
      for (const k of ['roles', 'users', 'groups'] as const) {
        const v = ticked(whoBox, k);
        if (v.length) who[k] = v;
      }
      if (!Object.keys(who).length) return 'Tick who the rule is for, or tick Everyone.';
      out.who = who;
    }
    const from = ticked(root, 'from');
    const to = ticked(root, 'to');
    if (from.length) out.from = from;
    if (to.length) out.to = to;
    const what: NonNullable<Rule['what']> = {};
    for (const k of ['only', 'not', 'any'] as const) {
      const v = listOf(field(root, k));
      if (v.length) what[k] = v;
    }
    if (Object.keys(what).length) out.what = what;
    const when = readWhen(root, keepFreezeList);
    if (typeof when === 'string') return when;
    if (when) out.when = when;
    const req: NonNullable<Rule['requires']> = {};
    const n = Number(field(root, 'approvals'));
    if (!Number.isInteger(n) || n < 0 || n > 10) return 'Approvals is a number from 0 to 10.';
    if (n) {
      req.approvals = { count: n };
      const by = ticked(root, 'approvers');
      if (by.length) req.approvals.roles = by;
      // named approvers are kept as they were (the form does not list them)
      if (r.requires?.approvals?.users?.length) req.approvals.users = r.requires.approvals.users;
    }
    const c = field(root, 'checks');
    if (c === 'all') req.checks = 'all';
    else if (c === 'some') {
      const names = listOf(field(root, 'checknames'));
      if (!names.length) return 'Name the checks that must pass, or choose Every check.';
      req.checks = names;
    }
    const m = Number(field(root, 'staging'));
    if (!Number.isInteger(m) || m < 0 || m > 43200) return 'Minutes on staging is a number from 0 to 43200 (30 days).';
    if (m) req.stagingMinutes = m;
    if (root.querySelector<HTMLInputElement>('[name="reason"]')!.checked) req.reason = true;
    if (Object.keys(req).length) out.requires = req;
    return out;
  }

  return { el: root, read };
}
