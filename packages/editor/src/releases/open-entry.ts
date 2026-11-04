// The entry open in the editor, as "Add to a release" needs it: the editor (index.ts) says which it is and hands over
// its unsaved changes, so they wait in the release rather than going on the site, then lets them go from the editor.
// A screen is shown over the open entry and leaves it as it was, so the changes are still there when it asks.
import type { EntryContent } from './api';

export interface OpenEntry {
  collection: string;
  id: string;
  title: string;
  version: string;
  /** where it is open: '#/e/<c>/<id>' or '#/p/<c>/<id>' */
  hash: string;
  /** it has changes not saved yet */
  dirty: boolean;
  /** those changes, as the release takes them (the file text, or a page's data) */
  content(): Promise<EntryContent>;
  /** they are in the release now: the editor shows the saved entry again */
  release(): Promise<void>;
}

let current: (() => OpenEntry | null) | null = null;

/** The editor says how to read its open entry. */
export const provideOpenEntry = (fn: () => OpenEntry | null) => void (current = fn);

/** The open entry, when it is this one. */
export function openEntry(collection: string, id: string): OpenEntry | null {
  const e = current?.() ?? null;
  return e && e.collection === collection && e.id === id ? e : null;
}
