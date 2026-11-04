// Moving a table's rows and columns (the table menu, and Alt+↑/↓ in a cell for its row): one transaction each, so
// one ⌘Z takes it back. The header row (cells that are all headers) stays at the top: rows move below it and a
// sort leaves it there. Columns move whole, the header cell with them.
import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { childStarts, moveChildrenTr } from './blocks';

interface At {
  table: PMNode;
  /** where the table's rows start */
  base: number;
  row: number;
  col: number;
  /** the first row that may move (1 under a header row) */
  first: number;
}

/** The table cell the caret is in, or null. */
export function tableAt(state: EditorState): At | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 1; d--) {
    if (!/^table(Cell|Header)$/.test($from.node(d).type.name)) continue;
    const table = $from.node(d - 2);
    const head = table.firstChild;
    let header = !!head && head.childCount > 0;
    head?.forEach((c) => void (header &&= c.type.name === 'tableHeader'));
    return { table, base: $from.start(d - 2), row: $from.index(d - 2), col: $from.index(d - 1), first: header && table.childCount > 1 ? 1 : 0 };
  }
  return null;
}

/** The caret into cell (row, col) of the table at `base`, after `tr`'s change. */
function caretIn(editor: Editor, tr: Transaction, base: number, row: number, col: number): void {
  const table = tr.doc.resolve(base).parent;
  const r = table.maybeChild(row);
  if (r) {
    const cell = childStarts(r, childStarts(table, base)[row]! + 1)[Math.min(col, r.childCount - 1)]!;
    tr.setSelection(TextSelection.near(tr.doc.resolve(cell + 1)));
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

/** Why a row can't go `dir`, or ''. */
export function rowWhy(at: At, dir: -1 | 1): string {
  if (at.row < at.first) return 'The header row stays at the top.';
  if (dir < 0 && at.row === at.first) return at.first ? 'Already the first row under the header.' : 'Already the first row.';
  if (dir > 0 && at.row === at.table.childCount - 1) return 'Already the last row.';
  return '';
}

/** Moves the caret's row one place up or down; returns the reason when it can't. */
export function moveRow(editor: Editor, dir: -1 | 1): string {
  const at = tableAt(editor.state);
  if (!at) return '';
  const why = rowWhy(at, dir);
  if (why) return why;
  const tr = editor.state.tr;
  moveChildrenTr(tr, at.base, [at.row], at.row + dir);
  caretIn(editor, tr, at.base, at.row + dir, at.col);
  return '';
}

/** Moves the caret's column one place left or right (every row, the header cell too). */
export function moveColumn(editor: Editor, dir: -1 | 1): string {
  const at = tableAt(editor.state);
  if (!at) return '';
  const to = at.col + dir;
  const width = at.table.firstChild?.childCount ?? 0;
  if (to < 0) return 'Already the first column.';
  if (to >= width) return 'Already the last column.';
  const rows: PMNode[] = [];
  at.table.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((c) => void cells.push(c));
    if (cells.length > Math.max(at.col, to)) [cells[at.col], cells[to]] = [cells[to]!, cells[at.col]!];
    rows.push(row.copy(Fragment.fromArray(cells)));
  });
  const tr = editor.state.tr.replaceWith(at.base, at.base + at.table.content.size, Fragment.fromArray(rows));
  caretIn(editor, tr, at.base, at.row, to);
  return '';
}

/** A copy of the caret's row under it (not of the header row). */
export function duplicateRow(editor: Editor): string {
  const at = tableAt(editor.state);
  if (!at) return '';
  if (at.row < at.first) return 'The header row has no copy: add a row below it instead.';
  const row = at.table.child(at.row);
  const tr = editor.state.tr.insert(childStarts(at.table, at.base)[at.row]! + row.nodeSize, row.copy(row.content));
  caretIn(editor, tr, at.base, at.row + 1, at.col);
  return '';
}

/** The rows under the header sorted by the caret's column: numbers as numbers, words A to Z (or Z to A). */
export function sortRows(editor: Editor, down = false): string {
  const at = tableAt(editor.state);
  if (!at) return '';
  const head: PMNode[] = [];
  const body: PMNode[] = [];
  at.table.forEach((r, _, i) => void (i < at.first ? head : body).push(r));
  const key = (r: PMNode) => r.maybeChild(at.col)?.textContent.trim() ?? '';
  const sorted = [...body].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: 'base' }) * (down ? -1 : 1));
  if (sorted.every((r, i) => r === body[i])) return 'Already in that order.';
  const tr = editor.state.tr.replaceWith(at.base, at.base + at.table.content.size, Fragment.fromArray([...head, ...sorted]));
  caretIn(editor, tr, at.base, at.row < at.first ? at.row : at.first + sorted.indexOf(at.table.child(at.row)), at.col);
  return '';
}
