// llms.txt and llms-full.txt (head/llms.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { llmsFiles } from '../src/head/llms.mjs';
import { pageMarkdown } from '../src/head/markdown.mjs';
import { readPages } from '../src/head/pages.mjs';
import { SITE, SITE_FILES, writeSite } from './head-fixtures.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-head-llms-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let docs;
before(async () => {
  writeSite(tmp, SITE_FILES);
  docs = (await readPages(tmp, { siteUrl: SITE })).filter((p) => p.indexed).map((page) => ({ page, markdown: pageMarkdown(page, { siteUrl: SITE }) }));
});
const by = (files, p) => files.find((f) => f.path === p).text;

test('two files, in this order: /llms.txt and /llms-full.txt', () => {
  assert.deepEqual(llmsFiles(docs, { siteName: 'Example Co', siteUrl: SITE }).map((f) => f.path), ['/llms.txt', '/llms-full.txt']);
});

test('llms.txt: the name, a summary quote, "## Pages" with a link to each Markdown copy, and "## Optional"', () => {
  assert.equal(
    by(llmsFiles(docs, { siteName: 'Example Co', siteUrl: `${SITE}/` }), '/llms.txt'),
    `# Example Co

> Plan, track and ship work together.

## Pages

- [Example Co - Project tracking for small teams](${SITE}/index.md): Plan, track and ship work together.
- [About](${SITE}/about.md): Who we are.
- [Writing in MDX](${SITE}/guides/mdx.md): An MDX guide.
- [Hello, Example Co & friends | Example Co blog](${SITE}/posts/hello.md): How we write posts in Markdown.
- [Press kit](${SITE}/press.md): Logos and facts.

## Optional

- [All pages in one file](${SITE}/llms-full.txt)
`,
  );
});

test('without a home page description the summary is a plain sentence; a page with no description has no colon', () => {
  const docs2 = [{ page: { path: '/x/', title: 'X [draft]', description: '', canonical: `${SITE}/x/` }, markdown: '# X\n' }];
  const t = by(llmsFiles(docs2, { siteName: 'Example Co', siteUrl: SITE }), '/llms.txt');
  assert.match(t, /^> The pages of Example Co as Markdown, for AI tools\.$/m);
  assert.match(t, /^- \[X \\\[draft\\\]\]\(https:\/\/example\.com\/x\.md\)$/m, 'brackets in a title are escaped');
  assert.equal(by(llmsFiles([], { siteName: '', siteUrl: SITE }), '/llms.txt').split('\n')[0], '# example.com');
});

test('copies: false links each page’s own address, not a copy that is not there', () => {
  const t = by(llmsFiles(docs, { siteName: 'Example Co', siteUrl: SITE, copies: false }), '/llms.txt');
  assert.match(t, /^- \[About\]\(https:\/\/example\.com\/about\/\): Who we are\.$/m);
  assert.doesNotMatch(t, /\.md\)/);
});

test('llms-full.txt: every page’s Markdown, one after another, separated by a rule', () => {
  const full = by(llmsFiles(docs, { siteName: 'Example Co', siteUrl: SITE }), '/llms-full.txt');
  const parts = full.trimEnd().split('\n\n---\n\n');
  assert.equal(parts.length, docs.length);
  assert.deepEqual(parts, docs.map((d) => d.markdown.trim()));
  assert.ok(full.endsWith('\n') && !full.endsWith('\n\n'));
  assert.match(parts[0], /^# Example Co - Project tracking/);
  assert.equal(by(llmsFiles([], { siteUrl: SITE }), '/llms-full.txt'), '\n');
});
