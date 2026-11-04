// The title, edited where it shows: the big heading at the top of the canvas (Ghost style). It writes the
// frontmatter title (pending until ⌘S, like every other change); Enter goes on to the text below; pasted text
// arrives as one plain line.
import { holds, type FrontmatterEdits } from './settings/state';

export interface TitleOpts {
  edits: FrontmatterEdits;
  /** the frontmatter key of the title */
  key: string;
  /** Enter, or ArrowDown on the last line: on to the text */
  onEnter: () => void;
  editable: boolean;
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, ' ');
/** The server refuses a longer title (content/limits.mjs). */
export const TITLE_MAX = 300;

/** A heading element (`tag`, the site's `className`) that edits the title in place. */
export function titleElement(tag: string, className: string, o: TitleOpts): HTMLElement {
  const el = document.createElement(tag);
  el.className = `${className} ms-title`.trim();
  el.dataset.placeholder = 'Title';
  // an Arabic or Hebrew title runs right to left (QA N14)
  el.dir = 'auto';
  el.textContent = String(o.edits.get(o.key) ?? '');
  if (!o.editable) return el;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.spellcheck = true;
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-label', 'Title');
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && atEnd(el))) {
      e.preventDefault();
      o.onEnter();
    }
  });
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = oneLine(e.clipboardData?.getData('text/plain') ?? '');
    document.execCommand('insertText', false, text);
  });
  // past the server's limit: said under the title with the count, and the save is refused (QA N11), never a silent cut
  let over: HTMLElement | null = null;
  const sayOver = () => {
    const n = oneLine(el.textContent ?? '').trim().length - TITLE_MAX;
    if (n <= 0) return void (over?.remove(), (over = null));
    over ??= Object.assign(document.createElement('p'), { className: 'ms-title__over' });
    over.setAttribute('role', 'alert');
    over.textContent = `Titles are at most ${TITLE_MAX} characters (${n} over): shorten it to save.`;
    if (!over.isConnected) el.after(over);
  };
  el.addEventListener('input', () => {
    // no line breaks and no leftover <br> (an emptied contenteditable keeps one)
    if (el.querySelector('br, div')) el.textContent = oneLine(el.textContent ?? '');
    o.edits.set(o.key, oneLine(el.textContent ?? '').trim());
    sayOver();
  });
  o.edits.onChange((path) => {
    if (path !== null && path !== o.key) return;
    const v = String(o.edits.get(o.key) ?? '');
    if (!holds(el) && el.textContent !== v) el.textContent = v;
  });
  return el;
}

function atEnd(el: HTMLElement): boolean {
  const sel = getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const box = el.getBoundingClientRect();
  return !r.height || r.bottom > box.bottom - r.height * 1.2;
}
