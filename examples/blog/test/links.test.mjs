// The blog's topics and links (markstage/topics/editing.json, docs/API-LINKS.md), worked out the way the Markstage
// server does it from the posts as they are: the shortcuts post has one link in (from its group's lead, which also
// talks about keyboard shortcuts without a link yet, so that sentence is suggested), and it is told to link up to the
// topic's main page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeConfig } from '@markstage/astro/config';
import { readTopics } from '@markstage/astro/topics';
import { createConverter, readFrontmatter } from '@markstage/core';
import { buildLinkMap, entryText, linkFindings } from '@markstage/core/link-map';
import { incomingSuggestions, outgoingSuggestions } from '@markstage/core/link-suggest';
import blog from '../markstage.config.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = normalizeConfig(blog, root);
const md = createConverter();
const dir = path.join(root, 'src/content/posts');
const pages = fs.readdirSync(dir).map((f) => {
  const id = path.basename(f, '.md');
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const data = readFrontmatter(text);
  const { links, blocks } = entryText({ format: 'md', doc: md.mdToDoc(text).doc });
  return { ref: `posts/${id}`, title: data.title, url: `/posts/${id}/`, live: data.draft !== true, noindex: false, type: data.pageType ?? null, keywords: [], format: 'md', links, blocks };
});
const map = buildLinkMap({ pages, topics: readTopics(cfg), cfg: cfg.topics });

test('the topic file names posts of the blog, and the map counts their links', () => {
  assert.equal(map.pages.get('posts/keyboard-shortcuts').topic, 'editing');
  assert.equal(map.pages.get('posts/writing-with-source-mode').role, 'lead');
  assert.equal(map.pages.get('posts/hello-markstage').in, 1);
  assert.equal(map.pages.get('posts/keyboard-shortcuts').in, 0);
});

test('suggestions both ways for the newest post, and what Health says about it', () => {
  const inc = incomingSuggestions(map, 'posts/keyboard-shortcuts');
  assert.equal(inc[0].from, 'posts/writing-with-source-mode');
  assert.equal(inc[0].anchor, 'keyboard shortcuts');
  assert.match(inc[0].sentence, /^The same keyboard shortcuts work in Source mode/);
  const out = outgoingSuggestions(map, 'posts/keyboard-shortcuts');
  assert.equal(out[0].to, 'posts/hello-markstage');
  assert.equal(out[0].how, 'link');
  assert.equal(out[0].anchor, 'editing');
  const f = linkFindings(map).filter((x) => x.ref === 'posts/keyboard-shortcuts').map((x) => x.kind);
  assert.deepEqual(f.sort(), ['no-links-in', 'no-pillar-link']);
});
