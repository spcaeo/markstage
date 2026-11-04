// The dev API's JSON-entry routes (GET collections/:c/schema, PUT collections/:c/entries/:id with `changes`), for
// the pages editor. Owned by the pages editor (site-content); api.mjs calls jsonRoute() for every request to a JSON
// collection, before its own routes, and stops when it returns true. The same contract as the Markstage server
// (docs/API.md "Field schema" and "Save"): the site config's `schema: { keystatic, options }` gives each JSON
// collection its Keystatic schema (matched by folder, else by name), and `changes` are applied in order by core's
// JsonEntry with {schema, policy: keystaticPolicy}, so the file stays as Keystatic's own Save would write it.
//
// ctx: { c (the normalized collection), parts (the path after /markstage/api/, split on '/'), method, req, res,
//        url (URL), cfg (the normalized site config, cfg.root the project), readBody(req) -> Promise<object>,
//        send(res, status, data), HttpError(status, code, message, extra?), checkVersion(file, version) -> text
//        (409 when stale), writeText(file, before, text) -> new version, entryFile(c, id) -> absolute path (404
//        when there is no such entry) }
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_FILES } from '@markstage/core/site-config';
import { checkEntry } from './api-pages.mjs';

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const OPS = new Set(['set', 'remove', 'insert', 'move', 'duplicate']);

/** Answers a JSON-collection request it owns and returns true; false leaves it to api.mjs. */
export async function jsonRoute(ctx) {
  const { c, parts, method, send, HttpError } = ctx;
  if (parts[2] === 'schema' && parts.length === 3 && method === 'GET') {
    const s = await schemaOf(ctx.cfg, c, HttpError);
    if (!s) return send(ctx.res, 404, { error: 'no-schema', message: `The collection "${c.id}" has no field schema (site config \`schema\`).` }), true;
    return send(ctx.res, 200, { entry: s.schema }), true;
  }
  if (parts[2] !== 'entries' || parts.length !== 4 || method !== 'PUT') return false;
  const body = await ctx.readBody(ctx.req);
  // the body is read now, so this route answers every JSON save (a whole `data` is for the server)
  if (!Array.isArray(body.changes)) throw new HttpError(400, 'bad-request', 'Dev mode saves a JSON entry as a list of `changes` (or through its source).');
  const file = ctx.entryFile(c, parts[3]);
  const before = ctx.checkVersion(file, body.version);
  const s = await schemaOf(ctx.cfg, c, HttpError);
  const text = applyChanges(await jsonEngine(HttpError), before, body.changes, s, HttpError, { modified: c.fields?.modified });
  // an author it now names must be one of the site's, a frame or page type it sets one of the site's (api-pages.mjs)
  checkEntry(ctx.cfg, c, JSON.parse(before), JSON.parse(text), HttpError);
  return send(ctx.res, 200, { ok: true, version: ctx.writeText(file, before, text), changedBlocks: body.changes.length, commit: null }), true;
}

/** `changes` applied in order to `text` (docs/API.md "Save"); 400 for a malformed list, 422 for one that cannot apply.
 *  `modified`: the entry's last-changed key, set to now when the save changes the file and does not set it itself. */
export function applyChanges(json, text, changes, s, HttpError, { modified = null, now = new Date() } = {}) {
  if (changes.length > 5000) throw new HttpError(413, 'too-large', 'Too many changes in one save.');
  let entry;
  try {
    entry = json.JsonEntry.parse(text, s ? { schema: s.schema, policy: s.policy } : undefined);
  } catch (e) {
    throw new HttpError(422, 'invalid', `The file is not valid JSON: ${e.message}`);
  }
  for (const ch of changes) {
    const op = ch?.op ?? 'set';
    if (!OPS.has(op) || typeof ch?.path !== 'string') throw new HttpError(400, 'bad-request', `Each change needs a known op and a path (got ${JSON.stringify(ch)?.slice(0, 120)}).`);
    if (ch.path.split('.').some((k) => FORBIDDEN.has(k))) throw new HttpError(400, 'bad-request', `The path "${ch.path}" is not allowed.`);
    try {
      if (op === 'set') entry.set(ch.path, ch.value);
      else if (op === 'remove') {
        if (entry.has(ch.path)) entry.remove(ch.path);
      } else if (op === 'insert') entry.insert(ch.path, ch.index, ch.value);
      else if (op === 'move') entry.move(ch.path, ch.from, ch.to);
      else entry.duplicate(ch.path, ch.index);
    } catch (e) {
      throw new HttpError(422, 'invalid', `This change cannot be applied: ${e.message}`);
    }
  }
  if (modified && entry.text !== text && !changes.some((ch) => ch.path === modified) && entry.has(modified)) {
    const was = entry.get(modified);
    if (typeof was === 'string') {
      const stamp = stampLike(was, now);
      if (stamp) entry.set(modified, stamp);
    }
  }
  return entry.text;
}

/** `now` written the way `was` is: a date, or a date and time in UTC with "Z" or "+00:00"; null for anything else. */
export function stampLike(was, now) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (/^\d{4}-\d{2}-\d{2}$/.test(was)) return iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(was)) return iso;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(was)) return iso.replace(/Z$/, '+00:00');
  return null;
}

let engine = null;
async function jsonEngine(HttpError) {
  try {
    return (engine ??= await import('@markstage/core/json'));
  } catch {
    throw new HttpError(503, 'unavailable', 'Saving JSON entries needs @markstage/core/json, which is not installed.');
  }
}

// The described Keystatic schema, per config file and its change time (the dev server keeps running while either
// is edited).
const cache = new Map();

/** The collection's {schema, policy}, or null when the site config gives none for it. */
export async function schemaOf(cfg, c, HttpError) {
  const configFile = CONFIG_FILES.map((f) => path.join(cfg.root, f)).find((f) => fs.existsSync(f));
  if (!configFile) return null;
  const raw = await import(`${pathToFileURL(configFile).href}?t=${fs.statSync(configFile).mtimeMs}`);
  const schema = (raw.default ?? raw).schema;
  if (!schema) return null;
  if (typeof schema.keystatic !== 'string' || !schema.keystatic) throw new HttpError(500, 'config', 'schema.keystatic must be the path of the keystatic config, e.g. "./keystatic.config.ts".');
  const ksFile = path.resolve(cfg.root, schema.keystatic);
  if (!ksFile.startsWith(cfg.root + path.sep) || !fs.existsSync(ksFile)) throw new HttpError(500, 'config', `schema.keystatic: ${schema.keystatic} is not a file in the project.`);
  const key = `${configFile}:${fs.statSync(configFile).mtimeMs}:${ksFile}:${fs.statSync(ksFile).mtimeMs}`;
  if (!cache.has(key)) {
    cache.clear();
    cache.set(
      key,
      (async () => {
        const ks = await import('@markstage/core/json/keystatic');
        return { described: await ks.loadKeystaticSchema(ksFile, schema.options ?? {}), policy: ks.keystaticPolicy };
      })(),
    );
  }
  let loaded;
  try {
    loaded = await cache.get(key);
  } catch (e) {
    cache.clear();
    throw new HttpError(500, 'config', `schema.keystatic: ${path.basename(ksFile)} could not be loaded: ${e.message}`);
  }
  const folder = (p) => String(p ?? '').replace(/\/\*+$/, '').replace(/\/+$/, '');
  const list = Object.entries(loaded.described.collections);
  const hit = list.find(([, k]) => folder(k.path) === c.dir) ?? list.find(([name]) => name === c.id);
  return hit && hit[1].format?.data === 'json' ? { schema: hit[1].entry, policy: loaded.policy } : null;
}
