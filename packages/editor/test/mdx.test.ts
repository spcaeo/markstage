// MDX in the editor (src/mdx/, docs/MDX.md), without a browser: what a component card says, which settings the
// side panel lets a writer change (text, number, on/off) and which it shows as code, what a typed value becomes,
// and the guard that keeps the imports and exports as they are. The cards and the panel in a real browser:
// packages/server/e2e/mdx.e2e.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConverter } from '@markstage/core';
import { Schema } from '@tiptap/pm/model';
import { codeWords, componentName, esmKept, propFields, propText, withProp, type Prop } from '../src/mdx/model.ts';

const mdx = createConverter({ mdx: true });
const TEXT = `import { Callout } from './Callout.astro';
import Chart from './Chart.astro';

Intro.

<Callout type="tip" open count={3} data={rows} {...rest}>
  Inside.
</Callout>
`;
const doc = mdx.mdToDoc(TEXT).doc;
const callout = doc.content.find((n) => n.type === 'mdxContainer')!;
const props = callout.attrs!.props as Prop[];

test('the card names the component and shows its settings as written', () => {
  assert.equal(componentName(callout.attrs!), 'Callout');
  assert.equal(componentName({ name: null }), 'Fragment');
  assert.deepEqual(props.map(propText), ['type="tip"', 'open', 'count={3}', 'data={…}', '{...rest}']);
  assert.equal(propText({ name: 'open', kind: 'boolean', value: false }), 'open={false}');
});

test('the panel: text, number and on/off can be changed; code is shown as written', () => {
  const fields = propFields(props);
  assert.deepEqual(
    fields.map((f) => [f.label, f.control, f.value]),
    [
      ['type', 'text', 'tip'],
      ['open', 'switch', true],
      ['count', 'number', '3'],
      ['data', 'code', '{rows}'],
      ['Spread', 'code', '{...rest}'],
    ],
  );
  // in a list or a quotation the props cannot be placed again: all read-only
  assert.ok(propFields(props, true).every((f) => f.control === 'code'));
});

test('a typed value: a number must be one, code never changes, a line break is a space', () => {
  assert.equal(withProp(props, 0, 'warn\nnow')![0].value, 'warn now');
  assert.equal(withProp(props, 1, false)![1].value, false);
  assert.equal(withProp(props, 2, ' 12 ')![2].value, 12);
  assert.equal(withProp(props, 2, 'twelve'), null);
  assert.equal(withProp(props, 2, ''), null);
  assert.equal(withProp(props, 3, 'other'), null, 'an expression');
  assert.equal(withProp(props, 4, 'x'), null, 'a spread');
  assert.equal(withProp(props, 9, 'x'), null);
});

test('a setting changed in the panel saves as that one value, in its own quote style', () => {
  const edited = structuredClone(doc);
  const c = edited.content.find((n) => n.type === 'mdxContainer')!;
  c.attrs!.props = withProp(withProp(c.attrs!.props, 0, 'warn')!, 2, '4');
  assert.equal(mdx.docToMd(edited, TEXT), TEXT.replace('type="tip" open count={3}', 'type="warn" open count={4}'));
});

test('the code says what it is, in plain words', () => {
  assert.equal(codeWords('esm', doc.content[0].attrs!.source), 'Uses 2 components: Callout, Chart. Code at the top of the file, kept as written.');
  assert.equal(codeWords('esm', 'export const a = 1;'), 'Code at the top of the file, kept as written.');
  assert.equal(codeWords('expression', '{/* note */}'), 'A note in the code, not shown on the page.');
  assert.match(codeWords('block', '- <X\n/>'), /kept as written/);
});

// the document's shape, as ProseMirror holds it (the node names and attributes the editor's nodes use)
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
    mdxCode: { group: 'block', atom: true, attrs: { kind: { default: 'expression' }, source: { default: '' } } },
    mdxContainer: { group: 'block', content: 'block+', attrs: { name: { default: null }, props: { default: [] }, open: { default: '' }, close: { default: '' }, fixed: { default: false } } },
  },
});
const pm = (json: unknown) => schema.nodeFromJSON(json);
const top = pm({ type: 'doc', content: [doc.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'Intro.' }] }] });

test('the imports and exports stay: not removed, changed, reordered, nor moved down from the top', () => {
  const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const esm = doc.content[0];
  assert.equal(esmKept(top, top), true);
  assert.equal(esmKept(top, pm({ type: 'doc', content: [esm, para('Intro, edited.'), para('New.')] })), true, 'prose edits around them');
  assert.equal(esmKept(top, pm({ type: 'doc', content: [para('Intro.')] })), false, 'removed (select all and delete)');
  assert.equal(esmKept(top, pm({ type: 'doc', content: [para('New first.'), esm, para('Intro.')] })), false, 'pushed down from the top');
  assert.equal(esmKept(top, pm({ type: 'doc', content: [{ type: 'mdxCode', attrs: { kind: 'esm', source: "import X from 'y';" } }, para('Intro.')] })), false, 'changed');
  // a file without imports: anything goes
  const plain = pm({ type: 'doc', content: [para('A.')] });
  assert.equal(esmKept(plain, pm({ type: 'doc', content: [para('B.')] })), true);
});
