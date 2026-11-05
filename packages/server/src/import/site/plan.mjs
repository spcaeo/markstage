// The site import's plan (docs/IMPORT.md): a bundle (convert/bundle.mjs) and its mapping (mapping.mjs) turned into
// what the import would do, with nothing written and nothing fetched but the source itself:
//   1. each item goes to its collection (or is left out), with an id (its old slug; a taken one kept both, skipped or
//      replaced, as the person chose; what this source brought before keeps its id) and its new address;
//   2. its HTML becomes Markdown (convert/html.mjs): each picture of the old site a media:<id> token for the media
//      library, each link to an old page its new address, each link to an old file the file's new place;
//   3. its fields go to the collection's keys (title, dates, author, tags and categories, excerpt, cover, SEO);
//   4. the authors it names are found or planned;
//   5. the existing import plan (../plan.mjs) checks every entry as the editor's save would and says what it would
//      do (create, update, unchanged, skip);
//   6. the moved addresses: every old address of an entry, a picture or an author to its new one (paths for the
//      site's redirects hook; ?p=, ?page_id=, ?attachment_id= for the id map, since a static host cannot match a query);
//   7. the review list: pictures with no alt text, blocks, cards, shortcodes and slices that became placeholders,
//      embeds that became links, links to old pages that were not imported, collisions.
import { sha1, slugify } from '../../util.mjs';
import { badFrom, keyOf } from '../../redirects/check.mjs';
import { cleanSlug, fromPath, isMediaFile, oldPlace, originalGhostImage, originalPrismicImage, originalUpload, pathKey, PLACEHOLDER } from '../convert/bundle.mjs';
import { ghostTransform } from '../convert/ghost.mjs';
import { htmlToMarkdown } from '../convert/html.mjs';
import { DOC_LINK, isRichText, richTextToHtml, richTextWords } from '../convert/prismic.mjs';
import { makePlan } from '../plan.mjs';
import { resolveMapping } from './mapping.mjs';

export const SITE_LIMITS = Object.freeze({ entries: 5000, media: 5000 });
const ID_KEYS = ['p', 'page_id', 'attachment_id'];
const WORDS = { wordpress: 'WordPress', ghost: 'Ghost', prismic: 'Prismic' };
export const productName = (kind) => WORDS[kind] ?? kind;

/** The file name an address ends in, for a note ("Pros.svg"). */
function fileNameOf(u, base) {
  try {
    const last = new URL(u, base).pathname.split('/').pop() || '';
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return String(u).slice(0, 80);
  }
}
const isPrismicHost = (h) => h === 'images.prismic.io' || h.endsWith('.prismic.io') || h === 'prismic-io.s3.amazonaws.com';
const setPath = (obj, key, v) => {
  const parts = key.split('.');
  let o = obj;
  for (const k of parts.slice(0, -1)) o = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? o[k] : (o[k] = {});
  o[parts.at(-1)] = v;
};

/** The import's key for a source: its product and its site, so two sites never share ids. */
export function sourceKey(bundle) {
  const where = bundle.site.hosts[0] ?? bundle.site.title ?? '';
  return `${bundle.kind}-${sha1(String(where).toLowerCase()).slice(0, 8)}`;
}

/**
 * The plan: {payload, plan (../plan.mjs's), items, media, authors, redirects, ids, review, counts, mapping}.
 * `mediaAt` as for the JSON import; `stored` for the run's second look (the media are in the library by then).
 */
