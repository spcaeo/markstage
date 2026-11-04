// Canvas-only decorations: the outline class of the box being edited, plus whatever the block packs draw (pack.ts
// `decorate`): icons, labels and marks the site's build adds as markup, kept out of the document.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { editorPacks, isBox } from './runtime';

export interface ActiveBox {
  node: PMNode;
  pos: number;
  /** index of the top-level block it is in */
  index: number;
}

/** The innermost box around the selection (or the selected box itself). */
export function activeBox(state: EditorState): ActiveBox | null {
  const sel = state.selection;
  const $from = sel.$from;
  const index = $from.index(0);
  if (sel instanceof NodeSelection && isBox(sel.node.type.name)) return { node: sel.node, pos: sel.from, index };
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (isBox(node.type.name)) return { node, pos: $from.before(d), index };
  }
  return null;
}

/** The top-level block the selection is in (also when it is not a box). */
export function activeBlock(state: EditorState): { node: PMNode; pos: number; index: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.$from.depth === 0) return { node: sel.node, pos: sel.from, index: sel.$from.index(0) };
  const $from = sel.$from;
  if ($from.depth < 1) return null;
  return { node: $from.node(1), pos: $from.before(1), index: $from.index(0) };
}

function build(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];
  const active = activeBox(state);
  if (active) decos.push(Decoration.node(active.pos, active.pos + active.node.nodeSize, { class: 'ms-active' }));
  const drawers = editorPacks()
    .map((p) => p.decorate)
    .filter((d): d is NonNullable<typeof d> => !!d);
  if (drawers.length) {
    state.doc.descendants((node, pos) => {
      for (const d of drawers) d(node, pos, decos, state);
      return true;
    });
  }
  return DecorationSet.create(state.doc, decos);
}

const key = new PluginKey<DecorationSet>('markstageDecorations');

/** What the page's own HTML does that the canvas's does not, drawn in the page shell (styles/shell.css): a line break
 *  typed in the source inside a paragraph (a soft break) is a space on the page (`.ms-soft`; the text keeps it, so the
 *  file is saved as written), and the items of a tight list hold their text with no paragraph around it (`.ms-tight`). */
function pageDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if ((node.type.name === 'bulletList' || node.type.name === 'orderedList') && node.attrs.tight !== false) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ms-tight' }));
    if (!node.isText) return !node.type.spec.code;
    const text = node.text ?? '';
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) decos.push(Decoration.inline(pos + i, pos + i + 1, { class: 'ms-soft' }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const pageKey = new PluginKey<DecorationSet>('markstagePageDecorations');

export const Decorations = Extension.create({
  name: 'markstageDecorations',
  addProseMirrorPlugins: () => [
    new Plugin({
      key,
      state: {
        init: (_c, state) => build(state),
        apply: (tr, old, _prev, state) => (tr.docChanged || tr.selectionSet ? build(state) : old),
      },
      props: { decorations: (state) => key.getState(state) },
    }),
    new Plugin({
      key: pageKey,
      state: {
        init: (_c, state) => pageDecorations(state.doc),
        apply: (tr, old) => (tr.docChanged ? pageDecorations(tr.doc) : old),
      },
      props: { decorations: (state) => pageKey.getState(state) },
    }),
  ],
});
