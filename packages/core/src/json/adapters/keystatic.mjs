// Keystatic adapter: builds a Markstage schema descriptor (../schema.mjs) from a site's Keystatic config, and the
// save policy that makes the JSON engine write files the way Keystatic's own "Save" does.
//
//   import config from '<site>/keystatic.config.ts';          (plain Node 22+ imports it; or loadKeystaticSchema)
//   const schema = keystaticSchema(config, { rich: (f) => /\(HTML\)/.test(f.label) });
//   const entry = JsonEntry.parse(text, { schema: schema.collections.pages.entry, policy: keystaticPolicy });
//
// Keystatic does not expose everything as data, so some of it is read from how a field behaves:
// - text, integer, number and relationship are all `kind: 'form'`; they differ by default value ('' or null) and
//   by which validator the field's validate() calls (validateInteger / validateNumber / assertRequired).
// - Whether text is multiline, holds HTML or a URL, or which collection a relationship points at is not readable;
//   the site says so with the `multiline`, `rich`, `url` and `collections` options (by field, label or dotted path).
// - An object with { src, alt } is an image and one with { href, text } a link (roles the editor uses to show a
//   picker; other keys may sit beside them, e.g. a button's `external`); `roles` adds other shapes.
//
// What Keystatic writes, matched by keystaticPolicy: object keys in schema order; empty text and empty
// integer / number / relationship values are left out; checkboxes, selects, empty arrays and empty objects ({})
// are written; a conditional is { "discriminant": kind, "value": {...} }; a slug field that is the file name
// (slugField) is not stored.

import { SCHEMA_VERSION } from '../schema.mjs';

/**
 * @typedef {object} KeystaticOptions
 * @property {(field: any, path: string) => boolean} [rich]       text whose value is HTML
 * @property {(field: any, path: string) => boolean} [multiline]  text edited in a text area
 * @property {(field: any, path: string) => boolean} [url]        text that holds a URL or site path
 * @property {(field: any, path: string) => string | undefined} [collections]  a relationship's collection
 * @property {Record<string, string[]>} [roles]  extra object roles: { role: [keys] } (an object that has all these keys)
 */

const ROLES = { image: ['src', 'alt'], link: ['href', 'text'] };

