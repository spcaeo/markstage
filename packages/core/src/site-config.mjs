// The site's markstage.config (.mjs, .js or .ts at the project root): collections, block packs, editor canvas.
// One loader for both sides: the Astro integration (re-exported as @markstage/astro/config) and the Markstage
// server (@markstage/core/site-config) read the site's config through it. Node only (node:fs, node:path). A
// collection's `url` and `group` may be templates or functions of the entry: urlOf() and groupOf() apply them.
//
//   export default defineConfig({
//     siteName: 'My blog',
//     collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', url: '/blog/{id}/' }],
//     compat: { collection: 'posts' },
//     editor: { css: ['./src/styles/global.css'], canvas: { articleClass: 'post', bodyClass: 'prose' }, packs: [] },
//   });
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorsConfigOf, PROFILE_KEYS } from './authors.mjs';
import { framesConfigOf, pageTypesClientConfig, pageTypesConfigOf } from './page-types.mjs';
import { topicsClientConfig, topicsConfigOf } from './topics.mjs';
import { editButtonOf } from './edit-button.mjs';

const COLLECTION_ID = /^[a-z][a-z0-9-]{0,39}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
/** Post settings field types (packages/editor/src/settings): what each needs besides a label. */
const SETTING_TYPES = {
  text: ['key'],
  textarea: ['key'],
  slug: ['key'],
  date: ['key'],
  tags: ['key'],
  select: ['key'],
  image: ['key'],
  // an author picked from the site's authors (config `authors`), with co-authors when the site keeps them
  author: ['key'],
  // on or off (a checkbox); the key is written only when it is not the field's `default`
  switch: ['key'],
  seo: ['title', 'description'],
  social: ['title', 'description', 'image'],
};

/**
 * The Post settings fields of a collection: the config's `settings`, or a few from its `fields`. With author files
 * (`authors`, for this collection) the author field picks one of them: a text or select setting of the author key
 * becomes an `author` field, with the co-authors key when the site keeps one.
 */
function settingsOf(c, fields, authors) {
  const list =
    c.settings ??
    [
      fields.slug && { type: 'slug', key: fields.slug, label: 'URL slug' },
      fields.excerpt && { type: 'textarea', key: fields.excerpt, label: 'Excerpt' },
      fields.tags && { type: 'tags', key: fields.tags, label: 'Tags' },
      fields.author && { type: 'text', key: fields.author, label: 'Author' },
      fields.date && { type: 'date', key: fields.date, label: 'Publish date' },
    ].filter(Boolean);
  if (!Array.isArray(list)) fail(`collection "${c.id}": settings must be a list.`);
  const picks = authors?.collections.includes(c.id);
  return list.map((f, i) => {
    if (picks && f && f.key === fields.author && (f.type === 'text' || f.type === 'select')) f = { type: 'author', key: f.key, label: f.label ?? 'Author', ...(f.hint ? { hint: f.hint } : {}) };
    if (f?.type === 'author') {
      if (!picks) fail(`collection "${c.id}" settings[${i}]: an author field needs authors (config \`authors\`) for this collection.`);
      f = { ...f, coAuthors: authors.coAuthors };
    }
    const where = `collection "${c.id}" settings[${i}]`;
    const needs = SETTING_TYPES[f?.type];
    if (!needs) fail(`${where}: type must be one of ${Object.keys(SETTING_TYPES).join(', ')}.`);
    for (const k of needs) if (typeof f[k] !== 'string' || !KEY.test(f[k])) fail(`${where}: ${k} must be a frontmatter key such as "seo.title".`);
    for (const k of ['alt', 'image', 'focal', 'altFallback', 'keyphrase']) if (f[k] !== undefined && (typeof f[k] !== 'string' || !KEY.test(f[k]))) fail(`${where}: ${k} must be a frontmatter key.`);
    if (f.clears !== undefined && !(Array.isArray(f.clears) && f.clears.every((k) => typeof k === 'string' && KEY.test(k)))) fail(`${where}: clears must be a list of keys.`);
    if (f.from !== undefined && typeof f.from !== 'string') fail(`${where}: from must be a collection id.`);
    if (f.default !== undefined && f.type === 'switch' && typeof f.default !== 'boolean') fail(`${where}: default must be true or false.`);
    if (f.options !== undefined && !(Array.isArray(f.options) && f.options.every((o) => Array.isArray(o) && o.length === 2))) fail(`${where}: options must be [value, label] pairs.`);
    return { ...f, label: String(f.label ?? (f.type === 'seo' ? 'Search engines' : f.type === 'social' ? 'Social card' : f.key)) };
  });
}

