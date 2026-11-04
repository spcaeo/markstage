// Which of the fields a page says it draws the editor takes from it (security review 3 Nov 2026, S2). The page in
// the frame is the site's own: its code, a third-party tag or raw HTML in a draft runs there and can send the page
// agent's messages too, so the page's word is only a hint. A field is taken only when the editor's own schema (the
// server's, or the one read from the entry) has it inside a page section, of a kind that matches, and it is not one
// of the keys that never come from a page (code injection, status, SEO, author) or that the site keeps out of the
// editor. Text and rich text are edited in place; the other kinds only open the field in the panel.
import { fieldAt } from '@markstage/core/json';
import type { BoundField, Field } from './types';

type Data = Record<string, unknown>;

/** An object's role, as schema.ts roleOf reads it (kept here so this file has no editor imports: unit-tested in node). */
const roleOf = (f: Extract<Field, { type: 'object' }>) => f.role ?? (('src' in f.fields && 'alt' in f.fields && 'image') || ('text' in f.fields && 'href' in f.fields && 'link') || undefined);

/** Keys a page never names for the editor, at any depth: they change through their own screens, never on the page. */
const NEVER = new Set(['codeInjection', 'draft', 'publishAt', 'protected', 'seo', 'author', 'authors', '__proto__', 'prototype', 'constructor']);
/** In-place editing is for words: an address or a picture's file is set in the panel. */
const NOT_INLINE = new Set(['href', 'src', 'url', 'uri', 'id', 'discriminant']);
const IN_SECTION = /^sections\.\d+\.[A-Za-z0-9_.-]+$/;

/** May the editor take `f` from the page? (`hidden`: the site's hiddenFields.) */
export function frameFieldOk(f: BoundField, root: Field, data: Data, hidden: (path: string) => boolean): boolean {
  if (!IN_SECTION.test(f.path) || hidden(f.path)) return false;
  const segs = f.path.split('.');
  if (segs.some((s) => NEVER.has(s))) return false;
  const field = fieldAt(root, f.path, data) as Field | undefined;
  if (!field) return false;
  switch (f.kind) {
    case 'text':
    case 'rich':
      return field.type === 'text' && !NOT_INLINE.has(segs[segs.length - 1]);
    case 'image':
      return field.type === 'image' || (field.type === 'object' && roleOf(field) === 'image');
    case 'link':
      return field.type === 'url' || (field.type === 'object' && roleOf(field) === 'link');
    case 'list':
      return field.type === 'array';
    default:
      return false;
  }
}

/** The fields of a page's `page:ready` the editor takes. */
export const frameFields = (fields: BoundField[], root: Field, data: Data, hidden: (path: string) => boolean): BoundField[] =>
  fields.filter((f) => frameFieldOk(f, root, data, hidden));
