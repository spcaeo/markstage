// setFrontmatter: only the keys that change are rewritten; order, quoting, comments and the body stay.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFrontmatter, setFrontmatter } from '../src/index.mjs';

const src = `---
title: Plain value
date: '2024-11-08T12:09:51+00:00'
# a comment
excerpt: >-
  Long folded
  text here.
tags:
  - a
  - b
flat:
- x
seo:
  title: "Dq"
  robots:
    - follow
last: 1 # trailing
---

Body.
`;
const lines = (t) => t.split('\n');
const changedLines = (a, b) => lines(b).filter((l, i) => l !== lines(a)[i]);

test('the same values give the same file', () => {
  assert.equal(setFrontmatter(src, readFrontmatter(src)), src);
  assert.equal(setFrontmatter(src, {}), src);
});

test('a title change rewrites one line and keeps the style', () => {
  assert.deepEqual(changedLines(src, setFrontmatter(src, { title: 'New title' })), ['title: New title']);
  assert.deepEqual(changedLines(src, setFrontmatter(src, { date: '2025-01-01' })), ["date: '2025-01-01'"]);
  assert.deepEqual(changedLines(src, setFrontmatter(src, { title: 'Has: colon' })), ['title: "Has: colon"']);
  assert.deepEqual(changedLines(src, setFrontmatter(src, { last: 2 })), ['last: 2 # trailing']);
});

test('a nested key changes alone; the mapping is merged', () => {
  const out = setFrontmatter(src, { seo: { title: 'New "seo"' } });
  assert.deepEqual(changedLines(src, out), ['  title: "New \\"seo\\""']);
  assert.deepEqual(readFrontmatter(out).seo, { title: 'New "seo"', robots: ['follow'] });
});

test('folded text stays folded; lists keep their indentation', () => {
  const long = 'A much longer folded excerpt that needs to wrap because it is longer than eighty characters wide.';
  const out = setFrontmatter(src, { excerpt: long, flat: ['y', 'z'], tags: ['c'] });
  assert.match(out, /excerpt: >-\n {2}A much longer folded excerpt that needs to wrap because it is longer than\n {2}eighty characters wide\.\n/);
  assert.match(out, /flat:\n- y\n- z\n/);
  assert.match(out, /tags:\n {2}- c\n/);
  assert.equal(readFrontmatter(out).excerpt, long);
});

test('null removes a key; new keys go last in their mapping; comments stay', () => {
  const out = setFrontmatter(src, { title: null, added: 'new', seo: { description: 'Deep' } });
  assert.ok(!/^title:/m.test(out));
  assert.match(out, /# a comment\n/);
  assert.match(out, /robots:\n {4}- follow\n {2}description: Deep\nlast: 1 # trailing\nadded: new\n---\n\nBody\.\n$/);
});

test('a one-line value stays on one line', () => {
  const t = "---\ntitle: 'Short'\n---\n";
  const long = 'A title long enough that a folding writer would break it somewhere past eighty chars';
  assert.equal(setFrontmatter(t, { title: long }), `---\ntitle: '${long}'\n---\n`);
});

test('a file without frontmatter gets one; an empty one is filled', () => {
  assert.equal(setFrontmatter('Body\n', { title: 'X' }), '---\ntitle: X\n---\n\nBody\n');
  assert.equal(setFrontmatter('Body\n', { title: null }), 'Body\n');
  assert.equal(setFrontmatter('---\n---\nBody\n', { title: 'X' }), '---\ntitle: X\n---\nBody\n');
  assert.throws(() => setFrontmatter('---\nkey: [unclosed\n---\n', { a: 1 }));
});

test('clearing removes the key: set then clear is byte-identical; a mapping whose last keys go leaves with its key', () => {
  const head = '---\ntitle: A post\nexcerpt: Short.\ndate: 2026-10-01\nseo:\n  title: T\n---\n\nBody.\n';
  // an optional scalar
  const set = setFrontmatter(head, { summary: 'Added' });
  assert.notEqual(set, head);
  assert.equal(setFrontmatter(set, { summary: null }), head);
  // a whole cover, added then removed key by key as the editor sends it
  const withCover = setFrontmatter(head, { cover: { src: '2026/03/x.jpg', alt: 'A picture', focal: '40% 30%' } });
  assert.match(withCover, /\ncover:\n {2}src: 2026\/03\/x\.jpg\n {2}alt: A picture\n/);
  assert.equal(setFrontmatter(withCover, { cover: { src: null, alt: null, focal: null, width: null, height: null } }), head);
  // nested: the emptied inner mapping goes, its parent stays while it has keys
  const og = setFrontmatter(head, { seo: { og: { image: 'x.jpg' } } });
  assert.equal(setFrontmatter(og, { seo: { og: { image: null } } }), head);
  assert.equal(setFrontmatter(og, { seo: { title: null, og: { image: null } } }), '---\ntitle: A post\nexcerpt: Short.\ndate: 2026-10-01\n---\n\nBody.\n');
  // removing keys that are not there, or only some of a mapping's keys
  assert.equal(setFrontmatter(head, { cover: { src: null } }), head);
  assert.equal(setFrontmatter(withCover, { cover: { focal: null } }), setFrontmatter(head, { cover: { src: '2026/03/x.jpg', alt: 'A picture' } }));
});
