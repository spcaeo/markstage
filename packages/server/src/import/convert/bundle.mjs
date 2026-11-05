// What every source reader makes (convert/wordpress.mjs, ghost.mjs, prismic.mjs): one plain "bundle" of a whole site,
// the same shape whichever product it came from, so one plan and one run handle all three (import/site/). Pure: no
// network, no files.
//
// bundle = {
//   kind: 'wordpress' | 'ghost' | 'prismic',
//   site: {url, hosts, title},             the old site's address and the host names that are its own
//   items: [{sourceId, type, status, title, slug, date, updated, authors, tags, categories, excerpt, html,
//            markdown, cover, seo, oldUrls, notes, slices, data}],
//   media: [{sourceId, url, alt, title, oldUrls}],
//   authors: [{sourceId, slug, name, bio, website, oldUrls}],
//   left: {<type>: count},                 what the export had that is not content (menus, revisions, forms)
// }
// status: published | draft | scheduled | private. html: the content as HTML (blocks and cards already turned into
// plain HTML, with "Import note:" paragraphs where something could not be). markdown: Markdown pieces that stand for
// MSMDCARD<n>X placeholders in the html (a Ghost Markdown card). notes: [{kind, text}] for the review list.

/** The words that start every placeholder the import leaves in a text, so Find can list them all. */
export const PLACEHOLDER = 'Import note:';

/** A placeholder paragraph (HTML) and its note. */
export function placeholder(notes, kind, text, words = text) {
  notes.push({ kind, text });
  return `<p>${PLACEHOLDER} ${escHtml(words)}</p>`;
}

export const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The marker a Markdown card leaves in the HTML (letters and digits only, so the Markdown writer keeps it as it is). */
export const mdMarker = (n) => `MSMDCARD${n}X`;

/** A host name without "www.", lowercase. */
export const bareHost = (h) => String(h ?? '').toLowerCase().replace(/^www\./, '');

/** The site's own hosts from its addresses: each one with and without "www.". */
export function hostsOf(...urls) {
  const out = new Set();
  for (const u of urls) {
    try {
      const h = bareHost(new URL(u).hostname);
      if (h) out.add(h);
    } catch {
      // not an address
    }
  }
  return [...out];
}

/**
 * An address of the old site as {path, query} (the path decoded once and with one trailing slash for a page; the
 * query as URLSearchParams), or null when it is another site's or not an address. `base` resolves a relative one.
 */
export function oldPlace(url, { base, hosts }) {
  let u;
  try {
    u = new URL(String(url ?? '').trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!hosts.includes(bareHost(u.hostname))) return null;
  return { path: u.pathname, query: u.searchParams, hash: u.hash };
}

/** A page path compared the way a server matches it: lowercase, one trailing slash (a file keeps its name). */
export function pathKey(p) {
  let s = String(p ?? '');
  try {
    s = decodeURI(s);
  } catch {
    // kept as it is
  }
  s = s.toLowerCase().replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  if (/\.[a-z0-9]{1,5}$/.test(s)) return s;
  return s.endsWith('/') ? s : `${s}/`;
}

/** A path as an old address to redirect from: encoded as a browser sends it, a page with its trailing slash. */
export function fromPath(p) {
  const s = String(p ?? '').replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) return null;
  return /\.[A-Za-z0-9]{1,5}$/.test(s) || s.endsWith('/') ? s : `${s}/`;
}

/**
 * A WordPress upload's address as the original file: no size suffix (-300x200), no -scaled or -rotated, no query.
 * The size variants WordPress made all lead to the one file the import brings in.
 */
export function originalUpload(url) {
  return String(url ?? '').split(/[?#]/)[0].replace(/-(?:\d{1,5}x\d{1,5}|scaled|rotated)(\.[A-Za-z0-9]{2,5})$/, '$1');
}

/** A Ghost image's address as the original: no /size/w600/ (or /size/w600h400/, /format/webp/) part. */
export function originalGhostImage(url) {
  return String(url ?? '').split(/[?#]/)[0].replace(/\/content\/images\/(?:size\/[a-z0-9]+\/)?(?:format\/[a-z0-9]+\/)?/i, '/content/images/');
}

/** A Prismic image's address as the original file: the CDN's resizing and format parameters taken off, a crop kept. */
export function originalPrismicImage(url) {
  try {
    const u = new URL(String(url ?? ''));
    const rect = u.searchParams.get('rect');
    u.search = rect ? `?rect=${rect}` : '';
    u.hash = '';
    return u.href;
  } catch {
    return String(url ?? '');
  }
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', raquo: '»', laquo: '«', copy: '©', reg: '®', trade: '™' };
/** HTML entities in a short text (a title, an SEO field) as the characters they stand for. */
export const decodeEntities = (s) =>
  String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });

/**
 * An SEO title or description from Yoast (%%title%%) or Rank Math (%title%) with its variables filled in: the title,
 * the site's name, the separator and the excerpt; any other variable is taken out. Empty: null.
 */
export function seoText(raw, { title = '', site = '', excerpt = '' } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const known = { title, sitename: site, sitetitle: site, sep: '-', excerpt, excerpt_only: excerpt };
  const out = decodeEntities(raw)
    .replace(/%%([a-z_]+)%%|%([a-z_]+)%/gi, (m, a, b) => known[(a ?? b).toLowerCase()] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|–—-]+|[\s|–—-]+$/g, '')
    .trim();
  return out || null;
}

/** Plain text from a little HTML (an excerpt): tags out, entities decoded, spaces collapsed. */
export const plainText = (html) => decodeEntities(String(html ?? '').replace(/<[^>]{0,2000}>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * An ISO time from a source's date, or null (WordPress writes "0000-00-00 00:00:00" for none). A date with no zone
 * (WordPress's local post_date, when its GMT one is empty) is read as UTC, so the result never depends on the server.
 */
export function isoOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (/^0000-00-00/.test(s)) return null;
  const t = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s) ? Date.parse(`${s.replace(' ', 'T')}Z`) : Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** A slug as an entry id can take it: lowercase letters, digits and hyphens, at most 100. */
export function cleanSlug(s) {
  let v = String(s ?? '');
  try {
    v = decodeURIComponent(v);
  } catch {
    // kept as it is
  }
  return v
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '');
}

/** The image files the media library takes (pictures and PDFs), by the address's file name. */
export const isMediaFile = (url) => /\.(?:jpe?g|png|gif|webp|avif|heic|heif|pdf)$/i.test(String(url ?? '').split(/[?#]/)[0]);
