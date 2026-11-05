// The example blog's MDX guides (src/content/guides, docs/MDX.md) through core's MDX converter: each file reads and
// writes back byte for byte; the imports, the export and the chart's data are code kept as written; a paragraph and
// the Callout's type edited change exactly those two lines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createConverter } from '@markstage/core';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/content/guides');
const guides = fs.readdirSync(dir).filter((f) => f.endsWith('.mdx'));
const mdx = createConverter({ mdx: true });

test('there is a guide to check', () => assert.ok(guides.length >= 1));

for (const f of guides) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  test(`${f}: identity`, () => {
    const { doc } = mdx.mdToDoc(text);
    assert.equal(mdx.docToMd(doc, text), text);
    assert.equal(mdx.changedBlocks(doc, text), 0);
  });
}

const text = fs.readFileSync(path.join(dir, 'writing-in-mdx.mdx'), 'utf8');

test('writing-in-mdx.mdx: its code, cards and settings', () => {
  const { doc } = mdx.mdToDoc(text);
  const types = doc.content.map((n) => n.type);
  assert.deepEqual(types.slice(0, 2), ['mdxCode', 'mdxCode'], 'the imports, then the export');
  const callout = doc.content.find((n) => n.type === 'mdxContainer');
  assert.equal(callout.attrs.name, 'Callout');
  assert.deepEqual(callout.attrs.props.map((p) => [p.name, p.kind, p.value]), [['type', 'string', 'tip'], ['title', 'string', 'Try it']]);
  const chart = doc.content.find((n) => n.type === 'mdxComponent');
  assert.deepEqual(chart.attrs.props.map((p) => [p.name, p.kind]), [['data', 'expression'], ['height', 'number'], ['unit', 'string']]);
});

test('writing-in-mdx.mdx: a paragraph and the Callout type edited, exactly those two lines change', () => {
  const { doc } = mdx.mdToDoc(text);
  const para = doc.content.find((n) => n.type === 'paragraph');
  para.content[0].text = para.content[0].text.replace('like any post', 'like any other post');
  const callout = doc.content.find((n) => n.type === 'mdxContainer');
  callout.attrs.props = callout.attrs.props.map((p) => (p.name === 'type' ? { ...p, value: 'warn' } : p));
  const out = mdx.docToMd(doc, text);
  const a = text.split('\n');
  const b = out.split('\n');
  assert.equal(b.length, a.length);
  const changed = a.map((l, i) => [l, b[i]]).filter(([l, m]) => l !== m);
  assert.equal(changed.length, 2);
  assert.match(changed[0][1], /like any other post/);
  assert.equal(changed[1][1], '<Callout type="warn" title="Try it">');
});
