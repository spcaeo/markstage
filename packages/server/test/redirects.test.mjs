// Redirects (docs/OPERATIONS.md "Redirects"): the list with loops, chains, redirects that never run and targets that
// are not pages flagged; add, change and remove through the site's hook, each one commit, built and deployed (a failed
// build puts the file back); moves never make chains or loops; a hook that only adds still records moves; and a test
// that asks the live site hop by hop. The "live site" is a local server on a free port.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { checkRedirects, keyOf } from '../src/redirects/check.mjs';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';
import { localeServer } from './locale-site.mjs';

const kinds = (r) => r.flags.map((f) => f.kind);

test('the checks: loops, chains, duplicates, pages at the old address, targets that are not pages', () => {
  const origin = 'https://example.com';
  const built = (p) => ({ '/blog/live': 'page', '/home': 'page', '/x': 'redirect' })[p] ?? null;
  const rows = checkRedirects(
    [
      { from: '/a/', to: '/b/' },
      { from: '/b', to: 'https://example.com/c/?utm=1' },
      { from: '/c/', to: '/home/' },
      { from: '/self/', to: '/self' },
      { from: '/l1/', to: '/l2/' },
      { from: '/l2/', to: '/l1/' },
      { from: '/blog/live/', to: '/home/' },
      { from: '/old/', to: '/nowhere/' },
      { from: '/away/', to: 'https://other.example/x' },
      { from: '/b/', to: '/home/' },
      { from: '/bad/', to: 'javascript:alert(1)' },
    ],
    { origin, built, pages: new Set(['/entry/']) },
  );
  const by = Object.fromEntries(rows.map((r) => [r.from + (r.to === '/home/' && r.from === '/b/' ? '#2' : ''), r]));
  assert.deepEqual(kinds(by['/a/']), ['chain']);
  assert.equal(by['/a/'].flags[0].fix, '/home/');
  assert.equal(by['/a/'].flags[0].text, 'A chain: /a/ → /b/ → https://example.com/c/?utm=1 → /home/. Point it at /home/ instead.');
  assert.deepEqual(kinds(by['/b']), ['chain']);
  assert.deepEqual(kinds(by['/c/']), []);
  assert.deepEqual(kinds(by['/self/']), ['loop']);
  assert.deepEqual(kinds(by['/l1/']), ['loop']);
  assert.match(by['/l1/'].flags[0].text, /^A loop: \/l1\/ → \/l2\/ → \/l1\/\. Visitors get an error\.$/);
  assert.deepEqual(kinds(by['/blog/live/']), ['shadowed']);
  assert.deepEqual(kinds(by['/old/']), ['missing']);
  assert.deepEqual(kinds(by['/away/']), [], 'another site ends the trail and is not checked');
  assert.deepEqual(kinds(by['/b/#2']), ['duplicate']);
  assert.deepEqual(kinds(by['/bad/']), ['bad']);
  // a live entry's page counts even before a build; no build: no "missing"
  assert.deepEqual(kinds(checkRedirects([{ from: '/entry', to: '/nowhere/' }], { origin, pages: new Set(['/entry/']) })[0]), ['shadowed']);
  assert.equal(keyOf('https://other.example/a', origin), null);
  assert.equal(keyOf('//evil.example/a', origin), null);
  assert.equal(keyOf('/a/b?x#y', origin), '/a/b/');
});

