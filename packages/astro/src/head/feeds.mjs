// The RSS 2.0 feeds the settings name (head.feeds, @markstage/core/head), made from the collections' own entry files
// (not the HTML): dates, excerpts, tags and authors are fields there. One <channel> per feed with an atom:link to
// itself; one <item> per live entry.
//   - Live means what the site's own build calls live (authors-files isLive, docs/API.md "Site-side contract"): not a
//     draft, not protected, not scheduled for later. A preview build (MARKSTAGE_PREVIEW=1) shows every entry, as the
//     site does.
//   - Newest first by the collection's date field, at most `limit`; an entry with no readable date goes last.
//   - Link and guid: the collection's url template (core urlOf) on the site's address; an entry with no page is left out.
//   - Nothing in the feed depends on the clock, so the same entries give the same file (a build is repeatable).
//   feedFiles(cfg, head, {siteUrl, readFrontmatter}) -> Promise<[{path, title, text}]>
import fs from 'node:fs';
import path from 'node:path';
import { entryAuthors } from '@markstage/core/authors';
import { urlOf } from '../config.mjs';
import { ID } from '../content.mjs';
import { isLive, readAuthors } from '../authors-files.mjs';

// XML 1.0 allows tab, newline, carriage return and the characters from space up, minus the two non-characters
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (v) =>
  String(v ?? '')
    .replace(XML_BAD, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const pick = (data, key) => (key ? key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data) : undefined);
// a field as plain text: a date as ISO, nothing for an empty value, a list or an object
const text = (v) => (v instanceof Date ? v.toISOString() : v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());
const absolute = (siteUrl, p) => (/^https?:\/\//i.test(p) ? p : `${siteUrl.replace(/\/+$/, '')}${p.startsWith('/') ? '' : '/'}${p}`);

/** An entry's file read into its data (frontmatter, or the JSON), or null when it cannot be read. */
export function readEntry(c, file, readFrontmatter) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return (c.format === 'md' ? readFrontmatter(raw) : JSON.parse(raw)) ?? {};
  } catch {
    return null;
  }
}

/** Every live entry of a collection that has a page, as feed items (date: milliseconds or null). */
function itemsOf(c, { siteUrl, readFrontmatter, authors }) {
  if (!fs.existsSync(c.absDir)) return [];
  const f = c.fields;
  const out = [];
  for (const name of fs.readdirSync(c.absDir)) {
    if (!name.endsWith(c.ext)) continue;
    const id = name.slice(0, -c.ext.length);
    if (!ID.test(id)) continue;
    const data = readEntry(c, path.join(c.absDir, name), readFrontmatter);
    if (!data || typeof data !== 'object' || !isLive(data)) continue;
    const url = urlOf(c, { id, data });
    if (!url) continue;
    const when = Date.parse(text(pick(data, f.date)));
    const tags = pick(data, f.tags);
    const names = authors ? entryAuthors(authors.config, f.author, data).map((slug) => authors.byslug.get(slug)?.profile.name).filter(Boolean) : [];
    out.push({
      id,
      link: absolute(siteUrl, url),
      title: text(pick(data, f.title)) || id,
      description: text(pick(data, f.excerpt)),
      date: Number.isFinite(when) ? when : null,
      tags: [...new Set((Array.isArray(tags) ? tags : []).map(text).filter(Boolean))],
      creators: [...new Set(names)],
    });
  }
  return out;
}

const byNewest = (a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity) || a.link.localeCompare(b.link);

function itemXml(i) {
  return [
    '    <item>',
    `      <title>${esc(i.title)}</title>`,
    `      <link>${esc(i.link)}</link>`,
    `      <guid isPermaLink="true">${esc(i.link)}</guid>`,
    ...(i.date === null ? [] : [`      <pubDate>${new Date(i.date).toUTCString()}</pubDate>`]),
    ...(i.description ? [`      <description>${esc(i.description)}</description>`] : []),
    ...i.tags.map((t) => `      <category>${esc(t)}</category>`),
    ...i.creators.map((n) => `      <dc:creator>${esc(n)}</dc:creator>`),
    '    </item>',
  ].join('\n');
}

function feedXml(feed, items, { siteName, siteUrl }) {
  const home = `${siteUrl.replace(/\/+$/, '')}/`;
  const newest = items.find((i) => i.date !== null);
  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${esc(feed.title)}</title>`,
    `    <link>${esc(home)}</link>`,
    `    <description>${esc(feed.description || siteName)}</description>`,
    ...(newest ? [`    <lastBuildDate>${new Date(newest.date).toUTCString()}</lastBuildDate>`] : []),
    `    <atom:link href="${esc(absolute(siteUrl, feed.path))}" rel="self" type="application/rss+xml"/>`,
    ...items.map(itemXml),
    '  </channel>',
    '</rss>',
  ].join('\n')}\n`;
}

export async function feedFiles(cfg, head, { siteUrl, readFrontmatter } = {}) {
  if (!head?.feeds?.length) return [];
  // the authors, read once, when the site keeps author files
  const authors = cfg.authors ? { config: cfg.authors, byslug: readAuthors(cfg.authors) } : null;
  return head.feeds.map((feed) => {
    const items = [];
    for (const id of feed.collections) {
      const c = cfg.collections.find((x) => x.id === id);
      if (c) items.push(...itemsOf(c, { siteUrl, readFrontmatter, authors }));
    }
    items.sort(byNewest);
    return { path: feed.path, title: feed.title, text: feedXml(feed, items.slice(0, feed.limit), { siteName: cfg.siteName, siteUrl }) };
  });
}
