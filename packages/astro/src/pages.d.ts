// Types of @markstage/astro/pages (the code is plain ESM).

/** How the site lays a page out around its content. */
export interface Frame {
  id: string;
  label: string;
  hint: string;
}

/** The frame a page has, and where it came from: its own choice, its type's, or its collection's default. */
export interface PageFrame extends Frame {
  from: 'page' | 'type' | 'collection';
}

/** What a page is for (a money page, an article, a pillar…). */
export interface PageType {
  id: string;
  label: string;
  description: string;
  collections: string[];
  /** the frame its pages have unless they choose one, or null */
  frame: string | null;
}

export interface PagesHelpers {
  frames(): Frame[];
  pageTypes(): PageType[];
  frameOf(collection: string, data: Record<string, unknown> | undefined): PageFrame | null;
  pageTypeOf(collection: string, data: Record<string, unknown> | undefined): PageType | null;
}

/** The helpers for one normalized site config. */
export function pagesOf(cfg: unknown): PagesHelpers;
/** The site's frames ([] when it has none). */
export function frames(): Promise<Frame[]>;
/** The site's page types ([] when it has none). */
export function pageTypes(): Promise<PageType[]>;
/** The entry's frame (its own, its type's, its collection's); null when the site has no frames or no such collection. */
export function frameOf(collection: string, data: Record<string, unknown> | undefined): Promise<PageFrame | null>;
/** The entry's page type, or null. */
export function pageTypeOf(collection: string, data: Record<string, unknown> | undefined): Promise<PageType | null>;
