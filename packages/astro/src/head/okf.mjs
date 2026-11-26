// The OKF v0.1 bundle (head/index.mjs): /okf/index.md lists every indexed page
// ("* [Title](<siteUrl>/okf/<file>.md) - description", grouped under "# Concepts"), and /okf/<file>.md holds one page
// as YAML front matter (title, url, description, lang, modified when known) and its Markdown, its links to other
// pages of the site pointing at their /okf/*.md files. File names are stable: the page path ("/a/b/" -> "a-b"), the
// home page "homepage"; a clash gets "-2", "-3" in path order.
//   okfFiles(docs, {siteName, siteUrl}) -> [{path, text}], docs = [{page, markdown}]
// "index" is taken by the bundle's own index, and names clash without regard to case (a Mac or Windows disk keeps
// "About.md" and "about.md" as one file).
import { pathKey } from './paths.mjs';
import { encodePath } from './urls.mjs';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const yaml = (s) => JSON.stringify(String(s));
const byPath = (a, b) => (a.page.path < b.page.path ? -1 : a.page.path > b.page.path ? 1 : 0);

/** The file name (no extension) for a page path: "/" -> homepage, "/a/b/" -> "a-b". */
export function okfName(pagePath) {
  if (pathKey(pagePath) === '/') return 'homepage';
  let p = String(pagePath);
  try {
    p = decodeURIComponent(p);
  } catch {
    // a path that is not valid percent-encoding is named as it is
  }
  const name = p
    .split(/[?#]/)[0]
    .replace(/\/index\.html$/i, '/')
    .replace(/\.html$/i, '')
    .split('/')
    .filter(Boolean)
    .join('-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|-+$/g, '');
  return name || 'page';
}

/** Names for the docs, unique and stable: a Map of page path -> file name. Clashes are numbered in path order. */
export function okfNames(docs) {
  const taken = new Set(['index']);
  const names = new Map();
  for (const { page } of [...docs].sort(byPath)) {
    if (names.has(page.path)) continue;
    const base = okfName(page.path);
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}`;
    taken.add(name.toLowerCase());
    names.set(page.path, name);
  }
  return names;
}

/** Links in Markdown to pages of this site (siteUrl) that have an OKF file, pointed at that file; a fragment is dropped. */
function rewriteLinks(markdown, { siteUrl, okfUrl, byKey }) {
  return markdown.replace(/\]\(([^()\s]+)\)/g, (m, url) => {
    if (!url.startsWith(siteUrl)) return m;
    const rest = url.slice(siteUrl.length);
    if (rest !== '' && rest[0] !== '/' && rest[0] !== '?' && rest[0] !== '#') return m;
    const file = byKey.get(pathKey(rest[0] === '/' ? rest : `/${rest}`));
    return file ? `](${okfUrl(file)})` : m;
  });
}

export function okfFiles(docs, { siteName = '', siteUrl = '' } = {}) {
  const origin = String(siteUrl).replace(/\/+$/, '');
  const okfUrl = (file) => `${origin}/okf/${encodePath(file)}.md`;
  const names = okfNames(docs);
  const byKey = new Map();
  for (const [p, name] of names) byKey.set(pathKey(p), name);
  const files = [];
  const rows = [];
  for (const { page, markdown } of [...docs].sort(byPath)) {
    const name = names.get(page.path);
    const title = one(page.title) || (/^# (.+)$/m.exec(markdown)?.[1] ?? name);
    const front = [`title: ${yaml(title)}`, `url: ${yaml(page.canonical)}`];
    if (one(page.description)) front.push(`description: ${yaml(one(page.description))}`);
    if (page.lang) front.push(`lang: ${yaml(page.lang)}`);
    if (page.modified) front.push(`modified: ${yaml(page.modified)}`);
    files.push({ path: `/okf/${name}.md`, text: `---\n${front.join('\n')}\n---\n\n${rewriteLinks(markdown.trim(), { siteUrl: origin, okfUrl, byKey })}\n` });
    rows.push({ name, title, description: one(page.description) });
  }
  rows.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || (a.name < b.name ? -1 : 1));
  const lines = rows.map((r) => `* [${r.title.replace(/([\\[\]])/g, '\\$1')}](${okfUrl(r.name)})${r.description ? ` - ${r.description}` : ''}`);
  const host = origin.replace(/^https?:\/\//, '');
  const index = `# Open Knowledge graph ${one(siteName) || host}\n\nAn OKF v0.1 bundle generated from ${host}\n\n# Concepts\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
  return [{ path: '/okf/index.md', text: index }, ...files];
}