describe('redirects on a site', () => {
  let fx, srv, ed, author, live;
  const hits = [];
  const runJob = async (r, status = 'succeeded') => {
    assert.ok([200, 202].includes(r.status), r.text);
    assert.ok(r.json.job, 'a job');
    await srv.app.jobs.idle();
    const job = (await ed.get(`/jobs/${r.json.job}`)).json;
    assert.equal(job.status, status, job.log);
    return job;
  };
  const list = async () => (await ed.get('/site/redirects')).json;
  const map = () => JSON.parse(readFile(fx, 'src/data/redirects.json'));

  before(async () => {
    // the live site: answers the way a host does (HTTP redirects, meta-refresh pages, 404s)
    live = http.createServer((req, res) => {
      hits.push(req.url);
      const go = (code, to) => res.writeHead(code, { location: to }).end();
      if (req.url === '/old-page/') return go(301, '/blog/hello-world/');
      if (req.url === '/blog/hello-world/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Hello</title>');
      if (req.url === '/loop1/') return go(302, '/loop2/');
      if (req.url === '/loop2/') return go(302, '/loop1/');
      if (req.url === '/stub/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<meta http-equiv="refresh" content="0;url=/blog/hello-world/">');
      if (req.url === '/away/') return go(301, 'https://elsewhere.example/');
      res.writeHead(404).end();
    });
    await new Promise((r) => live.listen(0, '127.0.0.1', r));
    ({ fx, srv } = await localeServer({ commands: { build: [process.execPath, 'scripts/build-locales.mjs'] }, verify: { public: 'dist' } }, { siteUrl: `http://127.0.0.1:${live.address().port}` }));
    ed = await as(srv, 'editor');
    author = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(async () => {
    await srv.close();
    await new Promise((r) => live.close(r));
  });

  test('editors and above only; an empty list to start with', async () => {
    assert.equal((await author.get('/site/redirects')).status, 403);
    assert.equal((await author.post('/site/redirects', { from: '/x/', to: '/' })).status, 403);
    assert.equal((await author.post('/site/redirects/test', { from: '/x/' })).status, 403);
    const l = await list();
    assert.deepEqual([l.on, l.canList, l.redirects], [true, true, []]);
  });

  test('moves: a redirect per locale, and moving again repoints the older ones (no chain); moving back removes them (no loop)', async () => {
    const move = async (id, newId) => {
      const e = await ed.get(`/collections/posts/entries/${id}`);
      const r = await ed.post(`/collections/posts/entries/${id}/move`, { version: e.json.version, newId });
      await runJob(r);
      return r.json;
    };
    await move('hello-world', 'hello-there');
    const second = await move('hello-there', 'hello-again');
    assert.deepEqual(second.repointed, [{ from: '/blog/hello-world/', to: '/blog/hello-again/' }, { from: '/en-us/blog/hello-world/', to: '/en-us/blog/hello-again/' }]);
    let l = await list();
    assert.equal(l.redirects.length, 4);
    assert.deepEqual(l.redirects.flatMap(kinds), [], 'no chains, and every target is a page in the build');
    assert.equal(map()['/blog/hello-world/'], '/blog/hello-again/');
    await move('hello-again', 'hello-world');
    l = await list();
    assert.deepEqual(Object.keys(map()).sort(), ['/blog/hello-again/', '/blog/hello-there/', '/en-us/blog/hello-again/', '/en-us/blog/hello-there/'], 'the redirects away from /blog/hello-world/ went: a page is there again');
    assert.ok(l.redirects.every((r) => r.to.endsWith('/blog/hello-world/') && !r.flags.length));
  });

  test('add: one commit, built and checked, audited; a chain is flagged with its fix', async () => {
    const was = fx.git('rev-parse', 'HEAD').trim();
    const r = await ed.post('/site/redirects', { from: '/old-page/', to: '/blog/hello-world/' });
    assert.equal(r.status, 202, r.text);
    const job = await runJob(r);
    assert.deepEqual(job.steps.map((s) => s.name), ['commit', 'build', 'verify', 'deploy']);
    assert.match(job.log, /ok redirect \/old-page\/: moved at \/old-page\//);
    assert.equal(fx.git('rev-parse', 'HEAD~1').trim(), was, 'one commit');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Redirect /old-page/ to /blog/hello-world/');
    assert.match(readFile(fx, 'dist/old-page/index.html'), /url=\/blog\/hello-world\//, 'the build made it');
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'redirects.add'").get().n, 1);

    const c = await ed.post('/site/redirects', { from: '/older/', to: '/old-page/' });
    await runJob(c);
    assert.deepEqual(kinds(c.json.redirect), ['chain']);
    assert.equal(c.json.redirect.flags[0].fix, '/blog/hello-world/');
    const row = (await list()).redirects.find((x) => x.from === '/older/');
    assert.deepEqual(kinds(row), ['chain']);
  });

  test('refused: a loop, a page at the old address, the same address, and what is not an address', async () => {
    await runJob(await ed.post('/site/redirects', { from: '/a/', to: '/older/' }));
    const back = await ed.post('/site/redirects', { from: '/old-page/', to: '/a/' });
    assert.equal(back.status, 422);
    assert.equal(back.json.fields.to, 'That makes a loop: /old-page/ → /a/ → /older/ → /old-page/.');
    const page = await ed.post('/site/redirects', { from: '/blog/linker/', to: '/' });
    assert.equal(page.status, 422);
    assert.match(page.json.fields.from, /A page is at \/blog\/linker\//);
    assert.match((await ed.post('/site/redirects', { from: '/q/', to: '/q' })).json.fields.to, /same address/);
    const bad = await ed.post('/site/redirects', { from: 'no-slash', to: 'javascript:alert(1)' });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.json.fields).sort(), ['from', 'to']);
    assert.match((await ed.post('/site/redirects', { from: '/x/?a=1', to: '/' })).json.fields.from, /path only/);
    assert.match((await ed.post('/site/redirects', { from: '//evil.example/x', to: '/' })).json.fields.from, /one \//);
    assert.equal(fx.git('status', '--porcelain').trim(), '', 'nothing written');
  });

  test('change one (its old address too), then remove some', async () => {
    const r = await ed.post('/site/redirects', { from: '/a2/', to: '/blog/hello-world/', was: '/a/' });
    await runJob(r);
    assert.equal(map()['/a/'], undefined);
    assert.equal(map()['/a2/'], '/blog/hello-world/');
    const rm = await ed.post('/site/redirects/remove', { from: ['/a2/', '/older/'] });
    await runJob(rm);
    assert.equal(rm.json.removed, 2);
    assert.deepEqual([map()['/a2/'], map()['/older/']], [undefined, undefined]);
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Remove 2 redirects');
    assert.equal((await ed.post('/site/redirects/remove', { from: [] })).status, 400);
  });

  test('a failed build puts the redirects file back', async () => {
    const before = readFile(fx, 'src/data/redirects.json');
    fs.writeFileSync(`${fx.failMarker}.deploy`, '');
    try {
      const job = await runJob(await ed.post('/site/redirects', { from: '/doomed/', to: '/' }), 'failed');
      assert.ok(job.steps.some((s) => s.name === 'revert'));
    } finally {
      fs.unlinkSync(`${fx.failMarker}.deploy`);
    }
    assert.equal(readFile(fx, 'src/data/redirects.json'), before);
    assert.match(fx.git('log', '-1', '--format=%s').trim(), /^Revert redirect \/doomed\/ to \/: build or deploy failed$/);
  });

  test('test: what the build has, and hop by hop through that build (never the live site, QA F7)', async () => {
    const t = async (from) => {
      const r = await ed.post('/site/redirects/test', { from });
      assert.equal(r.status, 200, r.text);
      return r.json;
    };
    // more redirect pages in the build, as a host would have them: a plain one, a loop, one away to another site
    const stub = (from, to) => {
      fs.mkdirSync(path.join(fx.site, 'dist', from), { recursive: true });
      fs.writeFileSync(path.join(fx.site, 'dist', from, 'index.html'), `<meta http-equiv="refresh" content="0;url=${to}">`);
    };
    stub('stub', '/blog/hello-world/');
    stub('loop1', '/loop2/');
    stub('loop2', '/loop1/');
    stub('away', 'https://elsewhere.example/');
    const ok = await t('/old-page/');
    assert.deepEqual(ok.build, { kind: 'redirect', to: '/blog/hello-world/' });
    assert.deepEqual(ok.live.hops.map((h) => [h.url, h.status, h.location]), [['/old-page/', 200, '/blog/hello-world/'], ['/blog/hello-world/', 200, null]]);
    assert.equal(hits.length, 0, 'the site itself is never asked');
    assert.equal(ok.live.verdict, 'ok');
    assert.equal((await t('/stub/')).live.hops[0].via, 'page', 'a meta-refresh page counts as a hop');
    assert.equal((await t('/loop1/')).live.verdict, 'loop');
    const away = (await t('/away/')).live;
    assert.equal(away.verdict, 'away');
    assert.equal(hits.filter((h) => h.includes('elsewhere')).length, 0, 'another site is named, never asked');
    assert.equal((await t('/blog/hello-world/')).live.verdict, 'page');
    assert.deepEqual([(await t('/gone/')).live.verdict, (await t('/gone/')).build.kind], ['error', null]);
    assert.equal((await ed.post('/site/redirects/test', { from: 'https://elsewhere.example/' })).status, 422);
  });

  test('a hook that only adds: the screen says it cannot list; moves still record; a remove fails cleanly', async () => {
    fs.writeFileSync(path.join(fx.site, '.hook-adds-only'), '');
    try {
      const l = await list();
      assert.equal(l.canList, false);
      assert.match(l.message, /cannot list its redirects yet/);
      const e = await ed.get('/collections/posts/entries/linker');
      const m = await ed.post('/collections/posts/entries/linker/move', { version: e.json.version, newId: 'linker-two' });
      await runJob(m);
      assert.equal(map()['/blog/linker/'], '/blog/linker-two/');
      const rm = await ed.post('/site/redirects/remove', { from: ['/old-page/'] });
      assert.equal(rm.status, 502);
      assert.match(rm.json.message, /unknown input/);
      assert.equal(fx.git('status', '--porcelain').trim(), '');
    } finally {
      fs.unlinkSync(path.join(fx.site, '.hook-adds-only'));
    }
  });

  test('an address with accents or other letters is refused in plain words before the hook runs (QA pass 2, N5)', async () => {
    for (const from of ['/café/', '/🚀/']) {
      const r = await ed.post('/site/redirects', { from, to: '/blog/hello-world/' });
      assert.equal(r.status, 422, from);
      assert.match(r.json.fields.from, /encoded form, like \/caf%C3%A9\//);
      assert.doesNotMatch(r.json.fields.from, /[{}"]/, 'no JSON in the words');
    }
    assert.equal((await ed.post('/site/redirects', { from: '/plain/', to: '/café/' })).status, 422);
  });

  test('live tests are limited per person', async () => {
    let last;
    for (let i = 0; i < 40 && last !== 429; i++) last = (await ed.post('/site/redirects/test', { from: '/gone/' })).status;
    assert.equal(last, 429);
  });
});

test('a site without a redirects hook: the list says so, changes are refused plainly', async () => {
  const srv = await startServer(makeFixture({ checks: false }));
  try {
    const ed = await as(srv, 'editor');
    assert.deepEqual((await ed.get('/site/redirects')).json, { on: false, canList: false, message: null, siteUrl: null, redirects: [] });
    const r = await ed.post('/site/redirects', { from: '/x/', to: '/' });
    assert.equal(r.status, 409);
    assert.match(r.json.message, /no redirects hook/);
  } finally {
    await srv.close();
  }
});
