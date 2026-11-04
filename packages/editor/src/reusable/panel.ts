// The Library beside the canvas (?side=library&lq=<words>&lk=section|snippet): the sections and snippets this
// person may use, with their pictures. Drag one onto the page: a line shows where it lands, between two blocks, and
// one ⌘Z takes it back. Or, from the keyboard, Enter on an item puts it after the block the caret is in. A synced
// item is put in as a copy the server keeps in step: the entry's frontmatter lists it (`synced: [{id, version}]`).
import type { Editor, JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { ApiError } from '../api';
import { ic } from '../icons';
import * as router from '../router';
import { toast } from '../host';
import { toEditor } from '../transform';
import * as api from './api';
import { listSynced } from './save';
import { picture } from './screen';

interface Deps {
  getEditor(): Editor | null;
  /** the writer opened or closed it (the URL follows) */
  onToggle(open: boolean): void;
}

const DRAG = 'application/x-markstage-library';
const KINDS: [string, string][] = [
  ['', 'All'],
  ['section', 'Sections'],
  ['snippet', 'Snippets'],
];

/** Where between the top-level blocks a drop at `y` lands: the document position and the line's place on screen. */
function dropAt(editor: Editor, y: number): { pos: number; top: number; left: number; width: number } | null {
  const { view } = editor;
  const box = view.dom.getBoundingClientRect();
  let best: { pos: number; top: number } | null = null;
  let prevBottom = box.top;
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    const gapTop = (prevBottom + r.top) / 2;
    if (!best || Math.abs(y - gapTop) < Math.abs(y - best.top)) best = { pos: offset, top: gapTop };
    prevBottom = r.bottom;
    const end = { pos: offset + node.nodeSize, top: r.bottom + 4 };
    if (Math.abs(y - end.top) < Math.abs(y - best.top)) best = end;
  });
  return best ? { ...(best as { pos: number; top: number }), left: box.left, width: box.width } : null;
}

export class LibraryPanel {
  private list: HTMLElement;
  private search: HTMLInputElement;
  private kinds: HTMLElement;
  private items: api.LibItem[] | null = null;
  private line: HTMLElement;
  private failed = '';

