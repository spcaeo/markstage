// Page frames and page types (docs/API-PAGE-TYPES.md). Pure: no file system, so the server, `astro dev`, the site's
// build helpers, the editor and the tests share it.
//
// A frame is how the site lays a page out around its content: `full` (money and landing pages: edge to edge, no
// reading column or sidebar), `reading` (articles: one reading width, the menu and a contents list), `plain` (legal
// and thank-you pages: the text alone). The page keeps its choice in one key (`frame`); without one it has its type's
// frame, else its collection's. The site's layout reads it (@markstage/astro/pages frameOf) and draws accordingly.
//
// A page type (money page, article, pillar…) is what a page is for: kept in one key (`pageType`), it brings a frame,
// a Library page template to start from, locks that hold on every page of the type (the booking button of a money
// page can't be removed) and checks that say what such a page still needs (a FAQ, Service structured data, a link
// to its hub).
//
//   frames: true,                                  // or {key: 'frame', list: [{id, label, hint}]}
//   collections: [{ id: 'pages', …, frame: 'full' }, { id: 'posts', …, frame: 'reading' }],
//   pageTypes: {
//     key: 'pageType',
//     types: [{
//       id: 'money', label: 'Money page', collections: ['pages'], frame: 'full', template: 'lib_money',
//       locks: { pages: { booking: ['remove'] } },
//       checks: [
//         { label: 'A booking button', section: 'booking', level: 'block' },
//         { label: 'Questions and answers', section: 'faq' },
//         { label: 'Service structured data', jsonld: 'Service' },
//       ],
//     }, {
//       id: 'article', label: 'Article', collections: ['posts'], frame: 'reading',
//       checks: [{ label: 'Links to its hub', linksTo: { pageType: 'pillar', sameField: 'cluster' } },
//                { label: 'Links to a money page', linksTo: { pageType: 'money' } },
//                { label: 'Links up to its topic’s main page', links: 'pillar', level: 'block' }],
//     }],
//   }
// A `links` check reads the site's topics (topics.mjs, docs/API-LINKS.md): pillar, lead, money (links to them),
// anchors (no words used for two pages, no vague words), redirects (no links to redirects or hidden pages), outside
// (outside links follow the site's allowlist).
import { linkCheckOf } from './topics.mjs';

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
const LEVELS = ['warn', 'block'];
const KINDS = ['section', 'field', 'jsonld', 'linksTo', 'links'];
const LOCK_WHAT = ['move', 'remove', 'edit'];

/** The three frames a site gets with `frames: true`. */
export const DEFAULT_FRAMES = Object.freeze([
  Object.freeze({ id: 'full', label: 'Full width', hint: 'Money and landing pages: the sections edge to edge, no reading column or sidebar.' }),
  Object.freeze({ id: 'reading', label: 'Reading', hint: 'Articles: one reading width, with the menu and a list of contents.' }),
  Object.freeze({ id: 'plain', label: 'Plain', hint: 'Legal and thank-you pages: the text alone, nothing around it.' }),
]);

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const get = (o, key) => String(key ?? '').split('.').reduce((v, k) => (plain(v) ? v[k] : undefined), o);
const str = (v) => (typeof v === 'string' ? v : '');
const filled = (v) => (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) ? v.length > 0 : plain(v) ? Object.keys(v).length > 0 : v !== undefined && v !== null && v !== false);

/**
 * `frames` of the site config: null (off), or {key, list: [{id, label, hint}], defaults: {<collection>: frame id}}.
 * `rawCollections` are the config's collections as written (their `frame` is the collection's default).
 */
