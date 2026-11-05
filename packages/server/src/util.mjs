// Small shared helpers: errors with an HTTP status, random ids, hashing, constant-time compare.
import crypto from 'node:crypto';

/** An error the HTTP layer turns into `{error, message, ...extra}` with this status. */
export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message, extra) => new HttpError(400, 'bad-request', message, extra);
export const unauthorized = (message = 'Please sign in.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You are not allowed to do that.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not-found', message);
export const conflict = (message, extra) => new HttpError(409, 'conflict', message, extra);
export const invalid = (fields, message = 'Some fields need fixing.') => new HttpError(422, 'invalid', message, { fields });

/** A yes/no query flag: "1", "true" or "yes" (any case) is yes; anything else, or none, is no. */
export const flag = (query, key) => /^(1|true|yes)$/i.test(query.get(key) ?? '');

export const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');
export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** A random opaque id with a readable prefix, e.g. `u_3kq9…`. */
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;

/** A random secret token (session cookie, CSRF token, challenge). */
export const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** A one-time code people type (setup, invite): 4 groups of 4 from an unambiguous alphabet, ~80 bits. */
export function newSetupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length] + (i % 4 === 3 && i < 15 ? '-' : '');
  return out;
}

/** Codes are compared after this, so "abcd efgh" and "ABCD-EFGH" match. */
export const normalizeCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Constant-time string compare (pads both sides so the length does not leak through timing either). */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  const len = Math.max(x.length, y.length, 1);
  const px = Buffer.alloc(len);
  const py = Buffer.alloc(len);
  x.copy(px);
  y.copy(py);
  return crypto.timingSafeEqual(px, py) && x.length === y.length;
}

export const nowIso = (now = Date.now()) => new Date(now).toISOString();

/** The network an address belongs to: `a.b.c.0/24` for IPv4, the first four groups `/64` for IPv6; null if unknown. */
export function netOf(ip) {
  const s = String(ip ?? '').trim();
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(s);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!s.includes(':')) return null;
  // expand :: so the first four groups are known
  const [head, tail = ''] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = s.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** A URL-safe slug from a title: lowercase ascii, hyphens, max 100 chars; '' when no letter a-z or digit survives. */
export function slugify(title) {
  return String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/, '');
}

/**
 * The id of an entry whose title gives no slug (Arabic, emoji…): "post-2026-11-02" (a page: "page-…"), never a
 * silent "untitled" (QA pass 2, N4). The editor's New sheet works out the same name and says so.
 */
export const datedId = (c, now = Date.now()) => `${c?.format === 'json' ? 'page' : 'post'}-${new Date(now).toISOString().slice(0, 10)}`;

/**
 * A lock that never waits, across every server process on the data dir (a lease, cluster/): `take(what)` gives a
 * release function, or null while someone holds it (the route answers 409 busy). For work that must run one at a
 * time per server and should tell the caller so, like an import. A process that stops mid-way frees it (its lease).
 */
export function createBusyLease(cluster, name) {
  return {
    take(what = 'work') {
      if (!cluster.take(name, what)) return null;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        cluster.release(name);
      };
    },
    get holder() {
      const h = cluster.holder(name);
      return h ? { what: h.what, since: h.since } : null;
    },
  };
}

/** A simple async mutex: `await lock.run(() => work())` runs one at a time. */
export function createLock() {
  let tail = Promise.resolve();
  return {
    run(fn) {
      // tail never rejects (see below), so fn always runs after the previous job settles
      const result = tail.then(() => fn());
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
