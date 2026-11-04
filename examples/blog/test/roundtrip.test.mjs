// The example blog's posts through the core converter (no block pack): every file reads and writes back byte for
// byte, the printer alone reads back as the same document, and an edit rewrites only its block.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createConverter } from '@markstage/core';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/posts');
const posts = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
const md = createConverter();

test('there are posts to check', () => assert.ok(posts.length >= 3));

for (const f of posts) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  test(`${f}: identity`, () => {
    const { doc } = md.mdToDoc(text);
    assert.equal(md.docToMd(doc, text), text);
    assert.equal(md.changedBlocks(doc, text), 0);
  });
  test(`${f}: the printer alone reads back as the same document`, () => {
    const { doc } = md.mdToDoc(text);
    assert.deepEqual(md.mdToDoc(md.docToMd(doc, text, { preserve: false })).doc, doc);
  });
}

test('hello-markstage.md: only the HTML aside is kept as raw HTML', () => {
  const { doc } = md.mdToDoc(fs.readFileSync(path.join(dir, 'hello-markstage.md'), 'utf8'));
  assert.deepEqual(md.rawHtmlOf(doc), ['<div class="aside">HTML the editor has no block for stays exactly as written.</div>']);
});

test('an edit to one paragraph rewrites only that block', () => {
  const text = fs.readFileSync(path.join(dir, 'hello-markstage.md'), 'utf8');
  const { doc } = md.mdToDoc(text);
  const i = doc.content.findIndex((n) => n.type === 'paragraph');
  doc.content[i].content.push({ type: 'text', text: ' Added.' });
  const out = md.docToMd(doc, text);
  assert.equal(md.changedBlocks(doc, text), 1);
  const changed = out.split('\n').filter((l, k) => l !== text.split('\n')[k]);
  assert.equal(changed.length, 1);
  assert.match(changed[0], /stays byte for byte\. Added\.$/);
});