  constructor(
    readonly el: HTMLElement,
    private button: HTMLButtonElement,
    private d: Deps,
  ) {
    el.innerHTML = `<header class="ms-panel__head"><h2 class="ms-panel__title">Library</h2><button type="button" class="ms-iconbtn ms-panel__close" aria-label="Close the Library (Esc)" title="Close the Library (Esc)">${ic('x', 16)}</button></header><div class="ms-panel__body ms-libpanel"><input type="search" class="ms-input" placeholder="Search the Library" aria-label="Search the Library" /><div class="ms-adm-chips ms-libpanel__kinds" role="group" aria-label="Show"></div><p class="ms-adm-sub ms-libpanel__hint">Drag one onto the page, or press Enter on it to put it after the block you are in. <a href="#/library">The whole Library</a></p><ul class="ms-libpanel__list"></ul></div>`;
    this.list = el.querySelector('.ms-libpanel__list')!;
    this.search = el.querySelector('input')!;
    this.kinds = el.querySelector('.ms-libpanel__kinds')!;
    this.search.addEventListener('input', () => (router.go({ lq: this.search.value }), this.draw()));
    el.querySelector('.ms-panel__close')!.addEventListener('click', () => this.close());
    button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        this.close();
        d.getEditor()?.view.focus();
      }
    });
    this.line = document.createElement('div');
    this.line.className = 'ms-libdrop';
    this.line.hidden = true;
    document.body.append(this.line);
    this.dropping();
    addEventListener('ms-library', () => ((this.items = null), this.isOpen && void this.load()));
    this.show(false);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  show(on: boolean): void {
    this.el.classList.toggle('is-open', on);
    this.el.inert = !on;
    this.el.setAttribute('aria-hidden', String(!on));
    this.button.setAttribute('aria-pressed', String(on));
    if (on) {
      const r = router.route();
      this.search.value = r.lq;
      void this.load();
    }
  }

  open(): void {
    if (this.isOpen) return;
    this.show(true);
    this.d.onToggle(true);
    this.search.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.show(false);
    this.d.onToggle(false);
  }

  private async load(): Promise<void> {
    if (!this.items) {
      this.list.replaceChildren(Object.assign(document.createElement('li'), { className: 'ms-adm-sub', textContent: 'Loading…' }));
      try {
        this.items = (await api.all()).items.filter((i) => i.kind !== 'template' && !!i.body.doc);
        this.failed = '';
      } catch (e) {
        this.items = [];
        this.failed = e instanceof ApiError && (e.status === 404 || e.status === 401) ? 'The Library is kept by the Markstage server; this editor runs without it.' : `The Library could not be read: ${(e as Error).message}`;
      }
    }
    this.draw();
  }

  private draw(): void {
    const r = router.route();
    this.kinds.replaceChildren(
      ...KINDS.map(([v, l]) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'ms-adm-chip', textContent: l });
        b.setAttribute('aria-pressed', String(r.lk === v));
        b.addEventListener('click', () => (router.go({ lk: v }), this.draw()));
        return b;
      }),
    );
    const words = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = (this.items ?? []).filter((i) => (!r.lk || i.kind === r.lk) && words.every((w) => `${i.name} ${i.description} ${i.folder} ${i.tags.join(' ')}`.toLowerCase().includes(w)));
    this.list.replaceChildren();
    if (this.failed || !shown.length) {
      const li = Object.assign(document.createElement('li'), { className: 'ms-adm-sub', textContent: this.failed || (this.items?.length ? 'Nothing matches.' : 'Nothing here yet: choose Save section to Library… in a block’s grip menu.') });
      return void this.list.append(li);
    }
    for (const it of shown) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ms-libpanel__item';
      b.draggable = true;
      b.title = it.synced ? 'Synced: the pages that use it follow its changes' : 'Drag onto the page, or press Enter';
      b.append(picture(it));
      const txt = document.createElement('span');
      txt.className = 'ms-libpanel__txt';
      txt.append(Object.assign(document.createElement('strong'), { textContent: it.name }), Object.assign(document.createElement('span'), { className: 'ms-adm-sub', textContent: [it.kind === 'section' ? 'Section' : 'Snippet', it.synced ? 'Synced' : '', it.folder].filter(Boolean).join(' · ') }));
      b.append(txt);
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer!.setData(DRAG, it.id);
        e.dataTransfer!.effectAllowed = 'copy';
      });
      b.addEventListener('dragend', () => (this.line.hidden = true));
      b.addEventListener('click', (e) => e.detail === 0 && this.insertAfterCaret(it));
      b.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), this.insertAfterCaret(it)));
      const li = document.createElement('li');
      li.append(b);
      this.list.append(li);
    }
  }

  /** Drops onto the canvas: the line between blocks while dragging, the insert on drop. */
  private dropping(): void {
    const over = (e: DragEvent) => {
      const editor = this.d.getEditor();
      if (!editor || !e.dataTransfer?.types.includes(DRAG) || !editor.view.dom.closest('.ms-sheet')?.contains(e.target as Node)) return null;
      return { editor, at: dropAt(editor, e.clientY) };
    };
    document.addEventListener('dragover', (e) => {
      const o = over(e);
      if (!o?.at) return void (this.line.hidden = true);
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      Object.assign(this.line.style, { top: `${o.at.top - 1}px`, left: `${o.at.left}px`, width: `${o.at.width}px` });
      this.line.hidden = false;
    });
    document.addEventListener('dragleave', (e) => !e.relatedTarget && (this.line.hidden = true));
    // capture: before the editor's own drop handling, which would paste the dragged button's text
    document.addEventListener(
      'drop',
      (e) => {
        const o = over(e);
        this.line.hidden = true;
        if (!o?.at) return;
        e.preventDefault();
        e.stopPropagation();
        const it = this.items?.find((i) => i.id === e.dataTransfer!.getData(DRAG));
        if (it) this.insert(o.editor, it, o.at.pos);
      },
      true,
    );
  }

  /** Enter (or a click from the keyboard) on an item: after the top-level block the caret is in. */
  private insertAfterCaret(it: api.LibItem): void {
    const editor = this.d.getEditor();
    if (!editor) return;
    const $p = editor.state.selection.$from;
    const pos = $p.depth === 0 ? $p.pos : $p.after(1);
    this.insert(editor, it, pos);
  }

  /** The item's blocks at `pos` (between two top-level blocks), as one change; a synced one is listed too. */
  insert(editor: Editor, it: api.LibItem, pos: number): boolean {
    const { state, view } = editor;
    let nodes;
    try {
      nodes = (toEditor(it.body.doc as JSONContent).content ?? []).map((n) => state.schema.nodeFromJSON(n));
    } catch {
      toast(`“${it.name}” has blocks this editor doesn't know.`, 'error');
      return false;
    }
    if (!nodes.length) return false;
    const tr = state.tr.insert(pos, Fragment.fromArray(nodes));
    const end = Math.min(pos + nodes.reduce((a, n) => a + n.nodeSize, 0), tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
    view.dispatch(tr.scrollIntoView());
    view.focus();
    if (it.synced) listSynced(it);
    toast(`Put in “${it.name}”${it.synced ? ' (synced)' : ''}. ⌘Z takes it back.`, 'ok');
    return true;
  }
}
