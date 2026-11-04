// The schema descriptor: a framework-neutral description of an entry's fields, as plain JSON, that the editor draws
// forms from and the JSON engine reads for key order, new-item defaults and field kinds. An adapter builds it from
// a site's CMS config (adapters/keystatic.mjs); nothing here knows any CMS.
//
// Field = one of
//   { type: 'text', label?, description?, multiline?, rich? }          rich = the text is HTML
//   { type: 'number', label?, integer? }   { type: 'checkbox', label?, default }
//   { type: 'select', label?, options: [{ label, value }], default }
//   { type: 'relationship', label?, collection }                        value = the other entry's slug
//   { type: 'image', label?, directory? }   { type: 'url' | 'date' | 'datetime', label? }
//   { type: 'object', label?, role?: 'image' | 'link', fields: { [key]: Field } }   (key order = file order)
//   { type: 'array', label?, item: Field }
//   { type: 'conditional', label?, discriminant: Field, values: { [option]: Field },
//     storage: { discriminant: 'discriminant', value: 'value' } }        stored as { discriminant, value }
//   { type: 'slug' | 'content' | 'ignored', label? }  { type: 'custom', label?, default? }  (shown read-only/raw)
//
// Schema = { version: 1, source, collections: { [name]: { label?, path, format, slugField?, entry: Field } },
//            singletons: { [name]: { label?, path, format, entry: Field } } }

import { toPath } from './path.mjs';

export const SCHEMA_VERSION = 1;

/**
 * The field that describes `path` inside an entry whose root field is `root`. `value` (the entry's data) is needed
 * to pick a conditional's branch. Undefined when the path leaves the schema.
 * @param {any} root
 * @param {string | (string|number)[]} path
 * @param {any} [value]
 */
export function fieldAt(root, path, value) {
  let field = root;
  let data = value;
  for (const seg of toPath(path)) {
    if (!field) return undefined;
    if (field.type === 'object') {
      field = field.fields?.[seg];
      data = data?.[seg];
    } else if (field.type === 'array') {
      if (typeof seg !== 'number') return undefined;
      field = field.item;
      data = data?.[seg];
    } else if (field.type === 'conditional') {
      const keys = field.storage ?? { discriminant: 'discriminant', value: 'value' };
      if (seg === keys.discriminant) {
        field = field.discriminant;
        data = data?.[seg];
      } else if (seg === keys.value) {
        const branch = data?.[keys.discriminant];
        field = branch === undefined ? undefined : field.values?.[branch];
        data = data?.[seg];
      } else return undefined;
    } else return undefined;
  }
  return field;
}

/**
 * How the page binds a field (`data-ms-kind`): text and rich edit inline, image/link/list in the side panel.
 * @param {any} field
 * @returns {'text' | 'rich' | 'image' | 'link' | 'list' | undefined}
 */
export function bindingKind(field) {
  if (!field) return undefined;
  if (field.type === 'text') return field.rich ? 'rich' : 'text';
  if (field.type === 'image' || (field.type === 'object' && field.role === 'image')) return 'image';
  if (field.type === 'url' || (field.type === 'object' && field.role === 'link')) return 'link';
  if (field.type === 'array') return 'list';
  return undefined;
}

/** The keys of an object field in the order its tool writes them. */
export function keyOrder(field) {
  return field?.type === 'object' ? Object.keys(field.fields ?? {}) : undefined;
}

/**
 * A new value for `field` (a new list item, a new section), with every key its tool would write.
 * @param {any} field
 * @param {string} [branch] for a conditional: which option (default: the discriminant's default)
 */
export function defaultValue(field, branch) {
  if (!field) return undefined;
  switch (field.type) {
    case 'text':
    case 'url':
    case 'date':
    case 'datetime':
    case 'slug':
      return '';
    case 'number':
    case 'relationship':
    case 'image':
      return null;
    case 'checkbox':
      return field.default ?? false;
    case 'select':
      return field.default ?? field.options?.[0]?.value ?? null;
    case 'array':
      return [];
    case 'object':
      return Object.fromEntries(Object.entries(field.fields ?? {}).map(([k, f]) => [k, defaultValue(f)]));
    case 'conditional': {
      const keys = field.storage ?? { discriminant: 'discriminant', value: 'value' };
      const pick = branch ?? defaultValue(field.discriminant);
      if (!(pick in (field.values ?? {}))) throw new Error(`no conditional option "${pick}"`);
      return { [keys.discriminant]: pick, [keys.value]: defaultValue(field.values[pick]) };
    }
    case 'custom':
      return field.default === undefined ? null : structuredClone(field.default);
    default:
      return undefined;
  }
}

/**
 * `value` as its tool would store it: object keys in schema order (keys the schema does not know keep their place
 * after the known ones), and members the policy omits (e.g. Keystatic leaves out empty text) dropped.
 * @param {unknown} value
 * @param {any} field
 * @param {{ omit?: (value: unknown, field: any) => boolean }} [policy]
 */
export function normalize(value, field, policy) {
  if (value === null || typeof value !== 'object' || !field) return value;
  if (Array.isArray(value)) return field.type === 'array' ? value.map((v) => normalize(v, field.item, policy)) : value;
  if (field.type === 'conditional') {
    const keys = field.storage ?? { discriminant: 'discriminant', value: 'value' };
    const branch = /** @type {any} */ (value)[keys.discriminant];
    return { [keys.discriminant]: branch, [keys.value]: normalize(/** @type {any} */ (value)[keys.value], field.values?.[branch], policy) };
  }
  if (field.type !== 'object') return value;
  const known = Object.keys(field.fields ?? {});
  const keys = [...known.filter((k) => k in value), ...Object.keys(value).filter((k) => !known.includes(k))];
  const out = {};
  for (const k of keys) {
    const f = field.fields?.[k];
    const v = normalize(/** @type {any} */ (value)[k], f, policy);
    if (v === undefined || policy?.omit?.(v, f)) continue;
    out[k] = v;
  }
  return out;
}
