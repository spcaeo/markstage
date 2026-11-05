// A WordPress site as a bundle (convert/bundle.mjs), from either of its two doors:
//   - a WXR export (Tools → Export, "All content"): posts, pages and other post types, attachments, authors,
//     categories and tags, postmeta (featured image, the alt text of each picture, Yoast and Rank Math fields);
//   - the REST API's answers (/wp-json/wp/v2: posts, pages, media, users, categories, tags), read by
//     import/site/sources.mjs.
// Each post's content goes through wp-content.mjs (blocks, the classic editor, shortcodes) into plain HTML. Old
// addresses kept for the redirects: the permalink, ?p=<id> (?page_id=<id> for a page), an attachment's page and
// ?attachment_id=<id>, an author's archive. Pure.
import { decodeEntities, hostsOf, isoOf, plainText, seoText } from './bundle.mjs';
import { wpContentToHtml } from './wp-content.mjs';
import { attr, closeOf, elements, field } from './xml.mjs';

// post types that are WordPress's own machinery, not content
const MACHINERY = /^(?:attachment|revision|nav_menu_item|custom_css|customize_changeset|oembed_cache|user_request|wp_block|wp_template|wp_template_part|wp_global_styles|wp_navigation|wp_font_family|wp_font_face|wpcf7_contact_form|feedback|acf-field|acf-field-group|elementor_library|jp_[\w-]+|wp_[\w-]+)$/;
const STATUS = { publish: 'published', future: 'scheduled', draft: 'draft', pending: 'draft', private: 'private' };
const SEO_KEYS = { title: ['_yoast_wpseo_title', 'rank_math_title'], description: ['_yoast_wpseo_metadesc', 'rank_math_description'] };

/** A path from a full address (with its query), or null. */
function pathOf(url) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** The SEO title and description of a post from its meta (Yoast first, then Rank Math), variables filled in. */
function seoOf(meta, { title, site, excerpt }) {
  const pick = (keys) => keys.map((k) => meta[k]).find((v) => typeof v === 'string' && v.trim());
  const out = { title: seoText(pick(SEO_KEYS.title), { title, site, excerpt }), description: seoText(pick(SEO_KEYS.description), { title, site, excerpt }) };
  return out.title || out.description ? out : null;
}

/** The item's old addresses: its permalink (when it has a real one) and its id link. */
function oldUrlsOf({ link, id, type, status }) {
  const out = [];
  const p = link ? pathOf(link) : null;
  if (p && !/[?&](?:p|page_id|post_type)=/.test(p) && status === 'publish') out.push(p);
  out.push(type === 'page' ? `/?page_id=${id}` : `/?p=${id}`);
  return out;
}

/**
 * Turn the read posts into bundle items. `posts`: [{id, type, status, title, slug, date, updated, author, tags,
 * categories, excerpt, content, link, thumbnail, meta, parent}], `attachments` by id.
 */
function itemsOf(posts, { attachments, site }) {
  const byParent = new Map();
  for (const a of attachments.values()) {
    if (!a.parent) continue;
    if (!byParent.has(a.parent)) byParent.set(a.parent, []);
    byParent.get(a.parent).push(a);
  }
  return posts.map((p) => {
    const conv = wpContentToHtml(p.content, { attachment: (id) => attachments.get(String(id)) ?? null, children: () => byParent.get(String(p.id)) ?? [] });
    const excerpt = plainText(p.excerpt);
    const title = decodeEntities(p.title).trim();
    const cover = p.thumbnail && attachments.get(String(p.thumbnail));
    return {
      sourceId: `${p.type === 'page' ? 'page' : 'post'}-${p.id}`,
      type: p.type,
      status: STATUS[p.status] ?? 'draft',
      title,
      slug: p.slug || null,
      date: p.date,
      updated: p.updated,
      authors: p.author ? [`author-${p.author}`] : [],
      tags: p.tags,
      categories: p.categories.filter((c) => !/^uncategori[sz]ed$/i.test(c)),
      excerpt: excerpt || null,
      html: conv.html,
      markdown: [],
      cover: cover ? { sourceId: cover.sourceId, url: cover.url, alt: cover.alt } : null,
      seo: seoOf(p.meta, { title, site: site.title, excerpt }),
      oldUrls: oldUrlsOf(p),
      notes: conv.notes,
      parent: p.parent ? `page-${p.parent}` : null,
    };
  });
}

