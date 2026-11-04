// The settings panel: slides in from the right while a box with settings is selected, titled by the box ("Side note
// settings"). The block's `panel(ctx)` (its pack, or builtins.ts) draws the fields. Closed (X or Esc) it stays away
// for that box until another box is selected or the box's label chip is clicked.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { activeBox } from './decorations';
import { lockField } from './field-access';
import { ic } from './icons';
import { h, panelCtx, type PanelCtx } from './panel-form';
import { blockUI, boxLabel } from './runtime';

/** Redraw key by default: the lengths of the box's array attributes (rows added or removed). */
const defaultKey = (node: PMNode) =>
  Object.values(node.attrs)
    .map((v) => (Array.isArray(v) ? v.length : ''))
    .join(',');

export class Panel {
  private body: HTMLElement;
  private title: HTMLElement;
  private key = '';
  private syncs: (() => void)[] = [];
  private entryUrl = '/';
  /** the box whose panel the writer closed ("type@pos") */
  private dismissed: string | null = null;
  private shownFor: string | null = null;
  /** true while something else has the right column (the Post settings drawer) */
  suppressed: () => boolean = () => false;
  /** AI alt text for an image box's picker (ai/editor.ts panelAlt), when the editor has it */
  altAi: ((pos: number) => PanelCtx['altAi']) | null = null;

  constructor(
    readonly el: HTMLElement,
    private getEditor: () => Editor | null,
    private isEngaged: () => boolean,
  ) {
    el.innerHTML = `<header class="ms-panel__head"><h2 class="ms-panel__title"></h2><button type="button" class="ms-iconbtn ms-panel__close" aria-label="Close settings (Esc)" title="Close settings (Esc)">${ic('x', 16)}</button></header><div class="ms-panel__body"></div>`;
    this.title = el.querySelector('.ms-panel__title')!;
    this.body = el.querySelector('.ms-panel__body')!;
    el.querySelector('.ms-panel__close')!.addEventListener('click', () => this.close());
    this.show(false);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  private show(on: boolean): void {
    this.el.classList.toggle('is-open', on);
    this.el.inert = !on;
    this.el.setAttribute('aria-hidden', String(!on));
  }

  /** Closes the panel for the selected box (it comes back for another box, or with reopen()). */
  close(): void {
    if (!this.isOpen) return;
    const hadFocus = this.el.contains(document.activeElement);
    this.dismissed = this.shownFor;
    this.show(false);
    if (hadFocus) this.getEditor()?.view.focus();
  }

  /** Shows the panel again for the selected box (its label chip on the canvas). */
  reopen(): void {
    this.dismissed = null;
    this.key = '';
    this.update();
  }

  private selected() {
    const editor = this.getEditor();
    const found = editor && this.isEngaged() ? activeBox(editor.state) : null;
    return found && blockUI(found.node.type.name)?.panel ? found : null;
  }

  /** True when the selected box has settings (so its chip can offer them). */
  hasSettings(): boolean {
    return !!this.selected();
  }

  /** A new entry is open; `url` is its page (for #anchor links). */
  setEntry(url: string | null): void {
    this.entryUrl = url ?? '/';
    this.key = '';
    this.dismissed = null;
    this.update();
  }

  update(): void {
    const editor = this.getEditor();
    const box = this.selected();
    const id = box ? `${box.node.type.name}@${box.pos}` : null;
    if (id !== this.dismissed) this.dismissed = null;
    if (!editor || !box || id === this.dismissed || this.suppressed()) {
      this.shownFor = id;
      this.show(false);
      return;
    }
    this.shownFor = id;
    this.show(true);
    const ui = blockUI(box.node.type.name)!;
    const key = `${id}#${(ui.panelKey ?? defaultKey)(box.node)}`;
    if (key === this.key) {
      for (const s of this.syncs) s();
      return;
    }
    this.key = key;
    this.syncs = [];
    // a row of one of its lists had the focus (a row deleted or duplicated there): the same place keeps it
    const focused = (document.activeElement as Element | null)?.closest<HTMLElement>('.ms-order__row');
    const was = focused && this.body.contains(focused) ? [...this.body.querySelectorAll('.ms-order__row')].indexOf(focused) : -1;
    this.body.replaceChildren();
    this.title.textContent = `${boxLabel(box.node.type.name)} settings`;
    ui.panel!(panelCtx(editor, box.pos, this.body, this.syncs, this.entryUrl, this.altAi ?? undefined));
    // a text the person may not change: its blocks' settings are shown greyed out (body-lock.ts keeps the document)
    this.body.classList.remove('is-locked');
    if (!editor.isEditable) lockField(this.body, 'You can’t change the text of this entry.');
    if (ui.description) this.body.append(Object.assign(h('p', 'ms-panel__note'), { textContent: ui.description }));
    if (was >= 0) {
      const rows = this.body.querySelectorAll<HTMLElement>('.ms-order__row');
      rows[Math.min(was, rows.length - 1)]?.focus();
    }
  }

  /** Selects the top-level block `index` (from the URL) and scrolls it into view. */
  static selectBlock(editor: Editor, index: number): boolean {
    const { doc } = editor.state;
    if (index < 0 || index >= doc.childCount) return false;
    let pos = 0;
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
    const node = doc.child(index);
    const sel = node.isTextblock || !node.type.spec.selectable ? TextSelection.near(doc.resolve(pos + 1)) : NodeSelection.create(doc, pos);
    editor.view.dispatch(editor.state.tr.setSelection(sel));
    (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: 'center' });
    return true;
  }
}
