// A new entry gets an author and a date only where its collection has them (docs/API.md "Entries"): an article
// always, a JSON entry when the site names the field, its schema has it, or what it starts from holds it. A page of a
// JSON collection with a status gets neither, so its file holds no keys the site does not read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';

describe('a new entry’s author and date', () => {
  let fx, srv, ed;
  before(async () => {
    fx = makeFixture({ checks: false });
    fs.mkdirSync(path.join(fx.site, 'src/content/people'), { recursive: true });
    const collections = [
      { id: 'posts', label: 'Posts', dir: 'src/content/blog', format: 'md', hasStatus: true, url: '/blog/{id}/' },
      { id: 'pages', label: 'Pages', dir: 'src/content/pages', format: 'json', hasStatus: true, fields: { url: 'uri' } },
      { id: 'people', label: 'People', dir: 'src/content/people', format: 'json', hasStatus: true, fields: { author: 'by', date: 'joined' } },
    ];
    srv = await startServer(fx, { overrides: { collections } });
    ed = await as(srv, 'editor', { authorSlug: 'ann' });
  });
  after(() => srv?.close());

  test('a page: no author, no date; a JSON collection naming them: both; an article: both', async () => {
    assert.equal((await ed.post('/collections/pages/entries', { title: 'Pricing', data: { uri: '/pricing/' } })).status, 201);
    const page = JSON.parse(readFile(fx, 'src/content/pages/pricing.json'));
    assert.deepEqual([page.title, page.uri, page.draft, 'author' in page, 'date' in page], ['Pricing', '/pricing/', true, false, false]);
    const made = await ed.post('/collections/people/entries', { title: 'Ann' });
    assert.equal(made.status, 201, made.text);
    const ann = JSON.parse(readFile(fx, 'src/content/people/ann.json'));
    assert.deepEqual(['by' in ann, typeof ann.joined, 'author' in ann, 'date' in ann], [true, 'string', false, false]);
    assert.equal((await ed.post('/collections/posts/entries', { title: 'Hello there' })).status, 201);
    assert.match(readFile(fx, 'src/content/blog/hello-there.md'), /^author: .+$[\s\S]*^date: /m);
    // a page started from data that has a date keeps that date
    assert.equal((await ed.post('/collections/pages/entries', { title: 'Old', data: { uri: '/old/', date: '2020-01-01' } })).status, 201);
    assert.equal(JSON.parse(readFile(fx, 'src/content/pages/old.json')).date, '2020-01-01');
  });
});