function mediaOf(attachments) {
  return [...attachments.values()].map((a) => ({ sourceId: a.sourceId, url: a.url, alt: a.alt, title: a.title, oldUrls: [...(a.link ? [pathOf(a.link)].filter(Boolean) : []), `/?attachment_id=${a.id}`] }));
}

/** What the export had besides content: {type: count}. */
function leftOf(types) {
  const out = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
}

/** A WXR export (its text) as a bundle. Throws a plain Error when it is not one. */
export function readWxr(xml) {
  if (!/<rss[\s>]/.test(xml) || !xml.includes('xmlns:wp=')) throw new Error('This is not a WordPress export (Tools › Export gives an .xml file with <rss> and the wp: fields).');
  const chanEnd = xml.indexOf('<item>');
  const channel = chanEnd < 0 ? xml : xml.slice(0, chanEnd);
  const siteUrl = field(channel, 'wp:base_blog_url') || field(channel, 'link') || field(channel, 'wp:base_site_url') || '';
  const site = { url: siteUrl.replace(/\/+$/, ''), hosts: hostsOf(siteUrl, field(channel, 'wp:base_site_url') ?? '', field(channel, 'link') ?? ''), title: decodeEntities(field(channel, 'title') ?? '').trim() };

  const authors = elements(channel, 'wp:author').map((a) => {
    const login = field(a.inner, 'wp:author_login') ?? '';
    const name = decodeEntities(field(a.inner, 'wp:author_display_name') || [field(a.inner, 'wp:author_first_name'), field(a.inner, 'wp:author_last_name')].filter(Boolean).join(' ') || login).trim();
    return { sourceId: `author-${login}`, slug: login, name, bio: null, website: null, oldUrls: login ? [`/author/${login}/`] : [] };
  });

  const posts = [];
  const attachments = new Map();
  const left = [];
  for (let at = xml.indexOf('<item>'); at >= 0; at = xml.indexOf('<item>', at)) {
    const end = closeOf(xml, '</item>', at + 6);
    if (end < 0) break;
    const item = xml.slice(at + 6, end);
    at = end + 7;
    const type = field(item, 'wp:post_type') ?? '';
    const status = field(item, 'wp:status') ?? '';
    const id = String(field(item, 'wp:post_id') ?? '').trim();
    if (!id) continue;
    const meta = {};
    for (const m of elements(item, 'wp:postmeta')) {
      const k = field(m.inner, 'wp:meta_key');
      if (k) meta[k] = field(m.inner, 'wp:meta_value') ?? '';
    }
    const link = field(item, 'link') ?? '';
    if (type === 'attachment') {
      const url = field(item, 'wp:attachment_url') ?? field(item, 'guid') ?? '';
      attachments.set(id, { id, sourceId: `att-${id}`, url, alt: (meta._wp_attachment_image_alt ?? '').trim(), title: decodeEntities(field(item, 'title') ?? '').trim(), caption: plainText(field(item, 'excerpt:encoded') ?? ''), link, parent: String(field(item, 'wp:post_parent') ?? '0') === '0' ? null : String(field(item, 'wp:post_parent')) });
      continue;
    }
    if (MACHINERY.test(type) || !STATUS[status]) {
      left.push(MACHINERY.test(type) ? type : `${type} (${status || 'no status'})`);
      continue;
    }
    const terms = (domain) => elements(item, 'category').filter((c) => attr(c.attrs, 'domain') === domain).map((c) => decodeEntities(c.text).trim()).filter(Boolean);
    const parent = String(field(item, 'wp:post_parent') ?? '0');
    posts.push({
      id,
      type,
      status,
      title: field(item, 'title') ?? '',
      slug: field(item, 'wp:post_name') ?? '',
      date: isoOf(field(item, 'wp:post_date_gmt')) ?? isoOf(field(item, 'wp:post_date')) ?? isoOf(field(item, 'pubDate')),
      updated: isoOf(field(item, 'wp:post_modified_gmt')) ?? isoOf(field(item, 'wp:post_modified')),
      author: field(item, 'dc:creator') ?? '',
      tags: terms('post_tag'),
      categories: terms('category'),
      excerpt: field(item, 'excerpt:encoded') ?? '',
      content: field(item, 'content:encoded') ?? '',
      link,
      thumbnail: meta._thumbnail_id || null,
      meta,
      parent: parent === '0' ? null : parent,
    });
  }
  // a post's creator the export does not list as an author (a user since deleted, a partial export) is still one
  const known = new Set(authors.map((a) => a.slug));
  for (const login of new Set(posts.map((p) => p.author).filter(Boolean))) {
    if (!known.has(login)) authors.push({ sourceId: `author-${login}`, slug: login, name: login, bio: null, website: null, oldUrls: [`/author/${login}/`] });
  }
  return { kind: 'wordpress', site, items: itemsOf(posts, { attachments, site }), media: mediaOf(attachments), authors, left: leftOf(left) };
}

