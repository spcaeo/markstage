// Entries on disk: path allowlist, reading, listing with filters, status, and atomic writes. Only files directly in a
// configured collection dir, named by a strict id, are ever read or written.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ID, isInside } from '../config.mjs';
import { HttpError, notFound, sha1 } from '../util.mjs';
import { createContentIndex } from './index.mjs';

/** Status of an entry from its fields (see docs/API.md "Publish, schedule, unpublish"). */
export function statusOf(fields, now = Date.now()) {
  if (fields?.draft === true) return 'draft';
  const at = fields?.publishAt ? Date.parse(fields.publishAt) : NaN;
  if (Number.isFinite(at) && at > now) return 'scheduled';
  return 'published';
}

const asString = (v) => (v === undefined || v === null ? '' : v instanceof Date ? v.toISOString() : String(v));

export function createStore(config, converter, clock = () => Date.now(), site = { urlOf: () => null, groupOf: () => null }) {
  const byId = new Map(config.collections.map((c) => [c.id, c]));
  // parsed fields per file version, so a list of hundreds of entries parses each file once
  const cache = new Map();
  // the scheduler's held-back entries (publish.mjs): a draft that keeps its publishAt, with the reasons on record
  let heldOf = () => null;

  function collection(id) {
    const c = byId.get(id);
    if (!c) throw notFound('No such collection.');
    return c;
  }

  /**
   * The absolute path of an entry file, or a 404. The id must match ID (no dots, no slashes), the file must sit
   * directly in the collection dir, and it may not be a symlink (no escape out of the repo).
   */
  function fileOf(c, id, { mustExist = true } = {}) {
    if (!ID.test(String(id ?? ''))) throw notFound('No such entry.');
    const abs = path.join(c.absDir, `${id}${c.ext}`);
    if (path.dirname(abs) !== c.absDir || !isInside(config.contentRoot, abs)) throw notFound('No such entry.');
    let st = null;
    try {
      st = fs.lstatSync(abs);
    } catch {
      // does not exist
    }
    if (st && !st.isFile()) throw notFound('No such entry.');
    if (mustExist && !st) throw notFound('No such entry.');
    return abs;
  }

  const rel = (abs) => path.relative(config.contentRoot, abs).split(path.sep).join('/');

  /** The entry a repo-relative path is the file of ({c, id}), or null (whether or not it exists now). */
  function entryOfRel(r) {
    const abs = path.join(config.contentRoot, String(r));
    for (const c of config.collections) {
      if (path.dirname(abs) !== c.absDir || !abs.endsWith(c.ext)) continue;
      const id = path.basename(abs).slice(0, -c.ext.length);
      if (ID.test(id)) return { c, id };
    }
    return null;
  }

  function read(c, id) {
    const abs = fileOf(c, id);
    const text = fs.readFileSync(abs, 'utf8');
    return { abs, rel: rel(abs), text, version: sha1(text) };
  }

  /** Top-level fields of an entry text (frontmatter or JSON object). */
  function fieldsOf(c, text) {
    const version = sha1(text);
    const hit = cache.get(version);
    if (hit) return hit;
    let fields;
    if (c.format === 'json') {
      try {
        fields = JSON.parse(text);
      } catch {
        fields = {};
      }
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fields = {};
    } else {
      try {
        fields = converter.parseFrontmatter(text) ?? {};
      } catch {
        // broken YAML: listed with its id; opening or saving it reports the error
        fields = {};
      }
    }
    if (cache.size > 5000) cache.clear();
    cache.set(version, fields);
    return fields;
  }

  /** The entry's page address: its own url field when it has one, else the site config's url (site-config.mjs). */
  function urlOf(c, id, f) {
    if (c.fields.url && typeof f[c.fields.url] === 'string') return f[c.fields.url];
    return c.url ? site.urlOf(c, id, f) : null;
  }

  /** The summary of an entry used in lists and permission checks. */
  const summarize = (c, id, text) => summaryFrom(c, id, fieldsOf(c, text), sha1(text));

  /** The same summary from an index record (its fields and version), so a list never hashes or parses a file. */
  const summaryOf = (c, e) => summaryFrom(c, e.id, e.fields, e.version);

  function summaryFrom(c, id, f, version) {
    const tags = f[c.fields.tags];
    // held back when it was due: still scheduled for people (a draft for the site's build), with why
    const held = c.hasStatus && f.draft === true && f.publishAt ? heldOf(c, id, asString(f.publishAt)) : null;
    return {
      id,
      title: asString(f[c.fields.title]) || id,
      status: held ? 'scheduled' : c.hasStatus ? statusOf(f, clock()) : 'published',
      ...(held ? { held } : {}),
      author: f[c.fields.author] === undefined ? null : asString(f[c.fields.author]),
      tags: Array.isArray(tags) ? tags.map(asString) : [],
      date: asString(f[c.fields.date]) || null,
      modified: asString(f[c.fields.modified]) || null,
      publishAt: f.publishAt ? asString(f.publishAt) : null,
      url: urlOf(c, id, f),
      excerpt: asString(f[c.fields.excerpt]).slice(0, 300),
      version,
      ...(c.group ? { group: site.groupOf(c, id, f) ?? undefined } : {}),
      // the group it is in, by the site's groups.field (the Groups screen); only when the collection has groups
      ...(c.groups ? { groupId: ((v) => (v === null || v === undefined || v === '' ? null : String(v)))(c.groups.field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), f)) } : {}),
    };
  }

  function ids(c) {
    return fs
      .readdirSync(c.absDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(c.ext))
      .map((d) => d.name.slice(0, -c.ext.length))
      .filter((id) => ID.test(id));
  }

  /** Every entry's page address -> 'collection/id' (the default locale), for "is this address taken?". */
  function addresses() {
    const out = new Map();
    for (const c of config.collections) {
      for (const e of index.entries(c).values()) {
        const url = summaryOf(c, e).url;
        if (url && !out.has(url)) out.set(url, `${c.id}/${e.id}`);
      }
    }
    return out;
  }

  // the content index (index.mjs): fields and words per file version, kept fresh by a stat sweep before every ask
  const index = createContentIndex(config.collections, (c, text) => ({ fields: fieldsOf(c, text), words: c.format === 'md' ? wordsOf(text) : null }));

  // every column a list shows; numbers inside text in their order ("Part 2" before "Part 10")
  const text = (k) => (a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''), undefined, { numeric: true, sensitivity: 'base' });
  const STATUS_ORDER = { draft: 0, scheduled: 1, published: 2 };
  const SORTS = {
    title: text('title'),
    date: text('date'),
    modified: text('modified'),
    publishAt: text('publishAt'),
    author: text('author'),
    url: text('url'),
    group: text('group'),
    id: text('id'),
    status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    words: (a, b) => (a.words ?? -1) - (b.words ?? -1),
  };

  /**
   * Each entry's `parent` in a collection whose address is a field (uri): the page whose address is the longest one
   * this one starts with (not the home page); null at the top level. What a move by `parent` changes.
   */
  function withParents(all) {
    const byUrl = new Map(all.filter((e) => e.url && e.url !== '/').map((e) => [e.url.endsWith('/') ? e.url : `${e.url}/`, e.id]));
    for (const e of all) {
      e.parent = null;
      if (!e.url || e.url === '/') continue;
      const parts = e.url.replace(/\/+$/, '').split('/');
      for (let n = parts.length - 1; n > 1; n--) {
        const hit = byUrl.get(`${parts.slice(0, n).join('/')}/`);
        if (hit !== undefined) {
          e.parent = hit;
          break;
        }
      }
    }
  }

  /** The words of an article's text: the frontmatter, HTML tags, Markdown marks and link targets left out. */
  function wordsOf(text) {
    let body = text;
    if (body.startsWith('---')) {
      const end = body.indexOf('\n---', 3);
      body = end === -1 ? '' : body.slice(end + 4);
    }
    body = body.replace(/<[^<>]*>/g, ' ').replace(/\]\([^()\s]*\)/g, ' ').replace(/[#*_`>~|[\]()]+/g, ' ');
    return (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
  }

  /**
   * List with filters; `counts` ignores the status filter so the chips always show every bucket. Besides the
   * columns: `group` (the entry's groupId), `since` (changed at or after this time), and the route's own
   * `keep(e, fields)` (the "needs attention" filters) and `decorate(e, fields)` (its locales). From the content
   * index: no file is read or parsed here.
   */
  function list(c, { status, author, tag, q, group, since, keep, decorate, sort = '-modified', page = 1, perPage = 50 } = {}) {
    const all = [...index.entries(c).values()].map((r) => {
      const e = summaryOf(c, r);
      // an article's length: the words of its text (not the frontmatter, not markup)
      if (c.format === 'md') e.words = r.words;
      if (decorate) decorate(e, r.fields);
      e.keep = !keep || keep(e, r.fields);
      return e;
    });
    if (c.fields.url) withParents(all);
    const needle = q ? String(q).toLowerCase() : '';
    const after = since ? Date.parse(String(since)) : NaN;
    const base = all.filter(
      (e) =>
        (!author || e.author === author) &&
        (!tag || e.tags.includes(tag)) &&
        (!group || e.groupId === group) &&
        (Number.isNaN(after) || (e.modified && Date.parse(e.modified) >= after)) &&
        e.keep &&
        (!needle || e.title.toLowerCase().includes(needle) || e.id.includes(needle) || e.excerpt.toLowerCase().includes(needle)),
    );
    for (const e of all) delete e.keep;
    const counts = { all: base.length, draft: 0, scheduled: 0, published: 0 };
    for (const e of base) counts[e.status]++;
    const items = status ? base.filter((e) => e.status === status) : base;
    const key = String(sort).replace(/^-/, '');
    if (!Object.hasOwn(SORTS, key)) throw new HttpError(400, 'bad-request', 'Unknown sort.');
    // ties keep the id order both ways, so a page never shows an entry twice or skips one
    const dir = String(sort).startsWith('-') ? -1 : 1;
    items.sort((a, b) => dir * SORTS[key](a, b) || a.id.localeCompare(b.id));
    const size = Math.min(Math.max(Number(perPage) || 50, 1), 200);
    const p = Math.max(Number(page) || 1, 1);
    // what the author and tag filters offer: every value in the collection, whatever the other filters say
    const facet = (vals) => [...vals.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map())].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const facets = { authors: facet(all.map((e) => e.author).filter(Boolean)), tags: facet(all.flatMap((e) => e.tags)) };
    return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, perPage: size, counts, facets };
  }

  /** Write atomically (temp file in the same dir, then rename) so a crash never leaves half a file. */
  function write(c, id, text) {
    const abs = fileOf(c, id, { mustExist: false });
    const tmp = path.join(c.absDir, `.markstage-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, abs);
    index.put(c, id, text);
    return { abs, rel: rel(abs), version: sha1(text) };
  }

  function remove(c, id) {
    const abs = fileOf(c, id);
    fs.unlinkSync(abs);
    index.drop(c, id);
    return { rel: rel(abs) };
  }

  /**
   * Repo-relative files that are not entries (a move's undo, the redirects file): inside the repo, not in .git, no
   * symlink on the way out. read -> text or null when missing.
   */
  function absRel(r) {
    const abs = path.resolve(config.contentRoot, r);
    if (!isInside(config.contentRoot, abs) || r.split(/[\\/]/)[0] === '.git') throw new HttpError(400, 'bad-path', 'Not a file in the content repo.');
    const parent = fs.existsSync(path.dirname(abs)) ? fs.realpathSync(path.dirname(abs)) : null;
    if (parent && !isInside(config.contentRoot, parent) && parent !== config.contentRoot) throw new HttpError(400, 'bad-path', 'Not a file in the content repo.');
    return abs;
  }
  const readRel = (r) => (fs.existsSync(absRel(r)) ? fs.readFileSync(absRel(r), 'utf8') : null);
  // the bytes (a picture), or null when missing
  const readRelBytes = (r) => (fs.existsSync(absRel(r)) ? fs.readFileSync(absRel(r)) : null);
  function writeRel(r, text) {
    const abs = absRel(r);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.markstage-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, abs);
  }
  const removeRel = (r) => fs.rmSync(absRel(r), { force: true });

  const exists = (c, id) => {
    try {
      fileOf(c, id);
      return true;
    } catch {
      return false;
    }
  };

  /** The scheduler tells which drafts are held back: (c, id, publishAt) -> {dueAt, reasons} | null. */
  const setHeld = (fn) => (heldOf = fn);

  return {
    collections: config.collections,
    collection,
    fileOf,
    entryOfRel,
    read,
    fieldsOf,
    summarize,
    summaryOf,
    list,
    ids,
    addresses,
    write,
    remove,
    exists,
    rel,
    readRel,
    readRelBytes,
    writeRel,
    removeRel,
    setHeld,
    // the content index: a collection's records (id -> {id, version, fields, words}), the content version, and a
    // nudge to sweep again now (after a git command moved files)
    index: (c) => index.entries(c),
    rev: () => index.rev(),
    touch: () => index.touch(),
  };
}
