// The site import's converters, one by one (src/import/convert/, docs/IMPORT.md): pure functions from a source's
// format to HTML and from HTML to Markdown, with every block, card, shortcode and slice they cannot convert noted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { cleanSlug, fromPath, hostsOf, isoOf, oldPlace, originalGhostImage, originalPrismicImage, originalUpload, pathKey, seoText } from '../src/import/convert/bundle.mjs';
import { fromGhostContentApi, ghostPath, lexicalToHtml, mobiledocToHtml, readGhostExport } from '../src/import/convert/ghost.mjs';
import { htmlToMarkdown } from '../src/import/convert/html.mjs';
import { DOC_LINK, documentBody, fromPrismic, prismicPath, richTextToHtml, richTextWords } from '../src/import/convert/prismic.mjs';
import { fromRest, readWxr } from '../src/import/convert/wordpress.mjs';
import { autop, shortAttrs, wpContentToHtml } from '../src/import/convert/wp-content.mjs';
import { elements, field } from '../src/import/convert/xml.mjs';
import { defaultFields, resolveMapping } from '../src/import/site/mapping.mjs';
import { FIXTURES } from './site-import.mjs';

const md = (html, o) => htmlToMarkdown(html, o).markdown;

describe('the shared helpers', () => {
  test('XML: elements and fields, CDATA kept whole, entities decoded', () => {
    const xml = '<a><b x="1">one</b><b>&lt;two&gt; &#233;</b><c><![CDATA[<p>a </b> b</p>]]></c></a>';
    assert.deepEqual(elements(xml, 'b').map((e) => e.text), ['one', '<two> é']);
    assert.equal(field(xml, 'c'), '<p>a </b> b</p>');
    assert.equal(elements(xml, 'b', { max: 1 }).length, 1);
  });

  test('old addresses: which are the old site’s, their path, and the original of a resized picture', () => {
    const hosts = hostsOf('https://www.old.example.com');
    assert.deepEqual(hosts, ['old.example.com']);
    assert.equal(oldPlace('https://old.example.com/a/b/?p=3', { base: 'https://old.example.com', hosts }).query.get('p'), '3');
    assert.equal(oldPlace('/about/', { base: 'https://old.example.com', hosts }).path, '/about/');
    assert.equal(oldPlace('https://other.example.org/about/', { base: 'https://old.example.com', hosts }), null);
    assert.equal(pathKey('/About'), pathKey('/about/'));
    assert.equal(fromPath('/a/b'), '/a/b/');
    assert.equal(originalUpload('https://x.example/wp-content/uploads/2024/05/truck-1024x683.jpg'), 'https://x.example/wp-content/uploads/2024/05/truck.jpg');
    assert.equal(originalUpload('https://x.example/wp-content/uploads/2024/05/big-scaled.jpg'), 'https://x.example/wp-content/uploads/2024/05/big.jpg');
    assert.equal(originalGhostImage('https://x.example/content/images/size/w600/2024/05/h.png'), 'https://x.example/content/images/2024/05/h.png');
    assert.equal(originalPrismicImage('https://images.prismic.io/r/a.png?auto=format,compress&rect=0,0,10,10&w=10&h=10'), 'https://images.prismic.io/r/a.png?rect=0,0,10,10');
  });

  test('SEO titles with Yoast’s and Rank Math’s variables; dates; slugs', () => {
    assert.equal(seoText('%%title%% %%sep%% %%sitename%%', { title: 'A', site: 'S' }), 'A - S');
    assert.equal(seoText('%title% %sep% %sitename%', { title: 'A', site: 'S' }), 'A - S');
    assert.equal(isoOf('0000-00-00 00:00:00'), null);
    assert.equal(isoOf('2024-05-06 10:00:00'), '2024-05-06T10:00:00.000Z');
    assert.equal(cleanSlug('%e2%9c%93-caf%c3%a9'), cleanSlug('✓-café'));
    assert.equal(cleanSlug('Hello World'), 'hello-world');
  });
});

