// AI link suggestions and fixes for the SEO check's problems (src/ai/links.ts, src/ai/fixes.ts), without a browser:
// their URLs (router.ts: every state has one, and a wrong one opens nothing), the SEO check's vague link words (the
// same list as the link map's, so the editor and the server's Health agree), where each link is on the page, and the
// sentence a "click here" fix rewrites (never across an image or a line break). In a browser:
// packages/server/e2e/ai-seo.e2e.mjs.
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { GENERIC_ANCHORS } from '@markstage/core/link-map';

const STUB_TARGET = "export const targetOf = (href) => (href.startsWith('/') ? { kind: 'site', path: href, href } : { kind: 'other', href });";

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
  // where a link leads needs the browser's address and the site's config: a site path is a page of the site here
  load(url, ctx, next) {
    if (url.endsWith('/src/link-preview.ts')) return { format: 'module', source: STUB_TARGET, shortCircuit: true };
    return next(url, ctx);
  },
});
const router = await import('../src/router.ts');
const { linksOf, linkFindings, headings, imagesOf, imageFindings, vagueLink, VAGUE_LINK_WORDS } = await import('../src/seo/text.ts');
const { fixKind, sentenceOf } = await import('../src/ai/fix-text.ts');

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } } },
    image: { group: 'inline', inline: true, attrs: { src: { default: '' }, alt: { default: '' }, figure: { default: '' } } },
    hardBreak: { group: 'inline', inline: true },
    text: { group: 'inline' },
  },
  marks: { link: { attrs: { href: {}, rel: { default: '' }, target: { default: '' } } }, bold: {} },
});
const t = (s: string, ...marks: ReturnType<typeof schema.mark>[]) => schema.text(s, marks);
const link = (href: string) => schema.mark('link', { href });
const p = (...c: ReturnType<typeof schema.node>[]) => schema.node('paragraph', null, c);
const hd = (level: number, s: string) => schema.node('heading', { level }, s ? [t(s)] : []);

test('the URLs: suggest=links with Post settings, suggest=fix&fix=<id> with the SEO check; a wrong one opens nothing', () => {
  assert.deepEqual(router.parse('#/e/posts/notes?s=1&suggest=links').suggest, { kind: 'links' });
  assert.equal(router.parse('#/e/posts/notes?suggest=links').suggest, null, 'its place is Post settings');
  for (const fix of ['title', 'description', 'heading-3', 'link-2-1', 'alt-1']) {
    const r = router.parse(`#/e/posts/notes?side=seo&suggest=fix&fix=${fix}`);
    assert.deepEqual(r.suggest, { kind: 'fix', fix });
    assert.equal(router.format(r), `#/e/posts/notes?side=seo&suggest=fix&fix=${fix}`);
  }
  for (const bad of ['side=seo&suggest=fix&fix=everything', 'side=seo&suggest=fix', 'side=seo&suggest=fix&fix=link-2', 's=1&suggest=fix&fix=title']) assert.equal(router.parse(`#/e/posts/notes?${bad}`).suggest, null, bad);
  assert.equal(router.format(router.parse('#/e/posts/notes?s=1&suggest=links')), '#/e/posts/notes?s=1&suggest=links');
});

test('each fix asks for its kind: seo for the search result, alt for an image, fix for a heading or link words', () => {
  assert.deepEqual(['title', 'description', 'alt-2', 'heading-4', 'link-1-2'].map(fixKind), ['seo', 'seo', 'alt', 'fix', 'fix']);
});

test('vague link words: the same list as the link map’s, read the same way', () => {
  assert.deepEqual([...VAGUE_LINK_WORDS].sort(), [...GENERIC_ANCHORS].sort());
  for (const w of ['Click here', '“Read more”', 'here.', 'Learn more →', '2', 'page 3', '']) assert.equal(vagueLink(w), true, w);
  for (const w of ['the pricing guide', 'Canvas basics', 'here we go']) assert.equal(vagueLink(w), false, w);
});

test('the SEO check names each problem’s fix: a heading, vague link words, an image with no alt', () => {
  const doc = schema.node('doc', null, [
    hd(2, 'Tools'),
    hd(4, 'Shortcuts'),
    p(t('Read the guide. To learn more, '), t('click here', link('/blog/guide/')), t('. Or '), t('the canvas basics', link('/blog/canvas/')), t('.')),
    p(schema.node('image', { src: '/uploads/sky.png' }), t(' and '), schema.node('image', { src: '/uploads/sea.png', alt: 'The sea' })),
    hd(2, ''),
  ]);
  const hs = headings(doc, { text: 'Notes', h1: true });
  assert.deepEqual(hs.findings.map((f) => f.fix), ['heading-1', 'heading-4']);
  const ls = linksOf(doc);
  assert.deepEqual(ls.map((l) => [l.text, l.block, l.n, doc.textBetween(l.from, l.to)]), [
    ['click here', 2, 1, 'click here'],
    ['the canvas basics', 2, 2, 'the canvas basics'],
  ]);
  const lf = linkFindings(ls, () => ({ draft: false }));
  assert.deepEqual(lf.filter((f) => f.fix).map((f) => [f.fix, f.text]), [['link-2-1', '“click here” does not say where the link goes: link words that name the page.']]);
  const im = imagesOf(doc, 'decorative');
  assert.deepEqual(im.map((i) => i.n), [1, 2]);
  assert.deepEqual(imageFindings(im).filter((f) => f.fix).map((f) => f.fix), ['alt-1']);
});

test('the sentence a link-words fix rewrites: from the sentence before to its end, never across an image or a line break', () => {
  const doc = schema.node('doc', null, [
    p(t('Read the guide first. To learn more, '), t('click', link('/g/')), t(' here', link('/g/'), schema.mark('bold')), t(' today! Then rest.')),
    p(t('Before'), schema.node('hardBreak'), t('see '), t('here', link('/h/')), t(' now')),
  ]);
  const [a, b] = linksOf(doc);
  const s = sentenceOf(doc, a)!;
  assert.equal(s.text, 'To learn more, click here today!');
  assert.equal(doc.textBetween(s.from, s.to), s.text);
  assert.equal(s.mark.attrs.href, '/g/');
  assert.equal(s.others, true, 'the bold on part of it is another mark');
  const s2 = sentenceOf(doc, b)!;
  assert.equal(s2.text, 'see here now', 'stops at the line break');
  assert.equal(s2.others, false);
});
