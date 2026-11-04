// The fields of the open page: the collection's schema from the server (core's descriptor), or, when the server
// has none, one read from the entry itself (strings, numbers, lists, image and link shapes, sections by kind) so
// the panel still works. Plus the questions the editor asks of it: a field's label, a section's kind and title.
import { defaultValue, fieldAt } from '@markstage/core/json';
import type { Field } from './types';

type Data = Record<string, unknown>;
const isObject = (v: unknown): v is Data => v !== null && typeof v === 'object' && !Array.isArray(v);
const HTML = /<\/?[a-z][^>]*>|&[a-z#0-9]+;/i;

/** A field descriptor inferred from a value (the fallback schema). */
export function inferField(value: unknown, key = ''): Field {
  if (typeof value === 'boolean') return { type: 'checkbox', default: false };
  if (typeof value === 'number') return { type: 'number' };
  if (Array.isArray(value)) {
    const objects = value.filter(isObject);
    if (objects.length && objects.every((o) => 'discriminant' in o && 'value' in o)) return inferConditional(objects);
    return { type: 'array', item: objects.length ? mergeObjects(objects) : inferField(value[0] ?? '', key) };
  }
  if (isObject(value)) return mergeObjects([value]);
  const s = typeof value === 'string' ? value : '';
  return { type: 'text', rich: HTML.test(s), multiline: s.length > 80 || /\n/.test(s) || /(html|body|lead|quote|answer|note)$/i.test(key) };
}

function mergeObjects(list: Data[]): Field {
  const fields: Record<string, Field> = {};
  for (const o of list) for (const [k, v] of Object.entries(o)) if (!(k in fields) || (fields[k].type === 'text' && typeof v === 'string' && HTML.test(v))) fields[k] = inferField(v, k);
  const keys = Object.keys(fields);
  const role = keys.includes('src') && keys.includes('alt') ? 'image' : keys.includes('href') && keys.includes('text') ? 'link' : undefined;
  return { type: 'object', ...(role ? { role } : {}), fields };
}

function inferConditional(list: Data[]): Field {
  const byKind = new Map<string, Data[]>();
  for (const s of list) {
    const k = String(s.discriminant);
    byKind.set(k, [...(byKind.get(k) ?? []), isObject(s.value) ? s.value : {}]);
  }
  const values = Object.fromEntries([...byKind].map(([k, vs]) => [k, mergeObjects(vs)]));
  const options = [...byKind.keys()].sort().map((k) => ({ label: k, value: k }));
  return { type: 'array', item: { type: 'conditional', discriminant: { type: 'select', options, default: options[0]?.value }, values } };
}

/** Text stored as HTML: marked rich, or labelled "(HTML)" (Keystatic has no rich flag on a text field). */
export const isHtml = (field: Field) => field.type === 'text' && (field.rich === true || /\(HTML\)\s*$/i.test(field.label ?? ''));

/** An object's role: as the schema says, else by its keys (src + alt: an image; text + href: a link). */
export function roleOf(field: Extract<Field, { type: 'object' }>): string | undefined {
  if (field.role) return field.role;
  const keys = Object.keys(field.fields);
  if (keys.includes('src') && keys.includes('alt')) return 'image';
  if (keys.includes('text') && keys.includes('href')) return 'link';
  return undefined;
}

/** The entry's root field: the server's schema, else one inferred from the data. */
export const rootField = (schema: Field | null, data: Data): Field => schema ?? inferField(data);

export const fieldOf = (root: Field, path: string, data: Data): Field | undefined => fieldAt(root, path, data);

/** The section list's item field (a conditional: kind + value), if the entry has sections. */
export function sectionField(root: Field, data: Data): Extract<Field, { type: 'conditional' }> | undefined {
  const list = fieldAt(root, 'sections', data);
  return list?.type === 'array' && list.item.type === 'conditional' ? list.item : undefined;
}

/** The section kinds a writer can add, in the schema's order. */
export function sectionKinds(root: Field, data: Data): string[] {
  const f = sectionField(root, data);
  return f ? Object.keys(f.values) : [];
}

/** A new section of `kind`, with every key its tool writes. */
export function newSection(root: Field, data: Data, kind: string): unknown {
  const f = sectionField(root, data);
  return f ? defaultValue(f, kind) : { discriminant: kind, value: {} };
}

/** A new list item for the list field at `path`. */
export function newItem(root: Field, path: string, data: Data): unknown {
  const f = fieldAt(root, path, data);
  if (f?.type !== 'array') return '';
  const v = defaultValue(f.item);
  return v === undefined ? '' : v;
}

/** "contact-forms" / "useCases" / "issuerUrl" -> "Contact forms" / "Use cases" / "Issuer url" */
export function humanize(key: string): string {
  const s = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  const words = s.split(' ').map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  const out = words.join(' ');
  return out ? out[0].toUpperCase() + out.slice(1) : key;
}
const ACRONYMS = new Set(['faq', 'cta', 'seo', 'url', 'html', 'id', 'api', 'pdf']);

export const labelOf = (field: Field | undefined, key: string | number) =>
  field?.label?.replace(/\s*\((HTML|Markdown)\)\s*$/i, '') || (typeof key === 'number' ? `Item ${key + 1}` : humanize(key));

/** Plain text of a stored value (HTML stripped), for a row's title. */
export function plain(v: unknown, max = 80): string {
  if (typeof v !== 'string') return '';
  const t = v
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#?\w+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** A list item's title: its first text-like field that has a value. */
export function itemTitle(item: unknown): string {
  if (typeof item === 'string') return plain(item);
  if (!isObject(item)) return '';
  for (const k of ['title', 'heading', 'name', 'q', 'text', 'item', 'quote', 'alt', 'id', 'href']) if (plain(item[k])) return plain(item[k]);
  // a block of rich text: its first heading, else its first words (not a setting such as its variant)
  if (typeof item.html === 'string') {
    const head = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(item.html);
    if (head && plain(head[1])) return plain(head[1]);
    if (plain(item.html)) return plain(item.html);
  }
  for (const v of Object.values(item)) if (plain(v)) return plain(v);
  return '';
}
