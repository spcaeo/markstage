// The open page entry while it is edited: its data as the writer sees it, the changes not saved yet (in the order
// they were made, as the API's `changes` list) and undo / redo. The same operations are applied here as the server's
// JSON engine applies to the file, so what the panel and the page show is what a save writes.
import type { Change } from './types';

type Data = Record<string, unknown>;
type Seg = string | number;

const isObject = (v: unknown): v is Data => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

/** "sections.3.value.heading" -> ['sections', 3, 'value', 'heading'] */
export function segments(path: string): Seg[] {
  if (!path) return [];
  return path.split('.').map((s) => {
    if (FORBIDDEN.has(s)) throw new Error(`path "${path}" is not allowed`);
    return /^\d+$/.test(s) ? Number(s) : s;
  });
}

export function getAt(data: unknown, path: string | Seg[]): unknown {
  let at = data;
  for (const s of typeof path === 'string' ? segments(path) : path) {
    if (Array.isArray(at) && typeof s === 'number') at = at[s];
    else if (isObject(at) && typeof s === 'string') at = at[s];
    else return undefined;
  }
  return at;
}

function parentOf(data: Data, path: string, create: boolean): { parent: Data | unknown[]; key: Seg } {
  const segs = segments(path);
  let at: unknown = data;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    const container = at as Data & unknown[];
    let next = Array.isArray(container) ? container[s as number] : isObject(container) ? container[s as string] : undefined;
    if (next === undefined && create) {
      next = typeof segs[i + 1] === 'number' ? [] : {};
      (container as Data)[s as string] = next;
    }
    if (next === undefined || next === null || typeof next !== 'object') throw new Error(`no ${segs.slice(0, i + 1).join('.')} in the entry`);
    at = next;
  }
  return { parent: at as Data | unknown[], key: segs[segs.length - 1] };
}

function listAt(data: Data, path: string): unknown[] {
  const list = getAt(data, path);
  if (!Array.isArray(list)) throw new Error(`${path} is not a list`);
  return list;
}

/**
 * The paths that differ between two versions of an entry's data, as the server reads a save (custom-roles/rules.mjs
 * changedPaths): mappings are followed key by key, a list or a value counts whole ("sections", not "sections.2.value").
 */
export function changedPaths(a: unknown, b: unknown, prefix = '', out: string[] = []): string[] {
  const plain = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
  // a key new on one side is read as an empty object there: a new locales.fr-ca.title is that path, not `locales`
  if ((plain(a) || a == null) && (plain(b) || b == null) && (plain(a) || plain(b))) {
    const x = (a ?? {}) as Record<string, unknown>;
    const y = (b ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) changedPaths(x[k], y[k], prefix ? `${prefix}.${k}` : k, out);
  } else if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push(prefix || '(all)');
  return out;
}

/** The path a change at `path` counts as on the server: up to the first list it goes through ("sections.2.value.heading" -> "sections"). */
export function countedPath(data: unknown, path: string): string {
  const parts = path.split('.');
  let at: unknown = data;
  for (let i = 0; i < parts.length; i++) {
    if (Array.isArray(at)) return parts.slice(0, i).join('.');
    at = at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[parts[i]!] : undefined;
  }
  return path;
}

/** Applies one change to `data` in place (the server does the same to the file). */
export function apply(data: Data, ch: Change): void {
  if (ch.op === 'set') {
    const { parent, key } = parentOf(data, ch.path, true);
    (parent as Data)[key as string] = clone(ch.value);
  } else if (ch.op === 'remove') {
    const { parent, key } = parentOf(data, ch.path, false);
    if (Array.isArray(parent)) parent.splice(key as number, 1);
    else delete parent[key as string];
  } else if (ch.op === 'insert') {
    const list = listAt(data, ch.path);
    list.splice(Math.max(0, Math.min(ch.index, list.length)), 0, clone(ch.value));
  } else if (ch.op === 'move') {
    const list = listAt(data, ch.path);
    const [item] = list.splice(ch.from, 1);
    list.splice(ch.to, 0, item);
  } else if (ch.op === 'duplicate') {
    const list = listAt(data, ch.path);
    list.splice(ch.index + 1, 0, clone(list[ch.index]));
  }
}

