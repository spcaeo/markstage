// Entries on disk for the dev API: list, read, write, with the same shapes as the server (docs/API.md). The
// converter (core + the site's packs) is passed in, so an edit to a pack applies without a restart.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { groupIdOf, groupOf, urlOf } from './config.mjs';

export { urlOf };

export const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
export const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

export class HttpError extends Error {
  constructor(status, error, message, extra = {}) {
    super(message);
    Object.assign(this, { status, error, extra });
  }
}

export const fileOf = (c, id) => {
  if (!ID.test(id ?? '')) return null;
  const file = path.join(c.absDir, `${id}${c.ext}`);
  return fs.existsSync(file) ? file : null;
};

const pick = (data, key) => (key ? key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data) : undefined);
const str = (v) => (v == null ? undefined : v instanceof Date ? v.toISOString() : String(v));

/** Reads one entry's file into { id, text, data } (data: frontmatter for md, the JSON for json). */
export function readFile(c, file, readFrontmatter) {
  const text = fs.readFileSync(file, 'utf8');
  let data = {};
  try {
    data = c.format === 'md' ? readFrontmatter(text) : JSON.parse(text);
  } catch {
    data = {};
  }
  return { id: path.basename(file, c.ext), text, data: data ?? {} };
}

export function statusOf(c, data, now = new Date()) {
  if (!c.hasStatus) return 'published';
  if (data.draft === true) return 'draft';
  if (data.publishAt && new Date(data.publishAt) > now) return 'scheduled';
  return 'published';
}

/** The list item of an entry (docs/API.md "Item"), plus `group` when the config sorts entries into groups. */
export function itemOf(c, raw) {
  const f = c.fields;
  const d = raw.data;
  const item = {
    id: raw.id,
    title: String(pick(d, f.title) ?? raw.id),
    status: statusOf(c, d),
    author: str(pick(d, f.author)) ?? null,
    tags: Array.isArray(pick(d, f.tags)) ? pick(d, f.tags).map(String) : [],
    date: str(pick(d, f.date)) ?? null,
    modified: str(pick(d, f.modified)) ?? null,
    publishAt: str(d.publishAt) ?? null,
    url: urlOf(c, raw),
    version: sha1(raw.text),
    excerpt: str(pick(d, f.excerpt)) ?? '',
  };
  const g = groupOf(c, raw);
  if (g) item.group = g;
  // the group it is in (the Groups screen), when the collection has groups
  if (c.groups) item.groupId = groupIdOf(c, raw);
  return item;
}

export function listItems(c, readFrontmatter) {
  if (!fs.existsSync(c.absDir)) return [];
  return fs
    .readdirSync(c.absDir)
    .filter((f) => f.endsWith(c.ext) && ID.test(path.basename(f, c.ext)))
    .map((f) => itemOf(c, readFile(c, path.join(c.absDir, f), readFrontmatter)));
}

const SORTS = {
  title: (a, b) => a.title.localeCompare(b.title),
  date: (a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')),
  modified: (a, b) => String(a.modified ?? a.date ?? '').localeCompare(String(b.modified ?? b.date ?? '')),
};

/** GET collections/:c/entries: filter, search, sort and page as the server does. */
export function queryItems(items, params) {
  const counts = { all: items.length, draft: 0, scheduled: 0, published: 0 };
  for (const i of items) counts[i.status]++;
  let out = items;
  const status = params.get('status');
  if (status) out = out.filter((i) => i.status === status);
  const author = params.get('author');
  if (author) out = out.filter((i) => i.author === author);
  const tag = params.get('tag');
  if (tag) out = out.filter((i) => i.tags.includes(tag));
  const q = (params.get('q') ?? '').trim().toLowerCase();
  if (q) out = out.filter((i) => `${i.title} ${i.id} ${i.excerpt}`.toLowerCase().includes(q));
  const sort = params.get('sort') || '-modified';
  const by = SORTS[sort.replace(/^-/, '')];
  if (!by) throw new HttpError(400, 'bad-request', `Unknown sort "${sort}".`);
  out = [...out].sort((a, b) => (sort.startsWith('-') ? by(b, a) : by(a, b)) || a.id.localeCompare(b.id));
  const perPage = Math.min(200, Math.max(1, Number(params.get('perPage')) || 50));
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { items: out.slice((page - 1) * perPage, page * perPage), total: out.length, page, perPage, counts };
}

const DEV_CAN = { edit: true, publish: true, delete: true, rawHtml: true };

/** GET collections/:c/entries/:id */
export function entryOf(c, raw, md) {
  const item = itemOf(c, raw);
  const base = { id: raw.id, collection: c.id, format: c.format, version: item.version, status: item.status, url: item.url, title: item.title };
  if (c.format === 'json') return { ...base, data: raw.data, autosave: null, can: DEV_CAN };
  return { ...base, frontmatter: raw.data, doc: md.mdToDoc(raw.text).doc, autosave: null, can: DEV_CAN };
}

/** Throws a 409 unless the file is still at `version`. Returns the current text. */
export function checkVersion(file, version) {
  const current = fs.readFileSync(file, 'utf8');
  const now = sha1(current);
  if (version !== now) throw new HttpError(409, 'conflict', 'The file changed since it was opened.', { version: now });
  return current;
}

/** Writes `text` (unchanged files are not touched, so the dev server does not reload for nothing). */
export function writeText(file, before, text) {
  if (text !== before) fs.writeFileSync(file, text);
  return sha1(text);
}

/** A Markdown file the site can build: frontmatter that parses, a body the converter reads. */
export function checkMarkdown(text, md, readFrontmatter) {
  try {
    readFrontmatter(text);
  } catch (e) {
    throw new HttpError(422, 'invalid', `The frontmatter is not valid YAML: ${e.message}`, { fields: { frontmatter: e.message } });
  }
  try {
    md.mdToDoc(text);
  } catch (e) {
    throw new HttpError(422, 'invalid', `The Markdown could not be read: ${e.message}`);
  }
}