export async function makeSitePlan(app, ctx, entries, { bundle, mapping: given }, { mediaAt, stored = false }) {
  const { store, converter, db } = app;
  const source = sourceKey(bundle);
  const mapping = resolveMapping(store.collections, bundle, given);
  const site = bundle.site;
  const base = site.url || 'https://old-site.invalid';
  const review = [];
  // one note per thing per entry: the same icon twenty times on a page is one thing to look at
  const noted = new Set();
  const noteFor = (item) => (n) => {
    const k = `${item.sourceId}\u0000${n.kind}\u0000${n.text}`;
    if (noted.has(k)) return;
    noted.add(k);
    review.push({ ...n, entry: item.sourceId });
  };
  const mapped = (kind, sid) => db.prepare('SELECT * FROM import_map WHERE source = ? AND kind = ? AND source_id = ?').get(source, kind, sid);

  // ---- media: the export's own list first, then every picture the texts show (one entry per original file)
  const original = (u) => (bundle.kind === 'ghost' ? originalGhostImage(u) : bundle.kind === 'prismic' ? originalPrismicImage(u) : originalUpload(u));
  const media = new Map();
  const ownImage = (u) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return site.hosts.includes(h.replace(/^www\./, '')) || (bundle.kind === 'prismic' && isPrismicHost(h));
    } catch {
      return false;
    }
  };
  for (const m of bundle.media) media.set(original(m.url), { ...m, url: original(m.url), used: false, paths: new Set() });
  const mediaFor = (url, alt = '') => {
    if (!ownImage(url) || (!isMediaFile(url) && bundle.kind !== 'prismic')) return null;
    const key = original(url);
    let m = media.get(key);
    if (!m) media.set(key, (m = { sourceId: `img-${sha1(key).slice(0, 12)}`, url: key, alt: '', title: '', oldUrls: [], used: false, paths: new Set() }));
    m.used = true;
    try {
      if (bundle.kind !== 'prismic') m.paths.add(new URL(url).pathname);
    } catch {
      // the address was checked above
    }
    if (!m.alt && alt.trim()) m.alt = alt.trim();
    return m;
  };

  // ---- 1. each item: its collection, id and new address
  const existing = store.addresses();
  const claimed = new Set();
  const left = {};
  const planned = [];
  const byOld = new Map(); // old path key -> new address
  const byWpId = { p: new Map(), page_id: new Map() };
  const byDoc = new Map();
  for (const item of bundle.items) {
    const cid = mapping.types[item.type];
    const c = cid ? store.collections.find((x) => x.id === cid) : null;
    if (!c) {
      left[item.type] = (left[item.type] ?? 0) + 1;
      continue;
    }
    const F = mapping.fields[c.id];
    const row = { item, c, F, problem: null, collision: false };
    planned.push(row);
    if (item.status !== 'published' && !c.hasStatus && mapping.drafts === 'skip') {
      row.problem = `It is ${item.status === 'private' ? 'private' : 'a draft'} in ${productName(bundle.kind)}, and ${c.label} has no drafts, so it is left out (choose “Bring drafts in too” to import it).`;
      continue;
    }
    const was = mapped('entry', item.sourceId);
    let id = was?.collection === c.id ? was.target : null;
    if (!id) {
      const wanted = cleanSlug(item.slug) || cleanSlug(slugify(item.title)) || `${c.format === 'json' ? 'page' : 'post'}-${item.sourceId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 100);
      const taken = (x) => store.exists(c, x) || claimed.has(`${c.id}/${x}`);
      id = wanted;
      if (taken(wanted)) {
        row.collision = true;
        if (mapping.onCollision === 'skip') row.problem = `${c.label} already has an entry at ${c.id}/${wanted}; it is kept as it is and this one is left out.`;
        else if (mapping.onCollision === 'replace' && !claimed.has(`${c.id}/${wanted}`)) row.replace = true;
        else for (let n = 2; taken(id); n++) id = `${wanted.slice(0, 95).replace(/-+$/, '')}-${n}`;
      }
    }
    claimed.add(`${c.id}/${id}`);
    row.id = id;
    if (row.problem) continue;
    // a page that keeps its old address, unless another entry of the site has it already (then its new id's)
    const firstPath = item.oldUrls.find((u) => !u.includes('?'));
    const urlOf = (keep) => store.summarize(c, id, c.format === 'json' ? JSON.stringify(keep ? Object.fromEntries([[F.url, keep]]) : {}) : converter.setFrontmatter('---\n---\n', { [c.fields.title]: item.title })).url ?? null;
    const holder = (u) => (u ? existing.get(u) : undefined);
    row.keepUrl = F.url && c.format === 'json' ? fromPath(firstPath ?? `/${id}/`) : null;
    row.url = urlOf(row.keepUrl);
    if (row.keepUrl && holder(row.url) && holder(row.url) !== `${c.id}/${id}`) {
      noteFor(item)({ kind: 'collision', text: `Its old address ${row.keepUrl} belongs to ${holder(row.url)} here, so it comes in at /${id}/.` });
      row.keepUrl = fromPath(`/${id}/`);
      row.url = urlOf(row.keepUrl);
    }
    if (row.url) {
      for (const u of item.oldUrls) {
        const [p, q] = u.split('?');
        if (q) {
          const qs = new URLSearchParams(q);
          for (const k of ['p', 'page_id']) if (qs.get(k)) byWpId[k].set(qs.get(k), row.url);
        } else byOld.set(pathKey(p), row.url);
      }
      byDoc.set(item.sourceId.replace(/^doc-/, ''), row.url);
    }
  }
  if (planned.filter((r) => !r.problem).length > SITE_LIMITS.entries) throw new Error(`This site has more than ${SITE_LIMITS.entries} items to import at once. Leave some kinds out, or import it in parts.`);

  // ---- authors: found by an earlier import, by slug among the site's, or planned
  const authors = new Map();
  const authorOf = (ref) => {
    if (authors.has(ref)) return authors.get(ref);
    const a = bundle.authors.find((x) => x.sourceId === ref) ?? (ref.startsWith('name:') ? { sourceId: ref, slug: null, name: ref.slice(5), oldUrls: [] } : null);
    if (!a) return null;
    let out;
    if (!app.authors?.enabled) out = { ...a, value: a.name, action: 'none' };
    else {
      const was = mapped('author', a.sourceId);
      const slug = was?.target ?? (cleanSlug(a.slug) || app.authors.core.slugOfName(a.name));
      const exists = app.authors.files.exists(slug);
      out = { ...a, slug, value: slug, action: exists ? 'existing' : 'create' };
    }
    authors.set(ref, out);
    return out;
  };

  // ---- 2 and 3: the texts, links and fields
  const linkOf = (item, note) => (u) => {
    if (u.startsWith(DOC_LINK)) return byDoc.get(decodeURIComponent(u.slice(DOC_LINK.length))) ?? null;
    const place = oldPlace(u, { base, hosts: site.hosts });
    if (!place) return u;
    for (const k of ID_KEYS) {
      const v = place.query.get(k);
      if (!v) continue;
      if (k === 'attachment_id') {
        const a = bundle.media.find((x) => x.sourceId === `att-${v}`);
        const m = a ? mediaFor(a.url, a.alt) : null;
        return m ? `media:${m.sourceId}` : u;
      }
      if (byWpId[k].has(v)) return `${byWpId[k].get(v)}${place.hash}`;
    }
    if (/\/wp-content\/uploads\/|\/content\/images\//.test(place.path)) {
      const m = isMediaFile(place.path) ? mediaFor(u) : null;
      if (m) return `media:${m.sourceId}`;
      note({ kind: 'file', text: `A link to a file on the old site (${place.path.split('/').pop()}) still points there: only pictures and PDFs are brought in.` });
      return u;
    }
    const to = byOld.get(pathKey(place.path));
    if (to) return `${to}${place.hash}`;
    if (pathKey(place.path) !== '/') note({ kind: 'link', text: `A link to ${place.path} on the old site still points there: that page was not imported.` });
    return u;
  };
  const imageOf = (note) => (u, n) => {
    const m = mediaFor(u, n?.attrs?.alt ?? '');
    if (!m) {
      const name = fileNameOf(u, base);
      if (ownImage(u) && /\.svg$/i.test(name)) note({ kind: 'image', text: `An SVG picture on the old site (${name}) is still shown from there: SVG files are not brought in, since they can carry scripts. Save it as PNG or WebP and put that in its place.` });
      else if (ownImage(u)) note({ kind: 'image', text: `A picture on the old site (${name}) is still shown from there: only JPEG, PNG, GIF, WebP, AVIF and HEIC pictures are brought in.` });
      else if (/^https?:/.test(u)) note({ kind: 'image', text: `A picture from ${new URL(u).hostname} was kept as a link to that site.` });
      return u;
    }
    if (n && !String(n.attrs.alt ?? '').trim() && m.alt) n.attrs.alt = m.alt;
    return `media:${m.sourceId}`;
  };
  const markdownOf = (item, html, extra = {}) => {
    const note = noteFor(item);
    const out = htmlToMarkdown(html, { base, image: imageOf(note), link: linkOf(item, note), transform: bundle.kind === 'ghost' ? ghostTransform : undefined, ...extra });
    for (const n of out.notes) note(n);
    return out.markdown;
  };

  const payloadEntries = [];
  const rowOf = new Map();
  const authorPlanned = new Map();
  for (const row of planned) {
    const { item, c, F } = row;
    if (row.problem) continue;
    const note = noteFor(item);
    for (const n of item.notes) note(n);
    // Markdown that came as it was (a Ghost Markdown card) has its links to the old site put right here, its pictures
    // brought in; the HTML's own links and pictures were handled once, while it was read
    const pieces = (item.markdown ?? []).map((piece) => String(piece).replace(/\]\((https?:\/\/[^)\s]+)\)/g, (all, u) => `](${linkOf(item, note)(u) ?? u})`));
    const body = markdownOf(item, item.html, { markdown: pieces });
    const fm = c.format === 'md' ? { [c.fields.title]: item.title || row.id } : {};
    const put = (role, v) => {
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
      if (!F[role]) return;
      setPath(fm, F[role], v);
    };
    put('date', item.date);
    put('updated', item.updated);
    const names = item.authors.map(authorOf).filter(Boolean);
    if (names.length) {
      put('author', names[0].value);
      for (const a of names) if (a.action === 'create') authorPlanned.set(a.slug, { slug: a.slug, name: a.name, archived: false });
      if (names.length > 1) note({ kind: 'author', text: `It has ${names.length} authors in ${productName(bundle.kind)}; the first, ${names[0].name}, is its author here.` });
    } else if (c.hasStatus && F.author) put('author', ctx.user.authorSlug ?? c.defaultAuthor ?? null);
    put('tags', item.tags);
    put('categories', item.categories);
    put('excerpt', item.excerpt);
    if (item.cover?.url) {
      const m = mediaFor(item.cover.url, item.cover.alt ?? '');
      if (F.cover) {
        put('cover', m ? `media:${m.sourceId}` : item.cover.url);
        put('coverAlt', item.cover.alt || m?.alt || null);
      } else note({ kind: 'cover', text: `Its cover picture was not kept: ${c.label} has no image field. Map one on the mapping step.` });
    }
    if (item.seo) {
      put('seoTitle', item.seo.title);
      put('seoDescription', item.seo.description);
      if (!F.seoTitle && !F.seoDescription) note({ kind: 'seo', text: `Its search title and description were not kept: ${c.label} has no SEO setting. Map them on the mapping step.` });
    }
    if (item.status !== 'published' && c.hasStatus) {
      // a draft stays a draft; a published one comes in as a draft too, which the report says once
    } else if (item.status === 'private') note({ kind: 'status', text: `It was private in ${productName(bundle.kind)}.` });
    const e = { sourceId: item.sourceId, collection: c.id, id: row.id, title: item.title || row.id, ...(row.replace ? { replace: true } : {}) };
    if (c.format === 'json') {
      if (F.body && body) setPath(fm, F.body, body);
      if (row.keepUrl) setPath(fm, F.url, row.keepUrl);
      if (F.sections && item.sections?.length) setPath(fm, F.sections, item.sections.map((s) => ({ discriminant: s.discriminant, value: sectionValue(item, s.value) })));
      e.data = fm;
    } else {
      if (c.fields.slug) fm[c.fields.slug] = row.id;
      e.frontmatter = fm;
      e.body = body ? `${body}\n` : '';
    }
    payloadEntries.push(e);
    rowOf.set(item.sourceId, row);
  }

  /** A section's value from a slice's fields: rich text as Markdown, a picture as its place in the library. */
  function sectionValue(item, v, depth = 0) {
    if (depth > 20 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => sectionValue(item, x, depth + 1));
    // a heading alone is a section's title: its words; any other rich text its Markdown
    if (v.richText && isRichText(v.richText)) return v.richText.length === 1 && /^heading\d$/.test(v.richText[0].type) ? richTextWords(v.richText) : markdownOf(item, richTextToHtml(v.richText, { notes: [] }));
    if (typeof v.url === 'string' && v.dimensions) {
      const m = mediaFor(v.url, v.alt ?? '');
      return { src: m ? `media:${m.sourceId}` : v.url, alt: v.alt ?? m?.alt ?? '' };
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sectionValue(item, x, depth + 1)]));
  }

  // ---- the media this import brings: the ones used (or all), each with the alt text found
  const mediaList = [...media.values()].filter((m) => m.used || mapping.media === 'all');
  const unused = [...media.values()].length - mediaList.length;
  if (mediaList.length > SITE_LIMITS.media) throw new Error(`This site has more than ${SITE_LIMITS.media} pictures to import at once. Import it in parts.`);
  const payload = { source, entries: payloadEntries, media: mediaList.map((m) => ({ sourceId: m.sourceId, url: m.url, alt: m.alt })), overwrite: false, mediaAs: 'url' };
  const fallback = new Map(mediaList.map((m) => [m.sourceId, m.url]));

  // ---- 5. the existing plan checks each entry as a save does (the authors this import makes count as the site's)
  const plan = await app.authors.withPlanned(authorPlanned, () => makePlan(app, ctx, entries, payload, { mediaAt, stored, fallback }));
  const placeOf = new Map(plan.media.filter((m) => m.path).map((m) => [m.sourceId, m.path]));
  const mediaUrl = (sid) => (placeOf.has(sid) ? app.mediaPrepare.urlOf(placeOf.get(sid)) : null);

  // ---- 6. moved addresses
  // an address a page of the site already answers is never redirected
  const live = new Set([...existing.keys()].map((u) => keyOf(u)));
  const redirects = new Map();
  const ids = Object.fromEntries(ID_KEYS.map((k) => [k, {}]));
  const origin = site.url ? new URL(site.url).origin : null;
  for (const e of plan.entries) {
    const row = rowOf.get(e.sourceId);
    if (row?.url && e.action !== 'skip') live.add(keyOf(row.url));
  }
  const add = (from, to) => {
    if (!to) return;
    const f = fromPath(from);
    if (!f || badFrom(f) || live.has(keyOf(f)) || keyOf(f) === keyOf(to, origin) || redirects.has(keyOf(f))) return;
    redirects.set(keyOf(f), { from: f, to });
  };
  const addOld = (u, to) => {
    const [p, q] = u.split('?');
    if (q) {
      const qs = new URLSearchParams(q);
      for (const k of ID_KEYS) if (qs.get(k)) ids[k][qs.get(k)] = to;
    } else add(p, to);
  };
  for (const e of plan.entries) {
    const row = rowOf.get(e.sourceId);
    if (!row?.url || e.action === 'skip') continue;
    for (const u of row.item.oldUrls) addOld(u, row.url);
  }
  for (const m of mediaList) {
    const to = mediaUrl(m.sourceId);
    if (!to) continue;
    for (const u of m.oldUrls ?? []) addOld(u, to);
    if (bundle.kind !== 'prismic') {
      try {
        add(new URL(m.url).pathname, to);
      } catch {
        // checked when it was found
      }
      for (const p of m.paths) add(p, to);
    }
  }
  for (const a of authors.values()) {
    const to = a.slug && app.authors?.enabled ? app.authors.url(a.slug) : null;
    if (to) for (const u of a.oldUrls ?? []) add(u, to);
  }

  // ---- 7. what a person should look at
  for (const m of mediaList) if (!m.alt) review.push({ kind: 'alt', text: `${m.url.split('/').pop().split('?')[0]} has no alt text.`, media: m.sourceId });
  for (const row of planned) if (row.collision) review.push({ kind: 'collision', text: row.problem ?? (row.replace ? `It replaces the entry already at ${row.c.id}/${row.id}.` : `${row.c.id}/${row.item.slug} was taken, so it comes in as ${row.c.id}/${row.id}.`), entry: row.item.sourceId });
  const items = planned.map((row) => {
    const p = plan.entries.find((x) => x.sourceId === row.item.sourceId);
    return {
      sourceId: row.item.sourceId,
      type: row.item.type,
      title: row.item.title,
      sourceStatus: row.item.status,
      collection: row.c.id,
      id: row.id ?? null,
      url: row.url ?? null,
      action: p?.action ?? 'skip',
      ...(row.problem || p?.problem ? { problem: row.problem ?? p.problem } : {}),
      ...(row.collision ? { collision: mapping.onCollision } : {}),
      ...(p?.rules ? { rules: p.rules } : {}),
      notes: review.filter((r) => r.entry === row.item.sourceId).length,
    };
  });
  const count = (list, key) => list.reduce((o, x) => ((o[x[key]] = (o[x[key]] ?? 0) + 1), o), {});
  const kinds = count(review, 'kind');
  const counts = {
    types: Object.fromEntries([...new Set(bundle.items.map((i) => i.type))].map((t) => [t, bundle.items.filter((i) => i.type === t).length])),
    entries: count(items.map((i) => ({ a: i.problem ? 'skip' : i.action })), 'a'),
    media: count(plan.media, 'action'),
    authors: count([...authors.values()], 'action'),
    redirects: redirects.size,
    ids: ID_KEYS.reduce((n, k) => n + Object.keys(ids[k]).length, 0),
    collisions: planned.filter((r) => r.collision).length,
    needsAlt: kinds.alt ?? 0,
    notConverted: (kinds.block ?? 0) + (kinds.shortcode ?? 0) + (kinds.card ?? 0) + (kinds.slice ?? 0),
    embeds: kinds.embed ?? 0,
    published: planned.filter((r) => r.item.status === 'published' && r.c.hasStatus && !r.problem).length,
    left,
    unusedMedia: unused,
    other: bundle.left ?? {},
  };
  return {
    source,
    mapping,
    payload,
    plan,
    fallback,
    items,
    media: plan.media.map((m) => ({ ...m, alt: Boolean(media.get(mediaList.find((x) => x.sourceId === m.sourceId)?.url)?.alt) })),
    authors: [...authors.values()].map(({ sourceId, slug, name, action }) => ({ sourceId, slug, name, action })),
    redirects: [...redirects.values()],
    ids,
    review,
    counts,
    placeholder: PLACEHOLDER,
  };
}
