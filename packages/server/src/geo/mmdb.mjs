// A reader for MaxMind DB files (.mmdb, https://maxmind.github.io/MaxMind-DB/): the format of MaxMind's GeoLite2 and
// GeoIP2 City and of DB-IP's "IP to City Lite". Read from disk a page at a time (a city file is 70 to 130 MB; a form
// message needs one lookup), never loaded whole. Only what a lookup needs: the binary search tree (24, 28 or 32 bit
// records, IPv4 or IPv6) and the data section's types.
import fs from 'node:fs';
import net from 'node:net';

const MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex'); // "\xAB\xCD\xEFMaxMind.com"
const PAGE = 4096;
const PAGES = 64;

export class MmdbError extends Error {}

/** The 16 bytes of an address (IPv4 as ::a.b.c.d inside an IPv6 tree), or null when it is not one. */
function bytesOf(ip) {
  const v = net.isIP(ip);
  if (v === 4) return { v, bytes: Buffer.from(ip.split('.').map(Number)) };
  if (v !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return { v: 4, bytes: Buffer.from(mapped[1].split('.').map(Number)) };
  const part = (s) =>
    (s ? s.split(':') : []).flatMap((g) => {
      if (!g.includes('.')) return [g];
      const [a, b, c, d] = g.split('.').map(Number);
      return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    });
  const [head, tail] = ip.split('::');
  const groups = tail === undefined ? part(head) : [...part(head), ...Array(8 - part(head).length - part(tail).length).fill('0'), ...part(tail)];
  const out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(Number.parseInt(g, 16), i * 2));
  return { v: 6, bytes: out };
}

/** Open a .mmdb file: {metadata, get(ip) → the record or null, close()}. Throws MmdbError when it is not one. */
export function openMmdb(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const cache = new Map();
  const page = (n) => {
    let b = cache.get(n);
    if (b) {
      cache.delete(n);
    } else {
      b = Buffer.alloc(Math.min(PAGE, size - n * PAGE));
      fs.readSync(fd, b, 0, b.length, n * PAGE);
      if (cache.size >= PAGES) cache.delete(cache.keys().next().value);
    }
    cache.set(n, b);
    return b;
  };
  const read = (off, len) => {
    if (off < 0 || off + len > size) throw new MmdbError('the file ends inside a record (it is cut short or not a MaxMind DB)');
    const first = Math.floor(off / PAGE);
    const last = Math.floor((off + len - 1) / PAGE);
    if (first === last) return page(first).subarray(off - first * PAGE, off - first * PAGE + len);
    const out = Buffer.alloc(len);
    for (let p = first, at = 0; p <= last; p++) {
      const b = page(p);
      const from = p === first ? off - first * PAGE : 0;
      const to = p === last ? off + len - p * PAGE : b.length;
      b.copy(out, at, from, to);
      at += to - from;
    }
    return out;
  };
  const uint = (off, len) => {
    let v = 0;
    for (const x of read(off, len)) v = v * 256 + x;
    return v;
  };

  /** Decode one value at `off` of a section starting at `base`: [value, next offset]. */
  function decode(base, off, depth = 0) {
    if (depth > 64) throw new MmdbError('the data nests too deep');
    const ctrl = uint(off++, 1);
    let type = ctrl >> 5;
    if (type === 1) {
      const ss = (ctrl >> 3) & 3;
      const v = ctrl & 7;
      const n = ss + 1;
      const raw = ss === 3 ? uint(off, 4) : v * 2 ** (8 * n) + uint(off, n);
      const target = raw + [0, 2048, 526336, 0][ss];
      return [decode(base, base + target, depth + 1)[0], off + n];
    }
    if (type === 0) type = 7 + uint(off++, 1);
    let len = ctrl & 31;
    if (len === 29) len = 29 + uint(off++, 1);
    else if (len === 30) (len = 285 + uint(off, 2)), (off += 2);
    else if (len === 31) (len = 65821 + uint(off, 3)), (off += 3);
    switch (type) {
      case 2:
        return [read(off, len).toString('utf8'), off + len];
      case 3:
        return [read(off, 8).readDoubleBE(0), off + 8];
      case 4:
        return [Buffer.from(read(off, len)), off + len];
      case 5:
      case 6:
      case 9:
      case 10:
        return [len > 6 ? BigInt(`0x${read(off, len).toString('hex') || '0'}`) : len ? uint(off, len) : 0, off + len];
      case 8: {
        const v = len ? uint(off, len) : 0;
        return [len === 4 && v >= 2 ** 31 ? v - 2 ** 32 : v, off + len];
      }
      case 7: {
        const m = {};
        for (let i = 0; i < len; i++) {
          const [k, a] = decode(base, off, depth + 1);
          const [v, b] = decode(base, a, depth + 1);
          m[k] = v;
          off = b;
        }
        return [m, off];
      }
      case 11: {
        const list = [];
        for (let i = 0; i < len; i++) {
          const [v, a] = decode(base, off, depth + 1);
          list.push(v);
          off = a;
        }
        return [list, off];
      }
      case 14:
        return [len !== 0, off];
      case 15:
        return [read(off, 4).readFloatBE(0), off + 4];
      default:
        throw new MmdbError(`unknown data type ${type}`);
    }
  }

  let metadata;
  let tree;
  try {
    const tailLen = Math.min(size, 128 * 1024);
    const at = read(size - tailLen, tailLen).lastIndexOf(MARKER);
    if (at < 0) throw new MmdbError('no MaxMind DB metadata (this is not an .mmdb file)');
    const start = size - tailLen + at + MARKER.length;
    metadata = decode(start, start)[0];
    const { node_count: nodes, record_size: rs, ip_version: ipv } = metadata;
    if (!Number.isInteger(nodes) || ![24, 28, 32].includes(rs) || ![4, 6].includes(ipv)) throw new MmdbError('its metadata has no usable tree (node_count, record_size, ip_version)');
    const treeSize = (rs * 2 * nodes) / 8;
    tree = { nodes, rs, ipv, dataStart: treeSize + 16 };
  } catch (e) {
    fs.closeSync(fd);
    throw e instanceof MmdbError ? e : new MmdbError(`it could not be read: ${e.message}`);
  }

  const record = (node, bit) => {
    const { rs } = tree;
    if (rs === 24) return uint(node * 6 + bit * 3, 3);
    if (rs === 32) return uint(node * 8 + bit * 4, 4);
    const b = read(node * 7, 7);
    return bit ? ((b[3] & 0x0f) << 24) | (b[4] << 16) | (b[5] << 8) | b[6] : ((b[3] & 0xf0) << 20) | (b[0] << 16) | (b[1] << 8) | b[2];
  };
  // where an IPv4 address starts in an IPv6 tree: 96 zero bits down
  let v4start = 0;
  if (tree.ipv === 6) for (let i = 0; i < 96 && v4start < tree.nodes; i++) v4start = record(v4start, 0);

  /** The record for an address, or null (not in the file, or not an address). */
  function get(ip) {
    const a = bytesOf(String(ip ?? '').trim());
    if (!a) return null;
    if (a.v === 6 && tree.ipv === 4) return null;
    const bits = a.v === 4 ? 32 : 128;
    let node = a.v === 4 && tree.ipv === 6 ? v4start : 0;
    for (let i = 0; i < bits && node < tree.nodes; i++) node = record(node, (a.bytes[i >> 3] >> (7 - (i & 7))) & 1);
    if (node <= tree.nodes) return null;
    const off = tree.dataStart + (node - tree.nodes - 16);
    return decode(tree.dataStart, off)[0];
  }

  return { metadata, get, close: () => fs.closeSync(fd) };
}