/** The changes that turn `from` into `to`, field by field. */
export function diffChanges(from: unknown, to: unknown, path = ''): Change[] {
  if (JSON.stringify(from) === JSON.stringify(to)) return [];
  const plainKeys = (o: Data) => Object.keys(o).every((k) => k && !k.includes('.') && !/^\d+$/.test(k) && !FORBIDDEN.has(k));
  if (isObject(from) && isObject(to) && (plainKeys(from) && plainKeys(to))) {
    const out: Change[] = [];
    for (const k of Object.keys(from)) if (!(k in to)) out.push({ op: 'remove', path: path ? `${path}.${k}` : k });
    for (const k of Object.keys(to)) out.push(...(k in from ? diffChanges(from[k], to[k], path ? `${path}.${k}` : k) : [{ op: 'set' as const, path: path ? `${path}.${k}` : k, value: to[k] }]));
    return out;
  }
  // a list: the items alike at its start and end stay; between them item by item, then the items put in there or
  // taken out (from the last), so one section added or deleted is one insert or one remove
  if (Array.isArray(from) && Array.isArray(to) && path) {
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
    let head = 0;
    while (head < from.length && head < to.length && same(from[head], to[head])) head++;
    let tail = 0;
    while (tail < from.length - head && tail < to.length - head && same(from[from.length - 1 - tail], to[to.length - 1 - tail])) tail++;
    const n = Math.min(from.length, to.length) - head - tail;
    const out = to.slice(head, head + n).flatMap((v, k) => diffChanges(from[head + k], v, `${path}.${head + k}`));
    to.slice(head + n, to.length - tail).forEach((value, k) => out.push({ op: 'insert', path, index: head + n + k, value }));
    for (let i = from.length - tail - 1; i >= head + n; i--) out.push({ op: 'remove', path: `${path}.${i}` });
    return out;
  }
  // the whole entry is never set at once: only its keys
  return path ? [{ op: 'set', path, value: to }] : [];
}

/**
 * The moves (one item each, as the API takes them) that put a list in the order of `wanted` (the same ids). Only
 * the items in `moving` move (by default: the fewest, those outside the longest run already in order), each straight
 * to its place, so the file changes only where they were and where they go.
 */
export function movesFor(path: string, now: string[], wanted: string[], moving: string[] = outOfOrder(now, wanted)): Change[] {
  const at = now.slice();
  const out: Change[] = [];
  const go = new Set(moving);
  // the items that stay, and those already moved, are in the wanted order: each moving item goes right after the one
  // that comes before it in that order
  const placed = new Set(now.filter((id) => !go.has(id)));
  for (const id of wanted.filter((x) => go.has(x))) {
    const from = at.indexOf(id);
    at.splice(from, 1);
    let to = 0;
    for (let j = wanted.indexOf(id) - 1; j >= 0; j--)
      if (placed.has(wanted[j]!)) {
        to = at.indexOf(wanted[j]!) + 1;
        break;
      }
    at.splice(to, 0, id);
    placed.add(id);
    if (from !== to) out.push({ op: 'move', path, from, to });
  }
  return out;
}

/** The items of `now` outside a longest run that is already in the order of `wanted`. */
function outOfOrder(now: string[], wanted: string[]): string[] {
  const rank = now.map((id) => wanted.indexOf(id));
  // patience sorting: tails[k] = index in `now` of the smallest last rank of an increasing run of length k + 1
  const tails: number[] = [];
  const prev: number[] = [];
  rank.forEach((r, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rank[tails[mid]!]! < r) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo ? tails[lo - 1]! : -1;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) keep.add(i);
  return now.filter((_, i) => !keep.has(i));
}

/** Why the data changed: an edit; a change a list made to itself on the order component (the list draws its own rows
 *  again, so a panel only refreshes its inputs); undo / redo; a fresh file. */
export type Why = 'edit' | 'list' | 'undo' | 'load';

interface Snapshot {
  data: Data;
  changes: Change[];
  /** the save it was taken after: its changes are from that file */
  gen: number;
}

export class PageModel {
  private saved: Data;
  private current: Data;
  private pending: Change[] = [];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** the last set's path, while typing in one field goes on (one undo step, one change) */
  private typing: string | null = null;
  /** saves so far: a step taken before the last save is undone as the changes from the file as it is now */
  private gen = 0;
  private listeners: ((why: Why) => void)[] = [];

  version: string;

  /**
   * What the person may change (field-access.ts mayChange, on the paths as the server counts them; null: everything)
   * and why not, in words. A change outside it is never made, by any route: typing, a list, a drop, a recovery copy.
   */
  private access: { may: (path: string) => boolean; why: (path: string) => string } | null = null;

  setAccess(access: { may: (path: string) => boolean; why: (path: string) => string } | null): void {
    this.access = access;
  }

  /** May a change at `path` be made? (Inside a list, the whole list counts: "sections.2.value.heading" is "sections".) */
  may(path: string): boolean {
    return !this.access || this.access.may(countedPath(this.current, path));
  }

  /** Why nothing at `path` may change, in words, or null. */
  refuse(path: string): string | null {
    return this.may(path) ? null : this.access!.why(countedPath(this.current, path));
  }

