// The order component (docs/OPERATIONS.md "Order, move, delete and hierarchy"): one way to reorder anything, a flat
// list or a tree, so a writer learns it once.
//   - drag by the grip (⋮⋮, shown on hover and focus): a line shows where the items land, sideways sets the depth in
//     a tree, the area scrolls near its edges, Escape cancels;
//   - keyboard on a row: Alt+↑/↓ move, Alt+→/← indent / outdent (tree), Delete removes (Undo in a toast), ⌘D
//     duplicates, ↑/↓ Home/End go between rows, Space selects, Enter opens the grip menu;
//   - the grip menu: Move up / down / to top / to bottom, Move to…, Indent / Outdent, Duplicate, Delete;
//   - several at once: ⌘-click and Shift-click select, then move or delete them together;
//   - locks (docs/OPERATIONS.md "Locks"): a move- or remove-locked item keeps its grip, the menu greys what it
//     can't do and says why ("Locked by the site: can't be moved");
//   - every change is one call to the owner (move, remove, duplicate): one undo step and one save there; screen
//     readers hear where an item went ("Blog moved to position 3 of 4, in Services").
// The owner keeps the items and draws each row's content; this file adds the grip, the selection and the depth.
import '../styles/order.css';
import { canMove, canRemove, find, flatten, type FlatRow, type Lock, type OrderNode, type Place } from '@markstage/core';
import { toast } from '../host';
import { ic } from '../icons';
import { Menu } from '../shell';
import { drag, type DragRow } from './drag';
import { moveToDialog } from './move-to';

export type { Lock, Place };

export interface OrderItem extends OrderNode {
  label: string;
  children?: OrderItem[];
}

export interface OrderOptions<T extends OrderItem = OrderItem> {
  /** the element the list is drawn into */
  root: HTMLElement;
  /** what one item is called: "menu item", "question" */
  noun: string;
  tree?: boolean;
  /** the deepest level an item may reach (0 is the top); 2 by default in a tree */
  maxDepth?: number;
  /** what the list says: "Menu items" */
  label: string;
  items(): T[];
  /** an item's own content (text, fields, buttons); the component puts the grip before it */
  row(item: T, depth: number): HTMLElement;
  /** one move (one undo step and one save); the component draws the list again after it */
  move(ids: string[], to: Place): void;
  /** removes the items; returns how to bring them back (the toast's Undo) */
  remove?(ids: string[]): (() => void) | void;
  duplicate?(ids: string[]): void;
  /** why the items can't be removed (a box keeps at least one), or '' */
  keep?(ids: string[]): string;
  /** why the items can't be duplicated (the person may not change the list), or '' */
  noDuplicate?(ids: string[]): string;
  /** more actions in an item's grip menu, after the moves: "Add one after" */
  extra?(id: string): { label: string; icon: string; run: () => void }[];
  /** the scrolling area (auto-scroll while dragging); the nearest scrolling parent by default */
  scroller?: HTMLElement;
  /** an item's grip menu or its Move to… dialog opened (the id) or closed (null), for the owner's URL */
  opened?(what: { menu: string | null } | { moveTo: string | null }): void;
  /** whether the items may go to this place (the Outline keeps a heading at the top level); every place by default */
  fits?(ids: string[], to: Place): boolean;
  /** whether an item's children show (a row that folds), for screen readers; undefined: it does not fold */
  expanded?(item: T): boolean | undefined;
  /** whether a locked item shows the "Locked" pill (false: a row that only keeps its place, a group); true by default */
  badge?(item: T): boolean;
  /** a line at the foot of the grip menu: what a move takes along ("Moves the heading with its section") */
  note?(ids: string[]): string;
}

export interface OrderList {
  /** draws the rows again from items() (after a change made elsewhere) */
  refresh(): void;
  focus(id: string): void;
  selected(): string[];
  /** opens an item's grip menu, or its Move to… dialog (the URL had it open) */
  openMenu(id: string): void;
  openMoveTo(id: string): void;
  destroy(): void;
}

const INDENT = 24;
const isMac = /Mac|iP(hone|ad)/.test(navigator.platform);

function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  return document.scrollingElement as HTMLElement;
}

