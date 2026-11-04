// The lists screen (docs/EDITOR-UX.md section 4 "List"): Pages or Blog posts (the drawer's words), one row an
// entry: its title first and bold, a Live/Draft/Scheduled pill, language chips when the site tracks locales, when it
// was last edited, and its length; the author, the address and the date are in the row's tooltip and its drawer.
// Everything is in the URL, so a view can be linked to, reloaded and gone back from:
//   #/entries?c=<collection>&status=&author=&tag=&group=&date=7d|30d|year&attention=&q=&sort=-modified&page=
//            &sel=<id>,<id>&item=<id>
// (sort: a column, "-" first for the other way; sel: the ticked rows; item: the row open in the drawer). 50 rows a
// page from the server. Ticked rows get a bar: Go live, Add a tag, Move to trash (with Undo), Change many…. The
// server decides what each role may see and do. The pure parts are in entries-model.ts.
import { authors, authorsOn } from '../authors';
import { duplicateEntry, getEntry, listEntries, request, type EntrySummary } from '../api';
import type { ScreenCtx } from '../host';
import { ic } from '../icons';
import { collection, config } from '../runtime';
import * as api from './api';
import { collectionWord } from '../shell-words';
import { ATTENTION_CHOICES, DATE_CHOICES, FILTER_KEYS, hasFilters, kindWords, langChip, pageCount, pageRange, rowTip, selectedWords, sinceOf, STATUS_CHIPS } from './entries-model';
import { button, drawer, el, facts, failure, icon, isEditorPlus, link, message, page, state, value, when, whoami } from './ui';

const PER_PAGE = 50;
const PILL: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Live' };
const NUM = new Intl.NumberFormat();

/** A column: its sort key, header, and which way a first click sorts (dates and numbers newest or largest first). */
interface Col {
  key: string;
  label: string;
  first: '' | '-';
  num?: boolean;
  shown?: (r: api.EntryList) => boolean;
}
const COLS: Col[] = [
  { key: 'title', label: 'Title', first: '' },
  { key: 'status', label: 'Status', first: '' },
  { key: 'modified', label: 'Last edited', first: '-', shown: (r) => r.items.some((e) => e.modified) },
  { key: 'words', label: 'Words', first: '-', num: true, shown: (r) => r.items.some((e) => typeof e.words === 'number') },
];