  /** The change keeps to what the person may change (every path it touches, as the server reads the save). */
  private allows(ch: Change): boolean {
    if (!this.access) return true;
    const after = clone(this.current);
    try {
      apply(after, ch);
    } catch {
      return true; // a change that cannot apply fails as it would without a limit
    }
    return changedPaths(this.current, after).every((p) => this.access!.may(p));
  }

  constructor(data: Data, version: string) {
    this.version = version;
    this.saved = clone(data);
    this.current = clone(data);
  }

  get data(): Data {
    return this.current;
  }

  /** the file as last saved (or opened) */
  get savedData(): Data {
    return this.saved;
  }

  get changes(): Change[] {
    return this.pending.slice();
  }

  get dirty(): boolean {
    return this.pending.length > 0;
  }

  get(path: string): unknown {
    return getAt(this.current, path);
  }

  /** Returns the function that stops listening. */
  onChange(fn: (why: Why) => void): () => void {
    this.listeners.push(fn);
    return () => void (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  private emit(why: Why): void {
    for (const fn of this.listeners) fn(why);
  }

  private snapshot(): Snapshot {
    return { data: clone(this.current), changes: this.pending.slice(), gen: this.gen };
  }

  /** A step back or forward: its data, and what is left to save from the file as it is now. */
  private restore(to: Snapshot): void {
    this.current = to.data;
    this.pending = to.gen === this.gen ? to.changes : diffChanges(this.saved, to.data);
    this.typing = null;
    this.emit('undo');
  }

  /**
   * Makes a change. Setting the same field again while typing replaces the last change instead of adding one, and
   * is part of the same undo step. A set back to the saved value with no other change pending is no change.
   */
  change(ch: Change): void {
    if (!this.allows(ch)) return;
    const last = this.pending[this.pending.length - 1];
    const sameField = ch.op === 'set' && last?.op === 'set' && last.path === ch.path && this.typing === ch.path;
    if (ch.op === 'set' && JSON.stringify(getAt(this.current, ch.path) ?? null) === JSON.stringify(ch.value ?? null)) return;
    if (!sameField) {
      this.undoStack.push(this.snapshot());
      this.redoStack = [];
    }
    apply(this.current, ch);
    if (sameField) this.pending[this.pending.length - 1] = ch;
    else this.pending.push(ch);
    this.typing = ch.op === 'set' ? ch.path : null;
    // typed back to what is saved: nothing to save
    if (JSON.stringify(this.current) === JSON.stringify(this.saved)) this.pending = [];
    this.emit('edit');
  }

  /** Several changes as one undo step (a reorder of a list, removing several items). */
  changeMany(chs: Change[], why: Why = 'edit'): void {
    // the ones the person may make, each on the data as the ones before it left it
    if (this.access) {
      let probe = clone(this.current);
      chs = chs.filter((ch) => {
        const next = clone(probe);
        try {
          apply(next, ch);
        } catch {
          return true;
        }
        if (!changedPaths(probe, next).every((p) => this.access!.may(p))) return false;
        probe = next;
        return true;
      });
    }
    if (!chs.length) return;
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
    for (const ch of chs) {
      apply(this.current, ch);
      this.pending.push(ch);
    }
    this.typing = null;
    if (JSON.stringify(this.current) === JSON.stringify(this.saved)) this.pending = [];
    this.emit(why);
  }

  /** Ends the current typing run: the next set of the same field is a new undo step. */
  settle(): void {
    this.typing = null;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  /** After a save: what was sent is now the file. Changes made while saving stay pending. */
  markSaved(sent: Change[], version: string): void {
    for (const ch of sent) apply(this.saved, ch);
    const rest = this.pending.slice(sent.length);
    // save() calls settle() first, so the sent changes are still the start of the list and later ones follow them
    this.pending = rest;
    this.version = version;
    this.typing = null;
    this.gen++;
  }

  /**
   * The file as the server wrote it at `version`, which may hold more than the changes sent (the modified date it
   * stamps): what it added is taken in, as saved and as shown, so an undo past the save puts that back too.
   */
  absorb(file: Data, version: string): void {
    if (version !== this.version) return;
    const extra = diffChanges(this.saved, file);
    if (!extra.length) return;
    for (const ch of extra) {
      apply(this.saved, ch);
      apply(this.current, ch);
    }
    this.emit('edit');
  }

  /** Opens the file as it is now (after "load theirs", or another writer's save). */
  load(data: Data, version: string): void {
    this.saved = clone(data);
    this.current = clone(data);
    this.pending = [];
    this.undoStack = [];
    this.redoStack = [];
    this.version = version;
    this.typing = null;
    this.emit('load');
  }
}
