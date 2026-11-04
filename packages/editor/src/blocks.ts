// Moving the article's blocks (its top-level nodes) and the items inside a box (FAQ questions, list items, fact
// cards: the children of a node), the same from the keyboard, the block grip, the Outline and a box's panel: one
// transaction per move, so one ⌘Z takes it back, and the same node objects land in their new place (a moved block
// is not rewritten when the file is saved). Alt+↑ / Alt+↓ on the canvas move the innermost item the caret is in
// (a list item, an FAQ question), or every item the selection spans, else the block; a screen reader hears where
// they went.
import { Extension, type Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { blockLock, lockReason } from './locks';
import { boxLabel } from './runtime';
import { moveRow, tableAt } from './tables';

/** Where each child of the node whose content starts at `base` starts (the document: base 0). */
export function childStarts(parent: PMNode, base = 0): number[] {
  const out: number[] = [];
  parent.forEach((_, offset) => out.push(base + offset));
  return out;
}

/** Where each top-level block starts. */
export const blockStarts = (doc: PMNode) => childStarts(doc);

/** How many blocks the article has: the empty line the canvas keeps at the end to type into is not one (it is not
 *  saved), so "to the bottom" lands before it. */
export function blockCount(doc: PMNode): number {
  const last = doc.lastChild;
  return doc.childCount > 1 && last?.type.name === 'paragraph' && !last.content.size ? doc.childCount - 1 : doc.childCount;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** The children at `indexes` taken out and put back at `to`, or null when nothing would change or the box does not
 *  allow that order (a pros / cons box keeps pros first). */
function reordered(parent: PMNode, indexes: number[], to: number): { idx: number[]; at: number } | null {
  const idx = [...new Set(indexes)].filter((i) => i >= 0 && i < parent.childCount).sort((x, y) => x - y);
  if (!idx.length) return null;
  const at = Math.max(0, Math.min(to, parent.childCount - idx.length));
  if (idx[idx.length - 1]! - idx[0]! === idx.length - 1 && idx[0] === at) return null;
  const rest: PMNode[] = [];
  parent.forEach((n, _, i) => void (idx.includes(i) || rest.push(n)));
  rest.splice(at, 0, ...idx.map((i) => parent.child(i)));
  return parent.type.validContent(Fragment.fromArray(rest)) ? { idx, at } : null;
}

/**
 * `tr` with the children at `indexes` of the node whose content starts at `base` (0: the document's blocks) taken
 * out and put back, in their order, at `to` (an index among the children that stay). Returns where they start now,
 * or null when nothing would change.
 */
export function moveChildrenTr(tr: Transaction, base: number, indexes: number[], to: number): number | null {
  const parentAt = () => (base === 0 ? tr.doc : tr.doc.resolve(base).parent);
  const parent = parentAt();
  const r = reordered(parent, indexes, to);
  if (!r) return null;
  const nodes = r.idx.map((i) => parent.child(i));
  const starts = childStarts(parent, base);
  for (const i of [...r.idx].reverse()) tr.delete(starts[i]!, starts[i]! + parent.child(i).nodeSize);
  const now = parentAt();
  let pos = base;
  for (let i = 0; i < r.at; i++) pos += now.child(i).nodeSize;
  tr.insert(pos, Fragment.fromArray(nodes));
  return pos;
}

/** The article's blocks at `indexes` moved to `to`. */
export const moveBlocksTr = (tr: Transaction, indexes: number[], to: number) => moveChildrenTr(tr, 0, indexes, to);

/** Table cells move with their column, rows below the header: tables get their own moves. */
const OWN_MOVES = new Set(['tableRow', 'tableCell', 'tableHeader']);

/** Whether `node`, a child of `parent`, moves on its own (a list item, an FAQ question, a fact card): a list item,
 *  or a box's child that is not text with at least one more like it there. Not a table's rows and cells. */
export function isItem(node: PMNode, parent: PMNode): boolean {
  if (node.isTextblock || !node.isBlock || OWN_MOVES.has(node.type.name)) return false;
  // a list item, even alone in its list (it can still go out of it)
  if (node.type.name === 'listItem' || node.type.name === 'taskItem') return true;
  let same = 0;
  parent.forEach((c) => void (c.type === node.type && same++));
  return same >= 2;
}

/** "List item", "FAQ question" in a sentence: lower case, short words in capitals kept ("FAQ"). */
export const inSentence = (noun: string) => noun.split(' ').map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(' ');

interface Items {
  /** where the parent's content starts (0: the document) */
  base: number;
  parent: PMNode;
  /** the first and last selected child */
  a: number;
  b: number;
}

/** What Alt+↑/↓ moves: the innermost run of items the selection spans (list items, FAQ questions, fact cards: a
 *  box's children that are not text) that the box lets move one place `dir`; else the article's blocks. */
export function selectedItems(state: EditorState, dir: -1 | 1): Items {
  const sel = state.selection;
  const { $from } = sel;
  const $to = state.doc.resolve(sel.empty ? sel.to : Math.max(sel.from, sel.to - 1));
  const top = Math.min($from.sharedDepth($to.pos), $from.depth - (sel instanceof NodeSelection ? 0 : 1));
  for (let d = top; d >= 1; d--) {
    const parent = $from.node(d);
    const a = $from.index(d);
    const b = Math.max(a, $to.index(d));
    const item = parent.maybeChild(a);
    if (!item || item.isTextblock || !item.isBlock || OWN_MOVES.has(item.type.name) || parent.childCount < 2) continue;
    // only where the box allows the new order (else the box itself moves, a level up)
    const edge = dir < 0 ? a === 0 : b === parent.childCount - 1;
    if (!edge && !reordered(parent, range(a, b), dir < 0 ? a - 1 : a + 1)) continue;
    return { base: $from.start(d), parent, a, b };
  }
  return { base: 0, parent: state.doc, a: $from.index(0), b: Math.max($from.index(0), $to.index(0)) };
}

const live = (() => {
  let el: HTMLElement | null = null;
  return (text: string) => {
    if (!el) {
      el = document.createElement('div');
      el.className = 'ms-sr';
      el.setAttribute('aria-live', 'polite');
      document.body.append(el);
    }
    el.textContent = '';
    requestAnimationFrame(() => (el!.textContent = text));
  };
})();

/** What one item is called: "List item", "FAQ question", "Block". */
export function itemNoun(node: PMNode | null, top: boolean): string {
  if (top || !node) return 'Block';
  return node.type.name === 'listItem' || node.type.name === 'taskItem' ? 'List item' : boxLabel(node.type.name);
}

/** Moves the selected items (or blocks) one place up or down, keeping the caret or selection where it was in them. */
export function stepBlocks(editor: Editor, dir: -1 | 1): boolean {
  const { state } = editor;
  // in a table: its row (tables.ts keeps the header row on top)
  if (tableAt(state)) {
    live(moveRow(editor, dir) || `Row moved ${dir < 0 ? 'up' : 'down'}.`);
    return true;
  }
  const it = selectedItems(state, dir);
  const count = it.base === 0 ? blockCount(state.doc) : it.parent.childCount;
  const noun = itemNoun(it.parent.child(it.a), it.base === 0);
  const n = it.b - it.a + 1;
  const what = n === 1 ? noun : `${n} ${noun.toLowerCase()}s`;
  if ((dir < 0 && it.a === 0) || (dir > 0 && it.b >= count - 1)) {
    const box = /List$/.test(it.parent.type.name) ? 'list' : boxLabel(it.parent.type.name);
    live(`${what} already ${dir < 0 ? 'first' : 'last'}${it.base ? ` in the ${box}` : ''}.`);
    return true;
  }
  // a box the site locks stays where it is (others still move past it)
  const locked = it.base === 0 ? range(it.a, it.b).map((i) => blockLock(it.parent.child(i))).find((l) => l?.move) : undefined;
  if (locked) {
    live(lockReason(locked));
    return true;
  }
  const before = childStarts(it.parent, it.base)[it.a]!;
  const tr = state.tr;
  const at = moveChildrenTr(tr, it.base, range(it.a, it.b), it.a + dir);
  if (at === null) return true;
  const shift = at - before;
  const sel = state.selection;
  tr.setSelection(sel instanceof NodeSelection ? NodeSelection.create(tr.doc, sel.from + shift) : TextSelection.create(tr.doc, sel.anchor + shift, sel.head + shift));
  editor.view.dispatch(tr.scrollIntoView());
  live(`${what} moved ${dir < 0 ? 'up' : 'down'}: now ${it.a + dir + 1} of ${count}.`);
  return true;
}

export const BlockMoves = Extension.create({
  name: 'blockMoves',
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => stepBlocks(this.editor, -1),
      'Alt-ArrowDown': () => stepBlocks(this.editor, 1),
    };
  },
});
