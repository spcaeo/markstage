// A list in the page entry (the sections, or a list field such as cards or questions) on the shared order component
// (../order): drag by the grip, Alt+↑/↓, Move to…, several at once, Delete with Undo in a toast, ⌘D. Each action is
// one undo step in the page model, sent as the API's `move` / `remove` / `insert` / `duplicate` changes, so a move
// and the move back leave the file byte for byte as it was. `_lock` on an item ({move, remove}) gives its lock, and
// the site's rule for the item (siteLock) adds to it. A list the person may not change (read-only, or a role that
// changes some fields only: PageModel.refuse) has every item locked "by your role", and nothing duplicates.
import { moveItems } from '@markstage/core';
import { mountOrder, type Lock, type OrderItem, type OrderList, type Place } from '../order';
import { mergeLocks } from './locks';
import { movesFor, type PageModel } from './model';
import type { Change } from './types';

export interface PageItem extends OrderItem {
  /** the item's index in the list now */
  index: number;
  value: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

// Ids live as long as the model keeps the same objects: a move, an insert or a removal keeps them, so an item keeps
// its row (focus, selection) through its own moves. Objects carry their id; a list of plain values keeps a list of
// ids that this file updates with each change it makes.
const objectIds = new WeakMap<object, string>();
const valueIds = new WeakMap<unknown[], string[]>();
let next = 0;
const fresh = () => `pi${++next}`;

function idsOf(list: unknown[]): string[] {
  const kept = valueIds.get(list);
  const ids = list.map((v, i) => {
    if (!isObject(v)) return kept?.[i] ?? fresh();
    let id = objectIds.get(v);
    if (!id) objectIds.set(v, (id = fresh()));
    return id;
  });
  valueIds.set(list, ids);
  return ids;
}

export interface PageListOptions {
  model: PageModel;
  /** the list's path in the entry: 'sections', 'sections.2.value.cards' */
  path: string;
  root: HTMLElement;
  label: string;
  noun: string;
  /** the row's name (menus, the live region, Move to…) */
  title(value: unknown, index: number): string;
  /** where an item keeps its lock, from the item: '_lock' (default), 'value._lock' for a section */
  lockAt?: string;
  /** the site's lock rule for an item (config `locks`), merged with the item's own lock */
  siteLock?(value: unknown): Lock | undefined;
  row(item: PageItem): HTMLElement;
  /** after a change made here: old index -> new index (null: removed), before the model tells everyone */
  reindex?(map: Map<number, number | null>): void;
  /** after the change, once the model has told everyone */
  changed?(ids: string[]): void;
  scroller?: HTMLElement;
}

export interface PageList extends OrderList {
  /** the items' ids, in the list's order now */
  ids(): string[];
}

export function mountPageList(o: PageListOptions): PageList {
  const lockAt = (o.lockAt ?? '_lock').split('.');
  const list = () => (Array.isArray(o.model.get(o.path)) ? (o.model.get(o.path) as unknown[]) : []);
  /** the lock kept in the item itself */
  const ownLock = (v: unknown): Lock | undefined => {
    let at: unknown = v;
    for (const k of lockAt) at = isObject(at) ? at[k] : undefined;
    return isObject(at) ? (at as Lock) : undefined;
  };
  const frozen = () => o.model.refuse(o.path);
  const lockOf = (v: unknown): Lock | undefined => (frozen() ? { move: true, remove: true, edit: true, by: 'your role' } : mergeLocks(ownLock(v), o.siteLock?.(v)));
  const items = (): PageItem[] => {
    const l = list();
    return idsOf(l).map((id, index) => {
      const lock = lockOf(l[index]);
      return { id, index, value: l[index], label: o.title(l[index], index) || `${o.noun} ${index + 1}`, ...(lock ? { lock } : {}) };
    });
  };
  const run = (chs: Change[], map: Map<number, number | null>, ids: string[], after: string[]) => {
    if (!chs.length) return;
    o.reindex?.(map);
    const l = list();
    o.model.settle();
    o.model.changeMany(chs, 'list');
    // the same array, changed in place: its plain values keep their ids in the new order
    if (l === list()) valueIds.set(l, after);
    o.changed?.(ids);
  };

  const order = mountOrder<PageItem>({
    root: o.root,
    label: o.label,
    noun: o.noun,
    items,
    row: (item) => o.row(item),
    scroller: o.scroller,
    // the banner says why for the whole list: no pill on every row
    badge: () => !frozen(),
    noDuplicate: () => (frozen() ? 'Locked by your role: can’t be duplicated.' : ''),
    move: (ids: string[], to: Place) => {
      const before = items();
      const now = before.map((i) => i.id);
      const wanted = moveItems(before, ids, to).map((i) => i.id);
      run(movesFor(o.path, now, wanted, ids), new Map(now.map((id, i) => [i, wanted.indexOf(id)])), ids, wanted);
    },
    remove: (ids: string[]) => {
      const before = items();
      const gone = before.filter((i) => ids.includes(i.id));
      const values = gone.map((i) => structuredClone(i.value));
      const stay = before.filter((i) => !ids.includes(i.id)).map((i) => i.id);
      const map = new Map(before.map((it, i) => [i, ids.includes(it.id) ? null : stay.indexOf(it.id)]));
      run(gone.map((i) => i.index).sort((a, b) => b - a).map((i): Change => ({ op: 'remove', path: `${o.path}.${i}` })), map, ids, stay);
      // back where they were, as one more change (⌘Z takes the Undo back again)
      return () => {
        const n = list().length;
        const back = gone.map((g, k): Change => ({ op: 'insert', path: o.path, index: Math.min(g.index, n + k), value: values[k] }));
        o.model.settle();
        if (Array.isArray(o.model.get(o.path))) o.model.changeMany(back, 'list');
        else o.model.changeMany([{ op: 'set', path: o.path, value: values }], 'list');
        o.changed?.([]);
      };
    },
    duplicate: (ids: string[]) => {
      const before = items();
      const picked = before.filter((i) => ids.includes(i.id)).map((i) => i.index);
      const chs: Change[] = [];
      // from the last, so the earlier indexes hold; a copy has no lock (the lock stays with the original)
      for (const i of [...picked].sort((a, b) => b - a)) {
        chs.push({ op: 'duplicate', path: o.path, index: i });
        if (ownLock(before[i]!.value)) chs.push({ op: 'remove', path: `${o.path}.${i + 1}.${lockAt.join('.')}` });
      }
      const after: string[] = [];
      const map = new Map<number, number | null>();
      before.forEach((it, i) => {
        map.set(i, after.length);
        after.push(it.id);
        if (picked.includes(i)) after.push(fresh());
      });
      run(chs, map, ids, after);
    },
  });
  return { ...order, ids: () => idsOf(list()) };
}