describe('HTML to Markdown', () => {
  test('text, links, lists, code, quotes, pictures', () => {
    const out = md('<h2>Hi</h2><p>A <strong>b</strong> <em>c</em> <a href="/x/">d</a></p><ul><li>one</li><li>two</li></ul><pre><code>x = 1</code></pre><blockquote><p>q</p></blockquote><figure><img src="/a.png" alt="A"><figcaption>Cap</figcaption></figure>', { base: 'https://old.example.com' });
    for (const s of ['## Hi', 'A **b** *c* [d](https://old.example.com/x/)', '- one\n- two', '```\nx = 1\n```', '> q', '![A](https://old.example.com/a.png)', 'Cap']) assert.ok(out.includes(s), `${s} in\n${out}`);
  });

  test('nothing that runs comes in: scripts, styles, forms and handlers are left out and noted; embeds become links', () => {
    const r = htmlToMarkdown('<p onclick="x()">Hi</p><script>alert(1)</script><style>p{}</style><form><input name=a></form><iframe src="https://video.example.net/v/1"></iframe><a href="javascript:alert(1)">bad</a>', { base: 'https://old.example.com' });
    assert.doesNotMatch(r.markdown, /alert|onclick|<|javascript/);
    assert.match(r.markdown, /\[Embedded content: video\.example\.net\]\(https:\/\/video\.example\.net\/v\/1\)/);
    assert.ok(r.notes.some((n) => /script/i.test(n.text)));
    assert.ok(r.notes.some((n) => n.kind === 'embed'));
  });

  test('pictures and links go through the callbacks; lazy-loaded pictures keep their real address', () => {
    const r = md('<p><img data-src="https://old.example.com/real.png" src="data:image/gif;base64,R0lGOD" alt=""> <a href="https://old.example.com/p/">p</a></p>', { image: (u) => `media:${u.split('/').pop()}`, link: (u) => (u.endsWith('/p/') ? '/new/' : u) });
    assert.match(r, /!\[\]\(media:real\.png\)/);
    assert.match(r, /\[p\]\(\/new\/\)/);
  });
});

