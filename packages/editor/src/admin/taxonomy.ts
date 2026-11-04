// Categories and tags (editors and above), docs/OPERATIONS.md:
//   #/taxonomy?field=&q=&item=<value>&action=rename|delete&to=<value>&out=1
//     only the fields the site config declares as a taxonomy (taxonomy-fields.ts): never a date, an order or any
//     other shared value. Every value of the field with how many entries use it (and how many are live); a value opens on the right to
//     rename it (a name already used merges the two), or delete it: taken out of every entry (out=1) or its entries
//     given another (to=). The summary of each entry comes before anything is written; applying is one change in the
//     site's history, with Undo on the note that follows.
import type { ScreenCtx } from '../host';
import { config } from '../runtime';
import * as api from './api';
import { taxonomyFields } from './taxonomy-fields';
import { button, chips, drawer, el, failure, message, page, searchBox, state, undoToast, value } from './ui';

const STATUS: Record<string, string> = { published: 'Live', draft: 'Draft', scheduled: 'Scheduled' };
const shown = (v: api.FieldValue | undefined): string => (v === null || v === undefined ? '—' : Array.isArray(v) ? v.join(', ') || '(none)' : String(v));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function mountTaxonomy(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Categories and tags', 'Every category and tag in use across the site. Rename one, merge two, or delete one everywhere at once: you see each entry first, and it can be undone.');
  p.bar.hidden = false;
  const layout = el('div.ms-adm-split');
  let fields: api.BulkField[] | null = null;
  let values: api.TaxonomyValue[] = [];
  let loadedFor = '';
  let alive = true;

  /** The fields the site declares as categories or tags (never dates, orders or other shared values). */
  const candidates = () => taxonomyFields(config().collections, fields ?? []);
  const fieldName = () => ctx.params().get('field') ?? candidates()[0]?.name ?? '';
  const labelOf = (name: string) => candidates().find((f) => f.name === name)?.label ?? name;

  async function render(): Promise<void> {
    try {
      fields ??= (await api.bulkFields()).fields;
      const f = fieldName();
      if (f && f !== loadedFor) {
        if (!values.length) p.body.replaceChildren(state('loading', 'Loading…'));
        const r = (await api.taxonomy(f)).values;
        // the URL moved on to another field while this loaded: the newer render draws
        if (fieldName() !== f) return;
        values = r;
        loadedFor = f;
      }
    } catch (e) {
      if (!alive) return;
      p.body.replaceChildren(failure(e, () => void render()));
      return;
    }
    if (!alive) return;
    const all = candidates();
    const f = fieldName();
    p.bar.replaceChildren(searchBox(ctx, 'q', 'Search the values'), all.length ? chips(ctx, 'field', 'Field', all.map((x, i) => [i === 0 && !ctx.params().get('field') ? '' : x.name, x.label])) : el('span'));
    if (!f) return void p.body.replaceChildren(state('empty', 'No categories or tags yet', 'When the site’s settings give posts categories or tags, their values are listed here.'));
    if (!all.some((x) => x.name === f)) return void p.body.replaceChildren(state('empty', 'Not a category or tag', `“${f}” is not one of the site’s categories or tags.`));
    const q = (ctx.params().get('q') ?? '').toLowerCase();
    const rows = values.filter((v) => !q || String(v.value).toLowerCase().includes(q));
    const t = el('table.ms-adm-table.ms-adm-table--rows', el('thead', el('tr', el('th', 'Value'), el('th', 'Entries'), el('th', 'Live'), el('th', ''))));
    const open = ctx.params().get('item');
    t.append(el('tbody', ...rows.map((v) => {
      const act = (action: string, label: string) => button(label, () => ctx.go({ params: { item: String(v.value), action, to: null, out: null } }, true), { small: true, kind: 'quiet' });
      return el(`tr${String(v.value) === open ? '.is-open' : ''}`, el('td', value(String(v.value), 'value', 'ms-adm-strong')), el('td', String(v.entries)), el('td', String(v.live)), el('td.ms-adm-actions', act('rename', 'Rename…'), act('delete', 'Delete…')));
    })));
    const main = el('div.ms-adm-split__main',
      el('p.ms-adm-count', `${plural(rows.length, 'value', 'values')} in ${labelOf(f)}${q ? ` matching “${q}”` : ''}`),
      rows.length ? el('section.ms-adm-card.ms-adm-card--flush', t) : state('empty', q ? 'Nothing matches' : 'No values', q ? 'Try another search.' : 'No entry has a value in this field.'));
    layout.replaceChildren(main);
    p.body.replaceChildren(layout);
    if (open) void itemDrawer(f, open);
  }

  async function itemDrawer(field: string, item: string): Promise<void> {
    const params = ctx.params();
    const close = () => ctx.go({ params: { item: null, action: null, to: null, out: null } }, true);
    const v = values.find((x) => String(x.value) === item);
    const d = drawer(layout, item, close);
    if (!v) return void d.body.replaceChildren(state('empty', 'No such value', `No entry has “${item}” in ${labelOf(field)} now.`));
    const action = params.get('action') === 'delete' ? 'delete' : 'rename';
    const to = params.get('to');
    const out = params.get('out') === '1';
    const others = values.filter((x) => x !== v).map((x) => String(x.value));
    const listId = `ms-adm-tax-${Math.random().toString(36).slice(2, 7)}`;
    const input = el('input.ms-input', { type: 'text', list: listId, spellcheck: 'false', maxlength: '100', 'aria-label': action === 'rename' ? 'New name' : 'Give its entries' });
    input.value = to ?? '';
    const ask = () => input.value.trim() && ctx.go({ params: { to: input.value.trim(), out: null } }, true);
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') ask();
    });
    const pick = el('div.ms-adm-row', input, el('datalist', { id: listId }, ...others.map((o) => el('option', { value: o }))), button('See the change', ask, { icon: 'eye' }));
    const head = el('p', `${plural(v.entries, 'entry has', 'entries have')} it, ${v.live} live.`);
    const form = action === 'rename'
      ? el('div.ms-field.ms-adm-field', el('span.ms-field__label', 'New name'), pick, el('p.ms-field__hint', 'A name another value already has merges the two.'))
      : el('div',
          el('div.ms-adm-row', button('Take it out of every entry', () => ctx.go({ params: { out: '1', to: null } }, true), { kind: out ? 'primary' : undefined })),
          el('div.ms-field.ms-adm-field', el('span.ms-field__label', 'Or give its entries another value'), pick));
    d.body.replaceChildren(head, form);
    const target = action === 'delete' && out ? null : to;
    if (target === null && !(action === 'delete' && out)) return;
    if (target === item) return void d.body.append(state('empty', 'That is its name now', 'Choose another name.'));
    d.body.append(state('loading', 'Finding every entry…'));
    let rows: api.BulkRow[];
    try {
      rows = (await api.taxonomyPlan(field, [v.value], target)).entries;
    } catch (e) {
      d.body.lastElementChild?.replaceWith(failure(e));
      return;
    }
    if (!alive || ctx.params().get('item') !== item) return;
    const ok = rows.filter((x) => !x.problem);
    const live = ok.filter((x) => x.status === 'published').length;
    const names = new Map(config().collections.map((c) => [c.id, c.label]));
    const t = el('table.ms-adm-table', el('thead', el('tr', el('th', 'Entry'), el('th', 'Now'), el('th', 'After'))));
    t.append(el('tbody', ...rows.map((x) =>
      el(`tr${x.problem ? '.is-muted' : ''}`,
        el('td', el('a', { href: `#/e/${encodeURIComponent(x.collection)}/${encodeURIComponent(x.id)}` }, x.title), el('div.ms-adm-sub', `${names.get(x.collection) ?? x.collection} · ${STATUS[x.status ?? ''] ?? x.status ?? ''}`)),
        el('td', shown(x.from)),
        el('td', x.problem ? el('span.ms-adm-sub', `Left as it is: ${x.problem}`) : el('strong', shown(x.to)))))));
    const merges = target !== null && others.includes(target);
    const verb = target === null ? `Take “${item}” out` : merges ? `Merge into “${target}”` : `Rename to “${target}”`;
    const go = button(`${verb}: ${plural(ok.length, 'entry', 'entries')}`, async () => {
      go.disabled = true;
      try {
        const r = await api.bulkApply({ action: 'rename', field, from: [v.value], value: target }, ok.map((x) => ({ collection: x.collection, id: x.id, version: x.version as string })));
        loadedFor = '';
        const n = r.changed.length;
        const left = r.skipped.length ? ` Left as they are: ${r.skipped.map((s) => `“${s.title}”`).join(', ')}.` : '';
        undoToast(ctx, `${target === null ? `Took “${item}” out of` : merges ? `Merged “${item}” into “${target}” in` : `Renamed “${item}” to “${target}” in`} ${plural(n, 'entry', 'entries')}.${r.job ? ' Publishing the live pages.' : ''}${left}`, r.commit, () => {
          loadedFor = '';
          if (alive) void render();
        });
        ctx.go({ params: { item: null, action: null, to: null, out: null } }, true);
      } catch (e) {
        go.disabled = false;
        ctx.toast(message(e), 'error');
      }
    }, { kind: target === null ? 'danger' : 'primary', icon: target === null ? 'trash' : 'check' });
    go.disabled = !ok.length;
    d.body.lastElementChild?.replaceWith(
      el('div',
        el('p', `${plural(ok.length, 'entry changes', 'entries change')}${rows.length > ok.length ? ` (${rows.length - ok.length} left as they are)` : ''}.${live ? ` ${live} ${live === 1 ? 'is' : 'are'} live, so the site is published again.` : ''} One change in the site’s history, with Undo.`),
        el('section.ms-adm-card.ms-adm-card--flush', t),
        el('div.ms-adm-row', go, button('Cancel', close, { kind: 'quiet' }))),
    );
  }

  ctx.setTitle('Categories and tags');
  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
    },
  };
}
