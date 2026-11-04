// International SEO on a two-locale site (root = en-CA, /en-us/ = en-US, one source file per entry): status jobs
// check every locale copy in the build before deploying it, a post-build hreflang check blocks a publish, and the
// preview opens an entry in a region.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, freePort } from './helpers.mjs';
import { localeServer } from './locale-site.mjs';

const LOCALE_BUILD = { build: [process.execPath, 'scripts/build-locales.mjs'] };

describe('locale-aware status jobs', () => {
  let fx, srv, ed;
  const built = (dir, p) => fs.existsSync(path.join(fx.site, dir, p, 'index.html'));
  const runJob = async (r) => {
    assert.ok([200, 202].includes(r.status), JSON.stringify(r.json));
    await srv.app.jobs.idle();
    return (await ed.get(`/jobs/${r.json.job}`)).json;
  };
  before(async () => {
    ({ fx, srv } = await localeServer({
      commands: { ...LOCALE_BUILD },
      verify: { public: 'dist', private: 'dist-private' },
      checks: [{ id: 'hreflang', label: 'hreflang', command: [process.execPath, 'scripts/hreflang-check.mjs'], blocking: true, after: 'build' }],
    }));
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('publish: both locale copies built and checked (verify + hreflang), then deployed', async () => {
    const e = await ed.get('/collections/posts/entries/bob-draft');
    const job = await runJob(await ed.post('/collections/posts/entries/bob-draft/publish', { version: e.json.version }));
    assert.equal(job.status, 'succeeded', job.log);
    assert.deepEqual(job.steps.map((s) => s.name), ['commit', 'build', 'verify', 'check: hreflang', 'deploy']);
    assert.match(job.log, /ok posts\/bob-draft: public at \/blog\/bob-draft\/, \/en-us\/blog\/bob-draft\//);
    assert.match(job.log, /pass posts\/bob-draft/);
    assert.ok(built('dist', '/blog/bob-draft/') && built('dist', '/en-us/blog/bob-draft/'));
  });

  test('a build that drops the /en-us/ copy: verify fails before the deploy, the change is reverted', async () => {
    fs.writeFileSync(path.join(fx.site, '.drop-en-us'), '');
    try {
      const e = await ed.get('/collections/posts/entries/carol-draft');
      const job = await runJob(await ed.post('/collections/posts/entries/carol-draft/publish', { version: e.json.version }));
      assert.equal(job.status, 'failed');
      assert.deepEqual(job.steps.map((s) => s.name), ['commit', 'build', 'verify', 'revert']);
      assert.match(job.log, /FAIL posts\/carol-draft: \/en-us\/blog\/carol-draft\/ is missing from the build/);
      assert.match(job.error, /^The verify step failed on posts\/carol-draft/);
      assert.equal((await ed.get('/collections/posts/entries/carol-draft')).json.status, 'draft', 'reverted');
    } finally {
      fs.rmSync(path.join(fx.site, '.drop-en-us'));
    }
  });

  test('a build without hreflang links: the post-build check blocks the publish', async () => {
    fs.writeFileSync(path.join(fx.site, '.no-hreflang'), '');
    try {
      const e = await ed.get('/collections/posts/entries/carol-draft');
      const job = await runJob(await ed.post('/collections/posts/entries/carol-draft/publish', { version: e.json.version }));
      assert.equal(job.status, 'failed');
      assert.match(job.log, /FAIL posts\/carol-draft\n  error: \/blog\/carol-draft\/ has no hreflang en-CA/);
      assert.match(job.error, /^The check: hreflang step failed on posts\/carol-draft: hreflang/);
    } finally {
      fs.rmSync(path.join(fx.site, '.no-hreflang'));
    }
  });

  test('unpublish: both copies gone; protect: both private', async () => {
    let e = await ed.get('/collections/posts/entries/bob-draft');
    let job = await runJob(await ed.post('/collections/posts/entries/bob-draft/unpublish', { version: e.json.version }));
    assert.equal(job.status, 'succeeded', job.log);
    assert.match(job.log, /ok posts\/bob-draft: gone at \/blog\/bob-draft\/, \/en-us\/blog\/bob-draft\//);
    assert.ok(!built('dist', '/blog/bob-draft/') && !built('dist', '/en-us/blog/bob-draft/'));

    e = await ed.get('/collections/posts/entries/with-html');
    job = await runJob(await ed.put('/collections/posts/entries/with-html/protection', { version: e.json.version, password: 'page-pass-1' }));
    assert.equal(job.status, 'succeeded', job.log);
    assert.match(job.log, /ok posts\/with-html: private at \/blog\/with-html\/, \/en-us\/blog\/with-html\//);
    assert.ok(built('dist-private', '/en-us/blog/with-html/') && !built('dist', '/en-us/blog/with-html/'));
  });

  test('move: the new address in both locales, the old ones redirect stubs', async () => {
    const e = await ed.get('/collections/posts/entries/linker');
    const job = await runJob(await ed.post('/collections/posts/entries/linker/move', { version: e.json.version, newId: 'linker-moved' }));
    assert.equal(job.status, 'succeeded', job.log);
    assert.match(job.log, /ok posts\/linker-moved: public at \/blog\/linker-moved\/, \/en-us\/blog\/linker-moved\//);
    assert.match(job.log, /ok posts\/linker-moved \(old address\): moved at \/blog\/linker\/, \/en-us\/blog\/linker\//);
    assert.match(fs.readFileSync(path.join(fx.site, 'dist/en-us/blog/linker/index.html'), 'utf8'), /http-equiv="refresh" content="0;url=\/en-us\/blog\/linker-moved\/"/);
  });

  test('delete a live post: both copies gone', async () => {
    const e = await ed.get('/collections/posts/entries/linker-moved');
    const r = await ed.del(`/collections/posts/entries/linker-moved?version=${e.json.version}`);
    const job = await runJob(r);
    assert.equal(job.status, 'succeeded', job.log);
    // the redirect stubs of the earlier move stay; the moved page itself is gone in both locales
    assert.match(job.log, /ok posts\/linker-moved: gone at \/blog\/linker-moved\/, \/en-us\/blog\/linker-moved\//);
  });
});

describe('preview in a region', () => {
  test('?region= opens the locale copy; an unknown region is refused', async () => {
    const { srv } = await localeServer({ preview: { devServer: 'http://127.0.0.1:4321' } });
    try {
      const ed = await as(srv, 'editor');
      assert.equal((await ed.get('/preview/posts/hello-world')).json.url, 'http://127.0.0.1:4321/blog/hello-world/');
      assert.equal((await ed.get('/preview/posts/hello-world?region=en-US')).json.url, 'http://127.0.0.1:4321/en-us/blog/hello-world/');
      assert.equal((await ed.get('/preview/posts/hello-world?region=en-ca')).json.url, 'http://127.0.0.1:4321/blog/hello-world/', 'codes match in any case');
      assert.equal((await ed.get('/preview/posts/hello-world?locale=en-US')).json.url, 'http://127.0.0.1:4321/en-us/blog/hello-world/', 'the editor says locale=');
      const bad = await ed.get('/preview/posts/hello-world?region=fr-FR');
      assert.equal(bad.status, 422);
      assert.deepEqual(bad.json.regions, ['en-CA', 'en-US']);
    } finally {
      await srv.close();
    }
  });

  test('on the preview origin: the entry opens at its locale path, through the sign-in hand-off', async () => {
    const pport = await freePort();
    const pOrigin = `http://127.0.0.1:${pport}`;
    const { srv } = await localeServer({ preview: { origin: pOrigin, port: pport, command: [process.execPath, '-e', '0', '{port}'], settleFile: null } });
    try {
      const ed = await as(srv, 'editor');
      const HTML = { headers: { Accept: 'text/html' } };
      assert.equal((await ed.get('/preview/posts/hello-world?region=en-US')).json.url, `${pOrigin}/markstage/preview/posts/hello-world/?region=en-US`);
      // no preview cookie yet: the region survives the hand-off through the CMS
      const to = '/markstage/preview/posts/hello-world/?region=en-US';
      const first = await ed.get(pOrigin + to, HTML);
      assert.equal(first.status, 303);
      const pg = await ed.get(first.headers.get('location'));
      const ticket = /name="ticket" value="([^"]+)"/.exec(pg.text)[1];
      const enter = await ed.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ ticket }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      assert.equal(enter.headers.get('location'), to);
      const sel = await ed.get(pOrigin + to, HTML);
      assert.equal(sel.status, 303);
      assert.equal(sel.headers.get('location'), '/en-us/blog/hello-world/');
      assert.equal((await ed.get(`${pOrigin}/markstage/preview/posts/hello-world/`, HTML)).headers.get('location'), '/blog/hello-world/');
      assert.equal((await ed.get(`${pOrigin}/markstage/preview/posts/hello-world/?region=xx`, HTML)).status, 400);
    } finally {
      await srv.close();
    }
  });
});
