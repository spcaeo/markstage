// Change many entries at once (editors and above), docs/OPERATIONS.md "Writing and finding":
//   #/bulk?items=&action=&field=&value=   the chosen entries (collection/id, comma separated, as a list's selection
//                         or Find and replace hands them over), what to do with them, and a summary of each entry
//                         before anything is written. Applying is one change in the site's history.
import type { ScreenCtx } from '../host';
import { config } from '../runtime';
import * as api from './api';
import { button, el, failure, message, page, state, undoToast } from './ui';

const ACTIONS: [api.BulkAction, string][] = [
  ['set', 'Set a field'],
  ['add', 'Add to a list'],
  ['remove', 'Take out of a list'],
  ['unpublish', 'Unpublish'],
  ['trash', 'Move to the trash'],
];
const STATUS: Record<string, string> = { published: 'Live', draft: 'Draft', scheduled: 'Scheduled', trash: 'In the trash' };
const needsField = (a: string) => a === 'set' || a === 'add' || a === 'remove';

/** A value as people read it. */
const shown = (v: api.FieldValue | undefined): string => (v === null || v === undefined ? '—' : Array.isArray(v) ? v.join(', ') || '(empty list)' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

/** The URL's value as the field's kind wants it. */
function valueOf(raw: string, f: api.BulkField | undefined, action: string): api.FieldValue {
  if (action !== 'set') return raw;
  if (f?.kind === 'boolean') return raw === 'true';
  if (f?.kind === 'number') return raw.trim() === '' ? null : Number(raw);
  if (f?.kind === 'list') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw.trim() === '' ? null : raw;
}

export function mountBulk(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Change many entries', 'Choose what to do with these entries. You see each one before and after, and nothing is written until you apply it.');
  let fields: api.BulkField[] = [];
  let rows: api.BulkRow[] = [];
  let shownFor = '';
  let result: HTMLElement | null = null;
  let alive = true;

  const items = () =>
    (ctx.params().get('items') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('/'))
      .map((s) => ({ collection: s.slice(0, s.indexOf('/')), id: s.slice(s.indexOf('/') + 1) }));
  const req = (): api.BulkRequest | null => {
    const q = ctx.params();
    const action = (q.get('action') ?? '') as api.BulkAction;
    if (!ACTIONS.some(([a]) => a === action)) return null;
    if (!needsField(action)) return { action };
    const field = q.get('field') ?? '';
    const f = fields.find((x) => x.name === field);
    if (!field || !q.has('value') || (action !== 'set' && !q.get('value'))) return null;
    return { action, field, value: valueOf(q.get('value') ?? '', f, action) };
  };

  /** The fields of the chosen entries' collection (of every collection when they come from several). */
  const fieldsFor = async (list: { collection: string }[]) => {
    const colls = [...new Set(list.map((x) => x.collection))];
    return (await api.bulkFields(colls.length === 1 ? colls[0] : undefined)).fields;
  };

  async function load(): Promise<void> {
    const list = items();
    if (!list.length) return void p.body.replaceChildren(state('empty', 'No entries chosen', 'Select entries in a list, or search with Find and replace, then choose “Change these entries…”.'));
    p.body.replaceChildren(state('loading', 'Loading…'));
    try {
      fields = await fieldsFor(list);
    } catch (e) {
      p.body.replaceChildren(failure(e, () => void load()));
      return;
    }
    if (alive) void refresh();
  }

  async function refresh(): Promise<void> {
    const r = req();
    const key = JSON.stringify([r, ctx.params().get('items')]);
    if (r && key !== shownFor) {
      try {
        rows = (await api.bulkPlan(r, items())).entries;
        shownFor = key;
      } catch (e) {
        p.body.replaceChildren(controls(), failure(e, () => void refresh()));
        return;
      }
    }
    if (!r) rows = [];
    if (alive) render();
  }

  function controls(): HTMLElement {
    const q = ctx.params();
    const action = q.get('action') ?? '';
    const fieldName = q.get('field') ?? '';
    const pickAction = el('select.ms-input.ms-adm-select', { name: 'action', 'aria-label': 'What to do' }, el('option', { value: '' }, 'Choose…'), ...ACTIONS.map(([a, l]) => el('option', { value: a, selected: a === action }, l)));
    pickAction.addEventListener('change', () => ctx.go({ params: { action: pickAction.value || null, field: null, value: null } }, true));
    const parts: HTMLElement[] = [el('label.ms-field.ms-adm-field', el('span.ms-field__label', 'What to do'), pickAction)];
    if (needsField(action)) {
      const usable = fields.filter((f) => action === 'set' || f.list);
      const pickField = el('select.ms-input.ms-adm-select', { name: 'field', 'aria-label': 'Field' }, el('option', { value: '' }, 'Choose…'), ...usable.map((f) => el('option', { value: f.name, selected: f.name === fieldName }, `${f.name} (${f.entries} entr${f.entries === 1 ? 'y' : 'ies'})`)));
      pickField.addEventListener('change', () => ctx.go({ params: { field: pickField.value || null, value: null } }, true));
      parts.push(el('label.ms-field.ms-adm-field', el('span.ms-field__label', 'Field'), pickField));
      const f = fields.find((x) => x.name === fieldName);
      if (f) parts.push(valueInput(f, action, q.get('value')));
    }
    return el('section.ms-adm-card.ms-adm-bulkform', ...parts);
  }

  function valueInput(f: api.BulkField, action: string, cur: string | null): HTMLElement {
    let input: HTMLInputElement | HTMLSelectElement;
    if (action === 'set' && f.kind === 'boolean') {
      input = el('select.ms-input.ms-adm-select', { name: 'value' }, el('option', { value: '' }, 'Choose…'), el('option', { value: 'true', selected: cur === 'true' }, 'Yes'), el('option', { value: 'false', selected: cur === 'false' }, 'No'));
    } else {
      const listId = `ms-adm-values-${f.name}`;
      input = el('input.ms-input', { name: 'value', type: action === 'set' && f.kind === 'number' ? 'number' : 'text', list: listId, spellcheck: 'false', placeholder: action === 'set' && f.kind === 'list' ? 'Values, separated by commas' : '' });
      input.value = cur ?? '';
    }
    const label = action === 'add' ? 'Value to add' : action === 'remove' ? 'Value to take out' : 'New value';
    const show = button('Show the summary', () => ctx.go({ params: { value: input.value } }, true), { icon: 'eye' });
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') ctx.go({ params: { value: input.value } }, true);
    });
    if (input instanceof HTMLSelectElement) input.addEventListener('change', () => ctx.go({ params: { value: input.value } }, true));
    const values = el('datalist', { id: `ms-adm-values-${f.name}` }, ...f.values.map((v) => el('option', { value: v.value })));
    const hint = action === 'set' && f.kind !== 'boolean' ? el('p.ms-field__hint', 'Leave it empty to clear the field.') : null;
    return el('div.ms-field.ms-adm-field', el('span.ms-field__label', label), el('div.ms-adm-row', input, input instanceof HTMLInputElement ? values : null, show), hint);
  }

  function render(): void {
    const parts: HTMLElement[] = [controls()];
    if (result) parts.push(result);
    const r = req();
    const names = new Map(config().collections.map((c) => [c.id, c.label]));
    if (!r) {
      parts.push(state('empty', `${items().length} entr${items().length === 1 ? 'y' : 'ies'} chosen`, 'Choose what to do with them to see the summary.'));
      return void p.body.replaceChildren(...parts);
    }
    const ok = rows.filter((x) => !x.problem);
    const live = ok.filter((x) => x.status === 'published').length;
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'Entry'), el('th', 'Status'), el('th', 'Now'), el('th', 'After'), el('th', ''))));
    const tb = el('tbody');
    for (const x of rows) {
      const fieldChange = needsField(r.action);
      tb.append(
        el(
          `tr${x.problem ? '.is-muted' : ''}`,
          el('td', el('a', { href: `#/e/${encodeURIComponent(x.collection)}/${encodeURIComponent(x.id)}` }, x.title), el('div.ms-adm-sub', names.get(x.collection) ?? x.collection)),
          el('td', STATUS[x.status ?? ''] ?? x.status ?? '—'),
          el('td', fieldChange ? shown(x.from) : STATUS[String(x.from ?? '')] ?? '—'),
          el('td', x.problem ? el('span.ms-adm-sub', 'Left as it is') : fieldChange ? el('strong', shown(x.to)) : el('strong', STATUS[String(x.to ?? '')] ?? '—')),
          el('td', x.problem ? el('span.ms-adm-sub', x.problem) : null),
        ),
      );
    }
    t.append(tb);
    const verb = ACTIONS.find(([a]) => a === r.action)?.[1] ?? r.action;
    const apply = button(`${verb}: ${ok.length} entr${ok.length === 1 ? 'y' : 'ies'}`, () => void run(r), { kind: r.action === 'trash' ? 'danger' : 'primary', icon: r.action === 'trash' ? 'trash' : 'check' });
    apply.disabled = !ok.length;
    parts.push(
      el('div.ms-adm-findsum', el('p', `${ok.length} of ${rows.length} will change.${live ? ` ${live} ${live === 1 ? 'is' : 'are'} live: the site is rebuilt.` : ''}`), apply),
      el('section.ms-adm-card.ms-adm-card--flush', t),
    );
    p.body.replaceChildren(...parts);
  }

  async function run(r: api.BulkRequest): Promise<void> {
    const ok = rows.filter((x) => !x.problem && x.version);
    const verb = ACTIONS.find(([a]) => a === r.action)?.[1] ?? r.action;
    const go = await ctx.ask(
      `${verb}: ${ok.length} entr${ok.length === 1 ? 'y' : 'ies'}?`,
      r.action === 'trash' ? 'They leave the site and go to the trash, where they can be restored.' : needsField(r.action) ? 'It is one change in the site’s history, with Undo on the note that follows.' : 'It is one change in the site’s history, so each entry’s History can undo it.',
      [['cancel', 'Cancel'], ['go', 'Apply', r.action === 'trash' ? 'ms-btn ms-btn--danger' : 'ms-btn ms-btn--primary']],
    );
    if (go !== 'go') return;
    try {
      const out = await api.bulkApply(r, ok.map((x) => ({ collection: x.collection, id: x.id, version: x.version as string })));
      result = el(
        'section.ms-adm-card.ms-adm-findresult',
        { role: 'status' },
        el('h2.ms-adm-h2', out.changed.length ? `Changed ${out.changed.length} entr${out.changed.length === 1 ? 'y' : 'ies'}` : 'Nothing was changed'),
        out.job ? el('p', 'The live ones are being rebuilt. ', el('a', { href: `#/jobs/${encodeURIComponent(out.job)}` }, 'Follow it on the Publishing page')) : null,
        out.skipped.length ? el('ul.ms-adm-findskips', ...out.skipped.map((s) => el('li', el('strong', s.title), ` — ${s.problem ?? ''}`))) : null,
      );
      const said = out.changed.length ? `Changed ${out.changed.length} entr${out.changed.length === 1 ? 'y' : 'ies'}.` : 'Nothing was changed.';
      // a change to a field can be undone at once (never an unpublish or the trash: those have their own way back)
      if (needsField(r.action)) undoToast(ctx, said, out.commit, () => ((shownFor = ''), void refresh()));
      else ctx.toast(said, out.skipped.length ? 'info' : 'ok');
      shownFor = '';
      fields = await fieldsFor(items());
      void refresh();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  ctx.setTitle('Change many entries');
  void load();
  return {
    update: () => {
      result = null;
      void refresh();
    },
    destroy: () => {
      alive = false;
    },
  };
}
