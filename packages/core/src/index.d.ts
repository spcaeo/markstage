// Types of @markstage/core (the code is plain ESM in index.mjs).

/** A node of the editor document (ProseMirror JSON). */
export interface DocNode {
  type: string;
  attrs?: Record<string, any>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
}

export interface LineBlock {
  name: string;
  kind: 'line';
  /** a whole one-line HTML block -> its node, or null when it is not this block */
  parse(html: string): DocNode | null;
  print(node: DocNode): string;
}

export interface WrapBlock {
  name: string;
  kind: 'wrap';
  /** the opening HTML line -> what it holds, or null when it is not this block */
  open(html: string): { attrs?: Record<string, any>; title?: string; close: string } | null;
  /** the opening line (and the fixed title paragraph, if any) */
  printOpen(node: DocNode): string;
  printClose(node: DocNode): string;
  /** only opens inside this block */
  parent?: string;
  /** the exact child block types it holds */
  children?: string[];
}

export type BlockCodec = LineBlock | WrapBlock;

export interface BlockPack {
  name: string;
  blocks: BlockCodec[];
}

export function definePack<T extends BlockPack>(pack: T): Readonly<T>;
export function registry(packs?: BlockPack[]): unknown;

export interface Converter {
  /** Markdown file -> its raw frontmatter block and the document */
  mdToDoc(text: string): { frontmatter: string; doc: DocNode };
  /** document -> the file text; surgical (only changed blocks rewritten) unless preserve is false */
  docToMd(doc: DocNode, originalText?: string, opts?: { preserve?: boolean }): string;
  changedBlocks(doc: DocNode, originalText: string): number;
  printBlock(node: DocNode, ctx?: unknown): string;
  printBlocks(nodes: DocNode[]): string;
  rawHtmlOf(doc: DocNode): string[];
  splitFrontmatter(text: string): { frontmatter: string; body: string };
}

export function createConverter(opts?: { packs?: BlockPack[] }): Converter;
export function rawHtmlOf(doc: DocNode): string[];
export function splitFrontmatter(text: string): { frontmatter: string; body: string };
/** Every URL a CommonMark renderer builds from this Markdown (links, autolinks, images, definitions). */
export function markdownUrls(text: string): string[];

export function readFrontmatter(text: string): Record<string, any>;
/**
 * The file with some frontmatter keys changed and every other byte kept: unchanged values are not touched, a
 * mapping given for a mapping is merged key by key, null removes a key, new keys go last in their mapping, and a
 * changed value keeps the old one's style (quotes, plain, >- / |, flow, list indentation, one line). A file
 * without frontmatter gets one.
 */
export function setFrontmatter(text: string, changes: Record<string, unknown>): string;

/** One stretch of a three-way merge: blocks taken as they are, or a conflict with the three versions. */
export type MergePart<T> = { take: T[]; conflict?: undefined } | { take?: undefined; conflict: { base: T[]; mine: T[]; theirs: T[] } };
/** Three-way merge of block lists (by `key`, JSON by default): `merged` is null while there are conflicts. */
export function mergeBlocks<T>(
  base: T[],
  mine: T[],
  theirs: T[],
  key?: (block: T) => string,
): { parts: MergePart<T>[]; merged: T[] | null; conflicts: number; theirsTaken: number; mineTaken: number };
/** The leaves of `to` that differ from `from`: [path, value] (undefined: gone in `to`). */
export function changedLeaves(from: Record<string, unknown>, to: Record<string, unknown>): [string, unknown][];
/** The merged list with each conflict as chosen ('mine' when not given). */
export function resolve<T>(parts: MergePart<T>[], choices: ('mine' | 'theirs' | 'both')[]): T[];
/** A text's paragraphs (blank-line separated; a fenced code block kept whole). */
export function splitBlocks(text: string): string[];
/** Objects merged leaf by leaf; `conflicts` are the paths both sides changed differently (mine kept in `merged`). */
export function mergeData<T extends Record<string, unknown>>(base: T, mine: T, theirs: T): { merged: T; conflicts: string[] };

