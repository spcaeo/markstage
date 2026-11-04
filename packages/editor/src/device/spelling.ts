// What a locale's respelling (the site's own text -> text function, e.g. Canadian spelling at the root) changes in
// the entry's text: the region preview lists each change once with how often it occurs, and the framed page
// highlights the respelled words. Line by line, word by word: a respelling keeps lines and, nearly always, the
// number of words; a line where it does not is compared as a whole.

export interface SpellingChange {
  from: string;
  to: string;
  count: number;
}

const WORDS = /([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u;

export function spellingChanges(text: string, spell: (text: string) => string): SpellingChange[] {
  const after = spell(text);
  if (after === text) return [];
  const found = new Map<string, SpellingChange>();
  const add = (from: string, to: string) => {
    const key = `${from.toLowerCase()}\u0000${to.toLowerCase()}`;
    const c = found.get(key);
    if (c) c.count++;
    else found.set(key, { from: from.toLowerCase(), to: to.toLowerCase(), count: 1 });
  };
  const a = text.split('\n');
  const b = after.split('\n');
  const same = a.length === b.length;
  for (let i = 0; i < (same ? a.length : 1); i++) {
    const x = same ? a[i] : text;
    const y = same ? b[i] : after;
    if (x === y) continue;
    const xs = x.split(WORDS);
    const ys = y.split(WORDS);
    if (xs.length !== ys.length) {
      add(x.trim(), y.trim());
      continue;
    }
    // odd indexes are words (split keeps the captured group); a run of changed words with only spaces between is
    // one change ("per cent"), so phrases read as written
    for (let k = 1; k < xs.length; k += 2) {
      if (xs[k] === ys[k]) continue;
      let from = xs[k];
      let to = ys[k];
      while (k + 2 < xs.length && xs[k + 2] !== ys[k + 2] && /^\s+$/.test(xs[k + 1]) && xs[k + 1] === ys[k + 1]) {
        from += xs[k + 1] + xs[k + 2];
        to += ys[k + 1] + ys[k + 2];
        k += 2;
      }
      add(from, to);
    }
  }
  return [...found.values()].sort((p, q) => q.count - p.count || p.from.localeCompare(q.from));
}
