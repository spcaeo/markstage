// #/translations?locale=&status=&collection=&q=&sort=&page=&item=<collection>/<id>/<locale>: what each region still
// needs in its own words (docs/API-TRANSLATIONS.md): an entry's title and description per tracked locale, missing,
// outdated (its source changed after it) or done. Needs work first, newest source change first. The open row's
// drawer (item=) shows each field's source next to its translation (copy icons), and opens the entry's Post settings
// at that region to translate it (or with the AI's draft, when the server has AI). Every view is its URL; Back undoes
// a filter. Read-only: a translation is saved like any other change to the entry.
import { aiInfo } from '../ai/api';
import { ApiError, request } from '../api';
import type { ScreenCtx } from '../host';
import { collection, config } from '../runtime';
import { button, drawer, el, failure, facts, icon, link, page, state, value, when } from '../admin/ui';
import { PER_PAGE, translations, type Sort, type StatusFilter, type TField, type TItem, type TList, type TLocale, type TStatus } from './api';

const NUM = new Intl.NumberFormat();
const STATUS: [StatusFilter, string][] = [['needs', 'Needs work'], ['missing', 'Missing'], ['outdated', 'Outdated'], ['done', 'Done'], ['all', 'All']];
const WORD: Record<TStatus, string> = { missing: 'Missing', outdated: 'Outdated', done: 'Done' };
const FIELD: Record<'title' | 'description', string> = { title: 'Title', description: 'Description' };
/** an open row: collection/id/locale (opaque ids) */
const ITEM = /^([a-z][a-z0-9-]{0,39})\/([a-z0-9][a-z0-9-]{0,99})\/([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/;

const badge = (s: TStatus) => el(`span.ms-adm-badge.ms-tr-badge.ms-tr-badge--${s}`, WORD[s]);
const editHash = (i: { collection: string; id: string }) =>
  `#/${collection(i.collection)?.format === 'json' ? 'p' : 'e'}/${encodeURIComponent(i.collection)}/${encodeURIComponent(i.id)}?s=1`;

export function mountTranslations(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Languages', 'What each language still needs in its own words: a title or description that is missing, or older than the text it translates.');
  p.bar.hidden = false;
  const layout = el('div.ms-adm-split');
  let list: TList | null = null;
  let loadedFor = '';
  let alive = true;
  let typing = 0;
  let ai = false;
  /** the open row, read from the entry's own route (it may be on another page of the list) */
  let open: { key: string; item: TItem | null; locale: TLocale | null; error?: unknown; pending?: boolean } | null = null;
  /** the row whose drawer last took the focus (a redraw for a filter leaves the focus where it is) */
  let focusedFor = '';

  /** The URL's view: what is unknown here is sent as it is, and the server's 422 says so. */
  const query = () => {
    const q = ctx.params();
    return {
      locale: q.get('locale') ?? '',
      status: (q.get('status') ?? 'needs') as StatusFilter,
      collection: q.get('collection') ?? '',
      q: q.get('q') ?? '',
      sort: (q.get('sort') ?? 'changed') as Sort,
      page: Math.max(1, Number.parseInt(q.get('page') ?? '', 10) || 1),
    };
  };
  /** A change of view: back to page 1, as a history entry (Back undoes it). */
  const view = (params: Record<string, string | null>) => ctx.go({ params: { page: null, ...params } }, true);
  const close = () => ctx.go({ params: { item: null } }, true);

  async function render(): Promise<void> {
    const q = query();
    const key = JSON.stringify(q);
    if (key !== loadedFor) {
      if (!list) p.body.replaceChildren(state('loading', 'Reading the translations…'));
      try {
        const [r, info] = await Promise.all([translations(q), aiInfo().catch(() => null)]);
        if (!alive) return;
        list = r;
        ai = !!info?.on && info.kinds.includes('translate');
        loadedFor = key;
      } catch (e) {
        if (!alive) return;
        list = null;
        loadedFor = '';
        p.bar.replaceChildren();
        p.body.replaceChildren(failure(e, () => void render()));
        return;
      }
    }
    if (!list!.locales.length) {
      p.bar.replaceChildren();
      return void p.body.replaceChildren(
        state('empty', 'No region to translate', 'Every page uses the same words in every region. A region whose config lists title or description in its `overrides` gets its own, and shows here.'),
      );
    }
    filters(q, list!);
    table(q, list!);
    await item();
  }

  function filters(q: ReturnType<typeof query>, r: TList): void {
    const needs = (c: Record<TStatus, number> | undefined) => (c ? c.missing + c.outdated : 0);
    const bar: HTMLElement[] = [];
    if (r.locales.length > 1) {
      const g = el('div.ms-adm-chips', { role: 'group', 'aria-label': 'Region' });
      const all = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(!q.locale) }, 'Every region');
      all.addEventListener('click', () => view({ locale: null, item: null }));
      g.append(all);
      for (const l of r.locales) {
        const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(l.code === q.locale), title: `${NUM.format(needs(r.counts[l.code]))} need work` }, l.label, ' ', el('span.ms-adm-chip__n.ms-num', NUM.format(needs(r.counts[l.code]))));
        b.addEventListener('click', () => view({ locale: l.code, item: null }));
        g.append(b);
      }
      bar.push(g);
    }
    // how many of each, for the region (or every region) and the search
    const sum = (s: TStatus) => Object.entries(r.counts).reduce((n, [code, c]) => (!q.locale || code === q.locale ? n + c[s] : n), 0);
    const n: Record<StatusFilter, number> = { missing: sum('missing'), outdated: sum('outdated'), done: sum('done'), needs: 0, all: 0 };
    n.needs = n.missing + n.outdated;
    n.all = n.needs + n.done;
    const st = el('div.ms-adm-chips', { role: 'group', 'aria-label': 'Status' });
    for (const [v, l] of STATUS) {
      const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(v === q.status) }, l, ' ', el('span.ms-adm-chip__n.ms-num', NUM.format(n[v])));
      b.addEventListener('click', () => view({ status: v === 'needs' ? null : v, item: null }));
      st.append(b);
    }
    bar.push(st);
    const cols = config().collections;
    if (cols.length > 1) {
      const s = el('select.ms-input.ms-adm-select', { 'aria-label': 'Collection' }, el('option', { value: '' }, 'Every collection'));
      for (const c of cols) s.append(el('option', { value: c.id, selected: c.id === q.collection }, c.label));
      s.addEventListener('change', () => view({ collection: s.value || null, item: null }));
      bar.push(s);
    }
    const sort = el('select.ms-input.ms-adm-select', { 'aria-label': 'Sort' }, el('option', { value: 'changed', selected: q.sort === 'changed' }, 'Newest change first'), el('option', { value: 'title', selected: q.sort === 'title' }, 'By title'));
    sort.addEventListener('change', () => view({ sort: sort.value === 'changed' ? null : sort.value }));
    bar.push(sort);
    const search = el('input.ms-input.ms-adm-search', { type: 'search', placeholder: 'Search titles', 'aria-label': 'Search titles' });
    search.value = q.q;
    // typing replaces the address (no history entry per key press), and goes back to page 1
    search.addEventListener('input', () => {
      clearTimeout(typing);
      typing = window.setTimeout(() => ctx.go({ params: { q: search.value.trim() || null, page: null } }), 250);
    });
    const focused = document.activeElement?.classList.contains('ms-adm-search');
    p.bar.replaceChildren(el('label.ms-adm-searchwrap', icon('search', 15), search), ...bar);
    if (focused) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  function table(q: ReturnType<typeof query>, r: TList): void {
    const labels = new Map(r.locales.map((l) => [l.code, l.label]));
    const openKey = ctx.params().get('item');
    if (!r.items.length) {
      const filtered = q.q || q.collection || q.status !== 'needs';
      layout.replaceChildren(
        el('div.ms-adm-split__main',
          filtered
            ? state('empty', 'Nothing here', 'No entry matches these filters.', button('Show what needs work', () => view({ status: null, q: null, collection: null }), { small: true }))
            : state('empty', 'Everything is translated', 'Every title and description has its own words in each region, and none is older than its source.')),
      );
      p.body.replaceChildren(layout);
      return;
    }
    const cell = (f: TField | undefined) => (f ? badge(f.status) : el('span.ms-adm-none', '—'));
    const tb = el('tbody');
    for (const i of r.items) {
      const key = `${i.collection}/${i.id}/${i.locale}`;
      const details = button('Details', () => ctx.go({ params: { item: key } }, true), { small: true, kind: 'quiet' });
      details.setAttribute('aria-label', `Details of “${i.title || i.id}” in ${labels.get(i.locale) ?? i.locale}`);
      tb.append(
        el(`tr${key === openKey ? '.is-open' : ''}`, { 'data-item': key },
          el('td', el('div.ms-adm-stack', value(i.title || i.id, 'title', 'ms-adm-strong'), i.url ? link(i.url, 'address', 'ms-adm-sub') : null)),
          el('td', labels.get(i.locale) ?? i.locale),
          el('td', badge(i.status)),
          el('td.ms-tr-more', cell(i.fields.title)),
          el('td.ms-tr-more', cell(i.fields.description)),
          el('td', when(i.sourceChangedAt)),
          el('td.ms-tr-more', i.translatedAt ? when(i.translatedAt) : el('span.ms-adm-none', 'Never')),
          el('td', details),
        ),
      );
    }
    // with a row open beside it, the table keeps its entry, region, status and source change (the rest is in the drawer)
    const more = new Set(['Title', 'Description', 'Translated']);
    const head = el('tr', ...['Entry', 'Region', 'Status', 'Title', 'Description', 'Source changed', 'Translated', ''].map((h) => el(more.has(h) ? 'th.ms-tr-more' : 'th', { scope: 'col' }, h)));
    const t = el('table.ms-adm-table.ms-adm-table--rows.ms-tr-table', el('thead', head), tb);
    const from = (r.page - 1) * r.perPage + 1;
    const to = Math.min(r.total, r.page * r.perPage);
    const pages = Math.max(1, Math.ceil(r.total / r.perPage));
    const paging = el('div.ms-adm-row.ms-adm-paging',
      el('span.ms-adm-sub.ms-num', { 'aria-live': 'polite' }, `${NUM.format(from)}–${NUM.format(to)} of ${NUM.format(r.total)}`),
      r.page > 1 ? button('Previous', () => ctx.go({ params: { page: r.page - 1 > 1 ? String(r.page - 1) : null } }, true), { small: true }) : null,
      r.page < pages ? button('Next', () => ctx.go({ params: { page: String(r.page + 1) } }, true), { small: true }) : null,
    );
    layout.replaceChildren(el('div.ms-adm-split__main', el('section.ms-adm-card.ms-adm-card--flush', t), r.total > PER_PAGE ? paging : ''));
    p.body.replaceChildren(layout);
  }

  /** The open row's drawer: read from the entry's own route, so a link to it works from any page of the list. */
  async function item(): Promise<void> {
    const key = ctx.params().get('item');
    if (!key) {
      open = null;
      focusedFor = '';
      return;
    }
    const m = ITEM.exec(key);
    if (!m) return void drawItem(null, null);
    const [, c, id, code] = m;
    if (open?.key === key && open.pending) return;
    if (open?.key !== key) {
      open = { key, item: null, locale: null, pending: true };
      const d = drawer(layout, 'Translation', close);
      d.body.append(state('loading', 'Reading it…'));
      try {
        const r = await request<{ locales: (TLocale & Omit<TItem, 'collection' | 'id' | 'title' | 'url' | 'entryStatus' | 'locale'>)[] }>(`collections/${encodeURIComponent(c)}/entries/${encodeURIComponent(id)}/translations`);
        const l = r.locales.find((x) => x.code === code) ?? null;
        const row = list?.items.find((x) => x.collection === c && x.id === id && x.locale === code);
        open = {
          key,
          locale: l ? { code: l.code, label: l.label, sameLanguage: l.sameLanguage } : null,
          item: l ? { collection: c, id, title: row?.title ?? id, url: row?.url ?? null, entryStatus: row?.entryStatus ?? '', locale: code, status: l.status, fields: l.fields, sourceChangedAt: l.sourceChangedAt, translatedAt: l.translatedAt, can: l.can ?? row?.can } : null,
        };
      } catch (e) {
        open = { key, item: null, locale: null, error: e };
      }
      if (!alive || ctx.params().get('item') !== key) return;
      d.el.remove();
    } else layout.querySelector('.ms-adm-drawer')?.remove();
    drawItem(open.item, open.locale, open.error);
  }

  function drawItem(i: TItem | null, l: TLocale | null, error?: unknown): void {
    const d = drawer(layout, 'Translation', close);
    if (error && !(error instanceof ApiError && (error.status === 403 || error.status === 404))) return void d.body.append(failure(error, () => ((open = null), void item())));
    if (!i || !l) return void d.body.append(state('denied', 'Not available to you', 'This entry or region is not here, or your role cannot open it.'));
    const edit = i.can?.edit !== false;
    d.body.append(
      facts([
        ['Entry', value(i.title, 'title')],
        ['Address', i.url ? link(i.url, 'address') : el('span.ms-adm-none', 'None')],
        ['Region', el('span', `${l.label} `, value(l.code, 'region code', 'ms-adm-sub'))],
        ['Status', badge(i.status)],
      ]),
    );
    if (l.sameLanguage) d.body.append(el('p.ms-adm-sub', 'Same language as the source: an empty field uses the source text (respelled for this region when the site does that).'));
    for (const k of ['title', 'description'] as const) {
      const f = i.fields[k];
      if (!f) continue;
      d.body.append(
        el('section.ms-tr-field', { 'data-field': k },
          el('h3.ms-tr-field__head', FIELD[k], ' ', badge(f.status)),
          el('div.ms-tr-field__row', el('span.ms-tr-field__tag', 'Source'), f.source ? value(f.source, `the source ${k}`) : el('span.ms-adm-none', 'Empty'), el('span.ms-adm-sub', 'Changed ', when(f.sourceChangedAt))),
          el('div.ms-tr-field__row', el('span.ms-tr-field__tag', 'Translation'), f.value ? value(f.value, `the ${k} in ${l.label}`) : el('span.ms-adm-none', 'Empty'), el('span.ms-adm-sub', f.translatedAt ? el('span', 'Changed ', when(f.translatedAt)) : 'Never written')),
        ),
      );
    }
    const md = collection(i.collection)?.format !== 'json';
    d.body.append(
      el('div.ms-adm-row.ms-tr-acts',
        button(edit ? 'Translate in Post settings' : 'View in Post settings', () => ctx.open(editHash(i), true), { kind: 'primary', icon: 'globe' }),
        edit && ai && md && i.status !== 'done' ? button('Draft with AI', () => ctx.open(`${editHash(i)}&suggest=translate&loc=${encodeURIComponent(l.code)}`, true), { icon: 'sparkle' }) : null,
      ),
    );
    if (focusedFor !== open?.key) {
      focusedFor = open?.key ?? '';
      d.el.focus({ preventScroll: true });
    }
  }

  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
      clearTimeout(typing);
    },
  };
}
