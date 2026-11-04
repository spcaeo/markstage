// The HTTP plumbing: a tiny router, body reading with size limits, cookies, JSON answers and the security headers
// every answer carries. No framework: node:http is enough for a JSON API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError, badRequest } from './util.mjs';

// The API answers JSON only, so it can forbid everything. The editor's HTML gets APP_CSP (see headers()).
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
// ProseMirror/TipTap set style attributes, so styles allow 'unsafe-inline'; scripts never do.
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** The other loopback spellings of a loopback origin (127.0.0.1 <-> localhost), else none. */
export const loopbackAliases = (origin) => {
  const u = new URL(origin);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return [];
  return [`${u.protocol}//127.0.0.1:${u.port}`, `${u.protocol}//localhost:${u.port}`];
};

/** Security headers for every answer. `kind` is 'api' (JSON / files) or 'app' (the editor page). */
export function securityHeaders(res, { secure, kind = 'api' }) {
  res.setHeader('Content-Security-Policy', kind === 'app' ? APP_CSP : API_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/** robots.txt for a host that is never for search engines (the CMS, the preview): everything disallowed. */
export function sendNoRobots(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end('User-agent: *\nDisallow: /\n');
}

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

export function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const code = err instanceof HttpError ? err.code : 'server';
  const message = err instanceof HttpError ? err.message : 'Something went wrong on the server.';
  const headers = err?.extra?.retryAfter ? { 'Retry-After': String(err.extra.retryAfter) } : {};
  sendJson(res, status, { error: code, message, ...(err instanceof HttpError ? err.extra : {}) }, headers);
}

/**
 * A path on the same site that a page may send a browser on to: starts with one `/`, never `//` or `/\\` (a browser
 * reads both as another host), no whitespace or control characters, at most 2000 characters.
 */
export const SAFE_PATH = /^\/(?![/\\])[^\s\x00-\x1f\x7f]{0,2000}$/;

/** Read the whole body as a Buffer, refusing more than `limit` bytes (413) without buffering the rest. */
export function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      return reject(new HttpError(413, 'too-large', `The request is larger than ${Math.round(limit / 1024)} KB.`));
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        req.resume();
        return reject(new HttpError(413, 'too-large', `The request is larger than ${Math.round(limit / 1024)} KB.`));
      }
      chunks.push(chunk);
    });
    req.on('end', () => !done && ((done = true), resolve(Buffer.concat(chunks))));
    req.on('error', (e) => !done && ((done = true), reject(e)));
  });
}

/**
 * Stream the whole body to a new file (mode 0600) under `dir`, refusing more than `limit` bytes (413, the file
 * removed): a big upload (a zip of pictures, a Library pack) never sits in memory. Resolves {file, size}; the caller
 * removes the file when it is done with it.
 */
export function readToFile(req, limit, dir) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      return reject(new HttpError(413, 'too-large', `The request is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `upload-${crypto.randomBytes(12).toString('hex')}`);
    const out = fs.createWriteStream(file, { mode: 0o600, flags: 'wx' });
    let size = 0;
    let done = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(file, { force: true }, () => reject(e));
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.resume();
        fail(new HttpError(413, 'too-large', `The request is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
      }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => !done && ((done = true), resolve({ file, size })));
    req.pipe(out);
  });
}

/** Read a JSON object body. Empty body = {}. Only application/json is accepted for non-empty bodies. */
export async function readJson(req, limit) {
  const raw = await readRaw(req, limit);
  if (raw.length === 0) return {};
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported-type', 'Send JSON (Content-Type: application/json).');
  let data;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw badRequest('The request body must be a JSON object.');
  return data;
}

/** The client address; behind a trusted proxy, the hop it appended to X-Forwarded-For. */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress ?? null;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    if (!(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/** Serialize a cookie. `__Host-` cookies must be Secure, Path=/ and have no Domain. */
export function cookie(name, value, { maxAge, secure = true } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

/**
 * A small router. `add(method, '/collections/:c/entries/:id', handler, opts)`; params are matched against a
 * strict pattern so a param can never contain a slash, dot-dot or encoded separator.
 */
export function createRouter() {
  const routes = [];
  const PARAM = '([A-Za-z0-9_-]{1,100})';
  return {
    add(method, pattern, handler, opts = {}) {
      const names = [];
      const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === ':' ? ch : `\\${ch}`)).replace(/:([a-zA-Z]+)/g, (_, n) => {
        names.push(n);
        return PARAM;
      });
      routes.push({ method, re: new RegExp(`^${source}$`), names, handler, opts });
    },
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
        const params = Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]]));
        return { route: r, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}
