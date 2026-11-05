// A Prismic repository as a bundle (convert/bundle.mjs), from the documents its API sends
// (GET /api/v2/documents/search, read by import/site/sources.mjs). Rich text becomes HTML (then Markdown, like every
// source); a link to another document points at that document's new page; images come from Prismic's image CDN.
// Slices: a slice whose fields hold rich text is written as text in a Markdown entry; a JSON entry gets the site's
// sections where the mapping names one for that slice type; any other slice is an "Import note:" placeholder.
// Old addresses come from the site's own route patterns per type ({uid}, {lang}), Prismic itself has none. Pure.
import { escHtml, hostsOf, isoOf, placeholder } from './bundle.mjs';

/** How a link to another Prismic document is written until the plan knows that document's new page. */
export const DOC_LINK = 'https://prismic-document.invalid/';

const BLOCK = { paragraph: 'p', heading1: 'h1', heading2: 'h2', heading3: 'h3', heading4: 'h4', heading5: 'h5', heading6: 'h6', preformatted: 'pre' };
const SPAN = { strong: 'strong', em: 'em', label: 'span' };

/** Whether a field's value is Prismic rich text (a list of blocks with a type and text). */
export const isRichText = (v) => Array.isArray(v) && v.length > 0 && v.every((b) => b && typeof b === 'object' && typeof b.type === 'string' && ('text' in b || b.type === 'image' || b.type === 'embed'));

