// Author files on disk, for `astro dev`'s API, the site's build helpers and the build's author check: every author in
// the config's folder (authors.dir), and the entries that name each one (docs/API-AUTHORS.md). Node only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AUTHOR_SLUG, authorProblems, authorUrl, entryAuthors, profileOf } from '@markstage/core/authors';
import { urlOf } from './config.mjs';

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');
const ENTRY_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** One author's file: {slug, file, text, version, data, profile}, or null when there is none (or it is not JSON). */
export function readAuthor(acfg, slug) {
  if (!AUTHOR_SLUG.test(slug ?? '')) return null;
  const file = path.join(acfg.absDir, `${slug}.json`);
  let text;
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  return { slug, file, text, version: sha1(text), data, profile: { ...profileOf(acfg, slug, data), url: authorUrl(acfg, slug) } };
}

/** Every author, by slug, in name order. */
export function readAuthors(acfg) {
  if (!acfg || !fs.existsSync(acfg.absDir)) return new Map();
  const list = fs
    .readdirSync(acfg.absDir)
    .filter((f) => f.endsWith('.json') && AUTHOR_SLUG.test(f.slice(0, -5)))
    .map((f) => readAuthor(acfg, f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => a.profile.name.localeCompare(b.profile.name, undefined, { sensitivity: 'base' }) || a.slug.localeCompare(b.slug));
  return new Map(list.map((a) => [a.slug, a]));
}

/** Is the entry live on the built site (docs/API.md "Site-side contract")? A preview build shows every one. */
export function isLive(data, now = Date.parse(process.env.MARKSTAGE_BUILD_TIME ?? '') || Date.now()) {
  if (process.env.MARKSTAGE_PREVIEW === '1') return true;
  if (data?.draft === true || data?.protected === true) return false;
  const at = data?.publishAt ? Date.parse(data.publishAt instanceof Date ? data.publishAt.toISOString() : String(data.publishAt)) : NaN;
  return !(Number.isFinite(at) && at > now);
}

const statusOf = (c, d, now = Date.now()) => {
  if (!c.hasStatus) return 'published';
  if (d.draft === true) return 'draft';
  const at = d.publishAt ? Date.parse(String(d.publishAt instanceof Date ? d.publishAt.toISOString() : d.publishAt)) : NaN;
  return Number.isFinite(at) && at > now ? 'scheduled' : 'published';
};
const dateOf = (v) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));

/**
 * Every entry of the author collections with the authors it names: [{collection, id, file, title, status, url, date,
 * data, authors}]. `readFrontmatter`: core's (Markdown entries); a file that does not parse is left out.
 */
export function authoredEntries(cfg, readFrontmatter) {
  const out = [];
  for (const c of cfg.collections) {
    if (!cfg.authors?.collections.includes(c.id) || !fs.existsSync(c.absDir)) continue;
    for (const f of fs.readdirSync(c.absDir)) {
      const id = f.slice(0, -c.ext.length);
      if (!f.endsWith(c.ext) || !ENTRY_ID.test(id)) continue;
      const file = path.join(c.absDir, f);
      let data;
      try {
        const text = fs.readFileSync(file, 'utf8');
        data = (c.format === 'md' ? readFrontmatter(text) : JSON.parse(text)) ?? {};
      } catch {
        continue;
      }
      out.push({
        collection: c.id,
        id,
        file,
        title: String(data[c.fields.title] ?? id),
        status: statusOf(c, data),
        url: urlOf(c, { id, data }),
        date: dateOf(data[c.fields.date]),
        data,
        authors: entryAuthors(cfg.authors, c.fields.author, data),
      });
    }
  }
  return out;
}

/** The entries that name `slug`, primary or co-author: [{collection, id, title, status, url, date, role}]. */
export function postsOf(cfg, slug, readFrontmatter, entries = authoredEntries(cfg, readFrontmatter)) {
  return entries
    .filter((e) => e.authors.includes(slug))
    .map(({ collection, id, title, status, url, date, authors }) => ({ collection, id, title, status, url, date, role: authors[0] === slug ? 'author' : 'co-author' }))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.id.localeCompare(b.id));
}

/**
 * The build's check: every entry of the author collections names authors the site has, and none archived but the
 * ones it already had. [{collection, id, file, slug, problem, message}]; [] when all is well.
 */
export function entryAuthorProblems(cfg, readFrontmatter) {
  if (!cfg.authors) return [];
  const known = new Map([...readAuthors(cfg.authors)].map(([s, a]) => [s, { ...a.profile, archived: false }]));
  const out = [];
  for (const e of authoredEntries(cfg, readFrontmatter)) {
    for (const p of authorProblems(e.authors, known)) out.push({ collection: e.collection, id: e.id, file: path.relative(cfg.root, e.file), ...p });
  }
  return out;
}