/**
 * The search title and description keys of a collection ({title, description}, either may be null), or null: its
 * `seo` setting. A JSON collection (pages edited as sections) has no Post settings drawer, but may name its `seo`
 * setting for the publish checks, Health and the suggestions to read: that is the only setting it takes.
 */
function seoOf(c, collection) {
  if (collection.format === 'md') {
    const f = collection.settings.find((x) => x.type === 'seo');
    return f ? { title: f.title ?? null, description: f.description ?? null } : null;
  }
  if (c.settings === undefined) return null;
  if (!Array.isArray(c.settings)) fail(`collection "${c.id}": settings must be a list.`);
  let out = null;
  c.settings.forEach((f, i) => {
    const where = `collection "${c.id}" settings[${i}]`;
    if (f?.type !== 'seo') fail(`${where}: a JSON collection takes only an seo setting (its search title and description keys); the Post settings drawer is for Markdown.`);
    if (out) fail(`${where}: one seo setting only.`);
    for (const k of SETTING_TYPES.seo) if (typeof f[k] !== 'string' || !KEY.test(f[k])) fail(`${where}: ${k} must be a key such as "seo.title".`);
    out = { title: f.title, description: f.description };
  });
  return out;
}

/** editor.links: special links offered first in the link search, and the rule for links that open a popup. */
function linksOf(links, abs) {
  if (links === undefined || links === null) return { special: [], popup: null, module: null };
  if (typeof links === 'string') return { special: [], popup: null, module: abs(links, 'editor.links') };
  const special = (links.special ?? []).map((l, i) => {
    if (typeof l?.href !== 'string' || typeof l?.label !== 'string') fail(`editor.links.special[${i}] needs href and label.`);
    return { href: l.href, label: l.label };
  });
  const p = links.popup;
  if (p && (typeof p.selector !== 'string' || !p.selector)) fail('editor.links.popup.selector must be a CSS selector.');
  return { special, popup: p ? { selector: p.selector, note: String(p.note ?? 'Opens a popup on the site') } : null, module: null };
}
const CLASS_TOKEN = /^[a-z][a-z0-9_-]*$/;

const CARD_FIELDS = ['title', 'description', 'image', 'tag', 'date'];
/**
 * editor.linkCards: the site's own preview data for its links (the card a visitor sees on hover), shown when the
 * writer hovers a link on the canvas: `'/link-cards.json'` (an address on the site, a JSON object keyed by page
 * path), or `{url, fields}` when its entries use other names (fields: {title: 't', description: 'e', …}).
 * Without it the card shows what the editor knows of the page (its title, excerpt and group).
 */
function linkCardsOf(raw) {
  if (raw === undefined || raw === null) return null;
  const o = typeof raw === 'string' ? { url: raw } : raw;
  if (typeof o?.url !== 'string' || !/^\/[^/]/.test(o.url)) fail('editor.linkCards must be a site path such as "/link-cards.json" (or {url, fields}).');
  const fields = Object.fromEntries(CARD_FIELDS.map((k) => [k, k]));
  for (const [k, v] of Object.entries(o.fields ?? {})) {
    if (!CARD_FIELDS.includes(k)) fail(`editor.linkCards.fields.${k}: the fields are ${CARD_FIELDS.join(', ')}.`);
    if (typeof v !== 'string' || !v) fail(`editor.linkCards.fields.${k} must be the key the data uses.`);
    fields[k] = v;
  }
  return { url: o.url, fields };
}

/**
 * editor.images: the widths an image may take (the first is the default and writes no class; the others write their
 * class on the image's <figure>), whether images get captions, and the figure class that marks a decorative image.
 */
