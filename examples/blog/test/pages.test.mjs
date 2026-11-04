// The blog's frames and page types (markstage.config `frames`, `pageTypes`; @markstage/astro/pages): each post page
// follows its frame (the guide full width, the article in one reading column with its contents, the legal page the
// text alone); the guide template the site ships is a Library template of its type that reads back as Markdown; the
// article's checks pass (it links to the guide of its topic); a post with a frame the site does not have stops the
// build, in plain words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'astro';
import markstage from '@markstage/astro';
import { normalizeConfig } from '@markstage/astro/config';
import { createConverter, readFrontmatter } from '@markstage/core';
import { pageLinks, pageTypeOf, pathKey, runPageChecks } from '@markstage/core/page-types';
import blog from '../markstage.config.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-pages-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const page = (rel) => fs.readFileSync(path.join(tmp, 'out', rel), 'utf8');
const cfg = normalizeConfig(blog, root);
const site = { frames: cfg.frames, pageTypes: cfg.pageTypes, collections: cfg.collections };
const posts = cfg.collections[0];
const md = createConverter();

test('each post page follows its frame', { timeout: 180_000 }, async () => {
  await build({ root, outDir: path.join(tmp, 'out'), configFile: false, trailingSlash: 'always', integrations: [markstage()], logLevel: 'error', cacheDir: path.join(tmp, 'cache') });
  const guide = page('posts/hello-markstage/index.html');
  assert.match(guide, /<body class="frame-full"/, 'a guide is full width (its type’s frame)');
  assert.doesNotMatch(guide, /<nav class="post__contents"/);
  const article = page('posts/writing-with-source-mode/index.html');
  assert.match(article, /<body class="frame-reading"/);
  assert.match(article, /by <a href="\/author\/sam-lee\/">Sam Lee<\/a>/);
  assert.match(article, /<nav class="post__contents" aria-label="Contents"><ol><li><a href="#on-the-canvas">On the canvas<\/a><\/li><\/ol><\/nav>/, 'a reading post lists its contents');
  // More on this topic (markstage/topics/editing.json): the post's group first, then the topic's main page
  const more = (html) => [...(/<aside class="more-topic"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? '').matchAll(/<a href="\/posts\/([^/]+)\/">/g)].map((m) => m[1]);
  assert.deepEqual(more(article), ['keyboard-shortcuts', 'hello-markstage']);
  assert.deepEqual(more(page('posts/keyboard-shortcuts/index.html')), ['writing-with-source-mode', 'hello-markstage']);
  assert.deepEqual(more(guide), ['writing-with-source-mode', 'keyboard-shortcuts'], 'the main page lists its group');
  const legal = page('posts/terms/index.html');
  assert.match(legal, /<body class="frame-plain"/);
  assert.doesNotMatch(legal, /<header class="site"|<p class="post__date"|<aside class="more-topic"/, 'the text alone');
});

test('the guide template the site ships: a Library template of its type, readable as Markdown', () => {
  const type = cfg.pageTypes.types.find((t) => t.id === 'guide');
  const file = path.join(root, 'markstage/library/template', `${type.template}.json`);
  const tpl = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(tpl.id, type.template);
  assert.equal(tpl.collection, 'posts');
  assert.equal(tpl.body.frontmatter.pageType, 'guide');
  const text = md.docToMd(tpl.body.doc, '');
  assert.match(text, /^## Start here$/m);
  assert.match(text, /^-\s+An article, linked/m);
});

test('the article’s checks pass: a topic, and a link to the guide of its topic', () => {
  const read = (id) => {
    const text = fs.readFileSync(path.join(root, 'src/content/posts', `${id}.md`), 'utf8');
    return { text, data: readFrontmatter(text) };
  };
  const map = new Map();
  for (const f of fs.readdirSync(path.join(root, 'src/content/posts'))) {
    const id = path.basename(f, '.md');
    map.set(pathKey(`/posts/${id}/`), { collection: 'posts', id, title: id, data: read(id).data });
  }
  const a = read('writing-with-source-mode');
  const doc = md.mdToDoc(a.text).doc;
  const links = pageLinks(doc, a.data).map((href) => ({ href, target: map.get(pathKey(href)) ?? null }));
  const checks = runPageChecks(site, pageTypeOf(site, posts, a.data), { collection: 'posts', format: 'md', data: a.data, doc, links });
  // the topic link check ("up") is the Markstage server's (it reads the whole site): nothing to say here
  assert.deepEqual(checks.map((k) => [k.id, k.ok]), [['topic', true], ['guide', true], ['up', true]]);
});

test('a post with a frame the site does not have stops the build', { timeout: 180_000 }, async () => {
  const bad = path.join(root, 'src/content/posts/zz-odd-frame.md');
  fs.writeFileSync(bad, "---\ntitle: Odd\ndate: 2026-10-26\nframe: wide\ndraft: true\n---\n\nOdd.\n");
  try {
    await assert.rejects(
      build({ root, outDir: path.join(tmp, 'bad'), configFile: false, integrations: [markstage()], logLevel: 'silent', cacheDir: path.join(tmp, 'cache-bad') }),
      /markstage: an entry has a frame or page type the site does not have:\n {2}src\/content\/posts\/zz-odd-frame\.md: “wide” is not a frame of this site\. Pick one of: Full width, Reading, Plain\./,
    );
  } finally {
    fs.rmSync(bad, { force: true });
  }
});
