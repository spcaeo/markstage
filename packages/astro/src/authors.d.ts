// Types of @markstage/astro/authors (the code is plain ESM).

/** An author as the site's pages see it: never the email. */
export interface Author {
  slug: string;
  name: string;
  /** role or designation, e.g. "Founder" */
  role: string;
  /** Markdown */
  bio: string;
  /** the photo as the file keeps it (a media path, or an address) */
  photo: string;
  website: string;
  /** profile addresses (used as sameAs) */
  social: string[];
  seoTitle: string;
  seoDescription: string;
  archived: boolean;
  /** the author page (config authors.url), or null */
  url: string | null;
}

export interface AuthoredEntry {
  collection: string;
  id: string;
  title: string;
  url: string | null;
  date: string | null;
  role: 'author' | 'co-author';
  /** the entry's frontmatter (or JSON) */
  data: Record<string, any>;
}

export interface PersonOptions {
  /** the page address (default: the config's author page) */
  url?: string | null;
  /** the photo's address as the site serves it (a built image) */
  image?: string | null;
  /** the Organization @id (default: config authors.organization) */
  organization?: string | null;
  /** leave out @context (inside an @graph) */
  context?: boolean;
}

/** Every author, in name order; archived ones only with {archived: true}. */
export function getAuthors(opts?: { archived?: boolean }): Promise<Author[]>;
/** One author (archived too), or null. */
export function getAuthor(slug: string): Promise<Author | null>;
/** Their published entries, newest first. */
export function getEntriesByAuthor(slug: string, opts?: { collection?: string | null; coAuthored?: boolean }): Promise<AuthoredEntry[]>;
/** schema.org Person for an author. */
export function personJsonLd(author: Author, opts?: PersonOptions): Promise<Record<string, unknown>>;
/** The same helpers for a normalized site config (scripts and tests). */
export function authorsOf(cfg: unknown, opts?: { cache?: boolean }): {
  getAuthors(opts?: { archived?: boolean }): Author[];
  getAuthor(slug: string): Author | null;
  getEntriesByAuthor(slug: string, opts?: { collection?: string | null; coAuthored?: boolean }): AuthoredEntry[];
  personJsonLd(author: Author, opts?: PersonOptions): Record<string, unknown>;
};
