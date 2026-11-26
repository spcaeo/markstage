// WordPress's REST API read for the site import (docs/IMPORT.md): every public post type (/wp-json/wp/v2/types: posts,
// pages and custom types such as a portfolio), the media the entries use, users, categories and tags, and, when the
// site has Rank Math (the rankmath/v1 namespace), each published entry's SEO head (getHead). With an application
// password the lists are read with context=edit (drafts too, and the block markup itself, content.raw); a list that
// does not allow it is read as the public sees it. Only GET requests are made, one at a time (the SEO heads two at a
// time), through the same reader as every source (sources.mjs: the SSRF guard, the read's limits, a credential sent
// to the site only and kept nowhere).
import { HttpError } from '../../util.mjs';
import { fromRest, isMachinery } from '../convert/wordpress.mjs';
import { readSeoHead } from '../convert/wp-head.mjs';
import { READ_LIMITS, allPages, reader, siteAddress } from './sources.mjs';

const STATUSES = 'publish,future,draft,pending,private';
const HEADS_AT_ONCE = 2;
const NS = /^[a-z0-9-]{1,40}\/v\d{1,2}$/;
const BASE = /^[A-Za-z0-9_-]{1,80}$/;
const DEFAULT_TYPES = [{ slug: 'post', name: 'Posts', rest_base: 'posts', hierarchical: false }, { slug: 'page', name: 'Pages', rest_base: 'pages', hierarchical: true }];
const soft = (e) => e instanceof HttpError && ['source-refused', 'source-failed', 'source-not-found'].includes(e.code);

