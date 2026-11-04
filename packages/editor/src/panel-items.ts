// The lists of a box's settings panel, on the order component (order/index.ts) like every list in the editor:
//   - rows kept in an array attribute (stat figures, layout cards): each row's fields under a grip; drag, Alt+↑/↓,
//     the grip menu (Move to…, Add one after, Duplicate, Delete with Undo);
//   - the box's own items (FAQ questions, fact cards: its children), a row each with its words (double-click goes to
//     it): the same moves, each one transaction on the canvas (blocks.ts), so ⌘Z there takes it back.
import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { moveItems } from '@markstage/core';
import { childStarts, inSentence, moveChildrenTr } from './blocks';
import { mountOrder, type OrderItem } from './order';
import { describe } from './outline';
import { h, type Field } from './panel-form';
import { boxLabel } from './runtime';

type Row = Record<string, string>;
let next = 0;
const newId = () => `r${++next}`;

export interface AttrRowsOpts {
  body: HTMLElement;
  rows: () => Row[];
  write: (next: Row[]) => void;
  noun: string;
  blank: Row;
  /** draws row `i`'s fields */
  fields: (i: number) => Field[];
  syncs: (() => void)[];
}

/** Rows of fields kept in one array attribute. */
export function attrRows(o: AttrRowsOpts): void {
  // a row keeps its id while it moves (the ids move with it); the panel draws again when rows are added or removed
  let ids = o.rows().map(() => newId());
  const items = (): OrderItem[] =>
    o.rows().map((r, i) => ({ id: (ids[i] ??= newId()), label: Object.values(r).find((v) => String(v ?? '').trim()) || `${o.noun} ${i + 1}` }));
  const at = (id: string) => ids.indexOf(id);
  // a row added or removed draws the panel again: the focus goes to row `i` there (`field`: into its first field)
  const refocus = (i: number, field = false) =>
    requestAnimationFrame(() => {
      const rows = o.body.querySelectorAll<HTMLElement>('.ms-rows .ms-order__row');
      const row = rows[Math.max(0, Math.min(i, rows.length - 1))];
      (field ? row?.querySelector<HTMLElement>('input, textarea, select') : row)?.focus();
    });
  const root = h('div', 'ms-rows');
  o.body.append(root);
  mountOrder({
    root,
    noun: o.noun,
    label: `${o.noun[0]!.toUpperCase()}${o.noun.slice(1)}s`,
    items,
    row: (it) => {
      const i = at(it.id);
      const card = h('div', 'ms-row');
      card.append(h('span', 'ms-row__n', String(i + 1).padStart(2, '0')));
      for (const f of o.fields(i)) {
        card.append(f.el);
        if (f.sync) o.syncs.push(f.sync);
      }
      return card;
    },
    move: (moving, to) => {
      const order = moveItems(items(), moving, to).map((x) => x.id);
      const rows = o.rows();
      const was = ids;
      ids = order;
      o.write(order.map((id) => rows[was.indexOf(id)]!));
    },
    remove: (gone) => {
      const rows = o.rows();
      const back = gone.map((id) => ({ i: at(id), row: rows[at(id)]! })).sort((a, b) => a.i - b.i);
      ids = ids.filter((id) => !gone.includes(id));
      o.write(rows.filter((_, i) => !back.some((b) => b.i === i)));
      refocus(back[0]!.i);
      return () => {
        const r = [...o.rows()];
        for (const b of back) r.splice(b.i, 0, b.row);
        o.write(r);
        refocus(back[0]!.i);
      };
    },
    duplicate: (copy) => {
      const r = [...o.rows()];
      const idx = copy.map(at).sort((a, b) => b - a);
      for (const i of idx) r.splice(i + 1, 0, { ...r[i]! });
      o.write(r);
      refocus(idx[idx.length - 1]!);
    },
    extra: (id) => [
      {
        label: `Add a ${o.noun} after`,
        icon: 'plus',
        run: () => {
          const i = at(id) + 1;
          o.write([...o.rows().slice(0, i), { ...o.blank }, ...o.rows().slice(i)]);
          refocus(i, true);
        },
      },
    ],
  });
}