const rendered = (v) => (v && typeof v === 'object' ? (typeof v.raw === 'string' ? v.raw : v.rendered ?? '') : String(v ?? ''));

/**
 * The REST API's answers as a bundle: {site: {url, name}, posts, pages, media, users, categories, tags} (the lists
 * as WordPress sends them; with an application password they are the `context=edit` forms, with drafts and the
 * blocks' own text). Yoast's yoast_head_json and Rank Math's fields in `meta` give the SEO title and description.
 */
export function fromRest({ site: s, posts = [], pages = [], media = [], users = [], categories = [], tags = [] }) {
  const url = String(s?.url ?? '').replace(/\/+$/, '');
  const site = { url, hosts: hostsOf(url, s?.home ?? ''), title: decodeEntities(s?.name ?? '').trim() };
  const cat = new Map(categories.map((c) => [c.id, decodeEntities(c.name)]));
  const tag = new Map(tags.map((t) => [t.id, decodeEntities(t.name)]));
  const userSlug = new Map(users.map((u) => [u.id, u.slug]));
  const attachments = new Map(
    media.map((m) => [String(m.id), { id: String(m.id), sourceId: `att-${m.id}`, url: m.source_url ?? '', alt: String(m.alt_text ?? '').trim(), title: plainText(rendered(m.title)), caption: plainText(rendered(m.caption)), link: m.link ?? '', parent: m.post ? String(m.post) : null }]),
  );
  const list = [...posts, ...pages].filter((p) => p && (p.type === 'post' || p.type === 'page' || !MACHINERY.test(p.type ?? '')) && Object.hasOwn(STATUS, p.status));
  const raw = list.map((p) => {
    const meta = { ...(p.meta && typeof p.meta === 'object' && !Array.isArray(p.meta) ? p.meta : {}) };
    if (p.yoast_head_json) {
      meta._yoast_wpseo_title = p.yoast_head_json.title ?? meta._yoast_wpseo_title;
      meta._yoast_wpseo_metadesc = p.yoast_head_json.description ?? meta._yoast_wpseo_metadesc;
    }
    return {
      id: String(p.id),
      type: p.type ?? 'post',
      status: p.status,
      title: rendered(p.title),
      slug: p.slug ?? '',
      date: isoOf(p.date_gmt) ?? isoOf(p.date),
      updated: isoOf(p.modified_gmt) ?? isoOf(p.modified),
      author: userSlug.get(p.author) ?? '',
      tags: (p.tags ?? []).map((id) => tag.get(id)).filter(Boolean),
      categories: (p.categories ?? []).map((id) => cat.get(id)).filter(Boolean),
      excerpt: rendered(p.excerpt),
      content: rendered(p.content),
      link: p.link ?? '',
      thumbnail: p.featured_media ? String(p.featured_media) : null,
      meta,
      parent: p.parent ? String(p.parent) : null,
    };
  });
  const authors = users.map((u) => ({ sourceId: `author-${u.slug}`, slug: u.slug, name: decodeEntities(u.name ?? u.slug).trim(), bio: plainText(u.description ?? '') || null, website: /^https?:\/\//.test(u.url ?? '') ? u.url : null, oldUrls: [`/author/${u.slug}/`] }));
  return { kind: 'wordpress', site, items: itemsOf(raw, { attachments, site }), media: mediaOf(attachments), authors, left: {} };
}