export function framesConfigOf(raw, rawCollections = [], fail = (m) => { throw new Error(m); }) {
  const asked = (rawCollections ?? []).filter((c) => c?.frame !== undefined);
  if (raw === undefined || raw === null || raw === false) {
    if (asked.length) fail(`collection "${asked[0].id}": frame needs frames (set \`frames: true\` at the top of the config).`);
    return null;
  }
  const o = raw === true ? {} : raw;
  if (!plain(o)) fail('frames must be true or {key, list: [{id, label, hint}]}.');
  const key = o.key ?? 'frame';
  if (typeof key !== 'string' || !KEY.test(key)) fail('frames.key must be a frontmatter or JSON key, such as "frame".');
  const given = o.list ?? DEFAULT_FRAMES;
  if (!Array.isArray(given) || !given.length) fail('frames.list must list the frames: [{id, label, hint}].');
  const list = given.map((f, i) => {
    if (!plain(f) || !ID.test(f.id ?? '')) fail(`frames.list[${i}]: id must be lowercase letters, digits and hyphens.`);
    if (typeof f.label !== 'string' || !f.label.trim()) fail(`frames.list[${i}]: give the frame a label.`);
    return { id: f.id, label: f.label.trim(), hint: typeof f.hint === 'string' ? f.hint.trim() : '' };
  });
  const ids = list.map((f) => f.id);
  if (new Set(ids).size !== ids.length) fail('frames.list names a frame twice.');
  const fallback = ids.includes('reading') ? 'reading' : ids[0];
  const defaults = {};
  for (const c of rawCollections ?? []) {
    if (!c?.id) continue;
    if (c.frame !== undefined && !ids.includes(c.frame)) fail(`collection "${c.id}": frame "${c.frame}" is not one of the frames (${ids.join(', ')}).`);
    defaults[c.id] = c.frame ?? fallback;
  }
  return { key, list, defaults };
}

/** A type's lock rules ({pages, articles}: kind -> ['move', 'remove', 'edit']), normalized like the site's. */
function typeLocksOf(locks, where, fail) {
  const out = { pages: {}, articles: {} };
  if (locks === undefined || locks === null) return out;
  const bad = () => fail(`${where}: locks must be {pages: {<section type>: ["move", "remove", "edit"]}, articles: {<box>: [...]}}.`);
  if (!plain(locks)) bad();
  for (const [part, rules] of Object.entries(locks)) {
    if (!(part in out) || !plain(rules)) bad();
    for (const [kind, what] of Object.entries(rules)) {
      if (!Array.isArray(what) || !what.length || what.some((w) => !LOCK_WHAT.includes(w))) bad();
      out[part][kind] = Object.fromEntries(LOCK_WHAT.filter((w) => what.includes(w)).map((w) => [w, true]));
    }
  }
  return out;
}

function checkOf(k, where, n, fail) {
  if (!plain(k)) fail(`${where}: each check is {label, section | field | jsonld | linksTo | links, level?}.`);
  const kinds = KINDS.filter((x) => k[x] !== undefined);
  if (kinds.length !== 1) fail(`${where}: a check names one of ${KINDS.join(', ')}.`);
  const kind = kinds[0];
  const level = k.level ?? 'warn';
  if (!LEVELS.includes(level)) fail(`${where}: level must be "warn" or "block".`);
  if (typeof k.label !== 'string' || !k.label.trim()) fail(`${where}: give the check a label (what the page needs, in plain words).`);
  const out = { id: typeof k.id === 'string' && ID.test(k.id) ? k.id : `${kind.toLowerCase()}-${n + 1}`, label: k.label.trim(), level, kind, hint: typeof k.hint === 'string' ? k.hint.trim() : '' };
  if (kind === 'section' || kind === 'jsonld') {
    if (typeof k[kind] !== 'string' || !k[kind].trim()) fail(`${where}: ${kind} names a ${kind === 'section' ? 'section type (or an article box)' : 'schema.org type, such as "Service"'}.`);
    out[kind] = k[kind].trim();
  } else if (kind === 'links') {
    out.links = linkCheckOf(k.links, where, fail);
  } else if (kind === 'field') {
    if (typeof k.field !== 'string' || !KEY.test(k.field)) fail(`${where}: field must be a key, such as "faq" or "seo.description".`);
    out.field = k.field;
  } else {
    const to = typeof k.linksTo === 'string' ? { pageType: k.linksTo } : k.linksTo;
    const types = plain(to) ? (Array.isArray(to.pageType) ? to.pageType : [to.pageType]) : [];
    if (!types.length || types.some((t) => typeof t !== 'string' || !ID.test(t))) fail(`${where}: linksTo names the page type(s) to link to: {pageType: "money"}.`);
    if (to.sameField !== undefined && (typeof to.sameField !== 'string' || !KEY.test(to.sameField))) fail(`${where}: linksTo.sameField must be a key, such as "cluster".`);
    out.linksTo = { pageType: types, sameField: to.sameField ?? null };
  }
  return out;
}

