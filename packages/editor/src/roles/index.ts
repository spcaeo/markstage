// Settings → Roles (#/settings/roles): the site's custom roles (docs/API-ROLES.md), each a named role built on a
// built-in one with rules in the promotion rules' shape. The list reads each role's rules as sentences; ?role=<id>
// opens one (?role=new makes one), ?rule=<id> one of its rules' form in place; the dry run below asks what a person
// may do and why (try.ts, ?as=&do=&in=&entry=). Edits stay on the page until Save (kept for this tab if it reloads).
// The owner and administrators change roles; a role built on administrator is the owner's alone, as the server says.
import '../styles/roles.css';
import { ApiError } from '../api';
import type { ScreenCtx } from '../host';
import * as api from '../admin/api';
import { button, el, message, state } from '../admin/ui';
import { ruleId } from '../environments/words';
import { viewerRole } from '../runtime';
import { roleRuleForm } from './rule-form';
import { mountRoleTry } from './try';
import { BASE_WORDS, roleRuleWords } from './words';

const KEEP = 'markstage-role-draft';
type Draft = { id: string; name: string; base: api.RoleBase; rules: api.RoleRule[] };

const blank = (): Draft => ({ id: '', name: '', base: 'editor', rules: [] });
const draftOf = (r: api.CustomRole): Draft => structuredClone({ id: r.id, name: r.name, base: r.base, rules: r.rules });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
/** a role's short name from its name: "French translator" → "french-translator" */
const slug = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

function kept(key: string): Draft | null {
  try {
    const k = JSON.parse(sessionStorage.getItem(KEEP) ?? 'null');
    return k?.key === key ? k.draft : null;
  } catch {
    return null;
  }
}
function keep(key: string, draft: Draft | null): void {
  try {
    if (draft) sessionStorage.setItem(KEEP, JSON.stringify({ key, draft }));
    else sessionStorage.removeItem(KEEP);
  } catch {
    // no storage: the draft lives as long as the page
  }
}

