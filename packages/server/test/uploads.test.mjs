// Uploads beyond plain images (docs/OPERATIONS.md): PDF documents as downloads (stored as they are, served as an
// attachment, refusable per site), iPhone HEIC photos converted to JPEG when the image library can read them and
// refused in plain words when not, and a too-large file told its size and the limit.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { loadSharpCodec } from '../src/media/codec.mjs';
import { colorPng } from './fake-stock.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

const upload = (c, name, bytes) => c.request('POST', `/media?filename=${encodeURIComponent(name)}`, { body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);

// an image library that reads HEIC (sharp with libheif's HEVC decoder): everything comes out as this JPEG
const heicCodec = {
  name: 'heic-capable',
  async reencode(buf, { type, as = type }) {
    if (as !== 'image/jpeg') throw new Error('only JPEG here');
    return { buffer: JPEG, type: 'image/jpeg', width: 4, height: 3 };
  },
};

describe('uploads: documents, phone photos, sizes', () => {
  let srv;
  let ed;
  before(async () => {
    srv = await startServer(makeFixture({ checks: false }), { overrides: { media: { maxBytes: 2048 } } });
    ed = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(() => srv.close());

  test('a PDF is stored as it is and downloads (never drawn on the editor origin)', async () => {
    const r = await upload(ed, 'Price List 2026.PDF', PDF);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.type, 'application/pdf');
    assert.match(r.json.path, /price-list-2026\.pdf$/);
    assert.equal(r.json.width, null);
    const f = await ed.get(`/media/${r.json.id}/file`);
    assert.equal(f.headers.get('content-type'), 'application/pdf');
    assert.match(f.headers.get('content-disposition'), /^attachment; filename="price-list-2026\.pdf"$/);
  });

  test('HEIC: refused in plain words when this server cannot read it', async () => {
    const r = await upload(ed, 'IMG_0042.HEIC', HEIC);
    assert.equal(r.status, 415);
    assert.match(r.json.message, /iPhone photos in HEIC format cannot be read on this server\. On the iPhone, choose Settings › Camera › Formats › Most Compatible/);
  });

  test('too large: the file size and the limit, in words', async () => {
    const r = await upload(ed, 'big.png', Buffer.alloc(5000, 1));
    assert.equal(r.status, 413);
    assert.equal(r.json.message, 'This file is 5 KB; the limit is 2 KB. Export it smaller (a photo at 2560 px wide is plenty) and upload it again.');
  });

  test('anything else: what can be uploaded', async () => {
    const r = await upload(ed, 'notes.txt', Buffer.from('just some words, more than twelve bytes'));
    assert.equal(r.status, 415);
    assert.match(r.json.message, /Images \(JPEG, PNG, GIF, WebP, AVIF, iPhone HEIC\) and PDF documents can/);
  });
});

test('HEIC becomes a JPEG when the image library reads it; documents can be refused per site', async () => {
  const srv = await startServer(makeFixture({ checks: false }), { codec: heicCodec, overrides: { media: { documents: false } } });
  try {
    const ed = await as(srv, 'editor', { authorSlug: 'ed' });
    const r = await upload(ed, 'IMG_0042.HEIC', HEIC);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.type, 'image/jpeg');
    assert.match(r.json.path, /img-0042\.jpg$/);
    const pdf = await upload(ed, 'x.pdf', PDF);
    assert.equal(pdf.status, 415);
    assert.match(pdf.json.message, /Documents \(PDF\) are not accepted on this site/);
  } finally {
    await srv.close();
  }
});

// a real iPhone-format photo, made on this machine with macOS's own sips; skipped where sips is not installed
const SIPS = '/usr/bin/sips';
const HEIF_DEC = ['/opt/homebrew/bin/heif-dec', '/usr/local/bin/heif-dec', '/usr/bin/heif-dec'].find((f) => fs.existsSync(f));
test('a real HEIC photo (made with sips): refused in plain words by sharp alone; converted by media.heicCommand', { skip: !fs.existsSync(SIPS) && 'sips is not installed (macOS only)' }, async () => {
  const codec = await loadSharpCodec();
  if (!codec) return assert.fail('sharp is needed for this test');
  const fx = makeFixture({ checks: false });
  const png = path.join(fx.run, 'photo.png');
  const heic = path.join(fx.run, 'IMG_1234.HEIC');
  fs.writeFileSync(png, colorPng(64, 48));
  execFileSync(SIPS, ['-s', 'format', 'heic', png, '--out', heic], { stdio: 'pipe' });
  const bytes = fs.readFileSync(heic);
  assert.equal(bytes.subarray(4, 12).toString('latin1'), 'ftypheic', 'a real HEIC file');

  const plain = await startServer(fx, { codec });
  try {
    const r = await upload(await as(plain, 'editor', { authorSlug: 'ed' }), 'IMG_1234.HEIC', bytes);
    assert.equal(r.status, 415, 'this sharp build has no HEVC decoder');
    assert.match(r.json.message, /iPhone photos in HEIC format cannot be read on this server/);
  } finally {
    await plain.close();
  }

  // with a converter: libheif's heif-dec when installed, else sips itself
  const heicCommand = HEIF_DEC ? [HEIF_DEC, '{in}', '{out}'] : [SIPS, '-s', 'format', 'jpeg', '{in}', '--out', '{out}'];
  const conv = await startServer(fx, { codec, overrides: { media: { heicCommand } } });
  try {
    const r = await upload(await as(conv, 'editor', { authorSlug: 'ed' }), 'IMG_1234.HEIC', bytes);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.type, 'image/jpeg');
    assert.match(r.json.path, /img-1234\.jpg$/);
    assert.deepEqual([r.json.width, r.json.height], [64, 48]);
    const stored = fs.readFileSync(path.join(fx.site, r.json.path));
    assert.deepEqual([...stored.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG in the repo');
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('markstage-heic-')), [], 'the temporary folder is gone');
  } finally {
    await conv.close();
  }
  assert.throws(() => loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { media: { heicCommand: ['heif-dec', 'in.heic'] } } }), /\{in\} and \{out\}/);
});
