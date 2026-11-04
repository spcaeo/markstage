// Indexing the site's existing files (media/index-files.mjs): files already under the media folder become rows in
// place (type from the bytes, size, an image's width and height, the file's modified time, no uploader), a dry run
// writes nothing, a second run adds nothing, files of other kinds are left out and named, and the route is for
// owners and administrators only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';
import { filesUnder, indexExistingFiles, indexWords } from '../src/media/index-files.mjs';
import { mediaCommand } from '../src/media/cli.mjs';

describe('index the site’s existing files', () => {
  let fx;
  let srv;
  let admin;
  let editor;
  const uploads = () => path.join(fx.site, 'src/assets/uploads');
  const rows = () => srv.app.db.prepare('SELECT path, type, width, height, bytes, alt, uploaded_by, uploaded_at FROM media ORDER BY path').all();

  before(async () => {
    fx = makeFixture({ checks: false });
    // files the site had before Markstage: a PNG used by a post, a PNG nobody uses, a JPEG header, a text file, an SVG
    fs.mkdirSync(path.join(uploads(), '2025/12'), { recursive: true });
    fs.writeFileSync(path.join(uploads(), '2025/12/hero.png'), makePng());
    fs.writeFileSync(path.join(uploads(), 'lonely.png'), makePng());
    fs.writeFileSync(path.join(uploads(), 'notes.txt'), 'not a picture\n');
    fs.writeFileSync(path.join(uploads(), 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    fs.writeFileSync(path.join(uploads(), '.hidden.png'), makePng());
    fs.utimesSync(path.join(uploads(), '2025/12/hero.png'), new Date('2025-12-24T10:00:00Z'), new Date('2025-12-24T10:00:00Z'));
    fs.appendFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), '\n![Hero](/uploads/2025/12/hero.png)\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Old pictures');
    srv = await startServer(fx);
    admin = await as(srv, 'administrator');
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(() => srv.close());

  test('the folder walk: sub-folders in, hidden files out, in name order', () => {
    assert.deepEqual(filesUnder(uploads()).map((f) => path.relative(uploads(), f)), ['2025/12/hero.png', 'logo.svg', 'lonely.png', 'notes.txt']);
    assert.deepEqual(filesUnder(path.join(fx.site, 'nowhere')), []);
  });

  test('a dry run says what would come in and writes nothing', () => {
    const r = indexExistingFiles(srv.app, { dry: true });
    assert.equal(r.dry, true);
    assert.equal(r.found, 4);
    assert.deepEqual(r.added.map((a) => [a.path, a.type, a.used]), [['src/assets/uploads/2025/12/hero.png', 'image/png', 1], ['src/assets/uploads/lonely.png', 'image/png', 0]]);
    assert.deepEqual(r.skipped, [{ path: 'src/assets/uploads/logo.svg', reason: 'SVG files are not taken' }, { path: 'src/assets/uploads/notes.txt', reason: 'not a kind of file the site takes' }]);
    assert.equal(rows().length, 0, 'nothing written');
    assert.equal(indexWords(r), 'Dry run, nothing written: 2 files would be added, 2 left out. 1 of them is used on a page.');
  });

  test('the route: only an owner or administrator; rows in place with what the file tells; a second run adds nothing', async () => {
    assert.equal((await editor.post('/media/index', {})).status, 403);
    const r = await admin.post('/media/index', {});
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.added.length, 2);
    assert.equal(r.json.known, 0);
    const hero = rows().find((x) => x.path === 'src/assets/uploads/2025/12/hero.png');
    assert.deepEqual({ ...hero }, { path: 'src/assets/uploads/2025/12/hero.png', type: 'image/png', width: 2, height: 2, bytes: makePng().length, alt: '', uploaded_by: null, uploaded_at: '2025-12-24T10:00:00.000Z' });
    // the file itself is where it was, untouched, and nothing was committed
    assert.deepEqual(fs.readFileSync(path.join(uploads(), '2025/12/hero.png')), makePng());
    assert.equal(fx.git('status', '--porcelain').trim(), '');
    // the library lists them, with where each is used, like an upload
    const list = await editor.get('/media');
    assert.equal(list.json.total, 2);
    const item = list.json.items.find((m) => m.filename === 'hero.png');
    assert.equal(item.url, '/uploads/2025/12/hero.png');
    assert.equal(item.uploadedBy, null);
    assert.deepEqual((await editor.get(`/media/${item.id}`)).json.usedBy, [{ collection: 'posts', id: 'hello-world', title: 'Hello World' }]);
    assert.equal((await editor.get('/media?unused=1')).json.items.map((m) => m.filename).join(), 'lonely.png');
    // again: nothing new, the two are known
    const again = await admin.post('/media/index', {});
    assert.deepEqual([again.json.added.length, again.json.known, again.json.skipped.length], [0, 2, 2]);
    assert.equal(rows().length, 2);
    const log = srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'media.index'").get().n;
    assert.equal(log, 1, 'audited once: the run that added');
  });

  test('the command does the same from a terminal, and a new file is picked up next time', async () => {
    fs.writeFileSync(path.join(uploads(), 'later.png'), makePng());
    const said = [];
    assert.equal(await mediaCommand(srv.app, ['index', '--dry'], (l) => said.push(l)), 0);
    assert.match(said[0], /^Dry run, nothing written: 1 file would be added, 2 already listed, 2 left out\./);
    assert.equal(rows().length, 2);
    said.length = 0;
    assert.equal(await mediaCommand(srv.app, ['index'], (l) => said.push(l)), 0);
    assert.match(said[0], /^Added 1 file, 2 already listed, 2 left out\./);
    assert.ok(said.some((l) => l.includes('added src/assets/uploads/later.png (image/png')));
    assert.equal(rows().length, 3);
  });
});
