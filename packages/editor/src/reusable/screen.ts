// #/library?q=&kind=template|section|snippet&synced=1&folder=&tag=&open=<id>&pick=<id,id>&import=1&step=&src=&arrange=1: the Library
// (docs/OPERATIONS.md "Library"). Page templates, sections and snippets in one place, shown as filters, not tabs:
// each folder a group of cards with a picture, what it is, and for a synced item how many pages use it. An item opens
// in the drawer (open=, item.ts); ticked items (pick=) go out as a pack; Import… brings items in (import.ts). Every
// state is in the URL, so a view can be linked to and Back undoes it.
import { ApiError } from '../api';
import { button, chips, el, failure, icon, isEditorPlus, page, searchBox, state, whoami } from '../admin/ui';
import type { ScreenCtx } from '../host';
import { sectionPicture } from '../pages/pictures';
import { humanize } from '../pages/schema';
import { collection } from '../runtime';
import * as api from './api';
import { mountArrange } from './arrange';
import { mountImport } from './import';
import { mountLibItem } from './item';

export const KIND_LABEL: Record<api.LibKind, string> = { template: 'Page template', section: 'Section', snippet: 'Snippet' };
const KINDS: [string, string][] = [
  ['', 'Everything'],
  ['template', 'Page templates'],
  ['section', 'Sections'],
  ['snippet', 'Snippets'],
];
const FILTERS = ['q', 'kind', 'synced', 'folder', 'tag'] as const;

/** An item's picture: its thumbnail, else a drawing of its kind (a page section draws its type). */
export function picture(it: api.LibItem): HTMLElement {
  const box = el('span.ms-lib__pic');
  if (it.thumb) box.append(el('img', { src: it.thumb, alt: '', loading: 'lazy' }));
  else if (it.sectionType) box.innerHTML = sectionPicture(it.sectionType);
  // a template of an article collection draws "Article", of a page collection "Page"
  else box.append(el('span.ms-lib__pickind', it.kind === 'template' ? (collection(it.collection ?? '')?.format === 'md' ? 'Article' : 'Page') : it.kind === 'section' ? 'Section' : 'Snippet'));
  return box;
}

