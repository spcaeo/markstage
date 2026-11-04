// Authors (docs/API-AUTHORS.md): one JSON file per author in the site's content (src/content/authors/<slug>.json by
// default), Ghost-style profiles, and the author field of an entry pointing at one of them by its slug. Pure: no file
// system, so the server, `astro dev`, the site's build helpers and the tests share it. Every side reads and writes a
// profile through the site's own keys (`fields`), so a site keeps the shape it has (often: name, designation, bio,
// avatar, seo.title, seo.description) and gains the rest (email, website, social, archived) only when it uses them.
//
//   authors: {
//     dir: 'src/content/authors',      // the folder of <slug>.json files
//     url: '/author/{slug}/',          // the author page (Person url, the admin's open link); null: no page
//     coAuthors: 'coAuthors',          // the frontmatter list of co-authors after the primary one; null: none
//     organization: 'https://example.com/#organization', // the Organization @id a Person worksFor
//     collections: ['posts'],          // whose author field names an author (default: every status collection)
//     fields: { role: 'jobTitle' },    // the file's keys, over the defaults below; null leaves one out
//   }

/** An author's slug: the file name and the value in an entry's author field. */
export const AUTHOR_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** The profile, as every side shows it, and the file key each one is kept under by default (a common shape). */
export const DEFAULT_FIELDS = Object.freeze({
  slug: 'id',
  name: 'name',
  role: 'designation',
  bio: 'bio',
  photo: 'avatar',
  email: 'email',
  website: 'website',
  social: 'social',
  seoTitle: 'seo.title',
  seoDescription: 'seo.description',
  archived: 'archived',
});
export const PROFILE_KEYS = Object.freeze(['name', 'role', 'bio', 'photo', 'email', 'website', 'social', 'seoTitle', 'seoDescription', 'archived']);
const TEXT_KEYS = ['name', 'role', 'bio', 'photo', 'email', 'website', 'seoTitle', 'seoDescription'];
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
const MAX = { name: 120, role: 200, bio: 20_000, photo: 500, email: 254, website: 500, seoTitle: 200, seoDescription: 500 };
const MAX_SOCIAL = 20;

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (data, key) => (key ? key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data) : undefined);
const str = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v));

/**
 * The site config's `authors` checked, with defaults: null when the site keeps no author files (absent or false).
 * `collections`: the site's collection ids (and whether each has a status), to check and default `collections`.
 * Already normalized config goes through unchanged, so the server may run it again.
 */
export function authorsConfigOf(raw, { collections = [], fail = (m) => { throw new Error(m); } } = {}) {
  if (raw === undefined || raw === null || raw === false) return null;
  const o = raw === true ? {} : raw;
  if (!plain(o)) fail('authors must be true or {dir, url, coAuthors, organization, collections, fields}.');
  const dir = o.dir ?? 'src/content/authors';
  if (typeof dir !== 'string' || !dir || dir.startsWith('/') || dir.split(/[\\/]/).some((p) => p === '..' || p === '.git')) fail('authors.dir must be a folder inside the project, such as "src/content/authors".');
  const url = o.url === undefined ? '/author/{slug}/' : o.url;
  if (url !== null && (typeof url !== 'string' || !url.startsWith('/') || !url.includes('{slug}'))) fail('authors.url must be a site path with {slug}, such as "/author/{slug}/", or null.');
  const coAuthors = o.coAuthors ?? null;
  if (coAuthors !== null && (typeof coAuthors !== 'string' || !KEY.test(coAuthors))) fail('authors.coAuthors must be a frontmatter key such as "coAuthors", or null.');
  const organization = o.organization ?? null;
  if (organization !== null && (typeof organization !== 'string' || !/^https?:\/\/\S+$/.test(organization))) fail('authors.organization must be the Organization @id, an address such as "https://example.com/#organization".');
  const ids = collections.map((c) => c.id);
  const list = o.collections ?? collections.filter((c) => c.hasStatus).map((c) => c.id);
  if (!Array.isArray(list) || list.some((id) => typeof id !== 'string' || !ids.includes(id))) fail(`authors.collections must list collections of this site (${ids.join(', ') || 'none yet'}).`);
  const fields = { ...DEFAULT_FIELDS };
  for (const [k, v] of Object.entries(o.fields ?? {})) {
    if (!(k in DEFAULT_FIELDS)) fail(`authors.fields.${k}: the fields are ${Object.keys(DEFAULT_FIELDS).join(', ')}.`);
    if (v === null && k !== 'name') fields[k] = null;
    else if (typeof v !== 'string' || !KEY.test(v)) fail(`authors.fields.${k} must be a key of the author file, such as "seo.title".`);
    else fields[k] = v;
  }
  return { dir: dir.replace(/\/+$/, ''), url, coAuthors, organization, collections: [...new Set(list)], fields };
}

