// Pages whose address is a field of their own (uri): a move by `parent` gives the page an address under another
// page, and every page under it follows; one commit, a redirect for each page in each locale, links rewritten. The
// home page stays, a page never goes under itself, a page other entries live under waits for them, and the list
// says each page's parent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, readFile } from './helpers.mjs';
import { localeServer } from './locale-site.mjs';

describe('move many: a page and the pages under it, by parent', () => {
  let fx, srv, ed;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const v = async (id) => (await ed.get(`/collections/pages/entries/${id}`)).json.version;
  const uri = (id) => JSON.parse(readFile(fx, `src/content/pages/${id}.json`)).uri;
  const move = async (id, parent, extra = {}, body = {}) => ed.post('/site/move', { moves: [{ collection: 'pages', id, version: await v(id), parent, ...extra }], ...body });
  const problems = (r) => r.json.problems.map((p) => [p.id, p.message]);
  before(async () => {
    // the fixture's own node build script (every locale copy, a redirect page per old address), verified after it
    ({ fx, srv } = await localeServer({ commands: { build: [process.execPath, 'scripts/build-locales.mjs'] }, verify: { public: 'dist', private: 'dist-private' } }));
    const pages = [
      ['home', 'Home', '/'],
      ['about', 'About', '/about/'],
      ['team', 'Team', '/about/team/'],
      ['history', 'History', '/about/team/history/'],
      ['company', 'Company', '/company/'],
      ['blog', 'Blog', '/blog/'],
    ];
    for (const [id, title, u] of pages) fs.writeFileSync(path.join(fx.site, `src/content/pages/${id}.json`), JSON.stringify({ title, uri: u }, null, 2) + '\n');
    // a page that links to one under /about/
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/contact.json'), JSON.stringify({ title: 'Contact', uri: '/contact/', cta: { href: '/about/team/history/' } }, null, 2) + '\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A page tree');
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('the list says each page’s parent: the longest page address it starts with, never the home page', async () => {
    const r = await ed.get('/collections/pages/entries?perPage=100');
    assert.equal(r.status, 200, r.text);
    const parents = Object.fromEntries(r.json.items.map((e) => [e.id, e.parent]));
    assert.deepEqual(parents, { about: null, blog: null, company: null, contact: null, history: 'team', home: null, links: null, team: 'about' });
  });

  test('the home page, a page under itself or under a page below it, and a missing parent are refused; nothing written', async () => {
    const was = head();
    assert.deepEqual(problems(await move('home', 'about')), [['home', 'The home page stays where it is.']]);
    assert.deepEqual(problems(await move('about', 'about')), [['about', 'A page cannot go under itself or a page under it.']]);
    assert.deepEqual(problems(await move('about', 'history')), [['about', 'A page cannot go under itself or a page under it.']]);
    assert.deepEqual(problems(await move('about', 'nope')), [['about', 'There is no page “nope” to move it under.']]);
    assert.deepEqual(problems(await move('about', 7)), [['about', 'Say the page to move it under (its id), or "" for the top level.']]);
    const posts = await ed.post('/site/move', { moves: [{ collection: 'posts', id: 'linker', version: (await ed.get('/collections/posts/entries/linker')).json.version, parent: '' }] });
    assert.deepEqual(problems(posts), [['linker', 'Pages of this collection get their address from their name: move them by name.']]);
    assert.equal(head(), was);
  });

  test('a page other entries live under is not moved until they are, by parent or by a new address', async () => {
    const was = head();
    const r = await move('blog', 'company');
    assert.equal(r.status, 422, r.text);
    assert.deepEqual(problems(r), [['blog', '5 posts live under /blog/; move them first.']]);
    const set = await ed.post('/site/move', { moves: [{ collection: 'pages', id: 'blog', version: await v('blog'), newId: 'news' }] });
    assert.equal(set.status, 202, 'a new name alone leaves its address where it is');
    assert.deepEqual(set.json.moved.map((m) => [m.from, m.id, m.url]), [['blog', 'news', '/blog/']]);
    await srv.app.jobs.idle();
    const back = await ed.post('/site/move', { moves: [{ collection: 'pages', id: 'news', version: await v('news'), newId: 'blog' }] });
    assert.equal(back.status, 202, back.text);
    await srv.app.jobs.idle();
    assert.equal(fx.git('rev-list', '--count', `${was}..HEAD`).trim(), '2');
  });

  test('an entry renamed out from under a page that lives under it is refused (any collection)', async () => {
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/more.json'), JSON.stringify({ title: 'More', uri: '/blog/hello-world/more/' }, null, 2) + '\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A page under a post');
    const was = head();
    const pv = (await ed.get('/collections/posts/entries/hello-world')).json.version;
    const r = await ed.post('/site/move', { moves: [{ collection: 'posts', id: 'hello-world', version: pv, newId: 'hello-there' }] });
    assert.equal(r.status, 422, r.text);
    assert.deepEqual(problems(r), [['hello-world', '1 page lives under /blog/hello-world/; move it first.']]);
    assert.equal(head(), was);
    fx.git('rm', '-q', 'src/content/pages/more.json');
    fx.git('commit', '-q', '-m', 'No page under a post');
  });

  test('a page listed with the page it is under is refused: it moves with it', async () => {
    const r = await ed.post('/site/move', { moves: [
      { collection: 'pages', id: 'about', version: await v('about'), parent: 'company' },
      { collection: 'pages', id: 'team', version: await v('team'), set: { order: 2 } },
    ] });
    assert.equal(r.status, 422, r.text);
    assert.deepEqual(problems(r), [['team', 'It moves with “about”, the page it is under: leave it out.']]);
    const both = await ed.post('/site/move', { moves: [
      { collection: 'pages', id: 'about', version: await v('about'), parent: 'company' },
      { collection: 'pages', id: 'company', version: await v('company'), parent: 'contact' },
    ] });
    assert.deepEqual(problems(both), [['about', '“company” moves too: move them one after the other.']]);
  });

  test('an address sent by the browser is never taken; uri cannot be set', async () => {
    const r = await ed.post('/site/move', { moves: [{ collection: 'pages', id: 'company', version: await v('company'), set: { uri: '/x/' } }] });
    assert.deepEqual(problems(r), [['company', '“uri” cannot be set here.']]);
    const sneak = await ed.post('/site/move', { moves: [{ collection: 'pages', id: 'company', version: await v('company'), _uri: '/x/', set: { order: 1 } }] });
    assert.equal(sneak.status, 202, sneak.text);
    assert.deepEqual(sneak.json.moved.map((m) => [m.oldUrl, m.url]), [['/company/', '/company/']]);
    assert.equal(uri('company'), '/company/');
    await srv.app.jobs.idle();
  });

  test('a dry run says every page that moves, old and new address, the redirects and the links rewritten; nothing written', async () => {
    const was = head();
    const r = await move('about', 'company', { set: { order: 3 } }, { dry: true });
    // dry is said of the request, never of one move: a key a move does not know is refused, not left out
    assert.deepEqual(problems(await move('about', 'company', { dry: true })), [['about', '“dry” is not part of a move.']]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, {
      dry: true,
      moved: [
        { collection: 'pages', id: 'about', from: 'about', oldUrl: '/about/', url: '/company/about/' },
        { collection: 'pages', id: 'team', from: 'team', oldUrl: '/about/team/', url: '/company/about/team/' },
        { collection: 'pages', id: 'history', from: 'history', oldUrl: '/about/team/history/', url: '/company/about/team/history/' },
      ],
      linksUpdated: [{ collection: 'pages', id: 'contact' }],
      links: 1,
      redirects: [
        { from: '/about/', to: '/company/about/' }, { from: '/en-us/about/', to: '/en-us/company/about/' },
        { from: '/about/team/', to: '/company/about/team/' }, { from: '/en-us/about/team/', to: '/en-us/company/about/team/' },
        { from: '/about/team/history/', to: '/company/about/team/history/' }, { from: '/en-us/about/team/history/', to: '/en-us/company/about/team/history/' },
      ],
    });
    // refused the same way as the move itself
    assert.deepEqual(problems(await move('home', 'about', {}, { dry: true })), [['home', 'The home page stays where it is.']]);
    assert.equal(head(), was);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
    assert.equal(uri('about'), '/about/');
  });

  test('a page moved under another: it and every page under it, one commit, a redirect for each, links follow', async () => {
    const was = head();
    const r = await move('about', 'company', { set: { order: 3 } });
    assert.equal(r.status, 202, r.text);
    assert.deepEqual(r.json.moved.map((m) => [m.id, m.oldUrl, m.url]), [
      ['about', '/about/', '/company/about/'],
      ['team', '/about/team/', '/company/about/team/'],
      ['history', '/about/team/history/', '/company/about/team/history/'],
    ]);
    assert.deepEqual(r.json.redirects, [
      { from: '/about/', to: '/company/about/' }, { from: '/en-us/about/', to: '/en-us/company/about/' },
      { from: '/about/team/', to: '/company/about/team/' }, { from: '/en-us/about/team/', to: '/en-us/company/about/team/' },
      { from: '/about/team/history/', to: '/company/about/team/history/' }, { from: '/en-us/about/team/history/', to: '/en-us/company/about/team/history/' },
    ], 'one per page per locale; no prefix rule');
    assert.deepEqual(r.json.linksUpdated, [{ collection: 'pages', id: 'contact' }]);
    await srv.app.jobs.idle();
    assert.equal((await ed.get(`/jobs/${r.json.job}`)).json.status, 'succeeded');
    assert.equal(fx.git('rev-parse', 'HEAD~1').trim(), was, 'one commit');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Move 3 entries');
    assert.deepEqual(JSON.parse(readFile(fx, 'src/content/pages/about.json')), { title: 'About', uri: '/company/about/', order: 3 });
    assert.equal(uri('team'), '/company/about/team/');
    assert.equal(uri('history'), '/company/about/team/history/');
    assert.equal(JSON.parse(readFile(fx, 'src/content/pages/contact.json')).cta.href, '/company/about/team/history/');
    assert.equal(fx.git('status', '--porcelain').trim(), '');
    const parents = Object.fromEntries((await ed.get('/collections/pages/entries?perPage=100')).json.items.map((e) => [e.id, e.parent]));
    assert.deepEqual([parents.about, parents.team, parents.history], ['company', 'about', 'team']);
    // the site's build (the fixture's own node build script, not astro): the pages at their new addresses in both
    // locales, and a redirect page at each old one
    const dist = (p) => readFile(fx, `dist${p}index.html`);
    for (const pre of ['', '/en-us']) {
      for (const [from, to] of [['/about/', '/company/about/'], ['/about/team/', '/company/about/team/'], ['/about/team/history/', '/company/about/team/history/']]) {
        assert.match(dist(pre + to), /<title>/, `${pre}${to} is built`);
        if (!pre) assert.equal(dist(from), `<meta http-equiv="refresh" content="0;url=${to}">`);
      }
    }
  });

  test('back to the top level with ""; a page that would land on another page’s address is refused', async () => {
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/team-2.json'), JSON.stringify({ title: 'Other team', uri: '/team/' }, null, 2) + '\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Another team');
    const taken = await move('team', '');
    assert.deepEqual(problems(taken), [['team', '/team/ is the address of another page already (pages/team-2).']]);
    const r = await move('about', '');
    assert.equal(r.status, 202, r.text);
    assert.deepEqual(r.json.moved.map((m) => m.url), ['/about/', '/about/team/', '/about/team/history/']);
    await srv.app.jobs.idle();
    const map = JSON.parse(readFile(fx, 'src/data/redirects.json'));
    assert.equal(map['/company/about/team/'], '/about/team/');
    // an old address a page comes back to is no clash: its redirect goes (the page has the address again)
    for (const back of ['/about/', '/about/team/', '/about/team/history/', '/en-us/about/team/']) assert.equal(map[back], undefined, back);
    assert.match(readFile(fx, 'dist/about/team/index.html'), /<title>Team<\/title>/);
  });
});
