// Snippets (docs/API.md "Snippets and templates"): pieces of an article kept to insert again, each person's own or
// shared with everyone. The list is read once and kept (the block menu offers them); a change reads it again.
import type { JSONContent } from '@tiptap/core';
import { ApiError, request } from '../api';
import { viewerName } from '../runtime';

export interface Snippet {
  id: string;
  name: string;
  /** a document fragment in the saved (contract) shape: {type: 'doc', content: [...]} */
  doc: JSONContent;
  createdBy: string;
  shared: boolean;
  updatedAt: string;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
let cache: Promise<Snippet[] | null> | null = null;

/** Every snippet I may use (mine and the shared ones), by name; null where there are none (dev mode, signed out). */
export function snippets(fresh = false, signedIn = snippetsHere()): Promise<Snippet[] | null> {
  if (!cache || fresh)
    cache = (signedIn ? request<Snippet[]>('snippets') : Promise.resolve(null)).catch((e) => {
      cache = null;
      if (e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 401)) return null;
      throw e;
    });
  return cache;
}

/** Whether this editor has snippets: someone is signed in to the Markstage server (dev mode has none). */
export const snippetsHere = () => !!viewerName();

const changed = <T>(p: Promise<T>) => p.finally(() => void snippets(true).catch(() => null));
export const createSnippet = (body: { name: string; doc: JSONContent; shared: boolean }) => changed(request<Snippet>('snippets', json('POST', body)));
export const updateSnippet = (id: string, body: Partial<Pick<Snippet, 'name' | 'doc' | 'shared'>>) => changed(request<Snippet>(`snippets/${encodeURIComponent(id)}`, json('PATCH', body)));
export const deleteSnippet = (id: string) => changed(request<{ ok: true }>(`snippets/${encodeURIComponent(id)}`, { method: 'DELETE' }));

// A snippet's folder and its place in the library ride in its document (`doc.attrs.folder`, `doc.attrs.order`): the
// server keeps no fields for them, and inserting takes only the blocks. No folder is the top of the library; a
// snippet with no place yet comes after the placed ones, by name.
export const folderOf = (s: Snippet): string => (typeof s.doc.attrs?.folder === 'string' ? s.doc.attrs.folder.trim() : '');
export const orderOf = (s: Snippet): number => (typeof s.doc.attrs?.order === 'number' ? s.doc.attrs.order : Infinity);
/** The library's order: folders A–Z (no folder last), then each snippet's place, then its name. */
export const byPlace = (a: Snippet, b: Snippet) => {
  const fa = folderOf(a);
  const fb = folderOf(b);
  return Number(!fa) - Number(!fb) || fa.localeCompare(fb) || orderOf(a) - orderOf(b) || a.name.localeCompare(b.name);
};
/** The snippet's document with this folder ('' none) and place (null: none). */
export function placed(s: Snippet, folder: string, order: number | null): JSONContent {
  const { folder: _f, order: _o, ...rest } = s.doc.attrs ?? {};
  const attrs = { ...rest, ...(folder ? { folder } : {}), ...(order !== null && Number.isFinite(order) ? { order } : {}) };
  const { attrs: _a, ...doc } = s.doc;
  return Object.keys(attrs).length ? { ...doc, attrs } : doc;
}
