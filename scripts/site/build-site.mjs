#!/usr/bin/env node
// Builds the public site in site/ (GitHub Pages, .github/workflows/pages.yml) from docs/*.md, the README's
// "How Markstage compares" section, site-content/ (alternatives, FAQ, glossary) and scripts/site/content.mjs.
// No framework: plain HTML pages with their own title, description, canonical, share tags and JSON-LD, plus
// sitemap.xml, robots.txt and llms.txt. The output is deterministic: two builds are byte-identical.
//
//   node scripts/site/build-site.mjs          write site/ (npm run site:build)
//   node scripts/site/build-site.mjs --check  fail if site/ is out of date
//
// Screenshots (site/media/*.webp) are made by scripts/site/capture-shots.mjs and share images (site/og/*.png,
// .github/social-preview.png) by scripts/site/render-social.mjs; both are committed, this script only reads them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alternativePage, alternativesIndex, checkedOn, comparePage, comparisonPage, leadFirst } from './compare.mjs';
import { parseComparison } from './comparison-data.mjs';
import { CLONE_URL, DEMO_BUILT, DEMO_PATH, NAME, REPO_URL, SITE_URL, TAGLINE, repoFile } from './config.mjs';
import { DOCS, FAQ } from './content.mjs';
import { aiPage, featuresPage } from './features.mjs';
import { ALL_FEATURES, FEATURE_GROUPS } from './features-content.mjs';
import { home } from './home.mjs';
import { faqPage, glossaryPage } from './learn.mjs';
import { parseFrontMatter, renderMarkdown } from './markdown.mjs';
import { demoPage } from './demo-page.mjs';
import { docPage, docsIndex, notFound } from './pages.mjs';
import { readRoadmap, roadmapPage } from './roadmap.mjs';
import { showcasePage, whyPage } from './story.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

/** Width and height of a WebP or PNG file, from its header. */
export function imageSize(buf) {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  return null;
}

/** The screenshots in site/media, by name (`canvas` for canvas.webp). */
/** The live demo's video is committed (site/media/demo.mp4, npm run demo:video). */
export const hasDemoVideo = (root = REPO_ROOT) => fs.existsSync(path.join(root, 'site', 'media', 'demo.mp4'));

/** A path under site/ that the Pages workflow builds (the live demo's editor, blog and data), never site:build. */
export const builtByWorkflow = (rel) => DEMO_BUILT.some((part) => rel.startsWith(`${DEMO_PATH}${part}/`));

export function findMedia(root = REPO_ROOT) {
  const dir = path.join(root, 'site', 'media');
  const media = {};
  if (!fs.existsSync(dir)) return media;
  for (const file of fs.readdirSync(dir).sort()) {
    const m = /^([\w-]+)\.(webp|png)$/.exec(file);
    if (!m) continue;
    const size = imageSize(fs.readFileSync(path.join(dir, file)));
    if (size) media[m[1]] = { file, ...size };
  }
  return media;
}

/**
 * A link in docs/<file> to its place on the site: another published doc becomes ../<id>/ (with its #hash when that
 * id exists there, checked after all docs are rendered), any other repo file or folder goes to GitHub.
 */
function docLink(fromDir, prefix) {
  const byFile = new Map(DOCS.map((d) => [`docs/${d.file}`, d.id]));
  return (href) => {
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    const [target, hash] = href.split('#');
    const repoPath = path.posix.normalize(path.posix.join(fromDir, target));
    const id = byFile.get(repoPath);
    if (id) return `${prefix}${id}/${hash ? `#${hash}` : ''}`;
    if (repoPath.startsWith('..')) return REPO_URL;
    const kind = /\.[a-z0-9]+$/i.test(repoPath) ? 'blob' : 'tree';
    return `${REPO_URL}/${kind}/main/${repoPath}${hash ? `#${hash}` : ''}`;
  };
}

/** Removes `#hash` from links to a doc page that has no such id (a heading renamed, or GitHub's own slug). */
function fixHashes(pages, idsByPath) {
  for (const p of pages) {
    p.html = p.html.replace(/href="((?:\.\.\/)+)(docs\/)?([a-z0-9-]+)\/#([^"]+)"/g, (whole, up, docs, id, hash) => {
      const ids = idsByPath.get(`docs/${id}/`);
      if (!ids) return whole;
      return ids.has(hash) ? whole : `href="${up}${docs ?? ''}${id}/"`;
    });
  }
}

export function readDocs(root = REPO_ROOT) {
  return DOCS.map((doc) => {
    const source = fs.readFileSync(path.join(root, 'docs', doc.file), 'utf8');
    return { doc, rendered: renderMarkdown(source, { link: docLink('docs', '../') }) };
  });
}