/** A lock on an item (docs/OPERATIONS.md "Locks"): what may not be done to it, and who locked it ("the site"). */
export interface Lock {
  move?: boolean;
  remove?: boolean;
  edit?: boolean;
  by?: string;
}
/** An item of an ordered list or tree. */
export interface OrderNode {
  id: string;
  children?: OrderNode[];
  lock?: Lock;
}
/** Where items go: `index` among the children of `parent` (null: the top level), counted without the moved items. */
export interface Place {
  parent: string | null;
  index: number;
}
export interface FlatRow<T extends OrderNode> {
  item: T;
  depth: number;
  parent: string | null;
  index: number;
  path: number[];
}
/** The tree in reading order, with each item's depth, parent and index. */
export function flatten<T extends OrderNode>(tree: T[]): FlatRow<T>[];
export function find<T extends OrderNode>(tree: T[], id: string): FlatRow<T> | null;
export function placeOf<T extends OrderNode>(tree: T[], id: string): Place | null;
/** The ids above an item, nearest first. */
export function ancestors<T extends OrderNode>(tree: T[], id: string): string[];
/** The tree with `ids` (in reading order, each with its children) at `to`; the same tree when the move is impossible. */
export function moveItems<T extends OrderNode>(tree: T[], ids: string[], to: Place): T[];
export function removeItems<T extends OrderNode>(tree: T[], ids: string[]): { tree: T[]; removed: (Place & { item: T })[] };
export function restoreItems<T extends OrderNode>(tree: T[], removed: (Place & { item: T })[]): T[];
export function canMove<T extends OrderNode>(tree: T[], ids: string[]): { ok: boolean; reason: string };
export function canRemove<T extends OrderNode>(tree: T[], ids: string[]): { ok: boolean; reason: string };

/** One locale of the site (markstage.config `locales`): a copy of every page under `prefix` ('' = the root). */
export interface Locale {
  code: string;
  prefix: string;
  default: boolean;
  label: string;
  /** the name of its spelling, e.g. "Canadian" or "US" */
  variety: string | null;
  /** keys a writer may set for this locale only (title, description, slug) */
  overrides: string[];
}
export interface Locales {
  list: Locale[];
  /** the locale x-default points at */
  xDefault: string;
  /** frontmatter keys that decide whether a page emits hreflang (config `hreflang`) */
  hreflang?: { robots: string | null; canonical: string | null };
}
/** Whether a page emits hreflang: not when noindex, nor when its canonical is another address. */
export function emitsHreflang(locales: Locales | null | undefined, data: Record<string, unknown>, path: string, siteUrl?: string): { ok: boolean; reason: string | null };
/** The page at site path `path` in `locale`. */
export function localePath(locale: Pick<Locale, 'prefix'>, path: string): string;
/** The hreflang links a page at `path` emits: one per locale, then x-default. */
export function alternates(locales: Locales | null | undefined, path: string): { hreflang: string; path: string }[];
/** The locale a request path belongs to, else the default. */
export function localeOfPath<L extends Locale>(locales: { list: L[] }, path: string): L;
export function bodyOf(text: string): string;
export function hasFrontmatter(text: string): boolean;

export function decodeHtml(s: string): string;
export function escHtml(s: string): string;
export function escAttr(s: string): string;
export interface Tag {
  name: string;
  close: boolean;
  attrs: [string, string | null][];
  self: boolean;
}
export function parseTag(tag: string): Tag | null;
export function attrOf(tag: Tag, name: string): string | null;
export function hasTags(s: string): boolean;

export function sameMark(a: unknown, b: unknown): boolean;
export function normalizeInline(nodes: DocNode[]): DocNode[];
export function linkFromTag(tag: Tag): { type: 'link'; attrs: Record<string, any> } | null;
export function linkOpenTag(attrs: Record<string, any>, extra?: string): string;
export function htmlToInline(html: string): DocNode[];
export function inlineToHtml(nodes: DocNode[]): string;
export function markOrder(a: unknown, b: unknown, nodes: DocNode[], i: number): number;
export function markExtent(m: unknown, nodes: DocNode[], i: number): number;
export function paragraph(inline: DocNode[]): DocNode;

export { checkLocks, LOCK_RULES_FILE, lockChanges, lockOf, lockReport, lockRulesText, markOf, normalizeLockRules } from './locks';
export type { LockChange, LockMark, LockRules, LockSide, LockViolation } from './locks';