function imagesOf(images = {}) {
  const widths = images.widths ?? [{ id: 'normal', label: 'Normal' }];
  if (!Array.isArray(widths) || !widths.length) fail('editor.images.widths must be a list of {id, label, class?}.');
  const ids = new Set();
  const out = widths.map((w, i) => {
    if (typeof w?.id !== 'string' || !CLASS_TOKEN.test(w.id) || ids.has(w.id)) fail(`editor.images.widths[${i}].id must be a unique lowercase name.`);
    ids.add(w.id);
    if (i > 0 && (typeof w.class !== 'string' || !CLASS_TOKEN.test(w.class))) fail(`editor.images.widths[${i}].class must be the figure class the site styles, e.g. "wide".`);
    return { id: w.id, label: String(w.label ?? w.id), class: i === 0 ? null : w.class };
  });
  const decorative = images.decorativeClass ?? 'decorative';
  if (!CLASS_TOKEN.test(decorative)) fail('editor.images.decorativeClass must be a class name.');
  return { widths: out, captions: images.captions !== false, decorativeClass: decorative };
}

function requiredOf(c) {
  const list = c.required ?? [];
  if (!Array.isArray(list) || list.some((k) => typeof k !== 'string' || !KEY.test(k))) fail(`collection "${c.id}": required must be a list of frontmatter keys such as "seo.title".`);
  const f = { title: 'title', slug: null, ...(c.fields ?? {}) };
  return [...new Set([f.title, f.slug, ...list].filter(Boolean))];
}

/** linkKeys: keys of a menu item that name an entry by its id alone, and the collection it is in ({page: 'pages'}). */
function linkKeysOf(c) {
  const k = c.linkKeys ?? {};
  if (typeof k !== 'object' || Array.isArray(k) || Object.entries(k).some(([key, col]) => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || ['label', 'href', 'entry', 'children'].includes(key) || typeof col !== 'string'))
    fail(`collection "${c.id}": linkKeys must map an item key to a collection, such as {page: "pages"}.`);
  return { ...k };
}

const LOCK_WHAT = ['move', 'remove', 'edit'];
/**
 * locks: the site's own rules (docs/OPERATIONS.md "Locks"), by kind of block: `pages` names page sections by their
 * type, `articles` names an article's boxes by their block name. Each says what can't be done to every such block.
 */
function locksOf(locks) {
  if (locks === undefined || locks === null) return { pages: {}, articles: {} };
  const bad = () => fail('locks must be {pages: {<section type>: ["move", "remove", "edit"]}, articles: {<box>: [...]}}.');
  if (typeof locks !== 'object' || Array.isArray(locks)) bad();
  const out = { pages: {}, articles: {} };
  for (const [where, rules] of Object.entries(locks)) {
    if (!(where in out) || !rules || typeof rules !== 'object' || Array.isArray(rules)) bad();
    for (const [type, what] of Object.entries(rules)) {
      if (!Array.isArray(what) || !what.length || what.some((w) => !LOCK_WHAT.includes(w))) bad();
      out[where][type] = Object.fromEntries(LOCK_WHAT.filter((w) => what.includes(w)).map((w) => [w, true]));
    }
  }
  return out;
}

const AUTHOR_SLUG = /^[a-z0-9][a-z0-9-]*$/;
/** defaultAuthor: the author slug a new entry gets when its maker has none (the server's rule, docs/API.md). */
function defaultAuthorOf(c) {
  if (c.defaultAuthor === undefined || c.defaultAuthor === null) return null;
  if (typeof c.defaultAuthor !== 'string' || !AUTHOR_SLUG.test(c.defaultAuthor)) fail(`collection "${c.id}": defaultAuthor must be an author slug such as "site-team".`);
  return c.defaultAuthor;
}

/**
 * newEntry: what making a new entry asks and writes. `ask`: the Post settings keys the "New" sheet asks for besides
 * the title (what the site's schema needs and nothing can guess, e.g. a topic); `defaults({title, id, collection,
 * values, user, now})`: the frontmatter the new file starts with (dates, an SEO title from the title …); the asked
 * values and the title are written over it. A bare function is `defaults` with nothing to ask.
 */
