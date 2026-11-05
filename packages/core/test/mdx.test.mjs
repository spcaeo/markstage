// MDX (docs/MDX.md): a corpus of real-world MDX shapes reads and writes back byte for byte; an edit to one
// paragraph changes only that paragraph; a literal prop edit rewrites only that value, in its own quote style; code
// is kept as written; a file the reader cannot read (or write back exactly) is refused with its line, never saved.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { createConverter, markdownUrls, rawHtmlOf, MdxError } from '../src/index.mjs';
import { editMatrix } from '../src/verify.mjs';

const mdx = createConverter({ mdx: true });
const dir = new URL('./fixtures/mdx/', import.meta.url);
const fixture = (f) => readFileSync(new URL(f, dir), 'utf8');

// the shapes, one per case (frontmatter, imports, exports, nested JSX, self-closing, fragments, expressions,
// comments, code fences with JSX-looking text, Windows line ends, no newline at the end)
const CORPUS = {
  'imports and exports': "import { Callout } from './Callout.astro';\nimport Chart from './Chart.astro';\nexport const meta = { title: 'x' };\n\nText.\n",
  'self-closing with every kind of prop': '<Chart data={[1, 2]} height={240} animate label="Sales" note=\'it\'s\' {...rest} />\n'.replace("'it's'", "'it&#39;s'"),
  'nested JSX': '<Tabs>\n  <Tab label="a">\n    One.\n  </Tab>\n  <Tab label="b">\n    Two.\n  </Tab>\n</Tabs>\n',
  'fragment': '<>\n  Inside a fragment.\n</>\n',
  'flow expression and comment': '{props.intro}\n\n{/* a comment */}\n\nAfter.\n',
  'inline JSX and expressions': 'A <Badge text="new" /> and {1 + 1} and <Kbd>Cmd</Kbd>.\n',
  'code fence with JSX-looking text': '```jsx\n<Callout type="tip" />\n{notCode}\nimport x from "y";\n```\n\nAfter the fence.\n',
  'tags on one line are inline': '<Callout>All on one line</Callout>\n',
  'JSX in a list and a quotation': '- <Badge /> one\n- two {x}\n\n> <Note text="q" />\n',
  'code over lines in a list': '- <Note\n    text="long"\n  />\n- two\n',
  'html-like marks': 'Some <strong>bold</strong>, <em>italic</em>, a <br /> break and <a href="https://example.com/" rel="nofollow">a link</a>.\n',
  'escapes kept': 'Braces \\{like this\\} and \\<not a tag>.\n',
  'Windows line ends': '---\r\ntitle: Windows\r\n---\r\n\r\nimport { Callout } from "./Callout";\r\n\r\nFirst paragraph,\r\non two lines.\r\n\r\n<Callout type="note">\r\n  Inside the callout.\r\n</Callout>\r\n\r\nLast paragraph.\r\n',
  'no newline at the end': '---\ntitle: End\n---\n\nimport X from "./X.astro";\n\nText before.\n\n<X label="end" />',
  'multi-line opening tag': '<Callout\n  type="tip"\n  title="Two lines"\n>\n  Text inside.\n</Callout>\n',
  'empty body after frontmatter': '---\ntitle: Empty\n---\n',
};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mdx'))) CORPUS[`fixture ${f}`] = fixture(f);

const para = (doc, text) => {
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.type === 'paragraph' && n.content?.some((t) => t.text?.includes(text))) return n;
      const hit = walk(n.content);
      if (hit) return hit;
    }
    return null;
  };
  return walk(doc.content);
};
const find = (doc, type, name) => {
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.type === type && (name === undefined || n.attrs?.name === name)) return n;
      const hit = walk(n.content);
      if (hit) return hit;
    }
    return null;
  };
  return walk(doc.content);
};
/** The lines that differ between two texts of the same line count. */
const changedLines = (a, b) => {
  const x = a.split('\n');
  const y = b.split('\n');
  assert.equal(x.length, y.length, 'same number of lines');
  return y.filter((l, i) => l !== x[i]);
};

for (const [name, text] of Object.entries(CORPUS)) {
  test(`round trip, byte for byte: ${name}`, () => {
    const { doc } = mdx.mdToDoc(text);
    assert.equal(mdx.docToMd(doc, text), text);
    // (an empty body reads as one empty paragraph, which Markdown counts the same way)
    if (doc.content.some((n) => n.content?.length || n.attrs)) assert.equal(mdx.changedBlocks(doc, text), 0);
  });
}

