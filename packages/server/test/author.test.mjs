// Every new entry in a status collection gets a real author (a post without one breaks the site's build): the one
// an editor gives, else the creator's author name, else the collection's defaultAuthor, else 422.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/app.mjs';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';

const POSTS = { id: 'posts', label: 'Posts', dir: 'src/content/blog', format: 'md', hasStatus: true, url: '/blog/{id}/' };
const PAGES = { id: 'pages', label: 'Pages', dir: 'src/content/pages', format: 'json', fields: { url: 'uri' } };
const authorOf = (fx, id) => /\nauthor: (.+)\n/.exec(readFile(fx, `src/content/blog/${id}.md`))?.[1];

describe('author on create, no default', () => {
  let fx, srv, ed, alice;
  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('an editor with no author name and none given: 422, nothing written', async () => {
    const r = await ed.post('/collections/posts/entries', { title: 'Orphan' });
    assert.equal(r.status, 422);
    assert.equal(r.json.error, 'no-author');
    assert.match(r.json.message, /Link your account to an author/);
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/orphan.md')));
    // the same for an import with no author in it
    const i = await ed.post('/collections/posts/import', { filename: 'o.md', source: '---\ntitle: Orphan import\n---\n\nText.\n' });
    assert.equal(i.status, 422);
  });

  test('an editor may name the author; an author always gets their own', async () => {
    const r = await ed.post('/collections/posts/entries', { title: 'Named', frontmatter: { author: 'bob' } });
    assert.equal(r.status, 201);
    assert.equal(authorOf(fx, r.json.id), 'bob');
    const a = await alice.post('/collections/posts/entries', { title: 'Mine' });
    assert.equal(authorOf(fx, a.json.id), 'alice');
    const imp = await ed.post('/collections/posts/import', { filename: 'b.md', source: '---\ntitle: By Bob\nauthor: bob\n---\n\nText.\n' });
    assert.equal(imp.status, 201);
    assert.equal(authorOf(fx, imp.json.id), 'bob', "an import keeps the file's author");
  });

  test('a collection without status (pages) needs no author', async () => {
    assert.equal((await ed.post('/collections/pages/entries', { title: 'Plain page', data: { uri: '/plain/' } })).status, 201);
  });
});

describe('author on create, with defaultAuthor', () => {
  test("the collection's default when the creator has no author name", async () => {
    const fx = makeFixture({ checks: false });
    const srv = await startServer(fx, { overrides: { collections: [{ ...POSTS, defaultAuthor: 'site-team' }, PAGES] } });
    try {
      const ed = await as(srv, 'editor');
      const r = await ed.post('/collections/posts/entries', { title: 'Team post' });
      assert.equal(r.status, 201);
      assert.equal(authorOf(fx, r.json.id), 'site-team');
      const withSlug = await as(srv, 'editor', { authorSlug: 'erin' });
      assert.equal(authorOf(fx, (await withSlug.post('/collections/posts/entries', { title: 'Erin post' })).json.id), 'erin', "the creator's own name comes first");
    } finally {
      await srv.close();
    }
  });

  test('config refuses a defaultAuthor that is not a slug', () => {
    const fx = makeFixture({ checks: false });
    assert.throws(() => loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { collections: [{ ...POSTS, defaultAuthor: 'Site Team' }] } }), /defaultAuthor must be an author slug/);
  });
});
