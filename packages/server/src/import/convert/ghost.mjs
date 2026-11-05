// A Ghost site as a bundle (convert/bundle.mjs), from its JSON export (Settings → Labs → Export) or the Content
// API's answers. A post's text is Lexical (Ghost 5), Mobiledoc (older) or, from the Content API, HTML; the first two
// are turned into plain HTML here, card by card: image, gallery, bookmark, callout, embed, code, HTML, Markdown,
// divider, button, toggle, header; a card we do not know becomes an "Import note:" paragraph. `__GHOST_URL__` (how an
// export writes the site's own address) becomes the site's address. Old addresses: /<slug>/ for posts and pages (or
// the site's own pattern), /tag/<slug>/ is not kept, /author/<slug>/ for authors. Pure.
import { decodeEntities, escHtml, hostsOf, isoOf, mdMarker, placeholder, plainText } from './bundle.mjs';

// a post that was only sent as an email has no page on the old site: it comes in as a draft, noted
const STATUS = { published: 'published', draft: 'draft', scheduled: 'scheduled', sent: 'draft' };
const url = (s, site) => String(s ?? '').split('__GHOST_URL__').join(site);
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'another site';
  }
};

/** The cards both formats share, as HTML. `md` collects Markdown cards; `notes` what was not converted. */
function card(name, p, { md, notes, site }) {
  const img = (src, alt = '', caption = '') => `<figure><img src="${escHtml(url(src, site))}" alt="${escHtml(alt)}">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  switch (name) {
    case 'image':
      return p.src ? img(p.src, p.alt, p.caption) : '';
    case 'gallery':
      return `<figure>${(p.images ?? []).filter((i) => i?.src).map((i) => `<img src="${escHtml(url(i.src, site))}" alt="${escHtml(i.alt ?? '')}">`).join('')}${p.caption ? `<figcaption>${p.caption}</figcaption>` : ''}</figure>`;
    case 'bookmark': {
      const title = p.metadata?.title || p.url;
      return p.url ? `<p><a href="${escHtml(url(p.url, site))}">${escHtml(title)}</a>${p.metadata?.description ? `: ${escHtml(p.metadata.description)}` : ''}</p>` : '';
    }
    case 'callout': {
      // Lexical keeps the text as HTML paragraphs, Mobiledoc as plain text: the emoji goes at the start of the first
      const words = url(p.calloutText ?? '', site).trim();
      const emoji = p.calloutEmoji ? `${escHtml(p.calloutEmoji)} ` : '';
      return `<blockquote>${/^<p[\s>]/i.test(words) ? words.replace(/^<p([^>]*)>/i, `<p$1>${emoji}`) : `<p>${emoji}${words}</p>`}</blockquote>`;
    }
    case 'embed': {
      if (!p.url) return placeholder(notes, 'card', 'An embed card with no address was left out.', 'an embed was here.');
      notes.push({ kind: 'embed', text: `An embed card (${p.embedType ?? p.type ?? 'embed'}) from ${hostOf(p.url)} is a link now: ${String(p.url).slice(0, 200)}` });
      return `<p><a href="${escHtml(p.url)}">Embedded content: ${escHtml(hostOf(p.url))}</a></p>`;
    }
    case 'code':
    case 'codeblock':
      return `<pre><code>${escHtml(p.code ?? '')}</code></pre>${p.caption ? `<p>${p.caption}</p>` : ''}`;
    case 'html':
      if (/<(script|iframe|form|style|object|embed)\b/i.test(p.html ?? '')) notes.push({ kind: 'html', text: 'An HTML card had a script, a form or an embed; only its text and links came in. Check it.' });
      return url(p.html ?? '', site);
    case 'markdown':
      md.push(url(p.markdown ?? '', site));
      return `<p>${mdMarker(md.length - 1)}</p>`;
    case 'hr':
    case 'horizontalrule':
      return '<hr>';
    case 'button':
      return p.buttonUrl ? `<p><a href="${escHtml(url(p.buttonUrl, site))}">${escHtml(p.buttonText || p.buttonUrl)}</a></p>` : '';
    case 'toggle':
      return `<h3>${p.heading ?? ''}</h3>${url(p.content ?? '', site)}`;
    case 'header':
      return `${p.header ? `<h2>${p.header}</h2>` : ''}${p.subheader ? `<p>${p.subheader}</p>` : ''}`;
    case 'paywall':
      return '';
    case 'video':
    case 'audio':
    case 'file': {
      const src = url(p.src ?? '', site);
      if (!src) return '';
      notes.push({ kind: 'card', text: `A ${name} card is a link to its file now (${name === 'file' ? 'files other than pictures and PDFs' : 'sound and video files'} are not brought in): ${src.slice(0, 200)}` });
      return `<p><a href="${escHtml(src)}">${escHtml(p.fileName || p.title || src.split('/').pop())}</a></p>`;
    }
    default:
      return placeholder(notes, 'card', `The Ghost card “${name}” could not be converted.`, `a Ghost card (${name}) was here and could not be converted.`);
  }
}

/** A Mobiledoc document (object or its JSON text) as HTML: {html, markdown, notes}. */
export function mobiledocToHtml(doc, { site = '' } = {}) {
  const notes = [];
  const md = [];
  let d = doc;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return { html: '', markdown: [], notes: [{ kind: 'card', text: 'The post’s Mobiledoc could not be read.' }] };
    }
  }
  const markups = d?.markups ?? [];
  const atoms = d?.atoms ?? [];
  const cards = d?.cards ?? [];
  const markersHtml = (markers) => {
    let out = '';
    const open = [];
    for (const [type, opens, closes, value] of markers ?? []) {
      for (const i of opens ?? []) {
        const [tag, attrs = []] = markups[i] ?? ['span'];
        const t = String(tag).toLowerCase();
        const a = [];
        for (let k = 0; k < attrs.length; k += 2) if (attrs[k] === 'href') a.push(` href="${escHtml(url(attrs[k + 1], site))}"`);
        out += `<${t}${a.join('')}>`;
        open.push(t);
      }
      if (type === 1) {
        const [aname, text] = atoms[value] ?? [];
        out += escHtml(aname === 'soft-return' ? '\n' : text ?? '');
      } else out += escHtml(value ?? '');
      for (let k = 0; k < closes; k++) out += `</${open.pop()}>`;
    }
    while (open.length) out += `</${open.pop()}>`;
    return out;
  };
  const parts = [];
  for (const s of d?.sections ?? []) {
    if (s[0] === 1) {
      const tag = /^(p|h[1-6]|blockquote|aside)$/i.test(s[1]) ? s[1].toLowerCase() : 'p';
      parts.push(tag === 'aside' ? `<blockquote><p>${markersHtml(s[2])}</p></blockquote>` : `<${tag}>${markersHtml(s[2])}</${tag}>`);
    } else if (s[0] === 3) {
      const tag = s[1] === 'ol' ? 'ol' : 'ul';
      parts.push(`<${tag}>${(s[2] ?? []).map((m) => `<li>${markersHtml(m)}</li>`).join('')}</${tag}>`);
    } else if (s[0] === 2) parts.push(`<figure><img src="${escHtml(url(s[1], site))}" alt=""></figure>`);
    else if (s[0] === 10) {
      const [name, payload] = cards[s[1]] ?? ['unknown', {}];
      parts.push(card(name, payload ?? {}, { md, notes, site }));
    }
  }
  return { html: parts.join('\n'), markdown: md, notes };
}

// Lexical's text formats (a bitmask)
const FORMATS = [[1, 'strong'], [2, 'em'], [4, 's'], [8, 'u'], [16, 'code'], [32, 'sub'], [64, 'sup']];
const LEXICAL_CARDS = new Set(['image', 'gallery', 'bookmark', 'callout', 'embed', 'codeblock', 'html', 'markdown', 'horizontalrule', 'button', 'toggle', 'header', 'paywall', 'video', 'audio', 'file']);

/** A Lexical document (object or its JSON text) as HTML: {html, markdown, notes}. */
export function lexicalToHtml(doc, { site = '' } = {}) {
  const notes = [];
  const md = [];
  let d = doc;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return { html: '', markdown: [], notes: [{ kind: 'card', text: 'The post’s Lexical text could not be read.' }] };
    }
  }
  const inline = (nodes = [], depth = 0) =>
    nodes
      .map((n) => {
        if (depth > 50) return '';
        const type = String(n?.type ?? '').replace(/^extended-/, '');
        if (type === 'text') {
          let t = escHtml(n.text ?? '');
          for (const [bit, tag] of FORMATS) if ((n.format ?? 0) & bit) t = `<${tag}>${t}</${tag}>`;
          return t;
        }
        if (type === 'linebreak') return '<br>';
        if (type === 'link' || type === 'autolink') return `<a href="${escHtml(url(n.url, site))}">${inline(n.children, depth + 1)}</a>`;
        return inline(n.children, depth + 1);
      })
      .join('');
  const block = (n, depth = 0) => {
    if (depth > 50 || !n) return '';
    const type = String(n.type ?? '').replace(/^extended-/, '');
    if (type === 'paragraph') return `<p>${inline(n.children)}</p>`;
    if (type === 'heading') return `<${/^h[1-6]$/.test(n.tag) ? n.tag : 'h2'}>${inline(n.children)}</${/^h[1-6]$/.test(n.tag) ? n.tag : 'h2'}>`;
    if (type === 'quote' || type === 'aside') return `<blockquote><p>${inline(n.children)}</p></blockquote>`;
    if (type === 'list') {
      const tag = n.listType === 'number' ? 'ol' : 'ul';
      return `<${tag}>${(n.children ?? []).map((li) => `<li>${inline((li.children ?? []).filter((c) => c.type !== 'list'))}${(li.children ?? []).filter((c) => c.type === 'list').map((c) => block(c, depth + 1)).join('')}</li>`).join('')}</${tag}>`;
    }
    if (LEXICAL_CARDS.has(type)) return card(type, n, { md, notes, site });
    if (n.children) return n.children.map((c) => block(c, depth + 1)).join('\n');
    return card(type || 'unknown', n, { md, notes, site });
  };
  return { html: (d?.root?.children ?? []).map((n) => block(n)).join('\n'), markdown: md, notes };
}

/**
 * Ghost's card HTML (the Content API's, an HTML card's) tidied before the Markdown step: a bookmark card is its
 * link and title, a callout a quote, an embed card's player a link (its caption kept). For htmlToMarkdown's
 * `transform`.
 */
export function ghostTransform(node) {
  const cls = ` ${node.attrs?.class ?? ''} `;
  if (!cls.includes(' kg-')) return undefined;
  const find = (n, c) => (` ${n.attrs?.class ?? ''} `.includes(` ${c} `) ? n : (n.children ?? []).map((k) => (k.tag ? find(k, c) : null)).find(Boolean) ?? null);
  const text = (n) => (n ? (n.text !== undefined ? n.text : (n.children ?? []).map(text).join('')) : '').replace(/\s+/g, ' ').trim();
  if (cls.includes(' kg-bookmark-card ')) {
    const a = find(node, 'kg-bookmark-container');
    const href = a?.attrs?.href;
    if (!href) return null;
    const title = text(find(node, 'kg-bookmark-title')) || href;
    return { tag: 'p', attrs: {}, children: [{ tag: 'a', attrs: { href }, children: [{ text: title }] }] };
  }
  if (cls.includes(' kg-callout-card ')) {
    const words = find(node, 'kg-callout-text') ?? node;
    const emoji = text(find(node, 'kg-callout-emoji'));
    return { tag: 'blockquote', attrs: {}, children: [{ tag: 'p', attrs: {}, children: [...(emoji ? [{ text: `${emoji} ` }] : []), ...(words.children ?? [])] }] };
  }
  return undefined;
}

/** Ghost's old address for a post or page from the site's pattern ('/{slug}/', '/blog/{slug}/', '/{year}/{month}/{slug}/'). */
export function ghostPath(pattern, { slug, date }) {
  const d = date ? new Date(date) : null;
  const pad = (n) => String(n).padStart(2, '0');
  return String(pattern || '/{slug}/')
    .replace('{slug}', slug)
    .replace('{year}', d ? String(d.getUTCFullYear()) : '')
    .replace('{month}', d ? pad(d.getUTCMonth() + 1) : '')
    .replace('{day}', d ? pad(d.getUTCDate()) : '')
    .replace(/\/{2,}/g, '/');
}

function item(p, { site, tags, authors, meta, permalink }) {
  const conv = p.lexical ? lexicalToHtml(p.lexical, { site: site.url }) : p.mobiledoc ? mobiledocToHtml(p.mobiledoc, { site: site.url }) : { html: url(p.html ?? '', site.url), markdown: [], notes: [] };
  const m = meta ?? {};
  const type = p.type === 'page' ? 'page' : 'post';
  const status = STATUS[p.status] ?? 'draft';
  const date = isoOf(p.published_at) ?? isoOf(p.created_at);
  const visible = (t) => t && t.visibility !== 'internal' && !String(t.name ?? '').startsWith('#');
  const cover = p.feature_image ? { url: url(p.feature_image, site.url), alt: String(m.feature_image_alt ?? p.feature_image_alt ?? '').trim() } : null;
  const seo = { title: (m.meta_title ?? p.meta_title ?? '').trim() || null, description: (m.meta_description ?? p.meta_description ?? '').trim() || null };
  if (p.status === 'sent') conv.notes.push({ kind: 'status', text: 'In Ghost this post was only sent as an email, so it had no page; it comes in as a draft.' });
  if (p.visibility && p.visibility !== 'public') conv.notes.push({ kind: 'status', text: `In Ghost this ${type} was for ${p.visibility === 'paid' ? 'paying members' : p.visibility === 'members' ? 'members' : `“${p.visibility}”`} only; here it is a normal page once published.` });
  return {
    sourceId: `${type}-${p.id}`,
    type,
    status,
    title: decodeEntities(p.title ?? '').trim(),
    slug: p.slug ?? null,
    date,
    updated: isoOf(p.updated_at),
    authors: authors.map((a) => `author-${a}`),
    tags: tags.filter(visible).map((t) => decodeEntities(t.name).trim()),
    categories: [],
    excerpt: (p.custom_excerpt ?? '').trim() || null,
    html: conv.html,
    markdown: conv.markdown,
    cover,
    seo: seo.title || seo.description ? seo : null,
    oldUrls: status === 'published' && p.slug ? [ghostPath(permalink[type], { slug: p.slug, date })] : [],
    notes: conv.notes,
  };
}

const authorOf = (u, site) => ({ sourceId: `author-${u.slug}`, slug: u.slug, name: decodeEntities(u.name ?? u.slug).trim(), bio: plainText(u.bio ?? '') || null, website: /^https?:\/\//.test(u.website ?? '') ? u.website : null, oldUrls: [`/author/${u.slug}/`], photo: u.profile_image ? url(u.profile_image, site) : null });

/**
 * A Ghost JSON export (its parsed object) as a bundle. `siteUrl` is the old site's address (an export does not
 * carry it: it writes __GHOST_URL__); `permalink` {post, page} the site's address pattern (default /{slug}/).
 */
export function readGhostExport(json, { siteUrl, permalink = {} } = {}) {
  const db = Array.isArray(json?.db) ? json.db[0] : json?.db ?? json;
  const data = db?.data;
  if (!data || !Array.isArray(data.posts)) throw new Error('This is not a Ghost export (Settings › Labs › Export gives a .json file with db[0].data.posts).');
  const siteSetting = (data.settings ?? []).find((s) => s.key === 'title')?.value;
  const base = String(siteUrl ?? '').replace(/\/+$/, '');
  const site = { url: base, hosts: hostsOf(base), title: decodeEntities(siteSetting ?? '').trim() };
  const perm = { post: permalink.post ?? '/{slug}/', page: permalink.page ?? '/{slug}/' };
  const tagById = new Map((data.tags ?? []).map((t) => [t.id, t]));
  const userById = new Map((data.users ?? []).map((u) => [u.id, u]));
  const joined = (rows, key, other) => {
    const m = new Map();
    for (const r of [...(rows ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
      if (!m.has(r.post_id)) m.set(r.post_id, []);
      m.get(r.post_id).push(r[key]);
    }
    return (id) => (m.get(id) ?? []).map((x) => other.get(x)).filter(Boolean);
  };
  const tagsOf = joined(data.posts_tags, 'tag_id', tagById);
  const authorsOf = joined(data.posts_authors, 'author_id', userById);
  const metaOf = new Map((data.posts_meta ?? []).map((m) => [m.post_id, m]));
  const items = data.posts
    .filter((p) => Object.hasOwn(STATUS, p.status))
    .map((p) => {
      const as = authorsOf(p.id);
      const own = as.length ? as : [userById.get(p.author_id)].filter(Boolean);
      return item(p, { site, tags: tagsOf(p.id), authors: own.map((u) => u.slug), meta: metaOf.get(p.id), permalink: perm });
    });
  const left = {};
  for (const p of data.posts) if (!Object.hasOwn(STATUS, p.status)) left[`${p.type ?? 'post'} (${p.status})`] = (left[`${p.type ?? 'post'} (${p.status})`] ?? 0) + 1;
  return { kind: 'ghost', site, items, media: [], authors: (data.users ?? []).map((u) => authorOf(u, base)), left };
}

/** The Content API's answers ({posts, pages} with tags and authors included, html format) as a bundle. */
export function fromGhostContentApi({ siteUrl, title = '', posts = [], pages = [], permalink = {} }) {
  const base = String(siteUrl ?? '').replace(/\/+$/, '');
  const site = { url: base, hosts: hostsOf(base), title };
  const perm = { post: permalink.post ?? '/{slug}/', page: permalink.page ?? '/{slug}/' };
  const seen = new Map();
  const items = [...posts.map((p) => ({ ...p, type: 'post' })), ...pages.map((p) => ({ ...p, type: 'page' }))].map((p) => {
    for (const a of p.authors ?? []) seen.set(a.slug, a);
    return item({ ...p, status: 'published', lexical: null, mobiledoc: null }, { site, tags: p.tags ?? [], authors: (p.authors ?? []).map((a) => a.slug), meta: null, permalink: perm });
  });
  return { kind: 'ghost', site, items, media: [], authors: [...seen.values()].map((u) => authorOf(u, base)), left: {} };
}