/**
 * `pageTypes` of the site config: null (off), or {key, types: [{id, label, description, collections, frame,
 * template, locks: {pages, articles}, checks: [{id, label, level, kind, hint, …}]}]}.
 */
export function pageTypesConfigOf(raw, { collections = [], frames = null, fail = (m) => { throw new Error(m); } } = {}) {
  if (raw === undefined || raw === null || raw === false) return null;
  const o = Array.isArray(raw) ? { types: raw } : raw;
  if (!plain(o) || !Array.isArray(o.types) || !o.types.length) fail('pageTypes must be {key, types: [{id, label, …}]}.');
  const key = o.key ?? 'pageType';
  if (typeof key !== 'string' || !KEY.test(key)) fail('pageTypes.key must be a frontmatter or JSON key, such as "pageType".');
  if (frames && key === frames.key) fail('pageTypes.key and frames.key must be different keys.');
  const ids = collections.map((c) => c.id);
  const types = o.types.map((t, i) => {
    const where = `pageTypes.types[${i}]`;
    if (!plain(t) || !ID.test(t.id ?? '')) fail(`${where}: id must be lowercase letters, digits and hyphens.`);
    if (typeof t.label !== 'string' || !t.label.trim()) fail(`${where}: give the type a label.`);
    const cols = t.collections ?? ids;
    if (!Array.isArray(cols) || !cols.length || cols.some((c) => !ids.includes(c))) fail(`${where}: collections must list collections of this site (${ids.join(', ') || 'none yet'}).`);
    if (t.frame !== undefined && !frames) fail(`${where}: frame needs frames (set \`frames: true\`).`);
    if (t.frame !== undefined && !frames.list.some((f) => f.id === t.frame)) fail(`${where}: frame "${t.frame}" is not one of the frames (${frames.list.map((f) => f.id).join(', ')}).`);
    if (t.template !== undefined && (typeof t.template !== 'string' || !/^lib_[A-Za-z0-9_-]{8,40}$/.test(t.template))) fail(`${where}: template is a shared Library template's id, such as "lib_money-page".`);
    if (t.checks !== undefined && !Array.isArray(t.checks)) fail(`${where}: checks must be a list.`);
    const checks = (t.checks ?? []).map((k, n) => checkOf(k, `${where}.checks[${n}]`, n, fail));
    if (new Set(checks.map((k) => k.id)).size !== checks.length) fail(`${where}: two checks have the same id.`);
    return {
      id: t.id,
      label: t.label.trim(),
      description: typeof t.description === 'string' ? t.description.trim() : '',
      collections: [...new Set(cols)],
      frame: t.frame ?? null,
      template: t.template ?? null,
      locks: typeLocksOf(t.locks, where, fail),
      checks,
    };
  });
  const tids = types.map((t) => t.id);
  if (new Set(tids).size !== tids.length) fail('pageTypes names a type twice.');
  for (const t of types) for (const k of t.checks) if (k.linksTo) for (const to of k.linksTo.pageType) if (!tids.includes(to)) fail(`pageTypes "${t.id}": check "${k.label}" links to the type "${to}", which is not a page type.`);
  return { key, types };
}

/** The types an entry of this collection may have. */
export const typesFor = (site, collectionId) => (site?.pageTypes?.types ?? []).filter((t) => t.collections.includes(collectionId));

/** The entry's page type (its key's value, when a type of its collection), or null. */
export function pageTypeOf(site, c, data) {
  const pt = site?.pageTypes;
  if (!pt || !c) return null;
  const v = get(data, pt.key);
  return typesFor(site, c.id ?? c).find((t) => t.id === v) ?? null;
}

/**
 * The entry's frame: {id, label, hint, from: 'page' | 'type' | 'collection'}, or null when the site has no frames.
 * A value that is not a frame is passed over (the save check and the build say so).
 */
export function frameOf(site, c, data) {
  const fr = site?.frames;
  if (!fr || !c) return null;
  const find = (id) => fr.list.find((f) => f.id === id) ?? null;
  const own = find(get(data, fr.key));
  if (own) return { ...own, from: 'page' };
  const type = pageTypeOf(site, c, data);
  if (type?.frame) return { ...find(type.frame), from: 'type' };
  const id = c.id ?? c;
  return { ...(find(fr.defaults[id]) ?? fr.list[0]), from: 'collection' };
}

