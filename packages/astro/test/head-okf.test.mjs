// The OKF bundle (head/okf.mjs): stable file names, front matter, links between pages, the index.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pageMarkdown } from '../src/head/markdown.mjs';
import { okfFiles, okfName, okfNames } from '../src/head/okf.mjs';
import { readPages } from '../src/head/pages.mjs';
import { SITE, SITE_FILES, writeSite } from './head-fixtures.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-head-okf-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const doc = (p, markdown, over = {}) => ({ page: { path: p, title: `Title of ${p}`, description: '', canonical: `${SITE}${p}`, lang: '', modified: null, ...over }, markdown: markdown ?? `# Title of ${p}\n\nCanonical: ${SITE}${p}\n` });
const get = (files, p) => files.find((f) => f.path === p)?.text;
let docs;
before(async () => {
  writeSite(tmp, SITE_FILES);
  docs = (await readPages(tmp, { siteUrl: SITE })).filter((p) => p.indexed).map((page) => ({ page, markdown: pageMarkdown(page, { siteUrl: SITE }) }));
});

test('file names: the page path joined with "-", the home page "homepage"', () => {
  assert.equal(okfName('/'), 'homepage');
  assert.equal(okfName('/about/'), 'about');
  assert.equal(okfName('/posts/hello/'), 'posts-hello');
  assert.equal(okfName('/a/b/c/'), 'a-b-c');
  assert.equal(okfName('/fr/a-propos/'), 'fr-a-propos', 'a locale prefix is part of the name: its own copy');
  assert.equal(okfName('/caf%C3%A9/menu/'), 'café-menu');
  assert.equal(okfName('/a b/c&d/'), 'a-b-c-d');
  assert.equal(okfName('/x.html'), 'x');
  assert.equal(okfName('/../..//'), 'page');
  assert.equal(okfName('/%E0%A4%A/'), 'E0-A4-A', 'a path that is not valid percent-encoding is named as it is, its odd characters made dashes');
});

test('names are unique and stable: a clash gets -2, -3 in path order, whatever order the pages come in', () => {
  const list = ['/a-b/', '/a/b/', '/a/b-/', '/', '/index/', '/Index/', '/about/', '/About/'].map((p) => doc(p));
  // "index" belongs to the bundle's index, "About"/"about" are one file on a case-insensitive disk
  const got = Object.fromEntries(okfNames(list));
  assert.equal(got['/'], 'homepage');
  assert.equal(got['/a-b/'], 'a-b');
  assert.equal(got['/a/b-/'], 'a-b-2', 'path order: /a-b/ < /a/b-/ < /a/b/');
  assert.equal(got['/a/b/'], 'a-b-3');
  assert.equal(got['/About/'], 'About');
  assert.equal(got['/about/'], 'about-2');
  assert.notEqual(got['/Index/'].toLowerCase(), 'index');
  assert.notEqual(got['/index/'].toLowerCase(), 'index');
  assert.notEqual(got['/Index/'].toLowerCase(), got['/index/'].toLowerCase());
  assert.deepEqual(Object.fromEntries(okfNames([...list].reverse())), got, 'the same names in any input order');
  assert.equal(new Set(Object.values(got).map((n) => n.toLowerCase())).size, list.length);
});

test('a bundle: the index and one file per page, none outside /okf/', () => {
  const files = okfFiles(docs, { siteName: 'Example Co', siteUrl: SITE });
  assert.equal(files[0].path, '/okf/index.md');
  assert.deepEqual(files.map((f) => f.path).sort(), ['/okf/about.md', '/okf/guides-mdx.md', '/okf/homepage.md', '/okf/index.md', '/okf/posts-hello.md', '/okf/press.md']);
  for (const f of files) assert.match(f.path, /^\/okf\/[^/]+\.md$/);
});

test('the index: a heading, the source, "# Concepts" and one line per page, sorted by title, with its description', () => {
  const index = get(okfFiles(docs, { siteName: 'Example Co', siteUrl: `${SITE}/` }), '/okf/index.md');
  assert.equal(
    index,
    `# Open Knowledge graph Example Co

An OKF v0.1 bundle generated from example.com

# Concepts

* [About](${SITE}/okf/about.md) - Who we are.
* [Example Co - Project tracking for small teams](${SITE}/okf/homepage.md) - Plan, track and ship work together.
* [Hello, Example Co & friends | Example Co blog](${SITE}/okf/posts-hello.md) - How we write posts in Markdown.
* [Press kit](${SITE}/okf/press.md) - Logos and facts.
* [Writing in MDX](${SITE}/okf/guides-mdx.md) - An MDX guide.
`,
  );
});

test('an empty site gives an index with no concepts', () => {
  const files = okfFiles([], { siteName: '', siteUrl: SITE });
  assert.equal(files.length, 1);
  assert.equal(files[0].text, '# Open Knowledge graph example.com\n\nAn OKF v0.1 bundle generated from example.com\n\n# Concepts\n\n');
});

