// What a real site's export taught the importer (docs/IMPORT.md): the cases a proof run on a 148-post WordPress
// export found, each as a small generic sample. Bold inside bold, a page's own #anchors, an FAQ's toggles, JSON-LD
// from an SEO plugin, a [pattern] in code, a bracket across a link, an author the export does not list, an SVG icon
// on the old site, and a dry run that must say "no author" when the run would.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { htmlToMarkdown } from '../src/import/convert/html.mjs';
import { readWxr } from '../src/import/convert/wordpress.mjs';
import { wpContentToHtml } from '../src/import/convert/wp-content.mjs';
import { as } from './helpers.mjs';
import { importServer, oldFiles, planAndRun } from './site-import.mjs';
import { startWebSite } from './web-site.mjs';

const md = (html, o) => htmlToMarkdown(html, o).markdown;
const cdata = (s) => `<![CDATA[${s}]]>`;

/** A small WXR: `items` as {id, type, slug, title, creator, content}; `authors` as logins. */
function wxr(base, { authors = ['alice'], items }) {
  const people = authors.map((a, i) => `<wp:author><wp:author_id>${i + 1}</wp:author_id><wp:author_login>${cdata(a)}</wp:author_login><wp:author_display_name>${cdata(a)}</wp:author_display_name></wp:author>`).join('\n');
  const rows = items.map(
    (p) => `<item><title>${cdata(p.title)}</title><link>${base}/${p.slug}/</link><dc:creator>${cdata(p.creator ?? 'alice')}</dc:creator>
<content:encoded>${cdata(p.content ?? '')}</content:encoded><excerpt:encoded>${cdata('')}</excerpt:encoded>
<wp:post_id>${p.id}</wp:post_id><wp:post_date_gmt>${cdata('2024-05-10 09:00:00')}</wp:post_date_gmt><wp:post_name>${cdata(p.slug)}</wp:post_name>
<wp:status>${cdata('publish')}</wp:status><wp:post_parent>0</wp:post_parent><wp:post_type>${cdata(p.type ?? 'post')}</wp:post_type></item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>Example</title><link>${base}</link><wp:base_site_url>${base}</wp:base_site_url><wp:base_blog_url>${base}</wp:base_blog_url>
${people}
${rows.join('\n')}
</channel></rss>
`;
}

describe('what a real export taught: the converters', () => {
  test('bold inside bold, italic inside italic, is one mark (never ******)', () => {
    assert.equal(md('<p><strong><strong><strong>Need help?</strong></strong></strong></p>'), '**Need help?**');
    assert.equal(md('<p><em>a <i>b</i> c</em> and <b>d <strong>e</strong></b></p>'), '*a b c* and **d e**');
  });

  test('a link to a place on the same page stays one, whatever the old address was', () => {
    const out = md('<ol><li><a href="#pricing">Pricing</a></li><li><a href="#faq-2">FAQ</a></li></ol>', { base: 'https://old.example.com/blog/a/', link: () => '/somewhere-else/' });
    assert.equal(out, '1. [Pricing](#pricing)\n2. [FAQ](#faq-2)');
    // an anchor with something odd in it is not taken as one
    assert.equal(md('<p><a href="#a b">x</a></p>', { base: 'https://old.example.com/', link: (u) => u }), '[x](https://old.example.com/#a%20b)');
  });

  test('an FAQ toggle keeps its question as a bold line above the answer', () => {
    assert.equal(md('<details class="wp-block-details"><summary>Can it do this?</summary><p>Yes, it can.</p></details>'), '**Can it do this?**\n\nYes, it can.');
  });

  test('JSON-LD from an SEO plugin is noted as structured data, a real script as a script', () => {
    const { notes } = htmlToMarkdown('<p>a</p><script type="application/ld+json">{"@type":"FAQPage"}</script><script>alert(1)</script>');
    assert.deepEqual(notes.map((n) => n.text), [
      'Structured data for search engines (a JSON-LD block) was left out. Add it in the site\'s templates if the page needs it.',
      'A script in the old text was left out (nothing that runs comes in).',
    ]);
    assert.equal(htmlToMarkdown('<script type="application/ld+json">{}</script><script type=\'application/ld+json\'>{}</script>').notes.length, 1);
  });

  test('a [pattern] in code and a bracket across a link are words, not shortcodes', () => {
    const html = '<!-- wp:paragraph --><p>Postal code: <code>^[A-Za-z]\\d[A-Za-z]$</code>, a form: <code>https://forms.example.com/[form-id]?a=[value]</code></p><!-- /wp:paragraph -->'
      + '<!-- wp:code --><pre class="wp-block-code"><code>[x-y] = [z_w]</code></pre><!-- /wp:code -->'
      + '<!-- wp:paragraph --><p>See <a href="/a/">[button-click email</a>s] and [gallery-old]</p><!-- /wp:paragraph -->';
    const { html: out, notes } = wpContentToHtml(html);
    assert.ok(out.includes('<code>^[A-Za-z]\\d[A-Za-z]$</code>'), out);
    assert.ok(out.includes('[form-id]?a=[value]'), out);
    assert.ok(out.includes('<code>[x-y] = [z_w]</code>'), out);
    assert.ok(out.includes('[button-click email</a>s]'), out);
    // a real shortcode outside code is still noted
    assert.deepEqual(notes.map((n) => n.kind), ['shortcode']);
    assert.match(notes[0].text, /\[gallery-old\]/);
    // <codex> is not <code>
    assert.equal(wpContentToHtml('<p><codex>[my-thing]</codex></p>').notes.length, 1);
  });

  test('a post’s creator the export does not list is still its author', () => {
    const b = readWxr(wxr('https://old.example.com', { authors: ['alice'], items: [{ id: 3, type: 'page', slug: 'about', title: 'About', creator: 'site-admin' }, { id: 4, slug: 'a', title: 'A' }] }));
    assert.deepEqual(b.authors.map((a) => [a.slug, a.name]), [['alice', 'alice'], ['site-admin', 'site-admin']]);
    assert.deepEqual(b.items.map((i) => i.authors), [['author-site-admin'], ['author-alice']]);
  });
});

describe('what a real export taught: the plan', () => {
  let fx, srv, site, ed, plain;

  before(async () => {
    site = await startWebSite(oldFiles({ '/wp-content/uploads/2024/05/icon.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' } }));
    ({ fx, srv } = await importServer({ outbound: site.outbound }));
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    plain = await as(srv, 'editor');
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  const upload = (who, text) => planAndRun(srv, who, { source: 'wordpress' }, { name: 'example.WordPress.2024-05-10.xml', type: 'text/xml', data: text });

  test('links keep their #part; an SVG icon on the old site is said to be one, once per entry', async () => {
    const icon = `<img src="${site.base}/wp-content/uploads/2024/05/icon.svg" alt="">`;
    const text = wxr(site.base, {
      items: [
        { id: 21, slug: 'first-move', title: 'First move', content: `<p>${icon} Yes ${icon} No</p><p>See <a href="${site.base}/second-move/#costs">the costs</a> and <a href="#top">the top</a>.</p>` },
        { id: 22, slug: 'second-move', title: 'Second move', content: '<p>Two.</p>' },
      ],
    });
    const { plan, done } = await upload(ed, text);
    const first = fx.git('show', 'HEAD:src/content/blog/first-move.md');
    assert.match(first, /\[the costs\]\(\/blog\/second-move\/#costs\)/);
    assert.match(first, /\[the top\]\(#top\)/);
    const notes = plan.review.filter((r) => r.entry === 'post-21');
    assert.deepEqual(notes.map((n) => [n.kind, n.text]), [['image', 'An SVG picture on the old site (icon.svg) is still shown from there: SVG files are not brought in, since they can carry scripts. Save it as PNG or WebP and put that in its place.']]);
    assert.equal(plan.counts.notConverted, 0);
    assert.equal(done.run.status, 'done');
    assert.ok(!site.hits.some((h) => h.endsWith('icon.svg')), 'the SVG is never fetched');
  });

  test('an export whose creator is not listed: the author is made, and the post comes in', async () => {
    const { plan, done } = await upload(ed, wxr(site.base, { authors: [], items: [{ id: 31, slug: 'unlisted-author', title: 'Unlisted author', creator: 'site-admin', content: '<p>Hi.</p>' }] }));
    assert.deepEqual(plan.authors.map((a) => [a.slug, a.action]), [['site-admin', 'create']]);
    assert.equal(done.result.counts.entries.create, 1);
    assert.match(fx.git('show', 'HEAD:src/content/blog/unlisted-author.md'), /^author: site-admin$/m);
  });

  test('the JSON import: no author and nobody to fall back on is "left out" in the plan, as in the run', async () => {
    const body = { source: 'example-cms', entries: [{ sourceId: 'n-1', collection: 'posts', title: 'No author here', body: 'Text.\n' }] };
    const p = await plain.post('/import', body);
    assert.equal(p.status, 201, p.text);
    const e = p.json.entries[0];
    assert.deepEqual([e.action, e.problem], ['skip', 'It has no author, and new entries need one. Link your account to an author (Users, your account, Author), or set a defaultAuthor for this collection.']);
    // the same with an author named, or for a person linked to one, is a create
    assert.equal((await plain.post('/import', { ...body, entries: [{ ...body.entries[0], frontmatter: { author: 'alice' } }] })).json.entries[0].action, 'create');
    assert.equal((await ed.post('/import', body)).json.entries[0].action, 'create');
  });
});
