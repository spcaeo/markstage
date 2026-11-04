// Big imports never sit in memory, and one runs at a time (docs/SECURITY.md "Uploads", M5 of the 2026-11-02 review):
// a media zip and a Library file are streamed to <dataDir>/tmp (0600), read from there, and removed when done;
// over media.importMaxBytes / library.importMaxBytes the answer is 413 and nothing is kept; a second import while one
// runs is 409 busy; the zip reader gives the same entries from a file as from a Buffer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { fileSource, readZip } from '../src/media/zip.mjs';
import { loadConfig } from '../src/app.mjs';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';

/** A zip with these files (deflated), as a browser would send it. */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const packed = zlib.deflateRawSync(data);
    const n = Buffer.from(name);
    const crc = zlib.crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    locals.push(head, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, n);
    offset += head.length + n.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const MB = 1024 * 1024;

describe('imports: streamed to a file, bounded, one at a time', () => {
  let fx, srv, ed;
  const tmp = () => (fs.existsSync(path.join(fx.data, 'tmp')) ? fs.readdirSync(path.join(fx.data, 'tmp')) : []);
  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { overrides: { media: { importMaxBytes: MB }, library: { importMaxBytes: MB } } });
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('the zip reader: the same files from a file on disk as from a Buffer, one entry in memory at a time', () => {
    const big = Buffer.alloc(300 * 1024, 7);
    const zip = makeZip({ 'a.png': makePng(Buffer.from('a')), 'dir/b.bin': big, 'c.txt': Buffer.from('hello') });
    const file = path.join(fx.run, 'reader.zip');
    fs.writeFileSync(file, zip);
    const fromBuf = readZip(zip);
    const src = fileSource(file);
    try {
      const fromFile = readZip(src);
      assert.deepEqual(fromFile.map((e) => [e.name, e.size, e.problem]), fromBuf.map((e) => [e.name, e.size, e.problem]));
      assert.deepEqual(fromFile.map((e) => e.name), ['a.png', 'dir/b.bin', 'c.txt']);
      assert.ok(fromFile[1].read().equals(big), 'a 300 KB entry reads back whole');
      assert.ok(fromFile[1].head(16).equals(big.subarray(0, 16)), 'the head without unpacking the rest');
      assert.equal(fromFile[2].read().toString(), 'hello');
      assert.throws(() => readZip(src, { maxEntryBytes: 1024 })[1].read(), /larger than 0 MB/);
    } finally {
      src.close();
    }
    assert.throws(() => readZip(Buffer.from('not a zip at all, but long enough to hold an end record')), /not a zip file/);
  });

  test('a media zip over media.importMaxBytes is 413 and leaves no file; a good one is read from <dataDir>/tmp and the file goes when the job ends', async () => {
    const send = (body, q = '') => ed.request('POST', `/media/import/zip?filename=big.zip${q}`, { body, headers: { 'Content-Type': 'application/zip' } });
    const over = await send(Buffer.alloc(MB + 1, 1));
    assert.equal(over.status, 413);
    assert.match(over.json.message, /larger than 1 MB/);
    assert.deepEqual(tmp(), [], 'nothing kept');
    // the header may lie: the body is counted as it streams
    const u = new URL(srv.base);
    const lying = await new Promise((resolve, reject) => {
      const req = http.request({ host: u.hostname, port: u.port, method: 'POST', path: '/markstage/api/media/import/zip?dry=1', headers: { Origin: srv.base, Cookie: [...ed.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'X-CSRF-Token': ed.csrf, 'Content-Type': 'application/zip', 'Transfer-Encoding': 'chunked', Connection: 'close' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      for (let i = 0; i < 12; i++) req.write(Buffer.alloc(100 * 1024, 2));
      req.end();
    });
    assert.equal(lying, 413);
    assert.deepEqual(tmp(), []);
    const zip = makeZip({ 'a.png': makePng(Buffer.from('a')), 'b.png': makePng(Buffer.from('b')) });
    const dry = await send(zip, '&dry=1');
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual(dry.json.items.map((i) => i.name), ['a.png', 'b.png']);
    assert.deepEqual(tmp(), [], 'a dry run removes its file at once');
    const freed = srv.app.importLock.take('test');
    assert.ok(freed, 'and frees the lock');
    freed();
    const go = await send(zip);
    assert.equal(go.status, 200, go.text);
    await srv.app.jobs.idle();
    assert.equal((await ed.get(`/jobs/${go.json.job.id}`)).json.status, 'succeeded');
    assert.deepEqual(tmp(), [], 'the job removed the file');
    const free = srv.app.importLock.take('test');
    assert.ok(free, 'the lock is free after the job');
    free();
    const mode = fs.statSync(path.join(fx.data, 'tmp')).mode & 0o777;
    assert.equal(mode, 0o700);
  });

  test('one import at a time: while one runs, a media zip and a Library import answer 409 busy', async () => {
    const release = srv.app.importLock.take('a running import');
    try {
      const zip = await ed.request('POST', '/media/import/zip?dry=1', { body: makeZip({ 'a.png': makePng() }), headers: { 'Content-Type': 'application/zip' } });
      assert.equal(zip.status, 409);
      assert.deepEqual([zip.json.error, zip.json.message], ['busy', 'Another import is running. Try again when it is done.']);
      const lib = await ed.request('POST', '/library/import?dry=1&filename=pack.json', { body: Buffer.from('{"items":[]}'), headers: { 'Content-Type': 'application/json' } });
      assert.equal(lib.status, 409);
    } finally {
      release();
    }
    const after = await ed.request('POST', '/library/import?dry=1&filename=pack.json', { body: Buffer.from('{"items":[]}'), headers: { 'Content-Type': 'application/json' } });
    assert.notEqual(after.status, 409, after.text);
    assert.deepEqual(tmp(), [], 'a Library import leaves no file');
  });

  test('a Library import over library.importMaxBytes is 413 and leaves no file', async () => {
    const r = await ed.request('POST', '/library/import?filename=pack.json', { body: Buffer.alloc(MB + 1, 0x20), headers: { 'Content-Type': 'application/json' } });
    assert.equal(r.status, 413);
    assert.deepEqual(tmp(), []);
  });

  test('the limits are config: whole bytes from 1 MB to 2 GB, 64 MB by default', () => {
    const load = (overrides) => loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides });
    assert.equal(load({}).media.importMaxBytes, 64 * MB);
    assert.equal(load({}).library.importMaxBytes, 64 * MB);
    assert.throws(() => load({ media: { importMaxBytes: 1000 } }), /media\.importMaxBytes must be a whole number of bytes from 1 MB to 2 GB/);
    assert.throws(() => load({ library: { importMaxBytes: '64MB' } }), /library\.importMaxBytes/);
    assert.equal(load({ library: { importMaxBytes: 128 * MB } }).library.importMaxBytes, 128 * MB);
  });
});
