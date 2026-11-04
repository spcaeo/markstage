// The frontmatter of the open entry and the changes not saved yet (title on the canvas, Post settings). Keys are
// dotted paths ("seo.description"); a change back to the saved value is no change. `changes()` is what the API's
// PUT takes as `frontmatter` (a mapping per level, so only the changed keys are rewritten; null removes a key).
// The writer's changes have an undo history (⌘Z and ⇧⌘Z in Post settings and the SEO check, settings/undo-keys.ts):
// typing in one field within a second is one step, `group` makes several keys one step (an accepted suggestion); it
// lasts while the entry is open, through saves.

export type Data = Record<string, unknown>;

const isObject = (v: unknown): v is Data => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function getPath(data: Data, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (isObject(o) ? o[k] : undefined), data);
}

/** A copy of `data` with `path` set (null or undefined removes it). */
export function setPath(data: Data, path: string, value: unknown): Data {
  const keys = path.split('.');
  const out: Data = { ...data };
  let at = out;
  for (const k of keys.slice(0, -1)) {
    at[k] = isObject(at[k]) ? { ...(at[k] as Data) } : {};
    at = at[k] as Data;
  }
  const last = keys[keys.length - 1];
  if (value === null || value === undefined) delete at[last];
  else at[last] = value;
  return out;
}

/** One step of the history: each key's value before and after it. */
interface Step {
  at: number;
  /** a run of typing in one field: the next keystroke there joins it */
  typing: boolean;
  keys: Map<string, { before: unknown; after: unknown }>;
}

const HISTORY = 200;
const TYPING_MS = 1000;
let restoring = false;

/** The writer is typing in `el` now: a field keeps what is typed rather than show the value (unless it is an undo). */
export const holds = (el: Element | null) => !!el && document.activeElement === el && !restoring;

export class FrontmatterEdits {
  private past: Step[] = [];
  private future: Step[] = [];
  private batch: Step | null = null;

  private now: () => number;

  /** `now`: the clock that groups typing (tests pass their own) */
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private saved: Data = {};
  private pending = new Map<string, unknown>();
  private listeners: ((path: string | null) => void)[] = [];
  /** keys the site needs in the file (config `required`): emptied, they stay as "" or [] instead of going */
  private required = new Set<string>();

  setRequired(paths: string[]): void {
    this.required = new Set(paths);
  }

  /** what the person may change (field-access.ts mayChange); null: every key */
  private access: ((path: string) => boolean) | null = null;

  setAccess(fn: ((path: string) => boolean) | null): void {
    this.access = fn;
  }

  /** May `path` change? A key the person's role may not change never becomes a pending change, by any route. */
  may(path: string): boolean {
    return !this.access || this.access(path);
  }

  /** A new entry is open (its history starts empty), or it was saved (`keepHistory`): `data` is the file's frontmatter now. */
  reset(data: Data, { keepHistory = false } = {}): void {
    this.saved = data ?? {};
    this.pending.clear();
    if (!keepHistory) this.past = this.future = [];
    this.emit(null);
  }

  onChange(fn: (path: string | null) => void): void {
    this.listeners.push(fn);
  }

  private emit(path: string | null): void {
    for (const fn of this.listeners) fn(path);
  }

  /** The value as the writer sees it (saved, with the pending change). */
  get(path: string): unknown {
    return this.pending.has(path) ? this.pending.get(path) : getPath(this.saved, path);
  }

  /**
   * An emptied field ("", [], null) removes its key from the file, unless the site needs the key (`required`).
   * `record: false`: not a step of the history (the editor's own bookkeeping, an undo).
   */
  set(path: string, value: unknown, { record = true } = {}): void {
    if (!this.may(path)) return;
    const before = this.get(path) ?? null;
    this.write(path, value);
    const after = this.get(path) ?? null;
    if (record && !same(before, after)) this.remember(path, before, after);
    this.emit(path);
  }

  /** Several changes as one step of the history (an accepted suggestion: its title and description). */
  group(fn: () => void): void {
    if (this.batch) return fn();
    const step: Step = { at: this.now(), typing: false, keys: new Map() };
    this.batch = step;
    try {
      fn();
    } finally {
      this.batch = null;
      if (step.keys.size) this.push(step);
    }
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Takes back the last step; false when there is none. */
  undo(): boolean {
    const step = this.past.pop();
    if (!step) return false;
    this.apply(step, 'before');
    this.future.push(step);
    return true;
  }

  /** Puts back the step undone last; false when there is none. */
  redo(): boolean {
    const step = this.future.pop();
    if (!step) return false;
    this.apply(step, 'after');
    this.past.push(step);
    return true;
  }

  private apply(step: Step, side: 'before' | 'after'): void {
    restoring = true;
    try {
      for (const [k, v] of step.keys) this.set(k, v[side], { record: false });
    } finally {
      restoring = false;
    }
  }

  private remember(path: string, before: unknown, after: unknown): void {
    if (this.batch) {
      const had = this.batch.keys.get(path);
      this.batch.keys.set(path, { before: had ? had.before : before, after });
      return;
    }
    const last = this.past.at(-1);
    const now = this.now();
    if (last?.typing && last.keys.size === 1 && last.keys.has(path) && now - last.at < TYPING_MS && !this.future.length) {
      last.keys.get(path)!.after = after;
      last.at = now;
      return;
    }
    this.push({ at: now, typing: true, keys: new Map([[path, { before, after }]]) });
  }

  private push(step: Step): void {
    this.past.push(step);
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
  }

  private write(path: string, value: unknown): void {
    const empty = value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);
    const v = !empty ? value : this.required.has(path) && getPath(this.saved, path) !== undefined ? (value ?? '') : undefined;
    if (same(v, getPath(this.saved, path))) this.pending.delete(path);
    else this.pending.set(path, v ?? null);
  }

  get isDirty(): boolean {
    return this.pending.size > 0;
  }

  /** The keys with unsaved changes. */
  changedPaths(): string[] {
    return [...this.pending.keys()];
  }

  /** The saved frontmatter with the pending changes. */
  merged(): Data {
    let out = this.saved;
    for (const [p, v] of this.pending) out = setPath(out, p, v);
    return out;
  }

  /** The pending changes as the API takes them: { seo: { description: '…' }, legacy: null }. */
  changes(): Data | undefined {
    if (!this.pending.size) return undefined;
    let out: Data = {};
    for (const [p, v] of this.pending) {
      const keys = p.split('.');
      out = { ...out };
      let at = out;
      for (const k of keys.slice(0, -1)) at = (at[k] = isObject(at[k]) ? { ...(at[k] as Data) } : {}) as Data;
      at[keys[keys.length - 1]] = v ?? null;
    }
    return out;
  }
}