export function mountEntries(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Pages', 'Click one to open it, or tick several to change them together.');
  p.bar.hidden = false;
  const layout = el('div.ms-adm-split');
  let list: api.EntryList | null = null;
  let loadedFor = '';
  let editor = false;
  let canCreate = new Map<string, boolean>();
  let alive = true;
  let typing = 0;
  let names = new Map<string, string>();
  let groups: Map<string, string> | null = null;
  let groupsFor = '';

  const collections = () => config().collections;
  /** The URL's view; an unknown sort or a page below 1 falls back to the default. */
  const query = () => {
    const q = ctx.params();
    return {
      c: q.get('c') ?? collections()[0]?.id ?? '',
      status: q.get('status') ?? '',
      author: q.get('author') ?? '',
      tag: q.get('tag') ?? '',
      group: q.get('group') ?? '',
      date: q.get('date') ?? '',
      attention: q.get('attention') ?? '',
      q: q.get('q') ?? '',
      sort: q.get('sort') || '-modified',
      page: Math.max(1, Number.parseInt(q.get('page') ?? '', 10) || 1),
    };
  };
  type Query = ReturnType<typeof query>;
  const selected = () => new Set((ctx.params().get('sel') ?? '').split(',').filter(Boolean));
  const noFilters = Object.fromEntries(FILTER_KEYS.map((k) => [k, null])) as Record<string, null>;
  /** A change of view: back to page 1 and nothing ticked, as a history entry (Back undoes it). */
  const view = (params: Record<string, string | null>) => ctx.go({ params: { page: null, sel: null, item: null, ...params } }, true);
  const nameOf = (slug: string) => names.get(slug) ?? slug;
  const openHref = (c: string, id: string) => `#/${collection(c)?.format === 'json' ? 'p' : 'e'}/${encodeURIComponent(c)}/${encodeURIComponent(id)}`;
  /** The word for this kind of content (Pages, Blog posts, or the collection's own label). */
  const wordFor = (c: string) => {
    const info = collections().find((x) => x.id === c);
    return info ? collectionWord(info) : c;
  };

  async function render(): Promise<void> {
    const q = query();
    const key = JSON.stringify(q);
    if (key !== loadedFor) {
      if (!list) p.body.replaceChildren(state('loading', 'Loading…'));
      try {
        const me = await whoami();
        editor = isEditorPlus(me);
        if (!canCreate.size) canCreate = new Map((await request<{ id: string; can?: { create: boolean } }[]>('collections').catch(() => [])).map((c) => [c.id, !!c.can?.create]));
        const r = await api.entries(q.c, { status: q.status, author: q.author, tag: q.tag, group: q.group, since: sinceOf(q.date), attention: q.attention, q: q.q, sort: q.sort, page: q.page, perPage: PER_PAGE });
        // gone, or the URL moved on while this list loaded (Back then Forward quickly): the newer render draws, never
        // an old list under the new sort or filters
        if (!alive || JSON.stringify(query()) !== key) return;
        // astro dev's list may lack the choices: the filters then offer only what the URL asks
        list = { ...r, facets: { authors: r.facets?.authors ?? [], tags: r.facets?.tags ?? [] } };
        loadedFor = key;
        // a site that keeps author files: their names in place of the slugs the entries keep
        if (authorsOn(q.c) && !names.size) names = new Map((await authors().catch(() => [])).map((a) => [a.slug, a.name]));
        // the sections (topics) this kind of content is sorted into, by name
        const g = collection(q.c)?.groups;
        if (groupsFor !== q.c) {
          groups = g ? new Map((await listEntries(g.collection).catch(() => [] as EntrySummary[])).map((e) => [e.id, e.title])) : null;
          groupsFor = q.c;
        }
        if (!alive || JSON.stringify(query()) !== key) return;
      } catch (e) {
        if (!alive || JSON.stringify(query()) !== key) return;
        list = null;
        loadedFor = '';
        p.bar.replaceChildren();
        p.body.replaceChildren(failure(e, () => void render()));
        return;
      }
    }
    // the kind's own name (Pages, Blog posts), in the title, the tab and the New button
    const word = wordFor(q.c);
    const words = kindWords(word);
    p.head.querySelector('.ms-adm-title')!.textContent = word;
    ctx.setTitle(word);
    p.actions.replaceChildren(canCreate.get(q.c) ? el('a.ms-btn.ms-btn--primary', { href: `#/new/${encodeURIComponent(q.c)}`, html: `${ic('plus', 15)}<span>${words.newLabel}</span>` }) : '');
    filters(q, list!);
    table(q, list!, words);
  }

  function filters(q: Query, r: api.EntryList): void {
    // the status as chips with how many each holds (the other filters applied)
    const chips = el('div.ms-adm-chips', { role: 'group', 'aria-label': 'Status' });
    for (const [v, l] of STATUS_CHIPS) {
      const n = v ? r.counts[v as keyof api.EntryList['counts']] : r.counts.all;
      const b = el('button.ms-adm-chip', { type: 'button', 'aria-pressed': String(v === q.status) }, l, ' ', el('span.ms-adm-chip__n.ms-num', NUM.format(n)));
      b.addEventListener('click', () => view({ status: v || null }));
      chips.append(b);
    }
    /** A select that filters by `key`: the first option is "every", the rest the choices with their counts. */
    const pick = (key: 'author' | 'tag' | 'group' | 'date' | 'attention', label: string, all: string, options: [string, string][]) => {
      const s = el('select.ms-input.ms-adm-select', { 'aria-label': label }, el('option', { value: '' }, all));
      for (const [v, l] of options) s.append(el('option', { value: v, selected: v === q[key] }, l));
      if (q[key] && !options.some(([v]) => v === q[key])) s.append(el('option', { value: q[key], selected: true }, q[key]));
      if (q[key]) s.classList.add('is-on');
      s.addEventListener('change', () => view({ [key]: s.value || null }));
      return s;
    };
    const search = el('input.ms-input.ms-adm-search', { type: 'search', placeholder: 'Search', 'aria-label': 'Search entries' });
    search.value = q.q;
    // typing replaces the address (no history entry per key press), and goes back to page 1
    search.addEventListener('input', () => {
      clearTimeout(typing);
      typing = window.setTimeout(() => ctx.go({ params: { q: search.value.trim() || null, page: null, sel: null } }), 250);
    });
    const clear = hasFilters(q) ? button('Clear filters', () => view(noFilters), { kind: 'quiet', small: true }) : null;
    const focused = document.activeElement?.classList.contains('ms-adm-search');
    const sections = groups ? [...groups].map(([id, title]) => [id, title] as [string, string]).sort((a, b) => a[1].localeCompare(b[1])) : [];
    p.bar.replaceChildren(
      chips,
      r.facets.authors.length || q.author ? pick('author', 'Filter by author', 'Author', r.facets.authors.map((o) => [o.name, `${nameOf(o.name)} (${NUM.format(o.count)})`])) : '',
      sections.length || q.group ? pick('group', 'Filter by section', collection(q.c)?.groups?.label ?? 'Section', sections) : '',
      pick('date', 'Filter by date', 'Any time', DATE_CHOICES.slice(1)),
      pick('attention', 'Needs attention', 'Needs attention', ATTENTION_CHOICES.slice(1)),
      r.facets.tags.length || q.tag ? pick('tag', 'Filter by tag', 'Tag', r.facets.tags.map((o) => [o.name, `${o.name} (${NUM.format(o.count)})`])) : '',
      clear ?? '',
      el('label.ms-adm-searchwrap.ms-adm-searchwrap--end', icon('search', 15), search),
    );
    if (focused) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  function table(q: Query, r: api.EntryList, words: ReturnType<typeof kindWords>): void {
    const cols = COLS.filter((c) => !c.shown || c.shown(r));
    const sel = selected();
    const desc = q.sort.startsWith('-');
    const by = q.sort.replace(/^-/, '');
    const head = el('tr');
    if (editor) {
      const all = el('input', { type: 'checkbox', 'aria-label': 'Tick every entry on this page' });
      all.checked = r.items.length > 0 && r.items.every((e) => sel.has(e.id));
      all.addEventListener('change', () => tick(all.checked ? [...new Set([...sel, ...r.items.map((e) => e.id)])] : [...sel].filter((id) => !r.items.some((e) => e.id === id))));
      head.append(el('th.ms-adm-tick', all));
    }
    for (const c of cols) {
      const on = by === c.key;
      const next = on ? (desc ? '' : '-') : c.first;
      const b = el('button.ms-adm-sort', { type: 'button', title: `Sort by ${c.label.toLowerCase()}` }, c.label, el('span.ms-adm-sort__dir', { 'aria-hidden': 'true' }, on ? (desc ? '↓' : '↑') : ''));
      b.addEventListener('click', () => ctx.go({ params: { sort: `${next}${c.key}`, page: null } }, true));
      head.append(el(`th.ms-adm-col--${c.key}${c.num ? '.ms-num' : ''}`, { 'aria-sort': on ? (desc ? 'descending' : 'ascending') : 'none', scope: 'col' }, b));
    }
    head.append(el('th.ms-adm-col--more', el('span.ms-visually-hidden', 'Details')));
    const open = ctx.params().get('item');
    const tb = el('tbody');
    for (const e of r.items) {
      const tr = el(`tr${sel.has(e.id) || e.id === open ? '.is-open' : ''}`);
      if (editor) {
        const box = el('input', { type: 'checkbox', 'aria-label': `Tick “${e.title}”` });
        box.checked = sel.has(e.id);
        box.addEventListener('change', () => tick(box.checked ? [...sel, e.id] : [...sel].filter((x) => x !== e.id)));
        tr.append(el('td.ms-adm-tick', box));
      }
      for (const c of cols) tr.append(cell(c, e, q.c));
      const more = el('button.ms-iconbtn.ms-adm-rowmore', { type: 'button', 'aria-label': `Details of “${e.title}”`, title: 'Details', html: ic('info', 15) });
      more.addEventListener('click', () => ctx.go({ params: { item: e.id === open ? null : e.id } }, true));
      tr.append(el('td.ms-adm-col--more', more));
      tb.append(tr);
    }
    const t = el('table.ms-adm-table.ms-adm-table--rows.ms-adm-entries', el('thead', head), tb);
    const pages = pageCount(r.total, r.perPage);
    const paging = el('div.ms-adm-row.ms-adm-paging',
      el('span.ms-adm-sub.ms-num', { 'aria-live': 'polite' }, pageRange(r.total, r.page, r.perPage)),
      el('span.ms-adm-paging__btns',
        iconBtn('Previous', '‹', r.page > 1, () => ctx.go({ params: { page: r.page - 1 > 1 ? String(r.page - 1) : null, item: null } }, true)),
        iconBtn('Next', '›', r.page < pages, () => ctx.go({ params: { page: String(r.page + 1), item: null } }, true)),
      ),
    );
    if (!r.items.length) {
      p.body.replaceChildren(hasFilters(q)
        ? state('empty', 'Nothing matches', 'No entry matches these filters.', button('Clear filters', () => view(noFilters), { small: true }))
        : state('empty', 'Nothing is written yet', 'Your first one can start now.', canCreate.get(q.c) ? el('a.ms-btn.ms-btn--primary', { href: `#/new/${encodeURIComponent(q.c)}`, html: `${ic('plus', 15)}<span>${words.first}</span>` }) : undefined));
      return;
    }
    const main = el('div.ms-adm-split__main', editor ? selectionBar(q, r, sel) : null, el('section.ms-adm-card.ms-adm-card--flush', t), paging);
    layout.replaceChildren(main);
    p.body.replaceChildren(layout);
    if (open) itemDrawer(q.c, open, r);
  }

  const iconBtn = (label: string, glyph: string, on: boolean, run: () => void) => {
    const b = el('button.ms-iconbtn.ms-adm-paging__btn', { type: 'button', 'aria-label': label, title: label }, glyph);
    b.disabled = !on;
    b.addEventListener('click', run);
    return b;
  };

  /** The ticked rows' bar: there (empty) when nothing is ticked, so ticking never moves the table. */
  function selectionBar(q: Query, r: api.EntryList, sel: Set<string>): HTMLElement {
    const bar = el('div.ms-adm-row.ms-adm-selbar.ms-adm-selbar--lists', { role: 'status' });
    if (!sel.size) return bar;
    const items = () => [...sel].map((id) => `${q.c}/${id}`).join(',');
    const tagsField = (collection(q.c)?.settings ?? []).find((f) => f.type === 'tags') as { key: string } | undefined;
    bar.append(
      el('span.ms-adm-selbar__n', `${selectedWords(sel.size)}:`),
      button('Go live', () => void goLive(q.c, [...sel], r), { small: true, kind: 'quiet', icon: 'send' }),
      button('Add a tag', () => ctx.open(`#/bulk?items=${encodeURIComponent(items())}&action=add&field=${encodeURIComponent(tagsField?.key ?? 'tags')}`, true), { small: true, kind: 'quiet', icon: 'plus' }),
      button('Move to trash', () => void toTrash(q.c, [...sel], r), { small: true, kind: 'quiet', icon: 'trash' }),
      button('Change many…', () => ctx.open(`#/bulk?items=${encodeURIComponent(items())}`, true), { small: true, kind: 'quiet', icon: 'list' }),
      button('Untick', () => tick([]), { small: true, kind: 'quiet' }),
    );
    return bar;
  }

  /** Each ticked entry's version: from this page's rows, else read from the server. */
  async function versionsOf(c: string, ids: string[], r: api.EntryList): Promise<{ id: string; version: string; status: string; title: string }[]> {
    const out = [];
    for (const id of ids) {
      const here = r.items.find((e) => e.id === id);
      if (here) out.push({ id, version: here.version, status: here.status, title: here.title });
      else {
        const e = await getEntry(c, id);
        out.push({ id, version: e.version, status: e.status ?? 'published', title: e.title });
      }
    }
    return out;
  }

  /** Go live: each ticked draft is published on its own (the publish rules check each one; a refusal is named). */
  async function goLive(c: string, ids: string[], r: api.EntryList): Promise<void> {
    try {
      const rows = (await versionsOf(c, ids, r)).filter((x) => x.status !== 'published');
      if (!rows.length) return ctx.toast('Everything ticked is live already.', 'info');
      const ok = await ctx.ask(`Put ${rows.length === 1 ? 'this one' : `these ${rows.length}`} live?`, 'Each one goes through the publish checks; one that fails them stays a draft and is named.', [['cancel', 'Cancel'], ['go', 'Go live', 'ms-btn ms-btn--primary']]);
      if (ok !== 'go') return;
      const refused: string[] = [];
      let done = 0;
      for (const x of rows) {
        try {
          await api.publish(c, x.id, x.version);
          done++;
        } catch (e) {
          refused.push(`“${x.title}”: ${message(e)}`);
        }
      }
      ctx.toast(`${done ? `${done} going live.` : 'Nothing went live.'}${refused.length ? ` Stayed a draft: ${refused.join('; ')}` : ''}`, refused.length ? 'info' : 'ok');
      tick([]);
      reload();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  /** Move to trash, with Undo on the toast: each one is restored (as a draft) from the trash. */
  async function toTrash(c: string, ids: string[], r: api.EntryList): Promise<void> {
    try {
      const rows = await versionsOf(c, ids, r);
      const ok = await ctx.ask(`Move ${rows.length === 1 ? `“${rows[0]!.title}”` : `these ${rows.length}`} to the trash?`, 'They leave the site and wait in the trash, where they can be brought back.', [['cancel', 'Cancel'], ['go', 'Move to trash', 'ms-btn ms-btn--danger']]);
      if (ok !== 'go') return;
      const out = await api.bulkApply({ action: 'trash' }, rows.map((x) => ({ collection: c, id: x.id, version: x.version })));
      const n = out.changed.length;
      const left = out.skipped.length ? ` Left as they are: ${out.skipped.map((s) => `“${s.title}”`).join(', ')}.` : '';
      const back = out.changed.filter((x) => x.trashId);
      ctx.toast(`${n ? `Moved ${n} to the trash.` : 'Nothing was moved.'}${left}`, n ? 'ok' : 'info', back.length ? {
        action: {
          label: 'Undo',
          run: () => void Promise.all(back.map((x) => api.restoreTrash(x.trashId!))).then(
            () => (ctx.toast(`Brought ${back.length === 1 ? 'it' : `${back.length}`} back as ${back.length === 1 ? 'a draft' : 'drafts'}.`, 'ok'), reload()),
            (e) => ctx.toast(message(e), 'error'),
          ),
        },
      } : undefined);
      tick([]);
      reload();
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  /** The row's drawer: what the table leaves out (author, address, dates, languages) and the row's own actions. */
  function itemDrawer(c: string, id: string, r: api.EntryList): void {
    const close = () => ctx.go({ params: { item: null } }, true);
    const e = r.items.find((x) => x.id === id);
    const d = drawer(layout, e?.title ?? id, close);
    if (!e) return void d.body.replaceChildren(state('empty', 'Not on this page', 'This entry is not in the rows shown now.'));
    const rows: [string, Node | string][] = [['Status', el('span', el(`span.ms-adm-pill.is-${e.status}`, PILL[e.status] ?? e.status), e.held ? el('div.ms-adm-sub', 'Held: ', e.held.reasons[0] ?? '') : null, e.status === 'scheduled' && e.publishAt ? el('div.ms-adm-sub', 'Goes live ', when(e.publishAt)) : null)]];
    if (e.url) rows.push(['Address', link(e.url, 'address')]);
    if (e.author) rows.push(['Author', names.has(e.author) ? value(nameOf(e.author), 'author') : value(e.author, 'author')]);
    if (e.groupId && groups?.get(e.groupId)) rows.push([collection(c)?.groups?.label ?? 'Section', groups.get(e.groupId)!]);
    if (e.date) rows.push(['Date', when(e.date)]);
    if (e.modified) rows.push(['Last edited', when(e.modified)]);
    if (typeof e.words === 'number') rows.push(['Words', el('span.ms-num', NUM.format(e.words))]);
    if (e.locales?.length) rows.push(['Languages', el('span.ms-adm-langs', ...e.locales.map((l) => chip(l)))]);
    if (e.tags.length) rows.push(['Tags', e.tags.join(', ')]);
    rows.push(['Title', value(e.title, 'title')]);
    const actions = el('div.ms-adm-row.ms-adm-drawer__actions', el('a.ms-btn.ms-btn--primary', { href: openHref(c, e.id) }, 'Open'));
    if (canCreate.get(c)) actions.append(button('Duplicate', () => void duplicate(c, e.id), { icon: 'duplicate' }));
    if (editor) actions.append(button('Move to trash', () => void toTrash(c, [e.id], r), { icon: 'trash', kind: 'danger' }));
    d.body.replaceChildren(facts(rows), actions);
  }

  /** A draft copy, opened at once. */
  async function duplicate(c: string, id: string): Promise<void> {
    try {
      const made = await duplicateEntry(c, id);
      ctx.toast(`Made “${made.title}” as a draft.`, 'ok');
      ctx.open(openHref(c, made.id), true);
    } catch (e) {
      ctx.toast(message(e), 'error');
    }
  }

  const reload = () => {
    loadedFor = '';
    if (alive) void render();
  };

  /** The ticked rows: replaces the address (ticking is not a view of its own to go back through). */
  const tick = (ids: string[]) => ctx.go({ params: { sel: ids.length ? ids.join(',') : null } });

  const chip = (l: { code: string; done: boolean }) => {
    const w = langChip(l);
    return el(`span.ms-adm-lang${w.done ? '.is-done' : ''}`, { title: w.title }, w.text);
  };

  function cell(c: Col, e: api.ListedEntry, coll: string): HTMLElement {
    switch (c.key) {
      case 'title':
        return el('td.ms-adm-col--title', { title: rowTip(e, e.author ? nameOf(e.author) : null) },
          el('a.ms-adm-rowlink', { href: openHref(coll, e.id) }, e.title),
          e.locales?.length ? el('span.ms-adm-langs', ...e.locales.map(chip)) : null);
      case 'status':
        return el('td.ms-adm-col--status', el(`span.ms-adm-pill.is-${e.status}`, { title: e.held ? `Held: ${e.held.reasons[0] ?? ''}` : e.status === 'scheduled' && e.publishAt ? `Goes live ${ago(e.publishAt)}` : undefined }, PILL[e.status] ?? e.status));
      case 'words':
        return el('td.ms-num.ms-adm-col--words', typeof e.words === 'number' ? NUM.format(e.words) : el('span.ms-adm-none', '—'));
      default:
        return el('td.ms-adm-when.ms-adm-col--modified', e.modified ? when(e.modified) : el('span.ms-adm-none', '—'));
    }
  }
  const ago = (iso: string) => when(iso).textContent ?? '';

  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
      clearTimeout(typing);
    },
  };
}
