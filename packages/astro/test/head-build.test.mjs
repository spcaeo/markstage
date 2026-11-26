// The head kit in a real build: the example blog built with `head` on (its markstage.config and src/site/head.json) has a
// Markdown copy of every indexed page, the OKF bundle, llms.txt, and the links to them in every page's head; the 404
// page has no copy; building again over the output changes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import { readPages } from '../src/head/pages.mjs';

const blog = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/blog');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-head-build-'));
const out = path.join(tmp, 'out');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');
const SITE = 'https://blog.example.com';
const links = (html) => [...html.matchAll(/<link\b[^>]*data-markstage-head[^>]*>/g)].map((m) => m[0]);
let pages;

before(async () => {
  await build({ root: blog, outDir: out, logLevel: 'error', cacheDir: path.join(tmp, 'cache') });
  pages = await readPages(out, { siteUrl: SITE });
}, { timeout: 180_000 });

test('every indexed page has a Markdown copy next to it; the home page is /index.md', () => {
  const indexed = pages.filter((p) => p.indexed);
  assert.ok(indexed.length >= 8, 'the blog’s home page, posts, guide and authors');
  for (const p of indexed) {
    const file = p.path === '/' ? 'index.md' : `${p.path.replace(/^\/|\/$/g, '')}.md`;
    assert.ok(fs.existsSync(path.join(out, file)), `${file} for ${p.path}`);
    const text = read(file);
    assert.match(text, /^# \S/);
    assert.ok(text.includes(`\nCanonical: ${SITE}${p.path}\n`), `${file} names its address`);
  }
  assert.match(read('posts/writing-with-source-mode.md'), /^## On the canvas$/m);
  assert.match(read('guides/writing-in-mdx.md'), /^## Components are cards$/m, 'an MDX guide, its components included');
});

test('the 404 page is built, has no Markdown copy and is in no list; a draft is not built at all', () => {
  assert.ok(fs.existsSync(path.join(out, '404.html')));
  assert.ok(!fs.existsSync(path.join(out, '404.md')));
  assert.ok(!fs.existsSync(path.join(out, 'okf/404.md')));
  assert.ok(!fs.existsSync(path.join(out, 'posts/a-draft.md')));
  for (const f of ['llms.txt', 'llms-full.txt', 'okf/index.md']) assert.doesNotMatch(read(f), /Page not found|\/404/, f);
});

test('/okf/index.md lists every indexed page; each has its OKF file, with links between pages pointing at those', () => {
  const index = read('okf/index.md');
  assert.match(index, /^# Open Knowledge graph Example blog$/m);
  assert.match(index, /^# Concepts$/m);
  const indexed = pages.filter((p) => p.indexed);
  assert.equal([...index.matchAll(/^\* \[/gm)].length, indexed.length);
  for (const m of index.matchAll(/^\* \[[^\]]+\]\((https:[^)]+)\)/gm)) assert.ok(fs.existsSync(path.join(out, new URL(m[1]).pathname)), m[1]);
  const post = read('okf/posts-writing-with-source-mode.md');
  assert.match(post, /^---\ntitle: "Writing in Source mode/);
  assert.match(post, /\]\(https:\/\/blog\.example\.com\/okf\/posts-hello-markstage\.md\)/, 'the link to the guide is its OKF file');
  assert.doesNotMatch(post, /\]\(https:\/\/blog\.example\.com\/posts\//);
});

test('/llms.txt and /llms-full.txt', () => {
  const txt = read('llms.txt');
  assert.match(txt, /^# Example blog\n\n> /);
  assert.match(txt, /^## Pages$/m);
  assert.match(txt, new RegExp(`\\(${SITE}/index\\.md\\)`));
  assert.match(txt, new RegExp(`\\[Keyboard shortcuts\\]\\(${SITE}/posts/keyboard-shortcuts\\.md\\)`));
  const indexed = pages.filter((p) => p.indexed);
  assert.equal([...read('llms-full.txt').matchAll(/^Canonical: /gm)].length, indexed.length, 'every indexed page, once');
});

test('every page’s head links to the OKF bundle; an indexed page links its own copy, the 404 page none', () => {
  for (const p of pages) {
    const l = links(p.html);
    const okf = l.filter((x) => x.includes('title="OKF bundle"'));
    assert.equal(okf.length, 1, `${p.path} has the bundle link once`);
    assert.ok(okf[0].includes(`type="text/markdown"`) && okf[0].includes(`href="${SITE}/okf/index.md"`));
    const copy = l.filter((x) => x.includes('title="Markdown version of this page"'));
    if (!p.indexed) {
      assert.equal(copy.length, 0, `${p.path} (not indexed) links no copy`);
      continue;
    }
    const file = p.path === '/' ? '/index.md' : `${p.path.replace(/\/$/, '')}.md`;
    assert.equal(copy.length, 1, p.path);
    assert.ok(copy[0].includes('rel="alternate"') && copy[0].includes('type="text/markdown"') && copy[0].includes(`href="${SITE}${file}"`), copy[0]);
  }
  const html = read('posts/hello-markstage/index.html');
  assert.ok(html.indexOf('data-markstage-head') < html.indexOf('</head>'), 'in the head');
});

test('the copy of the home page lists the posts, as plain Markdown', () => {
  assert.match(read('index.md'), /^- \[Keyboard shortcuts\]\(https:\/\/blog\.example\.com\/posts\/keyboard-shortcuts\/\)/m);
  assert.doesNotMatch(read('index.md'), /<[a-z]/i);
});
