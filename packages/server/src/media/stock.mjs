// Stock photos in the media picker (Unsplash or Pexels, with the site's own key from the server config). The key
// never leaves the server. Search results carry thumbnails through this server (the editor's CSP allows images from
// 'self' only); an import fetches the photo again by its id from the provider (never a URL the browser sent), from
// the provider's image hosts only, and stores it like an upload, with the photographer's credit kept on the file.
import { HttpError, badRequest, forbidden, invalid, newToken, notFound } from '../util.mjs';
import { can } from '../roles.mjs';
import { sniff } from './sniff.mjs';

const TIMEOUT_MS = 15_000;
const THUMB_MAX = 2 * 1024 * 1024;
const THUMBS_KEPT = 600;

/** One adapter per provider: the request, and the answer turned into the same shape. */
const PROVIDERS = {
  unsplash: {
    label: 'Unsplash',
    auth: (key) => ({ Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' }),
    searchUrl: (base, q, page, perPage) => `${base}/search/photos?${new URLSearchParams({ query: q, page, per_page: perPage, content_filter: 'high' })}`,
    photoUrl: (base, id) => `${base}/photos/${encodeURIComponent(id)}`,
    list: (body) => ({ items: body.results ?? [], total: body.total ?? 0 }),
    item: (p) => ({
      id: String(p.id),
      width: p.width ?? null,
      height: p.height ?? null,
      alt: p.alt_description ?? p.description ?? '',
      author: p.user?.name ?? '',
      authorUrl: p.user?.links?.html ?? null,
      sourceUrl: p.links?.html ?? null,
      thumb: p.urls?.small ?? p.urls?.thumb ?? null,
      full: p.urls?.regular ?? p.urls?.full ?? null,
      // Unsplash asks for this to be called when a photo is used (it counts the download for the photographer)
      track: p.links?.download_location ?? null,
    }),
  },
  pexels: {
    label: 'Pexels',
    auth: (key) => ({ Authorization: key }),
    searchUrl: (base, q, page, perPage) => `${base}/v1/search?${new URLSearchParams({ query: q, page, per_page: perPage })}`,
    photoUrl: (base, id) => `${base}/v1/photos/${encodeURIComponent(id)}`,
    list: (body) => ({ items: body.photos ?? [], total: body.total_results ?? 0 }),
    item: (p) => ({
      id: String(p.id),
      width: p.width ?? null,
      height: p.height ?? null,
      alt: p.alt ?? '',
      author: p.photographer ?? '',
      authorUrl: p.photographer_url ?? null,
      sourceUrl: p.url ?? null,
      thumb: p.src?.medium ?? p.src?.small ?? null,
      full: p.src?.large2x ?? p.src?.original ?? null,
      track: null,
    }),
  },
};

export function stockRoutes(router, app, { storeImage, toPublic }) {
  const st = app.config.stock;
  const doFetch = app.fetch ?? globalThis.fetch;
  // token -> provider thumbnail URL (only URLs the provider sent us), in the database: the browser's thumbnail request
  // may land on another server process than its search (docs/SCALING.md)
  const { db } = app;

  /** A URL on one of the provider's image hosts, https (http only for loopback test doubles in development). */
  function allowed(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const loop = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    return st.imageHosts.includes(u.host) && (u.protocol === 'https:' || (st.httpLoopback && loop && u.protocol === 'http:'));
  }

  async function call(url, { json = true, max = Infinity, headers = {} } = {}) {
    let res;
    try {
      res = await doFetch(url, { headers, redirect: json ? 'error' : 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new HttpError(502, 'provider', `${PROVIDERS[st.provider].label} did not answer. Try again in a moment.`);
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'provider', `${PROVIDERS[st.provider].label} refused the site's key. Ask the server admin to check it.`);
    if (res.status === 404) throw notFound('The provider has no such photo.');
    if (res.status === 429) throw new HttpError(429, 'rate-limited', `The ${PROVIDERS[st.provider].label} hourly limit is used up. Try again later.`);
    if (!res.ok) throw new HttpError(502, 'provider', `${PROVIDERS[st.provider].label} answered with an error (${res.status}).`);
    // a redirect may only land on an image host too
    if (!json && res.url && !allowed(res.url)) throw new HttpError(502, 'provider', 'The photo is not on the provider image host.');
    if (json) return res.json();
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > max) throw new HttpError(413, 'too-large', 'The photo is larger than the upload limit.');
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > max) throw new HttpError(413, 'too-large', 'The photo is larger than the upload limit.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  const provider = () => {
    if (!st) throw new HttpError(404, 'not-configured', 'Stock photos are not set up on this server.');
    return PROVIDERS[st.provider];
  };
  const api = (ctx) => {
    if (!can(ctx.user, 'media.upload')) throw forbidden('Your role cannot add images.');
    return provider();
  };

  function thumbToken(url) {
    const token = newToken(12);
    db.prepare('INSERT INTO stock_thumbs (token, url, at) VALUES (?, ?, ?)').run(token, url, Date.now());
    return token;
  }
  const keepRecent = () => db.prepare('DELETE FROM stock_thumbs WHERE rowid NOT IN (SELECT rowid FROM stock_thumbs ORDER BY rowid DESC LIMIT ?)').run(THUMBS_KEPT);

  router.add('GET', '/stock', () => (st ? { enabled: true, provider: st.provider, label: PROVIDERS[st.provider].label } : { enabled: false }));

  router.add('GET', '/stock/search', async (ctx) => {
    const p = api(ctx);
    const q = String(ctx.query.get('q') ?? '').trim();
    if (!q || q.length > 100) throw invalid({ q: 'Type what the photo should show (up to 100 characters).' });
    const page = Math.min(Math.max(Number(ctx.query.get('page')) || 1, 1), 50);
    const perPage = Math.min(Math.max(Number(ctx.query.get('perPage')) || 24, 1), 30);
    const body = await call(p.searchUrl(st.apiBase, q, page, perPage), { headers: p.auth(st.key) });
    const { items, total } = p.list(body);
    const out = {
      provider: st.provider,
      label: p.label,
      page,
      perPage,
      total,
      items: items.map(p.item).map(({ thumb, full: _f, track: _t, ...rest }) => ({ ...rest, thumb: thumb && allowed(thumb) ? `stock/thumb/${thumbToken(thumb)}` : null })),
    };
    keepRecent();
    return out;
  });

  // a thumbnail from the last searches, fetched from the provider's image host and checked to be an image
  router.add('GET', '/stock/thumb/:t', async (ctx) => {
    provider();
    const url = db.prepare('SELECT url FROM stock_thumbs WHERE token = ?').get(String(ctx.params.t))?.url;
    if (!url) throw notFound('This thumbnail has expired. Search again.');
    const buf = await call(url, { json: false, max: THUMB_MAX });
    const { type, svg } = sniff(buf);
    if (!type || svg) throw new HttpError(502, 'provider', 'The thumbnail is not an image.');
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', type);
    ctx.res.setHeader('Cache-Control', 'private, max-age=3600');
    ctx.res.end(buf);
  });

  router.add('POST', '/stock/import', async (ctx) => {
    const p = api(ctx);
    const id = String(ctx.body.id ?? '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw badRequest('Send the photo id from the search.');
    const photo = p.item(await call(p.photoUrl(st.apiBase, id), { headers: p.auth(st.key) }));
    if (!photo.full || !allowed(photo.full)) throw new HttpError(502, 'provider', 'The provider did not give a usable photo link.');
    const raw = await call(photo.full, { json: false, max: app.config.media.maxBytes });
    // the download count goes to the provider's own API only (it carries the key); best effort, never blocks
    if (photo.track?.startsWith(`${st.apiBase}/`)) call(photo.track, { headers: p.auth(st.key) }).catch(() => {});
    const credit = { provider: st.provider, label: p.label, id: photo.id, author: photo.author, authorUrl: photo.authorUrl, sourceUrl: photo.sourceUrl };
    const alt = typeof ctx.body.alt === 'string' ? ctx.body.alt : photo.alt;
    const name = `${st.provider}-${photo.author || 'photo'}-${photo.id}`;
    const row = await storeImage(ctx, raw, name, { credit, alt, action: 'media.stock' });
    ctx.status = 201;
    return toPublic(row);
  });
}
