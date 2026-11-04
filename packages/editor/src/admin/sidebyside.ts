// The side-by-side compare: two versions of an entry next to each other, row by row, as the site shows them.
// Articles: each version is drawn by the canvas's own blocks (the editor's extensions, read-only, the site's article
// classes), then matched block by block; a changed block has its changed words marked, and any change can be put
// back on its own ("Restore this block") without restoring the whole revision. Pages (JSON): field by field.
import { Editor } from '@tiptap/core';
import { config } from '../runtime';
import { extensions } from '../schema';
import type { Doc, DocNode } from './api';
import { alike, diffList, words } from './diff';
import { button, el } from './ui';

export type Kind = 'same' | 'del' | 'ins' | 'change';
/** One row: the block's index on each side (null: not on that side). */
export interface BlockRow {
  kind: Kind;
  a: number | null;
  b: number | null;
}

const textOf = (n: DocNode): string => (n.text ?? '') + (n.content ?? []).map(textOf).join(n.type === 'doc' ? '\n' : '');
const key = (n: DocNode) => JSON.stringify(n);

/** The rows of two block lists: equal blocks matched (LCS); a removal and an addition of one type that read alike
 *  (or have no text, e.g. an image) pair up as a change. */
export function blockRows(A: DocNode[], B: DocNode[]): BlockRow[] {
  const ops = diffList(
    A.map((n, i) => ({ k: key(n), i })),
    B.map((n, i) => ({ k: key(n), i })),
    (x, y) => x.k === y.k,
  );
  const rows: BlockRow[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].op === 'same') {
      rows.push({ kind: 'same', a: ops[k].a!.i, b: ops[k].b!.i });
      continue;
    }
    const dels: number[] = [];
    const inss: number[] = [];
    for (; k < ops.length && ops[k].op !== 'same'; k++) (ops[k].op === 'del' ? dels.push(ops[k].a!.i) : inss.push(ops[k].b!.i));
    k--;
    for (let i = 0; i < Math.max(dels.length, inss.length); i++) {
      const d = dels[i];
      const s = inss[i];
      if (d !== undefined && s !== undefined && A[d].type === B[s].type && (alike(textOf(A[d]), textOf(B[s])) || (!textOf(A[d]).trim() && !textOf(B[s]).trim()))) rows.push({ kind: 'change', a: d, b: s });
      else {
        if (d !== undefined) rows.push({ kind: 'del', a: d, b: null });
        if (s !== undefined) rows.push({ kind: 'ins', a: null, b: s });
      }
    }
  }
  return rows;
}

/** The right side's blocks with one row put back as it is on the left: a change reverted, a removal re-inserted where
 *  it was, an addition taken out. */
export function restoreRow(rows: BlockRow[], A: DocNode[], B: DocNode[], r: number): DocNode[] {
  const row = rows[r];
  const out = B.slice();
  if (row.kind === 'change') out[row.b!] = A[row.a!];
  else if (row.kind === 'ins') out.splice(row.b!, 1);
  else if (row.kind === 'del') {
    // after the last right-side block before this row
    let at = 0;
    for (let i = 0; i < r; i++) if (rows[i].b !== null) at = rows[i].b! + 1;
    out.splice(at, 0, A[row.a!]);
  }
  return out;
}

/** Each top-level block of a document, drawn by the canvas's own extensions, as a static copy (no editor behind it). */
export function drawBlocks(doc: Doc): HTMLElement[] {
  const host = el('div', { 'aria-hidden': 'true', style: 'position:absolute;left:-100000px;top:0;width:720px' });
  document.body.append(host);
  let ed: Editor | null = null;
  try {
    ed = new Editor({ element: host, extensions: extensions(), content: doc, editable: false });
    const out: HTMLElement[] = [];
    ed.state.doc.forEach((_n, offset) => {
      const d = ed!.view.nodeDOM(offset);
      const copy = d instanceof HTMLElement ? (d.cloneNode(true) as HTMLElement) : el('div');
      for (const x of [copy, ...copy.querySelectorAll<HTMLElement>('[contenteditable],[draggable],[tabindex]')]) {
        x.removeAttribute('contenteditable');
        x.removeAttribute('draggable');
        x.removeAttribute('tabindex');
      }
      // buttons and fields of a block's own controls are not part of the page
      for (const x of copy.querySelectorAll('button, input, textarea, select')) x.remove();
      out.push(copy);
    });
    return out;
  } finally {
    ed?.destroy();
    host.remove();
  }
}

