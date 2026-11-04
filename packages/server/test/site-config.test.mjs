// The site's markstage.config is the one source of collections, page URLs and groups (the same file the editor
// reads): url / group functions of {id, data}, the server's own path checks on top, never two sources at once.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';

// a site config like a real blog's: posts live under their cluster's path and are grouped by its title
const SITE_CONFIG = `const CLUSTERS = { basics: 'Getting started' };
export default {
  siteName: 'Fixture',
  collections: [
    {
      id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true,
      url: ({ id, data }) => (data.cluster ? '/' + data.cluster + '/' + id + '/' : '/blog/' + id + '/'),
      group: ({ data }) => CLUSTERS[data.cluster] ?? null,
    },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
    {
      id: 'notes', label: 'Notes', format: 'md', dir: 'src/content/blog',
      url: ({ id }) => { if (id === 'hello-world') throw new Error('boom'); return '/n/' + id + '/'; },
    },
  ],
};
`;

/** A fixture whose site has `markstage.config.mjs` and whose config.json lists no collections. */
function siteFixture(text = SITE_CONFIG) {
  const fx = makeFixture({ checks: false });
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), text);
  return fx;
}

describe('collections from the site config', () => {
  let srv, ed;
  before(async () => {
    srv = await startServer(siteFixture(), { overrides: { collections: [] } });
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('url and group come from the functions; an entry without a group has none', async () => {
    const list = await ed.get('/collections/posts/entries?perPage=100');
    assert.equal(list.status, 200);
    const hw = list.json.items.find((i) => i.id === 'hello-world');
    assert.equal(hw.url, '/basics/hello-world/');
    assert.equal(hw.group, 'Getting started');
    const other = list.json.items.find((i) => i.id !== 'hello-world' && !('group' in i));
    assert.ok(other, 'no group key when the function returns null');
    assert.match(other.url, /^\/blog\//);
    assert.equal((await ed.get('/collections/posts/entries/hello-world')).json.url, '/basics/hello-world/');
  });

  test("an entry's own url field still wins; collections and compat work as before", async () => {
    assert.equal((await ed.get('/collections/pages/entries/about')).json.url, '/about/');
    assert.deepEqual((await ed.get('/collections')).json.map((c) => c.id), ['posts', 'pages', 'notes']);
    assert.equal(srv.config.compat.collection, 'posts', "config.json's compat is checked against the site's collections");
  });

  test('a url function that throws: no url for that entry, the list still works', async () => {
    const list = await ed.get('/collections/notes/entries?perPage=100');
    assert.equal(list.status, 200);
    assert.equal(list.json.items.find((i) => i.id === 'hello-world').url, null);
    assert.ok(list.json.items.some((i) => i.url?.startsWith('/n/')));
  });
});

// like a real site: a new post must carry a date, a modified date and its canonical (the site schema requires them)
const NEW_ENTRY_CONFIG = `export default {
  siteUrl: 'https://example.com',
  collections: [
    {
      id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/', defaultAuthor: 'site-team',
      newEntry: ({ id, now, values }) => ({ date: now.toISOString(), modified: now.toISOString(), excerpt: '', title: 'never this', seo: { canonical: 'https://example.com/blog/' + id + '/' }, ...(values.tags ? {} : { tags: ['new'] }) }),
    },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' }, newEntry: ({ id }) => ({ uri: '/' + id + '/', sections: [] }) },
  ],
};
`;

test("a new entry gets the site's newEntry defaults (never over the title, slug or asked values); a taken id is 409 id-taken", async () => {
  const fx = siteFixture(NEW_ENTRY_CONFIG);
  const srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
  try {
    const ed = await as(srv, 'editor');
    const r = await ed.post('/collections/posts/entries', { title: 'Fresh post', frontmatter: { tags: ['mine'] } });
    assert.equal(r.status, 201, r.text);
    const text = readFile(fx, 'src/content/blog/fresh-post.md');
    assert.match(text, /^title: Fresh post$/m);
    assert.match(text, /^date: '?\d{4}-\d\d-\d\dT/m);
    assert.match(text, /^modified: '?\d{4}-/m);
    assert.match(text, /canonical: https:\/\/example\.com\/blog\/fresh-post\//);
    assert.match(text, /- mine/, 'the asked value wins');
    assert.doesNotMatch(text, /never this|- new/);
    assert.match(text, /^author: site-team$/m, "the collection's defaultAuthor (the editor has no author name)");
    assert.match(text, /^draft: true$/m);
    const p = await ed.post('/collections/pages/entries', { title: 'About us', id: 'about-us' });
    assert.equal(p.status, 201, p.text);
    assert.deepEqual(JSON.parse(readFile(fx, 'src/content/pages/about-us.json')), { title: 'About us', uri: '/about-us/', sections: [] });
    const again = await ed.post('/collections/posts/entries', { title: 'Fresh post', id: 'fresh-post' });
    assert.equal(again.status, 409);
    assert.equal(again.json.error, 'id-taken');
  } finally {
    await srv.close();
  }
});

// like a real site: the schema needs a topic (asked for by the New sheet) and a canonical; one entry without them
// would stop every later build, so every way in (the API here; the editor, imports and agents use the same route
// or the same check) is refused with the field named in plain words
const REQUIRED_CONFIG = `export default {
  siteUrl: 'https://example.com',
  collections: [
    {
      id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/', defaultAuthor: 'site-team',
      settings: [{ type: 'select', key: 'topic', label: 'Topic', options: [['forms', 'Forms'], ['crm', 'CRM']] }],
      required: ['topic', 'seo.canonical'],
      newEntry: { ask: ['topic'], defaults: ({ id }) => ({ seo: { canonical: 'https://example.com/blog/' + id + '/' } }) },
    },
  ],
};
`;

test('a required key the site cannot build without: refused on create and on save, named in plain words (QA F1)', async () => {
  const fx = siteFixture(REQUIRED_CONFIG);
  const srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
  try {
    const ed = await as(srv, 'editor');
    const r = await ed.post('/collections/posts/entries', { title: 'No topic', id: 'no-topic' });
    assert.equal(r.status, 422, r.text);
    assert.equal(r.json.error, 'missing-field');
    assert.match(r.json.message, /“Topic” is needed before this entry can be saved/);
    assert.deepEqual(r.json.fields, { topic: 'Topic is needed.' });
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/no-topic.md')), 'nothing was written');
    // an empty topic is as good as none
    assert.equal((await ed.post('/collections/posts/entries', { title: 'No topic', id: 'no-topic', frontmatter: { topic: '' } })).status, 422);
    const ok = await ed.post('/collections/posts/entries', { title: 'With topic', id: 'with-topic', frontmatter: { topic: 'forms' } });
    assert.equal(ok.status, 201, ok.text);
    // a raw-source save that drops the canonical is refused too; the file keeps its last good text
    const before = readFile(fx, 'src/content/blog/with-topic.md');
    const cut = before.replace(/^seo:\n  canonical: .*\n/m, '');
    assert.notEqual(cut, before);
    const saved = await ed.put('/collections/posts/entries/with-topic/source', { version: ok.json.version, source: cut });
    assert.equal(saved.status, 422, saved.text);
    assert.match(saved.json.message, /“seo.canonical” is needed/);
    assert.equal(readFile(fx, 'src/content/blog/with-topic.md'), before);
  } finally {
    await srv.close();
  }
});

describe('site config: refused at start', () => {
  test('collections in config.json too: two sources', async () => {
    await assert.rejects(startServer(siteFixture()), /markstage\.config\.mjs: list collections there, not in config\.json too/);
  });

  test("the loader's own errors name the file", async () => {
    const fx = siteFixture(`export default { collections: [{ id: 'posts', format: 'md', dir: '../outside' }] };`);
    await assert.rejects(startServer(fx, { overrides: { collections: [] } }), /^Error: markstage\.config\.mjs: collection "posts": dir must be inside the project/);
  });

  test("the server's checks still apply: a collection dir that is a symlink out of the repo", async () => {
    const fx = siteFixture(`export default { collections: [{ id: 'posts', format: 'md', dir: 'src/escape' }] };`);
    fs.symlinkSync(fx.run, path.join(fx.site, 'src/escape'));
    await assert.rejects(startServer(fx, { overrides: { collections: [] } }), /dir must be inside the content repo/);
  });

  test('a compat collection the site config does not have', async () => {
    const fx = siteFixture(`export default { collections: [{ id: 'articles', format: 'md', dir: 'src/content/blog' }] };`);
    await assert.rejects(startServer(fx, { overrides: { collections: [] } }), /compat\.collection "posts" is not a collection of markstage\.config\.mjs/);
  });
});