/** The author page's address (a site path), or null when the site has none. */
export const authorUrl = (acfg, slug) => (acfg?.url ? acfg.url.replaceAll('{slug}', slug) : null);

/** A profile from an author file's data: every key there, empty ones as '' (social: [], archived: false). */
export function profileOf(acfg, slug, data) {
  const f = acfg.fields;
  const d = plain(data) ? data : {};
  const p = { slug };
  for (const k of TEXT_KEYS) p[k] = str(get(d, f[k])).trim() === '' ? '' : str(get(d, f[k]));
  const social = get(d, f.social);
  p.social = Array.isArray(social) ? social.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
  p.archived = get(d, f.archived) === true;
  if (!p.name) p.name = slug;
  return p;
}

/** What may be shown to anyone, on the site and in the editor: never the email. */
export function publicProfile(p) {
  const { email: _private, ...rest } = p;
  return rest;
}

const isUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/** A profile as asked (text trimmed, social a list): only the profile's keys; unknown ones are left out. */
export function cleanProfile(input) {
  const p = {};
  for (const k of TEXT_KEYS) if (input?.[k] !== undefined && input[k] !== null) p[k] = String(input[k]).trim();
  if (input?.social !== undefined && input.social !== null) {
    const list = Array.isArray(input.social) ? input.social : String(input.social).split(/\s*[\n,]\s*/);
    p.social = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  }
  if (input?.archived !== undefined) p.archived = input.archived === true;
  return p;
}

/** The mistakes in a (cleaned) profile, {key: words}; {} when it is fine. `whole`: name is needed (a new author). */
export function profileProblems(p, { whole = false } = {}) {
  const out = {};
  if ((whole || 'name' in p) && !p.name) out.name = 'Give the author a name.';
  for (const k of TEXT_KEYS) if (p[k] && p[k].length > MAX[k]) out[k] = `At most ${MAX[k]} characters.`;
  if (p.email && !/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(p.email)) out.email = 'This is not an email address.';
  if (p.website && !isUrl(p.website)) out.website = 'Use a full address that starts with https://.';
  if (p.social?.length > MAX_SOCIAL) out.social = `At most ${MAX_SOCIAL} links.`;
  else if (p.social?.some((s) => !isUrl(s))) out.social = `Each link must be a full address that starts with https:// (${p.social.find((s) => !isUrl(s))}).`;
  if (p.photo && /^(javascript|data|vbscript):/i.test(p.photo)) out.photo = 'Choose a picture from the media library.';
  return out;
}

/** A slug from a name: "Ana María Ruiz" -> "ana-maria-ruiz". */
export const slugOfName = (name) =>
  String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '');

/**
 * The surgical changes ({path, value} or {path, delete: true}) that make an author file hold `patch` (a cleaned
 * profile, only the keys to change), against what it holds now (`data`): an emptied value leaves the file, a key the
 * site turned off (fields.x = null) is never written, and nothing that is already so is touched.
 */
export function profileChanges(acfg, data, patch) {
  const f = acfg.fields;
  const out = [];
  for (const k of PROFILE_KEYS) {
    if (!(k in patch) || !f[k]) continue;
    const now = get(data, f[k]);
    const v = patch[k];
    const empty = v === '' || v === false || (Array.isArray(v) && !v.length);
    if (empty) {
      if (now !== undefined) out.push({ path: f[k], delete: true });
    } else if (JSON.stringify(now) !== JSON.stringify(v)) out.push({ path: f[k], value: v });
  }
  return out;
}

/** The data of a new author file: the slug key first (when the site keeps one), then the profile, nested by key. */
export function newAuthorData(acfg, slug, profile) {
  const data = {};
  if (acfg.fields.slug) setPath(data, acfg.fields.slug, slug);
  for (const ch of profileChanges(acfg, {}, profile)) if (!ch.delete) setPath(data, ch.path, ch.value);
  return data;
}