export function mountLibrary(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Reusable sections', 'Page templates, sections and snippets to use again: drag one onto a page, or start a page from a template. A synced one is edited once and every page that uses it follows.');
  const layout = el('div.ms-adm-split');
  let data: api.LibList | null = null;
  let loadedFor = '';
  let editor = false;
  let me = '';
  let alive = true;

  const query = (): api.LibQuery => {
    const q = ctx.params();
    const get = (k: string) => q.get(k) ?? '';
    return { q: get('q'), kind: get('kind'), synced: get('synced'), folder: get('folder'), tag: get('tag'), sort: 'place' };
  };
  const picked = () => new Set((ctx.params().get('pick') ?? '').split(',').filter(Boolean));

  let arranging: ReturnType<typeof mountArrange> | null = null;
  let syncedCount: number | null = null;

  async function render(): Promise<void> {
    const who = await whoami();
    me = who.user?.id ?? '';
    editor = isEditorPlus(who);
    if (!who.user || who.devMode) return void p.body.replaceChildren(state('empty', 'Not on this server', 'The Library is kept by the Markstage server; this editor runs without it.'));
    // Arrange: the whole Library as one list to put in order (arrange.ts)
    if (ctx.params().get('arrange')) {
      if (arranging) return arranging.follow();
      p.bar.hidden = true;
      p.actions.replaceChildren(button('Done', () => ctx.go({ params: { arrange: null, menu: null, moveto: null } }, true), { small: true, kind: 'primary', icon: 'check' }));
      const main = el('div.ms-adm-split__main');
      layout.replaceChildren(main);
      p.body.replaceChildren(layout);
      arranging = mountArrange(main, ctx, { editor, me, changed: () => (loadedFor = '') });
      return;
    }
    arranging?.destroy();
    arranging = null;
    const q = query();
    const key = JSON.stringify(q);
    if (key !== loadedFor) {
      p.body.replaceChildren(state('loading', 'Loading the Library…'));
      try {
        const r = await api.list(q);
        // gone, or the URL moved on while this loaded: the newer render draws (never an old list under new filters)
        if (!alive || JSON.stringify(query()) !== key) return;
        data = r;
        loadedFor = key;
      } catch (e) {
        if (!alive || JSON.stringify(query()) !== key) return;
        if (e instanceof ApiError && e.status === 404) return void p.body.replaceChildren(state('empty', 'Not on this server yet', 'This Markstage server does not keep a Library yet: update it.'));
        return void p.body.replaceChildren(failure(e, () => ((loadedFor = ''), void render())));
      }
    }
    // how many synced items (of the kind shown): the server's count when it gives one, else from the whole list
    syncedCount = data?.facets?.synced ?? (await api.all().then((r) => r.items.filter((it) => it.synced && (!q.kind || it.kind === q.kind)).length, () => null));
    if (!alive) return;
    bar(q);
    grid();
    if (ctx.params().get('import')) mountImport(layout, ctx, { editor, done: () => (loadedFor = '') });
  }

  function pick(key: 'folder' | 'tag', label: string, options: [string, string][]): HTMLSelectElement {
    const cur = ctx.params().get(key) ?? '';
    const s = el('select.ms-input.ms-adm-select', { 'aria-label': label });
    for (const [v, l] of options) s.append(el('option', { value: v, selected: v === cur }, l));
    s.addEventListener('change', () => ctx.go({ params: { [key]: s.value || null, open: null } }, true));
    return s;
  }

  function bar(q: api.LibQuery): void {
    const f = data?.facets;
    const count = (k: string) => (k ? (f?.kinds?.[k as api.LibKind] ?? 0) : 0);
    const kinds = KINDS.map(([v, l]): [string, string] => [v, v && f?.kinds ? `${l} (${count(v)})` : l]);
    // a toggle like the kind chips, with its count
    const synced = el('button.ms-adm-chip.ms-lib__syncedchip', { type: 'button', 'aria-pressed': String(!!q.synced), title: 'Only the items that every page using them follows' }, icon('refresh', 13), el('span', syncedCount === null ? 'Synced' : `Synced (${syncedCount})`));
    synced.addEventListener('click', () => ctx.go({ params: { synced: q.synced ? null : '1', open: null } }, true));
    const folders: [string, string][] = [['', 'Every folder'], ...(f?.folders ?? []).map((x): [string, string] => [x.name, `${x.name} (${x.count})`])];
    const tags: [string, string][] = [['', 'Any tag'], ...(f?.tags ?? []).map((x): [string, string] => [x.name, `${x.name} (${x.count})`])];
    const any = FILTERS.some((k) => ctx.params().get(k));
    p.bar.hidden = false;
    p.bar.replaceChildren(
      searchBox(ctx, 'q', 'Search the Library'),
      chips(ctx, 'kind', 'Show', kinds),
      el('div.ms-adm-chips', { role: 'group', 'aria-label': 'Synced items' }, synced),
      folders.length > 1 ? pick('folder', 'Folder', folders) : '',
      tags.length > 1 ? pick('tag', 'Tag', tags) : '',
      any ? button('Clear filters', () => ctx.go({ params: Object.fromEntries([...FILTERS, 'open'].map((k) => [k, null])) }, true), { kind: 'quiet', small: true }) : '',
    );
    const sel = picked();
    const exp = el('a.ms-btn.ms-btn--sm.ms-lib__export', { href: sel.size ? api.exportUrl([...sel]) : undefined, download: 'library-pack.json', 'aria-disabled': sel.size ? null : 'true' }, icon('download', 15), el('span', sel.size ? `Export pack (${sel.size})…` : 'Export pack…'));
    exp.title = sel.size ? 'These items and their pictures as one file, to import on another site' : 'Tick items to export them';
    if (!sel.size) exp.addEventListener('click', (e) => (e.preventDefault(), ctx.toast('Tick the items to export first.', 'info')));
    const arrange = button('Arrange', () => ctx.go({ params: { arrange: '1', open: null, import: null, step: null, src: null } }), { small: true, icon: 'grip' });
    arrange.title = 'Put items in order inside their folders, or move them between folders';
    // every section type the site has, drawn by its own components (gallery/screen.ts)
    const gallery = el('a.ms-btn.ms-btn--sm', { href: '#/gallery' }, icon('sections', 15), el('span', 'Section gallery'));
    p.actions.replaceChildren(gallery, arrange, exp, editor ? button('Import…', () => ctx.go({ params: { import: '1', step: null, open: null } }), { small: true, icon: 'upload' }) : '');
  }

  /** The items under their folders (A–Z, items in their order), each a card. */
  function grid(): void {
    const items = data?.items ?? [];
    const open = ctx.params().get('open');
    const main = el('div.ms-adm-split__main');
    layout.replaceChildren(main);
    p.body.replaceChildren(layout);
    if (!items.length) {
      const any = FILTERS.some((k) => ctx.params().get(k));
      main.append(any ? state('empty', 'Nothing here', 'Nothing in the Library matches these filters.') : state('empty', 'The Library is empty', 'On a page, choose Save section to Library… in a block’s grip menu, or Save page as template… in the More menu. Import… brings in items from another site or from WordPress.'));
    } else {
      const folders = new Map<string, api.LibItem[]>();
      for (const it of [...items].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name))) {
        const f = it.folder || '';
        folders.set(f, [...(folders.get(f) ?? []), it]);
      }
      const names = [...folders.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
      for (const f of names) {
        const group = el('section.ms-lib__group', { 'aria-label': f || 'No folder' }, el('h2.ms-adm-h2', f || 'No folder', el('span.ms-adm-sub', ` · ${folders.get(f)!.length}`)));
        const cards = el('ul.ms-lib__grid');
        for (const it of folders.get(f)!) cards.append(card(it, it.id === open));
        group.append(cards);
        main.append(group);
      }
      main.append(el('p.ms-adm-sub', `${data!.total} in all`));
    }
    if (open) mountLibItem(layout, open, { ctx, editor, me, changed: () => ((loadedFor = ''), void render()) });
  }

  function card(it: api.LibItem, isOpen: boolean): HTMLElement {
    const sel = picked();
    const tick = el('input.ms-lib__tick', { type: 'checkbox', checked: sel.has(it.id), 'aria-label': `Pick “${it.name}” to export` });
    tick.addEventListener('change', () => {
      const s = picked();
      if (tick.checked) s.add(it.id);
      else s.delete(it.id);
      ctx.go({ params: { pick: [...s].join(',') || null } }, true);
    });
    const name = el('a.ms-lib__name', { href: '#' }, it.name);
    name.addEventListener('click', (e) => (e.preventDefault(), ctx.go({ params: { open: it.id } }, true)));
    const what = [KIND_LABEL[it.kind], it.sectionType ? humanize(it.sectionType) : '', it.kind === 'template' && it.collection ? `for ${humanize(it.collection)}` : ''].filter(Boolean).join(' · ');
    return el(`li.ms-lib__card${isOpen ? '.is-open' : ''}`,
      picture(it),
      el('div.ms-lib__txt',
        el('div.ms-lib__top', name, tick),
        el('span.ms-adm-sub', what),
        it.description ? el('span.ms-lib__desc', it.description) : '',
        el('div.ms-lib__badges',
          it.synced ? el('span.ms-adm-badge.is-new', { title: 'Every page that uses it follows its changes' }, it.usedOn ? `Synced · used on ${it.usedOn} page${it.usedOn === 1 ? '' : 's'}` : 'Synced · not used yet') : '',
          it.locks && (it.locks.move || it.locks.remove || it.locks.edit) ? el('span.ms-adm-badge', 'Locked') : '',
          it.imported ? el('span.ms-adm-badge', `Imported${it.imported.from === 'wordpress' ? ' from WordPress' : ''}`) : '',
          ...it.tags.map((t) => el('span.ms-lib__tag', t)),
        ),
      ),
    );
  }

  void render();
  return {
    update: () => void render(),
    destroy: () => {
      alive = false;
      arranging?.destroy();
    },
  };
}
