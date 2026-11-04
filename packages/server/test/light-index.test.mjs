// The light index (content/light-index.mjs): every entry of every collection in one answer with what the editor's
// shell needs, an ETag so a repeat is a 304, and the answer follows a save at once.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';

describe('the light index', () => {
  let fx;
  let srv;
  let author;

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    author = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('one answer for every collection, light rows only; a repeat with the ETag is a 304 with no body', async () => {
    const r = await author.get('/index');
    assert.equal(r.status, 200);
    const etag = r.headers.get('etag');
    assert.match(etag, /^"[0-9a-f]{40}"$/);
    assert.equal(r.headers.get('cache-control'), 'private, no-cache');
    const ids = r.json.items.map((e) => `${e.collection}/${e.id}`).sort();
    assert.deepEqual(ids, ['pages/about', 'posts/bob-draft', 'posts/carol-draft', 'posts/hello-world', 'posts/with-html']);
    const hello = r.json.items.find((e) => e.id === 'hello-world');
    assert.deepEqual(Object.keys(hello).sort(), ['collection', 'id', 'modified', 'status', 'title', 'url']);
    assert.deepEqual(hello, { collection: 'posts', id: 'hello-world', title: 'Hello World', url: '/blog/hello-world/', status: 'published', modified: '2026-01-03T10:00:00.000Z' });
    const again = await author.get('/index', { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
    assert.equal(again.text, '');
    assert.equal(again.headers.get('etag'), etag);
  });

  test('a save changes the answer and its ETag at once', async () => {
    const was = (await author.get('/index')).headers.get('etag');
    const cur = await author.get('/collections/posts/entries/hello-world');
    const r = await author.put('/collections/posts/entries/hello-world', { version: cur.json.version, frontmatter: { title: 'Hello Index' } });
    assert.equal(r.status, 200, r.text);
    const now = await author.get('/index', { headers: { 'If-None-Match': was } });
    assert.equal(now.status, 200);
    assert.notEqual(now.headers.get('etag'), was);
    assert.equal(now.json.items.find((e) => e.id === 'hello-world').title, 'Hello Index');
  });

  test('it needs a signed-in person', async () => {
    const r = await fetch(`${srv.base}/markstage/api/index`);
    assert.equal(r.status, 401);
  });
});
