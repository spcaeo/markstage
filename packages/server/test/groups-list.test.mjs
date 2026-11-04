// A collection with `groups` in the site's markstage.config (topic clusters): each entry in the list says which group
// it is in (groupId, by the groups field), so the Groups screen can show a group's entries; a collection without
// groups keeps its items as they were. And an entry moves into another group through site/move with `set`, its
// address following the group (a redirect, links rewritten), as for any move.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';

const SITE_CONFIG = `export default {
  siteName: 'Fixture',
  collections: [
    {
      id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true,
      url: ({ id, data }) => (data.cluster ? '/' + data.cluster + '/' + id + '/' : '/blog/' + id + '/'),
      settings: [{ type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' }],
      groups: { field: 'cluster', collection: 'clusters', order: 'order', label: 'Topics' },
    },
    { id: 'clusters', label: 'Topics', format: 'json', dir: 'src/content/clusters' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
};
`;

describe('groups in the lists', () => {
  let srv, ed, fx;
  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    const dir = path.join(fx.site, 'src/content/clusters');
    fs.mkdirSync(dir, { recursive: true });
    for (const id of ['basics', 'advanced']) fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify({ id, title: id === 'basics' ? 'Getting started' : 'Going further', order: [] }, null, 2)}\n`);
    srv = await startServer(fx, { overrides: { collections: [] } });
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('each entry says its group; one with none says null; a collection without groups has no groupId', async () => {
    const items = (await ed.get('/collections/posts/entries?perPage=100')).json.items;
    const hw = items.find((i) => i.id === 'hello-world');
    assert.equal(hw.groupId, 'basics');
    assert.ok(items.filter((i) => i.id !== 'hello-world').every((i) => i.groupId === null));
    for (const i of (await ed.get('/collections/pages/entries')).json.items) assert.equal('groupId' in i, false);
    for (const i of (await ed.get('/collections/clusters/entries')).json.items) assert.equal('groupId' in i, false);
  });

  test('into another group: site/move with set, a dry run first; the address follows with a redirect', async () => {
    const e = (await ed.get('/collections/posts/entries/hello-world')).json;
    const move = { collection: 'posts', id: 'hello-world', version: e.version, set: { cluster: 'advanced' } };
    const dry = await ed.post('/site/move', { moves: [move], dry: true });
    assert.equal(dry.status, 200, dry.text);
    assert.equal(dry.json.dry, true);
    assert.deepEqual(dry.json.moved.map((m) => [m.oldUrl, m.url]), [['/basics/hello-world/', '/advanced/hello-world/']]);
    assert.equal((await ed.get('/collections/posts/entries/hello-world')).json.version, e.version, 'a dry run writes nothing');
    const r = await ed.post('/site/move', { moves: [move] });
    assert.ok([200, 202].includes(r.status), r.text);
    const items = (await ed.get('/collections/posts/entries?perPage=100')).json.items;
    assert.equal(items.find((i) => i.id === 'hello-world').groupId, 'advanced');
    assert.equal(items.find((i) => i.id === 'hello-world').url, '/advanced/hello-world/');
  });

  test("a group's order is saved like any JSON entry", async () => {
    const g = (await ed.get('/collections/clusters/entries/advanced')).json;
    const r = await ed.put('/collections/clusters/entries/advanced', { version: g.version, changes: [{ op: 'set', path: 'order', value: ['hello-world'] }] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await ed.get('/collections/clusters/entries/advanced')).json.data.order, ['hello-world']);
  });
});
