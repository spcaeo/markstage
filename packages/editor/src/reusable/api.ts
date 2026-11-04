// The Library's routes (docs/API.md "Library"): page templates, sections and snippets, shared ones kept as files in
// the site's repo (markstage/library/<kind>/<id>.json) and personal snippets in the server's database. A synced item
// is used as a copy that the server keeps in step (pages: `_synced` on the section, articles: frontmatter `synced`).
// Typed calls through the shell's request() (CSRF token, ApiError, the 401 hand-off).
import type { JSONContent } from '@tiptap/core';
import { apiPath, request } from '../api';

export type LibKind = 'template' | 'section' | 'snippet';
export type LibLocks = { move?: boolean; remove?: boolean; edit?: boolean };

export interface LibItem {
  id: string;
  kind: LibKind;
  synced: boolean;
  name: string;
  description: string;
  folder: string;
  order?: number | null;
  tags: string[];
  /** a template: the collection its entries go in; a section: the page collection it belongs to */
  collection?: string;
  /** a page section: its type in the site's schema (hero, cta, faq…) */
  sectionType?: string;
  /**
   * a template: {frontmatter, doc?, data?} (no slug, dates or author; `_fill` lists the fields to fill);
   * a page section: {value} (one sections[] item); an article snippet or section: {doc} (a fragment)
   */
  body: { frontmatter?: Record<string, unknown>; doc?: JSONContent; data?: unknown; value?: unknown; _fill?: string[] };
  thumb: string | null;
  /** synced items only: how many entries use it */
  usedOn?: number;
  /** synced items only: the version a new copy is marked with */
  syncVersion?: string;
  shared: boolean;
  locks?: LibLocks;
  createdBy: string;
  createdByName?: string;
  updatedAt: string;
  version: string;
  imported?: { from: 'pack' | 'wordpress' | 'url'; source: string } | null;
}

export interface LibUse {
  collection: string;
  id: string;
  title: string;
  url: string | null;
}

export interface LibList {
  items: LibItem[];
  total: number;
  page: number;
  perPage: number;
  facets?: { kinds?: Partial<Record<LibKind, number>>; synced?: number; folders?: { name: string; count: number }[]; tags?: { name: string; count: number }[] };
}

/** The URL's filters, in the server's words. */
export interface LibQuery {
  kind?: string;
  synced?: string;
  folder?: string;
  tag?: string;
  collection?: string;
  q?: string;
  sort?: string;
  page?: number;
}

export type LibDraft = Pick<LibItem, 'kind' | 'name' | 'body'> & Partial<Pick<LibItem, 'description' | 'folder' | 'tags' | 'synced' | 'collection' | 'sectionType' | 'shared' | 'locks' | 'order'>>;

