// Collections and entries: list/filter, get, save with versions, permissions per role, raw HTML rule, path
// allowlists (traversal), create/duplicate/import/download, raw source, autosave, trash, revisions, compat API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { POSTS, as, client, gitLog, makeFixture, readFile, startServer } from './helpers.mjs';
import { sha1 } from '../src/util.mjs';

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('content API', () => {
  let fx;
  let srv;
  let editor;
  let alice; // author
  let carol; // contributor
  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => srv.close());

  test('collections with counts', async () => {
    const r = await editor.get('/collections');
    assert.equal(r.status, 200);
    const posts = r.json.find((c) => c.id === 'posts');
    assert.deepEqual(posts.counts, { all: 4, draft: 2, scheduled: 0, published: 2, trash: 0 });
    assert.equal(r.json.find((c) => c.id === 'pages').can.create, true);
    const forCarol = await carol.get('/collections');
    assert.equal(forCarol.json.find((c) => c.id === 'pages').can.create, false);
  });

  test('list: status, author, tag, search, sort, paging', async () => {
    const all = await editor.get('/collections/posts/entries');
    assert.equal(all.json.total, 4);
    assert.equal(all.json.items[0].id, 'carol-draft', 'default sort is newest modified first');
    const drafts = await editor.get('/collections/posts/entries?status=draft');
    assert.deepEqual(drafts.json.items.map((e) => e.id).sort(), ['bob-draft', 'carol-draft']);
    assert.equal(drafts.json.counts.published, 2, 'counts ignore the status filter');
    assert.deepEqual((await editor.get('/collections/posts/entries?author=alice&sort=title')).json.items.map((e) => e.id), ['hello-world', 'with-html']);
    assert.deepEqual((await editor.get('/collections/posts/entries?tag=news&sort=-date')).json.items.map((e) => e.id), ['bob-draft', 'hello-world']);
    assert.deepEqual((await editor.get('/collections/posts/entries?q=first')).json.items.map((e) => e.id), ['hello-world']);
    const page2 = await editor.get('/collections/posts/entries?sort=title&perPage=3&page=2');
    assert.deepEqual(page2.json.items.map((e) => e.id), ['with-html']);
    assert.equal((await editor.get('/collections/posts/entries?sort=evil')).status, 400);
    assert.equal((await editor.get('/collections/posts/entries?sort=constructor')).status, 400);
    // any column, both ways; ties in id order either way
    const ids = async (sort) => (await editor.get(`/collections/posts/entries?sort=${sort}`)).json.items.map((e) => e.id);
    assert.deepEqual(await ids('status'), ['bob-draft', 'carol-draft', 'hello-world', 'with-html']);
    assert.deepEqual(await ids('-status'), ['hello-world', 'with-html', 'bob-draft', 'carol-draft']);
    const byAuthor = (await editor.get('/collections/posts/entries?sort=author')).json.items.map((e) => e.author);
    assert.deepEqual(byAuthor, [...byAuthor].sort());
    assert.deepEqual(await ids('url'), ['bob-draft', 'carol-draft', 'hello-world', 'with-html']);
    assert.deepEqual(await ids('-id'), ['with-html', 'hello-world', 'carol-draft', 'bob-draft']);
    assert.equal((await editor.get('/collections/posts/entries?status=nope')).status, 400);
    // an article's words (its text: no frontmatter, no tags or Markdown marks), sortable; the filters' choices
    assert.deepEqual(Object.fromEntries(all.json.items.map((e) => [e.id, e.words])), { 'carol-draft': 4, 'bob-draft': 4, 'with-html': 2, 'hello-world': 5 });
    assert.deepEqual(await ids('-words'), ['hello-world', 'bob-draft', 'carol-draft', 'with-html']);
    assert.deepEqual(all.json.facets, { authors: [{ name: 'alice', count: 2 }, { name: 'bob', count: 1 }, { name: 'carol', count: 1 }], tags: [{ name: 'intro', count: 1 }, { name: 'news', count: 2 }] });
    assert.deepEqual((await editor.get('/collections/posts/entries?author=bob&status=draft')).json.facets, all.json.facets, 'every value, whatever the filters');
    assert.equal((await editor.get('/collections/pages/entries')).json.items[0].words, undefined, 'a page has no words count');
    const item = all.json.items.find((e) => e.id === 'hello-world');
    assert.equal(item.url, '/blog/hello-world/');
    assert.equal(item.version, sha1(POSTS['hello-world']));
  });

  test('list: the section, a date, the needs-attention filters and the page maths', async () => {
    const ids = async (query) => (await editor.get(`/collections/posts/entries?${query}`)).json.items.map((e) => e.id).sort();
    // changed at or after a day; a date that is not one is refused
    assert.deepEqual(await ids('since=2026-02-01'), ['bob-draft', 'carol-draft']);
    assert.deepEqual(await ids('since=2026-02-06T10:00:00.000Z'), ['carol-draft']);
    assert.equal((await editor.get('/collections/posts/entries?since=yesterday')).status, 400);
    // the section (groupId): this fixture has no groups, so the filter matches nothing but is not an error
    assert.deepEqual(await ids('group=basics'), []);
    // needs attention: only hello-world has a search description; every entry has a title
    assert.deepEqual(await ids('attention=no-description'), ['bob-draft', 'carol-draft', 'with-html']);
    assert.deepEqual(await ids('attention=no-title'), []);
    assert.deepEqual(await ids('attention=alt-text'), []);
    assert.deepEqual(await ids('attention=links'), []);
    assert.deepEqual(await ids('attention=not-translated'), [], 'no tracked locale here');
    assert.equal((await editor.get('/collections/posts/entries?attention=thin')).status, 400);
    // the counts follow the filter, the page maths do not lie
    const r = (await editor.get('/collections/posts/entries?attention=no-description&perPage=2&page=2&sort=title')).json;
    assert.deepEqual({ total: r.total, page: r.page, perPage: r.perPage, ids: r.items.map((e) => e.id) }, { total: 3, page: 2, perPage: 2, ids: ['with-html'] });
    assert.deepEqual(r.counts, { all: 3, draft: 2, scheduled: 0, published: 1 });
    assert.equal((await editor.get('/collections/posts/entries?page=9')).json.items.length, 0, 'past the end: an empty page, not an error');
    assert.equal((await editor.get('/collections/posts/entries')).json.items[0].locales, undefined, 'no language chips without tracked locales');
  });

  test('get an entry: doc, frontmatter, version, can', async () => {
    const r = await alice.get('/collections/posts/entries/hello-world');
    assert.equal(r.status, 200);
    assert.equal(r.json.version, sha1(POSTS['hello-world']));
    assert.equal(r.json.frontmatter.title, 'Hello World');
    assert.equal(r.json.doc.type, 'doc');
    assert.deepEqual(r.json.can, { edit: true, publish: true, delete: true, rawHtml: true });
    const asCarol = await carol.get('/collections/posts/entries/hello-world');
    assert.deepEqual(asCarol.json.can, { edit: false, publish: false, delete: false, rawHtml: false });
    const page = await editor.get('/collections/pages/entries/about');
    assert.equal(page.json.data.uri, '/about/');
    assert.equal(page.json.url, '/about/');
  });

  test('a title with no letters a-z or digits (Arabic, emoji) names the entry by the day, never "untitled" (QA pass 2, N4)', async () => {
    const a = await editor.post('/collections/posts/entries', { title: 'مرحبا بالعالم' });
    assert.equal(a.status, 201, a.text);
    assert.match(a.json.id, /^post-\d{4}-\d{2}-\d{2}$/);
    const b = await editor.post('/collections/posts/entries', { title: '🚀🚀🚀' });
    assert.equal(b.json.id, `${a.json.id}-2`);
    assert.equal((await editor.get(`/collections/posts/entries/${a.json.id}`)).json.frontmatter.title, 'مرحبا بالعالم');
  });

  test('path allowlist: traversal, encoded separators, other dirs and symlinks are not found', async () => {
    const probes = [
      '/collections/posts/entries/..%2F..%2Fsecret',
      '/collections/posts/entries/..',
      '/collections/posts/entries/%2e%2e',
      '/collections/posts/entries/..%5Csecret',
      '/collections/posts/entries/hello-world.md',
      '/collections/posts/entries/Hello-World',
      '/collections/posts/entries/%00hello',
      '/collections/..%2F/entries/x',
      '/collections/nope/entries/x',
      '/collections/posts/entries/hello-world/../../../secret.txt',
    ];
    for (const p of probes) {
      const r = await editor.get(p);
      assert.ok([404, 405].includes(r.status), `${p} -> ${r.status}`);
      assert.ok(!String(r.text).includes('not content'), p);
    }
    // a symlink in the collection dir pointing outside is refused even though its name is valid
    fs.symlinkSync(path.join(fx.site, 'secret.txt'), path.join(fx.site, 'src/content/blog/sneaky.md'));
    assert.equal((await editor.get('/collections/posts/entries/sneaky')).status, 404);
    assert.equal((await editor.put('/collections/posts/entries/sneaky/source', { source: '---\ntitle: x\n---\n', version: sha1('not content\n') })).status, 404);
    const list = await editor.get('/collections/posts/entries');
    assert.ok(!list.json.items.some((e) => e.id === 'sneaky'));
    fs.unlinkSync(path.join(fx.site, 'src/content/blog/sneaky.md'));
    assert.equal(readFile(fx, 'secret.txt'), 'not content\n');
  });

  test('save: surgical write, git commit authored by the user, 0 changes = no commit', async () => {
    const cur = await alice.get('/collections/posts/entries/hello-world');
    const same = await alice.put('/collections/posts/entries/hello-world', { version: cur.json.version, doc: cur.json.doc });
    assert.equal(same.status, 200);
    assert.equal(same.json.changedBlocks, 0);
    assert.equal(same.json.commit, null);
    const doc = structuredClone(cur.json.doc);
    doc.content[1] = para('First paragraph, edited.');
    const r = await alice.put('/collections/posts/entries/hello-world', { version: cur.json.version, doc, message: 'Fix intro' });
    assert.equal(r.status, 200);
    assert.equal(r.json.changedBlocks, 1);
    assert.match(r.json.commit, /^[0-9a-f]{40}$/);
    const text = readFile(fx, 'src/content/blog/hello-world.md');
    assert.equal(text, POSTS['hello-world'].replace('First paragraph.', 'First paragraph, edited.'));
    assert.equal(r.json.version, sha1(text));
    const [last] = gitLog(fx, 'src/content/blog/hello-world.md');
    assert.equal(last, `${alice.user.email.split('@')[0]}|${alice.user.email}|Fix intro`);
  });

  test('a stale version gets 409 with the current version and writes nothing', async () => {
    const before1 = readFile(fx, 'src/content/blog/hello-world.md');
    const r = await editor.put('/collections/posts/entries/hello-world', { version: sha1(POSTS['hello-world']), doc: { type: 'doc', content: [para('clobber')] } });
    assert.equal(r.status, 409);
    assert.equal(r.json.version, sha1(before1));
    assert.equal(readFile(fx, 'src/content/blog/hello-world.md'), before1);
  });

  test('frontmatter edits are surgical; status keys cannot be set by a save', async () => {
    const cur = await editor.get('/collections/posts/entries/with-html');
    const r = await editor.put('/collections/posts/entries/with-html', { version: cur.json.version, frontmatter: { excerpt: 'New excerpt' } });
    assert.equal(r.status, 200);
    const text = readFile(fx, 'src/content/blog/with-html.md');
    assert.match(text, /\nexcerpt: "?New excerpt"?\n---/);
    assert.ok(text.startsWith(POSTS['with-html'].split('---\n\n')[0]), 'other keys untouched');
    const bad = await editor.put('/collections/posts/entries/with-html', { version: r.json.version, frontmatter: { draft: true } });
    assert.equal(bad.status, 422);
    const src = await editor.get('/collections/posts/entries/with-html/source');
    const sneaky = await editor.put('/collections/posts/entries/with-html/source', { version: src.json.version, source: src.json.source.replace('---\n\nIntro', 'publishAt: "2030-01-01T00:00:00.000Z"\n---\n\nIntro') });
    assert.equal(sneaky.status, 422, 'raw source cannot change status either');
  });

  test('authors: own entries only; contributors: own drafts only, never live ones', async () => {
    const bob = await alice.get('/collections/posts/entries/bob-draft');
    assert.equal((await alice.put('/collections/posts/entries/bob-draft', { version: bob.json.version, doc: { type: 'doc', content: [para('x')] } })).status, 403);
    const live = await carol.get('/collections/posts/entries/hello-world');
    assert.equal((await carol.put('/collections/posts/entries/hello-world', { version: live.json.version, doc: { type: 'doc', content: [para('x')] } })).status, 403);
    const own = await carol.get('/collections/posts/entries/carol-draft');
    const doc = structuredClone(own.json.doc);
    doc.content[0] = para('Carol writes more.');
    const ok = await carol.put('/collections/posts/entries/carol-draft', { version: own.json.version, doc });
    assert.equal(ok.status, 200);
    // nobody but editors can hand an entry to another author
    const steal = await carol.put('/collections/posts/entries/carol-draft', { version: ok.json.version, frontmatter: { author: 'alice' } });
    assert.equal(steal.status, 403);
    const page = await alice.get('/collections/pages/entries/about');
    assert.equal((await alice.put('/collections/pages/entries/about', { version: page.json.version, changes: [{ path: 'title', value: 'x' }] })).status, 403);
  });

  test('contributors cannot add or change raw HTML (doc save, source save, new entry), but keep what is there', async () => {
    const own = await carol.get('/collections/posts/entries/carol-draft');
    const add = structuredClone(own.json.doc);
    add.content.push({ type: 'rawHtml', attrs: { html: '<script>alert(1)</script>' } });
    assert.equal((await carol.put('/collections/posts/entries/carol-draft', { version: own.json.version, doc: add })).status, 403);
    const change = structuredClone(own.json.doc);
    change.content[1].attrs.html = '<div class="legacy" onclick="x()">old html</div>';
    assert.equal((await carol.put('/collections/posts/entries/carol-draft', { version: own.json.version, doc: change })).status, 403);
    const src = await carol.get('/collections/posts/entries/carol-draft/source');
    assert.equal((await carol.put('/collections/posts/entries/carol-draft/source', { version: src.json.version, source: `${src.json.source}\n<iframe src="x"></iframe>\n` })).status, 403);
    const keep = structuredClone(own.json.doc);
    keep.content.push(para('Plain text is fine.'));
    assert.equal((await carol.put('/collections/posts/entries/carol-draft', { version: own.json.version, doc: keep })).status, 200);
    const created = await carol.post('/collections/posts/entries', { title: 'Sneaky', doc: { type: 'doc', content: [{ type: 'rawHtml', attrs: { html: '<img src=x onerror=alert(1)>' } }] } });
    assert.equal(created.status, 403);
    // an author may
    const w = await alice.get('/collections/posts/entries/with-html');
    const doc = structuredClone(w.json.doc);
    doc.content.push({ type: 'rawHtml', attrs: { html: '<div class="new">ok</div>' } });
    assert.equal((await alice.put('/collections/posts/entries/with-html', { version: w.json.version, doc })).status, 200);
  });

  test('URL-scheme rule for every role: javascript:, data:, vbscript: links are refused (422)', async () => {
    const link = (href) => ({ type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }] });
    const cur = await editor.get('/collections/posts/entries/bob-draft');
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x']) {
      const r = await editor.put('/collections/posts/entries/bob-draft', { version: cur.json.version, doc: { type: 'doc', content: [link(bad)] } });
      assert.equal(r.status, 422, bad);
      assert.ok(r.json.urls.length === 1);
    }
    const img = { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'x' } };
    assert.equal((await editor.put('/collections/posts/entries/bob-draft', { version: cur.json.version, doc: { type: 'doc', content: [img] } })).status, 422);
    const box = { type: 'callout', attrs: { tone: 'info', button: { label: 'Go', url: 'javascript:go()' } } };
    assert.equal((await editor.put('/collections/posts/entries/bob-draft', { version: cur.json.version, doc: { type: 'doc', content: [box] } })).status, 422);
    assert.equal((await editor.put('/collections/posts/entries/bob-draft', { version: cur.json.version, frontmatter: { cover: { src: 'javascript:x' } } })).status, 422, 'frontmatter too');
    const page = await editor.get('/collections/pages/entries/about');
    assert.equal((await editor.put('/collections/pages/entries/about', { version: page.json.version, changes: [{ path: 'sections.0.value.href', value: 'javascript:x' }] })).status, 422, 'JSON entries too');
    assert.equal((await editor.post('/snippets', { name: 'bad', doc: { type: 'doc', content: [link('javascript:x')] } })).status, 422, 'snippets too');
    const fine = { type: 'doc', content: [link('https://x.test'), link('mailto:a@b.test'), link('tel:+1555'), link('/blog/x/'), link('#top')] };
    const ok = await editor.put('/collections/posts/entries/bob-draft', { version: cur.json.version, doc: fine });
    assert.equal(ok.status, 200);
    const back = await editor.get('/collections/posts/entries/bob-draft/revisions');
    const restore = await editor.post(`/collections/posts/entries/bob-draft/revisions/${back.json[1].sha}/restore`, { version: ok.json.version });
    assert.equal(restore.status, 200);
  });

  test('create: draft, own author, slug from title, id conflicts', async () => {
    const r = await carol.post('/collections/posts/entries', { title: 'Carol’s New Post!', frontmatter: { author: 'alice', tags: ['news'] }, doc: { type: 'doc', content: [para('Body.')] } });
    assert.equal(r.status, 201);
    assert.equal(r.json.id, 'carol-s-new-post');
    assert.equal(r.json.status, 'draft');
    assert.equal(r.json.author, 'carol', 'contributors always create as themselves');
    const text = readFile(fx, 'src/content/blog/carol-s-new-post.md');
    assert.match(text, /^---\n/);
    assert.ok(text.includes('draft: true'));
    assert.ok(text.endsWith('Body.\n'));
    const dup = await editor.post('/collections/posts/entries', { id: 'carol-s-new-post', title: 'Again' });
    assert.equal(dup.status, 409);
    assert.equal((await editor.post('/collections/posts/entries', { id: '../evil', title: 'x' })).status, 422);
    assert.equal((await editor.post('/collections/posts/entries', { title: 'x', frontmatter: { publishAt: '2030-01-01' } })).status, 422);
    const auto = await editor.post('/collections/posts/entries', { title: 'Carol’s New Post' });
    assert.equal(auto.json.id, 'carol-s-new-post-2');
    assert.equal((await carol.post('/collections/pages/entries', { title: 'Page' })).status, 403);
    const page = await editor.post('/collections/pages/entries', { title: 'Contact', data: { uri: '/contact/' } });
    assert.equal(page.status, 201);
    assert.deepEqual(JSON.parse(readFile(fx, 'src/content/pages/contact.json')), { uri: '/contact/', title: 'Contact' });
  });

  test('length caps: a title 300, an excerpt 500, a tag 100, an address part 200, the text 2 MB; plain words, nothing written (QA F4)', async () => {
    const r = await editor.post('/collections/posts/entries', { title: 'x'.repeat(301) });
    assert.equal(r.status, 422);
    assert.equal(r.json.error, 'too-long');
    assert.equal(r.json.message, 'The title is at most 300 characters.');
    assert.deepEqual(r.json.fields, { title: 'The title is at most 300 characters.' });
    assert.equal((await editor.post('/collections/posts/entries', { title: 'x'.repeat(300), id: 'long-title-ok' })).status, 201);
    const ex = await editor.post('/collections/posts/entries', { title: 'Excerpt', frontmatter: { excerpt: 'e'.repeat(501) } });
    assert.equal(ex.status, 422);
    assert.match(ex.json.message, /^The excerpt is at most 500 characters/);
    const tag = await editor.post('/collections/posts/entries', { title: 'Tags', frontmatter: { tags: ['fine', 't'.repeat(101)] } });
    assert.equal(tag.status, 422);
    assert.match(tag.json.message, /^A tag is at most 100 characters/);
    const dup = await editor.post('/collections/posts/entries/hello-world/duplicate', { title: 'y'.repeat(5000) });
    assert.equal(dup.status, 422, 'Duplicate takes the same cap');
    const uri = await editor.post('/collections/pages/entries', { title: 'Deep', data: { uri: `/${'a'.repeat(201)}/` } });
    assert.equal(uri.status, 422);
    assert.match(uri.json.message, /^Each part of the address is at most 200 characters/);
    const big = await editor.post('/collections/posts/entries', { title: 'Big', doc: { type: 'doc', content: [para('b'.repeat(2 * 1024 * 1024 + 10))] } });
    assert.equal(big.status, 422);
    assert.match(big.json.message, /^This entry is too long: the limit is 2 MB/);
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/big.md')));
    // a save is held to the same line
    const e = await editor.get('/collections/posts/entries/hello-world');
    const save = await editor.put('/collections/posts/entries/hello-world', { version: e.json.version, frontmatter: { title: 'z'.repeat(301) } });
    assert.equal(save.status, 422);
    assert.equal(save.json.error, 'too-long');
  });

  test('duplicate makes a draft copy owned by the caller', async () => {
    const r = await alice.post('/collections/posts/entries/hello-world/duplicate', {});
    assert.equal(r.status, 201);
    assert.equal(r.json.id, 'hello-world-copy');
    assert.equal(r.json.status, 'draft');
    assert.equal(r.json.title, 'Hello World (copy)');
    const again = await alice.post('/collections/posts/entries/hello-world/duplicate', {});
    assert.equal(again.json.id, 'hello-world-copy-2');
    // a contributor cannot duplicate their way into raw HTML
    assert.equal((await carol.post('/collections/posts/entries/with-html/duplicate', {})).status, 403);
  });

  test('the settings route refuses raw source in plain words (QA F30)', async () => {
    const cur = await editor.get('/collections/posts/entries/hello-world');
    const r = await editor.put('/collections/posts/entries/hello-world', { version: cur.json.version, source: '---\ntitle: x\n---\n' });
    assert.equal(r.status, 400);
    assert.equal(r.json.message, 'The raw text of an entry is saved from the Source view (its own route), not with the settings.');
  });

  test('raw source: get and put with the same version rules; must still parse', async () => {
    const s = await editor.get('/collections/pages/entries/about/source');
    assert.equal(s.json.format, 'json');
    assert.equal((await editor.put('/collections/pages/entries/about/source', { version: s.json.version, source: '{ broken' })).status, 422);
    const next = s.json.source.replace('We are here', 'We are there');
    const ok = await editor.put('/collections/pages/entries/about/source', { version: s.json.version, source: next });
    assert.equal(ok.status, 200);
    assert.equal(readFile(fx, 'src/content/pages/about.json'), next);
    assert.equal((await editor.put('/collections/pages/entries/about/source', { version: s.json.version, source: next })).status, 409);
    const md = await editor.get('/collections/posts/entries/bob-draft/source');
    assert.equal((await editor.put('/collections/posts/entries/bob-draft/source', { version: md.json.version, source: 'no frontmatter' })).status, 422);
  });

  test('JSON changes are applied by path; prototype keys are refused', async () => {
    const p = await editor.get('/collections/pages/entries/about');
    const r = await editor.put('/collections/pages/entries/about', { version: p.json.version, changes: [{ path: 'sections.0.value.heading', value: 'Hello there' }] });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(readFile(fx, 'src/content/pages/about.json')).sections[0].value.heading, 'Hello there');
    for (const bad of ['__proto__.polluted', 'constructor.prototype.x', 'sections..x']) {
      const res = await editor.put('/collections/pages/entries/about', { version: r.json.version, changes: [{ path: bad, value: 1 }] });
      assert.equal(res.status, 422, bad);
    }
    assert.equal({}.polluted, undefined);
  });

  test('import a .md as a new draft; download the file', async () => {
    const source = '---\ntitle: Imported Post\nslug: imported-post\nauthor: alice\ndraft: false\n---\n\nFrom a file.\n';
    const r = await alice.post('/collections/posts/import', { filename: 'Imported Post.md', source });
    assert.equal(r.status, 201);
    assert.equal(r.json.id, 'imported-post');
    assert.equal(r.json.status, 'draft');
    assert.equal((await alice.post('/collections/posts/import', { filename: 'x.md', source: '---\nauthor: alice\n---\n\nNo title.\n' })).status, 422);
    assert.equal((await alice.post('/collections/posts/import', { filename: 'x.txt', source })).status, 422);
    const d = await alice.get('/collections/posts/entries/imported-post/download');
    assert.equal(d.headers.get('content-disposition'), 'attachment; filename="imported-post.md"');
    assert.match(d.headers.get('content-type'), /^text\/markdown/);
    assert.ok(d.text.includes('From a file.'));
  });

  test('autosave is private to the user and never touches the file', async () => {
    const before1 = readFile(fx, 'src/content/blog/bob-draft.md');
    const cur = await editor.get('/collections/posts/entries/bob-draft');
    const a = await editor.put('/collections/posts/entries/bob-draft/autosave', { baseVersion: cur.json.version, doc: { type: 'doc', content: [para('unsaved')] } });
    assert.equal(a.status, 200);
    assert.equal(readFile(fx, 'src/content/blog/bob-draft.md'), before1);
    assert.equal((await editor.get('/collections/posts/entries/bob-draft')).json.autosave.baseVersion, cur.json.version);
    assert.equal((await editor.get('/collections/posts/entries/bob-draft/autosave')).json.doc.content[0].content[0].text, 'unsaved');
    assert.equal((await alice.get('/collections/posts/entries/bob-draft/autosave')).status, 404);
    assert.equal((await alice.get('/collections/posts/entries/bob-draft')).json.autosave, null);
    assert.equal((await editor.del('/collections/posts/entries/bob-draft/autosave')).status, 200);
    assert.equal((await editor.get('/collections/posts/entries/bob-draft/autosave')).status, 404);
  });

  test('delete to trash and restore as a draft', async () => {
    const cur = await alice.get('/collections/posts/entries/hello-world-copy-2');
    assert.equal((await carol.del(`/collections/posts/entries/hello-world-copy-2?version=${cur.json.version}`)).status, 403);
    assert.equal((await alice.del('/collections/posts/entries/hello-world-copy-2?version=stale')).status, 409);
    const noVersion = await alice.del('/collections/posts/entries/hello-world-copy-2');
    assert.equal(noVersion.status, 400, 'a missing version is not "changed since you opened it" (QA F18)');
    assert.match(noVersion.json.message, /^Send the version you opened/);
    const d = await alice.del(`/collections/posts/entries/hello-world-copy-2?version=${cur.json.version}`);
    assert.equal(d.status, 200);
    assert.equal(d.json.job, null, 'a draft needs no rebuild');
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/hello-world-copy-2.md')));
    assert.match(gitLog(fx, 'src/content/blog/hello-world-copy-2.md')[0], /Trash posts\/hello-world-copy-2$/);
    const t = await alice.get('/trash');
    assert.ok(t.json.some((x) => x.trashId === d.json.trashId));
    assert.equal((await carol.get('/trash')).json.length, 0, 'contributors see only their own');
    assert.equal((await carol.post(`/trash/${d.json.trashId}/restore`, {})).status, 403);
    const back = await alice.post(`/trash/${d.json.trashId}/restore`, {});
    assert.equal(back.status, 201);
    assert.equal(back.json.status, 'draft');
    assert.equal((await alice.get('/trash')).json.some((x) => x.trashId === d.json.trashId), false);
  });

  test('revisions: list, show, compare, restore as a new revision (status kept)', async () => {
    const list = await editor.get('/collections/posts/entries/hello-world/revisions');
    assert.equal(list.status, 200);
    assert.ok(list.json.length >= 2);
    const oldest = list.json[list.json.length - 1];
    assert.equal(oldest.message, 'Fixture site');
    const show = await editor.get(`/collections/posts/entries/hello-world/revisions/${oldest.sha.slice(0, 8)}`);
    assert.equal(show.json.source, POSTS['hello-world']);
    assert.equal(show.json.doc.type, 'doc');
    const cmp = await editor.get(`/collections/posts/entries/hello-world/compare?from=${oldest.sha}&to=current`);
    assert.match(cmp.json.diff, /-First paragraph\.\n\+First paragraph, edited\./);
    assert.equal((await editor.get('/collections/posts/entries/hello-world/revisions/zzzz')).status, 404);
    const otherFile = fx.git('log', '-1', '--format=%H', '--', 'src/content/blog/bob-draft.md').trim();
    const foreign = fx.git('log', '--format=%H', '--', 'src/content/blog/carol-draft.md').trim().split('\n')[0];
    assert.equal((await editor.get(`/collections/posts/entries/hello-world/revisions/${foreign}`)).status, otherFile === foreign ? 200 : 404, 'only commits that touched this file');
    const cur = await editor.get('/collections/posts/entries/hello-world');
    const r = await editor.post(`/collections/posts/entries/hello-world/revisions/${oldest.sha}/restore`, { version: cur.json.version });
    assert.equal(r.status, 200);
    assert.equal(readFile(fx, 'src/content/blog/hello-world.md'), POSTS['hello-world']);
    assert.match(gitLog(fx, 'src/content/blog/hello-world.md')[0], /Restore posts\/hello-world to [0-9a-f]{7}$/);
    // restoring a draft-era revision of a live entry keeps it live (restoring never changes status)
    const bobOld = (await editor.get('/collections/posts/entries/bob-draft/revisions')).json.at(-1);
    const bobCur = await editor.get('/collections/posts/entries/bob-draft');
    assert.equal((await editor.post(`/collections/posts/entries/bob-draft/revisions/${bobOld.sha}/restore`, { version: bobCur.json.version })).status, 200);
    assert.equal((await editor.get('/collections/posts/entries/bob-draft')).json.status, 'draft');
  });

  test('snippets and templates', async () => {
    const s = await carol.post('/snippets', { name: 'Sign-off', doc: { type: 'doc', content: [para('Thanks!')] } });
    assert.equal(s.status, 201);
    assert.equal((await alice.get('/snippets')).json.some((x) => x.id === s.json.id), false, 'private by default');
    assert.equal((await alice.patch(`/snippets/${s.json.id}`, { name: 'x' })).status, 404);
    assert.equal((await carol.patch(`/snippets/${s.json.id}`, { shared: true })).status, 200);
    assert.equal((await alice.patch(`/snippets/${s.json.id}`, { name: 'x' })).status, 403);
    assert.equal((await editor.patch(`/snippets/${s.json.id}`, { name: 'Sign-off v2' })).status, 200);
    assert.equal((await carol.post('/snippets', { name: 'bad', doc: 'nope' })).status, 422);
    assert.equal((await alice.post('/templates', { collection: 'posts', name: 'Review' })).status, 403);
    const t = await editor.post('/templates', { collection: 'posts', name: 'Review', frontmatter: { tags: ['review'] }, doc: { type: 'doc', content: [para('Verdict:')] } });
    assert.equal(t.status, 201);
    const fromT = await alice.post('/collections/posts/entries', { title: 'My Review', templateId: t.json.id });
    assert.equal(fromT.status, 201);
    assert.deepEqual(fromT.json.frontmatter.tags, ['review']);
    assert.ok(readFile(fx, 'src/content/blog/my-review.md').endsWith('Verdict:\n'));
  });

  test('compat: today\'s /studio-api/ routes, signed-in and CSRF-protected', async () => {
    const anon = client(srv.base);
    assert.equal((await anon.get('/studio-api/articles')).status, 401);
    const list = await editor.get('/studio-api/articles');
    assert.equal(list.status, 200);
    const hw = list.json.find((a) => a.slug === 'hello-world');
    assert.deepEqual(Object.keys(hw), ['slug', 'title', 'url', 'cluster']);
    assert.equal(hw.cluster, 'basics');
    const art = await editor.get('/studio-api/article?slug=hello-world');
    assert.deepEqual(Object.keys(art.json), ['slug', 'url', 'title', 'doc', 'version']);
    assert.equal((await editor.get('/studio-api/article?slug=../secret')).status, 404);
    const doc = structuredClone(art.json.doc);
    doc.content.push(para('Added via compat.'));
    assert.equal((await editor.post('/studio-api/article?slug=hello-world', { doc, version: art.json.version }, { noCsrf: true })).status, 403);
    const saved = await editor.post('/studio-api/article?slug=hello-world', { doc, version: art.json.version });
    assert.equal(saved.status, 200);
    assert.deepEqual(Object.keys(saved.json), ['ok', 'version', 'changedBlocks']);
    assert.equal((await editor.post('/studio-api/article?slug=hello-world', { doc, version: art.json.version })).status, 409);
  });

  test('without the core converter, Markdown routes answer 503 instead of guessing', async () => {
    const fx2 = makeFixture({ checks: false });
    const { startServer: start } = await import('./helpers.mjs');
    const srv2 = await start(fx2, { core: null });
    try {
      const ed = await as(srv2, 'editor');
      assert.equal((await ed.get('/collections/posts/entries/hello-world')).status, 503);
      assert.equal((await ed.get('/collections/pages/entries/about')).status, 200, 'JSON still works');
    } finally {
      await srv2.close();
    }
  });
});
