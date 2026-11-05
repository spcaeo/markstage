// The Markstage API (docs/API.md) as the editor uses it: collections, entries, save with a version check, the raw
// source, import. The dev integration and the production server answer the same routes.
import type { JSONContent } from '@tiptap/core';
import { config } from './runtime';

export interface EntrySummary {
  id: string;
  collection: string;
  title: string;
  url: string | null;
  status?: string;
  /** a scheduled entry the publish rules stopped when it fell due: when, and why (docs/API.md "Held") */
  held?: { dueAt: string; reasons: string[] };
  modified?: string;
  excerpt?: string;
  tags?: string[];
  /** optional section the site sorts entries into (the Articles search groups by it) */
  group?: string;
  date?: string | null;
  /** the group it is in, when its collection has groups (config groups.field) */
  groupId?: string | null;
}

export interface Entry {
  id: string;
  collection: string;
  format: 'md' | 'json';
  /** an MDX file (docs/MDX.md) */
  mdx?: boolean;
  /** an MDX file the reader could not read: why, and where (it opens read-only in Source mode, without a doc) */
  unreadable?: { message: string; line: number | null; column: number | null };
  version: string;
  status?: string;
  /** when a scheduled entry goes live */
  publishAt?: string | null;
  url: string | null;
  title: string;
  frontmatter?: Record<string, unknown>;
  doc?: JSONContent;
  data?: Record<string, unknown>;
  /** what the person may do; `fields`: a custom role allows an edit of these fields only (field-access.ts) */
  can?: { edit: boolean; publish: boolean; delete: boolean; rawHtml: boolean; fields?: string[] };
}

export interface SaveResult {
  ok: true;
  version: string;
  changedBlocks: number;
}

/** A failed call: `status` 409 is a conflict (the file changed since it was opened); `version` the current one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly version?: string,
    /** the API's stable error code (docs/API.md "Errors"), e.g. 'unauthorized', 'id-taken' */
    readonly code?: string,
    /** per-field messages of a 422 */
    readonly fields?: Record<string, string>,
    /** the whole answer (what a refusal names, e.g. a 409 `synced`'s {id, name}) */
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const apiPath = (p: string) => path(p);
const path = (p: string) => `${config().api.replace(/\/+$/, '')}/${p}`;
const enc = encodeURIComponent;

// the server's CSRF token (docs/API.md "Conventions"): taken from any answer that carries one, sent on every write
let csrf: string | null = null;
let unauthorized: ((path: string) => void) | null = null;

/** Called when a request (other than auth/…) answers 401: the shell sends the writer to sign in. */
export function onUnauthorized(fn: (path: string) => void): void {
  unauthorized = fn;
}

/**
 * Any API route (path relative to /markstage/api/): JSON in and out, the CSRF token on writes, ApiError on failure.
 * The shell's own calls and the admin screens' use it alike.
 */
export async function request<T>(p: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const write = !!init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase());
  try {
    res = await fetch(path(p), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(write && csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...init?.headers,
      },
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('The editor server cannot be reached. Is the dev server running?', 0);
  }
  const data = await res.json().catch(() => null);
  if (data && typeof data === 'object' && 'csrfToken' in data) csrf = (data as { csrfToken: string | null }).csrfToken;
  if (!res.ok) {
    if (res.status === 401 && !p.startsWith('auth/')) unauthorized?.(p);
    throw new ApiError(data?.message ?? `The server answered ${res.status}.`, res.status, data?.version, data?.error, data?.fields, data ?? undefined);
  }
  return data as T;
}
const call = request;

/**
 * The light index of the site: every entry of every collection with what the shell needs (title, address, status),
 * in one request shared by the palette, Home's Recent and the link targets; loaded when first asked for, not at
 * boot. The server answers it with an ETag, so a repeat is a 304. `forgetIndex` after a change (a save, a trash).
 */
let index: Promise<EntrySummary[]> | null = null;
export function siteIndex(): Promise<EntrySummary[]> {
  index ??= call<{ items: EntrySummary[] }>('index').then(
    (r) => r.items,
    (e) => {
      index = null;
      throw e;
    },
  );
  return index;
}
export function forgetIndex(): void {
  index = null;
}

/** Every entry of a collection (all pages of the list). */
export async function listEntries(collection: string): Promise<EntrySummary[]> {
  const out: EntrySummary[] = [];
  for (let page = 1; ; page++) {
    const r = await call<{ items: Omit<EntrySummary, 'collection'>[]; total: number; perPage: number }>(
      `collections/${enc(collection)}/entries?perPage=200&page=${page}&sort=title`,
    );
    out.push(...r.items.map((i) => ({ ...i, collection })));
    if (page * r.perPage >= r.total || !r.items.length) return out;
  }
}

export const getEntry = (c: string, id: string) => call<Entry>(`collections/${enc(c)}/entries/${enc(id)}`);

/** Saves the document and/or frontmatter key changes ({key: value}, null removes; mappings merge key by key). */
export const saveEntry = (c: string, id: string, doc: JSONContent | undefined, version: string, frontmatter?: Record<string, unknown>) =>
  call<SaveResult>(`collections/${enc(c)}/entries/${enc(id)}`, { method: 'PUT', body: JSON.stringify({ doc, version, frontmatter }) });

export const getSource = (c: string, id: string) => call<{ source: string; version: string; format: string }>(`collections/${enc(c)}/entries/${enc(id)}/source`);

export const saveSource = (c: string, id: string, source: string, version: string) =>
  call<SaveResult>(`collections/${enc(c)}/entries/${enc(id)}/source`, { method: 'PUT', body: JSON.stringify({ source, version }) });

export const importEntry = (c: string, filename: string, source: string) =>
  call<Entry>(`collections/${enc(c)}/import`, { method: 'POST', body: JSON.stringify({ filename, source }) });

export const downloadUrl = (c: string, id: string) => path(`collections/${enc(c)}/entries/${enc(id)}/download`);

/** A draft copy of an entry ("<title> (copy)"), as the server makes it. */
export const duplicateEntry = (c: string, id: string) => call<Entry>(`collections/${enc(c)}/entries/${enc(id)}/duplicate`, { method: 'POST', body: '{}' });

/** Moves an entry to the trash (its version as opened); `trashId` is where it waits to be restored. */
export const trashEntry = (c: string, id: string, version: string) => call<{ ok: true; trashId: string; job: string | null }>(`collections/${enc(c)}/entries/${enc(id)}?version=${enc(version)}`, { method: 'DELETE' });

/** Where the device frame shows the entry: the server's preview (`live`: it follows unsaved changes through the
 *  autosave), else the page as the site's dev server draws the saved file (no preview set up, or dev mode). */
export async function previewUrl(c: string, id: string, pagePath: string, locale?: { code: string; prefix: string } | null): Promise<{ url: string; live: boolean }> {
  try {
    const r = await call<{ url: string; devServer?: boolean }>(`preview/${enc(c)}/${enc(id)}${locale ? `?locale=${enc(locale.code)}` : ''}`);
    return { url: r.url, live: !r.devServer };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return { url: new URL(`${locale?.prefix ?? ''}${pagePath}`, location.origin).href, live: false };
    throw err;
  }
}