/** Wrap the character ranges [from, to) of `root`'s text in <tag class=…>, across text nodes. */
function markRanges(root: HTMLElement, ranges: [number, number][], tag: 'del' | 'ins'): void {
  if (!ranges.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let pos = 0;
  for (const t of nodes) {
    const start = pos;
    const end = pos + t.data.length;
    pos = end;
    const hits = ranges.filter(([f, e]) => f < end && e > start).map(([f, e]) => [Math.max(f, start) - start, Math.min(e, end) - start] as const);
    // from the end, so the earlier offsets stay right
    for (const [f, e] of hits.reverse()) {
      if (!t.data.slice(f, e).trim()) continue;
      const mid = t.splitText(f);
      mid.splitText(e - f);
      const w = document.createElement(tag);
      w.className = 'ms-adm-sbs__w';
      mid.replaceWith(w);
      w.append(mid);
    }
  }
}

/** Mark the words that differ between two drawn blocks (removed ones on the left, added ones on the right). */
function markWords(left: HTMLElement, right: HTMLElement): void {
  const ops = diffList(words(left.textContent ?? ''), words(right.textContent ?? ''));
  const del: [number, number][] = [];
  const ins: [number, number][] = [];
  let pa = 0;
  let pb = 0;
  for (const o of ops) {
    if (o.op !== 'ins') {
      if (o.op === 'del') del.push([pa, pa + o.a!.length]);
      pa += o.a!.length;
    }
    if (o.op !== 'del') {
      if (o.op === 'ins') ins.push([pb, pb + o.b!.length]);
      pb += o.b!.length;
    }
  }
  markRanges(left, del, 'del');
  markRanges(right, ins, 'ins');
}

const TAG: Record<Kind, string> = { same: '', del: 'Removed', ins: 'Added', change: 'Changed' };
const RESTORE: Record<Kind, string> = { same: '', del: 'Put this block back', ins: 'Take this block out', change: 'Restore this block' };

export interface SideBySideOptions {
  labels: [string, string];
  /** show every unchanged block (else long unchanged runs fold) */
  all: boolean;
  /** given when the right side is the current text and it may be edited: called with the new block list */
  onRestore?: (blocks: DocNode[], what: string) => Promise<void>;
}

/** The side-by-side view of two documents. Throws when a version cannot be drawn (the caller shows the text view). */
export function sideBySide(a: Doc, b: Doc, o: SideBySideOptions): HTMLElement {
  const A = a.content ?? [];
  const B = b.content ?? [];
  const rows = blockRows(A, B);
  const left = drawBlocks(a);
  const right = drawBlocks(b);
  const { articleClass, bodyClass } = config().canvas;
  // each cell sits in the site's article classes, so its blocks get the site's own styles
  const cell = (block: HTMLElement | null, side: 'a' | 'b', label: string) =>
    el(`div.ms-adm-sbs__cell.ms-adm-sbs__cell--${side}${block ? '' : '.is-empty'}`, { 'aria-label': label }, block ? el(`div.ms-adm-sbs__page.${articleClass.split(/\s+/).filter(Boolean).join('.')}`, el(`div.${['ms-adm-sbs__body', ...bodyClass.split(/\s+/).filter(Boolean)].join('.')}`, block)) : null);

  const grid = el('div.ms-adm-sbs', { role: 'region', 'aria-label': `${o.labels[0]} and ${o.labels[1]}, side by side` }, el('div.ms-adm-sbs__head', el('span', o.labels[0])), el('div.ms-adm-sbs__head', el('span', o.labels[1])));
  const row = (r: number): HTMLElement[] => {
    const x = rows[r];
    const l = x.a !== null ? (left[x.a].cloneNode(true) as HTMLElement) : null;
    const rr = x.b !== null ? (right[x.b].cloneNode(true) as HTMLElement) : null;
    if (x.kind === 'change' && l && rr) markWords(l, rr);
    const lc = cell(l, 'a', o.labels[0]);
    const rc = cell(rr, 'b', o.labels[1]);
    for (const c of [lc, rc]) c.classList.add(`is-${x.kind}`);
    if (x.kind !== 'same') {
      const tag = el('div.ms-adm-sbs__tag', el('span', TAG[x.kind]));
      if (o.onRestore) {
        const what = RESTORE[x.kind];
        const btn = button(what, async () => {
          btn.disabled = true;
          try {
            await o.onRestore!(restoreRow(rows, A, B, r), what);
          } finally {
            btn.disabled = false;
          }
        }, { small: true, icon: 'history' });
        btn.setAttribute('aria-label', `${what} (${TAG[x.kind].toLowerCase()} block ${r + 1})`);
        tag.append(btn);
      }
      lc.prepend(tag);
    }
    return [lc, rc];
  };
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== 'same' || o.all) {
      grid.append(...row(i));
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'same') j++;
    const lead = i > 0 ? 1 : 0;
    const trail = j < rows.length ? 1 : 0;
    if (j - i <= lead + trail + 1) for (let k = i; k < j; k++) grid.append(...row(k));
    else {
      if (lead) grid.append(...row(i));
      const from = i + lead;
      const to = j - trail;
      const fold = el('button.ms-adm-fold.ms-adm-sbs__fold', { type: 'button' }, `${to - from} unchanged block${to - from === 1 ? '' : 's'}`);
      fold.addEventListener('click', () => {
        const cells: HTMLElement[] = [];
        for (let k = from; k < to; k++) cells.push(...row(k));
        fold.replaceWith(...cells);
      });
      grid.append(fold);
      if (trail) grid.append(...row(j - 1));
    }
    i = j - 1;
  }
  return grid;
}