export function mountRoles(host: HTMLElement, ctx: ScreenCtx): { update(c: ScreenCtx): void } {
  let view: api.RolesView | null = null;
  let people: api.User[] = [];
  /** the role open (?role=), as saved, and as edited here */
  let open: { key: string; saved: Draft; draft: Draft; version: string | null } | null = null;
  let problem = '';
  let tryBox: ReturnType<typeof mountRoleTry> | null = null;
  let drawnFor = '';
  host.classList.add('ms-roles');
  const owner = () => viewerRole() === 'owner';
  const openKey = () => `${ctx.params().get('role') ?? ''}|${ctx.params().get('rule') ?? ''}`;
  const dirty = () => !!open && !same(open.saved, open.draft);
  ctx.guard(dirty);
  const label = (id: string) => view?.collections.find((c) => c.id === id)?.label ?? id;
  const mayChange = (base: string) => base !== 'administrator' || owner();

  async function load(): Promise<void> {
    host.replaceChildren(state('loading', 'Loading the roles…'));
    try {
      [view, people] = await Promise.all([api.rolesView(), api.users()]);
    } catch (e) {
      host.replaceChildren(e instanceof ApiError && (e.status === 403 || e.status === 404) ? state('denied', 'Not available to you', 'Only an owner or an administrator sets the roles.') : state('error', 'The roles did not load', message(e)));
      return;
    }
    draw();
  }

  async function refresh(): Promise<void> {
    try {
      [view, people] = await Promise.all([api.rolesView(), api.users()]);
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
    draw();
  }

  /** The role of ?role= as a draft: kept from before a reload when it is still the same version. */
  function openRole(): void {
    const id = ctx.params().get('role');
    if (!id) return void (open = null);
    const r = id === 'new' ? null : view!.custom.find((x) => x.id === id);
    const key = `${id}|${r?.version ?? ''}`;
    if (open?.key === key) return;
    const saved = r ? draftOf(r) : blank();
    open = { key, saved, draft: kept(key) ?? structuredClone(saved), version: r?.version ?? null };
  }
  const changed = () => {
    keep(open!.key, dirty() ? open!.draft : null);
    draw();
  };

  async function save(): Promise<void> {
    const o = open!;
    problem = '';
    try {
      const d = o.draft;
      const { role } = o.version ? await api.saveRole(d.id, { name: d.name, base: d.base, rules: d.rules, version: o.version }) : await api.makeRole(d);
      keep(o.key, null);
      view = await api.rolesView();
      open = null;
      ctx.toast(`${role.name} saved. The owner and administrators are told about the change.`, 'ok');
      ctx.go({ params: { role: role.id, rule: null } }, true);
      if (openKey() === drawnFor) draw();
    } catch (e) {
      problem = e instanceof ApiError && e.status === 409 ? `${e.message} Your changes are still here: copy what you need, then Discard changes to see the role as it is now.` : message(e);
      draw();
    }
  }

  async function remove(r: api.CustomRole): Promise<void> {
    const who = r.people === 1 ? 'The person with it keeps' : r.people ? `The ${r.people} people with it keep` : 'Nobody has it; nothing else changes';
    const choice = await ctx.ask(`Remove ${r.name}?`, `${who}${r.people ? ` ${BASE_WORDS[r.base]} as their role` : ''}.`, [['cancel', 'Cancel'], ['go', 'Remove', 'ms-btn ms-btn--danger']]);
    if (choice !== 'go') return;
    try {
      await api.removeRole(r.id);
      keep(`${r.id}|${r.version}`, null);
      view = await api.rolesView();
      people = await api.users();
      open = null;
      ctx.toast(`Removed ${r.name}.`, 'ok');
      if (ctx.params().get('role')) ctx.go({ params: { role: null, rule: null } }, true);
      else draw();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  function draw(): void {
    openRole();
    drawnFor = openKey();
    tryBox?.destroy();
    tryBox = mountRoleTry(ctx, view!, people);
    const body = open ? roleView(open) : listView();
    host.replaceChildren(...body, tryBox.el);
    if (ctx.params().get('rule')) host.querySelector<HTMLElement>('.ms-env-rule.is-editing input')?.focus();
  }

  function listView(): HTMLElement[] {
    const v = view!;
    const head = el('div', el('h2.ms-locks__title', 'Roles'), el('p.ms-locks__lead', 'Roles of your own, each built on a built-in one: a translator who changes one region’s words, an author who also answers the Inbox, an editor who may not delete. Deny wins; with no rule that applies, the base role decides.'));
    const bar = el('div.ms-adm-row.ms-env-rules__bar', el('span.ms-adm-sub', `${v.custom.length} role${v.custom.length === 1 ? '' : 's'}`), el('span.ms-adm-grow'), button('New role', () => ctx.go({ params: { role: 'new', rule: null } }, true), { icon: 'plus', kind: 'primary' }));
    if (!v.custom.length) return [head, bar, state('empty', 'No roles of your own yet', 'Everyone has one of the five built-in roles. Make a role when someone needs a little more or a little less.')];
    const list = el('ol.ms-env-rules');
    for (const r of v.custom) {
      const lines = r.rules.map((x) => roleRuleWords(x, label).sentence);
      list.append(el('li.ms-env-rule', { 'data-role': r.id },
        el('div.ms-adm-row', el('span.ms-adm-badge', `on ${BASE_WORDS[r.base]}`), el('strong', r.name), el('span.ms-adm-sub', `${r.people} ${r.people === 1 ? 'person' : 'people'}`), el('span.ms-adm-grow'),
          mayChange(r.base) ? button('Edit', () => ctx.go({ params: { role: r.id, rule: null } }, true), { small: true }) : el('span.ms-adm-sub', 'Only the owner changes a role built on administrator.'),
          mayChange(r.base) ? button('Remove', () => void remove(r), { small: true, kind: 'quiet' }) : ''),
        lines.length ? el('ul.ms-env-rule__lines', ...lines.map((l) => el('li', l))) : el('p.ms-adm-sub', 'No rules: the same as its base role.'),
      ));
    }
    return [head, bar, list];
  }

  function roleView(o: NonNullable<typeof open>): (HTMLElement | string)[] {
    const v = view!;
    const d = o.draft;
    const r = o.version ? v.custom.find((x) => x.id === d.id) ?? null : null;
    const back = button('All roles', () => ctx.go({ params: { role: null, rule: null } }, true), { kind: 'quiet', small: true });
    if (ctx.params().get('role') !== 'new' && !r) return [back, el('p.ms-adm-note', 'That role is not here (removed, or never made).')];
    if (!mayChange(d.base) && !mayChange(o.saved.base)) return [back, el('h2.ms-locks__title', d.name), el('p.ms-adm-note', 'Only the owner changes a role built on administrator.')];
    const head = el('div', back, el('h2.ms-locks__title', r ? r.name : 'New role'), el('p.ms-locks__lead', r ? `${r.people} ${r.people === 1 ? 'person has' : 'people have'} it. A change applies to them at once.` : 'Name it, pick the role it is built on, then add its rules.'));
    const name = el('input.ms-input', { id: 'ms-role-name', name: 'role-name', maxlength: '60', placeholder: 'French translator' });
    name.value = d.name;
    const id = el('input.ms-input', { id: 'ms-role-id', name: 'role-id', maxlength: '40', pattern: '[a-z][a-z0-9-]*', spellcheck: 'false' });
    id.value = d.id;
    let idTouched = !!d.id && d.id !== slug(d.name);
    name.addEventListener('input', () => {
      d.name = name.value;
      if (!r && !idTouched) id.value = d.id = slug(name.value);
      keep(o.key, dirty() ? d : null);
      syncBar();
    });
    id.addEventListener('input', () => ((idTouched = true), (d.id = id.value.trim()), keep(o.key, dirty() ? d : null), syncBar()));
    const base = el('select.ms-input.ms-adm-select', { id: 'ms-role-base', name: 'role-base' });
    for (const b of v.bases) base.append(el('option', { value: b, selected: b === d.base, disabled: b === 'administrator' && !owner() }, `${BASE_WORDS[b]}${b === 'administrator' && !owner() ? ' (the owner’s to give)' : ''}`));
    base.addEventListener('change', () => ((d.base = base.value as api.RoleBase), changed()));
    const card = el('section.ms-adm-card',
      el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'ms-role-name' }, 'Name'), name),
      r ? '' : el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'ms-role-id' }, 'Short name (in links; fixed once made)'), id),
      el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'ms-role-base' }, 'Built on'), base, el('p.ms-field__hint', 'People with this role rank as this one: every right it has, then the rules below.')),
    );
    const status = el('span');
    const saveBtn = button(r ? 'Save' : 'Make the role', () => void save(), { kind: 'primary' });
    const discard = r ? button('Discard changes', () => ((o.draft = structuredClone(o.saved)), (problem = ''), changed()), { kind: 'quiet' }) : '';
    const bar = el('div.ms-adm-row.ms-env-rules__bar', status, el('span.ms-adm-grow'),
      button('Add a rule', () => {
        const rid = ruleId('new rule', d.rules.map((x) => x.id));
        d.rules.push({ id: rid, name: 'New rule', action: ['entry.edit'], effect: 'allow' });
        keep(o.key, d);
        ctx.go({ params: { rule: rid } }, true);
      }, { icon: 'plus' }),
      discard,
      r ? button('Remove the role', () => void remove(r), { kind: 'quiet' }) : '',
      saveBtn,
    );
    function syncBar(): void {
      status.replaceChildren(dirty() ? el('span.ms-adm-badge.is-new', 'Changes not saved') : r ? el('span.ms-adm-sub', `Saved (version ${r.version.slice(1)})`) : el('span.ms-adm-sub', 'Not made yet'));
      saveBtn.disabled = !(r ? dirty() : d.name.trim() && d.id);
      if (discard) discard.disabled = !dirty();
    }
    syncBar();
    const err = problem ? el('p.ms-adm-note.is-bad', { role: 'alert' }, problem) : '';
    const editing = ctx.params().get('rule');
    const list = el('ol.ms-env-rules');
    for (const x of d.rules) list.append(x.id === editing ? editCard(o, x) : ruleCard(o, x));
    if (editing && !d.rules.some((x) => x.id === editing)) list.prepend(el('li.ms-adm-note', 'That rule is not here (removed, or a change that was not saved).'));
    if (!d.rules.length) list.append(el('li.ms-adm-sub', 'No rules yet: the role is the same as its base until you add one.'));
    return [head, bar, err, card, el('h3.ms-env-rules__h', `${d.rules.length} rule${d.rules.length === 1 ? '' : 's'}`), list];
  }

  function ruleCard(o: NonNullable<typeof open>, x: api.RoleRule): HTMLElement {
    const w = roleRuleWords(x, label);
    return el(`li.ms-env-rule.ms-env-rule--${x.effect}`, { 'data-rule': x.id },
      el('div.ms-adm-row', el(`span.ms-adm-badge${x.effect === 'deny' ? '.is-bad' : '.ms-adm-badge--ok'}`, x.effect === 'deny' ? 'Deny' : 'Allow'), el('strong', x.name), el('span.ms-adm-grow'),
        button('Edit', () => ctx.go({ params: { rule: x.id } }, true), { small: true }),
        button('Remove', () => ((o.draft.rules = o.draft.rules.filter((y) => y !== x)), changed()), { small: true, kind: 'quiet' })),
      el('p.ms-env-rule__sentence', w.sentence),
      w.lines.length ? el('ul.ms-env-rule__lines', ...w.lines.map((l) => el('li', l))) : '',
    );
  }

  function editCard(o: NonNullable<typeof open>, x: api.RoleRule): HTMLElement {
    const f = roleRuleForm(x, view!);
    const err = el('p.ms-adm-form__err', { role: 'alert' });
    const done = button('Keep these changes', () => {
      const out = f.read();
      if (typeof out === 'string') return void (err.textContent = out);
      o.draft.rules = o.draft.rules.map((y) => (y === x ? out : y));
      keep(o.key, o.draft);
      ctx.go({ params: { rule: null } }, true);
    }, { kind: 'primary' });
    return el('li.ms-env-rule.is-editing', el('h4.ms-rule__h', `Editing “${x.name}”`), f.el, err, el('div.ms-adm-actions', done, button('Close without these changes', () => ctx.go({ params: { rule: null } }, true), { kind: 'quiet' }), el('span.ms-adm-sub', 'Nothing is saved until Save at the top.')));
  }

  void load();
  return {
    update(c) {
      ctx = c;
      if (!view) return;
      // another role, or back to the list: the roles and people as they are now (someone may have changed them)
      if ((ctx.params().get('role') ?? '') !== drawnFor.split('|')[0]) return void refresh();
      if (openKey() !== drawnFor) return draw();
      // only the dry run's question changed: it answers in place, the forms stay as they are
      const fresh = mountRoleTry(ctx, view, people);
      tryBox?.destroy();
      tryBox?.el.replaceWith(fresh.el);
      tryBox = fresh;
    },
  };
}
