// The site import's mapping (docs/IMPORT.md "The mapping"): which collection each kind of source item goes to, and
// which frontmatter (or JSON) key each of its fields is written to. Every key has a default read from the site's own
// config (its title, date, author, tags and excerpt roles, its cover image setting, its SEO setting), so most imports
// need no mapping at all; the Import screen shows the defaults and lets each be changed.
//   {types: {post: 'posts', page: 'pages', product: null},       a collection id, or null to leave that kind out
//    fields: {posts: {title, date, updated, author, tags, categories, excerpt, cover, coverAlt, seoTitle,
//                     seoDescription, body, url, sections}},     a key (dotted for nested), or null to leave it out
//    onCollision: 'both' | 'skip' | 'replace',                   an address that is already taken
//    drafts: 'skip' | 'include',                                 drafts, for a collection that has no drafts
//    media: 'used' | 'all',                                      the pictures the content uses, or every one
//    slices: {<slice_type>: {section, fields}},                  Prismic slices as a JSON collection's sections
//    permalink: {post, page}}                                    Ghost's old address pattern (default /{slug}/)
import { HttpError } from '../../util.mjs';

export const ROLES = ['title', 'date', 'updated', 'author', 'tags', 'categories', 'excerpt', 'cover', 'coverAlt', 'seoTitle', 'seoDescription', 'body', 'url', 'sections'];
const KEY = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bad = (words, field) => new HttpError(422, 'invalid', words, { field });

/** The keys a collection takes by default for each source field. */
export function defaultFields(c) {
  const md = c.format === 'md';
  const img = c.images?.[0] ?? null;
  const tagFields = c.tagFields ?? [];
  return {
    title: c.fields.title,
    date: md || (c.fieldsGiven ?? []).includes('date') ? c.fields.date : null,
    updated: md || (c.fieldsGiven ?? []).includes('modified') ? c.fields.modified : null,
    author: md || (c.fieldsGiven ?? []).includes('author') ? c.fields.author : null,
    tags: md || (c.fieldsGiven ?? []).includes('tags') ? c.fields.tags : null,
    categories: tagFields.includes('categories') || md ? 'categories' : null,
    excerpt: md || (c.fieldsGiven ?? []).includes('excerpt') ? c.fields.excerpt : null,
    cover: img?.key ?? (md ? 'image' : null),
    coverAlt: img ? img.alt : md ? 'imageAlt' : null,
    seoTitle: c.seo?.title ?? null,
    seoDescription: c.seo?.description ?? null,
    body: md ? null : 'body',
    url: c.fields.url ?? null,
    sections: md ? null : 'sections',
  };
}

/** The collection a kind of item goes to when the mapping does not say. */
function defaultCollection(collections, type, kind) {
  const by = (id) => collections.find((c) => c.id === id) ?? null;
  if (by(type)) return type;
  const md = collections.filter((c) => c.format === 'md');
  if (type === 'post' || (kind === 'prismic' && /post|blog|article|news/.test(type))) return (by('posts') ?? md.find((c) => c.hasStatus) ?? md[0])?.id ?? null;
  if (type === 'page') return by('pages')?.id ?? null;
  return null;
}

/** The mapping in full: what was given, checked, over the defaults. {types, fields, onCollision, drafts, media, slices, permalink}. */
export function resolveMapping(collections, bundle, given = {}) {
  if (given !== undefined && given !== null && !isObj(given)) throw bad('The mapping is an object.', 'mapping');
  const g = given ?? {};
  const types = {};
  const kinds = [...new Set(bundle.items.map((i) => i.type))];
  for (const t of kinds) {
    const v = g.types && Object.hasOwn(g.types, t) ? g.types[t] : defaultCollection(collections, t, bundle.kind);
    if (v !== null && !collections.some((c) => c.id === v)) throw bad(`There is no collection “${v}” for the ${t} items.`, `types.${t}`);
    types[t] = v;
  }
  const fields = {};
  for (const id of new Set(Object.values(types).filter(Boolean))) {
    const c = collections.find((x) => x.id === id);
    const mine = { ...defaultFields(c) };
    const over = isObj(g.fields?.[id]) ? g.fields[id] : {};
    for (const [role, key] of Object.entries(over)) {
      if (!ROLES.includes(role)) throw bad(`“${role}” is not a field the import fills (${ROLES.join(', ')}).`, `fields.${id}.${role}`);
      if (key !== null && (typeof key !== 'string' || !KEY.test(key))) throw bad(`fields.${id}.${role} is a key such as “seo.title”, or null to leave it out.`, `fields.${id}.${role}`);
      mine[role] = key;
    }
    if (!mine.title) mine.title = c.fields.title;
    fields[id] = mine;
  }
  const pick = (k, list, dflt) => {
    const v = g[k] ?? dflt;
    if (!list.includes(v)) throw bad(`${k} is ${list.map((x) => `“${x}”`).join(' or ')}.`, k);
    return v;
  };
  const slices = isObj(g.slices) ? g.slices : {};
  for (const [t, m] of Object.entries(slices)) if (!isObj(m) || typeof m.section !== 'string') throw bad(`slices.${t} is {section, fields}.`, `slices.${t}`);
  const permalink = isObj(g.permalink) ? Object.fromEntries(['post', 'page'].filter((k) => typeof g.permalink[k] === 'string' && g.permalink[k].startsWith('/')).map((k) => [k, g.permalink[k]])) : {};
  return { types, fields, onCollision: pick('onCollision', ['both', 'skip', 'replace'], 'both'), drafts: pick('drafts', ['skip', 'include'], 'skip'), media: pick('media', ['used', 'all'], 'used'), slices, permalink };
}