const src = (fn) => (typeof fn === 'function' ? Function.prototype.toString.call(fn) : '');
const call = (fn) => {
  try {
    return typeof fn === 'function' ? fn() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The Markstage schema descriptor for a Keystatic config.
 * @param {any} config the default export of keystatic.config.ts
 * @param {KeystaticOptions} [options]
 */
export function keystaticSchema(config, options = {}) {
  const roles = { ...ROLES, ...(options.roles ?? {}) };
  const out = { version: SCHEMA_VERSION, source: 'keystatic', collections: {}, singletons: {} };
  for (const [name, c] of Object.entries(config.collections ?? {})) {
    const entry = describeObject(c.schema, name, options, roles, c.slugField);
    out.collections[name] = clean({ label: c.label, path: c.path, format: c.format ?? { data: 'yaml' }, slugField: c.slugField, entry });
  }
  for (const [name, s] of Object.entries(config.singletons ?? {})) {
    out.singletons[name] = clean({ label: s.label, path: s.path, format: s.format ?? { data: 'yaml' }, entry: describeObject(s.schema, name, options, roles) });
  }
  return out;
}

/** Imports a keystatic.config.(ts|js|mjs) file and describes it. */
export async function loadKeystaticSchema(configFile, options) {
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(configFile).href);
  return keystaticSchema(mod.default ?? mod, options);
}

function describeObject(fields, path, options, roles, slugField) {
  const out = {};
  for (const [key, f] of Object.entries(fields ?? {})) {
    const d = describe(f, `${path}.${key}`, options, roles);
    // the file-name slug: Keystatic stores it only when its serialize() returns a value
    if (key === slugField && d.type === 'slug') d.stored = call(() => f.serialize({ name: 'x', slug: 'x' }))?.value !== undefined;
    out[key] = d;
  }
  return { type: 'object', fields: out };
}

/** One Keystatic field as a Markstage field. `path` is dotted, with "*" for array items ("pages.sections.*.value.heading"). */
export function describe(f, path, options = {}, roles = ROLES) {
  const label = f.label;
  if (f.kind === 'object') {
    const obj = describeObject(f.fields, path, options, roles);
    const keys = Object.keys(obj.fields);
    const role = Object.entries(roles).find(([, want]) => want.every((k) => keys.includes(k)))?.[0];
    return clean({ ...obj, label, role });
  }
  if (f.kind === 'array') return clean({ type: 'array', label, item: describe(f.element, `${path}.*`, options, roles) });
  if (f.kind === 'conditional') {
    const values = Object.fromEntries(Object.entries(f.values).map(([k, v]) => [k, describe(v, `${path}.value`, options, roles)]));
    return clean({ type: 'conditional', label, discriminant: describe(f.discriminant, `${path}.discriminant`, options, roles), values, storage: { discriminant: 'discriminant', value: 'value' } });
  }
  if (f.kind === 'child') return clean({ type: 'content', label });
  if (f.kind !== 'form') return clean({ type: 'custom', label });

  const dv = call(f.defaultValue);
  const v = src(f.validate);
  if (f.formKind === 'content') return clean({ type: 'content', label, extension: f.contentExtension });
  if (f.formKind === 'asset' || f.formKind === 'assets') return clean({ type: 'image', label, directory: f.directory, publicPath: f.publicPath });
  if (Array.isArray(f.options)) return clean({ type: 'select', label, options: f.options.map((o) => ({ label: o.label, value: o.value })), default: dv });
  if (typeof dv === 'boolean') return clean({ type: 'checkbox', label, default: dv });
  if (dv === '' && options.url?.(f, path)) return clean({ type: 'url', label });
  if (dv === '') {
    const rich = options.rich?.(f, path) || undefined;
    const multiline = options.multiline?.(f, path) || rich;
    return clean({ type: 'text', label, multiline: multiline || undefined, rich });
  }
  if (dv === null && /validateInteger/.test(v)) return clean({ type: 'number', label, integer: true });
  if (dv === null && /validateNumber/.test(v)) return clean({ type: 'number', label });
  if (dv === null) return clean({ type: 'relationship', label, collection: options.collections?.(f, path) });
  if (Array.isArray(dv) && dv.length === 0 && /Must be an array of strings/.test(src(f.parse))) {
    return clean({ type: 'relationship', label, multiple: true, collection: options.collections?.(f, path) });
  }
  if (dv && typeof dv === 'object' && 'slug' in dv && 'name' in dv) return clean({ type: 'slug', label });
  // fields.ignored(): kept as stored, never shown; its default is { value: undefined }
  if (label === 'Ignored' && dv && typeof dv === 'object' && Object.keys(dv).every((k) => k === 'value' && dv[k] === undefined)) return { type: 'ignored' };
  return clean({ type: 'custom', label, default: dv });
}

function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

const OMIT_EMPTY = new Set(['text', 'url', 'date', 'datetime', 'image', 'slug']);
const OMIT_NULL = new Set(['number', 'relationship', 'image']);

/** The JSON engine's save policy for Keystatic: what Keystatic leaves out of the file. */
export const keystaticPolicy = Object.freeze({
  omit(value, field) {
    if (!field) return false;
    if (field.type === 'slug' && field.stored === false) return true;
    if (value === '' && OMIT_EMPTY.has(field.type)) return true;
    if (value === null && OMIT_NULL.has(field.type)) return true;
    // a custom form field with nothing set (e.g. an all-empty object) writes no key
    if (field.type === 'custom' && value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return true;
    return false;
  },
});