/** The media ids an entry names: its featured image, wp-image-<id> classes, the blocks' "id", a gallery's ids. */
function mediaIdsOf(p) {
  const out = new Set();
  if (p.featured_media) out.add(Number(p.featured_media));
  const text = String(p.content?.raw ?? p.content?.rendered ?? '');
  for (const m of text.matchAll(/\bwp-image-(\d{1,12})\b/g)) out.add(Number(m[1]));
  for (const m of text.matchAll(/<!--\s*wp:(?:image|media-text|cover|file|video|audio)\s+\{[^}]*?"(?:id|mediaId)"\s*:\s*(\d{1,12})/g)) out.add(Number(m[1]));
  for (const m of text.matchAll(/\[gallery\b[^\]]*\bids\s*=\s*["']?([\d,\s]{1,2000})/g)) for (const id of m[1].split(',')) if (/^\s*\d{1,12}\s*$/.test(id)) out.add(Number(id));
  out.delete(0);
  return out;
}

/**
 * WordPress's REST API: {url, user?, password?} (an application password: Users › Profile › Application Passwords).
 * `media`: 'used' reads the media the entries name (by id), 'all' every one. A bundle (convert/bundle.mjs) with the
 * site's `types` and the read's own `notes`.
 */
export async function readWordpressApi(app, { url, user, password, media = 'used' }) {
  const base = siteAddress(url);
  const signed = Boolean(user && password);
  if (Boolean(user) !== Boolean(password)) throw new HttpError(422, 'invalid', 'Give both the user name and the application password, or neither.', { field: 'password' });
  const headers = signed ? { Authorization: `Basic ${Buffer.from(`${user}:${String(password).replace(/\s+/g, '')}`).toString('base64')}` } : {};
  const get = reader(app, [password, String(password ?? '').replace(/\s+/g, ''), headers.Authorization]);
  const notes = [];
  const root = (await get(`${base}/wp-json/`, { headers })).json ?? {};
  const namespaces = Array.isArray(root.namespaces) ? root.namespaces : [];

  const pages = (path, query) =>
    allPages(async (n) => {
      const r = await get(`${base}/wp-json/${path}?per_page=${READ_LIMITS.perPage}&page=${n}${query}`, { headers });
      return { items: Array.isArray(r.json) ? r.json : [], pages: Number(r.headers['x-wp-totalpages']) || null };
    });
  /** A list, with context=edit (and every status) when signed in; read as the public sees it when that is refused. */
  async function list(path, { status = false, extra = '', label = path } = {}) {
    if (!signed) return pages(path, extra);
    try {
      return await pages(path, `&context=edit${status ? `&status=${STATUSES}` : ''}${extra}`);
    } catch (e) {
      if (!soft(e)) throw e;
      const out = await pages(path, extra);
      notes.push({ kind: 'source', text: `WordPress did not give ${label} for editing (${e.message.replace(/\.$/, '')}), so ${label} were read as the public sees them: published ones only, as WordPress shows them.` });
      return out;
    }
  }

  // ---- the kinds of content: every public post type the API lists (posts and pages when it lists none)
  let types = [];
  try {
    const answer = (await get(`${base}/wp-json/wp/v2/types${signed ? '?context=edit' : ''}`, { headers })).json;
    types = Object.values(answer && typeof answer === 'object' ? answer : {}).filter((t) => t && typeof t.slug === 'string');
  } catch (e) {
    if (!soft(e)) throw e;
    notes.push({ kind: 'source', text: `WordPress did not list its kinds of content (${e.message.replace(/\.$/, '')}), so only posts and pages were read.` });
  }
  const content = types.filter((t) => t.slug !== 'attachment' && !isMachinery(t.slug) && t.viewable !== false && BASE.test(String(t.rest_base ?? '')) && NS.test(String(t.rest_namespace ?? 'wp/v2')));
  for (const d of DEFAULT_TYPES) if (!content.some((t) => t.slug === d.slug)) content.push(d);

  const lists = { post: [], page: [], other: [] };
  for (const t of content) {
    const read = await list(`${t.rest_namespace ?? 'wp/v2'}/${t.rest_base}`, { status: true, label: `the ${t.slug} entries` });
    (lists[t.slug] ?? lists.other).push(...read.filter((p) => p && typeof p === 'object'));
  }
  const all = [...lists.post, ...lists.page, ...lists.other];

  // ---- the media the entries use (by id, 100 to a request), or every one
  let files = [];
  if (media === 'all') files = await list('wp/v2/media', { label: 'the media files' });
  else {
    const ids = [...new Set(all.flatMap((p) => [...mediaIdsOf(p)]))].sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i += READ_LIMITS.perPage) files.push(...(await list('wp/v2/media', { extra: `&include=${ids.slice(i, i + READ_LIMITS.perPage).join(',')}`, label: 'the media files' })));
  }
  const users = await list('wp/v2/users', { label: 'the users' });
  const [categories, tags] = [await pages('wp/v2/categories', ''), await pages('wp/v2/tags', '')];

  // ---- Rank Math's head for each published entry, as readers and search engines get it
  if (namespaces.includes('rankmath/v1')) {
    const queue = all.filter((p) => p.status === 'publish' && typeof p.link === 'string' && /^https?:\/\//.test(p.link));
    let next = 0;
    const one = async () => {
      while (next < queue.length) {
        const p = queue[next++];
        try {
          const r = await get(`${base}/wp-json/rankmath/v1/getHead?url=${encodeURIComponent(p.link)}`, { headers });
          if (r.json?.success && typeof r.json.head === 'string') p.rankMathHead = readSeoHead(r.json.head);
          else p.rankMathProblem = 'its answer had no head';
        } catch (e) {
          if (!soft(e)) throw e;
          p.rankMathProblem = e.message.replace(/\.$/, '');
        }
      }
    };
    await Promise.all(Array.from({ length: HEADS_AT_ONCE }, one));
  }

  const bundle = fromRest({ site: { url: root.home ?? root.url ?? base, home: root.url, name: root.name ?? '' }, posts: lists.post, pages: lists.page, entries: lists.other, types: content, media: files, users, categories, tags });
  return { ...bundle, notes };
}
