// Shared parts of the box node views: setting a node's attributes from its view, and "fields" (a
// caption, a box's heading or button text) edited in place on the canvas while being node attributes, not text.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView, NodeView, ViewMutationRecord } from '@tiptap/pm/view';

export type GetPos = () => number | undefined;

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** Sets the classes that start with `prefix` (a kind modifier) and leaves the others: ProseMirror puts its own
 *  (selection, decorations) on the same element. */
export function setKind(e: HTMLElement, prefix: string, cls: string | null): void {
  for (const c of [...e.classList]) if (c.startsWith(prefix) && c !== cls) e.classList.remove(c);
  if (cls) e.classList.add(cls);
}

/** A part of a box the writer does not type into (icon, bar, trust line). */
export const chrome = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = el(tag, cls, html);
  e.contentEditable = 'false';
  return e;
};

/**
 * Makes `target` an in-place editor for one text attribute: an editable island inside the box's non-editable
 * chrome. Typing sets the attribute (one undo step per pause, like text); Enter or Escape leaves the field.
 * Returns `sync`, to call after the attribute changed elsewhere (panel, undo).
 */
export function field(target: HTMLElement, opts: { get: () => string; set: (v: string) => void; placeholder: string; label: string }) {
  target.contentEditable = 'true';
  target.spellcheck = true;
  target.dataset.msField = '';
  target.dataset.placeholder = opts.placeholder;
  target.setAttribute('role', 'textbox');
  target.setAttribute('aria-label', opts.label);
  target.addEventListener('input', () => {
    const v = (target.textContent ?? '').replace(/\s+/g, ' ');
    target.classList.toggle('is-empty', !v.trim());
    opts.set(v);
  });
  target.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      target.blur();
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
      // the browser's select-all would leave the field for the whole article, and the next keys would type there
      e.preventDefault();
      getSelection()?.selectAllChildren(target);
    }
  });
  target.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain').replace(/\s+/g, ' ') ?? '';
    document.execCommand('insertText', false, text);
  });
  // links and buttons inside the article must not navigate while being edited
  target.addEventListener('click', (e) => e.preventDefault());
  const sync = () => {
    const v = opts.get();
    if (document.activeElement !== target && target.textContent !== v) target.textContent = v;
    target.classList.toggle('is-empty', !v.trim());
  };
  sync();
  return sync;
}

/** Base for box views: keeps the node, writes attributes, and keeps ProseMirror out of the chrome and fields. */
export abstract class BoxView implements NodeView {
  abstract dom: HTMLElement;
  contentDOM?: HTMLElement;

  constructor(
    public node: PMNode,
    public view: EditorView,
    public getPos: GetPos,
  ) {}

  setAttrs(patch: Record<string, unknown>): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch }));
  }

  /** Draws the parts that depend on attributes or text (called after every change). */
  abstract render(): void;

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(e: Event): boolean {
    const t = e.target as Element | null;
    return !!t?.closest?.('[data-ms-field], [data-ms-ui]');
  }

  ignoreMutation(m: ViewMutationRecord): boolean {
    if (!this.contentDOM) return true;
    return !this.contentDOM.contains(m.target as Node);
  }
}