export function mountOrder<T extends OrderItem>(o: OrderOptions<T>): OrderList {
  const tree = !!o.tree;
  const maxDepth = tree ? (o.maxDepth ?? 2) : 0;
  const list = document.createElement('div');
  list.className = `ms-order${tree ? ' ms-order--tree' : ''}`;
  list.setAttribute('role', tree ? 'tree' : 'listbox');
  list.setAttribute('aria-label', o.label);
  list.setAttribute('aria-multiselectable', 'true');
  list.style.setProperty('--indent', `${INDENT}px`);
  const live = document.createElement('div');
  live.className = 'ms-order__live';
  live.setAttribute('aria-live', 'polite');
  o.root.append(list, live);

  let rows: (FlatRow<T> & { el: HTMLElement })[] = [];
  let menus: Menu[] = [];
  const openers = new Map<string, () => void>();
  let sel = new Set<string>();
  let anchor: string | null = null;
  let current: string | null = null;

  const say = (text: string) => {
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  };
  const items = () => o.items();
  const rowOf = (id: string) => rows.find((r) => r.item.id === id);
  /** what an action applies to: the selection when the item is in it, else the item */
  const targets = (id: string) => (sel.has(id) ? rows.filter((r) => sel.has(r.item.id)).map((r) => r.item.id) : [id]);
  const named = (ids: string[]) => (ids.length === 1 ? `“${find(items(), ids[0]!)?.item.label ?? ''}”` : `${ids.length} ${o.noun}s`);
  /** how many levels the deepest child of `ids` adds */
  const below = (ids: string[]) => Math.max(0, ...ids.map((id) => { const r = find(items(), id); return r ? Math.max(0, ...flatten(r.item.children ?? []).map((c) => c.depth + 1)) : 0; }));

  function where(id: string): string {
    const r = find(items(), id);
    if (!r) return '';
    const siblings = r.parent ? (find(items(), r.parent)?.item.children ?? []) : items();
    const inside = tree ? (r.parent ? `, in “${find(items(), r.parent)?.item.label}”` : ', at the top level') : '';
    return `position ${r.index + 1} of ${siblings.length}${inside}`;
  }

  const fits = (ids: string[], to: Place) => !o.fits || o.fits(ids, to);
  /** the items' first row, and whether an index among their siblings (the ones that stay) is a place they may go */
  function slots(ids: string[]) {
    const first = find(items(), ids[0]!)!;
    const siblings = (first.parent ? find(items(), first.parent)?.item.children : items()) ?? [];
    const stay = siblings.filter((s) => !ids.includes(s.id)).length;
    const ok = (i: number) => i >= 0 && i <= stay && fits(ids, { parent: first.parent, index: i });
    return { first, stay, ok };
  }

  // ---------- changes ----------
  function move(ids: string[], to: Place, verb = 'moved'): void {
    const ok = canMove(items(), ids);
    if (!ok.ok) return void (say(ok.reason), toast(ok.reason, 'info'));
    const before = JSON.stringify(flatten(items()).map((r) => [r.item.id, r.parent, r.index]));
    o.move(ids, to);
    draw();
    if (JSON.stringify(flatten(items()).map((r) => [r.item.id, r.parent, r.index])) === before) return;
    focus(ids[0]!);
    say(`${named(ids)} ${verb} to ${where(ids[0]!)}.`);
  }

  function step(id: string, by: -1 | 1 | 'top' | 'bottom'): void {
    const ids = targets(id);
    const { first, stay, ok } = slots(ids);
    // the top and the bottom: the first and the last place the items may go
    const all = Array.from({ length: stay + 1 }, (_, i) => i).filter(ok);
    const index = by === 'top' ? all[0] : by === 'bottom' ? all[all.length - 1] : by === -1 ? first.index - 1 : first.index + 1;
    // a place there that the owner refuses (fits) is not the end of the list
    if (index !== undefined && index >= 0 && index <= stay && !ok(index)) return say(`Can’t move ${named(ids)} there.`);
    if (index === undefined || !ok(index)) return say(by === -1 || by === 'top' ? 'Already first.' : 'Already last.');
    move(ids, { parent: first.parent, index });
  }

  function indent(id: string, inward: boolean): void {
    if (!tree) return;
    const ids = targets(id);
    const r = find(items(), ids[0]!)!;
    if (inward) {
      const siblings = (r.parent ? find(items(), r.parent)?.item.children : items()) ?? [];
      const prev = siblings[r.index - 1];
      if (!prev) return say('Nothing above to go inside.');
      if (r.depth + 1 + below(ids) > maxDepth) return say(`A ${o.noun} can't go deeper than ${maxDepth + 1} levels.`);
      const to = { parent: prev.id, index: prev.children?.length ?? 0 };
      if (!fits(ids, to)) return say(`Can't go inside “${prev.label}”.`);
      move(ids, to);
    } else {
      if (!r.parent) return say('Already at the top level.');
      const p = find(items(), r.parent)!;
      const to = { parent: p.parent, index: p.index + 1 };
      if (!fits(ids, to)) return say(`Can't go out of “${p.item.label}”.`);
      move(ids, to);
    }
  }

  function remove(id: string): void {
    if (!o.remove) return;
    const ids = targets(id);
    const ok = removable(ids);
    if (!ok.ok) return void (say(ok.reason), toast(ok.reason, 'info'));
    const what = named(ids);
    // focus goes to the row after (or before) the removed ones
    const flat = rows.map((r) => r.item.id);
    const next = flat.slice(flat.indexOf(ids[ids.length - 1]!) + 1).find((x) => !ids.includes(x)) ?? flat.slice(0, flat.indexOf(ids[0]!)).reverse().find((x) => !ids.includes(x));
    const undo = o.remove(ids);
    sel = new Set();
    draw();
    if (next) focus(next);
    toast(`Deleted ${what}.`, 'ok', undo ? { action: { label: 'Undo', run: () => (undo(), draw(), focus(ids[0]!), say(`${what} back.`)) } } : {});
    say(`Deleted ${what}.${undo ? ' Undo is in the note at the bottom.' : ''}`);
  }

  function removable(ids: string[]): { ok: boolean; reason: string } {
    const ok = canRemove(items(), ids);
    if (!ok.ok) return ok;
    const why = o.keep?.(ids) ?? '';
    return { ok: !why, reason: why };
  }

  function duplicate(id: string): void {
    if (!o.duplicate) return;
    const ids = targets(id);
    const why = o.noDuplicate?.(ids);
    if (why) return void (say(why), toast(why, 'info'));
    o.duplicate(ids);
    draw();
    focus(id);
    say(`Duplicated ${named(ids)}.`);
  }

  async function moveTo(id: string): Promise<void> {
    const ids = targets(id);
    const ok = canMove(items(), ids);
    if (!ok.ok) return void toast(ok.reason, 'info');
    o.opened?.({ moveTo: id });
    const to = await moveToDialog({ noun: o.noun, count: ids.length, items: items(), moving: new Set(ids), tree, maxDepth, below: below(ids), fits: (p) => fits(ids, p) });
    o.opened?.({ moveTo: null });
    if (to) move(ids, to);
    else focus(id);
  }

  // ---------- selection and focus ----------
  function select(id: string, how: 'one' | 'toggle' | 'range'): void {
    if (how === 'one') sel = new Set([id]);
    else if (how === 'toggle') sel.has(id) ? sel.delete(id) : sel.add(id);
    else if (anchor) {
      const flat = rows.map((r) => r.item.id);
      const [a, b] = [flat.indexOf(anchor), flat.indexOf(id)].sort((x, y) => x - y);
      sel = new Set(flat.slice(a, b + 1));
    }
    if (how !== 'range') anchor = id;
    for (const r of rows) r.el.setAttribute('aria-selected', String(sel.has(r.item.id)));
    if (sel.size > 1) say(`${sel.size} selected.`);
  }

  function focus(id: string): void {
    const r = rowOf(id);
    if (!r) return;
    current = id;
    for (const x of rows) x.el.tabIndex = x === r ? 0 : -1;
    r.el.focus();
  }

  // ---------- drawing ----------
  function grip(r: FlatRow<T>, el: HTMLElement): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ms-order__grip';
    b.tabIndex = -1;
    b.innerHTML = ic('grip', 14);
    b.setAttribute('aria-label', `Move or change “${r.item.label}”`);
    b.setAttribute('aria-haspopup', 'menu');
    b.title = 'Drag to move · click for more';
    const menu = new Menu(b, `“${r.item.label}”`);
    menus.push(menu);
    // a blocked action stays in the menu, greyed, and says why (focusable, so a screen reader reads the reason)
    const add = (m: Menu, text: string, icon: string, run: () => void, why = '') => {
      const it = m.item(text, () => (why ? (say(why), toast(why, 'info')) : run()), { icon });
      if (why) {
        it.setAttribute('aria-disabled', 'true');
        it.title = why;
        it.setAttribute('aria-description', why);
      }
    };
    // only what applies here: no "Move up" for the first, no "Outdent" at the top level
    const open = () => {
      menu.open((m) => {
        const id = r.item.id;
        const ids = targets(id);
        const { first: at, ok } = slots(ids);
        const siblings = (at.parent ? find(items(), at.parent)?.item.children : items()) ?? [];
        const moveWhy = canMove(items(), ids);
        const removeWhy = removable(ids);
        const mv = moveWhy.ok ? '' : moveWhy.reason;
        const up = ok(at.index - 1);
        const down = ok(at.index + 1);
        const prev = siblings[at.index - 1];
        const parent = at.parent ? find(items(), at.parent) : null;
        if (up) add(m, 'Move up', 'up', () => step(id, -1), mv);
        if (down) add(m, 'Move down', 'down', () => step(id, 1), mv);
        if (up) add(m, 'Move to the top', 'up', () => step(id, 'top'), mv);
        if (down) add(m, 'Move to the bottom', 'down', () => step(id, 'bottom'), mv);
        add(m, 'Move to…', 'layers', () => void moveTo(id), mv);
        if (tree && prev && at.depth + 1 + below(ids) <= maxDepth && fits(ids, { parent: prev.id, index: prev.children?.length ?? 0 })) add(m, 'Indent (inside the one above)', 'redo', () => indent(id, true), mv);
        if (tree && parent && fits(ids, { parent: parent.parent, index: parent.index + 1 })) add(m, 'Outdent', 'undo', () => indent(id, false), mv);
        for (const x of o.extra?.(id) ?? []) add(m, x.label, x.icon, x.run);
        if (o.duplicate) add(m, ids.length > 1 ? `Duplicate ${ids.length}` : 'Duplicate', 'duplicate', () => duplicate(id), o.noDuplicate?.(ids) ?? '');
        if (o.remove) add(m, ids.length > 1 ? `Delete ${ids.length}` : 'Delete', 'trash', () => remove(id), removeWhy.ok ? '' : removeWhy.reason);
        // why, once: "Locked by the site: can't be moved or deleted."
        if (!moveWhy.ok && !removeWhy.ok && moveWhy.reason.split(':')[0] === removeWhy.reason.split(':')[0]) m.empty(`${moveWhy.reason.split(':')[0]}: can't be moved or deleted.`);
        else for (const why of [moveWhy, removeWhy]) if (!why.ok) m.empty(why.reason);
        const note = o.note?.(ids);
        if (note) m.empty(note);
      });
      o.opened?.({ menu: r.item.id });
    };
    menu.onClose = () => o.opened?.({ menu: null });
    openers.set(r.item.id, open);
    b.addEventListener('click', () => (menu.isOpen ? menu.close(true) : open()));
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      const go = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        cleanup();
        const ids = targets(r.item.id);
        const ok = canMove(items(), ids);
        if (!ok.ok) return void toast(ok.reason, 'info');
        menu.close();
        // a click after the drag must not open the menu
        b.addEventListener('click', (c) => c.stopImmediatePropagation(), { capture: true, once: true });
        const moving = new Set<string>();
        for (const x of rows) if (ids.includes(x.item.id) || (x.parent && moving.has(x.parent))) moving.add(x.item.id);
        drag({
          list,
          scroller: o.scroller ?? scrollParent(list),
          rows: rows.map((x): DragRow => ({ id: x.item.id, depth: x.depth, el: x.el })),
          moving,
          depth: r.depth,
          below: below(ids),
          tree,
          maxDepth,
          indent: INDENT,
          label: ids.length === 1 ? r.item.label : `${ids.length} ${o.noun}s`,
          fits: (to) => fits(ids, to),
          start: ev,
          drop: (to) => move(ids, to),
          end: () => undefined,
        });
      };
      const cleanup = () => {
        removeEventListener('pointermove', go);
        removeEventListener('pointerup', cleanup);
      };
      addEventListener('pointermove', go);
      addEventListener('pointerup', cleanup);
    });
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        open();
      }
    });
    return b;
  }

  function draw(): void {
    for (const m of menus) m.destroy();
    menus = [];
    openers.clear();
    const flat = flatten(items());
    const ids = new Set(flat.map((r) => r.item.id));
    sel = new Set([...sel].filter((id) => ids.has(id)));
    rows = flat.map((r) => {
      const el = document.createElement('div');
      el.className = 'ms-order__row';
      el.dataset.id = r.item.id;
      el.setAttribute('role', tree ? 'treeitem' : 'option');
      el.setAttribute('aria-selected', String(sel.has(r.item.id)));
      el.setAttribute('aria-label', r.item.label);
      if (tree) el.setAttribute('aria-level', String(r.depth + 1));
      const open = tree ? o.expanded?.(r.item) : undefined;
      if (open !== undefined) el.setAttribute('aria-expanded', String(open));
      el.style.setProperty('--depth', String(r.depth));
      el.dataset.depth = String(r.depth);
      el.tabIndex = -1;
      const lock = r.item.lock;
      if (lock && (lock.move || lock.remove)) {
        el.classList.add('is-locked');
        const badge = document.createElement('span');
        badge.className = 'ms-order__lock';
        // the same pill as on the canvas (a row that only keeps its place, like a group, says nothing)
        badge.innerHTML = o.badge?.(r.item) === false ? '' : `${ic('lock', 13)}<span>${lock.by?.startsWith('the site') ? 'Locked by the site' : 'Locked'}</span>`;
        if (!badge.innerHTML) badge.classList.add('is-quiet');
        badge.title = `${lock.by ? `Locked by ${lock.by}` : 'Locked'}: can't be ${[lock.move && 'moved', lock.remove && 'deleted'].filter(Boolean).join(' or ')}.`;
        badge.setAttribute('aria-label', badge.title);
        el.append(grip(r, el), badge, o.row(r.item, r.depth));
      } else el.append(grip(r, el), o.row(r.item, r.depth));
      el.addEventListener('click', (e) => {
        if ((e.target as Element).closest('button, a, input, textarea, select, [contenteditable]') && !(e.metaKey || e.ctrlKey || e.shiftKey)) return;
        select(r.item.id, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'one');
        focus(r.item.id);
      });
      return { ...r, el };
    });
    list.replaceChildren(...rows.map((r) => r.el));
    const keep = (current && rowOf(current)) || rows[0];
    if (keep) keep.el.tabIndex = 0;
  }

  list.addEventListener('keydown', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.ms-order__row');
    if (!row || (e.target !== row && !(e.target as Element).matches('.ms-order__grip'))) return;
    if (e.target !== row && (e.key === 'Enter' || e.key === ' ')) return;
    const id = row.dataset.id!;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const flat = rows.map((r) => r.item.id);
    const i = flat.indexOf(id);
    let done = true;
    if (e.altKey && e.key === 'ArrowUp') step(id, -1);
    else if (e.altKey && e.key === 'ArrowDown') step(id, 1);
    else if (e.altKey && e.key === 'ArrowRight') indent(id, true);
    else if (e.altKey && e.key === 'ArrowLeft') indent(id, false);
    else if (e.key === 'Delete' || e.key === 'Backspace') remove(id);
    else if (mod && e.key.toLowerCase() === 'd') duplicate(id);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const to = flat[e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(flat.length - 1, i + 1)]!;
      if (e.shiftKey) select(to, 'range');
      focus(to);
    } else if (e.key === 'Home') focus(flat[0]!);
    else if (e.key === 'End') focus(flat[flat.length - 1]!);
    else if (e.key === ' ') select(id, 'toggle');
    else if (e.key === 'Escape' && sel.size > 1) select(id, 'one');
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  draw();
  return {
    refresh: draw,
    focus,
    selected: () => rows.filter((r) => sel.has(r.item.id)).map((r) => r.item.id),
    openMenu: (id) => {
      if (!rowOf(id)) return;
      focus(id);
      openers.get(id)?.();
    },
    openMoveTo: (id) => void (rowOf(id) && moveTo(id)),
    destroy: () => {
      for (const m of menus) m.destroy();
      list.remove();
      live.remove();
    },
  };
}
