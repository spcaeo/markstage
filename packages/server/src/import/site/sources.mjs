// Reading a whole site for the site import (docs/IMPORT.md): an uploaded export (WordPress WXR, Ghost JSON) or an
// API (WordPress REST with an application password, Ghost's Content API, Prismic's API), into a bundle
// (convert/bundle.mjs). Every request goes through the SSRF guard (library/fetch.mjs: public addresses only, checked
// after DNS and at every redirect, ports 80 and 443), answers must be JSON, each at most 20 MB and 20 s, the whole
// read at most 64 MB and 5 minutes, at most 50 pages of 100 per list.
// A credential (an application password, a Content API key, a Prismic token) is used for this read only: it lives
// in memory while the read runs, goes to the source's own origin only (a redirect elsewhere is asked without it), is
// taken out of any error, and is never written to the database, a log, the audit or an answer.
import { safeFetch } from '../../library/fetch.mjs';
import { HttpError, badRequest } from '../../util.mjs';
import { fromGhostContentApi, readGhostExport } from '../convert/ghost.mjs';
import { fromPrismic } from '../convert/prismic.mjs';
import { fromRest, readWxr } from '../convert/wordpress.mjs';

export const READ_LIMITS = Object.freeze({ answerBytes: 20 * 1024 * 1024, answerMs: 20_000, totalBytes: 64 * 1024 * 1024, totalMs: 5 * 60_000, pages: 50, perPage: 100 });
const REPO = /^[a-z0-9][a-z0-9-]{0,62}$/;
const HIDDEN = '[hidden]';

/** An uploaded export as a bundle: a WordPress export (.xml) or a Ghost export (.json). */
export function readExportFile(kind, name, buf, opts = {}) {
  const text = buf.toString('utf8');
  const head = text.slice(0, 512).trimStart();
  try {
    if (kind === 'wordpress') {
      if (!head.startsWith('<')) throw new Error('A WordPress export is an .xml file (Tools › Export, All content).');
      return readWxr(text);
    }
    if (kind === 'ghost') {
      if (!head.startsWith('{')) throw new Error('A Ghost export is a .json file (Settings › Labs › Export your content).');
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`${name} is not JSON. Export it again from Ghost (Settings › Labs › Export your content).`);
      }
      return readGhostExport(json, opts);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, 'invalid-export', e.message);
  }
  throw badRequest('Prismic has no export file: give the repository name (and an access token if it is private).');
}