function setPath(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = plain(o[p]) ? o[p] : (o[p] = {});
  o[parts.at(-1)] = value;
}

/** The authors an entry names (its data: frontmatter or JSON): the primary one first, then its co-authors, once each. */
export function entryAuthors(acfg, authorKey, data) {
  const d = plain(data) ? data : {};
  const main = get(d, authorKey);
  const list = Array.isArray(main) ? main : main === undefined || main === null || main === '' ? [] : [main];
  const co = acfg?.coAuthors ? get(d, acfg.coAuthors) : undefined;
  if (Array.isArray(co)) list.push(...co);
  return [...new Set(list.filter((v) => v !== null && v !== undefined && v !== '').map(String))];
}

/**
 * What is wrong with the authors an entry names, against the authors there are (`known`: slug -> profile):
 * [{slug, problem: 'unknown'|'archived', message}]. `only`: the slugs to check (the ones a save changed).
 */
export function authorProblems(slugs, known, { only = null } = {}) {
  const out = [];
  for (const s of slugs) {
    if (only && !only.includes(s)) continue;
    const p = known.get(s);
    if (!p) out.push({ slug: s, problem: 'unknown', message: `“${s}” is not one of the site's authors. Pick an author, or add “${s}” as an author first.` });
    else if (p.archived) out.push({ slug: s, problem: 'archived', message: `${p.name} (“${s}”) is archived. Pick another author, or bring them back first.` });
  }
  return out;
}

/**
 * The frontmatter changes that give an entry's posts by `from` to `to` (null: just take `from` out of the
 * co-authors): {key: value}, or null when the entry does not name `from`. The primary author stays a single value
 * when it was one; `to` already a co-author is not named twice.
 */
export function reassignChanges(acfg, authorKey, data, from, to) {
  const d = plain(data) ? data : {};
  const main = get(d, authorKey);
  const co = acfg.coAuthors ? get(d, acfg.coAuthors) : undefined;
  const coList = Array.isArray(co) ? co.map(String) : [];
  const out = {};
  if (Array.isArray(main) ? main.map(String).includes(from) : String(main ?? '') === from) {
    if (Array.isArray(main)) out[authorKey] = [...new Set(main.map((v) => (String(v) === from ? to : String(v))).filter(Boolean))];
    else out[authorKey] = to;
  }
  const primaryNow = out[authorKey] ?? main;
  const primaries = Array.isArray(primaryNow) ? primaryNow.map(String) : [String(primaryNow ?? '')];
  if (coList.includes(from) || (to && coList.includes(to) && primaries.includes(to))) {
    const next = [...new Set(coList.map((v) => (v === from ? to : v)).filter((v) => v && !primaries.includes(v)))];
    if (JSON.stringify(next) !== JSON.stringify(coList)) out[acfg.coAuthors] = next.length ? next : null;
  }
  return Object.keys(out).length ? out : null;
}

const absolute = (siteUrl, u) => (!u ? null : /^https?:\/\//.test(u) ? u : siteUrl ? `${siteUrl.replace(/\/+$/, '')}${u.startsWith('/') ? '' : '/'}${u}` : u);

/**
 * schema.org Person for an author (never the email): name, url (the author page), image, jobTitle, description,
 * sameAs (website and social links) and worksFor (the site's Organization @id). `image`: the photo's address as the
 * site serves it (the build resolves pictures); `url`: the page, else the config's author page.
 */
export function personJsonLd(author, { acfg = null, siteUrl = '', url = null, image = null, organization = null, context = true } = {}) {
  const page = absolute(siteUrl, url ?? authorUrl(acfg, author.slug));
  const pic = absolute(siteUrl, image ?? (author.photo && /^(https?:\/\/|\/)/.test(author.photo) ? author.photo : null));
  const sameAs = [...new Set([author.website, ...(author.social ?? [])].filter((s) => s && isUrl(s)))];
  const org = organization ?? acfg?.organization ?? null;
  const out = {
    ...(context ? { '@context': 'https://schema.org' } : {}),
    '@type': 'Person',
    ...(page ? { '@id': page, url: page } : {}),
    name: author.name,
    ...(pic ? { image: pic } : {}),
    ...(author.role ? { jobTitle: author.role } : {}),
    ...(author.seoDescription ? { description: author.seoDescription } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(org ? { worksFor: { '@id': org } } : {}),
  };
  return out;
}