function newEntryOf(c, n) {
  const raw = c.newEntry;
  if (raw === undefined || raw === null) return null;
  const o = typeof raw === 'function' ? { defaults: raw } : raw;
  if (typeof o !== 'object' || (o.defaults !== undefined && typeof o.defaults !== 'function')) fail(`collection "${c.id}": newEntry must be a function or {ask, defaults}.`);
  const ask = (o.ask ?? []).map((key, i) => {
    if (typeof key !== 'string' || !n.settings.some((f) => f.key === key)) fail(`collection "${c.id}": newEntry.ask[${i}] must be the key of one of its settings.`);
    return key;
  });
  return { ask, defaults: o.defaults ?? null };
}

/**
 * groups: the entries of this collection sorted into the entries of another (topic clusters), each group listing its
 * own order. `field`: the setting that names the group (`cluster`); `collection`: the groups' collection (`clusters`);
 * `order`: the key in a group's entry that lists entry ids first in that order, the rest after, newest first;
 * `label`: what the Groups screen calls them ("Topics"). Checked once every collection is known.
 */
function groupsOf(c, n, ids) {
  const g = c.groups;
  if (g === undefined || g === null) return null;
  const where = `collection "${c.id}": groups`;
  if (typeof g !== 'object' || Array.isArray(g)) fail(`${where} must be {field, collection, order, label?}.`);
  if (typeof g.field !== 'string' || !n.settings.some((f) => f.key === g.field)) fail(`${where}.field must be the key of one of its settings.`);
  if (typeof g.collection !== 'string' || !ids.has(g.collection)) fail(`${where}.collection names ${JSON.stringify(g.collection)}, which is not a collection.`);
  if (g.collection === c.id) fail(`${where}.collection must be another collection.`);
  if (typeof g.order !== 'string' || !KEY.test(g.order)) fail(`${where}.order must be a key such as "order".`);
  if (g.label !== undefined && (typeof g.label !== 'string' || !g.label.trim())) fail(`${where}.label must be a word such as "Topics".`);
  return { field: g.field, collection: g.collection, order: g.order, label: g.label?.trim() ?? 'Groups' };
}

/**
 * gallery: the section gallery's view of a JSON collection (#/gallery, docs/API-EDIT.md): `field`, the
 * list of page sections (default "sections"); `variant`, the key inside a section's value that names its variation
 * (none by default: one sample per type). `false` leaves the collection out.
 */
function galleryOf(c) {
  const g = c.gallery;
  if (g === undefined || g === null) return c.format === 'json' ? { field: 'sections', variant: null } : null;
  if (g === false) return null;
  const where = `collection "${c.id}": gallery`;
  if (c.format !== 'json') fail(`${where} needs a JSON collection (one with page sections).`);
  if (typeof g !== 'object' || Array.isArray(g)) fail(`${where} must be {field?, variant?} or false.`);
  if (g.field !== undefined && (typeof g.field !== 'string' || !KEY.test(g.field))) fail(`${where}.field must be a key such as "sections".`);
  if (g.variant !== undefined && (typeof g.variant !== 'string' || !KEY.test(g.variant))) fail(`${where}.variant must be a key such as "variant".`);
  return { field: g.field ?? 'sections', variant: g.variant ?? null };
}

/**
 * themes: the colour schemes the site can draw besides its default, and how its page is switched to one: an attribute
 * on <html> (`{attr: 'data-theme', value: 'dark'}`), or a class (`{attr: 'class', value: 'dark'}`). The screen check
 * offers each one (?theme=). Only `dark` for now.
 */
function themesOf(themes) {
  if (themes === undefined || themes === null) return {};
  if (typeof themes !== 'object' || Array.isArray(themes)) fail('themes must be an object such as {dark: {attr: "data-theme", value: "dark"}}.');
  const out = {};
  for (const [name, t] of Object.entries(themes)) {
    if (name !== 'dark') fail(`themes.${name}: only "dark" is known.`);
    if (typeof t?.attr !== 'string' || !/^(class|data-[a-z0-9-]+)$/.test(t.attr)) fail(`themes.${name}.attr must be a data- attribute such as "data-theme", or "class".`);
    if (typeof t.value !== 'string' || !t.value || (t.attr === 'class' && !CLASS_TOKEN.test(t.value))) fail(`themes.${name}.value must be the value that turns it on, e.g. "dark".`);
    out[name] = { attr: t.attr, value: t.value };
  }
  return out;
}

