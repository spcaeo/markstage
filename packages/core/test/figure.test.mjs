// An image's figure form (src/markdown/figure.mjs): caption, width class and the decorative mark.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createConverter } from '@markstage/core';

const c = createConverter();
const imageOf = (doc) => doc.content.find((n) => n.type === 'image');

test('a figure reads as one image with its class and caption, and writes back byte for byte', () => {
  const md = 'Before.\n\n<figure class="wide">\n\n![A dashboard](../../assets/x.png)\n\n<figcaption>The board &amp; its &lt;views&gt;</figcaption>\n</figure>\n\nAfter.\n';
  const { doc } = c.mdToDoc(md);
  assert.deepEqual(imageOf(doc).attrs, { src: '../../assets/x.png', alt: 'A dashboard', title: null, figure: 'wide', caption: 'The board & its <views>' });
  assert.equal(c.docToMd(doc, md), md);
  assert.equal(c.docToMd(doc), md); // the pure printer too
});

test('a figure without caption keeps its class ("" for none)', () => {
  for (const [md, figure] of [['<figure>\n\n![](x.png)\n\n</figure>\n', ''], ['<figure class="decorative">\n\n![](x.png)\n\n</figure>\n', 'decorative']]) {
    const { doc } = c.mdToDoc(md);
    assert.equal(imageOf(doc).attrs.figure, figure);
    assert.equal(c.docToMd(doc, md), md);
  }
});

test('any other layout or HTML in the caption stays raw HTML, unchanged', () => {
  for (const md of ['<figure>\n![a](x.png)\n</figure>\n', '<figure>\n\n![a](x.png)\n\n<figcaption>Has <b>tag</b></figcaption>\n</figure>\n', '<figure>\n\n![a](x.png)\n\n<figcaption>&copy;</figcaption>\n</figure>\n']) {
    const { doc } = c.mdToDoc(md);
    assert.equal(imageOf(doc), undefined);
    assert.equal(c.docToMd(doc, md), md);
  }
});

test('adding a caption and a width rewrites only that image; removing them gives the file back', () => {
  const plain = 'Intro.\n\n![A](a.png)\n\nOutro.\n';
  const doc = c.mdToDoc(plain).doc;
  imageOf(doc).attrs = { ...imageOf(doc).attrs, figure: 'wide', caption: 'Hello <world>' };
  const withCap = c.docToMd(doc, plain);
  assert.equal(withCap, 'Intro.\n\n<figure class="wide">\n\n![A](a.png)\n\n<figcaption>Hello &lt;world&gt;</figcaption>\n</figure>\n\nOutro.\n');
  const again = c.mdToDoc(withCap).doc;
  assert.equal(imageOf(again).attrs.caption, 'Hello <world>');
  imageOf(again).attrs = { src: 'a.png', alt: 'A', title: null, figure: null, caption: null };
  assert.equal(c.docToMd(again, withCap), plain);
});