// ---------- pages (JSON): field by field ----------

type Leaf = { path: string; value: unknown };
/** Every leaf of a value with its dot path (an empty array or object is a leaf). */
function leaves(v: unknown, at = ''): Leaf[] {
  if (Array.isArray(v)) return v.length ? v.flatMap((x, i) => leaves(x, at ? `${at}.${i}` : String(i))) : [{ path: at, value: v }];
  if (v && typeof v === 'object') {
    const e = Object.entries(v);
    return e.length ? e.flatMap(([k, x]) => leaves(x, at ? `${at}.${k}` : k)) : [{ path: at, value: v }];
  }
  return [{ path: at, value: v }];
}

const show = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
/** A key as people read it: "ogImage" -> "Og image", "seo_title" -> "Seo title". */
const human = (k: string) => (/^\d+$/.test(k) ? `#${Number(k) + 1}` : (k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().replace(/^./, (ch) => ch.toUpperCase())));

/**
 * Field names as the site's settings drawer shows them (config `settings`: "excerpt" -> "Excerpt", "seo.title" ->
 * "Search engines: title"), else the key made readable. A path under a named field keeps its rest: "Tags › #2".
 */
export function fieldNamer(collection: string): (path: string) => string {
  const names = new Map<string, string>();
  const c = config()?.collections?.find((x) => x.id === collection);
  if (c?.titleKey) names.set(c.titleKey, 'Title');
  for (const f of c?.settings ?? []) {
    if ('key' in f) names.set(f.key, f.label);
    else for (const part of ['title', 'description', 'image'] as const) if (part in f) names.set((f as Record<string, string>)[part], `${f.label}: ${part}`);
  }
  return (path) => {
    const parts = path.split('.');
    for (let n = parts.length; n > 0; n--) {
      const hit = names.get(parts.slice(0, n).join('.'));
      if (hit) return [hit, ...parts.slice(n).map(human)].join(' › ');
    }
    return parts.map(human).join(' › ');
  };
}
const defaultName = (path: string) => path.split('.').map(human).join(' › ');
/** A path whose parent is an object (not an array item): it can be set or removed on its own. */
const settable = (path: string) => !/^\d+$/.test(path.split('.').pop() ?? '');

export interface FieldOptions {
  labels: [string, string];
  all: boolean;
  onRestore?: (changes: { path: string; value?: unknown; delete?: true }[], what: string) => Promise<void>;
  /** which paths can be restored on their own (default: not array items) */
  settable?: (path: string) => boolean;
  /** a field's name for people (fieldNamer); default: the key made readable */
  name?: (path: string) => string;
}

/** The field-by-field compare of two JSON entries. */
export function fieldCompare(a: Record<string, unknown>, b: Record<string, unknown>, o: FieldOptions): HTMLElement {
  const label = o.name ?? defaultName;
  const ops = diffList(leaves(a), leaves(b), (x, y) => x.path === y.path);
  const t = el('table.ms-adm-table.ms-adm-fields', el('thead', el('tr', el('th', 'Field'), el('th', o.labels[0]), el('th', o.labels[1]), o.onRestore ? el('th', el('span.ms-adm-sr', 'Restore')) : null)));
  const tb = el('tbody');
  let hidden = 0;
  for (const op of ops) {
    const path = (op.a ?? op.b)!.path;
    const av = op.a?.value;
    const bv = op.b?.value;
    const kind: Kind = op.op === 'same' ? (show(av) === show(bv) ? 'same' : 'change') : op.op;
    if (kind === 'same' && !o.all) {
      hidden++;
      continue;
    }
    let action: HTMLElement | null = null;
    if (o.onRestore && kind !== 'same') {
      const change = kind === 'ins' ? { path, delete: true as const } : { path, value: av };
      action = (o.settable ?? settable)(path)
        ? button(kind === 'ins' ? 'Take out' : 'Restore', () => o.onRestore!([change], `${kind === 'ins' ? 'Take out' : 'Restore'} ${label(path)}`), { small: true, icon: 'history' })
        : el('span.ms-adm-sub', 'Restore the whole revision');
    }
    tb.append(
      el(`tr.is-${kind}`,
        el('th', { scope: 'row', title: path }, label(path)),
        el('td', kind === 'ins' ? el('span.ms-adm-none', 'not there') : el(kind === 'same' ? 'span' : 'del', show(av))),
        el('td', kind === 'del' ? el('span.ms-adm-none', 'not there') : el(kind === 'same' ? 'span' : 'ins', show(bv))),
        o.onRestore ? el('td', action) : null,
      ),
    );
  }
  const wrap = el('div.ms-adm-card.ms-adm-card--flush', t);
  if (!tb.childElementCount) return el('p.ms-adm-lead', 'Every field is the same.');
  t.append(tb);
  if (hidden) wrap.append(el('p.ms-adm-sub.ms-adm-fields__more', `${hidden} unchanged field${hidden === 1 ? '' : 's'} not shown.`));
  return wrap;
}