const LOCALE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const OVERRIDABLE = ['title', 'description', 'slug'];

/** `locales`: copies of every page per region or language (one source file; a locale may respell it at build). */
function localesOf(raw, abs) {
  const list = raw.locales;
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list) || !list.length) fail('locales must be a list of {code, prefix}.');
  const codes = new Set();
  const prefixes = new Set();
  const out = list.map((l, i) => {
    const where = `locales[${i}]`;
    if (typeof l?.code !== 'string' || !LOCALE_CODE.test(l.code)) fail(`${where}.code must be a language tag such as "en-CA".`);
    const prefix = String(l.prefix ?? '').replace(/\/+$/, '');
    if (prefix && !/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(prefix)) fail(`${where}.prefix must be '' (the root) or a path such as "/en-us".`);
    if (codes.has(l.code)) fail(`${where}: "${l.code}" is listed twice.`);
    if (prefixes.has(prefix)) fail(`${where}: the prefix "${prefix || '(root)'}" is used twice.`);
    codes.add(l.code);
    prefixes.add(prefix);
    const overrides = l.overrides ?? [];
    if (!Array.isArray(overrides) || overrides.some((k) => !OVERRIDABLE.includes(k))) fail(`${where}.overrides may list ${OVERRIDABLE.join(', ')}.`);
    return {
      code: l.code,
      prefix,
      default: l.default === true,
      label: String(l.label ?? l.code),
      variety: l.variety ? String(l.variety) : null,
      spelling: l.spelling ? abs(l.spelling, `${where}.spelling`) : null,
      overrides,
    };
  });
  const defaults = out.filter((l) => l.default);
  if (defaults.length > 1) fail('locales: only one may be the default.');
  if (!defaults.length) (out.find((l) => !l.prefix) ?? out[0]).default = true;
  const xDefault = raw.xDefault ?? out.find((l) => l.default).code;
  if (!codes.has(xDefault)) fail(`xDefault "${xDefault}" is not one of the locales.`);
  if (raw.localeOverridesKey !== undefined && (typeof raw.localeOverridesKey !== 'string' || !KEY.test(raw.localeOverridesKey))) fail('localeOverridesKey must be a frontmatter key.');
  const h = raw.hreflang ?? {};
  for (const k of ['robots', 'canonical']) if (h[k] !== undefined && (typeof h[k] !== 'string' || !KEY.test(h[k]))) fail(`hreflang.${k} must be a frontmatter key such as "seo.robots".`);
  return { list: out, xDefault, overridesKey: raw.localeOverridesKey ?? 'locales', hreflang: { robots: h.robots ?? null, canonical: h.canonical ?? null } };
}

export const CONFIG_FILES = ['markstage.config.mjs', 'markstage.config.js', 'markstage.config.ts'];

/** editor.goLive: one sentence on how a change saved in dev mode reaches the live site (after "Saved on this
 *  computer, not live yet."). */
export const GO_LIVE = 'It goes live when the change is committed and the site is built and deployed, or published from the Markstage server.';
function goLiveOf(v) {
  if (v === undefined || v === null) return GO_LIVE;
  if (typeof v !== 'string' || !v.trim() || v.length > 300) fail('editor.goLive must be one sentence (at most 300 characters) on how a change goes live.');
  return v.trim();
}

/** Returns the config unchanged (for editor hints in the site's config file). */
export const defineConfig = (config) => config;

export class ConfigError extends Error {}
const fail = (m) => {
  throw new ConfigError(`markstage.config: ${m}`);
};

/** `/blog/{slug}/` with the entry's id and frontmatter / data fields filled in. */
export function fillTemplate(template, entry) {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_all, key) => {
    if (key === 'id') return entry.id;
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), entry.data);
    return v == null ? '' : String(v);
  });
}

// the edit link on the built site (the astro integration adds the script, the server sets the cookie)
export { EDIT_COOKIE, editButtonScript, editLinkHash, editLinkOf } from './edit-button.mjs';

