// The revisions' visual compare: two texts split into blocks (paragraphs, list items, front matter lines), the blocks
// matched by a longest-common-subsequence diff, and a block that changed shown with its changed words marked, so a
// writer sees "this sentence changed" rather than a unified diff.

export type Op<T> = { op: 'same' | 'del' | 'ins'; a?: T; b?: T };

/** LCS diff of two lists (common head and tail trimmed first; a very large middle falls back to delete + insert). */
export function diffList<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Op<T>[] {
  let head = 0;
  while (head < a.length && head < b.length && eq(a[head], b[head])) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && eq(a[a.length - 1 - tail], b[b.length - 1 - tail])) tail++;
  const A = a.slice(head, a.length - tail);
  const B = b.slice(head, b.length - tail);
  const mid: Op<T>[] = [];
  if (A.length * B.length > 4_000_000) {
    for (const x of A) mid.push({ op: 'del', a: x });
    for (const y of B) mid.push({ op: 'ins', b: y });
  } else {
    // lengths of the LCS of A[i:] and B[j:]
    const w = B.length + 1;
    const L = new Uint32Array((A.length + 1) * w);
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i * w + j] = eq(A[i], B[j]) ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
      if (eq(A[i], B[j])) mid.push({ op: 'same', a: A[i++], b: B[j++] });
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) mid.push({ op: 'del', a: A[i++] });
      else mid.push({ op: 'ins', b: B[j++] });
    }
    while (i < A.length) mid.push({ op: 'del', a: A[i++] });
    while (j < B.length) mid.push({ op: 'ins', b: B[j++] });
  }
  return [...a.slice(0, head).map((x, k) => ({ op: 'same' as const, a: x, b: b[k] })), ...mid, ...a.slice(a.length - tail).map((x, k) => ({ op: 'same' as const, a: x, b: b[b.length - tail + k] }))];
}

/** The blocks of a text: front matter lines one by one, then paragraphs (split at blank lines). */
export function blocks(text: string): string[] {
  const out: string[] = [];
  let rest = text.replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(rest);
  if (fm) {
    out.push('---', ...fm[1].split('\n'), '---');
    rest = rest.slice(fm[0].length);
  }
  // JSON: one block per line keeps a changed value on its own row
  if (/^\s*[{[]/.test(rest)) return [...out, ...rest.split('\n').filter((l) => l.trim())];
  for (const p of rest.split(/\n{2,}/)) if (p.trim()) out.push(p.replace(/^\n+|\s+$/g, ''));
  return out;
}

export const words = (s: string): string[] => s.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-]/gu) ?? [];

export type Piece = { text: string; kind: 'same' | 'del' | 'ins' };
export type Row = { kind: 'same' | 'del' | 'ins' | 'change'; pieces: Piece[] };

/** Rows to show: unchanged blocks, removed and added ones, and a changed one (a removal next to an addition that
 *  shares at least a third of its words) with its word changes. */
export function compare(before: string, after: string): Row[] {
  const ops = diffList(blocks(before), blocks(after));
  const rows: Row[] = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.op === 'same') {
      rows.push({ kind: 'same', pieces: [{ text: o.a!, kind: 'same' }] });
      continue;
    }
    // a run of removals and additions: pair them up in order where they look alike
    const dels: string[] = [];
    const inss: string[] = [];
    while (k < ops.length && ops[k].op !== 'same') {
      if (ops[k].op === 'del') dels.push(ops[k].a!);
      else inss.push(ops[k].b!);
      k++;
    }
    k--;
    const n = Math.max(dels.length, inss.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const s = inss[i];
      if (d !== undefined && s !== undefined && alike(d, s)) {
        const wo = diffList(words(d), words(s));
        rows.push({ kind: 'change', pieces: merge(wo.map((w) => ({ text: (w.op === 'ins' ? w.b : w.a)!, kind: w.op }))) });
      } else {
        if (d !== undefined) rows.push({ kind: 'del', pieces: [{ text: d, kind: 'del' }] });
        if (s !== undefined) rows.push({ kind: 'ins', pieces: [{ text: s, kind: 'ins' }] });
      }
    }
  }
  return rows;
}

export function alike(a: string, b: string): boolean {
  const wa = words(a).filter((w) => w.trim());
  const wb = words(b).filter((w) => w.trim());
  if (!wa.length || !wb.length) return false;
  const same = diffList(wa, wb).filter((o) => o.op === 'same').length;
  return same / Math.max(wa.length, wb.length) >= 1 / 3;
}

/** Neighbouring pieces of one kind joined (whitespace between two changes of one kind joins them too). */
function merge(ps: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const last = out[out.length - 1];
    const next = ps[i + 1];
    if (p.kind === 'same' && !p.text.trim() && last && next && last.kind === next.kind && last.kind !== 'same') {
      last.text += p.text;
      continue;
    }
    if (last && last.kind === p.kind) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/** How many blocks were added, removed and changed. */
export function tally(rows: Row[]): { added: number; removed: number; changed: number } {
  return { added: rows.filter((r) => r.kind === 'ins').length, removed: rows.filter((r) => r.kind === 'del').length, changed: rows.filter((r) => r.kind === 'change').length };
}
