// The head kit reads the built pages (head/pages.mjs): each page's facts from its head, and which pages are left out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathKey, skipped } from '../src/head/paths.mjs';
import { pagePathOf, readPages } from '../src/head/pages.mjs';
import { SITE, SITE_FILES, doc, writeSite } from './head-fixtures.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-head-pages-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const site = path.join(tmp, 'site');
let pages;
const at = (p) => pages.find((x) => x.path === p);
before(async () => {
  writeSite(site, SITE_FILES);
  pages = await readPages(site, { siteUrl: `${SITE}/`, skip: [] });
});

test('page paths: a folder index, a file and the 404 page', () => {
  assert.equal(pagePathOf('index.html'), '/');
  assert.equal(pagePathOf(path.join('posts', 'hello', 'index.html')), '/posts/hello/');
  assert.equal(pagePathOf('404.html'), '/404/');
  assert.equal(pagePathOf('about.html'), '/about/');
  // decoded, as a server looks the file up (the URLs the kit writes encode it: head-review-fixes.test.mjs)
  assert.equal(pagePathOf(path.join('café menu', 'index.html')), '/café menu/');
});

test('every page is read, sorted by path, with its file', () => {
  assert.deepEqual(pages.map((p) => p.path), ['/', '/404/', '/about/', '/google0123456789abcdef/', '/guides/mdx/', '/old/', '/posts/hello/', '/press/', '/thanks/']);
  assert.equal(pages[0].file, path.join(site, 'index.html'));
  assert.match(pages[0].html, /^<!doctype html>/);
});

test('title, description, canonical, language and modified date come from the head', () => {
  const post = at('/posts/hello/');
  assert.equal(post.title, 'Hello, Example Co & friends | Example Co blog', 'the title is decoded');
  assert.equal(post.description, 'How we write posts in Markdown.');
  assert.equal(post.canonical, `${SITE}/posts/hello/`);
  assert.equal(post.lang, 'en');
  assert.equal(post.modified, '2026-11-03T10:00:00Z', 'article:modified_time first');
  assert.equal(at('/guides/mdx/').modified, '2026-11-02T09:30:00Z', 'else the JSON-LD dateModified');
  assert.equal(at('/press/').modified, '2026-11-02T09:30:00Z');
});

test('a page without a canonical link gets siteUrl + path; a relative canonical is made absolute', async () => {
  assert.equal(at('/about/').canonical, `${SITE}/about/`);
  const dir = fs.mkdtempSync(path.join(tmp, 'rel-'));
  writeSite(dir, { 'a/index.html': doc({ canonical: '/b/', body: '<h1>A</h1>' }), 'c/index.html': doc({ canonical: 'http://[bad', body: '<h1>C</h1>' }) });
  const [a, c] = await readPages(dir, { siteUrl: SITE });
  assert.equal(a.canonical, `${SITE}/b/`);
  assert.equal(c.canonical, `${SITE}/c/`, 'an address that is not one falls back to the page’s own');
});

test('a page with no date, no description or no language says so plainly', () => {
  const about = at('/about/');
  assert.equal(about.lang, 'en');
  assert.equal(at('/thanks/').description, '');
  assert.equal(at('/thanks/').modified, '2026-11-02T09:30:00Z');
});

test('indexed: noindex, the 404 page, a redirect and a file that is not a page are left out', () => {
  const indexed = Object.fromEntries(pages.map((p) => [p.path, p.indexed]));
  assert.deepEqual(indexed, {
    '/': true,
    '/404/': false,
    '/about/': true,
    '/google0123456789abcdef/': false,
    '/guides/mdx/': true,
    '/old/': false,
    '/posts/hello/': true,
    '/press/': true,
    '/thanks/': false,
  });
});

test('noindex is read from robots and googlebot, in any case, and "none" counts; index does not', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'robots-'));
  writeSite(dir, {
    'a/index.html': doc({ robots: 'NoIndex' , body: '<h1>A</h1>' }),
    'b/index.html': doc({ head: '<meta name="googlebot" content="nofollow, noindex">', body: '<h1>B</h1>' }),
    'c/index.html': doc({ robots: 'none', body: '<h1>C</h1>' }),
    'd/index.html': doc({ robots: 'index, follow', body: '<h1>D</h1>' }),
    'e/index.html': doc({ robots: 'max-snippet:-1, noimageindex', body: '<h1>E</h1>' }),
  });
  const got = Object.fromEntries((await readPages(dir, { siteUrl: SITE })).map((p) => [p.path, p.indexed]));
  assert.deepEqual(got, { '/a/': false, '/b/': false, '/c/': false, '/d/': true, '/e/': true });
});

test('skip: an exact path (with or without the slash) and a prefix ending in /*', async () => {
  const skip = async (list) => (await readPages(site, { siteUrl: SITE, skip: list })).filter((p) => !p.indexed).map((p) => p.path);
  const base = ['/404/', '/google0123456789abcdef/', '/old/', '/thanks/'];
  assert.deepEqual(await skip(['/press']), [...base, '/press/'].sort());
  assert.deepEqual(await skip(['/press/']), [...base, '/press/'].sort());
  assert.deepEqual(await skip(['/posts/*']), [...base, '/posts/hello/'].sort());
  assert.deepEqual(await skip(['/guides/mdx']), [...base, '/guides/mdx/'].sort());
  assert.deepEqual(await skip(['/post']), base, 'a part of a name is not a match');
  assert.deepEqual(await skip(['/po/*']), base);
});

test('skip helpers: pathKey and skipped', () => {
  assert.equal(pathKey('/a/b/'), '/a/b');
  assert.equal(pathKey('/a/b.html'), '/a/b');
  assert.equal(pathKey('/a/b/index.html?x=1#y'), '/a/b');
  assert.equal(pathKey('/index.html'), '/');
  assert.equal(pathKey(''), '/');
  assert.equal(skipped('/blog/', ['/blog/*']), true, 'the section’s own page is under its prefix');
  assert.equal(skipped('/blogger/', ['/blog/*']), false);
  assert.equal(skipped('/x/', ['/*']), true);
  assert.equal(skipped('/x/', []), false);
});

test('a page and a folder of the same name are one page (the folder index wins)', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'dup-'));
  writeSite(dir, { 'a.html': doc({ title: 'File', body: '<h1>f</h1>' }), 'a/index.html': doc({ title: 'Folder', body: '<h1>d</h1>' }) });
  const got = await readPages(dir, { siteUrl: SITE });
  assert.deepEqual(got.map((p) => [p.path, p.title]), [['/a/', 'Folder']]);
});

test('hidden folders and non-HTML files are not pages', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'hid-'));
  writeSite(dir, { 'index.html': doc({ body: '<h1>x</h1>' }), '.vercel/x.html': doc({ body: '<h1>y</h1>' }), 'feed.xml': '<rss/>', 'a.txt': 'x' });
  assert.deepEqual((await readPages(dir, { siteUrl: SITE })).map((p) => p.path), ['/']);
});