/**
 * The lock rules that hold for an entry: the site's, with those of its page type added. A save is held to both
 * sides' types (`types`: before and after), so a page can't drop its type and its locked block in one save.
 */
export function lockRulesFor(rules, types = []) {
  const out = { pages: { ...(rules?.pages ?? {}) }, articles: { ...(rules?.articles ?? {}) } };
  for (const t of types) {
    if (!t) continue;
    for (const part of ['pages', 'articles']) {
      for (const [kind, lock] of Object.entries(t.locks?.[part] ?? {})) {
        const was = out[part][kind] ?? {};
        out[part][kind] = Object.fromEntries(LOCK_WHAT.filter((w) => was[w] || lock[w]).map((w) => [w, true]));
      }
    }
  }
  return out;
}

/**
 * What is wrong with the frame and type a save gives an entry, among the values it changes (an old value is left
 * alone): [{key, problem: 'frame' | 'type', message}]. `before` null: a new entry.
 */
export function pageProblems(site, c, before, after) {
  const out = [];
  const changed = (key) => before === null || JSON.stringify(get(before, key) ?? null) !== JSON.stringify(get(after, key) ?? null);
  const fr = site?.frames;
  if (fr && changed(fr.key)) {
    const v = get(after, fr.key);
    if (v !== undefined && v !== null && !fr.list.some((f) => f.id === v)) out.push({ key: fr.key, problem: 'frame', message: `“${v}” is not a frame of this site. Pick one of: ${fr.list.map((f) => f.label).join(', ')}.` });
  }
  const pt = site?.pageTypes;
  if (pt && changed(pt.key)) {
    const v = get(after, pt.key);
    const ok = typesFor(site, c.id ?? c);
    if (v !== undefined && v !== null && !ok.some((t) => t.id === v)) out.push({ key: pt.key, problem: 'type', message: ok.length ? `“${v}” is not a page type here. Pick one of: ${ok.map((t) => t.label).join(', ')}.` : `Pages here have no page types; leave “${pt.key}” out.` });
  }
  return out;
}

/** True when a save changes an existing entry's page type (editors and above only, so type locks mean something). */
export const typeChanged = (site, before, after) => !!site?.pageTypes && before !== null && JSON.stringify(get(before, site.pageTypes.key) ?? null) !== JSON.stringify(get(after, site.pageTypes.key) ?? null);

// ---------- the checks ----------
const kindOf = (v) => (plain(v) ? (typeof v.discriminant === 'string' ? v.discriminant : typeof v.type === 'string' ? v.type : null) : null);

/** Is there a page section (a list item with that discriminant) or an article box (a node of that type) of `kind`? */
function hasSection(entry, kind) {
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some(walk);
    if (kindOf(v) === kind) return true;
    return Object.values(v).some(walk);
  };
  return entry.format === 'md' ? walk(entry.doc) : walk(entry.data);
}

/** A schema.org type in the entry's own data ("@type": "Service" anywhere) or in its built page's JSON-LD. */
function hasJsonLd(entry, type) {
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    if (!Array.isArray(v)) {
      const t = v['@type'];
      if (t === type || (Array.isArray(t) && t.includes(type))) return true;
    }
    return Object.values(v).some(walk);
  };
  if (walk(entry.data)) return true;
  for (const m of str(entry.built).matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      if (walk(JSON.parse(m[1]))) return true;
    } catch {
      // not JSON: not structured data
    }
  }
  return false;
}

