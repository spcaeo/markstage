// Settings → Roles' dry run: "May Kim edit this post?" A person, an action and, for an entry action, a collection and
// an entry; the answer is what the server decides now (POST roles/check, the saved roles), the rule that decided and
// each rule's part. The question is in the URL (?as=&do=&in=&entry=), so a link opens the same answer.
import type { ScreenCtx } from '../host';
import { button, el, message } from '../admin/ui';
import * as api from '../admin/api';
import { actionWord, isEntryAction } from './words';

const KEYS = ['as', 'do', 'in', 'entry'] as const;

function pick(id: string, label: string, options: [string, string][], val: string): HTMLElement {
  const s = el('select.ms-input.ms-adm-select', { id, name: id });
  for (const [v, l] of options) s.append(el('option', { value: v, selected: v === val }, l));
  return el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: id }, label), s);
}

export function mountRoleTry(ctx: ScreenCtx, view: api.RolesView, people: api.User[]): { el: HTMLElement; destroy(): void } {
  const q = ctx.params();
  const get = (k: (typeof KEYS)[number], d = '') => q.get(k) ?? d;
  const who: [string, string][] = people.filter((u) => u.role !== 'owner').map((u) => [u.id, `${u.name} (${u.customRole ? u.customRole.name : u.role})`]);
  const actions: [string, string][] = [...view.actions.entry, ...view.actions.abilities.map((a) => a.name)].map((a) => [a, actionWord(a)]);
  const entry = el('input.ms-input', { id: 'role-try-entry', name: 'role-try-entry', spellcheck: 'false', placeholder: 'hello-world' });
  entry.value = get('entry');
  const out = el('div.ms-env-try__out', { 'aria-live': 'polite' });
  const box = el('section.ms-adm-card.ms-env-try', { id: 'try' },
    el('h3.ms-adm-h3', 'What may they do?'),
    el('p.ms-adm-sub', 'Ask about one person and one action, with the roles as saved.'),
    el('div.ms-env-try__grid',
      pick('role-try-as', 'Person', who, get('as', who.find(([id]) => people.find((u) => u.id === id)?.customRole)?.[0] ?? who[0]?.[0] ?? '')),
      pick('role-try-do', 'Does', actions, get('do', 'entry.edit')),
      pick('role-try-in', 'In (entries)', [['', '—'], ...view.collections.map((c): [string, string] => [c.id, c.label])], get('in')),
      el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: 'role-try-entry' }, 'Entry (its id)'), entry),
    ),
    el('div.ms-adm-actions', button('Ask', () => ask(), { kind: 'primary' })),
    out,
  );
  const val = (id: string) => box.querySelector<HTMLSelectElement>(`#${id}`)!.value;
  let alive = true;

  /** The question into the URL; the screen answers it from there. */
  function ask(): void {
    const entryAction = isEntryAction(val('role-try-do'));
    const params: Record<string, string | null> = {
      as: val('role-try-as') || null,
      do: val('role-try-do'),
      in: entryAction ? val('role-try-in') || null : null,
      entry: entryAction ? entry.value.trim() || null : null,
    };
    if (KEYS.every((k) => (params[k] ?? null) === (ctx.params().get(k) ?? null))) return void answer();
    ctx.go({ params }, true);
  }

  async function answer(): Promise<void> {
    const p = ctx.params();
    const userId = p.get('as');
    if (!userId) return void out.replaceChildren(el('p.ms-adm-sub', 'Pick a person.'));
    out.replaceChildren(el('p.ms-adm-sub', 'Asking…'));
    try {
      const r = await api.checkRole({ userId, action: p.get('do')!, ...(p.get('in') ? { collection: p.get('in')! } : {}), ...(p.get('in') && p.get('entry') ? { id: p.get('entry')! } : {}) });
      if (!alive) return;
      const role = view.custom.find((x) => x.id === r.user.customRole?.id);
      const tone = r.allowed === true ? '.is-ok' : r.allowed === false ? '.is-bad' : '';
      const verdict = r.allowed === true ? `${r.user.name} may ${actionWord(r.action)}. ` : r.allowed === false ? `${r.user.name} may not ${actionWord(r.action)}. ` : '';
      out.replaceChildren(
        el(`div.ms-adm-outcome${tone}`, el('strong', verdict), r.words),
        r.fields ? el('p.ms-adm-sub', `Only these fields: ${r.fields.join(', ')}.`) : '',
        r.trace.length
          ? el('details.ms-env-trace', { open: true }, el('summary', 'Each rule’s part'), el('table.ms-adm-table', el('thead', el('tr', el('th', 'Rule'), el('th', 'Applies'), el('th', 'Why'))), el('tbody', ...r.trace.map((t) => el(`tr${t.matched ? '.is-open' : ''}`, el('td', role?.rules.find((x) => x.id === t.rule)?.name ?? t.rule), el('td', t.matched ? 'Yes' : 'No'), el('td', t.why))))))
          : el('p.ms-adm-sub', r.user.customRole ? 'Their role has no rules.' : 'They have no custom role: their built-in role decides.'),
      );
    } catch (e) {
      if (alive) out.replaceChildren(el('p.ms-adm-note.is-bad', { role: 'alert' }, message(e)));
    }
  }

  if (ctx.params().get('do')) void answer();
  return { el: box, destroy: () => (alive = false) };
}
