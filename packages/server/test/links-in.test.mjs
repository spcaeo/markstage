// The entries that link to one (warned before a delete or an unpublish), found the way a move finds the links it
// rewrites: link marks, hrefs in HTML and address fields, in every locale, as a path or an absolute URL. Mentions in
// plain text are not links. An entry in the trash is checked the same way, from the text kept there.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as } from './helpers.mjs';
import { localeServer } from './locale-site.mjs';

describe('links in', () => {
  let srv;
  let ed;
  before(async () => {
    ({ srv } = await localeServer());
    ed = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(() => srv.close());

  test('every entry linking here, in any locale and form; plain text and itself do not count', async () => {
    const r = await ed.get('/collections/posts/entries/hello-world/links-in');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.entries.map((e) => `${e.collection}/${e.id}`).sort(), ['pages/links', 'posts/linker']);
    assert.equal(r.json.entries.find((e) => e.id === 'linker').title, 'Linker');
    assert.deepEqual((await ed.get('/collections/posts/entries/linker/links-in')).json.entries, []);
    assert.equal((await ed.get('/collections/posts/entries/nope/links-in')).status, 404);
  });

  test('in the trash: the list shows the old address; before "Delete for good", what still links to it', async () => {
    const e = await ed.get('/collections/posts/entries/hello-world');
    assert.equal((await ed.del(`/collections/posts/entries/hello-world?version=${e.json.version}`)).status, 200);
    const item = (await ed.get('/trash')).json.find((i) => i.id === 'hello-world');
    assert.equal(item.url, '/blog/hello-world/');
    const r = await ed.get(`/trash/${item.trashId}/links-in`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.url, '/blog/hello-world/');
    assert.deepEqual(r.json.entries.map((x) => `${x.collection}/${x.id}`).sort(), ['pages/links', 'posts/linker']);
    assert.equal(r.json.entries.find((x) => x.id === 'linker').url, '/blog/linker/');
    const author = await as(srv, 'author', { authorSlug: 'someone-else' });
    assert.equal((await author.get(`/trash/${item.trashId}/links-in`)).status, 404, 'not theirs: not there');
    assert.equal((await ed.get('/trash/nope/links-in')).status, 404);
  });
});
