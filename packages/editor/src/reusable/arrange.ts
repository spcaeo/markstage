// Arrange in the Library (#/library?arrange=1&menu=<id>&moveto=<id>): every item under its folder in one list, put in
// order with the order component (drag by the grip, Alt+↑/↓, Move to…, or into another folder). The order is the one
// every list shows (the Library, the panel beside the canvas, the + and / menus): folders A–Z, then each item's place.
// A move saves only the items whose place changes, each against its version; Undo puts them back. Items someone may
// not change keep their place (an author's view of shared items, someone else's snippet).
import { find, moveItems } from '@markstage/core';
import '../styles/pages-tree.css';
import { el, message, state } from '../admin/ui';
import type { ScreenCtx } from '../host';
import { mountOrder, type OrderItem, type OrderList, type Place } from '../order';
import * as api from './api';
import { KIND_LABEL } from './screen';

interface Row extends OrderItem {
  item?: api.LibItem;
  folder?: string;
  children?: Row[];
}
type Patch = { it: api.LibItem; folder: string; order: number | null };

const FOLDER_LOCK = { move: true, remove: true, by: 'A–Z order' };

interface Deps {
  editor: boolean;
  me: string;
  /** the Library reads again (after a move, or Undo) */
  changed(): void;
}

/** Every item (all pages of the list), in the order the lists show. */
async function everything(): Promise<api.LibItem[]> {
  const out: api.LibItem[] = [];
  for (let page = 1; ; page++) {
    const r = await api.list({ sort: 'place', page });
    out.push(...r.items);
    if (out.length >= r.total || !r.items.length) return out;
  }
}