describe('WordPress', () => {
  test('Gutenberg: static blocks kept, dynamic and unknown ones noted, embeds as links, Custom HTML sanitised', () => {
    const { html, notes } = wpContentToHtml('<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph --><!-- wp:latest-posts /--><!-- wp:acme/thing {"a":1} /--><!-- wp:embed {"url":"https://www.youtube.com/watch?v=1"} --><figure class="wp-block-embed"><div>https://www.youtube.com/watch?v=1</div></figure><!-- /wp:embed --><!-- wp:spacer --><div style="height:20px"></div><!-- /wp:spacer -->');
    const out = md(html);
    assert.match(out, /^Hi$/m);
    assert.match(out, /Import note: the WordPress block “latest-posts” was here\./);
    assert.match(out, /Import note: the block “acme\/thing” was here/);
    assert.match(out, /\[Embedded content: youtube\.com\]/);
    assert.deepEqual(notes.map((n) => n.kind).sort(), ['block', 'block', 'embed']);
  });

  test('classic: paragraphs made, [caption], [gallery] and [embed] converted, unknown shortcodes noted with their text kept', () => {
    assert.equal(autop('a\nb\n\nc'), '<p>a<br>b</p>\n\n<p>c</p>');
    assert.deepEqual(shortAttrs('id="5" title=\'T\' open'), { id: '5', title: 'T', _: ['open'] });
    const att = { 7: { url: 'https://old.example.com/wp-content/uploads/a.jpg', alt: 'A' } };
    const { html, notes } = wpContentToHtml('One.\n\n[caption id="attachment_7" width="300"]<img src="https://old.example.com/wp-content/uploads/a-300x200.jpg" alt=""> Cap[/caption]\n\n[gallery ids="7"]\n\n[embed]https://vimeo.com/1[/embed]\n\n[box color="red"]Inside[/box]', { attachment: (id) => att[id] ?? null });
    const out = md(html);
    assert.match(out, /^One\.$/m);
    assert.match(out, /!\[\]\(https:\/\/old\.example\.com\/wp-content\/uploads\/a-300x200\.jpg\)\n\nCap/);
    assert.match(out, /!\[A\]\(https:\/\/old\.example\.com\/wp-content\/uploads\/a\.jpg\)/);
    assert.match(out, /\[Embedded content: vimeo\.com\]\(https:\/\/vimeo\.com\/1\)/);
    assert.match(out, /Import note: the WordPress shortcode “box” was here/);
    assert.match(out, /Inside/);
    assert.ok(notes.some((n) => n.kind === 'shortcode'));
  });

  test('a WXR export: posts and pages with their authors, terms, featured image, SEO, old addresses; menus left out', () => {
    const b = readWxr(fs.readFileSync(path.join(FIXTURES, 'wordpress.xml'), 'utf8'));
    assert.equal(b.kind, 'wordpress');
    assert.equal(b.site.title, 'Example Moving Co');
    assert.deepEqual(b.items.map((i) => [i.sourceId, i.type, i.status]), [['post-12', 'post', 'published'], ['post-13', 'post', 'published'], ['post-14', 'post', 'draft'], ['page-3', 'page', 'published']]);
    const p = b.items[0];
    assert.deepEqual([p.tags, p.categories], [['Trucks'], ['News']], 'Uncategorized is left out');
    assert.deepEqual(p.cover, { sourceId: 'att-41', url: 'https://old.example.com/wp-content/uploads/2024/05/truck.jpg', alt: 'Our blue truck' });
    assert.deepEqual(p.seo, { title: 'Moving day & more - Example Moving Co', description: 'How a family moved house in one day, with one truck.' });
    assert.deepEqual(p.oldUrls, ['/2024/05/moving-day/', '/?p=12']);
    assert.deepEqual(b.items[2].oldUrls, ['/?p=14'], 'a draft had no permalink');
    assert.deepEqual(b.items[1].seo.title, 'Second post - Packing tips', 'Rank Math');
    assert.deepEqual(b.media.map((m) => [m.sourceId, m.alt, m.oldUrls]), [['att-41', 'Our blue truck', ['/2024/05/moving-day/truck/', '/?attachment_id=41']], ['att-42', '', ['/second-post/box/', '/?attachment_id=42']]]);
    assert.deepEqual(b.authors.map((a) => [a.slug, a.name]), [['alice', 'Alice Example'], ['bob-writer', 'Bob Writer']]);
    assert.deepEqual(b.left, { nav_menu_item: 1 });
    assert.throws(() => readWxr('<html></html>'), /WordPress/);
  });

  test('the REST API’s answers become the same bundle', () => {
    const b = fromRest({
      site: { url: 'https://old.example.com', name: 'Example' },
      posts: [{ id: 5, slug: 'five', status: 'publish', type: 'post', date_gmt: '2024-01-01T00:00:00', link: 'https://old.example.com/five/', title: { rendered: 'Five &amp; more' }, content: { rendered: '<p>Hi</p>' }, excerpt: { rendered: '<p>Ex</p>' }, author: 1, featured_media: 9, categories: [2], tags: [], yoast_head_json: { title: 'Five | Example', description: 'D' } }],
      media: [{ id: 9, source_url: 'https://old.example.com/wp-content/uploads/n.png', alt_text: 'N', link: 'https://old.example.com/five/n/' }],
      users: [{ id: 1, slug: 'al', name: 'Al' }],
      categories: [{ id: 2, name: 'News' }],
    });
    const p = b.items[0];
    assert.deepEqual([p.sourceId, p.title, p.excerpt, p.categories, p.authors, p.cover.alt, p.seo.title], ['post-5', 'Five & more', 'Ex', ['News'], ['author-al'], 'N', 'Five | Example']);
    assert.deepEqual(p.oldUrls, ['/five/', '/?p=5']);
  });
});

