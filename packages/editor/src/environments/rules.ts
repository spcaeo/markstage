// Settings → Environments → Rules (#/settings/environments/rules): the promotion rules (docs/ENVIRONMENTS.md
// "Promotion rules") as sentences people read, the groups they name, and a dry run ("What would happen if Sam
// promoted this?", rules-try.ts). Edits stay on this page until Save (kept for this tab if it reloads); ?rule=<id>
// opens one rule's form in place, ?group=<name> one group. The owner and administrators change them; a save is
// audited and sends the rules-changed safety alert.
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import { button, el, message, state } from '../admin/ui';
import * as api from './api';
import { ruleForm } from './rule-form';
import { mountTry } from './rules-try';
import { ruleId, ruleWords } from './words';

const KEEP = 'markstage-env-rules-draft';
const EFFECT_WORDS: Record<api.Rule['effect'], string> = { allow: 'Allow', 'allow-with-approval': 'Allow with an approval', deny: 'Deny' };

const same = (a: api.RulesDoc, b: api.RulesDoc) => JSON.stringify({ g: a.groups, r: a.rules }) === JSON.stringify({ g: b.groups, r: b.rules });
const clone = (d: api.RulesDoc): api.RulesDoc => structuredClone({ groups: d.groups, rules: d.rules });

function kept(version: string): api.RulesDoc | null {
  try {
    const k = JSON.parse(sessionStorage.getItem(KEEP) ?? 'null');
    return k?.version === version ? k.draft : null;
  } catch {
    return null;
  }
}
function keep(version: string, draft: api.RulesDoc | null): void {
  try {
    if (draft) sessionStorage.setItem(KEEP, JSON.stringify({ version, draft }));
    else sessionStorage.removeItem(KEEP);
  } catch {
    // no storage: the draft lives as long as the page
  }
}