const qs = (q: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const enc = encodeURIComponent;

let cache: Promise<LibList> | null = null;
/** Every item I may use (one page of 200, the panel's list); `fresh` reads again. */
export const all = (fresh = false) => (!fresh && cache) || (cache = request<LibList>(`library${qs({ perPage: 200 })}`).catch((e) => ((cache = null), Promise.reject(e))));
const changed = <T>(p: Promise<T>) => p.finally(() => ((cache = null), dispatchEvent(new Event('ms-library'))));

export const list = (q: LibQuery) => request<LibList>(`library${qs(q as Record<string, unknown>)}`);
export interface LibChange {
  sha: string;
  author: string;
  date: string;
  message: string;
}
/** One item, with the pages that use it (the server answers `usedOn` as that list here) and its file's commits. */
export const item = (id: string) =>
  request<Omit<LibItem, 'usedOn'> & { usedOn?: number | LibUse[]; history?: LibChange[] }>(`library/${enc(id)}`).then(({ usedOn, ...it }) => ({
    ...it,
    usedOn: Array.isArray(usedOn) ? usedOn.length : usedOn,
    uses: Array.isArray(usedOn) ? usedOn : undefined,
  }));
export const create = (d: LibDraft) => changed(request<LibItem>('library', json('POST', d)));
export const update = (id: string, patch: Partial<LibDraft> & { version: string }) => changed(request<LibItem>(`library/${enc(id)}`, json('PATCH', patch)));
export const remove = (id: string, detach = false) => changed(request<{ ok: true }>(`library/${enc(id)}${detach ? '?detach=1' : ''}`, { method: 'DELETE' }));
export const duplicate = (id: string) => changed(request<LibItem>(`library/${enc(id)}/duplicate`, { method: 'POST' }));
export const impact = (id: string) => request<{ pages: LibUse[] }>(`library/${enc(id)}/impact`);
/** A synced item changed everywhere it is used: one commit; uses edited in place are skipped and listed. */
export const editEverywhere = (id: string, body: LibItem['body'], version: string) =>
  changed(request<{ changed: number; skipped?: LibUse[]; job?: { id: string } }>(`library/${enc(id)}`, json('PUT', { body, version })));
export const putThumb = (id: string, png: Blob) => changed(request<{ thumb: string }>(`library/${enc(id)}/thumb`, { method: 'PUT', body: png, headers: { 'content-type': 'image/png' } }));
export const removeThumb = (id: string) => changed(request<LibItem>(`library/${enc(id)}/thumb`, { method: 'DELETE' }));

export interface ImportPreview {
  items: { path: string; kind: LibKind; name: string; exists?: boolean }[];
  media: number;
  problems: string[];
}
const fileForm = (file: File, onClash?: 'skip' | 'copy') => {
  const form = new FormData();
  form.append('file', file);
  if (onClash) form.append('onClash', onClash);
  return form;
};
/** What a file would bring in (nothing is written). */
export const previewFile = (file: File) => request<ImportPreview>('library/import?dry=1', { method: 'POST', body: fileForm(file) });
export interface ImportResult {
  created: string[];
  skipped?: { id: string }[];
  media: number;
  problems: string[];
  commit: string | null;
}
export const importFile = (file: File, onClash?: 'skip' | 'copy') => changed(request<ImportResult>('library/import', { method: 'POST', body: fileForm(file, onClash) }));
export interface PagePart {
  id: string;
  label: string;
  /** a clean copy of the part (no script, style, frame or form) */
  html: string;
  images: number;
}
/** A web page's parts to choose from; the server fetches it (public addresses only). Nothing is written. */
export const readPage = (url: string) => request<{ url: string; title: string; parts: PagePart[] }>('library/import/url', json('POST', { url }));
export interface PartsPreview {
  url: string;
  items: { id: string; name: string; kind: LibKind; images: number }[];
  media: number;
  problems: string[];
}
/** What the chosen parts would become (nothing written). */
export const previewParts = (url: string, parts: string[], kind: LibKind) => request<PartsPreview>('library/import/url/parts', json('POST', { url, parts, kind, dry: true }));
export const importParts = (url: string, parts: string[], kind: LibKind) => changed(request<ImportResult & { items: { id: string; name: string }[] }>('library/import/url/parts', json('POST', { url, parts, kind })));

/** Media in bulk (docs/API.md "Importing media"): a dry run lists each address or file and its problem, if any. */
export interface MediaCheck {
  items: { url?: string; name?: string; bytes?: number; problem?: string }[];
  job?: { id: string };
}
export const mediaUrls = (urls: string[], dry: boolean) => request<MediaCheck>('media/import/urls', json('POST', { urls, dry }));
export const mediaZip = (zip: File, dry: boolean) =>
  request<MediaCheck>(`media/import/zip${qs({ filename: zip.name, dry: dry ? 1 : null })}`, { method: 'POST', body: zip, headers: { 'content-type': 'application/zip' } });
/** The address that downloads these items as a pack (.json, kept byte for byte): a plain link, no script needed. */
export const exportUrl = (ids: string[]) => apiPath(`library/export${qs({ ids: ids.join(',') })}`);
