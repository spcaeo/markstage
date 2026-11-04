// What the editor knows about the site it runs for: the client config from the integration (API base, collections,
// canvas classes) and the block packs (editor side, plus the Markdown codecs for Source mode). Set once at start.
import { createConverter } from '@markstage/core';
import type { BlockUI, EditorPack, InserterEntry } from './pack';
import { BUILTIN_BLOCKS, BUILTIN_INSERTER } from './builtins';

export interface CollectionInfo {
  id: string;
  label: string;
  format: 'md' | 'json';
  /** repo-relative folder of its files (images in them are relative to it) */
  dir: string;
  /** the entries have a page on the site (a URL) */
  hasUrl: boolean;
  /** the field that is a page's whole address (`url: '{uri}'`), asked for when a page is made from a template */
  addressKey?: string | null;
  /** the frontmatter key of the title (edited in place on the canvas) */
  titleKey?: string;
  /** the Post settings fields (settings/) */
  settings?: SettingField[];
  /** the "New" sheet: the settings keys it asks for besides the title (config newEntry.ask) */
  newEntry?: { ask: string[] };
  /** frontmatter keys the site needs: emptied, they stay ("" or []); any other emptied field leaves the file */
  required?: string[];
  /** menu item keys that name an entry by its id, and its collection (config linkKeys, e.g. {page: 'pages'}) */
  linkKeys?: Record<string, string>;
  /** its entries sorted into another collection's (topic clusters): the setting that names the group, the groups'
   * collection, the key in a group that lists entry ids first in order, and what they are called (config groups) */
  groups?: { field: string; collection: string; order: string; label: string };
}

/** One field of the Post settings drawer. Keys are frontmatter paths ("seo.title"). */
export type SettingField =
  | { type: 'text' | 'textarea' | 'slug' | 'date' | 'tags'; key: string; label: string; hint?: string; max?: number; placeholder?: string }
  | { type: 'select'; key: string; label: string; hint?: string; from?: string; options?: [string, string][] }
  /** one of the site's authors (config `authors`), searchable, with co-authors under `coAuthors` when the site keeps them */
  | { type: 'author'; key: string; label: string; hint?: string; coAuthors?: string | null }
  /** on or off; the key is written only when it differs from `default` (false unless set) */
  | { type: 'switch'; key: string; label: string; hint?: string; default?: boolean }
  | {
      type: 'image';
      key: string;
      label: string;
      hint?: string;
      alt?: string;
      clears?: string[];
      focal?: string;
      /** the frontmatter key the site uses as the image's alt text while `alt` is empty (e.g. the title) */
      altFallback?: string;
    }
  | {
      type: 'seo';
      label: string;
      title: string;
      description: string;
      titleMax?: number;
      descriptionMax?: number;
      /** the focus keyphrase (a string, or a list whose first one is checked): the SEO check's keyphrase checks */
      keyphrase?: string;
    }
  | { type: 'social'; label: string; title: string; description: string; image: string };

export interface LinksConfig {
  /** offered first in the link search, labelled (e.g. the booking link) */
  special: { href: string; label: string }[];
  /** links the site opens in a popup: a CSS selector for the canvas (a badge) and the link card's note */
  popup: { selector: string; note: string } | null;
}

/** What can't be done to a block (docs/OPERATIONS.md "Locks"). */
export interface SiteLock {
  move?: boolean;
  remove?: boolean;
  edit?: boolean;
}

export interface ClientConfig {
  /** API prefix, e.g. /markstage/api/ */
  api: string;
  siteName: string;
  collections: CollectionInfo[];
  /** the collection old #/a/<id> links open */
  compat: string | null;
  /** shell: the canvas is drawn inside the entry's real page (canvas-shell/page.ts, docs/CANVAS-FIDELITY.md) */
  canvas: { articleClass: string; bodyClass: string; shell?: boolean };
  /** the site's address (https://example.com), for previews */
  siteUrl?: string;
  /** where media paths in the frontmatter are served from (/src/assets/uploads/) */
  media?: { url: string; dir?: string };
  links?: LinksConfig;
  /** the site's locales (copies of every page per region or language), or none */
  locales?: LocalesConfig | null;
  images?: ImagesConfig;
  /** the site's own preview data for its links (config editor.linkCards), or none */
  linkCards?: { url: string; fields: Record<'title' | 'description' | 'image' | 'tag' | 'date', string> } | null;
  /** how a change saved in dev mode goes live (config editor.goLive) */
  goLive?: string;
  /** the site's other colour schemes and how its page turns one on (config `themes`) */
  themes?: { dark?: SiteTheme };
  /** the site's lock rules (config `locks`): page sections by type, article boxes by block name */
  locks?: { pages: Record<string, SiteLock>; articles: Record<string, SiteLock> };
  /** a moved entry's old address redirects to the new one (the site's redirects hook) */
  redirects?: boolean;
  /** how the site lays a page out around its content (config `frames`): the choices, the key, each collection's default */
  frames?: { key: string; list: FrameInfo[]; defaults: Record<string, string> } | null;
  /** what pages are for (config `pageTypes`): each type's frame, Library template, locks and checks */
  pageTypes?: { key: string; types: PageTypeInfo[] } | null;
  /** the site's authors as files (config `authors`): the author page, the co-authors key, the collections */
  authors?: { url: string | null; coAuthors: string | null; collections: string[]; /** the profile fields the site keeps (name always) */ profile?: string[] } | null;
  /** the site's topics and its link map (config `topics`): which collections, the money pages, the outside-link lists */
  topics?: { collections: string[]; money: { pageTypes: string[]; paths: string[] }; follow: string[]; sponsored: string[]; enough: number } | null;
}

