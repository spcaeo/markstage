// Editing rules every box shares: a click on a box's frame (its icon, label, bar: the parts that are not text)
// selects the box, so its settings open; a click in its text or an in-place field edits there.
import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** The element of the nearest node view under `target`, with ProseMirror's own record of it. */
function viewDescAt(view: EditorView, target: Node | null): { dom: HTMLElement; desc: any } | null {
  for (let n: Node | null = target; n && n !== view.dom; n = n.parentNode) {
    const desc = (n as any).pmViewDesc;
    if (desc?.node && desc.dom === n) return { dom: n as HTMLElement, desc };
  }
  return null;
}

export const BoxBehaviors = Extension.create({
  name: 'boxBehaviors',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown(view, e) {
              const t = e.target as Element;
              if (t.closest?.('[data-ms-field]')) return false;
              const hit = viewDescAt(view, t);
              if (!hit || hit.desc.node.isAtom) return false;
              const content: HTMLElement | null = hit.desc.contentDOM;
              // on the box's frame, not in its text: select the box
              if (content && content.contains(t)) return false;
              if (!(t as HTMLElement).closest?.('[contenteditable="false"]')) return false;
              e.preventDefault();
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hit.desc.posBefore)));
              view.focus();
              return true;
            },
          },
        },
      }),
    ];
  },
});
