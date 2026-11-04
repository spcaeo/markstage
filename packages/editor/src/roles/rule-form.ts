// One rule of a custom role as a form (Settings → Roles, ?role=<id>&rule=<rule id>): its name and effect, the actions
// (entries, and the site's abilities), which collections and whose entries, what may change, which fields an edit
// may change, and when. The parts are the promotion rules' own (environments/rule-form.ts). `read()` gives the rule
// as the server keeps it (custom-roles/rules.mjs), or the words of what is missing; the server checks the rest and
// says what is wrong in words.
import { el } from '../admin/ui';
import type { RoleRule, RolesView } from '../admin/api';
import { boxes, field, freezeRow, listOf, readWhen, rows, text, ticked, windowRow } from '../environments/rule-form';
import { KIND_WORDS } from '../environments/words';
import { ENTRY_WORDS, actionWord, fromWords, isEntryAction } from './words';

export interface RoleRuleForm {
  el: HTMLElement;
  read(): RoleRule | string;
}

export function roleRuleForm(r: RoleRule, view: RolesView): RoleRuleForm {
  const effect = el('select.ms-input.ms-adm-select', { id: `ms-role-effect-${r.id}`, name: 'effect' });
  for (const [v, l] of [['allow', 'Allow'], ['deny', 'Deny']]) effect.append(el('option', { value: v, selected: v === r.effect }, l));
  // an ability only administrators have can be taken away, never given: its box says so
  const abilities = view.actions.abilities.map((a): [string, string] => [a.name, `${actionWord(a.name)} (${fromWords(a.min)}${a.min === 'administrator' ? ': deny only' : ''})`]);
  const kinds = view.kinds.map((k) => (KIND_WORDS[k] ? `${k} (${KIND_WORDS[k]})` : k)).join(', ');
  const ownId = `ms-role-own-${r.id}`;
  const entryPart = el('div.ms-rule__part',
    el('h4.ms-rule__h', 'Which entries'),
    el('p.ms-field__hint', 'For the entry actions only.'),
    boxes('collections', 'In (none ticked: every collection)', view.collections.map((c) => [c.id, c.label]), r.collections),
    el('label.ms-rule__box', { for: ownId }, el('input', { id: ownId, type: 'checkbox', name: 'own', checked: !!r.own }), ' Only their own entries (they are the author)'),
    el('p.ms-field__hint', `What may change: kinds or paths like src/content/blog/**, a comma between. Kinds: ${kinds}.`),
    text('only', 'Only when the entry is', (r.what?.only ?? []).join(', ')),
    text('not', 'Not when the entry is', (r.what?.not ?? []).join(', ')),
    text('fields', 'Fields its edit may change (an allow on “edit entries” alone; empty: every field)', (r.fields ?? []).join(', '), { placeholder: 'locales.fr-ca.**, seo.*, title, body' }),
  );
  const root = el('div.ms-rule__form',
    text('name', 'Name', r.name, { placeholder: 'What the rule is for, in a few words' }),
    el('div.ms-field.ms-adm-field', el('label.ms-field__label', { for: effect.id }, 'Effect'), effect, el('p.ms-field__hint', 'Deny wins over every allow. An allow gives what the base role lacks; with no rule that applies, the base role decides.')),
    boxes('action', 'Entries', view.actions.entry.map((a) => [a, ENTRY_WORDS[a] ?? a]), r.action),
    boxes('action', 'The site', abilities, r.action),
    entryPart,
    rows('Only in these hours', 'Add hours', (r.when?.windows ?? []).map((w) => windowRow(w)), () => windowRow()),
    rows('Freezes', 'Add a freeze', (r.when?.freezes ?? []).map((f) => freezeRow(f)), () => freezeRow()),
  );
  const keepFreezeList = !!r.when?.freezes;

  function read(): RoleRule | string {
    const name = field(root, 'name');
    if (!name) return 'Give the rule a name.';
    const action = ticked(root, 'action');
    if (!action.length) return 'Tick at least one thing the rule is about.';
    const out: RoleRule = { id: r.id, name, action, effect: field(root, 'effect') as RoleRule['effect'] };
    const entries = action.every(isEntryAction);
    const collections = ticked(entryPart, 'collections');
    const own = entryPart.querySelector<HTMLInputElement>('[name="own"]')!.checked;
    const what: NonNullable<RoleRule['what']> = {};
    for (const k of ['only', 'not'] as const) {
      const v = listOf(field(root, k));
      if (v.length) what[k] = v;
    }
    // the "any" list has no box here; a rule that had one keeps it
    if (r.what?.any?.length) what.any = r.what.any;
    const fields = listOf(field(root, 'fields'));
    if (!entries && (collections.length || own || Object.keys(what).length || fields.length)) return 'Which entries is for rules about entries only: untick the site’s actions, or clear Which entries.';
    if (collections.length) out.collections = collections;
    if (own) out.own = true;
    if (Object.keys(what).length) out.what = what;
    if (fields.length) {
      if (out.effect !== 'allow' || action.length !== 1 || action[0] !== 'entry.edit') return 'Fields are for one allow rule on “edit entries” alone.';
      out.fields = fields;
    }
    const when = readWhen(root, keepFreezeList);
    if (typeof when === 'string') return when;
    if (when) out.when = when;
    return out;
  }

  return { el: root, read };
}