describe('Ghost', () => {
  test('Mobiledoc: sections, markups and cards; an unknown card is noted', () => {
    const doc = { version: '0.3.1', atoms: [], markups: [['strong'], ['a', ['href', 'https://x.example/']]], cards: [['image', { src: '/i.png', alt: 'I', caption: 'C' }], ['code', { code: 'a < b' }], ['product', {}]], sections: [[1, 'p', [[0, [0], 1, 'Bold'], [0, [1], 1, 'link']]], [10, 0], [10, 1], [10, 2]] };
    const r = mobiledocToHtml(doc, { site: 'https://g.example' });
    const out = md(r.html, { markdown: r.markdown, base: 'https://g.example' });
    assert.match(out, /\*\*Bold\*\*\[link\]\(https:\/\/x\.example\/\)/);
    assert.match(out, /!\[I\]\(https:\/\/g\.example\/i\.png\)\n\nC/);
    assert.match(out, /```\na < b\n```/);
    assert.match(out, /Import note: a Ghost card \(product\)/);
    assert.ok(r.notes.some((n) => n.kind === 'card'));
  });

  test('Lexical: text formats, headings, lists, links and cards', () => {
    const t = (text, format = 0) => ({ type: 'text', text, format });
    const doc = { root: { children: [{ type: 'heading', tag: 'h3', children: [t('H')] }, { type: 'paragraph', children: [t('b', 1), t(' '), t('i', 2), t(' '), t('c', 16), { type: 'link', url: 'https://x.example/', children: [t('l')] }] }, { type: 'list', listType: 'bullet', children: [{ type: 'listitem', children: [t('one')] }] }, { type: 'markdown', markdown: '**raw**' }] } };
    const r = lexicalToHtml(doc);
    const out = md(r.html, { markdown: r.markdown });
    assert.match(out, /^### H$/m);
    assert.match(out, /\*\*b\*\* \*i\* `c`\[l\]\(https:\/\/x\.example\/\)/);
    assert.match(out, /^- one$/m);
    assert.match(out, /^\*\*raw\*\*$/m);
  });

  test('an export: posts, pages, tags (internal ones left out), authors, SEO and feature image alt; old addresses', () => {
    const b = readGhostExport(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'ghost.json'), 'utf8')), { siteUrl: 'https://old.example.com' });
    assert.equal(b.site.title, 'Example Harbour Blog');
    const p = b.items[0];
    assert.deepEqual([p.tags, p.cover.url, p.cover.alt, p.seo.title, p.authors], [['Harbours'], 'https://old.example.com/content/images/2024/05/harbour.png', 'The harbour', 'Lexical, explained', ['author-alice']]);
    assert.deepEqual(b.items[1].authors, ['author-casey', 'author-alice']);
    assert.equal(b.items.find((i) => i.slug === 'sent-once').status, 'draft');
    assert.equal(ghostPath('/{year}/{month}/{slug}/', { slug: 's', date: '2024-05-02T09:00:00Z' }), '/2024/05/s/');
    assert.throws(() => readGhostExport({ db: [{}] }), /Ghost export/);
    const api = fromGhostContentApi({ siteUrl: 'https://old.example.com', posts: [{ id: '1', slug: 'a', title: 'A', html: '<p>A</p>', authors: [{ slug: 'z', name: 'Z' }], tags: [] }] });
    assert.deepEqual([api.items[0].sourceId, api.items[0].oldUrls, api.authors[0].slug], ['post-1', ['/a/'], 'z']);
  });
});