export function mountRules(host: HTMLElement, ctx: ScreenCtx): { update(c: ScreenCtx): void } {
  let view: api.RulesView | null = null;
  let draft: api.RulesDoc | null = null;
  let problem = '';
  let tryBox: ReturnType<typeof mountTry> | null = null;
  /** the open rule and group the page was drawn with: a dry run's question alone leaves the forms as they are */
  let drawnFor = '';
  const openKey = () => `${ctx.params().get('rule') ?? ''}|${ctx.params().get('group') ?? ''}`;
  const dirty = () => !!view && !!draft && !same(view, draft);
  ctx.guard(dirty);

  async function load(): Promise<void> {
    host.replaceChildren(state('loading', 'Loading the rules…'));
    try {
      view = await api.rules();
    } catch (e) {
      host.replaceChildren(e instanceof ApiError && e.status === 404 ? state('empty', 'Not on this server', 'Promotion rules need the Markstage server.') : state('error', 'The rules did not load', message(e)));
      return;
    }
    draft = kept(view.version) ?? clone(view);
    draw();
  }

  const name = (id: string) => view?.people.find((u) => u.id === id)?.name ?? id;
  const changed = () => {
    keep(view!.version, dirty() ? draft : null);
    draw();
  };

  async function save(): Promise<void> {
    problem = '';
    try {
      view = await api.saveRules({ version: view!.version, ...draft! });
      draft = clone(view);
      keep(view.version, null);
      ctx.toast('Rules saved. The owner and administrators are told about the change.', 'ok');
      if (ctx.params().get('rule') || ctx.params().get('group')) ctx.go({ params: { rule: null, group: null } }, true);
      else draw();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) problem = `${e.message} Your changes are still here: copy what you need, then Discard changes to see the rules as they are now.`;
      else problem = message(e);
      draw();
    }
  }

  function draw(): void {
    const v = view!;
    const d = draft!;
    drawnFor = openKey();
    const editing = ctx.params().get('rule');
    const group = ctx.params().get('group');
    const head = el('div.ms-env-rules__head',
      el('div', el('h2.ms-locks__title', 'Promotion rules'), el('p.ms-locks__lead', 'Who may promote, sync, roll back or preview, from where to where, and what it needs. Deny wins; with no rule that applies, the answer is no.')),
    );
    const status = dirty() ? el('span.ms-adm-badge.is-new', 'Changes not saved') : v.saved ? el('span.ms-adm-sub', `Saved (version ${v.version.slice(1)})`) : el('span.ms-adm-sub', 'The starter rules (not changed yet)');
    const bar = el('div.ms-adm-row.ms-env-rules__bar', status, el('span.ms-adm-grow'),
      button('Add a rule', () => {
        const id = ruleId('new rule', d.rules.map((r) => r.id));
        d.rules.push({ id, name: 'New rule', action: ['promote'], effect: 'allow' });
        keep(v.version, d);
        ctx.go({ params: { rule: id } }, true);
      }, { icon: 'plus' }),
      dirty() ? button('Discard changes', () => ((draft = clone(v)), (problem = ''), changed()), { kind: 'quiet' }) : '',
      !same(d, v.starter) ? button('Start from the starter rules', () => ((draft = clone(v.starter)), changed()), { kind: 'quiet', title: 'Put the starter rules back in place of these (nothing is saved until Save)' }) : '',
      button('Save', () => void save(), { kind: 'primary' }),
    );
    (bar.lastElementChild as HTMLButtonElement).disabled = !dirty();
    const err = problem ? el('p.ms-adm-note.is-bad', { role: 'alert' }, problem) : null;
    const list = el('ol.ms-env-rules');
    for (const r of d.rules) list.append(r.id === editing ? editCard(r) : ruleCard(r));
    if (editing && !d.rules.some((r) => r.id === editing)) list.prepend(el('li.ms-adm-note', 'That rule is not here (removed, or a change that was not saved).'));
    tryBox?.destroy();
    tryBox = mountTry(ctx, v, () => (dirty() ? d : null));
    host.replaceChildren(head, bar, err ?? '', groupsCard(group), el('h3.ms-env-rules__h', `${d.rules.length} rule${d.rules.length === 1 ? '' : 's'}`), list, tryBox.el);
    if (editing) host.querySelector<HTMLElement>('.ms-env-rule.is-editing input')?.focus();
  }

  function ruleCard(r: api.Rule): HTMLElement {
    const w = ruleWords(r, name);
    const tone = r.effect === 'deny' ? '.is-bad' : r.effect === 'allow' ? '.ms-adm-badge--ok' : '';
    return el(`li.ms-env-rule.ms-env-rule--${r.effect}`,
      el('div.ms-adm-row', el(`span.ms-adm-badge${tone}`, EFFECT_WORDS[r.effect]), el('strong', r.name), el('span.ms-adm-grow'), button('Edit', () => ctx.go({ params: { rule: r.id } }, true), { small: true }), button('Remove', () => ((draft!.rules = draft!.rules.filter((x) => x !== r)), changed()), { small: true, kind: 'quiet' })),
      el('p.ms-env-rule__sentence', w.sentence),
      w.lines.length ? el('ul.ms-env-rule__lines', ...w.lines.map((l) => el('li', l))) : '',
    );
  }

  function editCard(r: api.Rule): HTMLElement {
    const f = ruleForm(r, view!, Object.keys(draft!.groups));
    const err = el('p.ms-adm-form__err', { role: 'alert' });
    const done = button('Keep these changes', () => {
      const out = f.read();
      if (typeof out === 'string') return void (err.textContent = out);
      draft!.rules = draft!.rules.map((x) => (x === r ? out : x));
      keep(view!.version, draft);
      ctx.go({ params: { rule: null } }, true);
    }, { kind: 'primary' });
    return el('li.ms-env-rule.is-editing', el('h4.ms-rule__h', `Editing “${r.name}”`), f.el, err, el('div.ms-adm-actions', done, button('Close without these changes', () => ctx.go({ params: { rule: null } }, true), { kind: 'quiet' }), el('span.ms-adm-sub', 'Nothing is saved until Save at the top.')));
  }

  function groupsCard(open: string | null): HTMLElement {
    const d = draft!;
    const names = Object.keys(d.groups);
    const card = el('section.ms-adm-card.ms-env-groups', el('div.ms-adm-row', el('h3.ms-adm-h3', 'Groups'), el('span.ms-adm-sub', 'People a rule names together, like the developers or who may hotfix.'), el('span.ms-adm-grow'),
      button('Add a group', () => {
        let n = 'new-group';
        for (let i = 2; n in d.groups; i++) n = `new-group-${i}`;
        d.groups[n] = [];
        keep(view!.version, d);
        ctx.go({ params: { group: n } }, true);
      }, { small: true, icon: 'plus' })));
    const ul = el('ul.ms-env-groups__list');
    for (const g of names) {
      if (g === open) {
        ul.append(groupForm(g));
        continue;
      }
      const people = d.groups[g]!;
      const used = d.rules.filter((r) => r.who?.groups?.includes(g)).length;
      ul.append(el('li', el('strong', g), el('span.ms-adm-sub', ` · ${people.length ? people.map(name).join(', ') : 'nobody yet'} · in ${used} rule${used === 1 ? '' : 's'}`), el('span.ms-adm-grow'), button('Edit', () => ctx.go({ params: { group: g } }, true), { small: true })));
    }
    if (!names.length) ul.append(el('li.ms-adm-sub', 'No groups.'));
    card.append(ul);
    return card;
  }

  function groupForm(g: string): HTMLElement {
    const d = draft!;
    const nid = 'ms-env-group-name';
    const input = el('input.ms-input', { id: nid, value: g, pattern: '[a-z0-9][a-z0-9-]{0,59}', spellcheck: 'false' });
    const people = el('fieldset.ms-rule__boxes', el('legend.ms-field__label', 'People'));
    for (const u of view!.people) people.append(el('label.ms-rule__box', el('input', { type: 'checkbox', value: u.id, checked: d.groups[g]!.includes(u.id) }), ` ${u.name} (${u.role})`));
    const err = el('p.ms-adm-form__err', { role: 'alert' });
    const used = d.rules.filter((r) => r.who?.groups?.includes(g)).length;
    const ok = button('Keep', () => {
      const n = input.value.trim();
      if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(n)) return void (err.textContent = 'A group name is lowercase letters, digits and dashes.');
      if (n !== g && n in d.groups) return void (err.textContent = `There is a group “${n}” already.`);
      const ids = [...people.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value);
      const next: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(d.groups)) next[k === g ? n : k] = k === g ? ids : v;
      d.groups = next;
      if (n !== g) for (const r of d.rules) if (r.who?.groups) r.who.groups = r.who.groups.map((x) => (x === g ? n : x));
      keep(view!.version, d);
      ctx.go({ params: { group: null } }, true);
    }, { kind: 'primary', small: true });
    const drop = button(used ? `Remove (used by ${used} rule${used === 1 ? '' : 's'})` : 'Remove', () => {
      if (used) return void (err.textContent = 'Take the group out of its rules first.');
      delete d.groups[g];
      keep(view!.version, d);
      ctx.go({ params: { group: null } }, true);
    }, { kind: 'quiet', small: true });
    return el('li.ms-env-groups__edit', el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: nid }, 'Name'), input), people, err, el('div.ms-adm-actions', ok, button('Close', () => ctx.go({ params: { group: null } }, true), { kind: 'quiet', small: true }), drop));
  }

  void load();
  return {
    update(c) {
      ctx = c;
      if (!view) return;
      if (openKey() !== drawnFor) return draw();
      const fresh = mountTry(ctx, view, () => (dirty() ? draft : null));
      tryBox?.destroy();
      tryBox?.el.replaceWith(fresh.el);
      tryBox = fresh;
    },
  };
}
