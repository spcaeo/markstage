// A small MaxMind DB writer for the tests (https://maxmind.github.io/MaxMind-DB/): a tree of the networks given, in
// 24, 28 or 32 bit records, IPv4 or IPv6, and a data section where a repeated string is a pointer to its first copy,
// so the reader's pointers are exercised. Made up places only.
const MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex');

function sized(type, size) {
  const ext = type > 7;
  const head = [(ext ? 0 : type << 5) | (size < 29 ? size : size < 285 ? 29 : size < 65821 ? 30 : 31)];
  if (ext) head.push(type - 7);
  if (size >= 29 && size < 285) head.push(size - 29);
  else if (size >= 285 && size < 65821) head.push((size - 285) >> 8, (size - 285) & 255);
  else if (size >= 65821) head.push(((size - 65821) >> 16) & 255, ((size - 65821) >> 8) & 255, (size - 65821) & 255);
  return Buffer.from(head);
}

function pointer(off) {
  if (off < 2048) return Buffer.from([0x20 | (off >> 8), off & 255]);
  if (off < 526336) {
    const v = off - 2048;
    return Buffer.from([0x28 | (v >> 16), (v >> 8) & 255, v & 255]);
  }
  const v = off - 526336;
  return Buffer.from([0x30 | ((v >> 24) & 7), (v >> 16) & 255, (v >> 8) & 255, v & 255]);
}

const uintBytes = (n, max) => {
  const out = [];
  for (let x = BigInt(n); x > 0n; x >>= 8n) out.unshift(Number(x & 255n));
  if (out.length > max) throw new Error('too big');
  return Buffer.from(out);
};

/** An encoder over one section: strings seen before become pointers. Typed numbers: {uint16|uint32|uint64|int32|double|float: n}. */
function encoder() {
  const parts = [];
  let size = 0;
  const strings = new Map();
  const push = (b) => {
    parts.push(b);
    size += b.length;
  };
  function value(v) {
    if (typeof v === 'string') {
      if (strings.has(v)) return push(pointer(strings.get(v)));
      strings.set(v, size);
      const b = Buffer.from(v, 'utf8');
      return push(Buffer.concat([sized(2, b.length), b]));
    }
    if (typeof v === 'boolean') return push(sized(14, v ? 1 : 0));
    if (typeof v === 'number') return value(Number.isInteger(v) && v >= 0 ? { uint32: v } : { double: v });
    if (Array.isArray(v)) {
      push(sized(11, v.length));
      return v.forEach(value);
    }
    if (v && typeof v === 'object') {
      const [k] = Object.keys(v);
      if (k === 'uint16' || k === 'uint32' || k === 'uint64') {
        const b = uintBytes(v[k], { uint16: 2, uint32: 4, uint64: 8 }[k]);
        return push(Buffer.concat([sized({ uint16: 5, uint32: 6, uint64: 9 }[k], b.length), b]));
      }
      if (k === 'int32') {
        const b = Buffer.alloc(4);
        b.writeInt32BE(v.int32);
        return push(Buffer.concat([sized(8, 4), b]));
      }
      if (k === 'double') {
        const b = Buffer.alloc(8);
        b.writeDoubleBE(v.double);
        return push(Buffer.concat([sized(3, 8), b]));
      }
      if (k === 'float') {
        const b = Buffer.alloc(4);
        b.writeFloatBE(v.float);
        return push(Buffer.concat([sized(15, 4), b]));
      }
      const entries = Object.entries(v);
      push(sized(7, entries.length));
      for (const [key, x] of entries) {
        value(key);
        value(x);
      }
      return;
    }
    throw new Error(`cannot encode ${v}`);
  }
  return { value, at: () => size, bytes: () => Buffer.concat(parts) };
}

const bitsOf = (cidr, v6tree) => {
  const [ip, len] = cidr.split('/');
  const bytes = ip.includes(':') ? null : ip.split('.').map(Number);
  if (!bytes) throw new Error('the writer takes IPv4 networks only');
  const bits = bytes.flatMap((b) => [...Array(8)].map((_, i) => (b >> (7 - i)) & 1)).slice(0, Number(len));
  return v6tree ? [...Array(96).fill(0), ...bits] : bits;
};

/** The bytes of a .mmdb: networks [{cidr, data}], ipVersion 4|6, recordSize 24|28|32, databaseType. */
export function writeMmdb({ networks, ipVersion = 6, recordSize = 24, databaseType = 'GeoLite2-City', description = { en: 'test' }, buildEpoch = 1761609600 }) {
  const data = encoder();
  const root = {};
  for (const n of networks) {
    const off = data.at();
    data.value(n.data);
    const bits = bitsOf(n.cidr, ipVersion === 6);
    let node = root;
    bits.forEach((bit, i) => {
      if (i === bits.length - 1) node[bit] = { leaf: off };
      else node = node[bit] ??= {};
    });
  }
  const order = [];
  const queue = [root];
  while (queue.length) {
    const n = queue.shift();
    n.id = order.push(n) - 1;
    for (const b of [0, 1]) if (n[b] && !('leaf' in n[b])) queue.push(n[b]);
  }
  const count = order.length;
  const rec = (c) => (!c ? count : 'leaf' in c ? count + 16 + c.leaf : c.id);
  const tree = Buffer.alloc((recordSize * 2 * count) / 8);
  for (const n of order) {
    const [l, r] = [rec(n[0]), rec(n[1])];
    if (recordSize === 24) tree.writeUIntBE(l, n.id * 6, 3), tree.writeUIntBE(r, n.id * 6 + 3, 3);
    else if (recordSize === 32) tree.writeUInt32BE(l, n.id * 8), tree.writeUInt32BE(r, n.id * 8 + 4);
    else {
      const o = n.id * 7;
      tree.writeUIntBE(l & 0xffffff, o, 3);
      tree[o + 3] = ((l >> 24) << 4) | (r >> 24);
      tree.writeUIntBE(r & 0xffffff, o + 4, 3);
    }
  }
  const meta = encoder();
  meta.value({
    node_count: { uint32: count },
    record_size: { uint16: recordSize },
    ip_version: { uint16: ipVersion },
    database_type: databaseType,
    languages: ['en'],
    binary_format_major_version: { uint16: 2 },
    binary_format_minor_version: { uint16: 0 },
    build_epoch: { uint64: buildEpoch },
    description,
  });
  return Buffer.concat([tree, Buffer.alloc(16), data.bytes(), MARKER, meta.bytes()]);
}
