// The WordPress import of a whole site (docs/IMPORT.md): every public post type, custom ones too, each entry at its
// real permalink (a child under its parent); the block markup itself with an application password (context=edit),
// a list that refuses it read as the public sees it; ACF fields and the SEO plugin's head into front matter; the
// address readers use (publicUrl) in place of the WordPress host; converter rules into MDX components; one part of
// a site at a time (only). WordPress is a local web site that is only ever sent GET requests, the heads two at a time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { mdxParser } from '../../core/src/markdown/mdx.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { as, readFile, startServer } from './helpers.mjs';
import { SITE_CONFIG, fixture, form, importSite, oldFiles } from './site-import.mjs';
import { startWebSite } from './web-site.mjs';

const json = (body, headers = {}) => ({ type: 'application/json', body: JSON.stringify(body), headers });
const PUBLIC = 'https://www.example.com';
const PASSWORD = 'wxyz ABCD 9876 efgh IJKL 5432';

// an MDX collection whose entries keep the path they had (their permalink field), with the SEO settings
const WORK = `    { id: 'work', label: 'Work', format: 'mdx', dir: 'src/content/work', hasStatus: true, fields: { url: 'permalink' }, settings: [{ type: 'seo', title: 'seo.title', description: 'seo.description' }] },\n  ],\n  redirects:`;

async function typesServer(outbound) {
  const fx = importSite();
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG.replace(/\n {2}\],\n {2}redirects:/, `\n${WORK}`));
  fs.mkdirSync(path.join(fx.site, 'src/content/work'), { recursive: true });
  fs.writeFileSync(path.join(fx.site, 'src/content/work/.gitkeep'), '');
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Work collection');
  const srv = await startServer(fx, { core: await loadCore(), outbound, overrides: { collections: [], authors: {} } });
  return { fx, srv };
}

const RULES = {
  components: { CtaBand: { import: '../../components/CtaBand.astro' } },
  rules: [{ match: 'callout_box', component: 'CtaBand', props: { heading: { from: 'text', select: '.call_heading', required: true }, action: { from: 'link', select: 'a' } } }],
};

const MAPPING = {
  types: { post: 'posts', page: 'work', 'case-study': 'work' },
  fields: { work: { seoRobots: 'seo.robots', seoImage: 'seo.image', canonical: 'seo.canonical', 'acf.contentLayout': 'layout', 'acf.customBreadcrumbTitle': 'breadcrumbTitle' } },
  ids: 'path',
};

