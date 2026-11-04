// ⌘Z and ⇧⌘Z (Ctrl+Y too) where the frontmatter is edited (Post settings, the SEO check): its own history
// (state.ts), so a change there, typed or an accepted suggestion, is taken back like one on the canvas. A field with
// the focus shows the value undone (state.ts `holds`).
import type { FrontmatterEdits } from './state';

export function undoKeys(el: HTMLElement, edits: FrontmatterEdits): void {
  el.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (!(e.metaKey || e.ctrlKey) || e.altKey || !(k === 'z' || (k === 'y' && e.ctrlKey))) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'y' || e.shiftKey) edits.redo();
    else edits.undo();
  });
}
