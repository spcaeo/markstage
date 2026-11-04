// The Library (docs/API.md "Library"): templates, sections and snippets in one store, shared ones as files in the
// site repo, personal snippets in the database; the move of the old snippets and templates; rights; pictures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, client, gitLog, makeFixture, makePng, readFile, startServer } from './helpers.mjs';

const doc = (...texts) => ({ type: 'doc', content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
const libFile = (fx, kind, id, ext = 'json') => path.join(fx.site, 'markstage/library', kind, `${id}.${ext}`);

describe('The Library', () => {
  let fx, srv, owner, editor, author, contributor;
  before(async () => {
    fx = makeFixture();
    srv = await startServer(fx);
    owner = await as(srv, 'owner');
    editor = await as(srv, 'editor');
    author = await as(srv, 'author', { authorSlug: 'ann' });
    contributor = await as(srv, 'contributor', { authorSlug: 'cid' });
  });
  after(async () => srv?.close());
  /** The same person signed in again on the server now running (a restart gets a new port). */
  const again = async (c) => {
    const n = client(srv.base);
    await n.login(c.user.email, c.user.password);
    n.user = c.user;
    return n;
  };

  test('the snippets and templates the database held move into files once, in one commit, folders and places kept', async () => {
    let db = srv.app.db;
    const at = '2026-10-01T10:00:00.000Z';
    db.prepare("DELETE FROM kv WHERE key = 'library.moved'").run();
    db.prepare('INSERT INTO snippets (id, name, doc, created_by, shared, updated_at) VALUES (?, ?, ?, ?, 1, ?)').run('sn_oldshared01', 'Sign-off', JSON.stringify({ ...doc('Thanks!'), attrs: { folder: 'Endings', order: 2 } }), editor.user.id, at);
    db.prepare('INSERT INTO snippets (id, name, doc, created_by, shared, updated_at) VALUES (?, ?, ?, ?, 0, ?)').run('sn_oldmine0001', 'My note', JSON.stringify({ ...doc('Mine'), attrs: { folder: 'Mine' } }), contributor.user.id, at);
    db.prepare('INSERT INTO templates (id, collection, name, payload, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('t_oldtemplate1', 'posts', 'Review', JSON.stringify({ frontmatter: { tags: ['review'] }, doc: doc('Verdict:') }), editor.user.id, at);
    // a new server on the same data: it moves them when it starts
    await srv.close();
    srv = await startServer(fx);
    db = srv.app.db;
    [owner, editor, author, contributor] = await Promise.all([owner, editor, author, contributor].map(again));
    const list = await editor.get('/library');
    assert.equal(list.status, 200);
    const shared = JSON.parse(fs.readFileSync(libFile(fx, 'snippet', 'sn_oldshared01'), 'utf8'));
    assert.deepEqual([shared.folder, shared.order, shared.body.doc.attrs], ['Endings', 2, undefined], 'folder and place out of the document');
    const tpl = JSON.parse(fs.readFileSync(libFile(fx, 'template', 't_oldtemplate1'), 'utf8'));
    assert.deepEqual([tpl.kind, tpl.collection, tpl.body.frontmatter.tags], ['template', 'posts', ['review']]);
    assert.equal(fs.existsSync(libFile(fx, 'snippet', 'sn_oldmine0001')), false, 'a personal snippet stays in the database');
    assert.equal(gitLog(fx, 'markstage/library')[0].split('|')[2], 'Move 2 Library items into the repo');
    const mine = db.prepare('SELECT * FROM snippets WHERE id = ?').get('sn_oldmine0001');
    assert.deepEqual([mine.folder, JSON.parse(mine.doc).attrs], ['Mine', undefined]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM templates').get().n, 0);
    // the old routes answer from the Library, with the folder back in the document as the editor reads it
    const old = (await contributor.get('/snippets')).json;
    assert.deepEqual(old.map((s) => [s.id, s.doc.attrs?.folder, s.shared]).sort(), [['sn_oldmine0001', 'Mine', false], ['sn_oldshared01', 'Endings', true]]);
    assert.deepEqual((await editor.get('/templates?collection=posts')).json.map((t) => t.id), ['t_oldtemplate1']);
    // once: another start changes nothing
    const commits = gitLog(fx, 'markstage/library').length;
    await srv.close();
    srv = await startServer(fx);
    [owner, editor, author, contributor] = await Promise.all([owner, editor, author, contributor].map(again));
    assert.equal((await editor.get('/library')).status, 200);
    assert.equal(gitLog(fx, 'markstage/library').length, commits);
  });

  test('add, change, delete: who may, versions, words, one commit each', async () => {
    const ed = editor;
    const au = author;
    const co = contributor;
    const hero = { kind: 'section', name: 'Hero with a button', folder: 'Heroes', tags: ['cta', 'top'], body: { value: { discriminant: 'hero', value: { heading: 'Move faster', button: { label: 'Book a call', href: '/contact/' } } } } };
    assert.equal((await au.post('/library', hero)).status, 403, 'sections are the site’s: editors and up');
    const made = await ed.post('/library', hero);
    assert.equal(made.status, 201);
    assert.match(made.json.id, /^lib_/);
    assert.deepEqual([made.json.sectionType, made.json.shared, made.json.synced, made.json.thumb], ['hero', true, false, null]);
    assert.equal(gitLog(fx, `markstage/library/section/${made.json.id}.json`)[0], `${editor.user.email.split('@')[0]}|${editor.user.email}|Library: add the section “Hero with a button”`);
    assert.equal((await ed.post('/library', { ...hero, body: { value: { discriminant: 'hero', href: 'javascript:alert(1)' } } })).status, 422, 'the unsafe-link guard');
    assert.equal((await ed.post('/library', { ...hero, kind: 'gadget' })).status, 422);
    // a template keeps no slug, dates or author of the entry it came from
    const tpl = await ed.post('/library', { kind: 'template', name: 'Case study', collection: 'posts', body: { frontmatter: { title: 'Case', slug: 'acme', date: '2026-01-02', author: 'ann', tags: ['case'] }, doc: doc('The problem'), _fill: ['description'] } });
    assert.equal(tpl.status, 201);
    assert.deepEqual(tpl.json.body.frontmatter, { title: 'Case', tags: ['case'] });
    assert.equal((await ed.post('/library', { kind: 'template', name: 'x', collection: 'nope', body: {} })).status, 422);
    // snippets: anyone keeps their own; a shared one may be a contributor's; a synced item is an editor's
    const mine = await co.post('/library', { kind: 'snippet', name: 'My sign-off', shared: false, body: { doc: doc('Cheers') } });
    assert.equal(mine.status, 201);
    assert.match(mine.json.id, /^sn_/);
    assert.equal((await ed.get(`/library/${mine.json.id}`)).status, 404, 'someone else’s personal snippet does not exist for you');
    assert.equal((await co.post('/library', { kind: 'snippet', name: 'Shared', body: { doc: doc('Hi') } })).status, 201);
    assert.equal((await co.post('/library', { kind: 'snippet', name: 'Synced', synced: true, body: { doc: doc('Hi') } })).status, 403);
    assert.equal((await co.post('/library', { kind: 'section', name: 'Mine', shared: false, body: { doc: doc('Hi') } })).status, 422, 'only a snippet is kept to yourself');
    // a change needs the version opened; a stale one gets the current item back
    assert.equal((await ed.patch(`/library/${made.json.id}`, { name: 'Hero' })).status, 400);
    const ch = await ed.patch(`/library/${made.json.id}`, { name: 'Hero, big button', version: made.json.version });
    assert.equal(ch.status, 200);
    const stale = await ed.patch(`/library/${made.json.id}`, { name: 'Again', version: made.json.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.current.name, 'Hero, big button');
    assert.equal((await ed.patch(`/library/${made.json.id}`, { kind: 'snippet', version: ch.json.version })).status, 400, 'an item keeps its kind');
    assert.equal((await au.patch(`/library/${made.json.id}`, { name: 'Mine now', version: ch.json.version })).status, 403);
    const one = (await ed.get(`/library/${made.json.id}`)).json;
    assert.deepEqual(one.history.map((h) => h.message), ['Library: change the section “Hero, big button”', 'Library: add the section “Hero with a button”']);
    // duplicate, then delete: only those who may change it
    const dup = await ed.post(`/library/${made.json.id}/duplicate`, {});
    assert.equal(dup.status, 201);
    assert.equal(dup.json.name, 'Hero, big button (copy)');
    assert.equal((await au.del(`/library/${dup.json.id}`)).status, 403);
    const del = await ed.del(`/library/${dup.json.id}`);
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(libFile(fx, 'section', dup.json.id)), false);
    assert.equal(gitLog(fx, `markstage/library/section/${dup.json.id}.json`)[0].split('|')[2], 'Library: delete the section “Hero, big button (copy)”');
    const audit = srv.app.db.prepare("SELECT action FROM audit WHERE action LIKE 'library.%' ORDER BY rowid").all().map((r) => r.action);
    for (const a of ['library.create', 'library.update', 'library.duplicate', 'library.delete']) assert.ok(audit.includes(a), a);
  });

  test('sharing a personal snippet moves it into the repo with its id; only its maker takes it back', async () => {
    const co = contributor;
    const ed = editor;
    const mine = (await co.post('/library', { kind: 'snippet', name: 'Mine to share', shared: false, body: { doc: doc('Hello') } })).json;
    const shared = await co.patch(`/library/${mine.id}`, { shared: true, version: mine.version });
    assert.equal(shared.status, 200);
    assert.equal(shared.json.id, mine.id);
    assert.ok(fs.existsSync(libFile(fx, 'snippet', mine.id)));
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM snippets WHERE id = ?').get(mine.id).n, 0);
    assert.equal((await ed.get(`/library/${mine.id}`)).status, 200, 'everyone sees it now');
    assert.equal((await ed.patch(`/library/${mine.id}`, { shared: false, version: shared.json.version })).status, 403);
    const back = await co.patch(`/library/${mine.id}`, { shared: false, version: shared.json.version });
    assert.equal(back.status, 200);
    assert.equal(back.json.shared, false);
    assert.equal(fs.existsSync(libFile(fx, 'snippet', mine.id)), false);
    assert.equal((await ed.get(`/library/${mine.id}`)).status, 404);
  });

  test('the list: facets, filters, words, sorting and pages', async () => {
    const ed = editor;
    for (const [name, folder, tags] of [['Pricing table', 'Pricing', ['money']], ['Pricing FAQ', 'Pricing', ['money', 'faq']], ['Team grid', '', ['people']]]) {
      assert.equal((await ed.post('/library', { kind: 'section', name, folder, tags, body: { value: { discriminant: 'grid', value: { title: name } } } })).status, 201);
    }
    const all = (await ed.get('/library?kind=section')).json;
    assert.equal(all.facets.kinds.section, all.total);
    assert.ok(all.facets.kinds.template >= 1 && all.facets.kinds.snippet >= 1);
    assert.deepEqual(all.facets.folders.find((f) => f.name === 'Pricing'), { name: 'Pricing', count: 2 });
    assert.deepEqual(all.facets.tags.find((t) => t.name === 'money'), { name: 'money', count: 2 });
    assert.deepEqual((await ed.get('/library?kind=section&folder=Pricing')).json.items.map((i) => i.name), ['Pricing FAQ', 'Pricing table']);
    assert.deepEqual((await ed.get('/library?tag=faq')).json.items.map((i) => i.name), ['Pricing FAQ']);
    assert.deepEqual((await ed.get('/library?q=team')).json.items.map((i) => i.name), ['Team grid']);
    assert.deepEqual((await ed.get('/library?kind=template&collection=posts')).json.items.every((i) => i.collection === 'posts'), true);
    const sorted = (await ed.get('/library?kind=section&sort=-name&perPage=2&page=1')).json;
    assert.deepEqual([sorted.items.length, sorted.perPage, sorted.items[0].name >= sorted.items[1].name], [2, 2, true]);
    assert.equal((await ed.get('/library?sort=sideways')).status, 400);
    assert.equal((await ed.get('/library?kind=gadget')).status, 400);
  });

  test('a picture: PNG only, at most 200 KB, kept beside the item (or in the data dir for a personal one)', async () => {
    const ed = editor;
    const co = contributor;
    const it = (await ed.post('/library', { kind: 'snippet', name: 'With a picture', body: { doc: doc('Pic') } })).json;
    const png = makePng();
    assert.equal((await ed.request('PUT', `/library/${it.id}/thumb`, { body: Buffer.from('not a png'), headers: { 'Content-Type': 'image/png' } })).status, 415);
    assert.equal((await ed.request('PUT', `/library/${it.id}/thumb`, { body: Buffer.alloc(201 * 1024), headers: { 'Content-Type': 'image/png' } })).status, 413);
    assert.equal((await ed.request('PUT', `/library/${it.id}/thumb`, { body: png, headers: { 'Content-Type': 'image/jpeg' } })).status, 400);
    const set = await ed.request('PUT', `/library/${it.id}/thumb`, { body: png, headers: { 'Content-Type': 'image/png' } });
    assert.equal(set.status, 200);
    assert.match(set.json.thumb, new RegExp(`^/markstage/api/library/${it.id}/thumb\\?v=[0-9a-f]{12}$`));
    assert.deepEqual(fs.readFileSync(libFile(fx, 'snippet', it.id, 'png')), png);
    const got = await ed.get(`/library/${it.id}/thumb`, { raw: true });
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await got.res.arrayBuffer()), png);
    assert.equal((await author.request('PUT', `/library/${it.id}/thumb`, { body: png, headers: { 'Content-Type': 'image/png' } })).status, 403);
    assert.equal((await ed.del(`/library/${it.id}/thumb`)).json.thumb, null);
    // a personal snippet's picture never reaches the repo
    const mine = (await co.post('/library', { kind: 'snippet', name: 'Mine', shared: false, body: { doc: doc('x') } })).json;
    assert.equal((await co.request('PUT', `/library/${mine.id}/thumb`, { body: png, headers: { 'Content-Type': 'image/png' } })).status, 200);
    assert.ok(fs.existsSync(path.join(fx.data, 'library-thumbs', `${mine.id}.png`)));
    assert.equal(fs.existsSync(libFile(fx, 'snippet', mine.id, 'png')), false);
  });

  test('a new entry from a Library template: its frontmatter and blocks, not the fill list, never another slug', async () => {
    const ed = editor;
    const tpl = (await ed.post('/library', { kind: 'template', name: 'Review', collection: 'posts', body: { frontmatter: { tags: ['review'], slug: 'not-this' }, doc: doc('Verdict:'), _fill: ['description'] } })).json;
    const made = await author.post('/collections/posts/entries', { title: 'My Review', template: tpl.id });
    assert.equal(made.status, 201);
    assert.deepEqual(made.json.frontmatter.tags, ['review']);
    const text = readFile(fx, 'src/content/blog/my-review.md');
    assert.ok(text.endsWith('Verdict:\n'));
    assert.doesNotMatch(text, /_fill|not-this/);
    assert.equal((await author.post('/collections/pages/entries', { title: 'Nope', template: tpl.id })).status, 404, 'a template is for its own collection');
  });

  test('a template kept from a page keeps no address, place or canonical, so a page made from it never lands on that address', async () => {
    const pages = srv.app.store.collection('pages');
    const was = pages.fields.url;
    pages.fields.url = 'uri';
    try {
      const data = { title: 'Pricing', uri: '/pricing/', order: 4, seo: { title: 'Pricing', canonical: 'https://example.test/pricing/' }, sections: [{ discriminant: 'hero', value: { heading: 'Plans' } }] };
      const tpl = await editor.post('/library', { kind: 'template', name: 'Pricing page', collection: 'pages', body: { data } });
      assert.equal(tpl.status, 201, tpl.text);
      assert.deepEqual(tpl.json.body.data, { title: 'Pricing', seo: { title: 'Pricing' }, sections: data.sections });
      // one kept before the server took them out (written by hand) still starts clean
      const rel = `markstage/library/template/${tpl.json.id}.json`;
      const file = JSON.parse(readFile(fx, rel));
      file.body.data = data;
      fs.writeFileSync(path.join(fx.site, rel), `${JSON.stringify(file, null, 2)}\n`);
      assert.deepEqual(srv.app.library.templateFor(editor.user, tpl.json.id, pages).data, { title: 'Pricing', seo: { title: 'Pricing' }, sections: data.sections });
    } finally {
      pages.fields.url = was;
    }
  });
});
