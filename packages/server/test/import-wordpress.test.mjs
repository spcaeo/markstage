// The site import from WordPress (docs/IMPORT.md), end to end against a fixture site: a WXR export uploaded, a dry
// run that writes and fetches nothing, a run in reviewable batches by the person, a second run that changes nothing,
// and the moved addresses (old permalinks, ?p=, ?page_id=, attachment pages, uploads paths). The old site's files are
// on a local web site reached through the test seam only.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, readFile } from './helpers.mjs';
import { fixture, importServer, oldFiles, planAndRun, form } from './site-import.mjs';
import { startWebSite } from './web-site.mjs';

describe('the site import: WordPress', () => {
  let fx, srv, site, ed, wxr;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const file = () => ({ name: 'example.WordPress.2024-05-10.xml', type: 'text/xml', data: wxr });

  before(async () => {
    site = await startWebSite(oldFiles());
    ({ fx, srv } = await importServer({ outbound: site.outbound }));
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    wxr = fixture('wordpress.xml', site.base);
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  test('the dry run writes nothing, fetches nothing, and shows the whole plan', async () => {
    const h = head();
    const hits = site.hits.length;
    const f = form({ source: 'wordpress' }, file());
    const r = await ed.post('/import/site', f.body, { headers: f.headers });
    assert.equal(r.status, 201, r.text);
    const p = r.json.plan;
    assert.equal(head(), h);
    assert.equal(site.hits.length, hits);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
    assert.deepEqual(p.counts.types, { post: 3, page: 1 });
    assert.deepEqual(p.items.map((i) => [i.sourceId, i.collection, i.id, i.action]), [
      ['post-12', 'posts', 'moving-day', 'create'],
      ['post-13', 'posts', 'second-post', 'create'],
      ['post-14', 'posts', 'draft-idea', 'create'],
      ['page-3', 'pages', 'about-us', 'create'],
    ]);
    assert.equal(p.counts.published, 2, 'the two published posts come in as drafts');
    // the pictures the posts use (one per original file, whatever size they showed) and the PDF they link to
    assert.deepEqual(p.media.map((m) => m.url.replace(site.base, '')).sort(), ['/wp-content/uploads/2024/05/box.png', '/wp-content/uploads/2024/05/price-list.pdf', '/wp-content/uploads/2024/05/truck.jpg']);
    assert.deepEqual(p.authors.map((a) => [a.slug, a.action]), [['alice', 'existing'], ['bob-writer', 'create']]);
    assert.equal(p.counts.needsAlt, 2, 'box.png and the PDF');
    assert.ok(p.counts.notConverted >= 3, JSON.stringify(p.counts));
    const kinds = new Set(p.review.map((x) => x.kind));
    for (const k of ['alt', 'block', 'shortcode', 'embed', 'html', 'image']) assert.ok(kinds.has(k), `review has ${k}: ${[...kinds]}`);
    // old addresses: permalinks, attachment pages and uploads paths as paths; ?p=, ?page_id=, ?attachment_id= as ids
    const from = Object.fromEntries(p.redirects.map((x) => [x.from, x.to]));
    assert.equal(from['/2024/05/moving-day/'], '/blog/moving-day/');
    assert.equal(from['/about-us/'], undefined, 'the page keeps its address, so it needs no redirect');
    assert.match(from['/2024/05/moving-day/truck/'], /^\/uploads\/\d{4}\/\d\d\/truck\.\w+$/);
    assert.match(from['/wp-content/uploads/2024/05/truck-300x200.jpg'], /^\/uploads\//);
    assert.equal(p.counts.ids, 6, '?p= 12, 13, 14; ?page_id= 3; ?attachment_id= 41, 42');
    assert.equal(r.json.run.status, 'planned');
    assert.equal(r.json.run.kind, 'site');
  });

  test('the run: media, authors, entries and moved addresses, each a commit by the person; everything as drafts', async () => {
    const h = head();
    const { done } = await planAndRun(srv, ed, { source: 'wordpress' }, file());
    assert.equal(done.run.status, 'done', JSON.stringify(done.result ?? done.run));
    const subjects = fx.git('log', '--format=%s|%an', `${h}..HEAD`).trim().split('\n').reverse();
    assert.deepEqual(subjects.slice(0, 3).map((s) => s.split('|')[0]), ['Import 3 media files from WordPress', 'Import 1 author from WordPress', 'Import 4 posts and pages from WordPress']);
    assert.match(subjects[3], /^Moved addresses for the WordPress import \(\d+ paths, 6 id links\)\|/);
    assert.equal(subjects.length, 4);
    assert.ok(subjects.every((s) => s.endsWith(`|${ed.user.email.split('@')[0]}`)), subjects.join('\n'));

    const post = readFile(fx, 'src/content/blog/moving-day.md');
    assert.match(post, /^title: Moving day & more$/m);
    assert.match(post, /^draft: true$/m);
    assert.match(post, /^author: alice$/m);
    assert.match(post, /^date: '?2024-05-06T10:00:00.000Z'?$/m);
    assert.match(post, /^---\ntitle: /, 'the title comes first');
    assert.match(post, /^ {2}- News$/m);
    assert.match(post, /^ {2}title: Moving day & more - Example Moving Co$/m);
    assert.match(post, /^ {2}src: \/uploads\/\d{4}\/\d\d\/truck\.\w+$/m);
    assert.match(post, /^ {2}alt: Our blue truck$/m);
    // links to old pages go to their new addresses; pictures and files to the media library; the rest notes
    assert.match(post, /\[second post\]\(\/blog\/second-post\/\)/);
    assert.match(post, /\[about page\]\(\/about-us\/\)/);
    assert.match(post, /\[price list\]\(\/uploads\/\d{4}\/\d\d\/price-list\.pdf\)/);
    assert.match(post, /!\[Our blue truck\]\(\/uploads\//, 'the alt text comes from the media library');
    assert.match(post, /Import note: the WordPress shortcode “contact-form-7”/);
    assert.doesNotMatch(post, /<script|<iframe|alert\(1\)|127\.0\.0\.1/);
    assert.match(readFile(fx, 'src/content/blog/second-post.md'), /\[moving day\]\(\/blog\/moving-day\/\)/);
    assert.match(readFile(fx, 'src/content/blog/second-post.md'), /^author: bob-writer$/m);
    assert.equal(JSON.parse(readFile(fx, 'src/content/authors/bob-writer.json')).name, 'Bob Writer');
    const page = JSON.parse(readFile(fx, 'src/content/pages/about-us.json'));
    assert.equal(page.uri, '/about-us/');
    assert.equal(page.seo.description, 'Who we are & what we do.');
    assert.match(page.body, /small moving company/);

    const redirects = JSON.parse(readFile(fx, 'src/data/redirects.json'));
    assert.equal(redirects['/2024/05/moving-day/'], '/blog/moving-day/');
    const ids = JSON.parse(readFile(fx, done.result.redirects.file));
    assert.equal(ids.ids.p['12'], '/blog/moving-day/');
    assert.equal(ids.ids.page_id['3'], '/about-us/');
    assert.match(ids.ids.attachment_id['41'], /^\/uploads\//);
    assert.equal(done.result.counts.entries.create, 4);
    // the review list after the run: the box picture still needs alt text, and links to where it is
    const alt = done.result.review.filter((x) => x.kind === 'alt');
    assert.equal(alt.length, 2);
    assert.ok(alt.every((x) => x.media.id), JSON.stringify(alt));
  });

  test('again: nothing changes, nothing is fetched, nothing is committed', async () => {
    const h = head();
    const hits = site.hits.length;
    const { plan, done } = await planAndRun(srv, ed, { source: 'wordpress' }, file());
    assert.deepEqual(plan.items.map((i) => i.action), ['unchanged', 'unchanged', 'unchanged', 'unchanged']);
    assert.ok(plan.media.every((m) => m.action === 'reuse'));
    assert.ok(plan.authors.every((a) => a.action === 'existing'));
    assert.equal(done.run.status, 'done', JSON.stringify((await ed.get(`/jobs/${done.run.job}`)).json));
    assert.equal(head(), h);
    assert.equal(site.hits.length, hits);
  });

  test('a taken address: kept both, skipped, or replaced, as chosen', async () => {
    const taken = wxr.replace('<wp:post_name><![CDATA[second-post]]></wp:post_name>', '<wp:post_name><![CDATA[hello-world]]></wp:post_name>').split('<wp:post_id>13</wp:post_id>').join('<wp:post_id>1013</wp:post_id>');
    const plan = async (onCollision) => {
      const f = form({ source: 'wordpress', mapping: { onCollision } }, { name: 'x.xml', data: taken });
      return (await ed.post('/import/site', f.body, { headers: f.headers })).json.plan;
    };
    const both = (await plan('both')).items.find((i) => i.sourceId === 'post-1013');
    assert.deepEqual([both.id, both.action, both.collision], ['hello-world-2', 'create', 'both']);
    const skip = (await plan('skip')).items.find((i) => i.sourceId === 'post-1013');
    assert.deepEqual([skip.action, skip.collision], ['skip', 'skip']);
    assert.match(skip.problem, /already has an entry at posts\/hello-world/);
    const rep = (await plan('replace')).items.find((i) => i.sourceId === 'post-1013');
    assert.deepEqual([rep.id, rep.action], ['hello-world', 'update']);
    assert.equal((await plan('both')).counts.collisions, 1);
  });

  test('another mapping: a kind left out, a field to another key, drafts without status', async () => {
    const f = form({ source: 'wordpress' }, file());
    const p = (await ed.post('/import/site', f.body, { headers: f.headers })).json;
    const again = await ed.post(`/import/${p.run.id}/replan`, { mapping: { types: { page: null }, fields: { posts: { excerpt: 'summary' } } } });
    assert.equal(again.status, 201, again.text);
    assert.equal(again.json.plan.counts.left.page, 1);
    assert.equal(again.json.plan.mapping.fields.posts.excerpt, 'summary');
    assert.equal((await ed.get(`/import/${p.run.id}`)).json.run.status, 'replaced');
    const bad = await ed.post(`/import/${again.json.run.id}/replan`, { mapping: { types: { post: 'nowhere' } } });
    assert.deepEqual([bad.status, bad.json.field], [422, 'types.post']);
  });

  test('wrong files and wrong people are refused in words', async () => {
    const send = async (who, fields, f) => {
      const b = form(fields, f);
      return who.post('/import/site', b.body, { headers: b.headers });
    };
    assert.equal((await send(ed, { source: 'wordpress' }, { name: 'x.xml', data: '<html><body>not an export</body></html>' })).status, 422);
    assert.equal((await send(ed, { source: 'wordpress' }, { name: 'x.json', data: '{}' })).status, 422);
    assert.equal((await send(ed, { source: 'nope' }, file())).status, 422);
    const author = await as(srv, 'author', { authorSlug: 'alice' });
    assert.equal((await send(author, { source: 'wordpress' }, file())).status, 403);
  });
});