test('the code becomes locked nodes; prose stays prose', () => {
  const { doc } = mdx.mdToDoc(fixture('docs-page.mdx'));
  const types = doc.content.map((n) => n.type);
  assert.equal(types[0], 'mdxCode');
  assert.equal(doc.content[0].attrs.kind, 'esm');
  assert.ok(types.includes('mdxContainer') && types.includes('mdxComponent'));
  assert.equal(find(doc, 'mdxCode', undefined).attrs.source.startsWith('import { Callout'), true);
  assert.equal(doc.content.filter((n) => n.type === 'mdxCode' && n.attrs.kind === 'expression').length, 1, 'the comment');
  // the code fence is a code block, not a component
  assert.equal(find(doc, 'codeBlock').content[0].text.startsWith('<Callout type="warn">'), true);
  // a component inside a line is an atom; <br /> in a table is a line break
  assert.equal(find(doc, 'paragraph').type, 'paragraph');
  const callout = find(doc, 'mdxContainer', 'Callout');
  assert.deepEqual(callout.attrs.props, [
    { name: 'type', kind: 'string', value: 'tip' },
    { name: 'title', kind: 'string', value: 'Before you start' },
  ]);
  assert.equal(callout.content[0].type, 'paragraph', 'the children are prose');
  const chart = find(doc, 'mdxComponent', 'Chart');
  assert.deepEqual(chart.attrs.props.map((p) => [p.name, p.kind, p.value]), [['data', 'expression', '[3, 5, 8]'], ['height', 'number', 240], ['animate', 'boolean', true]]);
  assert.equal(find(doc, 'mdxComponent', 'Note.Small').attrs.props[0].kind, 'spread');
  // nested JSX: Tab cards inside the Tabs card
  assert.equal(find(doc, 'mdxContainer', 'Tabs').content[0].type, 'mdxContainer');
});

test('editing one paragraph changes only that paragraph', () => {
  const text = fixture('docs-page.mdx');
  const { doc } = mdx.mdToDoc(text);
  para(doc, 'Markstage edits the prose').content[0].text = 'Markstage edits the words of an MDX page and keeps its code as written. This page uses ';
  const out = mdx.docToMd(doc, text);
  assert.equal(mdx.changedBlocks(doc, text), 1);
  assert.deepEqual(changedLines(text, out), ['Markstage edits the words of an MDX page and keeps its code as written. This page uses {versions.length} versions.']);
});

test('editing a paragraph inside a component changes only that line', () => {
  const text = fixture('docs-page.mdx');
  const { doc } = mdx.mdToDoc(text);
  para(find(doc, 'mdxContainer', 'Callout'), 'Check it with').content[0].text = 'Check the version with ';
  const out = mdx.docToMd(doc, text);
  // its indent is the gap before it, kept as written
  assert.deepEqual(changedLines(text, out), ['  Check the version with `node -v`.']);
  // and inside a component nested in another
  const d2 = mdx.mdToDoc(text).doc;
  para(d2, 'Use pnpm').content[0].text = 'Use pnpm, if you like.';
  assert.deepEqual(changedLines(text, mdx.docToMd(d2, text)), ['    Use pnpm, if you like.']);
});

test('a literal prop edit rewrites only that value, in its own quote style', () => {
  const text = fixture('docs-page.mdx');
  const { doc } = mdx.mdToDoc(text);
  const callout = find(doc, 'mdxContainer', 'Callout');
  callout.attrs.props[0].value = 'warning';
  callout.attrs.props[1].value = 'Read “this” first';
  assert.deepEqual(changedLines(text, mdx.docToMd(doc, text)), [`<Callout type="warning" title='Read “this” first'>`]);
  // a quote of the value's own style is written as a reference, never by switching quotes
  callout.attrs.props[1].value = "Don't skip it";
  const out = mdx.docToMd(doc, text);
  assert.deepEqual(changedLines(text, out), [`<Callout type="warning" title='Don&#39;t skip it'>`]);
  assert.equal(find(mdx.mdToDoc(out).doc, 'mdxContainer', 'Callout').attrs.props[1].value, "Don't skip it", 'reads back as typed');
});

test('number and boolean props: braces and bare flags keep their form', () => {
  const text = fixture('docs-page.mdx');
  const { doc } = mdx.mdToDoc(text);
  const chart = find(doc, 'mdxComponent', 'Chart');
  chart.attrs.props[1].value = 320;
  chart.attrs.props[2].value = false;
  assert.deepEqual(changedLines(text, mdx.docToMd(doc, text)), ['<Chart data={[3, 5, 8]} height={320} animate={false} />']);
  chart.attrs.props[2].value = true;
  assert.deepEqual(changedLines(text, mdx.docToMd(doc, text)), ['<Chart data={[3, 5, 8]} height={320} animate />'], 'true again stays a bare flag');
  const spaced = '<Gauge value={ 3 } on={true} />\n';
  const g = mdx.mdToDoc(spaced).doc;
  g.content[0].attrs.props[0].value = 4;
  g.content[0].attrs.props[1].value = false;
  assert.equal(mdx.docToMd(g, spaced), '<Gauge value={ 4 } on={false} />\n');
});

