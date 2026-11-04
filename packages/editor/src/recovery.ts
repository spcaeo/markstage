// The local recovery copy: what the writer typed and has not saved, kept in this browser (IndexedDB) on every
// change, so a closed or crashed tab loses nothing; offered again when the entry opens (keep.ts). One copy per
// entry, with the version it started from. IndexedDB may be unavailable (a private window, blocked site data): the
// editor then works as before, without copies.
import type { JSONContent } from '@tiptap/core';

export interface RecoveryCopy {
  /** `<api><collection>/<id>` */
  key: string;
  title: string;
  /** when it was written (ms) */
  at: number;
  /** the entry's version the changes started from */
  version: string;
  view: 'canvas' | 'source';
  /** canvas: the document as opened, the document with the changes, the frontmatter as opened and as typed */
  base?: JSONContent;
  doc?: JSONContent;
  fmBase?: Record<string, unknown>;
  fm?: Record<string, unknown>;
  /** source: the file text as opened, and as typed */
  sourceBase?: string;
  source?: string;
}

const DB = 'markstage-recovery';
const STORE = 'copies';
let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  return (db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await open();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Keeps the copy: true once it is stored, false when this browser cannot keep one (no IndexedDB). */
export const putCopy = (c: RecoveryCopy) => run('readwrite', (s) => s.put(c)).then((k) => k !== null);
export const getCopy = (key: string) => run<RecoveryCopy | undefined>('readonly', (s) => s.get(key)).then((c) => c ?? null);
export const dropCopy = (key: string) => run('readwrite', (s) => s.delete(key)).then(() => undefined);