describe('the WordPress import: custom post types, ACF, the SEO head, the public address, converter rules', () => {
  let fx, srv, site, ed;
  let inFlight = 0;
  let mostAtOnce = 0;
  before(async () => {
    // the routes are read at each request, so they can name the site's own address once it listens
    const routes = {};
    site = await startWebSite(routes);
    const auth = `Basic ${Buffer.from(`editor:${PASSWORD.replace(/\s+/g, '')}`).toString('base64')}`;
    const signed = (req, body) => (req.headers.authorization === auth ? json(body, { 'X-WP-TotalPages': '1' }) : { status: 401, ...json({ code: 'rest_not_logged_in' }) });
    const edit = (req) => /[?&]context=edit/.test(req.url);
    const at = (p) => `${site.base}${p}`;
    const entry = (o) => ({ date_gmt: '2026-03-02T10:00:00', modified_gmt: '2026-03-04T10:00:00', status: 'publish', author: 1, featured_media: 0, categories: [], tags: [], meta: {}, excerpt: { raw: '' }, parent: 0, ...o });
    const PAGE = entry({
      id: 5, type: 'page', slug: 'portal-development', link: at('/portal-development/'), featured_media: 41,
      title: { raw: 'Portal development', rendered: 'Portal development' },
      // the block markup itself: only an edit read has it (the public one is the theme's HTML)
      content: { raw: `<!-- wp:paragraph --><p>We build portals. See <a href="${at('/portal-development/work/clinic-portal/')}">the clinic portal</a> and <a href="${at('/contact-us/')}">talk to us</a>.</p><!-- /wp:paragraph --><!-- wp:group {"className":"callout_box"} --><div class="wp-block-group callout_box"><p class="call_heading">Ready to start?</p><p><a href="${at('/contact-us/')}">Book a call</a></p></div><!-- /wp:group -->`, rendered: '<p>The theme’s HTML.</p>' },
      acf: { contentLayout: 'wide', customBreadcrumbTitle: 'Portals' },
    });
    const CASES = [
      entry({ id: 8, type: 'case-study', slug: 'clinic-portal', link: at('/portal-development/work/clinic-portal/'), title: { raw: 'Clinic portal' }, content: { raw: '<!-- wp:paragraph --><p>A portal for a clinic.</p><!-- /wp:paragraph -->' }, acf: { contentLayout: 'case' } }),
      entry({ id: 10, type: 'case-study', slug: 'lab-portal', parent: 8, link: at('/portal-development/work/clinic-portal/lab-portal/'), title: { raw: 'Lab portal' }, content: { raw: '<p>Its lab.</p>' }, acf: [] }),
      // a draft has no permalink yet: its path comes from the type's permalink template and its generated slug
      entry({ id: 11, type: 'case-study', status: 'draft', slug: '', generated_slug: 'pharmacy-portal', link: at('/?post_type=case-study&p=11'), permalink_template: at('/portal-development/work/%pagename%/'), title: { raw: 'Pharmacy portal' }, content: { raw: '<p>Coming soon.</p>' } }),
    ];
    const POST = entry({ id: 12, type: 'post', slug: 'portal-news', link: at('/blog/portal-news/'), title: { raw: 'Portal news' }, content: { raw: '<p>News.</p>' } });
    const head = (url) => `<meta name="description" content="About ${url.split('/').filter(Boolean).pop()}."/><meta name="robots" content="follow, index"/><link rel="canonical" href="${url}" /><meta property="og:title" content="${url.endsWith('/portal-development/') ? 'Portal development | Example Co' : 'Example Co'}" /><meta property="og:image" content="${at('/wp-content/uploads/2024/05/box.png')}" /><script type="application/ld+json">{"@type":"Organization"}</script>`;
    Object.assign(routes, {
      ...oldFiles(),
      '/wp-json/': () => json({ name: 'Example Co', url: site.base, home: site.base, namespaces: ['wp/v2', 'rankmath/v1'] }),
      '/wp-json/wp/v2/types': (req) => signed(req, {
        post: { slug: 'post', name: 'Posts', rest_base: 'posts', rest_namespace: 'wp/v2', hierarchical: false, viewable: true },
        page: { slug: 'page', name: 'Pages', rest_base: 'pages', rest_namespace: 'wp/v2', hierarchical: true, viewable: true },
        attachment: { slug: 'attachment', name: 'Media', rest_base: 'media', rest_namespace: 'wp/v2', hierarchical: false, viewable: true },
        'case-study': { slug: 'case-study', name: 'Case studies', rest_base: 'case-study', rest_namespace: 'wp/v2', hierarchical: true, viewable: true },
        wp_block: { slug: 'wp_block', name: 'Patterns', rest_base: 'blocks', rest_namespace: 'wp/v2', hierarchical: false, viewable: false },
      }),
      '/wp-json/wp/v2/posts': (req) => signed(req, edit(req) ? [POST] : []),
      '/wp-json/wp/v2/pages': (req) => signed(req, edit(req) ? [PAGE] : []),
      '/wp-json/wp/v2/case-study': (req) => signed(req, edit(req) ? CASES : []),
      // the media list does not answer an edit read (as a host may not): it is read as the public sees it
      '/wp-json/wp/v2/media': (req) => (edit(req) ? { status: 502, type: 'text/plain', body: 'bad gateway' } : signed(req, [{ id: 41, slug: 'truck', source_url: at('/wp-content/uploads/2024/05/truck.jpg'), alt_text: 'Our blue truck', title: { rendered: 'truck' }, post: 5 }])),
      '/wp-json/wp/v2/users': (req) => signed(req, [{ id: 1, name: 'Alice Example', slug: 'alice', link: at('/author/alice/') }]),
      '/wp-json/wp/v2/categories': () => json([]),
      '/wp-json/wp/v2/tags': () => json([]),
      '/wp-json/rankmath/v1/getHead': async (req) => {
        inFlight++;
        mostAtOnce = Math.max(mostAtOnce, inFlight);
        await new Promise((ok) => setTimeout(ok, 25));
        inFlight--;
        const url = new URL(req.url, site.base).searchParams.get('url');
        return signed(req, { success: true, head: head(url) });
      },
    });
    ({ fx, srv } = await typesServer(site.outbound));
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  test('every public type is listed with its count; entries keep their real paths; a refused edit read is noted', async () => {
    const r = await ed.post('/import/site', { source: 'wordpress', url: site.base, user: 'editor', password: PASSWORD, mapping: MAPPING, publicUrl: PUBLIC, rules: RULES });
    assert.equal(r.status, 201, r.text);
    const plan = r.json.plan;
    assert.deepEqual(plan.types.map((t) => [t.type, t.count, t.hierarchical, t.collection]), [['post', 1, false, 'posts'], ['page', 1, true, 'work'], ['case-study', 3, true, 'work']]);
    assert.equal(plan.types.find((t) => t.type === 'case-study').label, 'Case studies');
    assert.deepEqual(plan.items.map((i) => [i.sourceId, i.collection, i.id, i.url]), [
      ['post-12', 'posts', 'portal-news', '/blog/portal-news/'],
      ['page-5', 'work', 'portal-development', '/portal-development/'],
      ['post-8', 'work', 'portal-development-work-clinic-portal', '/portal-development/work/clinic-portal/'],
      ['post-10', 'work', 'portal-development-work-clinic-portal-lab-portal', '/portal-development/work/clinic-portal/lab-portal/'],
      ['post-11', 'work', 'portal-development-work-pharmacy-portal', '/portal-development/work/pharmacy-portal/'],
    ]);
    assert.ok(plan.review.some((n) => n.kind === 'source' && /the media files .*as the public sees them/.test(n.text)), JSON.stringify(plan.review));
    assert.deepEqual(plan.rules, { rules: 1, components: { CtaBand: 1 } });
    assert.equal(plan.collections.find((c) => c.id === 'work').mdx, true);
    // the SEO heads: one per published entry, never more than two at a time; only GET requests, ever
    assert.equal(site.calls.filter((c) => c.url.startsWith('/wp-json/rankmath/v1/getHead')).length, 4);
    assert.ok(mostAtOnce >= 1 && mostAtOnce <= 2, `at most two heads at a time, saw ${mostAtOnce}`);
    assert.deepEqual([...new Set(site.calls.map((c) => c.method))], ['GET']);
    assert.ok(site.calls.some((c) => c.url.startsWith('/wp-json/wp/v2/case-study?') && /context=edit/.test(c.url) && /status=publish%2Cfuture|status=publish,future/.test(c.url)));

    const run = await ed.post(`/import/${r.json.run.id}/run`, {});
    assert.equal(run.status, 202, run.text);
    await srv.app.jobs.idle();
    const page = readFile(fx, 'src/content/work/portal-development.mdx');
    mdxParser.parse(page.replace(/^---\n[\s\S]*?\n---\n/, ''));
    assert.match(page, /^permalink: \/portal-development\/$/m);
    assert.match(page, /^layout: wide$/m);
    assert.match(page, /^breadcrumbTitle: Portals$/m);
    assert.match(page, /^ {2}title: Portal development \| Example Co$/m);
    assert.match(page, /^ {2}description: About portal-development\.$/m);
    assert.match(page, /^ {2}robots: follow, index$/m);
    assert.match(page, /^ {2}canonical: https:\/\/www\.example\.com\/portal-development\/$/m);
    assert.match(page, /^ {2}image: /m);
    // the edit read's block markup, not the theme's HTML; links to imported entries go to their new path, the rest
    // to the public address; the callout as its component, with the import line
    assert.doesNotMatch(page, /theme’s HTML/);
    assert.match(page, /\[the clinic portal\]\(\/portal-development\/work\/clinic-portal\/\)/);
    assert.match(page, /\[talk to us\]\(https:\/\/www\.example\.com\/contact-us\/\)/);
    assert.match(page, /^import CtaBand from '\.\.\/\.\.\/components\/CtaBand\.astro';$/m);
    assert.match(page, /<CtaBand heading="Ready to start\?" action=\{\{"href":"https:\/\/www\.example\.com\/contact-us\/","text":"Book a call"\}\} \/>/);
    assert.doesNotMatch(page, new RegExp(site.base.replace(/[.]/g, '\\.')), 'no address on the WordPress host is left');
    const child = readFile(fx, 'src/content/work/portal-development-work-clinic-portal-lab-portal.mdx');
    assert.match(child, /^permalink: \/portal-development\/work\/clinic-portal\/lab-portal\/$/m);
    assert.match(readFile(fx, 'src/content/work/portal-development-work-pharmacy-portal.mdx'), /^draft: true$/m);
    assert.match(readFile(fx, 'src/content/work/portal-development-work-clinic-portal.mdx'), /^layout: case$/m);
  });

  test('one part of a site at a time: only the entries under the paths given come in', async () => {
    const r = await ed.post('/import/site', { source: 'wordpress', url: site.base, user: 'editor', password: PASSWORD, mapping: { ...MAPPING, only: ['/portal-development/work/clinic-portal/'] }, publicUrl: PUBLIC });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.json.plan.items.map((i) => [i.sourceId, i.action]), [['post-8', 'unchanged'], ['post-10', 'unchanged']]);
    assert.equal(r.json.plan.counts.outside, 3);
  });

  test('converter rules that are not right are refused, naming the rules field', async () => {
    const r = await ed.post('/import/site', { source: 'wordpress', url: site.base, user: 'editor', password: PASSWORD, mapping: MAPPING, rules: { rules: [{ match: 'callout_box', component: 'not-a-name' }] } });
    assert.equal(r.status, 422);
    assert.equal(r.json.field, 'rules');
    const bad = await ed.post('/import/site', { source: 'wordpress', url: site.base, mapping: { ...MAPPING, publicUrl: 'not an address' } });
    assert.equal(bad.status, 422);
  });
});

describe('the WordPress import from an export file: custom types with ACF fields', () => {
  let fx, srv;
  before(async () => {
    ({ fx, srv } = await typesServer());
  });
  after(async () => srv?.close());

  test('a custom type in the export is listed and comes in at its permalink, its ACF fields from the post meta', async () => {
    const meta = (k, v) => `<wp:postmeta><wp:meta_key><![CDATA[${k}]]></wp:meta_key><wp:meta_value><![CDATA[${v}]]></wp:meta_value></wp:postmeta>`;
    const item = `<item><title><![CDATA[Clinic portal]]></title><link>https://old.example.com/portal-development/work/clinic-portal/</link><dc:creator><![CDATA[alice]]></dc:creator><content:encoded><![CDATA[<p>A portal for a clinic.</p>]]></content:encoded><excerpt:encoded><![CDATA[]]></excerpt:encoded><wp:post_id>80</wp:post_id><wp:post_date_gmt><![CDATA[2026-03-02 10:00:00]]></wp:post_date_gmt><wp:post_name><![CDATA[clinic-portal]]></wp:post_name><wp:status><![CDATA[publish]]></wp:status><wp:post_parent>0</wp:post_parent><wp:post_type><![CDATA[case-study]]></wp:post_type>${meta('contentLayout', 'case')}${meta('_contentLayout', 'field_6a1b2c3d')}${meta('_edit_lock', '1')}</item>`;
    const wxr = fixture('wordpress.xml').replace('</channel>', `${item}\n</channel>`);
    const ed = await as(srv, 'editor', { authorSlug: 'alice' });
    const f = form({ source: 'wordpress', mapping: { types: { post: 'posts', page: 'pages', 'case-study': 'work' }, fields: { work: { 'acf.contentLayout': 'layout' } }, publicUrl: PUBLIC } }, { name: 'site.xml', data: wxr });
    const p = await ed.post('/import/site', f.body, { headers: f.headers });
    assert.equal(p.status, 201, p.text);
    const t = p.json.plan.types.find((x) => x.type === 'case-study');
    assert.deepEqual([t.count, t.collection], [1, 'work']);
    const item80 = p.json.plan.items.find((i) => i.sourceId === 'post-80');
    assert.deepEqual([item80.collection, item80.id, item80.url], ['work', 'clinic-portal', '/portal-development/work/clinic-portal/']);
    const run = await ed.post(`/import/${p.json.run.id}/run`, {});
    assert.equal(run.status, 202);
    await srv.app.jobs.idle();
    const text = readFile(fx, 'src/content/work/clinic-portal.mdx');
    assert.match(text, /^layout: case$/m);
    assert.match(text, /^permalink: \/portal-development\/work\/clinic-portal\/$/m);
    assert.doesNotMatch(text, /_edit_lock|field_6a1b2c3d/);
  });
});