/** The address of the old site, checked: an https or http address with no name and password in it. */
export function siteAddress(v, what = 'the site’s address') {
  let u;
  try {
    u = new URL(String(v ?? '').trim());
  } catch {
    throw new HttpError(422, 'invalid', `Give ${what}, starting with https://.`, { field: 'url' });
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new HttpError(422, 'invalid', `Give ${what} as a plain https:// address.`, { field: 'url' });
  return u.origin + u.pathname.replace(/\/+$/, '');
}

/**
 * A reader with the read's own limits: get(url, {headers}) -> parsed JSON and the answer's headers. Errors are
 * HttpErrors in words, with every secret in `secrets` replaced by [hidden].
 */
function reader(app, secrets) {
  const started = Date.now();
  let total = 0;
  const hide = (s) => secrets.filter(Boolean).reduce((t, x) => t.split(x).join(HIDDEN).split(encodeURIComponent(x)).join(HIDDEN), String(s));
  return async function get(url, { headers = {} } = {}) {
    const left = READ_LIMITS.totalMs - (Date.now() - started);
    if (left <= 0) throw new HttpError(504, 'timeout', 'Reading the site took more than 5 minutes, so it stopped. Use its export file, or the command line (markstage-server import).');
    let r;
    try {
      r = await safeFetch(url, { maxBytes: Math.min(READ_LIMITS.answerBytes, READ_LIMITS.totalBytes - total), timeoutMs: Math.min(READ_LIMITS.answerMs, left), accept: 'application/json', outbound: app.outbound ?? {}, headers });
    } catch (e) {
      throw new HttpError(e.status ?? 502, e.code ?? 'fetch-failed', hide(e.message));
    }
    total += r.body.length;
    const host = new URL(r.url).host;
    if (r.status === 401 || r.status === 403) throw new HttpError(422, 'source-refused', `${host} did not let us in (${r.status}). Check the user name and password, key or token.`);
    if (r.status === 404) throw new HttpError(422, 'source-not-found', `${host} has no ${new URL(r.url).pathname} (404). Check the address.`);
    if (r.status < 200 || r.status >= 300) throw new HttpError(502, 'source-failed', `${host} answered ${r.status}.`);
    if (!/json/.test(r.type)) throw new HttpError(422, 'not-json', `${host} did not answer with JSON (it sent ${r.type || 'no type'}). Check the address.`);
    try {
      return { json: JSON.parse(r.body.toString('utf8')), headers: r.headers };
    } catch {
      throw new HttpError(422, 'not-json', `${host} sent something that is not JSON.`);
    }
  };
}

/** Every page of a list: `page(n)` -> {items, pages?}; stops at an empty page, the last page, or the limit. */
async function allPages(page) {
  const out = [];
  for (let n = 1; n <= READ_LIMITS.pages; n++) {
    const { items, pages } = await page(n);
    out.push(...items);
    if (!items.length || (pages && n >= pages) || items.length < READ_LIMITS.perPage) break;
  }
  return out;
}

/** WordPress's REST API: {url, user?, password?} (an application password: Users › Profile › Application Passwords). */
export async function readWordpressApi(app, { url, user, password }) {
  const base = siteAddress(url);
  const signed = Boolean(user && password);
  if (Boolean(user) !== Boolean(password)) throw new HttpError(422, 'invalid', 'Give both the user name and the application password, or neither.', { field: 'password' });
  const headers = signed ? { Authorization: `Basic ${Buffer.from(`${user}:${String(password).replace(/\s+/g, '')}`).toString('base64')}` } : {};
  const get = reader(app, [password, String(password ?? '').replace(/\s+/g, ''), headers.Authorization]);
  const root = (await get(`${base}/wp-json/`, { headers })).json;
  const list = (path, extra = '') =>
    allPages(async (n) => {
      const r = await get(`${base}/wp-json/wp/v2/${path}?per_page=${READ_LIMITS.perPage}&page=${n}${extra}`, { headers });
      return { items: Array.isArray(r.json) ? r.json : [], pages: Number(r.headers['x-wp-totalpages']) || null };
    });
  const edit = signed ? '&context=edit' : '';
  const status = signed ? '&status=publish,future,draft,pending,private' : '';
  const [posts, pages, media, users, categories, tags] = [await list('posts', `${edit}${status}`), await list('pages', `${edit}${status}`), await list('media', edit), await list('users', edit), await list('categories'), await list('tags')];
  return fromRest({ site: { url: root.home ?? root.url ?? base, home: root.url, name: root.name ?? '' }, posts, pages, media, users, categories, tags });
}

/** Ghost's Content API: {url, key} (Settings › Integrations › a custom integration's Content API key). */
export async function readGhostApi(app, { url, key, permalink }) {
  const base = siteAddress(url);
  if (!/^[a-f0-9]{20,64}$/i.test(String(key ?? ''))) throw new HttpError(422, 'invalid', 'A Content API key is the hex key of a custom integration (Settings › Integrations).', { field: 'key' });
  const get = reader(app, [key]);
  const api = (path, extra = '') => `${base}/ghost/api/content/${path}/?key=${encodeURIComponent(key)}${extra}`;
  const list = (path) =>
    allPages(async (n) => {
      const r = await get(api(path, `&include=tags,authors&formats=html&limit=${READ_LIMITS.perPage}&page=${n}`));
      return { items: Array.isArray(r.json?.[path]) ? r.json[path] : [], pages: Number(r.json?.meta?.pagination?.pages) || null };
    });
  const settings = (await get(api('settings'))).json?.settings ?? {};
  return fromGhostContentApi({ siteUrl: settings.url ?? base, title: settings.title ?? '', posts: await list('posts'), pages: await list('pages'), permalink });
}

/**
 * Prismic's API: {repo, token?, endpoint?} (a private repository's access token: Settings › API & Security). The
 * documents of the master ref, every type. `endpoint` is the API's address when it is not
 * https://<repo>.cdn.prismic.io/api/v2.
 */
export async function readPrismicApi(app, { repo, token, endpoint, siteUrl, fields, routes, slices }) {
  if (!REPO.test(String(repo ?? ''))) throw new HttpError(422, 'invalid', 'The repository name is the first part of its address (my-repo in my-repo.prismic.io).', { field: 'repo' });
  const api = endpoint ? siteAddress(endpoint, 'the API’s address') : `https://${repo}.cdn.prismic.io/api/v2`;
  const get = reader(app, [token]);
  const auth = token ? `access_token=${encodeURIComponent(token)}` : '';
  const info = (await get(`${api}${auth ? `?${auth}` : ''}`)).json;
  const ref = (info?.refs ?? []).find((r) => r.isMasterRef)?.ref;
  if (!ref) throw new HttpError(422, 'source-failed', 'The Prismic API did not name its master ref.');
  const docs = await allPages(async (n) => {
    const r = await get(`${api}/documents/search?ref=${encodeURIComponent(ref)}&pageSize=${READ_LIMITS.perPage}&page=${n}${auth ? `&${auth}` : ''}`);
    return { items: Array.isArray(r.json?.results) ? r.json.results : [], pages: Number(r.json?.total_pages) || null };
  });
  return fromPrismic(docs, { repo, siteUrl: siteUrl ? siteAddress(siteUrl, 'the old site’s address') : '', fields, routes, sliceMap: slices });
}
