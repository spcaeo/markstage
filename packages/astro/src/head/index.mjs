// The head kit at the end of `astro build` (docs/HEAD-KIT.md): with `head` in markstage.config, the build reads the
// settings file the editor writes (@markstage/core/head readHead) and then, over the built pages in the output folder:
//   1. a Markdown copy of every indexable page next to it (/<path>.md, the home page /index.md)    markdown.mjs
//   2. the OKF bundle (/okf/index.md and one file per page) and llms.txt / llms-full.txt            okf.mjs, llms.mjs
//   3. the RSS feeds of the collections the settings name                                           feeds.mjs
//   4. in every page's head: the <link>s to its Markdown copy, the OKF bundle and the feeds, and the one tracking
//      loader with the IDs the settings give, allowed in the page's own CSP <meta> when it has one   tracking.mjs
// Pages come from the built HTML (pages.mjs), so .md, .mdx and .json entries and the site's own pages are all
// covered alike, and an AI tool reads what a person sees. A page marked noindex, the 404 page, a path in
// `markdown.skip` and anything outside the output folder (private pages) get no copy and are in no list.
// A file the site already builds itself (its own llms.txt or rss.xml) is kept: the kit leaves it and says so.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readHead, markdownPath, tracks } from '@markstage/core/head';
import { readFrontmatter } from '@markstage/core';
import { readPages } from './pages.mjs';
import { pageMarkdown } from './markdown.mjs';
import { okfFiles } from './okf.mjs';
import { llmsFiles } from './llms.mjs';
import { feedFiles } from './feeds.mjs';
import { OWN_TAG, trackingTags } from './tracking.mjs';
import { notLivePages } from './hidden.mjs';
import { pathKey } from './paths.mjs';
import { headLinks, rewritePage } from './rewrite.mjs';

/** The settings file read and checked; a broken file stops the build with every problem listed. */
export function loadHead(cfg) {
  let raw = null;
  if (fs.existsSync(cfg.head.absFile)) {
    try {
      raw = JSON.parse(fs.readFileSync(cfg.head.absFile, 'utf8'));
    } catch (e) {
      throw new Error(`markstage: ${cfg.head.file} is not valid JSON: ${e.message}`);
    }
  }
  const { head, issues } = readHead(raw, { collections: cfg.collections.map((c) => c.id) });
  if (issues.length) throw new Error(`markstage: ${cfg.head.file} has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}:\n${issues.map((i) => `  ${i.path || '(file)'}: ${i.message}`).join('\n')}`);
  return head;
}

/** Writes `text` at the site path `p` under outDir unless the site built that file itself; true when written. */
function writeOwn(outDir, p, text, kept) {
  const file = path.join(outDir, ...p.split('/').filter(Boolean));
  if (!file.startsWith(outDir + path.sep)) throw new Error(`markstage: ${p} is outside the output folder.`);
  if (fs.existsSync(file)) {
    kept.push(p);
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

/** Runs the head kit over the built site in outDir. Returns what it did, for the log and the tests. */
export async function buildHead({ cfg, outDir, logger = console }) {
  const head = loadHead(cfg);
  const siteUrl = cfg.siteUrl;
  if (!siteUrl) throw new Error('markstage: the head kit needs the site’s address (`site` in astro.config or siteUrl in markstage.config) for the links it writes.');
  outDir = path.resolve(outDir);
  const transform = cfg.head.transform ? (await import(pathToFileURL(cfg.head.transform).href)).default : null;
  // every built page; `indexed` is false for a noindex page, the 404 page and a path in markdown.skip. A page of an
  // entry that is not live (protected, a draft, scheduled) is dropped altogether: no copy, no list, not touched
  const hidden = notLivePages(cfg, readFrontmatter);
  const pages = (await readPages(outDir, { siteUrl, skip: head.markdown.skip })).filter((p) => !hidden.has(pathKey(p.path)));
  const indexed = pages.filter((p) => p.indexed);
  const kept = [];
  const done = { pages: indexed.length, markdown: 0, okf: 0, llms: 0, feeds: [], tracking: [], kept };

  const docs = [];
  if (head.markdown.pages || head.markdown.okf || head.markdown.llms) {
    for (const page of indexed) {
      let markdown = pageMarkdown(page, { main: cfg.head.main, siteUrl });
      if (transform) markdown = await transform(markdown, { path: page.path, lang: page.lang });
      docs.push({ page, markdown });
    }
  }
  // the page text is not needed again until the rewrite, which reads each file afresh: a big site stays small in memory
  for (const page of pages) page.html = null;
  const mdOf = new Map();
  if (head.markdown.pages)
    for (const d of docs) {
      const p = markdownPath(d.page.path);
      if (writeOwn(outDir, p, d.markdown, kept)) done.markdown++;
      mdOf.set(d.page.path, p);
    }
  let okfIndex = null;
  if (head.markdown.okf) {
    for (const f of okfFiles(docs, { siteName: cfg.siteName, siteUrl })) if (writeOwn(outDir, f.path, f.text, kept)) done.okf++;
    okfIndex = '/okf/index.md';
  }
  if (head.markdown.llms) for (const f of llmsFiles(docs, { siteName: cfg.siteName, siteUrl, copies: head.markdown.pages })) if (writeOwn(outDir, f.path, f.text, kept)) done.llms++;

  const feeds = await feedFiles(cfg, head, { siteUrl, readFrontmatter });
  for (const f of feeds) if (writeOwn(outDir, f.path, f.text, kept)) done.feeds.push(f.path);

  // no tracking outside the live site: the Markstage server builds release previews, branch previews and the checks'
  // work trees with MARKSTAGE_NO_TRACKING=1, so their visits never count in the owner's analytics
  const offline = process.env.MARKSTAGE_NO_TRACKING === '1' || process.env.MARKSTAGE_PREVIEW === '1';
  const tags = trackingTags(offline ? {} : head.tracking);
  done.tracking = tags.tools;
  const own = new Map();
  // every page gets the tracking loader and the bundle and feed links; only an indexed page links its own copy
  for (const page of pages) {
    const before = fs.readFileSync(page.file, 'utf8');
    for (const t of tags.tools) if (OWN_TAG[t].test(before)) own.set(t, (own.get(t) ?? 0) + 1);
    const links = headLinks({ siteUrl, markdown: mdOf.get(page.path) ?? null, okf: okfIndex, feeds });
    const html = rewritePage(before, { links, tags });
    if (html !== before) fs.writeFileSync(page.file, html);
  }
  if (offline && tracks(head)) logger.info('Markstage head kit: tracking left out of this build (a preview: MARKSTAGE_NO_TRACKING or MARKSTAGE_PREVIEW is set).');
  for (const [t, n] of own) logger.warn(`Markstage head kit: ${n === 1 ? 'a page already loads' : `${n} pages already load`} ${t} itself, so each visit there counts twice. Take the site's own tag out, or the ID out of Site settings → Tracking.`);
  if (kept.length) logger.warn(`Markstage head kit: the site builds ${kept.length === 1 ? 'this file' : 'these files'} itself, so ${kept.length === 1 ? 'it was' : 'they were'} kept: ${kept.join(', ')}`);
  logger.info(`Markstage head kit: ${done.markdown} Markdown copies, ${done.okf} OKF files, ${done.llms} llms files, ${done.feeds.length} feeds, tracking: ${done.tracking.join(', ') || 'none'}`);
  return done;
}
