// What a visitor changed in the live demo, kept in the tab's sessionStorage: each saved file's text and version,
// and the list of saves (each one's file and its text before and after, for the diff). A refresh keeps it; Reset
// demo or closing the tab forgets it. Nothing leaves the browser.

export interface SavedFile {
  source: string;
  version: string;
}

export interface SaveRecord {
  at: string;
  /** the file's path in the site's repo, e.g. src/content/posts/hello.md */
  file: string;
  /** collection/id */
  key: string;
  title: string;
  before: string;
  after: string;
}

interface State {
  files: Record<string, SavedFile>;
  saves: SaveRecord[];
}

export const STORAGE_KEY = 'markstage.demo';
/** Saves kept for "Your changes": the oldest go first past this. */
const MAX_SAVES = 50;

export class DemoStore {
  private state: State = { files: {}, saves: [] };
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {
    this.storage = storage;
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<State>) : null;
      if (parsed && typeof parsed === 'object') this.state = { files: parsed.files ?? {}, saves: parsed.saves ?? [] };
    } catch {
      // storage off or unreadable: the demo starts fresh
    }
  }

  file(key: string): SavedFile | null {
    return this.state.files[key] ?? null;
  }

  saves(): SaveRecord[] {
    return this.state.saves;
  }

  /** The files changed so far, each with its first text (as recorded) and its text now. */
  changedFiles(): { file: string; key: string; title: string; before: string; after: string }[] {
    const first = new Map<string, SaveRecord>();
    const last = new Map<string, SaveRecord>();
    for (const s of this.state.saves) {
      if (!first.has(s.key)) first.set(s.key, s);
      last.set(s.key, s);
    }
    return [...first.values()].map((f) => ({ file: f.file, key: f.key, title: last.get(f.key)!.title, before: f.before, after: last.get(f.key)!.after })).filter((f) => f.before !== f.after);
  }

  save(record: SaveRecord, version: string): void {
    this.state.files[record.key] = { source: record.after, version };
    this.state.saves.push(record);
    if (this.state.saves.length > MAX_SAVES) this.state.saves.splice(0, this.state.saves.length - MAX_SAVES);
    this.persist();
  }

  reset(): void {
    this.state = { files: {}, saves: [] };
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // nothing kept
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // full or off: the change still holds until the tab is refreshed
    }
  }
}
