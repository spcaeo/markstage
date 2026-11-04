// Move (rename) an entry, on a two-locale site (root and /en-us/): one commit renames the file, rewrites every link
// to it (every locale, path or absolute URL, surgical) and records a redirect per locale through the site's hook;
// a live entry is rebuilt, and a failed build puts everything back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, readFile } from './helpers.mjs';
import { LINKER, LINKS_PAGE, localeServer } from './locale-site.mjs';

describe('move', () => {
  let fx, srv, ed, alice, carl;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  before(async () => {
    ({ fx, srv } = await localeServer());
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    carl = await as(srv, 'contributor', { authorSlug: 'bob' });
  });
  after(() => srv.close());

  test('a live post: renamed, every link in every locale rewritten surgically, a redirect per locale, one commit, rebuilt', async () => {
    const e = await ed.get('/collections/posts/entries/hello-world');
    const was = head();
    const r = await ed.post('/collections/posts/entries/hello-world/move', { version: e.json.version, newId: 'hello-there' });
    assert.equal(r.status, 202, JSON.stringify(r.json));
    assert.equal(r.json.id, 'hello-there');
    assert.equal(r.json.oldUrl, '/blog/hello-world/');
    assert.equal(r.json.url, '/blog/hello-there/');
    assert.deepEqual(r.json.linksUpdated, [{ collection: 'posts', id: 'linker' }, { collection: 'pages', id: 'links' }]);
    assert.deepEqual(r.json.redirects, [{ from: '/blog/hello-world/', to: '/blog/hello-there/' }, { from: '/en-us/blog/hello-world/', to: '/en-us/blog/hello-there/' }]);
    await srv.app.jobs.idle();
    assert.equal((await ed.get(`/jobs/${r.json.job}`)).json.status, 'succeeded');

    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/hello-world.md')));
    assert.match(readFile(fx, 'src/content/blog/hello-there.md'), /^---\ntitle: Hello World\n/);
    // only the link targets changed, byte for byte; the visible text and other paragraphs did not
    assert.equal(
      readFile(fx, 'src/content/blog/linker.md'),
      LINKER.replace('related: https://example.com/en-us/blog/hello-world/', 'related: https://example.com/en-us/blog/hello-there/')
        .replace('(/blog/hello-world/)', '(/blog/hello-there/)')
        .replace('(https://example.com/en-us/blog/hello-world/#top)', '(https://example.com/en-us/blog/hello-there/#top)'),
    );
    assert.equal(
      readFile(fx, 'src/content/pages/links.json'),
      LINKS_PAGE.replace('"href": "/blog/hello-world"', '"href": "/blog/hello-there"').replace('/en-us/blog/hello-world/?a=1', '/en-us/blog/hello-there/?a=1'),
    );
    assert.deepEqual(JSON.parse(readFile(fx, 'src/data/redirects.json')), { '/blog/hello-world/': '/blog/hello-there/', '/en-us/blog/hello-world/': '/en-us/blog/hello-there/' });
    // one commit with all of it, then nothing else
    const files = fx.git('show', '--no-renames', '--name-only', '--format=', head()).trim().split('\n').sort();
    assert.equal(fx.git('rev-parse', 'HEAD~1').trim(), was);
    assert.deepEqual(files, ['src/content/blog/hello-there.md', 'src/content/blog/hello-world.md', 'src/content/blog/linker.md', 'src/content/pages/links.json', 'src/data/redirects.json']);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
  });

  test('409 when the new name is taken; 422 for a bad name; stale version 409', async () => {
    const e = await ed.get('/collections/posts/entries/with-html');
    const taken = await ed.post('/collections/posts/entries/with-html/move', { version: e.json.version, newId: 'linker' });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.error, 'id-taken');
    assert.equal((await ed.post('/collections/posts/entries/with-html/move', { version: e.json.version, newId: 'Bad Name' })).status, 422);
    assert.equal((await ed.post('/collections/posts/entries/with-html/move', { version: 'stale', newId: 'fine-name' })).status, 409);
  });

  test('rights: a live entry needs the publish right; a contributor may move their own draft (no job)', async () => {
    const live = await carl.get('/collections/posts/entries/linker');
    assert.equal((await carl.post('/collections/posts/entries/linker/move', { version: live.json.version, newId: 'linker-2' })).status, 403);
    const d = await carl.get('/collections/posts/entries/bob-draft');
    const r = await carl.post('/collections/posts/entries/bob-draft/move', { version: d.json.version, newId: 'bob-renamed' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.job, null);
    assert.ok(fs.existsSync(path.join(fx.site, 'src/content/blog/bob-renamed.md')));
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/bob-draft.md')));
    void alice;
  });

  test('the redirects hook fails: 502, nothing moved, the repo clean', async () => {
    const e = await ed.get('/collections/posts/entries/with-html');
    const was = head();
    const r = await ed.post('/collections/posts/entries/with-html/move', { version: e.json.version, newId: 'explode' });
    assert.equal(r.status, 502);
    assert.match(r.json.message, /no redirects for explosions/);
    assert.ok(fs.existsSync(path.join(fx.site, 'src/content/blog/with-html.md')));
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/explode.md')));
    assert.equal(head(), was);
    assert.equal(fx.git('status', '--porcelain').trim(), '', 'its half-written redirects file is undone too');
  });

  test('a failed build puts every file back (name, links, redirects)', async () => {
    const e = await ed.get('/collections/posts/entries/hello-there');
    const linker = readFile(fx, 'src/content/blog/linker.md');
    const redirects = readFile(fx, 'src/data/redirects.json');
    fs.writeFileSync(`${fx.failMarker}.build`, '1');
    try {
      const r = await ed.post('/collections/posts/entries/hello-there/move', { version: e.json.version, newId: 'hello-again' });
      assert.equal(r.status, 202);
      await srv.app.jobs.idle();
      const job = (await ed.get(`/jobs/${r.json.job}`)).json;
      assert.equal(job.status, 'failed');
      assert.deepEqual(job.steps.map((s) => s.name), ['commit', 'build', 'revert']);
      assert.ok(fs.existsSync(path.join(fx.site, 'src/content/blog/hello-there.md')));
      assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/hello-again.md')));
      assert.equal(readFile(fx, 'src/content/blog/linker.md'), linker);
      assert.equal(readFile(fx, 'src/data/redirects.json'), redirects);
      assert.equal(fx.git('status', '--porcelain').trim(), '');
    } finally {
      fs.rmSync(`${fx.failMarker}.build`, { force: true });
    }
  });
});
