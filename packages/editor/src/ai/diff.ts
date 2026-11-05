// The writing help's diff (ai/rewrite.ts): the selected words against the suggested ones, word by word, as the
// writer reads them beside the selection: words taken out, words put in, the rest the same. Pure, so it is
// unit-tested (test/ai-rewrite.test.ts). The kept and taken-out parts always join to the selection, and the kept
// and put-in parts to the suggestion.

export interface DiffPart {
  op: 'same' | 'del' | 'add';
  text: string;
}

/** Words, the spaces between them and each punctuation mark, as separate pieces. */
export const pieces = (s: string): string[] => s.match(/\s+|[\p{L}\p{N}’'_-]+|[^\s\p{L}\p{N}]/gu) ?? [];

/** The longest run of pieces both share, in order (LCS); a selection is at most 4,000 characters. */
function lcs(a: string[], b: string[]): DiffPart[] {
  // the same start and end are kept out of the table
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end);
  const y = b.slice(start, b.length - end);
  const w = y.length + 1;
  const t = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const out: DiffPart[] = a.slice(0, start).map((text) => ({ op: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push({ op: 'same', text: x[i] });
      i++;
      j++;
    } else if (j >= y.length || (i < x.length && t[(i + 1) * w + j] >= t[i * w + j + 1])) out.push({ op: 'del', text: x[i++] });
    else out.push({ op: 'add', text: y[j++] });
  }
  for (const text of a.slice(a.length - end)) out.push({ op: 'same', text });
  return out;
}

/**
 * The diff, read as a person reads it: each change is one run taken out and one put in ("very big" → "huge"), so
 * a lone space kept between two changes joins them, in both runs.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const raw = lcs(pieces(before), pieces(after));
  const out: DiffPart[] = [];
  const add = (op: DiffPart['op'], text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.op === op) last.text += text;
    else out.push({ op, text });
  };
  for (let k = 0; k < raw.length; ) {
    if (raw[k].op === 'same') {
      add('same', raw[k++].text);
      continue;
    }
    // a group of changes, with the lone spaces kept between them
    const from = k;
    let del = '';
    let ins = '';
    let dels = 0;
    let adds = 0;
    while (k < raw.length) {
      const p = raw[k];
      if (p.op === 'same') {
        if (!/^\s+$/.test(p.text) || raw[k + 1]?.op === 'same' || k + 1 >= raw.length) break;
        del += p.text;
        ins += p.text;
      } else if (p.op === 'del') (del += p.text), dels++;
      else (ins += p.text), adds++;
      k++;
    }
    if (dels && adds) {
      // spaces both runs start or end with are kept, not changed ("alot " → "a lot " is "alot" → "a lot")
      const lead = /^\s*/.exec(del)![0] === /^\s*/.exec(ins)![0] ? /^\s*/.exec(del)![0] : '';
      const end = /\s*$/.exec(del)![0];
      const trail = end === /\s*$/.exec(ins)![0] && lead.length + end.length < Math.min(del.length, ins.length) ? end : '';
      add('same', lead);
      add('del', del.slice(lead.length, del.length - trail.length));
      add('add', ins.slice(lead.length, ins.length - trail.length));
      add('same', trail);
    } else for (const p of raw.slice(from, k)) add(p.op, p.text);
    // a group that only takes out, or only puts in, keeps its spaces as they were (above)
  }
  // a run that only takes out or puts in reads "down [in order ]to", not "down[ in order] to": the space it starts
  // with slides to its end when the kept words after it start with that same space
  for (let k = 1; k < out.length - 1; k++) {
    const [prev, p, next] = [out[k - 1], out[k], out[k + 1]];
    if (p.op === 'same' || prev.op !== 'same' || next.op !== 'same') continue;
    const ch = p.text[0];
    if (/\s/.test(ch) && next.text[0] === ch && p.text.length > 1) {
      prev.text += ch;
      p.text = p.text.slice(1) + ch;
      next.text = next.text.slice(1);
      if (!next.text) out.splice(k + 1, 1);
    }
  }
  return out;
}

/** How much changed, in words: "3 words out, 1 in", or "No change". */
export function changeWords(parts: DiffPart[]): string {
  const count = (op: DiffPart['op']) => parts.filter((p) => p.op === op).reduce((n, p) => n + (p.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0);
  const out = count('del');
  const inn = count('add');
  if (!out && !inn) return parts.some((p) => p.op !== 'same') ? 'Only spaces or punctuation change' : 'No change';
  const w = (n: number) => `${n} word${n === 1 ? '' : 's'}`;
  return [out && `${w(out)} out`, inn && `${w(inn)} in`].filter(Boolean).join(', ');
}