/** The plain words of rich text (a title), or a key text field as it is. */
export function richTextWords(v) {
  if (typeof v === 'string') return v.trim();
  if (!isRichText(v)) return '';
  return v.map((b) => b.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * A link field or span's data as an address: a web or media link's URL, a document link's new page through
 * `docUrl(id)` (null when that document is not imported). {url, kind: 'web'|'media'|'document'} or null.
 */
export function linkOf(d, docUrl = () => null) {
  if (!d || typeof d !== 'object') return null;
  if (d.link_type === 'Document' && d.id) {
    const u = docUrl(d.id);
    return u ? { url: u, kind: 'document' } : null;
  }
  if (typeof d.url === 'string' && /^(https?:|mailto:|tel:)/i.test(d.url)) return { url: d.url, kind: d.link_type === 'Media' ? 'media' : 'web' };
  return null;
}

/** One block's text with its spans (bold, italic, links) as HTML; overlapping spans are closed and opened again. */
function spansHtml(text, spans = [], docUrl) {
  const t = String(text ?? '');
  const cuts = new Set([0, t.length]);
  for (const s of spans) {
    cuts.add(Math.max(0, Math.min(t.length, s.start)));
    cuts.add(Math.max(0, Math.min(t.length, s.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  let out = '';
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    let piece = escHtml(t.slice(a, b)).replace(/\n/g, '<br>');
    for (const s of spans.filter((x) => x.start <= a && x.end >= b)) {
      if (s.type === 'hyperlink') {
        const l = linkOf(s.data, docUrl);
        if (l) piece = `<a href="${escHtml(l.url)}">${piece}</a>`;
      } else if (SPAN[s.type]) piece = `<${SPAN[s.type]}>${piece}</${SPAN[s.type]}>`;
    }
    out += piece;
  }
  return out;
}

/** Rich text as HTML: lists grouped, images and embeds in place. `notes` gets what could not be shown. */
export function richTextToHtml(blocks, { docUrl, notes = [] } = {}) {
  if (!Array.isArray(blocks)) return '';
  const out = [];
  let list = null;
  for (const b of blocks) {
    const li = b.type === 'list-item' ? 'ul' : b.type === 'o-list-item' ? 'ol' : null;
    if (list && list.tag !== li) {
      out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
      list = null;
    }
    if (li) {
      list = list ?? { tag: li, items: [] };
      list.items.push(`<li>${spansHtml(b.text, b.spans, docUrl)}</li>`);
      continue;
    }
    if (BLOCK[b.type]) {
      const tag = BLOCK[b.type];
      out.push(tag === 'pre' ? `<pre>${escHtml(b.text ?? '')}</pre>` : `<${tag}>${spansHtml(b.text, b.spans, docUrl)}</${tag}>`);
    } else if (b.type === 'image' && b.url) {
      const img = `<img src="${escHtml(b.url)}" alt="${escHtml(b.alt ?? '')}">`;
      const l = b.linkTo ? linkOf(b.linkTo, docUrl) : null;
      out.push(`<figure>${l ? `<a href="${escHtml(l.url)}">${img}</a>` : img}</figure>`);
    } else if (b.type === 'embed' && b.oembed?.embed_url) {
      notes.push({ kind: 'embed', text: `An embed (${b.oembed.provider_name ?? b.oembed.type ?? 'embed'}) is a link now: ${String(b.oembed.embed_url).slice(0, 200)}` });
      out.push(`<p><a href="${escHtml(b.oembed.embed_url)}">${escHtml(b.oembed.title || `Embedded content: ${b.oembed.provider_name ?? ''}`.trim())}</a></p>`);
    } else out.push(placeholder(notes, 'block', `A rich text block of type “${b.type}” could not be converted.`, `a block (${b.type}) was here.`));
  }
  if (list) out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);
  return out.join('\n');
}

/** A slice written as text: its rich text fields (primary, then each item's) as HTML; null when it has none. */
function sliceAsText(slice, ctx) {
  const parts = [];
  const take = (obj) => {
    for (const v of Object.values(obj ?? {})) {
      if (isRichText(v)) parts.push(richTextToHtml(v, ctx));
      else if (v && typeof v === 'object' && typeof v.url === 'string' && v.dimensions) parts.push(`<figure><img src="${escHtml(v.url)}" alt="${escHtml(v.alt ?? '')}"></figure>`);
    }
  };
  take(slice.primary ?? slice['non-repeat']);
  for (const it of slice.items ?? slice.repeat ?? []) take(it);
  return parts.length ? parts.join('\n') : null;
}

const getPath = (obj, p) => String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * The document's text and sections: {html, sections, notes}. `bodyKey`: the rich text field that is the text
 * (default: the first of body, content, text); the slice zone (`slices` or `body` holding slices) follows it.
 * `sliceMap` ({slice_type: {section, fields: {key: 'primary.x' | 'items'}}}) gives JSON sections.
 */
export function documentBody(doc, { bodyKey, sliceMap = {}, docUrl } = {}) {
  const notes = [];
  const data = doc.data ?? {};
  const ctx = { docUrl, notes };
  const parts = [];
  const key = bodyKey ?? ['body', 'content', 'text'].find((k) => isRichText(data[k]));
  if (key && isRichText(data[key])) parts.push(richTextToHtml(data[key], ctx));
  const zone = ['slices', 'body'].map((k) => data[k]).find((v) => Array.isArray(v) && v.some((s) => s && typeof s.slice_type === 'string'));
  const sections = [];
  for (const s of zone ?? []) {
    const m = sliceMap[s.slice_type];
    if (m && typeof m.section === 'string') {
      const value = {};
      for (const [k, from] of Object.entries(m.fields ?? {})) {
        const v = from === 'items' ? s.items ?? [] : getPath(s, from);
        value[k] = isRichText(v) ? (k.toLowerCase().endsWith('html') ? richTextToHtml(v, ctx) : { richText: v }) : v;
      }
      sections.push({ discriminant: m.section, value, sliceType: s.slice_type });
      continue;
    }
    const text = sliceAsText(s, ctx);
    if (text) parts.push(text);
    else parts.push(placeholder(notes, 'slice', `The slice “${s.slice_type}”${s.variation && s.variation !== 'default' ? ` (${s.variation})` : ''} has no text to write and no section is mapped for it.`, `a “${s.slice_type}” slice was here.`));
  }
  return { html: parts.join('\n'), sections, notes };
}

/** A route pattern ('/blog/{uid}/', '/{lang}/{uid}/') filled in for a document; null without a pattern or a uid. */
export function prismicPath(pattern, doc) {
  if (!pattern || !doc.uid) return null;
  return pattern.replace('{uid}', doc.uid).replace('{lang}', String(doc.lang ?? '').toLowerCase()).replace('{type}', doc.type).replace(/\/{2,}/g, '/');
}

/**
 * Prismic documents as a bundle. `fields` names the data keys per role ({title, excerpt, cover, date, seoTitle,
 * seoDescription, author, body}), `routes` the old site's address pattern per type. Items carry `data` (the
 * document's own fields) and `doc` (id, lang) so the plan can map more.
 */
export function fromPrismic(docs, { repo, siteUrl = '', fields = {}, routes = {}, sliceMap = {} } = {}) {
  const site = { url: String(siteUrl).replace(/\/+$/, ''), hosts: hostsOf(siteUrl), title: repo ?? '' };
  const byId = new Map(docs.map((d) => [d.id, d]));
  const pick = (data, key, fallbacks) => (key ? getPath(data, key) : fallbacks.map((k) => data[k]).find((v) => v !== undefined && v !== null && v !== ''));
  const items = docs.map((d) => {
    const data = d.data ?? {};
    // a link to another document is written as DOC_LINK<id>, put to its new page by the plan
    const body = documentBody(d, { bodyKey: fields.body, sliceMap, docUrl: (id) => (byId.has(id) ? `${DOC_LINK}${encodeURIComponent(id)}` : null) });
    const title = richTextWords(pick(data, fields.title, ['title', 'name', 'heading'])) || d.uid || d.id;
    const coverField = pick(data, fields.cover, ['featured_image', 'image', 'cover', 'hero_image']);
    const author = pick(data, fields.author, ['author']);
    return {
      sourceId: `doc-${d.id}`,
      type: d.type,
      status: 'published',
      title,
      slug: d.uid ?? null,
      date: isoOf(pick(data, fields.date, ['date', 'publish_date', 'published_at'])) ?? isoOf(d.first_publication_date),
      updated: isoOf(d.last_publication_date),
      authors: typeof author === 'string' && author.trim() ? [`name:${author.trim()}`] : [],
      tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
      categories: [],
      excerpt: richTextWords(pick(data, fields.excerpt, ['excerpt', 'summary', 'description'])) || null,
      html: body.html,
      markdown: [],
      sections: body.sections,
      cover: coverField && typeof coverField.url === 'string' ? { url: coverField.url, alt: String(coverField.alt ?? '').trim() } : null,
      seo: ((t, s) => (t || s ? { title: t || null, description: s || null } : null))(richTextWords(pick(data, fields.seoTitle, ['meta_title', 'seo_title'])), richTextWords(pick(data, fields.seoDescription, ['meta_description', 'seo_description']))),
      oldUrls: [prismicPath(routes[d.type], d)].filter(Boolean),
      notes: body.notes,
      lang: d.lang ?? null,
    };
  });
  return { kind: 'prismic', site, items, media: [], authors: [], left: {} };
}
