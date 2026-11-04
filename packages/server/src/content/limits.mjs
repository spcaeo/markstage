// How long a value may be (QA F4: a 300,000-character title was accepted and written into the site's repo). The
// same numbers hold in the editor's fields (settings/fields.ts, new-entry.ts, title.ts); the server is the one
// that refuses, with the field named in plain words, whichever way the text came in.
import { HttpError } from '../util.mjs';

export const LIMITS = {
  title: 300,
  description: 500,
  name: 100, // a tag, a category, a topic name
  segment: 200, // one part of an address (a slug, each part of a page's uri)
  body: 2 * 1024 * 1024, // an entry's whole text
};

const over = (label, max) => `${label} is at most ${max.toLocaleString('en-CA')} characters.`;
const getPath = (o, key) => key.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);

/**
 * The entry text's lengths: its title, its description(s), its tags and categories, its address parts and the
 * whole text. Throws 422 `too-long` naming the first field over the line. `fields` is the entry's top-level
 * fields (store.fieldsOf); `taxonomy` the keys of its category and tag fields.
 */
export function limitsCheck(c, text, fields, { taxonomy = [] } = {}) {
  if (text.length > LIMITS.body) throw new HttpError(422, 'too-long', `This entry is too long: the limit is 2 MB of text. Split it into more pages.`, { fields: { body: over('The text', LIMITS.body) } });
  const f = c.fields;
  const bad = (key, label, max) => {
    throw new HttpError(422, 'too-long', over(label, max), { fields: { [key]: over(label, max) }, max });
  };
  const title = getPath(fields, f.title);
  if (typeof title === 'string' && title.length > LIMITS.title) bad(f.title, 'The title', LIMITS.title);
  for (const [key, label] of [[f.excerpt, 'The excerpt'], [c.seo?.description, 'The description'], [c.seo?.title, 'The search title']]) {
    const v = key ? getPath(fields, key) : undefined;
    if (typeof v === 'string' && v.length > (key === c.seo?.title ? LIMITS.title : LIMITS.description)) bad(key, label, key === c.seo?.title ? LIMITS.title : LIMITS.description);
  }
  for (const key of new Set([f.tags, ...taxonomy].filter(Boolean))) {
    const v = getPath(fields, key);
    const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    for (const item of list) if (typeof item === 'string' && item.length > LIMITS.name) bad(key, `A ${key === f.tags ? 'tag' : 'category'}`, LIMITS.name);
  }
  for (const key of [f.slug, f.url].filter(Boolean)) {
    const v = getPath(fields, key);
    if (typeof v !== 'string') continue;
    if (v.split('/').some((part) => part.length > LIMITS.segment)) bad(key, 'Each part of the address', LIMITS.segment);
  }
}

/** A plain name (a topic's, a category's): a string of at most LIMITS.name characters, or 422 naming the field. */
export function nameCheck(value, key, label) {
  if (typeof value === 'string' && value.length > LIMITS.name) throw new HttpError(422, 'too-long', over(label, LIMITS.name), { fields: { [key]: over(label, LIMITS.name) }, max: LIMITS.name });
}
