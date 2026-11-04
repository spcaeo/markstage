// The site's integrations (markstage.config `integrations`; docs/API-INTEGRATIONS.md): lists of options fetched from a
// JSON address on a schedule, for a Post settings field to pick from (`{type: 'select', key, integration: <name>}`).
// Checked at start: a mistake stops the server in words. A sign-in is never in the config: it names an environment
// variable (MARKSTAGE_INTEGRATION_*) or a file outside the repo (a Docker secret).
import fs from 'node:fs';
import path from 'node:path';
import { ConfigError, isInside } from '../config.mjs';

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const DOTTED = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;
const HEADER = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const ENV_NAME = /^MARKSTAGE_INTEGRATION_[A-Z0-9_]{1,60}$/;
// headers a sign-in may not take: the request's own
const NOT_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'cookie', 'accept-encoding']);
export const MAX_INTEGRATIONS = 20;
export const MAX_KB = 5120;
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** `integrations: {<name>: {...}}` checked, or {} when there are none. `contentRoot`: a keyFile must be outside it. */
export function integrationsOf(raw, { contentRoot, production = false, file = 'markstage.config' } = {}) {
  const fail = (m) => {
    throw new ConfigError(`${file}: integrations${m}`);
  };
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(' must be an object: { products: { url, value, text } }.');
  const names = Object.keys(raw);
  if (names.length > MAX_INTEGRATIONS) fail(` lists ${names.length}; at most ${MAX_INTEGRATIONS}.`);
  const out = {};
  for (const name of names) {
    const at = `.${name}`;
    if (!NAME.test(name)) fail(`: "${name}" must be a short lowercase name such as "products".`);
    const i = raw[name];
    if (!i || typeof i !== 'object' || Array.isArray(i)) fail(`${at} must be an object with url, value and text.`);
    const known = ['label', 'url', 'every', 'list', 'value', 'text', 'detail', 'auth', 'maxKB'];
    const odd = Object.keys(i).filter((k) => !known.includes(k));
    if (odd.length) fail(`${at} has keys it does not know: ${odd.join(', ')} (it takes ${known.join(', ')}).`);
    let u;
    try {
      u = new URL(i.url);
    } catch {
      fail(`${at}.url must be the JSON address, e.g. "https://shop.example.com/api/products.json".`);
    }
    if (u.username || u.password) fail(`${at}.url must not hold a sign-in: use auth.`);
    // http only for a test's own loopback site (the fetch's test seam); the guard refuses loopback otherwise
    if (u.protocol !== 'https:' && (production || u.protocol !== 'http:')) fail(`${at}.url must be https.`);
    const every = i.every ?? 60;
    if (!Number.isInteger(every) || every < 5 || every > 1440) fail(`${at}.every is minutes between fetches, 5 to 1440 (default 60).`);
    for (const k of ['list', 'value', 'text', 'detail']) {
      if (i[k] === undefined || i[k] === null) continue;
      if (typeof i[k] !== 'string' || !DOTTED.test(i[k]) || i[k].split('.').some((p) => BAD_KEYS.has(p))) fail(`${at}.${k} must be a key or a dotted path such as "data.items".`);
    }
    if (!i.value) fail(`${at}.value is the key of each item that is stored, e.g. "sku".`);
    if (!i.text) fail(`${at}.text is the key of each item that is shown, e.g. "name".`);
    const maxKB = i.maxKB ?? 1024;
    if (!Number.isInteger(maxKB) || maxKB < 1 || maxKB > MAX_KB) fail(`${at}.maxKB is the largest answer read, 1 to ${MAX_KB} (default 1024).`);
    out[name] = {
      name,
      label: typeof i.label === 'string' && i.label.trim() ? i.label.trim().slice(0, 80) : name,
      url: u.href,
      every,
      list: i.list ?? null,
      value: i.value,
      text: i.text,
      detail: i.detail ?? null,
      auth: authOf(i.auth, { at, fail, contentRoot }),
      maxBytes: maxKB * 1024,
    };
  }
  return Object.freeze(out);
}

function authOf(a, { at, fail, contentRoot }) {
  if (a === undefined || a === null) return null;
  if (typeof a !== 'object' || Array.isArray(a)) fail(`${at}.auth must be { header, scheme?, env } or { header, scheme?, keyFile }.`);
  const odd = Object.keys(a).filter((k) => !['header', 'scheme', 'env', 'keyFile'].includes(k));
  if (odd.length) fail(`${at}.auth has keys it does not know: ${odd.join(', ')}. The secret itself never goes in the config.`);
  const header = a.header ?? 'Authorization';
  if (!HEADER.test(header) || NOT_HEADERS.has(header.toLowerCase())) fail(`${at}.auth.header must be a header name such as "Authorization".`);
  if (a.scheme !== undefined && (typeof a.scheme !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,30}$/.test(a.scheme))) fail(`${at}.auth.scheme must be a word such as "Bearer".`);
  if (!a.env === !a.keyFile) fail(`${at}.auth needs one of env (a MARKSTAGE_INTEGRATION_* variable) or keyFile (a file outside the repo).`);
  if (a.env !== undefined && (typeof a.env !== 'string' || !ENV_NAME.test(a.env))) fail(`${at}.auth.env must be the name of a variable that starts with MARKSTAGE_INTEGRATION_, so no other secret of the server can be sent.`);
  if (a.keyFile !== undefined) {
    if (typeof a.keyFile !== 'string' || !path.isAbsolute(a.keyFile)) fail(`${at}.auth.keyFile must be an absolute path.`);
    if (contentRoot && isInside(contentRoot, path.resolve(a.keyFile))) fail(`${at}.auth.keyFile must be outside the site repo: a file there can be committed, pushed and built into the site.`);
  }
  return { header, scheme: a.scheme ?? null, env: a.env ?? null, keyFile: a.keyFile ?? null };
}

/** The sign-in's value now (read at each fetch, so a rotated secret is used without a restart), or null. */
export function secretOf(auth, env = process.env) {
  if (!auth) return null;
  if (auth.env) return env[auth.env]?.trim() || null;
  try {
    return fs.readFileSync(auth.keyFile, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
