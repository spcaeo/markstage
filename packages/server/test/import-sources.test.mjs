// The site import from Ghost (an export and the Content API), Prismic (recorded API answers), WordPress's REST API,
// and its safety (docs/IMPORT.md "Safety"): only public addresses are read, also after a redirect; a credential is
// used for the one read and kept nowhere. Everything is on local web sites reached through the test seam only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, readFile } from './helpers.mjs';
import { FIXTURES, fixture, importServer, oldFiles, planAndRun } from './site-import.mjs';
import { startWebSite } from './web-site.mjs';

const json = (body, headers = {}) => ({ type: 'application/json', body: JSON.stringify(body), headers });

describe('the site import: Ghost', () => {
  let fx, srv, site, ed;
  // a key-shaped value made here (a Content API key is hex)
  const KEY = 'ab'.repeat(13);
  before(async () => {
    const exp = JSON.parse(fixture('ghost.json'));
    const posts = exp.db[0].data.posts.filter((p) => p.type === 'post' && p.status === 'published').map((p) => ({ ...p, html: `<p>${p.title} as HTML, with <a href="__GHOST_URL__/contact/">a link</a>.</p>`, tags: [{ name: 'Harbours', slug: 'harbours', visibility: 'public' }], authors: [{ name: 'Alice Example', slug: 'alice' }] }));
    const answer = (req, body) => (new URL(req.url, 'http://x').searchParams.get('key') === KEY ? json(body) : json({ errors: [{ message: 'Unknown Content API Key' }] }));
    site = await startWebSite({
      ...oldFiles(),
      '/ghost/api/content/settings/': (req) => answer(req, { settings: { title: 'Example Harbour Blog', url: site.base } }),
      '/ghost/api/content/posts/': (req) => answer(req, JSON.parse(JSON.stringify({ posts, meta: { pagination: { page: 1, pages: 1 } } }).split('__GHOST_URL__').join(site.base))),
      '/ghost/api/content/pages/': (req) => answer(req, { pages: [], meta: { pagination: { page: 1, pages: 1 } } }),
    });
    ({ fx, srv } = await importServer({ outbound: site.outbound }));
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  test('an export: Lexical and Mobiledoc posts with their cards, tags, authors and feature images', async () => {
    const { plan, done } = await planAndRun(srv, ed, { source: 'ghost', siteUrl: site.base }, { name: 'example.ghost.2024-05-10.json', data: fixture('ghost.json') });
    assert.deepEqual(plan.items.map((i) => [i.sourceId, i.collection, i.id, i.sourceStatus]), [
      ['post-6640a1', 'posts', 'lexical-post', 'published'],
      ['post-6640a2', 'posts', 'mobiledoc-post', 'published'],
      ['post-6640a3', 'posts', 'draft-in-ghost', 'draft'],
      ['page-6640a4', 'pages', 'contact', 'published'],
      ['post-6640a5', 'posts', 'sent-once', 'draft'],
    ]);
    // a picture shown at several sizes is one file
    assert.deepEqual(plan.media.map((m) => m.url.replace(site.base, '')).sort(), ['/content/images/2024/05/crane.png', '/content/images/2024/05/harbour.png']);
    assert.deepEqual(plan.authors.map((a) => [a.slug, a.action]), [['alice', 'existing'], ['casey', 'create']]);
    const kinds = plan.review.map((r) => r.kind);
    for (const k of ['card', 'embed', 'html', 'status', 'author']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
    assert.equal(done.run.status, 'done');
    const lex = readFile(fx, 'src/content/blog/lexical-post.md');
    assert.match(lex, /^ {2}- Harbours$/m);
    assert.doesNotMatch(lex, /internal/);
    assert.match(lex, /^ {2}alt: The harbour$/m);
    assert.match(lex, /^ {2}title: Lexical, explained$/m);
    assert.match(lex, /\*\*Bold\*\* and \[back\]\(\/blog\/mobiledoc-post\/\)/);
    assert.match(lex, /> ⚠️ Mind the stairs\./);
    assert.match(lex, /```\nconst box = 1;\n```/);
    assert.match(lex, /\[Moving checklist\]\(https:\/\/docs\.example\.org\/move\): Every step\./);
    assert.match(lex, /Import note: a Ghost card \(signup\) was here/);
    const mob = readFile(fx, 'src/content/blog/mobiledoc-post.md');
    assert.match(mob, /^author: casey$/m);
    assert.match(mob, /A \*\*Markdown card\*\* with a \[link to the crane\]\(\/uploads\//);
    assert.match(mob, /Custom \*\*HTML\*\*/);
    assert.doesNotMatch(mob, /<script|alert|iframe|__GHOST_URL__/);
    assert.equal(JSON.parse(readFile(fx, 'src/content/pages/contact.json')).uri, '/contact/');
    assert.equal(JSON.parse(readFile(fx, 'src/data/redirects.json'))['/lexical-post/'], '/blog/lexical-post/');
    assert.equal(JSON.parse(readFile(fx, 'src/content/authors/casey.json')).name, 'Casey Writer');
  });

  test('an export needs the old site’s address', async () => {
    const { form } = await import('./site-import.mjs');
    const f = form({ source: 'ghost' }, { name: 'x.json', data: fixture('ghost.json') });
    const r = await ed.post('/import/site', f.body, { headers: f.headers });
    assert.deepEqual([r.status, r.json.field], [422, 'siteUrl']);
  });

  test('the Content API, with its key; a wrong key is refused in words, and the key is kept nowhere', async () => {
    const r = await ed.post('/import/site', { source: 'ghost', url: site.base, key: KEY });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.json.plan.items.map((i) => [i.id, i.action]), [['lexical-post', 'unchanged'], ['mobiledoc-post', 'update']].map(([id]) => [id, r.json.plan.items.find((x) => x.id === id).action]));
    assert.ok(r.json.plan.items.every((i) => i.collection === 'posts'));
    const bad = await ed.post('/import/site', { source: 'ghost', url: site.base, key: 'ffffffffffffffffffffffff' });
    assert.equal(bad.status, 422);
    assert.doesNotMatch(bad.text, /ffffffffffffffffffffffff/);
    assertNowhere(srv, [KEY, 'ffffffffffffffffffffffff']);
  });
});

describe('the site import: Prismic', () => {
  let fx, srv, site, ed;
  before(async () => {
    const swap = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'prismic', name), 'utf8').split('https://images.prismic.io').join(`${site.base}/cdn`));
    site = await startWebSite({
      '/api/v2': () => json(swap('api.json')),
      '/api/v2/documents/search': (req) => (new URL(req.url, 'http://x').searchParams.get('access_token') === 'prismic-token-sample' ? json(swap('documents.json')) : { status: 401, ...json({ message: 'Invalid access token' }) }),
      '/cdn/example-repo/harbour.png': { type: 'image/png', body: oldFiles()['/content/images/2024/05/harbour.png'].body },
      '/cdn/example-repo/crane.png': { type: 'image/png', body: oldFiles()['/content/images/2024/05/crane.png'].body },
    });
    ({ fx, srv } = await importServer({ outbound: site.outbound }));
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  test('custom types to collections, rich text to Markdown, a mapped slice to a section, the rest noted', async () => {
    const body = {
      source: 'prismic',
      repo: 'example-repo',
      token: 'prismic-token-sample',
      endpoint: `${site.base}/api/v2`,
      siteUrl: site.base,
      routes: { blog_post: '/blog/{uid}/', page: '/{uid}/' },
      mapping: { types: { blog_post: 'posts', page: 'pages' }, slices: { hero: { section: 'hero', fields: { heading: 'primary.heading', image: 'primary.image', text: 'primary.text' } } } },
    };
    const p = await ed.post('/import/site', body);
    assert.equal(p.status, 201, p.text);
    // the fixture site has a page “about” already: both are kept, and the new one gets an address of its own
    assert.deepEqual(p.json.plan.items.map((i) => [i.type, i.collection, i.id, i.url]), [['blog_post', 'posts', 'harbour-tour', '/blog/harbour-tour/'], ['page', 'pages', 'about-2', '/about-2/']]);
    assert.deepEqual(p.json.plan.authors.map((a) => [a.slug, a.action]), [['dana-example', 'create']]);
    assert.ok(p.json.plan.review.some((r) => r.kind === 'slice' && /newsletter_signup/.test(r.text)));
    const r = await ed.post(`/import/${p.json.run.id}/run`, {});
    assert.equal(r.status, 202);
    await srv.app.jobs.idle();
    const done = (await ed.get(`/import/${p.json.run.id}`)).json;
    assert.equal(done.run.status, 'done', JSON.stringify(done.result));
    const post = readFile(fx, 'src/content/blog/harbour-tour.md');
    assert.match(post, /^title: A harbour tour$/m);
    assert.match(post, /^author: dana-example$/m);
    assert.match(post, /^ {2}- harbours$/m);
    assert.match(post, /\*\*Start\*\* at the pier and read \[about us\]\(\/about-2\/\)\./);
    assert.match(post, /- Boats\n- \*Cranes\*/);
    assert.match(post, /More at \[the port authority\]\(https:\/\/port\.example\.org\/\)\./);
    assert.match(post, /A slice with words\./);
    assert.match(post, /Import note: a “newsletter\\_signup” slice was here/);
    assert.doesNotMatch(post, /prismic-document\.invalid|127\.0\.0\.1/);
    const page = JSON.parse(readFile(fx, 'src/content/pages/about-2.json'));
    assert.equal(page.uri, '/about-2/');
    assert.equal(page.sections[0].discriminant, 'hero');
    assert.equal(page.sections[0].value.heading, 'We love boats');
    assert.match(page.sections[0].value.image.src, /^\/uploads\//);
    assert.match(page.body, /\[the tour\]\(\/blog\/harbour-tour\/\)/);
    assertNowhere(srv, ['prismic-token-sample']);
  });

  test('a wrong token and a wrong repository name are refused in words', async () => {
    const bad = await ed.post('/import/site', { source: 'prismic', repo: 'example-repo', token: 'nope-token', endpoint: `${site.base}/api/v2` });
    assert.equal(bad.status, 422);
    assert.doesNotMatch(bad.text, /nope-token/);
    const name = await ed.post('/import/site', { source: 'prismic', repo: 'Not A Repo!' });
    assert.deepEqual([name.status, name.json.field], [422, 'repo']);
  });
});

describe('the site import: WordPress’s REST API, and safety', () => {
  let fx, srv, site, other, ed;
  const PASSWORD = 'abcd EFGH 1234 ijkl MNOP 5678';
  const seen = [];
  before(async () => {
    other = await startWebSite({ '/secret.png': { type: 'image/png', body: oldFiles()['/content/images/2024/05/crane.png'].body } });
    const signed = (req, body) => {
      seen.push(req.headers.authorization ?? null);
      return req.headers.authorization === `Basic ${Buffer.from(`editor:${PASSWORD.replace(/\s+/g, '')}`).toString('base64')}` ? json(body, { 'X-WP-TotalPages': '1' }) : { status: 401, ...json({ code: 'rest_not_logged_in' }) };
    };
    site = await startWebSite({
      ...oldFiles(),
      '/wp-json/': () => json({ name: 'Example Moving Co', url: site.base, home: site.base }),
      '/wp-json/wp/v2/posts': (req) => signed(req, [{ id: 12, date_gmt: '2024-05-06T10:00:00', modified_gmt: '2024-05-08T11:00:00', slug: 'moving-day', status: 'publish', type: 'post', link: `${site.base}/2024/05/moving-day/`, title: { raw: 'Moving day', rendered: 'Moving day' }, content: { raw: `<!-- wp:paragraph --><p>From the API. <img src="${site.base}/wp-content/uploads/2024/05/truck-300x200.jpg" alt=""></p><!-- /wp:paragraph -->` }, excerpt: { raw: '' }, author: 1, featured_media: 41, categories: [3], tags: [], meta: {}, yoast_head_json: { title: 'Moving day - Example', description: 'From the API.' } }]),
      '/wp-json/wp/v2/pages': (req) => signed(req, []),
      '/wp-json/wp/v2/media': (req) => signed(req, [{ id: 41, slug: 'truck', link: `${site.base}/2024/05/moving-day/truck/`, source_url: `${site.base}/wp-content/uploads/2024/05/truck.jpg`, alt_text: 'Our blue truck', title: { rendered: 'truck' }, post: 12 }]),
      '/wp-json/wp/v2/users': (req) => signed(req, [{ id: 1, name: 'Alice Example', slug: 'alice', link: `${site.base}/author/alice/` }]),
      '/wp-json/wp/v2/categories': () => json([{ id: 3, name: 'News', slug: 'news' }]),
      '/wp-json/wp/v2/tags': () => json([]),
      '/to-private/wp-json/': { status: 302, headers: { Location: `http://127.0.0.1:${other.port}/wp-json/` } },
      '/to-private.png': { status: 302, headers: { Location: `${other.base}/secret.png` } },
      '/to-metadata.png': { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } },
      '/page.html': { type: 'text/html', body: '<p>not a picture</p>' },
    });
    ({ fx, srv } = await importServer({ outbound: site.outbound }));
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
  });
  after(async () => {
    await srv?.close();
    await site?.close();
    await other?.close();
  });

  test('the REST API with an application password: read once, used for that read only, kept nowhere', async () => {
    const r = await ed.post('/import/site', { source: 'wordpress', url: site.base, user: 'editor', password: PASSWORD });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.json.plan.items.map((i) => [i.sourceId, i.id, i.action]), [['post-12', 'moving-day', 'create']]);
    assert.ok(seen.length && seen.every((h) => h?.startsWith('Basic ')));
    assert.equal(r.json.plan.media.length, 1);
    const run = await ed.post(`/import/${r.json.run.id}/run`, {});
    assert.equal(run.status, 202);
    await srv.app.jobs.idle();
    assert.match(readFile(fx, 'src/content/blog/moving-day.md'), /^ {2}title: Moving day - Example$/m);
    // a wrong password is refused in words that do not repeat it
    const bad = await ed.post('/import/site', { source: 'wordpress', url: site.base, user: 'editor', password: 'wrong pass word here' });
    assert.equal(bad.status, 422);
    assert.match(bad.json.message, /did not let us in/);
    assert.doesNotMatch(bad.text, /wrong pass word|d3Jvbmc/);
    assertNowhere(srv, [PASSWORD, PASSWORD.replace(/\s+/g, ''), Buffer.from(`editor:${PASSWORD.replace(/\s+/g, '')}`).toString('base64'), 'wrong pass word here']);
  });

  test('private, loopback and link-local addresses are refused, also after a redirect, and never contacted', async () => {
    const hits = other.hits.length;
    for (const url of ['http://169.254.169.254', `http://127.0.0.1:${other.port}`, 'http://10.0.0.5', 'http://localhost', `${site.base}/to-private`, 'file:///etc/passwd', 'ftp://example.com']) {
      const r = await ed.post('/import/site', { source: 'wordpress', url });
      assert.ok([400, 422].includes(r.status), `${url}: ${r.status} ${r.text}`);
    }
    assert.equal(other.hits.length, hits);
  });

  test('pictures at private addresses, behind a redirect to one, or that are not pictures are not brought in; their pages keep the old address', async () => {
    const hits = other.hits.length;
    const wxr = fixture('wordpress.xml', site.base)
      .replace(`${site.base}/wp-content/uploads/2024/05/truck.jpg]]></wp:attachment_url>`, 'http://169.254.169.254/latest/truck.jpg]]></wp:attachment_url>')
      .replace(`${site.base}/wp-content/uploads/2024/05/box.png]]></wp:attachment_url>`, `${site.base}/to-private.png]]></wp:attachment_url>`)
      .replace('<p>A picture from elsewhere:', `<p><img src="${site.base}/to-metadata.png" alt="x"><a href="${site.base}/page.html">page</a> <img src="http://127.0.0.1:${other.port}/secret.png" alt="y"> A picture from elsewhere:`);
    const { done } = await planAndRun(srv, ed, { source: 'wordpress', mapping: { media: 'all' } }, { name: 'unsafe.xml', data: wxr });
    assert.equal(done.run.status, 'done');
    assert.equal(other.hits.length, hits, 'nothing on the private address was asked for');
    const problems = done.result.media.filter((m) => m.problem);
    assert.ok(problems.length >= 3, JSON.stringify(done.result.media));
    assert.ok(done.result.review.some((r) => r.kind === 'media'));
  });
});

/** No secret anywhere the server keeps things: its database (every table) and its data folder's logs. */
function assertNowhere(srv, secrets) {
  const db = srv.app.db;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of tables) {
    const rows = JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all());
    for (const s of secrets) assert.ok(!rows.includes(s) && !rows.includes(encodeURIComponent(s)), `${t} holds a secret`);
  }
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  for (const f of walk(srv.config?.dataDir ?? '').filter((f) => /\.(log|txt|json)$/.test(f))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const s of secrets) assert.ok(!text.includes(s), `${f} holds a secret`);
  }
}
