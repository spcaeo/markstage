// Where a Library section can go on a page, in words (place.ts puts it there; canvas-drop.ts and the outline's
// Insert… list show the places): a page whose layout is locked takes none, a locked section takes none in its middle.
import type { SectionRect } from './types';

/** The page as it is now and as its file is (a lock binds while both have it). */
export interface PageState {
  data: Record<string, unknown>;
  savedData: Record<string, unknown>;
  /** why the person may not change `path` (read-only, a role that changes some fields only), or null */
  refuse?(path: string): string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const sectionCount = (page: PageState) => (Array.isArray(page.data.sections) ? page.data.sections.length : 0);

/**
 * Why no section may be added to this page, in words, or null: the person may not change its sections (their role),
 * or the page's own `_lock` (core locks.mjs): layout (nothing added, deleted or reordered) or edit (read-only), which
 * binds while the file and the page here both have it.
 */
export function layoutLock(page: PageState): string | null {
  const role = page.refuse?.('sections');
  if (role) return role;
  const saved = page.savedData._lock;
  const now = page.data._lock;
  const holds = (k: string) => isObj(saved) && saved[k] === true && isObj(now) && now[k] === true;
  const by = isObj(now) && typeof now.by === 'string' && now.by ? now.by : 'an editor';
  if (holds('edit')) return `This page is locked by ${by}: it can't be changed.`;
  if (holds('layout')) return `The layout of this page is locked by ${by}: no section can be added, deleted or reordered.`;
  return null;
}

/** Where `index` is, in words: "at the top, before 1. Hero: …", "after 2. FAQ: …", "at the end, after 4. …". */
export function placeWords(page: PageState, index: number, label: (i: number) => string): string {
  const n = sectionCount(page);
  if (!n) return 'on the page';
  if (index <= 0) return `at the top, before ${label(0)}`;
  if (index >= n) return `at the end, after ${label(n - 1)}`;
  return `after ${label(index - 1)}`;
}

/**
 * Where a drop lands: between two sections (`index`, the line at `y`, as wide as the section it is drawn by), or
 * nowhere, with why (over `box`, if a section).
 */
export type DropTarget = { index: number; y: number; left?: number; right?: number } | { why: string; box?: SectionRect };

/**
 * Where a drop at `y` (pixels from the frame's top) lands among the sections drawn at `rects`. Nearer a section's
 * top than its bottom: before it; else after it. A locked section takes no drop in its middle, only near its edges.
 */
export function dropTarget(y: number, rects: SectionRect[], n: number, lockedWhy: (i: number) => string | null, label: (i: number) => string): DropTarget {
  if (!n) return { index: 0, y: 12 };
  const drawn = rects.filter((r) => r.index < n).sort((a, b) => a.top - b.top);
  if (!drawn.length) return { why: 'This page does not mark its sections, so it cannot show where one would land. Drop it in the Sections list instead.' };
  for (const r of drawn) {
    if (y >= r.bottom) continue;
    const locked = lockedWhy(r.index);
    const edge = Math.min(48, (r.bottom - r.top) / 4);
    if (locked && y > r.top + edge && y < r.bottom - edge) return { why: `${label(r.index)}. ${locked} Drop it above or below this section.`, box: r };
    return y < (r.top + r.bottom) / 2 ? { index: r.index, y: r.top, ...sides(r) } : { index: r.index + 1, y: r.bottom, ...sides(r) };
  }
  const last = drawn[drawn.length - 1]!;
  return { index: last.index + 1, y: last.bottom, ...sides(last) };
}

const sides = (r: SectionRect) => (r.left !== undefined && r.right !== undefined ? { left: r.left, right: r.right } : {});