/** site-content/alternatives/*.md, WordPress, Ghost and Prismic first, then by slug; each `{slug, meta, rendered}`. */
export function readAlternatives(contentDir) {
  const dir = path.join(contentDir, 'alternatives');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!published(meta)) return null;
      for (const key of ['title', 'description']) if (!meta[key]) throw new Error(`site-content/alternatives/${f}: front matter needs "${key}"`);
      return { slug: f.replace(/\.md$/, ''), meta, rendered: renderMarkdown(body, { link: siteContentLink('../../') }) };
    })
    .filter(Boolean)
    .sort(leadFirst);
}

/** Links in site-content files: `/compare/`-style site paths become relative, repo files go to GitHub. */
function siteContentLink(root) {
  return (href) => {
    // the full comparison is a page of the site
    if (href === repoFile('docs/COMPARISON.md') || /^(\.\/)?docs\/COMPARISON\.md$/.test(href)) return `${root}compare/full/`;
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    if (href.startsWith('/')) return `${root}${href.slice(1)}`;
    return repoFile(href.replace(/^\.\//, ''));
  };
}

/** docs/COMPARISON.md for /compare/full/ (null when missing): its short version in the README is /compare/. */
function readComparison(root) {
  const file = path.join(root, 'docs', 'COMPARISON.md');
  if (!fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, 'utf8');
  const docs = docLink('docs', '../../docs/');
  const link = (href) => (/^(\.\.\/)?README\.md#how-markstage-compares$/.test(href) ? '../' : docs(href));
  return { rendered: renderMarkdown(source, { link }), checked: checkedOn(source), data: parseComparison(source) };
}

/**
 * How many other products docs/COMPARISON.md compares, from its "Where Markstage leads" point 1 ("Of the 20
 * products, ..."), which the home page's claim rests on; 0 (no claim) when the file or the sentence is missing.
 */
export function comparedCount(root = REPO_ROOT) {
  const file = path.join(root, 'docs', 'COMPARISON.md');
  if (!fs.existsSync(file)) return 0;
  const lead = /## Where Markstage leads[\s\S]*?\n1\. \*\*Editing on the site's own design, from your own server, with no database server\.\*\* Of the (\d+) products/.exec(fs.readFileSync(file, 'utf8'));
  return lead ? Number(lead[1]) : 0;
}

/** site-content/<name>.md as `{ meta, rendered }` (null when missing or not published): the story and showcase. */
export function readPage(contentDir, name, required = ['title', 'description', 'h1']) {
  const file = path.join(contentDir, `${name}.md`);
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
  if (!published(meta)) return null;
  for (const key of required) if (!meta[key]) throw new Error(`site-content/${name}.md: front matter needs "${key}"`);
  return { meta, rendered: renderMarkdown(body, { link: siteContentLink('../') }) };
}

/** A file in site-content/ is published unless its front matter says `publish: false` (keywords.md: notes only). */
const published = (meta) => meta.publish !== false;

/**
 * site-content/faq.md or glossary.md as `{ meta, groups }` (null when missing or not published). A file with `###`
 * entries under `##` group headings keeps its groups; a file with one `##` per entry is one group without a title.
 */
export function readEntries(file, link) {
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
  if (!published(meta)) return null;
  const { sections } = renderMarkdown(body, { link });
  const nested = sections.some((s) => s.items.length);
  const groups = nested
    ? sections.filter((s) => s.items.length).map((s) => ({ title: s.title, items: s.items }))
    : [{ title: '', items: sections.filter((s) => s.title && s.text) }];
  return { meta, groups: groups.filter((g) => g.items.length) };
}

/** llms.txt: what Markstage is and where everything is, for AI assistants (llmstxt.org). */
function llmsTxt({ pages, alternatives }) {
  const docs = DOCS.map((d) => `- [${d.title}](${SITE_URL}docs/${d.id}/): ${d.summary}`).join('\n');
  const alts = alternatives.map((a) => `- [${a.meta.h1 ?? a.meta.title}](${SITE_URL}alternatives/${a.slug}/): ${a.meta.description}`).join('\n');
  return `# ${NAME}

> ${NAME} is a self-hosted visual editor for Astro sites. Writers edit Markdown, MDX and JSON content on the site's real page design, and every save is a clean git diff of exactly what changed (with the Markstage server, a commit by the person who saved). No content database, no cloud. Source-available under the Elastic License 2.0, free to self-host (not open source). Made by Space-O Technologies.

Tagline: ${TAGLINE} Writers edit with Notion-style blocks ("/" for any block, drag by the grip, ⌘K); AI agents draft through an MCP server and never publish (${SITE_URL}ai/). Status: pre-release, in active development. Requires Node.js 22.13 or newer and git.

- Source code: ${REPO_URL} (clone: ${CLONE_URL})
- Licence: ${repoFile('LICENSE')}
- Features (${ALL_FEATURES.length}, ${SITE_URL}features/): ${FEATURE_GROUPS.map((g) => `${g.title.toLowerCase()}: ${g.items.map((f) => f.title.replace(/[“”]/g, '"')).join('; ')}`).join('. ')}.

## Pages

${pages
  .filter((p) => p.file !== '404.html' && !p.file.startsWith('docs/') && !p.file.startsWith('alternatives/'))
  .map((p) => `- [${p.title}](${SITE_URL}${p.path})`)
  .join('\n')}

## Docs

${docs}
${alts ? `\n## Alternatives\n\n${alts}\n` : ''}
## Optional

- [README](${repoFile('README.md')})
- [Changelog](${repoFile('CHANGELOG.md')})
- [Security policy](${repoFile('SECURITY.md')})
`;
}

/** Every generated file as `{ file, content }`, paths relative to site/. */
export function buildSite(root = REPO_ROOT, { contentDir = path.join(root, 'site-content') } = {}) {
  const media = findMedia(root);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const docs = readDocs(root);
  const alternatives = readAlternatives(contentDir);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const renderSection = (md) => renderMarkdown(md, { link: siteContentLink('../') });
  const comparison = readComparison(root);
  const why = readPage(contentDir, 'why');
  const showcase = readPage(contentDir, 'showcase');
  const roadmap = readRoadmap(contentDir, (md) => renderMarkdown(md, { link: siteContentLink('../') }));
  const video = hasDemoVideo(root);
  const rest = [
    featuresPage({ media }),
    aiPage({ media, roadmap }),
    demoPage({ media, video }),
    ...(why ? [whyPage({ why })] : []),
    ...(showcase ? [showcasePage({ showcase, media })] : []),
    docsIndex(),
    ...docs.map(docPage),
    comparePage({ readme, alternatives, renderSection, comparison, roadmap }),
    ...(comparison ? [comparisonPage({ comparison, alternatives, roadmap })] : []),
    alternativesIndex({ alternatives }),
    ...alternatives.map((alt) => alternativePage({ alt, alternatives, comparison, roadmap })),
    ...(roadmap ? [roadmapPage({ roadmap })] : []),
    faqPage({ builtIn: FAQ, file: readEntries(path.join(contentDir, 'faq.md'), siteContentLink('../')) }),
    glossaryPage({ file: readEntries(path.join(contentDir, 'glossary.md'), siteContentLink('../')) }),
    notFound(),
  ];
  // the hero's main button goes to the live demo when its page is built (demo-page.mjs), else to the install steps
  const demo = rest.some((p) => p.path === DEMO_PATH);
  const pages = [home({ media, version, compared: comparedCount(root), comparison: comparison?.data ?? null, roadmap, showcase, why, demo }), ...rest];
  const idsByPath = new Map(pages.map((p) => [p.path, new Set([...p.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
  fixHashes(pages, idsByPath);
  for (const p of pages) p.title = /<title>([^<]*)<\/title>/.exec(p.html)[1].replace(/&amp;/g, '&');
  const indexed = pages.filter((p) => p.file !== '404.html');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexed.map((p) => `  <url><loc>${SITE_URL}${p.path}</loc></url>`).join('\n')}
</urlset>
`;
  const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}sitemap.xml
`;
  return {
    media,
    pages,
    files: [
      ...pages.map((p) => ({ file: p.file, content: p.html })),
      { file: 'sitemap.xml', content: sitemap },
      { file: 'robots.txt', content: robots },
      { file: 'llms.txt', content: llmsTxt({ pages, alternatives }) },
      // GitHub Pages serves site/ as it is, with no Jekyll step
      { file: '.nojekyll', content: '' },
    ],
  };
}

function main() {
  const check = process.argv.includes('--check');
  const site = path.join(REPO_ROOT, 'site');
  const { files, media } = buildSite();
  const stale = [];
  for (const { file, content } of files) {
    const target = path.join(site, file);
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) continue;
    if (check) stale.push(file);
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  // pages a source no longer makes (a doc left out, an alternative removed)
  const made = new Set(files.map((f) => f.file));
  for (const rel of fs.readdirSync(site, { recursive: true }).map((f) => f.split(path.sep).join('/'))) {
    if (!rel.endsWith('.html') || made.has(rel) || builtByWorkflow(rel)) continue;
    if (check) stale.push(`${rel} (no longer built)`);
    else fs.rmSync(path.join(site, rel));
  }
  if (check) {
    if (stale.length) {
      console.error(`site/ is out of date (run npm run site:build): ${stale.join(', ')}`);
      process.exit(1);
    }
    console.log(`site/ is up to date (${files.length} files)`);
    return;
  }
  const missing = [...new Set(ALL_FEATURES.filter((f) => f.shot).map((f) => f.shot))].filter((n) => !media[n]);
  console.log(`Wrote ${files.length} files to site/ for ${SITE_URL}`);
  if (missing.length) console.log(`Screenshots not made yet (left out): ${missing.join(', ')} (node scripts/site/capture-shots.mjs)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