/** Checks and fills in defaults; paths become absolute (relative to `root`). */
export function normalizeConfig(raw, root, { site = null } = {}) {
  if (!raw || typeof raw !== 'object') fail('the default export must be an object.');
  const collections = (raw.collections ?? []).map((c) => {
    if (!COLLECTION_ID.test(c?.id ?? '')) fail(`collection id must match ${COLLECTION_ID}: ${JSON.stringify(c?.id)}`);
    if (!['md', 'mdx', 'json'].includes(c.format)) fail(`collection "${c.id}": format must be "md", "mdx" or "json".`);
    if (typeof c.dir !== 'string' || !c.dir || path.isAbsolute(c.dir)) fail(`collection "${c.id}": dir must be relative to the project.`);
    const absDir = path.resolve(root, c.dir);
    if (!absDir.startsWith(root + path.sep)) fail(`collection "${c.id}": dir must be inside the project.`);
    const url = c.url ?? null;
    if (url !== null && typeof url !== 'string' && typeof url !== 'function') fail(`collection "${c.id}": url must be a template string or a function.`);
    return {
      id: c.id,
      label: String(c.label ?? c.id),
      // an MDX collection is Markdown everywhere (settings, checks, history) but for its files' reader (docs/MDX.md)
      format: c.format === 'json' ? 'json' : 'md',
      mdx: c.format === 'mdx',
      dir: path.relative(root, absDir),
      absDir,
      ext: c.format === 'json' ? '.json' : `.${c.format}`,
      hasStatus: Boolean(c.hasStatus),
      fields: { title: 'title', author: 'author', tags: 'tags', date: 'date', modified: 'modified', excerpt: 'excerpt', slug: null, url: null, ...(c.fields ?? {}) },
      url,
      group: typeof c.group === 'function' ? c.group : null,
      settings: [],
      seo: null,
      defaultAuthor: defaultAuthorOf(c),
      newEntry: null,
      // frontmatter keys the site's schema needs: emptied in the editor they stay ("" or []); any other emptied
      // field leaves the file (the title and the slug always stay)
      required: requiredOf(c),
      linkKeys: linkKeysOf(c),
      groups: null,
      gallery: galleryOf(c),
    };
  });
  // author files (authors.mjs): checked first, since the author setting of a collection picks from them
  const authors = authorsConfigOf(raw.authors, { collections: collections.map((c) => ({ id: c.id, hasStatus: c.hasStatus })), fail });
  if (authors && !path.resolve(root, authors.dir).startsWith(root + path.sep)) fail('authors.dir must be inside the project.');
  raw.collections?.forEach((c, i) => (collections[i].settings = collections[i].format === 'md' ? settingsOf(c, collections[i].fields, authors) : []));
  raw.collections?.forEach((c, i) => (collections[i].seo = seoOf(c, collections[i])));
  raw.collections?.forEach((c, i) => (collections[i].newEntry = newEntryOf(c, collections[i])));
  const ids = new Set();
  for (const c of collections) {
    if (ids.has(c.id)) fail(`collection "${c.id}" is defined twice.`);
    ids.add(c.id);
  }
  raw.collections?.forEach((c, i) => (collections[i].groups = groupsOf(c, collections[i], ids)));
  // how the site lays each page out, and what each page is for (page-types.mjs): the frame and type keys
  const frames = framesConfigOf(raw.frames, raw.collections, fail);
  const pageTypes = pageTypesConfigOf(raw.pageTypes, { collections, frames, fail });
  // the site's topics and the link map (topics.mjs, link-map.mjs): topic files, money pages, the outside-link lists
  const topics = topicsConfigOf(raw.topics, { collections: collections.map((c) => ({ id: c.id, hasUrl: c.url !== null })), pageTypes, fail });
  if (topics && !path.resolve(root, topics.dir).startsWith(root + path.sep)) fail('topics.dir must be inside the project.');
  for (const c of collections) for (const [k, col] of Object.entries(c.linkKeys)) if (!ids.has(col)) fail(`collection "${c.id}": linkKeys.${k} names "${col}", which is not a collection.`);
  const editor = raw.editor ?? {};
  const abs = (p, what) => {
    if (typeof p !== 'string' || !p) fail(`${what} must be a path.`);
    return p.startsWith('.') || path.isAbsolute(p) ? path.resolve(root, p) : p;
  };
  const packs = (editor.packs ?? []).map((p, i) => ({
    markdown: p.markdown ? abs(p.markdown, `editor.packs[${i}].markdown`) : null,
    editor: p.editor ? abs(p.editor, `editor.packs[${i}].editor`) : null,
    css: (Array.isArray(p.css) ? p.css : p.css ? [p.css] : []).map((f) => abs(f, `editor.packs[${i}].css`)),
  }));
  const compat = raw.compat?.collection ?? null;
  if (compat !== null && !ids.has(compat)) fail(`compat.collection "${compat}" is not a collection.`);
  return {
    root,
    siteName: String(raw.siteName ?? 'Site'),
    siteUrl: String(raw.siteUrl ?? site ?? '').replace(/\/+$/, ''),
    basePath: '/markstage',
    collections,
    compat,
    media: { dir: raw.media?.dir ?? 'src/assets/uploads' },
    locales: localesOf(raw, abs),
    themes: themesOf(raw.themes),
    locks: locksOf(raw.locks),
    frames,
    pageTypes,
    topics: topics && { ...topics, absDir: path.resolve(root, topics.dir) },
    editButton: editButtonOf(raw.editButton, fail),
    // author files and the author page (authors.mjs); null when the site keeps none
    authors: authors && { ...authors, absDir: path.resolve(root, authors.dir) },
    // read by the server, which checks them itself (docs/API.md: schema for JSON entries, redirects on a move)
    schema: raw.schema ?? null,
    redirects: raw.redirects ?? null,
    editor: {
      lang: editor.lang ?? 'en',
      css: (editor.css ?? []).map((f) => abs(f, 'editor.css')),
      canvas: { articleClass: editor.canvas?.articleClass ?? 'ms-article', bodyClass: editor.canvas?.bodyClass ?? 'ms-body', shell: editor.canvas?.shell === true },
      packs,
      pageData: editor.pageData ? abs(editor.pageData, 'editor.pageData') : null,
      favicon: editor.favicon ?? null,
      aliases: (editor.aliases ?? []).map((a) => {
        if (typeof a !== 'string' || !/^\/[a-z0-9/-]+$/.test(a) || a.startsWith('/markstage')) fail(`editor.aliases: "${a}" must be a site path such as /editor.`);
        return a.replace(/\/+$/, '');
      }),
      preload: editor.preload ?? [],
      links: linksOf(editor.links, abs),
      images: imagesOf(editor.images),
      linkCards: linkCardsOf(editor.linkCards),
      goLive: goLiveOf(editor.goLive),
    },
  };
}

