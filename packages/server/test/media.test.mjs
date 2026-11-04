// Media uploads: sniffing (not names or headers), SVG/HTML refused, size limit, re-encoding (payloads after the image
// are gone), committed to git, alt text, delete only when unused, roles. Plus a real sharp run when available.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, fakeCodec, makeFixture, makePng, startServer } from './helpers.mjs';

const upload = (c, name, bytes, type = 'application/octet-stream') => c.request('POST', `/media?filename=${encodeURIComponent(name)}`, { body: bytes, headers: { 'Content-Type': type } });

describe('media library', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  let carol;
  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { clock: { now: Date.UTC(2026, 9, 28, 12) } });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => srv.close());

  test('a PNG is re-encoded, stored under YYYY/MM, committed, and listed', async () => {
    const calls = fakeCodec.calls;
    const payload = Buffer.from('<script>alert(1)</script>');
    const r = await upload(alice, '../../Evil Name.PNG', makePng(payload), 'text/html');
    assert.equal(r.status, 201, r.text);
    assert.equal(fakeCodec.calls, calls + 1);
    assert.equal(r.json.path, 'src/assets/uploads/2026/10/evil-name.png');
    assert.equal(r.json.url, '/uploads/2026/10/evil-name.png');
    const stored = fs.readFileSync(path.join(fx.site, r.json.path));
    assert.ok(!stored.includes(payload), 'bytes after IEND are gone');
    assert.deepEqual(stored, makePng());
    assert.match(fx.git('log', '-1', '--format=%s', '--', r.json.path), /^Upload src\/assets\/uploads\/2026\/10\/evil-name.png/);
    const again = await upload(alice, 'evil-name.png', makePng());
    assert.equal(again.json.path, 'src/assets/uploads/2026/10/evil-name-2.png');
    const list = await carol.get('/media?q=evil');
    assert.equal(list.json.total, 2);
    // kind=image leaves documents out: the picker for an image box never offers a PDF (QA F16)
    assert.equal((await upload(editor, 'notes.pdf', Buffer.from('%PDF-1.4\n%fake\n'))).status, 201);
    const all = await carol.get('/media');
    assert.ok(all.json.items.some((m) => m.type === 'application/pdf'));
    const images = await carol.get('/media?kind=image');
    assert.ok(images.json.items.length >= 2 && images.json.items.every((m) => m.type.startsWith('image/')));
    const file = await carol.get(`/media/${r.json.id}/file`, { raw: true });
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  });

  test('SVG, HTML and unknown bytes are refused whatever the name says', async () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    const s = await upload(editor, 'logo.png', svg, 'image/png');
    assert.equal(s.status, 415);
    assert.match(s.json.message, /SVG/);
    assert.equal((await upload(editor, 'pic.jpg', Buffer.from('<!doctype html><html><script>x</script></html>'), 'image/jpeg')).status, 415);
    // a ZIP named as a PDF (PDFs themselves are accepted: uploads.test.mjs)
    assert.equal((await upload(editor, 'doc.pdf', Buffer.from('PK\u0003\u0004\u0014\u0000\u0000\u0000'))).status, 415);
    assert.equal((await upload(editor, 'empty.png', Buffer.alloc(0))).status, 415);
  });

  test('size limit (413), and a corrupt image is refused (415)', async () => {
    const big = Buffer.concat([makePng(), Buffer.alloc(70 * 1024)]);
    assert.equal((await upload(editor, 'big.png', big)).status, 413);
    const corrupt = Buffer.concat([makePng().subarray(0, 16), Buffer.alloc(40)]);
    const saved = fakeCodec.reencode;
    fakeCodec.reencode = async () => {
      throw new Error('decode failed');
    };
    try {
      assert.equal((await upload(editor, 'bad.png', corrupt)).status, 415);
    } finally {
      fakeCodec.reencode = saved;
    }
  });

  test('alt text: own uploads, or editor+', async () => {
    const mine = await upload(carol, 'carol.png', makePng());
    assert.equal(mine.status, 201, 'contributors may upload (sanitized)');
    assert.equal((await carol.patch(`/media/${mine.json.id}`, { alt: 'A small test image' })).json.alt, 'A small test image');
    const theirs = (await editor.get('/media?q=evil-name')).json.items[0];
    assert.equal((await carol.patch(`/media/${theirs.id}`, { alt: 'x' })).status, 403);
    assert.equal((await editor.patch(`/media/${theirs.id}`, { alt: 'x'.repeat(501) })).status, 422);
  });

  test('delete only when unused; contributors cannot delete', async () => {
    const m = await upload(alice, 'used.png', makePng());
    const p = await alice.get('/collections/posts/entries/hello-world');
    const doc = structuredClone(p.json.doc);
    doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: `![x](/uploads/2026/10/used.png)` }] });
    assert.equal((await alice.put('/collections/posts/entries/hello-world', { version: p.json.version, doc })).status, 200);
    const info = await alice.get(`/media/${m.json.id}`);
    assert.deepEqual(info.json.usedBy.map((u) => u.id), ['hello-world']);
    const blocked = await alice.del(`/media/${m.json.id}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.usedBy[0].id, 'hello-world');
    const unused = await editor.get('/media?unused=1');
    assert.ok(!unused.json.items.some((x) => x.id === m.json.id));
    // "true" (as a browser's String(true) writes it) is the same flag; anything else is no filter
    assert.deepEqual((await editor.get('/media?unused=true')).json.items.map((x) => x.id), unused.json.items.map((x) => x.id));
    assert.ok((await editor.get('/media?unused=0')).json.items.some((x) => x.id === m.json.id));
    const spare = await upload(alice, 'spare.png', makePng());
    assert.equal((await carol.del(`/media/${spare.json.id}`)).status, 403);
    assert.equal((await alice.del(`/media/${spare.json.id}`)).status, 200);
    assert.ok(!fs.existsSync(path.join(fx.site, spare.json.path)));
    assert.equal(fx.git('status', '--porcelain', '--', spare.json.path).trim(), '', 'the delete is committed');
  });

  test('without an image codec, raster uploads are refused (503) unless re-encoding is turned off', async () => {
    const fx2 = makeFixture({ checks: false });
    const srv2 = await startServer(fx2, { codec: null });
    try {
      const ed = await as(srv2, 'editor');
      assert.equal((await upload(ed, 'a.png', makePng())).status, 503);
    } finally {
      await srv2.close();
    }
  });
});

// Real re-encoding through sharp, when the test run points at an installed copy (MARKSTAGE_SHARP=<path to sharp's
// package dir>). Proves EXIF/GPS metadata and trailing bytes do not survive.
describe('real sharp re-encoding', { skip: !process.env.MARKSTAGE_SHARP && 'set MARKSTAGE_SHARP to run' }, () => {
  test('JPEG with EXIF + trailing payload comes out clean and resized', async () => {
    const { loadSharpCodec } = await import('../src/media/codec.mjs');
    const codec = await loadSharpCodec(process.env.MARKSTAGE_SHARP);
    assert.ok(codec, 'sharp loaded');
    const sharp = (await import(process.env.MARKSTAGE_SHARP)).default;
    const jpeg = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#3366cc' } })
      .jpeg()
      .withExif({ IFD0: { Artist: 'SECRET-ARTIST', Copyright: 'SECRET-GPS' } })
      .toBuffer();
    assert.ok(jpeg.includes('SECRET-ARTIST'));
    const dirty = Buffer.concat([jpeg, Buffer.from('<script>alert(1)</script>')]);
    const out = await codec.reencode(dirty, { type: 'image/jpeg', maxSide: 2560 });
    assert.equal(out.width, 2560);
    assert.ok(!out.buffer.includes('SECRET-ARTIST'));
    assert.ok(!out.buffer.includes('<script>'));
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.exif, undefined);
  });
});
