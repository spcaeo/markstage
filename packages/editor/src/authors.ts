// The site's authors (docs/API-AUTHORS.md), for the Authors screen and the author field of Post settings: the routes,
// typed, and one shared list for the pickers (fetched once, refreshed after a change), plus the author page's
// address on the site. Off when the site keeps no author files (config().authors is null).
import { request } from './api';
import { siteUrl } from './copy';
import { config } from './runtime';

export interface Author {
  slug: string;
  name: string;
  role: string;
  /** Markdown */
  bio: string;
  /** a media path or an address */
  photo: string;
  /** only for editors and the person themselves */
  email?: string;
  website: string;
  social: string[];
  seoTitle: string;
  seoDescription: string;
  archived: boolean;
  /** the author page (a site path), or null */
  url: string | null;
  version: string;
  /** the entries that name them, and how many of those are live */
  posts: number;
  live: number;
}

export interface AuthorPost {
  collection: string;
  id: string;
  title: string;
  status: string;
  url: string | null;
  date: string | null;
  role: 'author' | 'co-author';
}

export type Profile = Partial<Pick<Author, 'name' | 'role' | 'bio' | 'photo' | 'email' | 'website' | 'social' | 'seoTitle' | 'seoDescription' | 'archived'>>;
export type Moved = { moved: { collection: string; id: string; title: string }[]; commit: string | null; job: string | null };

const enc = encodeURIComponent;
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

/** Is the site's author list on (config `authors`), and for this collection? */
export const authorsOn = (collection?: string) => !!config().authors && (!collection || config().authors!.collections.includes(collection));

export const listAuthors = () => request<{ items: Author[]; can: { manage: boolean } }>('authors');
export const getAuthor = (slug: string) => request<{ author: Author; posts: AuthorPost[]; can: { edit: boolean; manage: boolean } }>(`authors/${enc(slug)}`);
export const createAuthor = (body: Profile & { slug?: string }) => request<{ author: Author }>('authors', json('POST', body));
export const updateAuthor = (slug: string, version: string, body: Profile) => request<{ author: Author }>(`authors/${enc(slug)}`, json('PUT', { ...body, version }));
export const renameAuthor = (slug: string, version: string, to: string, movePosts: boolean) => request<Moved & { author: Author }>(`authors/${enc(slug)}/rename`, json('POST', { version, to, movePosts }));
export const deleteAuthor = (slug: string, version: string, reassign?: string) =>
  request<Moved & { ok: true }>(`authors/${enc(slug)}?${new URLSearchParams({ version, ...(reassign ? { reassign } : {}) })}`, json('DELETE'));

// one list for every picker on the page; a change anywhere fetches it again
let shared: Promise<Author[]> | null = null;
const listeners = new Set<() => void>();
export function authors(): Promise<Author[]> {
  shared ??= listAuthors().then(
    (r) => r.items,
    (e) => {
      shared = null;
      throw e;
    },
  );
  return shared;
}
/** The list changed (an author added, renamed, archived): the pickers draw it again. */
export function authorsChanged(): void {
  shared = null;
  for (const fn of listeners) fn();
}
export function onAuthorsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The author page on the site: the site's own address when it is known, else this origin's. */
export const pageUrl = (path: string) => (config().siteUrl ? `${config().siteUrl!.replace(/\/+$/, '')}${path}` : siteUrl(path));

/** The slug a name gives ("Ana María" -> "ana-maria"), as the server makes it. */
export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
