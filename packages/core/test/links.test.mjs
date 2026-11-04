// The link rewriter of a move (@markstage/core/links), shared by the server's and the dev API's move: every locale's
// address as a path and as an absolute URL, with or without the trailing slash, keeping #hash and ?query; hrefs in
// HTML; visible text never changed. The full rewrite through the converter is proved by the server's move tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkRewriter, movePairs } from '../src/links.mjs';

test('movePairs: every locale, as a path and an absolute URL', () => {
  const pairs = movePairs('/blog/a/', '/blog/b/', { locales: { list: [{ code: 'en-CA', prefix: '' }, { code: 'en-US', prefix: '/en-us' }] }, siteUrl: 'https://example.com/' });
  assert.deepEqual(pairs, [
    { from: '/blog/a/', to: '/blog/b/' },
    { from: 'https://example.com/blog/a/', to: 'https://example.com/blog/b/' },
    { from: '/en-us/blog/a/', to: '/en-us/blog/b/' },
    { from: 'https://example.com/en-us/blog/a/', to: 'https://example.com/en-us/blog/b/' },
  ]);
});

test('linkRewriter: whole values and hrefs, never other text', () => {
  const rw = linkRewriter(movePairs('/blog/a/', '/blog/b/', { siteUrl: 'https://example.com' }));
  assert.equal(rw.value('/blog/a/'), '/blog/b/');
  assert.equal(rw.value('/blog/a'), '/blog/b', 'without the trailing slash');
  assert.equal(rw.value('/blog/a/#top'), '/blog/b/#top');
  assert.equal(rw.value('https://example.com/blog/a/?x=1'), 'https://example.com/blog/b/?x=1');
  assert.equal(rw.value('/blog/ab/'), '/blog/ab/', 'another page');
  assert.equal(rw.value('see /blog/a/ here'), 'see /blog/a/ here', 'text is not a link');
  assert.equal(rw.html('<a href="/blog/a/">x</a> /blog/a/'), '<a href="/blog/b/">x</a> /blog/a/');
  assert.equal(rw.hit('… /blog/a …'), true);
});
