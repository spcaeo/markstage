// A small QR code encoder for the 2FA setup (the otpauth:// link as a picture an authenticator app scans), so the
// secret never leaves the page for a QR service. Byte mode, error correction level M, versions 1 to 10 (up to 213
// bytes: an otpauth link is about 100). Follows ISO/IEC 18004: Reed-Solomon over GF(256), the eight masks scored
// by the standard's penalty rules, format and version information with their BCH codes.

// per version (index 1..10) at level M: [error correction codewords per block, [blocks, data codewords per block]…]
const BLOCKS: [number, [number, number][]][] = [
  [0, []],
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
];
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ---------- GF(256) and Reed-Solomon ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

function ecc(data: number[], degree: number): number[] {
  const g = generator(degree);
  const r = new Array(degree).fill(0);
  for (const d of data) {
    const f = d ^ r.shift()!;
    r.push(0);
    for (let i = 0; i < degree; i++) r[i] ^= mul(g[i + 1], f);
  }
  return r;
}

// ---------- data codewords ----------
function codewords(bytes: Uint8Array, version: number): number[] {
  const [ecLen, groups] = BLOCKS[version];
  const dataLen = groups.reduce((s, [n, k]) => s + n * k, 0);
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataLen * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0; data.length < dataLen; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  // split into blocks, add each block's error correction, then interleave
  const blocks: number[][] = [];
  let at = 0;
  for (const [n, k] of groups) {
    for (let i = 0; i < n; i++) {
      blocks.push(data.slice(at, at + k));
      at += k;
    }
  }
  const ecs = blocks.map((b) => ecc(b, ecLen));
  const out: number[] = [];
  const maxK = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxK; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

const capacity = (v: number) => Math.floor((BLOCKS[v][1].reduce((s, [n, k]) => s + n * k, 0) * 8 - 4 - (v < 10 ? 8 : 16)) / 8);

// ---------- the matrix ----------
type Grid = { size: number; dark: Uint8Array; fixed: Uint8Array };

function bch(value: number, poly: number, polyBits: number): number {
  let v = value << (polyBits - 1);
  for (let i = 31 - Math.clz32(v); i >= polyBits - 1; i--) if ((v >>> i) & 1) v ^= poly << (i - polyBits + 1);
  return v;
}

function base(version: number): Grid {
  const size = 17 + 4 * version;
  const g: Grid = { size, dark: new Uint8Array(size * size), fixed: new Uint8Array(size * size) };
  const set = (x: number, y: number, d: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    g.dark[y * size + x] = d ? 1 : 0;
    g.fixed[y * size + x] = 1;
  };
  // finder patterns with their separators
  for (const [fx, fy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(fx + dx, fy + dy, ring !== 2 && ring !== 4);
      }
    }
  }
  // alignment patterns (not over the finders)
  const pos = ALIGN[version];
  for (const ay of pos) {
    for (const ax of pos) {
      if (g.fixed[ay * size + ax]) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!g.fixed[6 * size + i]) set(i, 6, i % 2 === 0);
    if (!g.fixed[i * size + 6]) set(6, i, i % 2 === 0);
  }
  // reserve the format areas (written per mask) and the dark module
  for (let i = 0; i < 9; i++) {
    if (!g.fixed[8 * size + i]) set(i, 8, false);
    if (!g.fixed[i * size + 8]) set(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true);
  // version information (7 and up)
  if (version >= 7) {
    const bits = (version << 12) | bch(version, 0x1f25, 13);
    for (let i = 0; i < 18; i++) {
      const d = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(a, b, d);
      set(b, a, d);
    }
  }
  return g;
}

function place(g: Grid, words: number[]): void {
  const { size } = g;
  let bit = 0;
  const total = words.length * 8;
  let up = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let n = 0; n < size; n++) {
      const y = up ? size - 1 - n : n;
      for (let dx = 0; dx < 2; dx++) {
        const x = right - dx;
        const i = y * size + x;
        if (g.fixed[i]) continue;
        g.dark[i] = bit < total ? (words[bit >>> 3] >>> (7 - (bit & 7))) & 1 : 0;
        bit++;
      }
    }
    up = !up;
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function masked(g: Grid, mask: number): Uint8Array {
  const { size } = g;
  const out = g.dark.slice();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!g.fixed[y * size + x] && MASKS[mask](x, y)) out[y * size + x] ^= 1;
  // format information: level M (00) and the mask, BCH-coded and XORed with 0x5412
  const data = (0b00 << 3) | mask;
  const bits = ((data << 10) | bch(data, 0x537, 11)) ^ 0x5412;
  const at = (x: number, y: number, i: number) => (out[y * size + x] = (bits >>> i) & 1);
  for (let i = 0; i <= 5; i++) at(8, i, i);
  at(8, 7, 6);
  at(8, 8, 7);
  at(7, 8, 8);
  for (let i = 9; i < 15; i++) at(14 - i, 8, i);
  for (let i = 0; i < 8; i++) at(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) at(8, size - 15 + i, i);
  return out;
}

function penalty(m: Uint8Array, size: number): number {
  let p = 0;
  const get = (x: number, y: number) => m[y * size + x];
  // rule 1: runs of five or more of one colour, rows and columns
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = pass ? get(a, b) : get(b, a);
        const prev = pass ? get(a, b - 1) : get(b - 1, a);
        if (cur === prev) run++;
        else {
          if (run >= 5) p += run - 2;
          run = 1;
        }
      }
      if (run >= 5) p += run - 2;
    }
  }
  // rule 2: 2x2 blocks of one colour
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = get(x, y);
    if (c === get(x + 1, y) && c === get(x, y + 1) && c === get(x + 1, y + 1)) p += 3;
  }
  // rule 3: finder-like 1:1:3:1:1 patterns with four light modules on a side
  const pat = [1, 0, 1, 1, 1, 0, 1];
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b + 7 <= size; b++) {
        if (!pat.every((v, i) => (pass ? get(a, b + i) : get(b + i, a)) === v)) continue;
        const light = (from: number) => {
          for (let i = from; i < from + 4; i++) {
            if (i < 0 || i >= size) continue;
            if ((pass ? get(a, i) : get(i, a)) !== 0) return false;
          }
          return true;
        };
        if (light(b - 4) || light(b + 7)) p += 40;
      }
    }
  }
  // rule 4: the share of dark modules away from half
  const dark = m.reduce((s, v) => s + v, 0);
  p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return p;
}

/** The QR matrix of `text` ({size, dark(x, y)}); throws when it is longer than version 10 holds. */
export function qrMatrix(text: string): { size: number; dark: (x: number, y: number) => boolean } {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 10 && capacity(version) < bytes.length) version++;
  if (version > 10) throw new Error(`Too long for a QR code here (${bytes.length} bytes, at most ${capacity(10)}).`);
  const g = base(version);
  place(g, codewords(bytes, version));
  let best: Uint8Array | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = masked(g, mask);
    const s = penalty(m, g.size);
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
  }
  const out = best!;
  return { size: g.size, dark: (x, y) => out[y * g.size + x] === 1 };
}

/** The QR code of `text` as an SVG string (dark on white, with the required quiet zone). */
export function qrSvg(text: string, px = 200, label = 'QR code'): string {
  const { size, dark } = qrMatrix(text);
  const q = 4;
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (dark(x, y)) d += `M${x + q} ${y + q}h1v1h-1z`;
  const n = size + 2 * q;
  const esc = label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="${esc}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
