// Three-way merge (base, mine, theirs) for the editor's "two people saved the same entry" case: a document's blocks
// (or a text's paragraphs) and its frontmatter. What only one side changed is taken from that side; what both
// changed the same way is taken once; what both changed differently is a conflict, returned with the three versions
// so the writer can pick (or keep both).
//
//   mergeBlocks(base, mine, theirs, key?) -> { parts: [{ take: [...] } | { conflict: { base, mine, theirs } }],
//                                             merged: [...] | null, conflicts: n, theirsTaken: n, mineTaken: n }
//   mergeData(base, mine, theirs)        -> { merged, conflicts: [path…] } (objects compared leaf by leaf)
//   splitBlocks(text)                    -> the text's paragraphs (blank-line separated; a fenced block is one)
//   resolve(parts, choices)              -> the merged list, with each conflict as chosen ('mine'|'theirs'|'both')

const keyOf = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** Index pairs [i, j] of a longest common subsequence of `a` and `b` (by key), in order. */
function common(a, b) {
  const n = a.length;
  const m = b.length;
  // the equal head and tail are matched directly (most merges touch a few blocks of many)
  let head = 0;
  while (head < n && head < m && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
  const A = a.slice(head, n - tail);
  const B = b.slice(head, m - tail);
  const w = B.length + 1;
  const len = new Uint32Array((A.length + 1) * w);
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      len[i * w + j] = A[i] === B[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
  const pairs = [];
  for (let i = 0; i < head; i++) pairs.push([i, i]);
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      pairs.push([head + i, head + j]);
      i++;
      j++;
    } else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
    else j++;
  }
  for (let t = 0; t < tail; t++) pairs.push([n - tail + t, m - tail + t]);
  return pairs;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function mergeBlocks(base, mine, theirs, key = keyOf) {
  const kb = base.map(key);
  const km = mine.map(key);
  const kt = theirs.map(key);
  const toMine = new Map(common(kb, km));
  const toTheirs = new Map(common(kb, kt));
  const parts = [];
  let theirsTaken = 0;
  let mineTaken = 0;
  const take = (items) => {
    if (!items.length) return;
    const last = parts[parts.length - 1];
    if (last?.take) last.take.push(...items);
    else parts.push({ take: [...items] });
  };
  const chunk = (b0, b1, m0, m1, t0, t1) => {
    const B = kb.slice(b0, b1);
    const M = km.slice(m0, m1);
    const T = kt.slice(t0, t1);
    if (same(M, B)) {
      if (!same(T, B)) theirsTaken++;
      take(theirs.slice(t0, t1));
    } else if (same(T, B) || same(M, T)) {
      mineTaken++;
      take(mine.slice(m0, m1));
    } else parts.push({ conflict: { base: base.slice(b0, b1), mine: mine.slice(m0, m1), theirs: theirs.slice(t0, t1) } });
  };
  let i = 0;
  let j = 0;
  let k = 0;
  for (let b = 0; b < base.length; b++) {
    const mj = toMine.get(b);
    const tk = toTheirs.get(b);
    // a block both sides kept is an anchor: what lies between two anchors is merged as one chunk
    if (mj === undefined || tk === undefined || mj < j || tk < k) continue;
    chunk(i, b, j, mj, k, tk);
    take([mine[mj]]);
    i = b + 1;
    j = mj + 1;
    k = tk + 1;
  }
  chunk(i, base.length, j, mine.length, k, theirs.length);
  const conflicts = parts.filter((p) => p.conflict).length;
  return { parts, merged: conflicts ? null : parts.flatMap((p) => p.take), conflicts, theirsTaken, mineTaken };
}

/** The merged list with each conflict as chosen: 'mine', 'theirs' or 'both' (mine, then theirs). */
export function resolve(parts, choices) {
  let c = 0;
  return parts.flatMap((p) => {
    if (p.take) return p.take;
    const pick = choices[c++] ?? 'mine';
    return pick === 'theirs' ? p.conflict.theirs : pick === 'both' ? [...p.conflict.mine, ...p.conflict.theirs] : p.conflict.mine;
  });
}

/** A text's paragraphs: blank-line separated, a fenced code block (``` or ~~~) kept whole. Joined with "\n\n". */
export function splitBlocks(text) {
  const out = [];
  let cur = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      cur.push(line);
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = null;
      continue;
    }
    if (f) fence = f;
    if (!line.trim() && !fence) {
      if (cur.length) out.push(cur.join('\n'));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

function leaves(v, path = '', out = new Map()) {
  if (isObject(v) && Object.keys(v).length) for (const [k, x] of Object.entries(v)) leaves(x, path ? `${path}.${k}` : k, out);
  else if (path) out.set(path, v);
  return out;
}

function setLeaf(obj, path, v) {
  const keys = path.split('.');
  let at = obj;
  for (const k of keys.slice(0, -1)) at = at[k] = isObject(at[k]) ? at[k] : {};
  if (v === undefined) delete at[keys[keys.length - 1]];
  else at[keys[keys.length - 1]] = v;
}

/** Objects (frontmatter) merged leaf by leaf; a leaf both sides changed differently is a conflict (mine is kept). */
export function mergeData(base = {}, mine = {}, theirs = {}) {
  const b = leaves(base);
  const m = leaves(mine);
  const t = leaves(theirs);
  const merged = structuredClone(mine);
  const conflicts = [];
  for (const path of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    const vb = keyOf(b.get(path) ?? null);
    const vm = keyOf(m.get(path) ?? null);
    const vt = keyOf(t.get(path) ?? null);
    if (vt === vb || vt === vm) continue;
    if (vm === vb) setLeaf(merged, path, t.get(path));
    else conflicts.push(path);
  }
  return { merged, conflicts };
}

/** The leaves of `to` that differ from `from` as [path, value] pairs (value undefined: the leaf is gone in `to`). */
export function changedLeaves(from = {}, to = {}) {
  const a = leaves(from);
  const b = leaves(to);
  const out = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) if (keyOf(a.get(path) ?? null) !== keyOf(b.get(path) ?? null)) out.push([path, b.get(path)]);
  return out;
}
