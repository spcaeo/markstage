// Move many entries at once (the Pages tree): every move is checked first and nothing is written unless all may be
// made; then one commit with the new names, the fields set (order, parent), every link to an old address rewritten
// and a redirect per locale; one build for the live ones, and a failed build puts every file back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';
import { LINKER, localeServer } from './locale-site.mjs';

describe('move many', () => {
  let fx, srv, ed, carl;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const v = async (c, id) => (await ed.get(`/collections/${c}/entries/${id}`)).json.version;
  const exists = (f) => fs.existsSync(path.join(fx.site, f));
  before(async () => {
    ({ fx, srv } = await localeServer());
    // a live post of the contributor's own
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/bob-live.md'), `---\ntitle: Bob Live\nauthor: bob\n---\n\nLive.\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Bob live');
    ed = await as(srv, 'editor');
    carl = await as(srv, 'contributor', { authorSlug: 'bob' });
  });
  after(() => srv.close());

  test('the request is checked; one move that may not be made stops them all, each named, nothing written', async () => {
    assert.equal((await ed.post('/site/move', {})).status, 400);
    assert.equal((await ed.post('/site/move', { moves: Array.from({ length: 201 }, () => ({})) })).status, 400);
    const was = head();
    const r = await ed.post('/site/move', { moves: [
      { collection: 'posts', id: 'hello-world', version: await v('posts', 'hello-world'), newId: 'hello-there' },
      { collection: 'posts', id: 'with-html', version: 'stale', newId: 'with-markup' },
      { collection: 'posts', id: 'linker', version: await v('posts', 'linker'), set: { draft: false } },
      { collection: 'posts', id: 'bob-draft', version: await v('posts', 'bob-draft'), newId: 'Bad Name' },
      { collection: 'posts', id: 'nope', version: 'x' },
    ] });
    assert.equal(r.status, 422, r.text);
    assert.deepEqual(r.json.problems.map((p) => [p.id, p.message]), [
      ['with-html', 'It changed since the tree was loaded. Load it again.'],
      ['linker', '“draft” cannot be set here.'],
      ['bob-draft', 'A new name uses lowercase letters, digits and hyphens.'],
      ['nope', 'It is no longer there.'],
    ]);
    assert.equal(head(), was);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
  });

  test('names taken (by an entry or another move), a chain, and rights are refused', async () => {
    const hw = await v('posts', 'hello-world');
    const wh = await v('posts', 'with-html');
    const two = await ed.post('/site/move', { moves: [{ collection: 'posts', id: 'hello-world', version: hw, newId: 'same' }, { collection: 'posts', id: 'with-html', version: wh, newId: 'same' }] });
    assert.deepEqual(two.json.problems.map((p) => [p.id, p.message]), [['with-html', 'Another entry is called “same” already.']]);
    assert.equal((await ed.post('/site/move', { moves: [{ collection: 'posts', id: 'hello-world', version: hw, newId: 'linker' }] })).status, 422);
    // a name another move leaves is still taken: move them one after the other
    const swap = await ed.post('/site/move', { moves: [{ collection: 'posts', id: 'hello-world', version: hw, newId: 'hello-new' }, { collection: 'posts', id: 'with-html', version: wh, newId: 'hello-world' }] });
    assert.deepEqual(swap.json.problems.map((p) => [p.id, p.message]), [['with-html', 'Another entry is called “hello-world” already.']]);
    const theirs = await carl.post('/site/move', { moves: [{ collection: 'posts', id: 'linker', version: await v('posts', 'linker'), newId: 'linker-2' }] });
    assert.deepEqual(theirs.json.problems.map((p) => p.message), ['You cannot edit this entry.']);
    const own = await carl.post('/site/move', { moves: [{ collection: 'posts', id: 'bob-live', version: await v('posts', 'bob-live'), newId: 'bob-moved' }] });
    assert.equal(own.status, 422, 'their own live post: a contributor may not change a live entry');
    assert.equal(own.json.problems.length, 1);
  });

  test('two live pages moved and one reordered: one commit, links and redirects for both, one build', async () => {
    const was = head();
    const r = await ed.post('/site/move', { moves: [
      { collection: 'posts', id: 'hello-world', version: await v('posts', 'hello-world'), newId: 'hello-there', set: { order: 1 } },
      { collection: 'posts', id: 'with-html', version: await v('posts', 'with-html'), newId: 'with-markup', set: { order: 2 } },
      { collection: 'posts', id: 'linker', version: await v('posts', 'linker'), set: { order: 3 } },
    ] });
    assert.equal(r.status, 202, r.text);
    assert.deepEqual(r.json.moved.map((m) => [m.from, m.id, m.oldUrl, m.url]), [
      ['hello-world', 'hello-there', '/blog/hello-world/', '/blog/hello-there/'],
      ['with-html', 'with-markup', '/blog/with-html/', '/blog/with-markup/'],
      ['linker', 'linker', '/blog/linker/', '/blog/linker/'],
    ]);
    assert.deepEqual(r.json.linksUpdated, [{ collection: 'pages', id: 'links' }], 'the linker moved too, so it is not counted twice');
    assert.equal(r.json.redirects.length, 4, 'one per locale for each page');
    await srv.app.jobs.idle();
    assert.equal((await ed.get(`/jobs/${r.json.job}`)).json.status, 'succeeded');
    assert.equal(fx.git('rev-parse', 'HEAD~1').trim(), was, 'one commit');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Move 3 entries');
    assert.ok(exists('src/content/blog/hello-there.md') && !exists('src/content/blog/hello-world.md') && exists('src/content/blog/with-markup.md'));
    // the linker: its link follows, and its order is set; nothing else changed
    assert.equal(readFile(fx, 'src/content/blog/linker.md'), LINKER.replace('---\n\nSee', 'order: 3\n---\n\nSee').replace(/hello-world\/(\)|#top|\n)/g, 'hello-there/$1'));
    assert.deepEqual(JSON.parse(readFile(fx, 'src/data/redirects.json')), {
      '/blog/hello-world/': '/blog/hello-there/', '/en-us/blog/hello-world/': '/en-us/blog/hello-there/',
      '/blog/with-html/': '/blog/with-markup/', '/en-us/blog/with-html/': '/en-us/blog/with-markup/',
    });
    assert.equal(fx.git('status', '--porcelain').trim(), '');
  });

  test('a failed build puts every file back', async () => {
    const linker = readFile(fx, 'src/content/blog/linker.md');
    const redirects = readFile(fx, 'src/data/redirects.json');
    fs.writeFileSync(`${fx.failMarker}.build`, '1');
    try {
      const r = await ed.post('/site/move', { moves: [
        { collection: 'posts', id: 'hello-there', version: await v('posts', 'hello-there'), newId: 'hello-again' },
        { collection: 'posts', id: 'linker', version: await v('posts', 'linker'), set: { order: 9 } },
      ] });
      assert.equal(r.status, 202, r.text);
      await srv.app.jobs.idle();
      const job = (await ed.get(`/jobs/${r.json.job}`)).json;
      assert.equal(job.status, 'failed');
      assert.deepEqual(job.steps.map((s) => s.name), ['commit', 'build', 'revert']);
      assert.ok(exists('src/content/blog/hello-there.md') && !exists('src/content/blog/hello-again.md'));
      assert.equal(readFile(fx, 'src/content/blog/linker.md'), linker);
      assert.equal(readFile(fx, 'src/data/redirects.json'), redirects);
      assert.equal(fx.git('status', '--porcelain').trim(), '');
    } finally {
      fs.rmSync(`${fx.failMarker}.build`, { force: true });
    }
  });
});

// the Pages tree's own case: an address made of the parent and the slug, so a page given another parent moves
describe('move many: pages under another parent', () => {
  let fx, srv, ed;
  const page = (slug, parent) => JSON.stringify({ title: slug, parent, slug }, null, 2) + '\n';
  const v = async (id) => (await ed.get(`/collections/tree/entries/${id}`)).json.version;
  before(async () => {
    fx = makeFixture({ checks: false });
    fs.mkdirSync(path.join(fx.site, 'src/content/tree'), { recursive: true });
    for (const [id, slug, parent] of [['p1', 'team', 'about'], ['p2', 'team', 'company'], ['p3', 'history', 'about']]) fs.writeFileSync(path.join(fx.site, 'src/content/tree', `${id}.json`), page(slug, parent));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A tree');
    srv = await startServer(fx, { overrides: { compat: { collection: 'tree' }, collections: [{ id: 'tree', label: 'Tree', dir: 'src/content/tree', format: 'json', url: '/{parent}/{slug}/', fields: { slug: 'slug' } }] } });
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('a new address that is the old one of another page moved in the same go is refused (no chain)', async () => {
    const r = await ed.post('/site/move', { moves: [{ collection: 'tree', id: 'p1', version: await v('p1'), set: { parent: 'company' } }, { collection: 'tree', id: 'p2', version: await v('p2'), set: { parent: 'people' } }] });
    assert.equal(r.status, 422, r.text);
    assert.deepEqual(r.json.problems.map((p) => [p.id, p.message]), [['p1', '/company/team/ is the old address of another page moved here. Move them one after the other.']]);
  });

  test('a page given another parent moves: its address, and the redirect from the old one', async () => {
    const r = await ed.post('/site/move', { moves: [{ collection: 'tree', id: 'p3', version: await v('p3'), set: { parent: 'company', order: 2 } }] });
    assert.ok([200, 202].includes(r.status), r.text);
    assert.deepEqual(r.json.moved.map((m) => [m.id, m.oldUrl, m.url]), [['p3', '/about/history/', '/company/history/']]);
    assert.deepEqual(r.json.redirects, [{ from: '/about/history/', to: '/company/history/' }]);
    assert.deepEqual(JSON.parse(readFile(fx, 'src/content/tree/p3.json')), { title: 'history', parent: 'company', slug: 'history', order: 2 });
    await srv.app.jobs.idle();
  });

  test("another page's address, or one two moves both go to, is refused; nothing written", async () => {
    const was = fx.git('rev-parse', 'HEAD').trim();
    // p2 stays at /company/team/
    const r = await ed.post('/site/move', { moves: [{ collection: 'tree', id: 'p1', version: await v('p1'), set: { parent: 'company' } }] });
    assert.equal(r.status, 422, r.text);
    assert.deepEqual(r.json.problems.map((p) => [p.id, p.message]), [['p1', '/company/team/ is the address of another page already (tree/p2).']]);
    const both = await ed.post('/site/move', { moves: [
      { collection: 'tree', id: 'p1', version: await v('p1'), set: { parent: 'people' } },
      { collection: 'tree', id: 'p3', version: await v('p3'), newSlug: 'team', set: { parent: 'people' } },
    ] });
    assert.deepEqual(both.json.problems.map((p) => [p.id, p.message]), [['p3', '/people/team/ is where another move here goes too.']]);
    // one move (a new slug) onto another page's address
    const one = await ed.post('/collections/tree/entries/p3/move', { version: await v('p3'), newId: 'p3', newSlug: 'team' });
    assert.equal(one.status, 409, one.text);
    assert.equal(one.json.error, 'address-taken');
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), was);
  });

  test('the address changes only through Move: a save, a bulk set and a replace that would move a page are refused', async () => {
    const was = fx.git('rev-parse', 'HEAD').trim();
    const before = readFile(fx, 'src/content/tree/p1.json');
    const put = await ed.put('/collections/tree/entries/p1', { version: await v('p1'), changes: [{ path: 'parent', value: 'people' }] });
    assert.equal(put.status, 422, put.text);
    assert.equal(put.json.error, 'moves');
    assert.match(put.json.message, /\(\/about\/team\/ to \/people\/team\/\)\. Use Move/);
    const source = await ed.put('/collections/tree/entries/p1/source', { version: await v('p1'), source: before.replace('"about"', '"people"') });
    assert.equal(source.status, 422, source.text);
    // other fields still save
    assert.equal((await ed.put('/collections/tree/entries/p1', { version: await v('p1'), changes: [{ path: 'title', value: 'Our team' }] })).status, 200);
    const ref = [{ collection: 'tree', id: 'p1', version: await v('p1') }];
    const bulk = (await ed.post('/site/bulk/plan', { action: 'set', field: 'parent', value: 'people', entries: ref })).json.entries;
    assert.match(bulk[0].problem, /changes the page’s address/);
    const rep = await ed.post('/site/replace', { q: 'about', with: 'people', entries: ref });
    assert.deepEqual([rep.json.commit, rep.json.changed], [null, []], rep.text);
    assert.match(rep.json.skipped.map((x) => x.reason).join(), /changes the page’s address/);
    assert.equal(JSON.parse(readFile(fx, 'src/content/tree/p1.json')).parent, 'about');
    assert.equal(fx.git('log', '--format=%s', `${was}..HEAD`).trim().split('\n').length, 1, 'only the title save');
  });
});
