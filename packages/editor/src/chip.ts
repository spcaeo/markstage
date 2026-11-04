// The small chip above the box being edited ("Card · Settings"): its words and its place over the sheet, from the
// editor's active box (decorations.ts). Drawn again on every change and scroll (index.ts placeChip).
import type { Editor } from '@tiptap/core';
import { activeBox } from './decorations';
import { boxLabel } from './runtime';

/** Places `chip` over the active box of `editor` (null: no box is being edited; the chip hides); `offer`: Settings are a click away. */
export function placeBoxChip(chip: HTMLElement, sheet: HTMLElement, editor: Editor | null, offer: boolean): void {
  const box = editor ? activeBox(editor.state) : null;
  const dom = box && editor ? (editor.view.nodeDOM(box.pos) as HTMLElement | null) : null;
  if (!box || !dom?.getBoundingClientRect) {
    chip.hidden = true;
    return;
  }
  const r = dom.getBoundingClientRect();
  const s = sheet.getBoundingClientRect();
  const label = boxLabel(box.node.type.name);
  chip.textContent = offer ? `${label} · Settings` : label;
  chip.classList.toggle('is-action', offer);
  chip.tabIndex = offer ? 0 : -1;
  chip.title = offer ? 'Show the settings of this box' : '';
  chip.hidden = false;
  chip.style.top = `${r.top - s.top - chip.offsetHeight - 6}px`;
  chip.style.left = `${r.left - s.left}px`;
}
