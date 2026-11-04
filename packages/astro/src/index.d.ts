// Types of @markstage/astro (the code is plain ESM).
import type { AstroIntegration } from 'astro';

export interface CollectionConfig {
  id: string;
  label?: string;
  format: 'md' | 'json';
  /** folder of the entries, relative to the project */
  dir: string;
  hasStatus?: boolean;
  fields?: Partial<Record<'title' | 'author' | 'tags' | 'date' | 'modified' | 'excerpt' | 'slug' | 'url', string | null>>;
  /** the page of an entry: a template ('/blog/{id}/', '{uri}') or, in dev, a function of the entry */
  url?: string | ((entry: { id: string; data: Record<string, any> }) => string | null) | null;
  /** dev only: the section the search lists the entry under */
  group?: (entry: { id: string; data: Record<string, any> }) => string | null | undefined;
  /** the author slug of a new entry whose maker has none (and of every new entry in astro dev) */
  defaultAuthor?: string | null;
  /** making a new entry: the settings keys the New sheet asks for, and the frontmatter it starts with */
  newEntry?: NewEntryDefaults | { ask?: string[]; defaults?: NewEntryDefaults };
}

export type NewEntryDefaults = (entry: {
  title: string;
  id: string;
  collection: string;
  /** what the New sheet asked for (newEntry.ask) */
  values: Record<string, unknown>;
  /** the maker on the Markstage server; null in astro dev */
  user: { id: string; name?: string; role?: string } | null;
  now: Date;
}) => Record<string, unknown>;

/** Author files (docs/API-AUTHORS.md): one <slug>.json per author. */
export interface AuthorsConfig {
  /** the folder of the author files (default src/content/authors) */
  dir?: string;
  /** the author page, with {slug} (default /author/{slug}/); null: no page */
  url?: string | null;
  /** the frontmatter list of co-authors (after the primary author); null: none */
  coAuthors?: string | null;
  /** the Organization @id a Person worksFor */
  organization?: string | null;
  /** the collections whose author field names an author (default: every collection with a status) */
  collections?: string[];
  /** the file's keys for each profile field, over the defaults; null leaves one out */
  fields?: Partial<Record<'slug' | 'name' | 'role' | 'bio' | 'photo' | 'email' | 'website' | 'social' | 'seoTitle' | 'seoDescription' | 'archived', string | null>>;
}

export interface MarkstageConfig {
  siteName?: string;
  siteUrl?: string;
  collections: CollectionConfig[];
  authors?: boolean | AuthorsConfig;
  compat?: { collection?: string | null };
  media?: { dir?: string };
  editor?: {
    lang?: string;
    /** the site's CSS the canvas needs to draw an entry as its page does */
    css?: string[];
    canvas?: { articleClass?: string; bodyClass?: string; shell?: boolean };
    packs?: { markdown?: string; editor?: string; css?: string | string[] }[];
    /** a module whose default export returns data for the packs (read in the browser with pageData()) */
    pageData?: string;
    favicon?: string | null;
    /** older addresses of the editor that redirect to /markstage/ */
    aliases?: string[];
    preload?: string[];
  };
}

export function defineConfig(config: MarkstageConfig): MarkstageConfig;
/** `checkAuthors: false` lets a build through with entries that name unknown authors; `checkPages: false` with frames or page types the site does not have. */
export default function markstage(options?: { config?: MarkstageConfig; checkAuthors?: boolean; checkPages?: boolean }): AstroIntegration;
