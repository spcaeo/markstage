// Pages editing (a JSON entry with sections, edited on the real rendered page): the types shared by its parts, and
// the contract with the shell that mounts it (index.ts mountPageEditor).
import type { Field } from '@markstage/core/json';

export type { Field };

/** One change, as `PUT collections/:c/entries/:id` takes it (docs/API.md "Save", json `changes`). */
export type Change =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'insert'; path: string; index: number; value: unknown }
  | { op: 'move'; path: string; from: number; to: number }
  | { op: 'duplicate'; path: string; index: number };

/** The URL state of the page editor (the shell keeps it in the hash: #/p/<collection>/<id>?sec=…&f=…&o=1&add=…). */
export interface PageParams {
  /** selected section */
  sec?: string;
  /** field open in the panel (dotted path in the entry) */
  f?: string;
  /** the outline is open */
  o?: string;
  /** the section picker is open, inserting at this index */
  add?: string;
}

/** The shell's side of the contract (host.ts): what it gives the page editor, and the handle it gets back. */
export type { PageCtx as PageHost, MountPageEditor } from '../host';
import type { PageEditor } from '../host';

/**
 * The page-level values for the shell's Page settings drawer (?s=1), shaped like its FrontmatterEdits: dotted keys
 * ("seo.title"), pending until the page is saved with everything else.
 */
export interface PageSettingsEdits {
  get(path: string): unknown;
  /** '' or null for a key the file does not have: no change; null for one it has: removes it */
  set(path: string, value: unknown): void;
  onChange(fn: (path: string | null) => void): void;
  readonly isDirty: boolean;
}

export interface PageEditorHandle extends PageEditor {
  undo(): void;
  redo(): void;
  /** the page-level values for the Page settings drawer */
  settings: PageSettingsEdits;
  /** Draws into `el` the page-level fields the drawer does not draw itself: every top-level key of the schema but
   *  the page body (`sections`), the site's hiddenFields and `skip` (keys or dotted paths, e.g. 'seo.title').
   *  Edits are pending changes like any other (⌘S, undo). Call destroy() when the drawer closes. */
  drawSettings(el: HTMLElement, skip?: string[]): { focus(path?: string): void; destroy(): void };
  /** For a recovery copy (keep.ts): the entry as last saved or opened (`base`), as it is now with the unsaved edits
   *  (`data`), and the version `base` is. Copies, safe to store. */
  snapshot(): { version: string; base: Record<string, unknown>; data: Record<string, unknown> };
  /** Shows `data` as unsaved edits on top of the open entry: one undo step, field by field, and the page is dirty
   *  (nothing happens when `data` is what is open). */
  restore(data: Record<string, unknown>): void;
  /** Called after every change (an edit, undo / redo, a fresh file); returns the function that stops it. */
  onChange(fn: () => void): () => void;
}

/** A field the page shows, as its element says (data-ms-field / data-ms-kind / data-ms-format). */
export interface BoundField {
  path: string;
  kind: 'text' | 'rich' | 'image' | 'link' | 'list';
  format?: string;
}

/** Messages between the editor and the page agent (agent.ts). Every message has a `markstage` key. */
export type ToPage =
  | { markstage: 'page:hello' }
  | { markstage: 'page:on'; values: Record<string, unknown>; locked?: string[] }
  | { markstage: 'page:values'; values: Record<string, unknown> }
  | { markstage: 'page:reveal'; path?: string; section?: number }
  | { markstage: 'page:track'; on: boolean }
  | { markstage: 'page:scroll'; by: number }
  | { markstage: 'page:off' };

/** Where a section is drawn in the frame's window (CSS pixels from its top), as the page agent measures it. */
export interface SectionRect {
  index: number;
  top: number;
  bottom: number;
  /** its sides, where the site draws sections in a column beside other things */
  left?: number;
  right?: number;
}

export type FromPage =
  | { markstage: 'page:ready'; path: string; fields: BoundField[]; sections: number[] }
  | { markstage: 'page:edit'; path: string; value: string }
  | { markstage: 'page:pick'; path: string; kind: BoundField['kind'] }
  | { markstage: 'page:section'; index: number }
  | { markstage: 'page:editing'; on: boolean }
  | { markstage: 'page:key'; key: 's' }
  | { markstage: 'page:rects'; rects: SectionRect[]; height: number }
  | { markstage: 'page:stale' };