const labelsOf = (site, ids) => ids.map((id) => site.pageTypes.types.find((t) => t.id === id)?.label ?? id);
/** "a money page", "an article". */
export const aLabel = (label) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;
const list = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`);

/**
 * The type's checks on one entry: [{id, label, level, ok, message}] (message: what to do, when not ok).
 * `entry`: {collection, format, data (JSON data, or the frontmatter), doc (an article's document, or null), built
 * (its last built page's HTML, or null), links: [{href, target: {collection, id, title, data} | null}]}.
 */
export function runPageChecks(site, type, entry) {
  if (!type) return [];
  const coll = (id) => site.collections?.find((c) => c.id === id) ?? { id };
  return type.checks.map((k) => {
    let ok = false;
    let message = '';
    if (k.kind === 'section') {
      ok = hasSection(entry, k.section);
      message = `Add a “${k.section}” ${entry.format === 'md' ? 'box' : 'section'}: this page has none.`;
    } else if (k.kind === 'field') {
      ok = filled(get(entry.data, k.field));
      message = `Fill in “${k.field}”.`;
    } else if (k.kind === 'links') {
      // the topic link checks (link-map.mjs), worked out by the caller that has the whole site: none means nothing to say
      const r = entry.linkChecks?.[k.links];
      ok = r ? r.ok : true;
      message = r?.message ?? '';
    } else if (k.kind === 'jsonld') {
      ok = hasJsonLd(entry, k.jsonld);
      message = `No ${k.jsonld} structured data (JSON-LD) on this page${entry.built ? '' : ' yet (the built page is read once it is published)'}.`;
    } else {
      const { pageType, sameField } = k.linksTo;
      const mine = sameField ? get(entry.data, sameField) : undefined;
      ok = (entry.links ?? []).some((l) => {
        const t = l.target;
        if (!t) return false;
        const tt = pageTypeOf(site, coll(t.collection), t.data);
        return !!tt && pageType.includes(tt.id) && (!sameField || (filled(mine) && JSON.stringify(get(t.data, sameField)) === JSON.stringify(mine)));
      });
      const to = list(labelsOf(site, pageType).map(aLabel));
      message = sameField && !filled(mine) ? `Set “${sameField}” first, then link to ${to} with the same one.` : `Link to ${to}${sameField ? ` with the same “${sameField}”` : ''} from the text.`;
    }
    return { id: k.id, label: k.label, level: k.level, ok, ...(ok ? {} : { message: k.hint || message }) };
  });
}

const HREF = /\bhref\s*=\s*(["'])([^"']*)\1/gi;

/**
 * The site paths an entry links to, for the link checks where the server's own finder is not at hand (`astro dev`):
 * link marks in the document, hrefs in its HTML, and href/url/link/to values in the data. Each path once, in order.
 */
export function pageLinks(doc, data, siteUrl = null) {
  const out = new Set();
  const site = siteUrl ? String(siteUrl).replace(/\/+$/, '') : null;
  const add = (href) => {
    if (typeof href !== 'string') return;
    let h = href.trim();
    if (site && h.startsWith(site)) h = h.slice(site.length) || '/';
    if (h.startsWith('/') && !h.startsWith('//')) out.add(h);
  };
  const html = (t) => {
    for (const m of String(t).matchAll(HREF)) add(m[2]);
  };
  const visit = (n) => {
    if (!plain(n)) return;
    for (const m of Array.isArray(n.marks) ? n.marks : []) if (m?.type === 'link') add(m.attrs?.href);
    if (typeof n.attrs?.html === 'string') html(n.attrs.html);
    for (const ch of Array.isArray(n.content) ? n.content : []) visit(ch);
  };
  visit(doc);
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (/^(href|url|link|to)$/i.test(key ?? '')) add(v);
      if (/href/i.test(v)) html(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (plain(v)) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(data, null);
  return [...out];
}

/** A site path as the link checks compare it: no query, hash or trailing slash (as the server's preflight keys it). */
export const pathKey = (p) => {
  const s = String(p ?? '').replace(/[#?].*$/, '');
  return s.length > 1 ? s.replace(/\/+$/, '') : s || '/';
};

/** The client's part of the config (no functions): frames and the types with their checks' labels and locks. */
export function pageTypesClientConfig(cfg) {
  return {
    frames: cfg.frames ? { key: cfg.frames.key, list: cfg.frames.list, defaults: cfg.frames.defaults } : null,
    pageTypes: cfg.pageTypes
      ? {
          key: cfg.pageTypes.key,
          types: cfg.pageTypes.types.map((t) => ({ id: t.id, label: t.label, description: t.description, collections: t.collections, frame: t.frame, template: t.template, locks: t.locks, checks: t.checks.map((k) => ({ id: k.id, label: k.label, level: k.level })) })),
        }
      : null,
  };
}