test('one page: YAML front matter (title, url, description, lang, modified) then its Markdown', () => {
  const t = get(okfFiles(docs, { siteName: 'Example Co', siteUrl: SITE }), '/okf/posts-hello.md');
  const [open, ...rest] = t.split('\n');
  assert.equal(open, '---');
  const end = rest.indexOf('---');
  assert.deepEqual(rest.slice(0, end), [
    'title: "Hello, Example Co & friends | Example Co blog"',
    'url: "https://example.com/posts/hello/"',
    'description: "How we write posts in Markdown."',
    'lang: "en"',
    'modified: "2026-11-03T10:00:00Z"',
  ]);
  assert.equal(rest[end + 1], '');
  assert.match(rest[end + 2], /^# Hello, Example Co & friends \| Example Co blog$/);
  assert.match(t, /^## Why$/m);
  assert.ok(t.endsWith('\n') && !t.endsWith('\n\n'));
});

test('front matter is real YAML: quotes, colons and newlines in a title or description are escaped', () => {
  const page = { path: '/q/', title: 'He said "hi": a\nb', description: 'x: y  # not a comment', canonical: `${SITE}/q/`, lang: '', modified: null };
  const t = okfFiles([{ page, markdown: '# q\n' }], { siteName: 's', siteUrl: SITE })[1].text;
  assert.match(t, /^title: "He said \\"hi\\": a b"$/m, 'whitespace collapsed, quotes escaped');
  assert.match(t, /^description: "x: y # not a comment"$/m);
  assert.doesNotMatch(t, /^lang:|^modified:/m, 'fields that are not known are not written');
});

test('links to other pages of the site point at their OKF files; fragments are dropped; others stay', () => {
  const list = [
    doc('/', `# Home\n\n[About](${SITE}/about/) and [the tips](${SITE}/posts/x/#tips) and [again](${SITE}/about/?ref=nav#team) and [outside](https://other.example.org/about/) and [a file](${SITE}/files/a.pdf) and [home](${SITE}/)\n\n[![Logo](${SITE}/logo.png)](${SITE}/about/)\n\nCanonical: ${SITE}/about/\n\n![Pic](${SITE}/about/)\n`),
    doc('/about/'),
    doc('/posts/x/'),
  ];
  const files = okfFiles(list, { siteName: 'S', siteUrl: SITE });
  const home = get(files, '/okf/homepage.md');
  assert.match(home, new RegExp(`\\[About\\]\\(${SITE}/okf/about\\.md\\)`));
  assert.match(home, new RegExp(`\\[the tips\\]\\(${SITE}/okf/posts-x\\.md\\)`));
  assert.match(home, new RegExp(`\\[again\\]\\(${SITE}/okf/about\\.md\\)`), 'a query and a fragment are dropped');
  assert.match(home, /\[outside\]\(https:\/\/other\.example\.org\/about\/\)/);
  assert.match(home, new RegExp(`\\[a file\\]\\(${SITE}/files/a\\.pdf\\)`), 'not a page of the site: kept');
  assert.match(home, new RegExp(`\\[home\\]\\(${SITE}/okf/homepage\\.md\\)`));
  assert.match(home, new RegExp(`\\[!\\[Logo\\]\\(${SITE}/logo\\.png\\)\\]\\(${SITE}/okf/about\\.md\\)`), 'an image inside a link: the link is rewritten, the image kept');
  assert.match(home, new RegExp(`^Canonical: ${SITE}/about/$`, 'm'), 'the Canonical line is the page’s real address');
});

test('real pages: the post’s link to its author page (not in the bundle) stays, its links between pages are rewritten', () => {
  const list = [
    doc('/a/', `# A\n\n[B](${SITE}/b.html) [C](${SITE}/c)\n`),
    doc('/b/'),
    doc('/c/'),
  ];
  const a = get(okfFiles(list, { siteName: 'S', siteUrl: SITE }), '/okf/a.md');
  assert.match(a, new RegExp(`\\[B\\]\\(${SITE}/okf/b\\.md\\) \\[C\\]\\(${SITE}/okf/c\\.md\\)`), 'an address with .html or no slash is the same page');
  const real = get(okfFiles(docs, { siteName: 'S', siteUrl: SITE }), '/okf/posts-hello.md');
  assert.match(real, /\[Sam Lee\]\(https:\/\/example\.com\/author\/sam-lee\/\)/);
});

test('siteUrl with a path: only addresses under it are the site’s', () => {
  const base = `${SITE}/docs`;
  const list = [doc('/a/', `# A\n\n[B](${base}/b/) [other](${SITE}/b/) [near](${base}-x/b/)\n`), doc('/b/')];
  const a = get(okfFiles(list, { siteName: 'S', siteUrl: base }), '/okf/a.md');
  assert.match(a, new RegExp(`\\[B\\]\\(${base}/okf/b\\.md\\)`));
  assert.match(a, new RegExp(`\\[other\\]\\(${SITE}/b/\\)`));
  assert.match(a, new RegExp(`\\[near\\]\\(${base}-x/b/\\)`));
});
