// Where each media file is used (media/uses.mjs): the media_uses table is filled per entry version from the content
// index, so "unused" and "used by" are lookups; a save, a change made by hand and a removed entry move the table
// before the next answer; the file indexer's `used` counts come from it too.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { piecesOf } from '../src/media/uses.mjs';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';

test('piecesOf: every path piece a text names, cut at quotes, brackets, commas, ? and #', () => {
  const p = piecesOf('![Hero](/uploads/2025/12/hero.png "A hero") <img src="/uploads/a b.png?w=2"> cover: /uploads/c.jpg\nsrcset: /uploads/x.webp 1x, /uploads/y.webp 2x\nSee e.g. example.com and v1.2.3 of it.');
  for (const want of ['uploads/2025/12/hero.png', '2025/12/hero.png', '12/hero.png', 'hero.png', 'c.jpg', 'uploads/c.jpg', 'x.webp', 'y.webp', 'example.com', 'b.png']) assert.ok(p.has(want), want);
  assert.ok(!p.has('hero.png?w=2'), 'cut at ?');
  assert.ok(!p.has('A'), 'a word with no extension is no piece');
});

describe('media uses', () => {
  let fx;
  let srv;
  let admin;
  const uploads = () => path.join(fx.site, 'src/assets/uploads');
  const post = (body) => `---\ntitle: With pictures\nauthor: alice\ndate: '2026-01-02T10:00:00.000Z'\nmodified: '2026-01-03T10:00:00.000Z'\n---\n\n${body}\n`;
  const file = path.join('src/content/blog', 'pictures.md');
  const unused = async () => (await admin.get('/media?unused=1')).json.items.map((m) => m.filename).sort();
  const rowOf = async (name) => (await admin.get('/media?perPage=200')).json.items.find((m) => m.filename === name);

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.mkdirSync(path.join(uploads(), '2025/12'), { recursive: true });
    fs.writeFileSync(path.join(uploads(), '2025/12/hero.png'), makePng());
    fs.writeFileSync(path.join(uploads(), 'lonely.png'), makePng());
    fs.writeFileSync(path.join(uploads(), 'later.png'), makePng());
    fs.writeFileSync(path.join(fx.site, file), post('![A hero](/uploads/2025/12/hero.png)'));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Pictures');
    srv = await startServer(fx);
    admin = await as(srv, 'administrator');
  });
  after(() => srv.close());

  test('the indexer counts uses from the table; unused and used-by are lookups', async () => {
    const r = await admin.post('/media/index', {});
    assert.equal(r.status, 200, r.text);
    const added = Object.fromEntries(r.json.added.map((a) => [path.basename(a.path), a.used]));
    assert.deepEqual(added, { 'hero.png': 1, 'lonely.png': 0, 'later.png': 0 });
    assert.deepEqual(await unused(), ['later.png', 'lonely.png']);
    const hero = await rowOf('hero.png');
    const one = await admin.get(`/media/${hero.id}`);
    assert.deepEqual(one.json.usedBy, [{ collection: 'posts', id: 'pictures', title: 'With pictures' }]);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM media_use_entries').get().n, 6, 'one row per entry of the site (five posts, one page)');
  });

  test('a save moves only that entry; the next answer is right at once', async () => {
    const cur = await admin.get('/collections/posts/entries/pictures');
    const before = srv.app.db.prepare("SELECT version FROM media_use_entries WHERE entry_id = 'pictures'").get().version;
    const r = await admin.put('/collections/posts/entries/pictures/source', { version: cur.json.version, source: post('Now with ![another](/uploads/later.png) picture, the hero gone.') });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(await unused(), ['hero.png', 'lonely.png']);
    assert.notEqual(srv.app.db.prepare("SELECT version FROM media_use_entries WHERE entry_id = 'pictures'").get().version, before);
    assert.equal(srv.app.mediaUses.sync().changed, 0, 'nothing else to bring up to date');
    const later = await rowOf('later.png');
    assert.equal((await admin.get(`/media/${later.id}`)).json.usedBy.length, 1);
  });

  test('a change made by hand (a pull, an editor) and a removed entry are seen as well', async () => {
    fs.writeFileSync(path.join(fx.site, file), post('Back to ![the hero](/uploads/2025/12/hero.png).'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await unused(), ['later.png', 'lonely.png']);
    fs.unlinkSync(path.join(fx.site, file));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await unused(), ['hero.png', 'later.png', 'lonely.png']);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM media_uses WHERE entry_id = 'pictures'").get().n, 0, 'its rows are gone');
  });

  test('a file whose name holds a space is still found, by looking in the texts', async () => {
    fs.writeFileSync(path.join(uploads(), 'two words.png'), makePng());
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/spaced.md'), post('<img src="/uploads/two words.png" alt="x">'));
    await admin.post('/media/index', {});
    const row = await rowOf('two words.png');
    assert.deepEqual((await admin.get(`/media/${row.id}`)).json.usedBy.map((u) => u.id), ['spaced']);
    assert.ok(!(await unused()).includes('two words.png'));
  });
});