describe('Prismic', () => {
  test('rich text: spans, links to documents and the web, lists, images, embeds', () => {
    const blocks = [
      { type: 'heading2', text: 'H', spans: [] },
      { type: 'paragraph', text: 'Bold and doc and web', spans: [{ start: 0, end: 4, type: 'strong' }, { start: 9, end: 12, type: 'hyperlink', data: { link_type: 'Document', id: 'D1' } }, { start: 17, end: 20, type: 'hyperlink', data: { link_type: 'Web', url: 'https://x.example/' } }] },
      { type: 'o-list-item', text: 'one', spans: [] },
      { type: 'o-list-item', text: 'two', spans: [] },
      { type: 'image', url: 'https://images.prismic.io/r/a.png', alt: 'A', dimensions: { width: 1, height: 1 } },
      { type: 'embed', oembed: { embed_url: 'https://www.youtube.com/watch?v=1', provider_name: 'YouTube' } },
    ];
    const out = md(richTextToHtml(blocks, { docUrl: (id) => `${DOC_LINK}${id}` }), { link: (u) => (u.startsWith(DOC_LINK) ? '/d1/' : u) });
    for (const s of ['## H', '**Bold** and [doc](/d1/) and [web](https://x.example/)', '1. one\n2. two', '![A](https://images.prismic.io/r/a.png)', '[Embedded content: YouTube](https://www.youtube.com/watch?v=1)']) assert.ok(out.includes(s), `${s} in\n${out}`);
    assert.equal(richTextWords([{ type: 'heading1', text: 'T', spans: [] }]), 'T');
  });

  test('slices: mapped ones to sections, ones with words to text, the rest noted', () => {
    const doc = { id: 'X', type: 'page', data: { slices: [{ slice_type: 'hero', primary: { heading: [{ type: 'heading1', text: 'Hi', spans: [] }] }, items: [] }, { slice_type: 'quote', primary: { text: [{ type: 'paragraph', text: 'Q', spans: [] }] }, items: [] }, { slice_type: 'form', primary: { id: 3 }, items: [] }] } };
    const r = documentBody(doc, { sliceMap: { hero: { section: 'hero', fields: { heading: 'primary.heading' } } } });
    assert.deepEqual(r.sections.map((s) => [s.discriminant, s.sliceType]), [['hero', 'hero']]);
    assert.match(md(r.html), /^Q$/m);
    assert.match(md(r.html), /Import note: a “form” slice was here/);
    assert.equal(r.notes.length, 1);
    assert.equal(prismicPath('/{lang}/{uid}/', { uid: 'a', lang: 'en-US', type: 'page' }), '/en-us/a/');
  });

  test('recorded API answers become a bundle', () => {
    const docs = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'prismic/documents.json'), 'utf8')).results;
    const b = fromPrismic(docs, { repo: 'example-repo', siteUrl: 'https://old.example.com', routes: { blog_post: '/blog/{uid}/' } });
    const p = b.items[0];
    assert.deepEqual([p.sourceId, p.type, p.title, p.slug, p.authors, p.tags, p.excerpt, p.oldUrls], ['doc-ZkPost1AAACMA001', 'blog_post', 'A harbour tour', 'harbour-tour', ['name:Dana Example'], ['harbours'], 'A walk along the water.', ['/blog/harbour-tour/']]);
    assert.ok(p.html.includes(`${DOC_LINK}ZkPage1AAACMA002`));
    assert.ok(p.notes.some((n) => n.kind === 'slice'));
  });
});

describe('the mapping', () => {
  const posts = { id: 'posts', label: 'Posts', format: 'md', hasStatus: true, fields: { title: 'title', date: 'date', modified: 'modified', author: 'author', tags: 'tags', excerpt: 'excerpt' }, images: [{ key: 'cover.src', alt: 'cover.alt' }], seo: { title: 'seo.title', description: 'seo.description' }, tagFields: [] };
  const pages = { id: 'pages', label: 'Pages', format: 'json', hasStatus: false, fields: { title: 'title', url: 'uri' } };
  const bundle = { kind: 'wordpress', items: [{ type: 'post' }, { type: 'page' }, { type: 'product' }] };

  test('defaults from the site: posts to posts, pages to pages, the rest left out; keys from its settings', () => {
    const m = resolveMapping([posts, pages], bundle);
    assert.deepEqual(m.types, { post: 'posts', page: 'pages', product: null });
    assert.deepEqual([m.fields.posts.cover, m.fields.posts.coverAlt, m.fields.posts.seoTitle], ['cover.src', 'cover.alt', 'seo.title']);
    assert.deepEqual([m.fields.pages.url, m.fields.pages.body, m.fields.pages.date], ['uri', 'body', null]);
    assert.deepEqual([m.onCollision, m.drafts, m.media], ['both', 'skip', 'used']);
    assert.equal(defaultFields(posts).body, null);
  });

  test('a given mapping is checked, naming the field', () => {
    for (const [given, field] of [
      [{ types: { post: 'nope' } }, 'types.post'],
      [{ fields: { posts: { colour: 'x' } } }, 'fields.posts.colour'],
      [{ fields: { posts: { excerpt: 'bad key!' } } }, 'fields.posts.excerpt'],
      [{ onCollision: 'merge' }, 'onCollision'],
      [{ slices: { hero: 'x' } }, 'slices.hero'],
    ]) {
      assert.throws(() => resolveMapping([posts, pages], bundle, given), (e) => e.extra.field === field, JSON.stringify(given));
    }
    assert.equal(resolveMapping([posts, pages], bundle, { fields: { posts: { excerpt: null } } }).fields.posts.excerpt, null);
  });
});