test('expression and spread props cannot be changed through the props', () => {
  const text = fixture('docs-page.mdx');
  const { doc } = mdx.mdToDoc(text);
  const chart = find(doc, 'mdxComponent', 'Chart');
  chart.attrs.props[0].value = 'alert(1)';
  find(doc, 'mdxComponent', 'Note.Small').attrs.props[0].value = '...other';
  assert.equal(mdx.docToMd(doc, text), text);
});

test('a prop edit on a multi-line opening tag changes only its line', () => {
  const text = CORPUS['multi-line opening tag'];
  const { doc } = mdx.mdToDoc(text);
  doc.content[0].attrs.props[1].value = 'Still two lines';
  assert.equal(mdx.docToMd(doc, text), text.replace('title="Two lines"', 'title="Still two lines"'));
});

test('text the writer types never becomes code', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'export the file, then {open} <Chart /> and a < b' }] }] };
  const out = mdx.docToMd(doc, '');
  const back = mdx.mdToDoc(out).doc;
  assert.deepEqual(back.content, doc.content, out);
  assert.equal(rawHtmlOf(back).length, 0, 'no code came of it');
  // an image's alt text with braces, a heading, a table cell with a line break
  const more = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'import {x}' }] },
      { type: 'image', attrs: { src: 'a.png', alt: 'a {b} <c>', title: null } },
      { type: 'table', attrs: { align: [null] }, content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: '{b}' }] }] }] }] },
    ],
  };
  const t2 = mdx.docToMd(more, '');
  assert.match(t2, /<br \/>/);
  assert.deepEqual(mdx.mdToDoc(t2).doc.content.map((n) => n.type), ['heading', 'image', 'table'], t2);
});

test('inserting, deleting and moving blocks around the code (the edit matrix)', () => {
  for (const name of ['imports and exports', 'nested JSX', 'flow expression and comment', 'fixture docs-page.mdx']) {
    const bad = editMatrix(mdx, CORPUS[name]).filter((r) => !r.ok).map((r) => `${r.name}: ${r.problems.join('; ')}`);
    assert.deepEqual(bad, [], name);
  }
});

test('a file the reader cannot read is refused with its line; never a partial document', () => {
  const broken = {
    'an unclosed tag': '---\ntitle: X\n---\n\n<Callout type="tip">\n  Text.\n',
    'an HTML comment': 'Text <!-- no --> here.\n',
    'a bad expression': 'Sum: {1 +}.\n',
    'an autolink': 'See <https://example.com>.\n',
    'bad JavaScript in an import': 'import { from "x";\n',
  };
  for (const [name, text] of Object.entries(broken)) {
    assert.throws(() => mdx.mdToDoc(text), (e) => e instanceof MdxError && typeof e.mdx.message === 'string', name);
  }
  // the line counts the frontmatter's lines
  try {
    mdx.mdToDoc(broken['an unclosed tag']);
  } catch (e) {
    assert.ok(e.mdx.line >= 5, `line ${e.mdx.line}`);
    assert.match(e.message, /^Line \d+: /);
  }
});

test('the code of an MDX file counts as code for the raw-HTML rule, its literal props do not', () => {
  const text = fixture('docs-page.mdx');
  const { doc } = mdx.mdToDoc(text);
  const before = rawHtmlOf(doc);
  assert.ok(before.some((c) => c.startsWith('import ')));
  find(doc, 'mdxContainer', 'Callout').attrs.props[0].value = 'warning';
  assert.deepEqual(rawHtmlOf(doc), before, 'a literal prop is not code');
  find(doc, 'mdxComponent', 'Chart').attrs.props[0].value = 'other';
  assert.notDeepEqual(rawHtmlOf(doc), before, 'an expression is');
  assert.deepEqual(rawHtmlOf(doc, { mdx: false }), [], 'only HTML');
});

test('the URLs of an MDX file include literal href and src of JSX', () => {
  const urls = markdownUrls('<Card href="javascript:alert(1)" />\n\n[a](https://example.com/)\n', { mdx: true });
  assert.deepEqual(urls.sort(), ['https://example.com/', 'javascript:alert(1)']);
  assert.deepEqual(markdownUrls('Broken {', { mdx: true }), []);
});

test('Markdown files are read as before: JSX-looking text in a .md file stays HTML', () => {
  const md = createConverter();
  const text = '<Callout type="tip">\n\nText {x}.\n\n</Callout>\n';
  const { doc } = md.mdToDoc(text);
  assert.ok(doc.content.every((n) => !n.type.startsWith('mdx')));
  assert.equal(md.docToMd(doc, text), text);
});
