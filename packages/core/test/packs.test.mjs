// Core converter with a tiny block pack: a one-line block, a wrap block with a fixed title, a wrap that only opens
// inside its parent; plus the pack checks and the fallbacks (anything unknown stays as written).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConverter, decodeHtml, definePack, escHtml } from '../src/index.mjs';

const pack = definePack({
  name: 'demo',
  blocks: [
    {
      name: 'note',
      kind: 'line',
      parse(html) {
        const m = /^<aside class="note">([^<]*)<\/aside>$/.exec(html);
        return m ? { type: 'note', attrs: { text: decodeHtml(m[1]) } } : null;
      },
      print: (node) => `<aside class="note">${escHtml(node.attrs.text)}</aside>`,
    },
    {
      name: 'panel',
      kind: 'wrap',
      open: (html) => (html === '<div class="panel">' ? { title: '**In short**', close: '</div>' } : null),
      printOpen: () => '<div class="panel">\n\n**In short**',
      printClose: () => '</div>',
    },
    { name: 'cols', kind: 'wrap', children: ['col', 'col'], open: (h) => (h === '<div class="cols">' ? { close: '</div>' } : null), printOpen: () => '<div class="cols">', printClose: () => '</div>' },
    { name: 'col', kind: 'wrap', parent: 'cols', open: (h) => (h === '<div class="col">' ? { close: '</div>' } : null), printOpen: () => '<div class="col">', printClose: () => '</div>' },
  ],
});

const md = createConverter({ packs: [pack] });
const TEXT = `---
title: Demo
---

Intro with **bold** and a [link](/x/).

<aside class="note">A note &amp; more</aside>

<div class="panel">

**In short**

- one
- two

</div>

<div class="cols">

<div class="col">

Left

</div>

<div class="col">

Right

</div>

</div>

<div class="col">

Not inside cols: stays HTML

</div>

<section>unknown</section>
`;

test('reads the pack blocks', () => {
  const { frontmatter, doc } = md.mdToDoc(TEXT);
  assert.equal(frontmatter, '---\ntitle: Demo\n---\n');
  const types = doc.content.map((n) => n.type);
  assert.deepEqual(types.slice(0, 4), ['paragraph', 'note', 'panel', 'cols']);
  assert.equal(doc.content[1].attrs.text, 'A note & more');
  assert.deepEqual(doc.content[2].content.map((n) => n.type), ['bulletList']);
  assert.deepEqual(doc.content[3].content.map((n) => n.type), ['col', 'col']);
  assert.ok(types.slice(4).every((t) => t === 'rawHtml' || t === 'paragraph'), types.join());
});

test('identity: the file writes back byte for byte', () => {
  const { doc } = md.mdToDoc(TEXT);
  assert.equal(md.docToMd(doc, TEXT), TEXT);
  assert.equal(md.changedBlocks(doc, TEXT), 0);
});

test('the printer alone reads back as the same document', () => {
  const { doc } = md.mdToDoc(TEXT);
  assert.deepEqual(md.mdToDoc(md.docToMd(doc, TEXT, { preserve: false })).doc, doc);
});

test('an edit in a pack block rewrites only that block', () => {
  const { doc } = md.mdToDoc(TEXT);
  doc.content[1].attrs.text = 'Changed <note>';
  const out = md.docToMd(doc, TEXT);
  assert.equal(md.changedBlocks(doc, TEXT), 1);
  assert.equal(out, TEXT.replace('A note &amp; more', 'Changed &lt;note&gt;'));
});

test('unknown HTML is kept as raw HTML', () => {
  const { doc } = md.mdToDoc(TEXT);
  assert.ok(md.rawHtmlOf(doc).includes('<section>unknown</section>'));
});

test('the same text without the pack is all kept, unchanged', () => {
  const plain = createConverter();
  const { doc } = plain.mdToDoc(TEXT);
  assert.equal(plain.docToMd(doc, TEXT), TEXT);
  assert.ok(plain.rawHtmlOf(doc).includes('<aside class="note">A note &amp; more</aside>'));
});

test('a parse that would not print back the same is refused', () => {
  const lossy = definePack({
    name: 'lossy',
    blocks: [{ name: 'note', kind: 'line', parse: (h) => (h.startsWith('<aside') ? { type: 'note', attrs: {} } : null), print: () => '<aside></aside>' }],
  });
  const { doc } = createConverter({ packs: [lossy] }).mdToDoc('<aside class="x">a</aside>\n');
  assert.equal(doc.content[0].type, 'rawHtml');
});

test('pack mistakes are reported in plain words', () => {
  assert.throws(() => definePack({ name: 'x', blocks: [{ name: 'Bad', kind: 'line' }] }), /camelCase/);
  assert.throws(() => definePack({ name: 'x', blocks: [{ name: 'a', kind: 'other' }] }), /kind must be/);
  assert.throws(() => createConverter({ packs: [definePack({ name: 'x', blocks: [{ name: 'paragraph', kind: 'line', parse: () => null, print: () => '' }] })] }), /core node name/);
});
