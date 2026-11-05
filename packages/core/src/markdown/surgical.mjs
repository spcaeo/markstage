// The surgical save: print the document against the original file. A block that prints the same as a block of the
// original is written back as that block's exact source (and the spacing between unchanged neighbours is kept);
// a changed wrap block or list keeps the unchanged parts inside it. Only changed or new blocks use the printer.

import { keepListsApart } from './lists.mjs';
import { containerHead } from './mdx.mjs';

// Longest common subsequence of two string lists -> matched index pairs, in order.
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Blocks are matched by their printed text without the printing hints (link outer/order), so an editor that drops
// a hint never makes an unedited block look changed.
const HINTS = new Set(['outer', 'order']);
const unhinted = (node) => JSON.parse(JSON.stringify(node, (k, v) => (HINTS.has(k) ? undefined : v)));

export function makeSurgical(reg, printer) {
  const { printBlock, printItem, listMarker } = printer;
  // the key leaves out the neighbour (it only picks a list's marker, and keepListsApart sees to that on the result),
  // so a block that moves still matches its source
  const blockKey = (n) => printBlock(unhinted(n));

  // nodes against the original entries -> { text, changed }
  function emitBlocks(nodes, orig, body, sep = '\n\n') {
    const printed = nodes.map((n, k) => printBlock(n, { prev: nodes[k - 1] }));
    const keys = nodes.map((n) => blockKey(n));
    const origKeys = orig.map((e) => (e.key ??= blockKey(e.node)));
    const pairs = lcs(keys, origKeys);
    const at = new Array(nodes.length).fill(-1);
    const same = new Array(nodes.length).fill(false);
    for (const [i, j] of pairs) {
      at[i] = j;
      same[i] = true;
    }
    // Inside each gap between matches, pair changed nodes with original nodes of the same type, in order.
    let pi = 0;
    let pj = 0;
    for (const [i, j] of [...pairs, [nodes.length, orig.length]]) {
      const free = [];
      for (let jj = pj; jj < j; jj++) free.push(jj);
      for (let ii = pi; ii < i; ii++) {
        const f = free.findIndex((jj) => orig[jj].node.type === nodes[ii].type);
        if (f >= 0) at[ii] = free.splice(0, f + 1)[f];
      }
      pi = i + 1;
      pj = j + 1;
    }
    // A block moved out of its gap: it prints the same as an original block nothing else took, so its exact source
    // goes with it (written where it now is, so it counts as changed).
    const taken = new Set(at.filter((j) => j >= 0));
    const source = new Array(nodes.length).fill(-1);
    nodes.forEach((_, k) => {
      if (at[k] >= 0) return;
      const j = origKeys.findIndex((key, jj) => key === keys[k] && !taken.has(jj));
      if (j >= 0) taken.add((source[k] = j));
    });
    // prevAt: the original index of the last emitted node (-1 for a new one); only two original neighbours keep the
    // spacing between them, so a block inserted before the first one never reads orig[-1]
    const pieces = [];
    let changed = 0;
    let prevAt = -1;
    nodes.forEach((node, k) => {
      let piece;
      if (same[k]) piece = body.slice(orig[at[k]].start, orig[at[k]].end);
      else {
        changed++;
        if (source[k] >= 0) piece = body.slice(orig[source[k]].start, orig[source[k]].end);
        else piece = at[k] >= 0 ? emitChanged(node, orig[at[k]], body, printed[k]) : printed[k];
      }
      if (piece === '') return;
      const gap = prevAt >= 0 && at[k] === prevAt + 1 ? body.slice(orig[prevAt].end, orig[at[k]].start) : sep;
      pieces.push({ type: node.type, text: piece, gap, same: same[k] });
      prevAt = at[k];
    });
    // lists that now sit next to a list of the same marker get another one (an unchanged list re-marked is changed)
    let text = '';
    keepListsApart(pieces).forEach((t, k) => {
      if (t !== pieces[k].text && pieces[k].same) changed++;
      text += (k ? pieces[k].gap : '') + t;
    });
    return { text, changed };
  }

  // A changed node that has an original counterpart of the same type: wraps and lists keep their unchanged insides.
  function emitChanged(node, e, body, printed) {
    // an MDX container (the same component, its tags as written): its props written into its opening text, and
    // its unchanged children kept as they are
    if (node.type === 'mdxContainer' && e.kids?.length && node.content?.length && node.attrs?.open === e.node.attrs?.open && node.attrs?.close === e.node.attrs?.close) {
      return containerHead(node.attrs) + emitBlocks(node.content, e.kids, body).text + node.attrs.close;
    }
    if (reg.isWrap(node.type) && e.kids?.length && node.content?.length) {
      const head = reg.printOpen(node) === reg.printOpen(e.node) ? body.slice(e.start, e.inner[0]) : reg.printOpen(node) + '\n\n';
      const tail = reg.printClose(node) === reg.printClose(e.node) ? body.slice(e.inner[1], e.end) : '\n\n' + reg.printClose(node);
      return head + emitBlocks(node.content, e.kids, body).text + tail;
    }
    if ((node.type === 'bulletList' || node.type === 'orderedList') && e.kids?.length && node.content?.length) {
      if ((node.attrs?.tight !== false) !== (e.node.attrs?.tight !== false)) return printed;
      return emitList(node, e, body);
    }
    return printed;
  }

  function emitList(node, e, body) {
    const tight = node.attrs?.tight !== false;
    const items = node.content;
    const m = /^(?:([-*+])|(\d+)([.)]))( +)/.exec(body.slice(e.kids[0].start, e.kids[0].end));
    const marker = (k) => {
      if (!m) return listMarker(node, k);
      if (m[1]) return m[1] + m[4];
      return `${(node.attrs?.start ?? 1) + k}${m[3]}${m[4]}`;
    };
    const printedItems = items.map((item, k) => printItem(item, marker(k), tight));
    const origItems = e.kids.map((kid) => (kid.key ??= printItem(unhinted(kid.node), '', tight)));
    const pairs = lcs(
      items.map((item) => printItem(unhinted(item), '', tight)),
      origItems,
    );
    const at = new Map(pairs.map(([i, j]) => [i, j]));
    let text = '';
    let prevAt = -1;
    items.forEach((item, k) => {
      const j = at.has(k) ? at.get(k) : -1;
      let piece = printedItems[k];
      if (j >= 0) {
        piece = body.slice(e.kids[j].start, e.kids[j].end);
        if (node.type === 'orderedList') piece = piece.replace(/^\d+/, String((node.attrs?.start ?? 1) + k));
      }
      if (text !== '') text += prevAt >= 0 && j === prevAt + 1 ? body.slice(e.kids[prevAt].end, e.kids[j].start) : tight ? '\n' : '\n\n';
      text += piece;
      prevAt = j;
    });
    return text;
  }

  return { emitBlocks };
}