/** A frame: how the site lays a page out (full width, reading, plain…). */
export interface FrameInfo {
  id: string;
  label: string;
  hint: string;
}

/** A page type (docs/API-PAGE-TYPES.md): what a page is for, with its frame, template, locks and checks. */
export interface PageTypeInfo {
  id: string;
  label: string;
  description: string;
  collections: string[];
  frame: string | null;
  /** the Library page template a new page of the type starts from */
  template: string | null;
  locks: { pages: Record<string, SiteLock>; articles: Record<string, SiteLock> };
  checks: { id: string; label: string; level: 'warn' | 'block' }[];
}

/** A site colour scheme: a data- attribute (or the class) set on the page's <html>. */
export interface SiteTheme {
  attr: string;
  value: string;
}

/** editor.images: the widths an image may take (the first writes no class), captions, the decorative class. */
export interface ImagesConfig {
  widths: { id: string; label: string; class: string | null }[];
  captions: boolean;
  decorativeClass: string;
}

export const imagesConfig = (): ImagesConfig => cfg.images ?? { widths: [{ id: 'normal', label: 'Normal', class: null }], captions: true, decorativeClass: 'decorative' };

export interface LocaleInfo {
  code: string;
  /** '' for the root, else e.g. /en-us */
  prefix: string;
  default: boolean;
  label: string;
  /** its spelling's name, e.g. "Canadian" */
  variety: string | null;
  /** the site respells this locale's text at build */
  hasSpelling: boolean;
  /** that respelling, text -> text (the site's own function, imported by the client module) */
  spell?: (text: string) => string;
  /** keys a writer may set for this locale only */
  overrides: string[];
}

export interface LocalesConfig {
  list: LocaleInfo[];
  xDefault: string;
  /** the frontmatter key that holds per-locale overrides: <key>.<code>.<field> */
  overridesKey: string;
  /** frontmatter keys that decide whether a page emits hreflang (noindex, a canonical elsewhere) */
  hreflang?: { robots: string | null; canonical: string | null };
}

export interface MarkdownPack {
  name: string;
  blocks: unknown[];
}

let cfg: ClientConfig;
let packs: EditorPack[] = [];
let blocks = new Map<string, BlockUI>();
let converter: ReturnType<typeof createConverter> | null = null;
let markdownPacks: MarkdownPack[] = [];

export function setup(config: ClientConfig, editorPacks: EditorPack[], mdPacks: MarkdownPack[]): void {
  cfg = config;
  packs = editorPacks;
  markdownPacks = mdPacks;
  blocks = new Map(BUILTIN_BLOCKS.map((b) => [b.name, b]));
  for (const p of packs) for (const b of p.blocks ?? []) blocks.set(b.name, { ...blocks.get(b.name), ...b });
}

export const config = () => cfg;

/** Who is using the editor: their role and name (the server's signed-in user; in dev mode the owner). */
let viewer = { role: 'owner', name: '' };
/** The editor is served by the Markstage server with a signed-in person (not astro dev, not its dev mode). */
let served = false;
export const setViewer = (v: { role: string; name: string }) => void ((viewer = v), (served = true));
export const viewerRole = () => viewer.role;
export const viewerName = () => viewer.name;
export const onServer = () => served;
export const editorPacks = () => packs;

/** The settings and label of a node type, if it is a box (anything the writer selects as one thing). */
export const blockUI = (name: string) => blocks.get(name);
export const isBox = (name: string) => blocks.has(name);
/** Every box the editor knows (the built-in ones and the site's packs), by block name. */
export const boxes = () => [...blocks.keys()].map((name) => ({ name, label: blocks.get(name)?.label ?? name }));
export const boxLabel = (name: string) => blocks.get(name)?.label ?? name;

export const inserterEntries = (): InserterEntry[] => [...BUILTIN_INSERTER, ...packs.flatMap((p) => p.inserter ?? [])];

export const collection = (id: string) => cfg.collections.find((c) => c.id === id);
/** The collections whose entries open on the canvas (Markdown with a page). */
export const editable = () => cfg.collections.filter((c) => c.format === 'md');

/** The site's converter, in the browser (Source mode, Copy as Markdown). */
export function md() {
  converter ??= createConverter({ packs: markdownPacks as never });
  return converter;
}

/** Where the current entry's file lives (relative images resolve from there). */
let entryDir = '';
export const setEntryDir = (dir: string) => void (entryDir = dir);
export const currentEntryDir = () => entryDir;
