// Reading a .zip (pictures sent in one file for the media library): its central directory, then each file, stored or
// deflated. No other compression, no encryption, no zip64; sizes are capped before and while unpacking, so a small
// file that unpacks to gigabytes stops at the cap.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { badRequest } from '../util.mjs';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
// the list of files is read whole: 500 entries with long names fit in far less
const MAX_CENTRAL = 16 * 1024 * 1024;

/** A zip on disk, read in place (`fs.readSync` at positions): `{size, read(start, length), close()}`. */
export function fileSource(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  return {
    size,
    read(start, length) {
      const want = Math.max(0, Math.min(length, size - start));
      const buf = Buffer.alloc(want);
      let got = 0;
      while (got < want) {
        const n = fs.readSync(fd, buf, got, want - got, start + got);
        if (n === 0) break;
        got += n;
      }
      return got === want ? buf : buf.subarray(0, got);
    },
    close() {
      fs.closeSync(fd);
    },
  };
}

const sourceOf = (src) => (Buffer.isBuffer(src) ? { size: src.length, read: (start, length) => src.subarray(start, start + length) } : src);

/**
 * The files of a zip: [{name, size, read(): Buffer}] (folders and Mac resource forks left out). `src` is the
 * whole zip as a Buffer, or a file source (fileSource): then only the list of files and, on read(), one entry at a
 * time are in memory.
 */
export function readZip(src, { maxEntries = 1000, maxEntryBytes = 50 * 1024 * 1024 } = {}) {
  const zip = sourceOf(src);
  // the end record is in the last 64 KB (+ its own 22 bytes); look for it there
  const tailAt = Math.max(0, zip.size - 22 - 0xffff);
  const tail = zip.read(tailAt, zip.size - tailAt);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw badRequest('This is not a zip file (or it is damaged).');
  const count = tail.readUInt16LE(end + 10);
  const cdSize = tail.readUInt32LE(end + 12);
  const cdAt = tail.readUInt32LE(end + 16);
  if (count > maxEntries) throw badRequest(`This zip holds ${count} files; at most ${maxEntries} are taken at once.`);
  if (cdSize > MAX_CENTRAL || cdAt + cdSize > zip.size) throw badRequest('This zip file is damaged (its list of files cannot be read).');
  const buf = zip.read(cdAt, cdSize);
  let at = 0;
  const out = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== CENTRAL) throw badRequest('This zip file is damaged (its list of files cannot be read).');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\.[^/]*$/.test(name)) continue;
    const entry = { name, size: usize, problem: null };
    if (flags & 1) entry.problem = 'encrypted, left out';
    else if (method !== 0 && method !== 8) entry.problem = 'packed in a way this server does not read, left out';
    else if (usize > maxEntryBytes || csize === 0xffffffff) entry.problem = `larger than ${Math.round(maxEntryBytes / 1024 / 1024)} MB, left out`;
    /** The entry's stored bytes, or only its first `limit` of them. */
    const packed = (limit = csize) => {
      const head = zip.read(local, 30);
      if (head.length < 30 || head.readUInt32LE(0) !== LOCAL) throw badRequest(`${name}: damaged in the zip.`);
      const start = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const want = Math.min(csize, limit);
      const data = zip.read(start, want);
      if (data.length !== want) throw badRequest(`${name}: cut short in the zip.`);
      return data;
    };
    /** The first bytes unpacked (enough to tell what the file is), without unpacking the rest. */
    entry.head = (n = 4096) => {
      const data = packed(n + 1024);
      if (method === 0) return data.subarray(0, n);
      try {
        return zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, n);
      } catch {
        return Buffer.alloc(0);
      }
    };
    entry.read = () => {
      if (entry.problem) throw badRequest(`${name}: ${entry.problem}`);
      const data = packed();
      if (method === 0) return data;
      try {
        return zlib.inflateRawSync(data, { maxOutputLength: maxEntryBytes });
      } catch {
        throw badRequest(`${name}: damaged or larger than ${Math.round(maxEntryBytes / 1024 / 1024)} MB unpacked.`);
      }
    };
    out.push(entry);
  }
  return out;
}
