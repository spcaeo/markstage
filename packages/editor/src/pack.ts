// The editor side of a block pack: what a site adds to the editor for its own boxes. The Markdown side (parse and
// print) is the pack's codec file for @markstage/core; both are named in the site's markstage config.
//
// A pack imports TipTap and ProseMirror from here (one copy for the editor and every pack) together with the
// helpers the built-in blocks use: node view base class, in-place fields, page data.
import type { AnyExtension, Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import type { Decoration, NodeViewConstructor } from '@tiptap/pm/view';
import type { PanelCtx } from './panel-form';

export { Extension, Node, mergeAttributes } from '@tiptap/core';
export type { AnyExtension, Editor, JSONContent } from '@tiptap/core';
export type { Node as PMNode } from '@tiptap/pm/model';
export { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
export type { EditorState, Transaction } from '@tiptap/pm/state';
export { liftTarget } from '@tiptap/pm/transform';
export { Decoration, DecorationSet } from '@tiptap/pm/view';
export type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view';
export { BoxView, chrome, el, field, setKind, type GetPos } from './views/base';
export { AtomView } from './views/core';
export { atomNode } from './schema';
export { activeBox, type ActiveBox } from './decorations';
export { assetUrl } from './assets';
export { svgPreview, svgBar, PREVIEW_COLORS, text, bold, p, li, ul, ol } from './builtins';
export { ic } from './icons';
export type { PanelCtx, Field, RowField } from './panel-form';

/** Labels and settings of one node type (a pack's own, or a built-in one such as `table`). */
export interface BlockUI {
  /** the node type name */
  name: string;
  /** what the writer calls it: "Side note", "Call to action" (the chip and the panel title use it) */
  label: string;
  /** a short note shown at the bottom of its settings */
  description?: string;
  /** draws its settings in the side panel; without it no panel opens for the box */
  panel?: (ctx: PanelCtx) => void;
  /** redraw the settings when this changes (default: the lengths of its array attributes) */
  panelKey?: (node: PMNode) => string;
  /** the document holds one paragraph inside it; the editor edits its text directly (one-line boxes) */
  inlineBody?: boolean;
}

/** One entry of the "+" / "/" block menu, with a small drawing. */
export interface InserterEntry {
  id: string;
  title: string;
  hint: string;
  /** the menu's section ("Text", "Boxes", …) */
  group: string;
  keywords: string;
  /** a 72x48 SVG drawing */
  preview: string;
  /** the new block in the editor's document shape; `parent` is the node type it goes into */
  make: (at: { parent: string }) => JSONContent;
}

export interface HeadCtx {
  entry: { id: string; collection: string; title: string; url: string | null; frontmatter: Record<string, unknown> };
  /** a repo path or a path relative to the entry's file -> a URL the dev server serves */
  asset: (src: string) => string;
  /** a frontmatter image path (relative to the media folder) -> a URL the dev server serves */
  media: (src: string) => string;
  /** another entry of the site (e.g. an author), or null */
  getEntry: (collection: string, id: string) => Promise<{ data?: Record<string, unknown>; frontmatter?: Record<string, unknown>; title?: string } | null>;
  /** the title, edited in place: a `tag` element with the site's `className` (use it instead of drawing the title) */
  title: (tag?: string, className?: string) => HTMLElement;
  /** makes `el` (a byline, a date, a cover) open Post settings at frontmatter key `key` when clicked */
  setting: (el: HTMLElement, key: string, label?: string) => HTMLElement;
  /**
   * the image at frontmatter key `key` (a Post settings field of type 'image') edited on the canvas: `el` is the
   * site's element holding the <img>, or null when there is none yet (a drop zone to add one is returned)
   */
  image: (el: HTMLElement | null, key: string) => HTMLElement;
  /**
   * the site's own drawing of a part of the head, when the canvas is drawn inside the entry's page (canvas.shell):
   * a copy of the page's first element matching `selector` (as last saved), or null. For what the site works out
   * and the head cannot (the reading time, the entry's groups): take the site's row and put the editable parts in it.
   */
  page: (selector: string) => HTMLElement | null;
}

/**
 * The page around the canvas, when the canvas is drawn inside the entry's page (canvas.shell): what a pack keeps
 * live there. The page is as last saved; the parts the site works out from the text (a contents list from the
 * headings, a reading time) can follow the text as it is typed. Everything here is a snapshot of now.
 */
export interface ShellCtx {
  /** why it is called: the page was drawn, the text or a setting changed, or the canvas scrolled */
  reason: 'open' | 'change' | 'scroll';
  /** the page around the canvas: the stand-in for its <html> (query the site's own parts in it) */
  root: HTMLElement;
  /** the canvas's scrolling box (the window, for the page) */
  scroller: HTMLElement;
  /** the entry, with its settings as they are now (saved, with the changes not saved yet) */
  entry: { id: string; collection: string; url: string | null; frontmatter: Record<string, unknown> };
  /** the document's headings in order: level, text, and the heading on the canvas */
  headings: { level: number; text: string; el: HTMLElement | null }[];
  /** the document's text, blocks apart (for a word count) */
  text: string;
  /** makes a part of the page clickable and focusable (the rest of the page is shown, never used). A link in it
   *  never leaves the editor: its click is the pack's to handle (scroll to a heading) */
  live: (el: HTMLElement) => void;
  /** scrolls the canvas so `el` is at its top, below what the page keeps there (its scroll-padding-top) */
  scrollTo: (el: HTMLElement) => void;
}

export interface EditorPack {
  name: string;
  /** TipTap nodes (with their node views) for the pack's boxes */
  nodes?: AnyExtension[];
  /** other TipTap extensions: editing rules, keyboard shortcuts */
  extensions?: AnyExtension[];
  blocks?: BlockUI[];
  inserter?: InserterEntry[];
  /** the document (the converter's) -> the editor's shape, per node after its children; null keeps it */
  toEditor?: (node: JSONContent) => JSONContent | null;
  /** the same for each list of children (e.g. group neighbouring items); `parent` is the holder's type */
  toEditorContent?: (content: JSONContent[], parent: string) => JSONContent[];
  /** the editor's shape -> the document, per node before its children; null keeps it, an array replaces it (a
   *  node of the same type is final: only its children are converted further) */
  toContract?: (node: JSONContent) => JSONContent[] | JSONContent | null;
  /** canvas-only decorations for one node (drawn, never saved) */
  decorate?: (node: PMNode, pos: number, out: Decoration[], state: EditorState) => void;
  /** placeholder text for an empty node, or null for the default */
  placeholder?: (node: PMNode) => string | null;
  /** the node view of tables (the site's own table wrapper) */
  tableView?: NodeViewConstructor | (new (node: PMNode) => unknown);
  /** what the canvas shows above the text (title, byline, cover), drawn with the site's classes */
  head?: (ctx: HeadCtx) => HTMLElement | Promise<HTMLElement>;
  /** keeps parts of the page around the canvas live (canvas.shell): called when the page is drawn, when the text or
   *  a setting changes (a moment after), and as the canvas scrolls */
  shell?: (ctx: ShellCtx) => void;
}

/** Checks the shape of an editor pack and returns it. */
export function defineEditorPack(pack: EditorPack): EditorPack {
  if (!pack?.name) throw new Error('An editor pack needs a name.');
  return pack;
}

let pageDataCache: Record<string, unknown> | null = null;

/** Data the site's dev integration put in the page for the packs (words, icons…; see the config's `pageData`). */
export function pageData<T = Record<string, unknown>>(): T {
  if (!pageDataCache) {
    try {
      pageDataCache = JSON.parse(document.getElementById('ms-page-data')?.textContent || '{}');
    } catch {
      pageDataCache = {};
    }
  }
  return pageDataCache as T;
}

export type { Editor as TiptapEditor };
