// The live demo's "git diff": what a save would commit, as `git diff` prints it (a unified diff with three lines of
// context). Pure, no DOM (test/demo-diff.test.ts).

export type DiffLine = { kind: ' ' | '-' | '+'; text: string };

/** The lines of `before` and `after`, each kept, removed or added (a longest common subsequence of the lines). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // the same first and last lines are kept as they are, so the table only covers the part that moved
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const head = a.slice(0, start).map((text) => ({ kind: ' ' as const, text }));
  const tail = a.slice(endA).map((text) => ({ kind: ' ' as const, text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const n = x.length;
  const m = y.length;
  const middle: DiffLine[] = [];
  if (n * m > 4_000_000) {
    // too large to compare line by line here: all of it removed, then all of it added
    middle.push(...x.map((text) => ({ kind: '-' as const, text })), ...y.map((text) => ({ kind: '+' as const, text })));
  } else {
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) middle.push({ kind: ' ', text: x[i] }), i++, j++;
      // a removed line before the line that takes its place, as git prints them
      else if (i < n && (j === m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) middle.push({ kind: '-', text: x[i] }), i++;
      else middle.push({ kind: '+', text: y[j] }), j++;
    }
  }
  return [...head, ...middle, ...tail];
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

/** The changed parts with `context` lines around each, as git groups them. */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
  const changed = lines.map((l, i) => (l.kind === ' ' ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];
  const ranges: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  // line numbers in the old and the new file where each range starts
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let o = 1;
  let nn = 1;
  for (const l of lines) {
    oldAt.push(o);
    newAt.push(nn);
    if (l.kind !== '+') o++;
    if (l.kind !== '-') nn++;
  }
  return ranges.map(([from, to]) => {
    const part = lines.slice(from, to + 1);
    const oldLen = part.filter((l) => l.kind !== '+').length;
    const newLen = part.filter((l) => l.kind !== '-').length;
    const range = (at: number, len: number) => (len === 1 ? `${at}` : `${len ? at : at - 1},${len}`);
    return { header: `@@ -${range(oldAt[from], oldLen)} +${range(newAt[from], newLen)} @@`, lines: part };
  });
}

/** `git diff` of one file: the header lines, then each hunk. Empty when nothing changed. */
export function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return '';
  const parts = hunks(diffLines(before, after));
  const out = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`];
  for (const h of parts) out.push(h.header, ...h.lines.map((l) => `${l.kind}${l.text}`));
  return `${out.join('\n')}\n`;
}

/** How many lines a diff adds and removes ("+2 −1"). */
export function diffStat(before: string, after: string): { added: number; removed: number } {
  const lines = diffLines(before, after);
  return { added: lines.filter((l) => l.kind === '+').length, removed: lines.filter((l) => l.kind === '-').length };
}