/** Finds and loads the config file of the project at `root` (null when there is none). */
export async function loadConfig(root, load = (file) => import(pathToFileURL(file).href), opts = {}) {
  const file = CONFIG_FILES.map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!file) return null;
  const mod = await load(file);
  return { file, config: normalizeConfig(mod.default ?? mod, root, opts) };
}

/** What the browser needs (no functions, no absolute paths). */
export function clientConfig(cfg) {
  return {
    api: `${cfg.basePath}/api/`,
    siteName: cfg.siteName,
    siteUrl: cfg.siteUrl,
    collections: cfg.collections.map((c) => {
      // the field that holds a page's whole address (`fields.url`, or a pattern that is just that field: '{uri}'):
      // New asks for it when a page starts from a template; left out when there is none
      const addressKey = c.fields.url || (typeof c.url === 'string' && /^\{([A-Za-z_][\w.]*)\}$/.exec(c.url)?.[1]) || null;
      return {
        id: c.id,
        label: c.label,
        format: c.format,
        ...(c.mdx ? { mdx: true } : {}),
        dir: c.dir,
        hasUrl: c.url !== null,
        ...(addressKey ? { addressKey } : {}),
        titleKey: c.fields.title,
        settings: c.settings,
        // the "New" sheet: the settings it asks for besides the title (the defaults run where the entry is made)
        newEntry: { ask: c.newEntry?.ask ?? [] },
        required: c.required,
        linkKeys: c.linkKeys,
        // the Groups screen (#/groups/<collection>): left out when the collection has none
        ...(c.groups ? { groups: c.groups } : {}),
      };
    }),
    compat: cfg.compat,
    canvas: cfg.editor.canvas,
    // files under public/ are served from the site's root
    media: { dir: cfg.media.dir.replace(/^\/+|\/+$/g, ''), url: `/${cfg.media.dir.replace(/^\/+|\/+$/g, '').replace(/^public(\/|$)/, '')}/`.replace(/\/+$/, '/') },
    links: { special: cfg.editor.links.special, popup: cfg.editor.links.popup },
    images: cfg.editor.images,
    linkCards: cfg.editor.linkCards ?? null,
    goLive: cfg.editor.goLive ?? GO_LIVE,
    themes: cfg.themes ?? {},
    // the Authors screen and the author field (authors.mjs): the author page, co-authors, which collections
    authors: cfg.authors ? { url: cfg.authors.url, coAuthors: cfg.authors.coAuthors, collections: cfg.authors.collections, profile: PROFILE_KEYS.filter((k) => k === 'name' || cfg.authors.fields[k]) } : null,
    locks: cfg.locks ?? { pages: {}, articles: {} },
    // the page's frame and type (page-types.mjs): the choices in its settings, the type's locks and checks
    ...pageTypesClientConfig(cfg),
    // topics and links (topics.mjs): the Topics and Links screens, the topic in a page's settings
    ...topicsClientConfig(cfg),
    // a moved entry's old address redirects (the site's redirects hook; the server runs it)
    redirects: !!cfg.redirects,
    // the spelling modules are functions: the editor's client module imports them (hasSpelling marks which)
    locales: cfg.locales && {
      list: cfg.locales.list.map(({ spelling, ...l }) => ({ ...l, hasSpelling: spelling !== null })),
      xDefault: cfg.locales.xDefault,
      overridesKey: cfg.locales.overridesKey,
      hreflang: cfg.locales.hreflang,
    },
  };
}

