// Author files in the content repo (docs/API-AUTHORS.md): the folder the site config names (authors.dir), one
// <slug>.json per author, read and written like entries are (a strict slug, directly in the folder, never through a
// link, written atomically), and the entries that name each author. The profile shape comes from core's authors.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigError, isInside, realish } from '../config.mjs';
import { notFound, sha1 } from '../util.mjs';

/** The site's authors config, checked by core and then by the server's own path rules; null when it has none. */
export async function authorsConfig(config) {
  if (!config.authors) return null;
  let core;
  try {
    core = await import('@markstage/core/authors');
  } catch {
    throw new ConfigError('authors needs @markstage/core, which is not installed.');
  }
  const fail = (m) => {
    throw new ConfigError(m);
  };
  const { absDir: _given, ...raw } = config.authors;
  const acfg = core.authorsConfigOf(raw, { collections: config.collections.map((c) => ({ id: c.id, hasStatus: c.hasStatus })), fail });
  const absDir = realish(path.resolve(config.contentRoot, acfg.dir));
  if (!isInside(config.contentRoot, absDir) || absDir === realish(config.contentRoot) || isInside(path.join(config.contentRoot, '.git'), absDir)) fail('authors.dir must be a folder inside the content repo.');
  if (config.collections.some((c) => c.absDir === absDir && c.format !== 'json')) fail('authors.dir is the folder of a Markdown collection; author files are JSON.');
  return { core, acfg: { ...acfg, absDir } };
}

export function createAuthorFiles(config, { core, acfg }) {
  const rel = (abs) => path.relative(config.contentRoot, abs).split(path.sep).join('/');

  /** The file of an author (a 404 for a bad slug, a link, or one outside the folder). */
  function fileOf(slug, { mustExist = true } = {}) {
    if (!core.AUTHOR_SLUG.test(String(slug ?? ''))) throw notFound('No such author.');
    const abs = path.join(acfg.absDir, `${slug}.json`);
    if (fs.existsSync(acfg.absDir) && !isInside(config.contentRoot, fs.realpathSync(acfg.absDir))) throw notFound('No such author.');
    let st = null;
    try {
      st = fs.lstatSync(abs);
    } catch {
      // not there
    }
    if (st && !st.isFile()) throw notFound('No such author.');
    if (mustExist && !st) throw notFound(`There is no author “${slug}”.`);
    return abs;
  }

  /** {slug, abs, rel, text, version, data, profile} of one author. */
  function read(slug) {
    const abs = fileOf(slug);
    const text = fs.readFileSync(abs, 'utf8');
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    return { slug, abs, rel: rel(abs), text, version: sha1(text), data, profile: core.profileOf(acfg, slug, data) };
  }

  const exists = (slug) => {
    try {
      fileOf(slug);
      return true;
    } catch {
      return false;
    }
  };

  /** Every author file (one that cannot be read is left out), in name order. */
  function all() {
    if (!fs.existsSync(acfg.absDir)) return [];
    return fs
      .readdirSync(acfg.absDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json') && core.AUTHOR_SLUG.test(d.name.slice(0, -5)))
      .map((d) => {
        try {
          return read(d.name.slice(0, -5));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.profile.name.localeCompare(b.profile.name, undefined, { sensitivity: 'base' }) || a.slug.localeCompare(b.slug));
  }

  /** Atomic write (temp file in the folder, then rename); the folder is made the first time. */
  function write(slug, text) {
    const abs = fileOf(slug, { mustExist: false });
    fs.mkdirSync(acfg.absDir, { recursive: true });
    const tmp = path.join(acfg.absDir, `.markstage-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, abs);
    return { rel: rel(abs), version: sha1(text) };
  }

  function remove(slug) {
    const abs = fileOf(slug);
    fs.unlinkSync(abs);
    return { rel: rel(abs) };
  }

  return { fileOf, read, exists, all, write, remove, relOf: (slug) => rel(path.join(acfg.absDir, `${slug}.json`)) };
}

/**
 * The entries of the author collections with the authors they name: [{c, id, text, version, fields, summary,
 * authors}]. `store`: the content store.
 */
export function authoredEntries(store, core, acfg) {
  const out = [];
  for (const c of store.collections) {
    if (!acfg.collections.includes(c.id)) continue;
    for (const id of store.ids(c)) {
      let cur;
      try {
        cur = store.read(c, id);
      } catch {
        continue;
      }
      const fields = store.fieldsOf(c, cur.text);
      out.push({ c, id, text: cur.text, version: cur.version, fields, summary: store.summarize(c, id, cur.text), authors: core.entryAuthors(acfg, c.fields.author, fields) });
    }
  }
  return out;
}

/** The posts an author is named on: [{collection, id, title, status, url, date, role}], newest first. */
export function postsOf(entries, slug) {
  return entries
    .filter((e) => e.authors.includes(slug))
    .map((e) => ({ collection: e.c.id, id: e.id, title: e.summary.title, status: e.summary.status, url: e.summary.url, date: e.summary.date, role: e.authors[0] === slug ? 'author' : 'co-author' }))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.id.localeCompare(b.id));
}
