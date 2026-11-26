// Every built HTML page in the output folder, read for the head kit (head/index.mjs).
//   readPages(outDir, {siteUrl, skip}) -> Promise<Page[]>, sorted by path, where Page is
//     {file, path, html, title, description, canonical, lang, indexed, modified}
//   file: absolute path of the .html; path: its site path ("/", "/posts/hello/", "/404.html" -> "/404/");
//   title: <title> (decoded); description: meta description; canonical: <link rel=canonical> href or siteUrl+path;
//   lang: <html lang> or ''; modified: article:modified_time / dateModified when the page has one, else null;
//   indexed: false for a page whose robots meta says noindex, the 404 page, a redirect page (meta refresh), a file
//   that is not a page (no <html>, <head> or <body>, such as a search engine's verification file), and a path in
//   `skip` (exact, or a prefix when the skip ends in "/*"); true otherwise.
// Only the head is read with patterns (a few tags); the body is read later, by markdown.mjs, with the tolerant reader.
import fs from 'node:fs/promises';
import path from 'node:path';
import { attrsOf, decode } from '@markstage/core/html-tree';
import { pathKey, skipped } from './paths.mjs';
import { pageUrl } from './urls.mjs';

/** The site path of a built file ("a/index.html" -> "/a/", "a.html" -> "/a/", "index.html" -> "/"). */
export function pagePathOf(rel) {
  const parts = rel.split(path.sep).join('/').split('/');
  const last = parts.pop();
  if (last !== 'index.html') parts.push(last.replace(/\.html$/i, ''));
  // the path as the server finds the file: decoded ("café", not "caf%C3%A9"); URLs the kit writes encode it (urls.mjs)
  const segs = parts.filter(Boolean);
  return segs.length ? `/${segs.join('/')}/` : '/';
}

/** True for a 404 page: /404/, or a locale's own (/fr/404/). */
export const isNotFound = (p) => pathKey(p).split('/').pop() === '404';

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && /\.html$/i.test(e.name)) yield p;
  }
}

const collapse = (s) => decode(s).replace(/\s+/g, ' ').trim();

/** The head's facts from the page's own tags. */
function readHead(html) {
  const end = html.search(/<\/head\s*>/i);
  const head = end < 0 ? html.slice(0, 100_000) : html.slice(0, end);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  const metas = [];
  for (const m of head.matchAll(/<meta\b([^<>]*)>/gi)) metas.push(attrsOf(m[1].replace(/\/\s*$/, '')));
  const meta = (...names) => {
    for (const n of names) {
      const f = metas.find((a) => (a.name ?? a.property ?? '').toLowerCase() === n && typeof a.content === 'string');
      if (f) return collapse(f.content);
    }
    return '';
  };
  const robots = metas
    .filter((a) => ['robots', 'googlebot'].includes((a.name ?? '').toLowerCase()))
    .map((a) => (a.content ?? '').toLowerCase())
    .join(',');
  let canonical = '';
  for (const m of head.matchAll(/<link\b([^<>]*)>/gi)) {
    const a = attrsOf(m[1].replace(/\/\s*$/, ''));
    if (/(^|\s)canonical(\s|$)/i.test(a.rel ?? '') && a.href) {
      canonical = a.href.trim();
      break;
    }
  }
  return {
    title: title ? collapse(title[1]) : '',
    description: meta('description') || meta('og:description'),
    canonical,
    noindex: /(^|[\s,])(noindex|none)([\s,]|$)/.test(robots),
    refresh: metas.some((a) => (a['http-equiv'] ?? '').toLowerCase() === 'refresh'),
    modified: meta('article:modified_time', 'og:updated_time'),
  };
}

/** A date string as the page wrote it when it is a real date, else null. */
const dateOrNull = (s) => (s && !Number.isNaN(Date.parse(s)) ? s : null);

export async function readPages(outDir, { siteUrl, skip = [] } = {}) {
  const base = String(siteUrl ?? '').replace(/\/+$/, '');
  const byPath = new Map();
  for await (const file of walk(outDir)) {
    const p = pagePathOf(path.relative(outDir, file));
    // `a.html` and `a/index.html` are one page: the folder's index wins
    if (byPath.has(p) && !/index\.html$/i.test(file)) continue;
    byPath.set(p, file);
  }
  const pages = [];
  for (const [p, file] of byPath) {
    const html = await fs.readFile(file, 'utf8');
    const h = readHead(html);
    const isPage = /<(html|head|body)\b/i.test(html);
    const lang = /<html\b([^<>]*)>/i.exec(html);
    let canonical = pageUrl(base, p);
    if (h.canonical) {
      try {
        canonical = new URL(h.canonical, pageUrl(base, p)).href;
      } catch {
        // an address that is not one: the page's own is used
      }
    }
    const modified = dateOrNull(h.modified) ?? dateOrNull(/"dateModified"\s*:\s*"([^"]+)"/.exec(html)?.[1]);
    pages.push({
      file,
      path: p,
      html,
      title: h.title,
      description: h.description,
      canonical,
      lang: lang ? collapse(attrsOf(lang[1].replace(/\/\s*$/, '')).lang ?? '') : '',
      indexed: isPage && !h.noindex && !h.refresh && !isNotFound(p) && !skipped(p, skip),
      modified,
    });
  }
  return pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