/** An entry's page address (`id`: the file name, `data`: its frontmatter or JSON), or null when it has no page. */
export function urlOf(c, { id, data }) {
  if (!c.url) return null;
  const entry = { id, data: data ?? {} };
  const u = typeof c.url === 'function' ? c.url(entry) : fillTemplate(c.url, entry);
  return typeof u === 'string' && u ? u : null;
}

/** The section the site sorts an entry into (the search groups by it), or null. */
export function groupOf(c, { id, data }) {
  if (typeof c.group !== 'function') return null;
  const g = c.group({ id, data: data ?? {} });
  return g === null || g === undefined || g === '' ? null : String(g);
}

/** The id of the group an entry is in (its `groups.field`), or null; for the lists (the Groups screen). */
export function groupIdOf(c, { data }) {
  if (!c.groups) return null;
  const v = c.groups.field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data ?? {});
  return v === null || v === undefined || v === '' ? null : String(v);
}

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** `over` with what it lacks taken from `base`, nested objects key by key (a template's `seo` keeps the defaults'
 * `seo.canonical`); a value in `over`, a list included, always wins, and `over`'s keys keep their place first. */
function under(base, over) {
  const out = { ...over, ...base, ...over };
  for (const [k, v] of Object.entries(over)) if (plain(v) && plain(base[k])) out[k] = under(base[k], v);
  return out;
}

/**
 * The frontmatter a new entry starts with (astro dev and the server make it the same way): the title and the slug
 * first, the values the "New" sheet asked for, the site's newEntry.defaults({title, id, collection, values, user,
 * now}) (which never override the title, the slug or an asked value, and fill what an asked object lacks: a
 * template's `seo` without a canonical gets the default one), the author (`author`, else the collection's
 * defaultAuthor) and `draft: true` in a status collection.
 */
export function newEntryFrontmatter(c, { title, id, values = {}, user = null, author = null, now = new Date() }) {
  const head = { [c.fields.title]: title };
  if (c.fields.slug) head[c.fields.slug] = id;
  const defaults = c.newEntry?.defaults?.({ title, id, collection: c.id, values, user, now }) ?? {};
  if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) throw new ConfigError(`collection "${c.id}": newEntry.defaults must return an object.`);
  const fm = { ...head, ...under(defaults, values), ...head };
  const who = author ?? c.defaultAuthor;
  if (c.fields.author && who && fm[c.fields.author] === undefined) fm[c.fields.author] = who;
  if (c.hasStatus) fm.draft = true;
  return fm;
}