export interface ChildItemsOpts {
  editor: Editor;
  /** where the box is */
  pos: number;
  body: HTMLElement;
  syncs: (() => void)[];
  noun: string;
  label?: (child: PMNode) => string;
}

/** The box's own items (its children), to go to and to reorder. */
export function childItems(o: ChildItemsOpts): void {
  const { editor } = o;
  const ids = new WeakMap<PMNode, string>();
  const box = () => editor.state.doc.nodeAt(o.pos);
  const type = box()?.type;
  const base = o.pos + 1;
  const kids = (): PMNode[] => {
    const n = box();
    const out: PMNode[] = [];
    if (n && n.type === type) n.forEach((c) => void out.push(c));
    return out;
  };
  const items = (): OrderItem[] =>
    kids().map((c) => {
      if (!ids.has(c)) ids.set(c, newId());
      const label = o.label?.(c) || describe(c).text;
      return { id: ids.get(c)!, label: label || `Empty ${o.noun}` };
    });
  const index = (id: string) => kids().findIndex((c) => ids.get(c) === id);
  const name = inSentence(boxLabel(type?.name ?? ''));
  const dispatch = (fill: (tr: Transaction) => unknown) => {
    const tr = editor.state.tr;
    if (fill(tr) === null || !tr.docChanged) return;
    editor.view.dispatch(tr.scrollIntoView());
  };
  const root = h('div', 'ms-rows ms-rows--items');
  o.body.append(root);
  const list = mountOrder({
    root,
    noun: o.noun,
    label: `${o.noun[0]!.toUpperCase()}${o.noun.slice(1)}s`,
    items,
    row: (it) => {
      const go = h('span', 'ms-outline__go');
      // a click selects the row (⌘- and Shift-click several); going to the item there shows that item's own panel
      go.title = 'Double-click to go to it';
      go.append(Object.assign(h('span', 'ms-outline__text'), { textContent: it.label }));
      go.addEventListener('dblclick', () => {
        const i = index(it.id);
        const at = childStarts(box()!, base)[i];
        if (at === undefined) return;
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(at + 1))));
        (editor.view.nodeDOM(at) as HTMLElement | null)?.scrollIntoView({ block: 'center' });
      });
      return go;
    },
    move: (moving, to) => dispatch((tr) => moveChildrenTr(tr, base, moving.map(index), to.index)),
    keep: (gone) => {
      const n = box();
      if (!n) return '';
      const rest = kids().filter((c) => !gone.includes(ids.get(c)!));
      return n.type.validContent(Fragment.fromArray(rest)) ? '' : `The ${name} keeps at least one ${o.noun}: delete the whole box with its handle.`;
    },
    remove: (gone) => {
      const idx = gone.map(index).sort((a, b) => a - b);
      const nodes = idx.map((i) => kids()[i]!);
      dispatch((tr) => {
        const starts = childStarts(box()!, base);
        for (const i of [...idx].reverse()) tr.delete(starts[i]!, starts[i]! + nodes[idx.indexOf(i)]!.nodeSize);
      });
      return () =>
        dispatch((tr) => {
          if (tr.doc.nodeAt(o.pos)?.type !== type) return null;
          idx.forEach((i, k) => {
            const n = tr.doc.nodeAt(o.pos)!;
            tr.insert(childStarts(n, base)[i] ?? base + n.content.size, nodes[k]!);
          });
        });
    },
    duplicate: (copy) =>
      dispatch((tr) => {
        for (const i of copy.map(index).sort((a, b) => b - a)) {
          const n = tr.doc.nodeAt(o.pos)!.child(i);
          tr.insert(childStarts(tr.doc.nodeAt(o.pos)!, base)[i]! + n.nodeSize, n.copy(n.content));
        }
      }),
  });
  // the canvas changed the items (typing in one, ⌘Z): the list follows, keeping the focused row
  let shown = items().map((it) => `${it.id}:${it.label}`).join('|');
  o.syncs.push(() => {
    const now = items().map((it) => `${it.id}:${it.label}`).join('|');
    if (now === shown) return;
    shown = now;
    const focused = (document.activeElement as Element | null)?.closest<HTMLElement>('.ms-order__row');
    const here = focused && root.contains(focused) ? focused.dataset.id : undefined;
    list.refresh();
    if (here) list.focus(here);
  });
}