/** Draws into `box`; `follow()` after the URL changed (a grip menu or Move to… named in it opens). */
export function mountArrange(box: HTMLElement, ctx: ScreenCtx, d: Deps): { follow(): void; destroy(): void } {
  let items: api.LibItem[] = [];
  let tree: Row[] = [];
  let order: OrderList | null = null;
  let busy = false;
  let alive = true;
  const may = (it: api.LibItem) => (it.shared ? d.editor : it.createdBy === d.me);
  const orderOf = (it: api.LibItem) => it.order ?? Infinity;

  function build(): Row[] {
    const row = (it: api.LibItem): Row => ({ id: it.id, label: it.name, item: it, ...(may(it) ? {} : { lock: { move: true, remove: true, by: it.shared ? 'an editor' : (it.createdByName ?? 'its maker') } }) });
    const folders = [...new Set(items.map((it) => it.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return [...folders.map((f): Row => ({ id: `folder:${f}`, label: f, folder: f, lock: FOLDER_LOCK, children: items.filter((it) => it.folder === f).map(row) })), ...items.filter((it) => !it.folder).map(row)];
  }

  const line = (it: api.LibItem) =>
    el('div.ms-tree__page', el('a.ms-tree__title', { href: `#/library?open=${encodeURIComponent(it.id)}` }, it.name), el('span.ms-adm-sub', [KIND_LABEL[it.kind], it.synced ? 'synced' : '', it.shared ? '' : 'only you'].filter(Boolean).join(' · ')));

  /**
   * What a move saves: the folder it lands in, and places 1, 2, 3… for that folder's items in their new order (only
   * the ones whose place changes). Where that would change an item the person may not change, the moved ones alone
   * take a place between their new neighbours. null: it can't be done.
   */
  function plan(ids: string[], to: Place): Patch[] | null {
    const rows = ids.map((id) => find(tree, id)?.item);
    if (rows.some((r) => !r?.item || !may(r.item))) return null;
    if (to.parent !== null && find(tree, to.parent)?.item.folder === undefined) return null;
    const folder = to.parent === null ? '' : find(tree, to.parent)!.item.folder!;
    const next = moveItems(tree, ids, to);
    const here = (to.parent === null ? next : (find(next, to.parent)?.item.children ?? [])).filter((r) => r.item).map((r) => r.item!);
    const all = here.map((it, i): Patch => ({ it, folder, order: i + 1 })).filter((x) => ids.includes(x.it.id) || orderOf(x.it) !== x.order);
    if (all.every((x) => may(x.it))) return all;
    const at = here.findIndex((it) => it.id === ids[0]);
    const lo = at > 0 ? orderOf(here[at - 1]!) : 0;
    const after = here[at + ids.length] ? orderOf(here[at + ids.length]!) : Infinity;
    const hi = Number.isFinite(after) ? after : lo + ids.length + 1;
    if (!Number.isFinite(lo) || hi <= lo) return null;
    return ids.map((id, i) => ({ it: here[at + i]!, folder, order: lo + ((hi - lo) * (i + 1)) / (ids.length + 1) }));
  }

  /** Each item's new folder and place, one call per item (each against its version); then everything reads again. */
  async function save(patches: Patch[], focus: string): Promise<boolean> {
    busy = true;
    try {
      for (const x of patches) {
        const fresh = items.find((it) => it.id === x.it.id) ?? x.it;
        await api.update(x.it.id, { folder: x.folder, order: x.order, version: fresh.version });
      }
      return true;
    } catch (e) {
      ctx.toast(`Not moved: ${message(e)}`, 'error');
      return false;
    } finally {
      busy = false;
      items = await everything().catch(() => items);
      draw();
      order?.focus(focus);
      d.changed();
    }
  }

  async function move(ids: string[], to: Place): Promise<void> {
    const patches = busy ? null : plan(ids, to);
    if (!patches?.length) return;
    const back = patches.map((x): Patch => ({ it: x.it, folder: x.it.folder, order: Number.isFinite(orderOf(x.it)) ? orderOf(x.it) : null }));
    if (!(await save(patches, ids[0]!))) return;
    const n = ids.length;
    const moved = patches[0]!.folder !== back[0]!.folder ? (patches[0]!.folder ? ` to ${patches[0]!.folder}` : ' out of its folder') : '';
    ctx.toast(`Moved ${n === 1 ? `“${patches.find((x) => x.it.id === ids[0])!.it.name}”` : `${n} items`}${moved}.`, 'ok', { action: { label: 'Undo', run: () => void save(back, ids[0]!) } });
  }

  // the URL's open grip menu or Move to… dialog (a reload, Back), unless it is the one open now
  let shown: { menu: string | null; moveto: string | null } = { menu: null, moveto: null };
  function follow(): void {
    const q = ctx.params();
    const want = { menu: q.get('menu'), moveto: q.get('moveto') };
    if (want.menu && want.menu !== shown.menu && find(tree, want.menu)) order?.openMenu(want.menu);
    else if (want.moveto && want.moveto !== shown.moveto && find(tree, want.moveto)) order?.openMoveTo(want.moveto);
    shown = want;
  }

  function draw(): void {
    order?.destroy();
    order = null;
    tree = build();
    if (!items.length) return void box.replaceChildren(state('empty', 'The Library is empty', 'Nothing to arrange yet.'));
    const list = el('section.ms-adm-card.ms-snips');
    box.replaceChildren(el('p.ms-adm-sub', 'Drag an item by its grip, or press Alt+↑/↓ on it, to change where it shows in every list; drop it on a folder to move it there. Folders keep A–Z order.'), list);
    order = mountOrder<Row>({
      root: list,
      noun: 'item',
      label: 'Library items',
      tree: true,
      maxDepth: 1,
      items: () => tree,
      row: (r) => (r.item ? line(r.item) : el('div.ms-tree__group', el('strong', r.label), el('span.ms-adm-sub', ` · ${r.children?.length ?? 0} item${r.children?.length === 1 ? '' : 's'}`))),
      fits: (ids, to) => !!plan(ids, to),
      badge: (r) => r.folder === undefined,
      move: (ids, to) => void move(ids, to),
      opened: (w) => {
        shown = 'menu' in w ? { menu: w.menu, moveto: null } : { menu: null, moveto: w.moveTo };
        ctx.go({ params: shown });
      },
    });
    follow();
  }

  box.replaceChildren(state('loading', 'Loading the Library…'));
  void everything().then(
    (all) => {
      if (!alive) return;
      items = all;
      draw();
    },
    (e) => box.replaceChildren(el('p.ms-adm-sub.is-bad', message(e))),
  );
  return {
    follow,
    destroy: () => {
      alive = false;
      order?.destroy();
    },
  };
}
