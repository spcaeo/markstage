// The block menu: opened by the "+" next to a block (inserts after it, or replaces it when it is an empty line) and
// by "/" on an empty line. Each entry has a small drawing of the block; typing filters, arrows move, Enter inserts.
import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { InserterEntry } from './pack';
import { inserterEntries } from './runtime';
import { ic } from './icons';
import { all as library, type LibItem } from './reusable/api';
import { listSynced } from './reusable/save';
import { byPlace, folderOf, snippets, snippetsHere } from './snippets/api';
import { insertSnippet } from './snippets/save';

/** One of the Library's pieces of an article in the menu (or, from a server before the Library, a snippet). */
interface Piece {
  name: string;
  doc: JSONContent;
  hint: string;
  folder: string;
  item: LibItem | null;
}

// a snippet's drawing in the menu: a few lines in a frame
const SNIPPET_PIC = '<svg viewBox="0 0 72 48" aria-hidden="true"><rect x="6" y="6" width="60" height="36" rx="4" fill="none" stroke="currentColor" stroke-dasharray="3 3" opacity=".6"/><path d="M14 17h44M14 24h36M14 31h40" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".5"/></svg>';

export interface InsertTarget {
  /** position before an empty paragraph the new block replaces */
  replace?: number;
  /** position to insert at (after a block) */
  at?: number;
}

/** Where `node` can go for this target: replacing the empty line if its parent allows that block there (or at the
 *  "at" position when its parent allows it), else after the nearest ancestor that does: an image or a heading
 *  asked for inside a table cell goes right after the table (QA F15, N7). */
function place(doc: PMNode, target: InsertTarget, node: PMNode): { from: number; to: number } | null {
  if (target.at !== undefined) {
    const $at = doc.resolve(target.at);
    for (let d = $at.depth; d >= 0; d--) {
      const parent = $at.node(d);
      if (d === $at.depth) {
        if (parent.canReplaceWith($at.index(d), $at.index(d), node.type)) return { from: target.at, to: target.at };
      } else {
        const after = $at.after(d + 1);
        if (parent.canReplaceWith($at.index(d) + 1, $at.index(d) + 1, node.type)) return { from: after, to: after };
      }
    }
    return null;
  }
  const pos = target.replace!;
  const para = doc.nodeAt(pos);
  if (!para) return null;
  const $p = doc.resolve(pos);
  for (let d = $p.depth; d >= 0; d--) {
    const parent = $p.node(d);
    const idx = $p.index(d);
    if (d === $p.depth) {
      if (parent.canReplaceWith(idx, idx + 1, node.type)) return { from: pos, to: pos + para.nodeSize };
    } else {
      const after = $p.after(d + 1);
      if (parent.canReplaceWith(idx + 1, idx + 1, node.type)) return { from: after, to: after };
    }
  }
  return null;
}

export function insertBlock(editor: Editor, def: InserterEntry, target: InsertTarget): void {
  const { state, view } = editor;
  const at = target.at ?? target.replace!;
  const parent = state.doc.resolve(at).parent.type.name;
  const node = state.schema.nodeFromJSON(def.make({ parent }));
  const spot = place(state.doc, target, node);
  if (!spot) return;
  const tr = state.tr.replaceWith(spot.from, spot.to, node);
  // an atom is selected (its settings open); a box that starts with one (figures in a card) selects that
  const inserted = tr.doc.nodeAt(spot.from);
  if (inserted?.isAtom) tr.setSelection(NodeSelection.create(tr.doc, spot.from));
  else if (inserted?.firstChild?.isAtom && !inserted.firstChild.isInline) tr.setSelection(NodeSelection.create(tr.doc, spot.from + 1));
  else tr.setSelection(TextSelection.near(tr.doc.resolve(spot.from + 1)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export class InsertMenu {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private items: { def: InserterEntry; btn: HTMLButtonElement }[] = [];
  private active = 0;
  private target: InsertTarget | null = null;
  /** the Library's sections and snippets offered (mine and the shared ones) */
  private snips = new Map<InserterEntry, Piece>();

  constructor(private getEditor: () => Editor | null) {
    this.el = document.createElement('div');
    this.el.className = 'ms-pop ms-insert';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Insert a block');
    this.el.innerHTML = `<label class="ms-insert__search">${ic('search', 14)}<input type="text" placeholder="Search blocks" aria-label="Search blocks" /></label><div class="ms-insert__list" role="listbox"></div>`;
    this.input = this.el.querySelector('input')!;
    this.list = this.el.querySelector('.ms-insert__list')!;
    const entries = inserterEntries();
    for (const group of [...new Set(entries.map((b) => b.group))]) {
      const head = document.createElement('p');
      head.className = 'ms-insert__group';
      head.textContent = group;
      head.dataset.group = group;
      this.list.append(head);
      for (const def of entries.filter((b) => b.group === group)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ms-insert__item';
        btn.setAttribute('role', 'option');
        btn.dataset.id = def.id;
        btn.innerHTML = `<span class="ms-insert__pic">${def.preview}</span><span class="ms-insert__txt"><strong>${def.title}</strong><span>${def.hint}</span></span>`;
        btn.addEventListener('click', () => this.choose(def));
        btn.addEventListener('mousemove', () => this.highlight(this.visible().findIndex((v) => v.def === def)));
        this.list.append(btn);
        this.items.push({ def, btn });
      }
    }
    this.input.addEventListener('input', () => this.filter());
    this.input.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('mousedown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node) && !(e.target as Element).closest?.('[data-ms-plus]')) this.close();
    });
    document.body.append(this.el);
  }

  get isOpen() {
    return !this.el.hidden;
  }

  /** when the menu last opened: the scroll that typing Enter just before "/" causes must not close it */
  private openedAt = 0;

  /** The canvas scrolled: the menu no longer sits by its line, so it closes (unless it has just opened). */
  scrolled(): void {
    if (performance.now() - this.openedAt > 300) this.close();
  }

  /**
   * "/" typed on an empty line opens the menu in its place; in a table cell at the start of its words too (QA F15: a
   * cell starts with sample words, so its line is rarely empty), the block going before the words, or after the
   * table when a cell cannot hold it. False when "/" is just a character here.
   */
  openOnSlash(view: EditorView): boolean {
    const { $from, empty } = view.state.selection;
    const inCell = $from.depth > 1 && ['tableCell', 'tableHeader'].includes($from.node($from.depth - 1).type.name);
    const blank = $from.parent.content.size === 0;
    if (!empty || $from.parent.type.name !== 'paragraph' || !(blank || (inCell && $from.parentOffset === 0))) return false;
    const c = view.coordsAtPos($from.pos);
    this.open(new DOMRect(c.left, c.top, 0, c.bottom - c.top), blank ? { replace: $from.before() } : { at: $from.before() });
    return true;
  }

  open(anchor: DOMRect, target: InsertTarget): void {
    this.openedAt = performance.now();
    this.target = target;
    this.input.value = '';
    this.filter();
    this.el.hidden = false;
    const h = this.el.offsetHeight;
    const below = anchor.bottom + 6;
    const top = below + h > innerHeight - 8 ? Math.max(8, anchor.top - h - 6) : below;
    this.el.style.top = `${top}px`;
    this.el.style.left = `${Math.min(anchor.left, innerWidth - this.el.offsetWidth - 8)}px`;
    this.input.focus();
    void this.loadLibrary();
  }

  /** The Library group at the end of the list: its sections and snippets (none where the server keeps neither). */
  private async loadLibrary(): Promise<void> {
    const blocks = (doc: JSONContent) => `${doc.content?.length ?? 0} block${doc.content?.length === 1 ? '' : 's'}`;
    if (!snippetsHere()) return;
    const fromLibrary = await library().then(
      (r) => r.items.filter((i) => i.kind !== 'template' && !!i.body.doc).map((i): Piece => ({ name: i.name, doc: i.body.doc!, folder: i.folder, item: i, hint: [i.kind === 'section' ? 'Section' : 'Snippet', blocks(i.body.doc!), i.folder, i.synced ? 'synced' : ''].filter(Boolean).join(' · ') })),
      () => null,
    );
    const list =
      fromLibrary ??
      (await snippets().catch(() => null))
        ?.slice()
        .sort(byPlace)
        .map((sn): Piece => ({ name: sn.name, doc: sn.doc, folder: folderOf(sn), item: null, hint: `${blocks(sn.doc)}${folderOf(sn) ? ` · ${folderOf(sn)}` : ''}${sn.shared ? ' · shared' : ''}` }));
    for (const [def] of this.snips) this.items.find((i) => i.def === def)?.btn.remove();
    this.items = this.items.filter((i) => !this.snips.has(i.def));
    this.snips.clear();
    this.list.querySelector('[data-group="Library"]')?.remove();
    if (!list?.length || this.el.hidden) return;
    const head = Object.assign(document.createElement('p'), { className: 'ms-insert__group', textContent: 'Library' });
    head.dataset.group = 'Library';
    this.list.append(head);
    for (const sn of list) {
      const def: InserterEntry = { id: `library:${sn.item?.id ?? sn.name}`, title: sn.name, hint: sn.hint, group: 'Library', keywords: `library snippet section saved reuse ${sn.folder} ${sn.item?.tags.join(' ') ?? ''}`, preview: SNIPPET_PIC, make: () => ({ type: 'paragraph' }) };
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ms-insert__item';
      btn.setAttribute('role', 'option');
      btn.innerHTML = `<span class="ms-insert__pic">${SNIPPET_PIC}</span><span class="ms-insert__txt"><strong></strong><span></span></span>`;
      btn.querySelector('strong')!.textContent = def.title;
      btn.querySelector('.ms-insert__txt span')!.textContent = def.hint;
      btn.addEventListener('click', () => this.choose(def));
      btn.addEventListener('mousemove', () => this.highlight(this.visible().findIndex((v) => v.def === def)));
      this.list.append(btn);
      this.items.push({ def, btn });
      this.snips.set(def, sn);
    }
    this.filter();
  }

  close(refocus = false): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.target = null;
    if (refocus) this.getEditor()?.view.focus();
  }

  private visible() {
    return this.items.filter((i) => !i.btn.hidden);
  }

  private filter(): void {
    const q = this.input.value.trim().toLowerCase();
    for (const i of this.items) i.btn.hidden = !!q && !`${i.def.title} ${i.def.keywords}`.toLowerCase().includes(q);
    for (const head of this.list.querySelectorAll<HTMLElement>('.ms-insert__group')) {
      head.hidden = !this.items.some((i) => i.def.group === head.dataset.group && !i.btn.hidden);
    }
    // the best match first: a title that starts with the words, then one that has them, then a keyword
    const vis = this.visible();
    const score = (d: InserterEntry) => (d.title.toLowerCase().startsWith(q) ? 0 : d.title.toLowerCase().includes(q) ? 1 : 2);
    const best = q ? vis.reduce((b, v, i) => (score(v.def) < score(vis[b].def) ? i : b), 0) : 0;
    this.highlight(best);
  }

  private highlight(n: number): void {
    const vis = this.visible();
    this.active = Math.max(0, Math.min(n, vis.length - 1));
    for (const i of this.items) i.btn.classList.remove('is-active');
    const cur = vis[this.active];
    if (cur) {
      cur.btn.classList.add('is-active');
      cur.btn.scrollIntoView({ block: 'nearest' });
    }
  }

  private key(e: KeyboardEvent): void {
    const vis = this.visible();
    if (e.key === 'ArrowDown') this.highlight((this.active + 1) % Math.max(1, vis.length));
    else if (e.key === 'ArrowUp') this.highlight((this.active - 1 + vis.length) % Math.max(1, vis.length));
    else if (e.key === 'Enter') {
      if (vis[this.active]) this.choose(vis[this.active].def);
    } else if (e.key === 'Escape') this.close(true);
    else return;
    e.preventDefault();
  }

  private choose(def: InserterEntry): void {
    const editor = this.getEditor();
    const target = this.target;
    this.close();
    if (!editor || !target) return;
    const sn = this.snips.get(def);
    if (!sn) return insertBlock(editor, def, target);
    // a Library piece is whole blocks: it takes the empty line's place at the top level, else goes after the block it is in
    const doc = editor.state.doc;
    const pos = target.at ?? target.replace!;
    const $p = doc.resolve(pos);
    const line = target.replace !== undefined ? doc.nodeAt(pos) : null;
    const done = $p.depth === 0 ? insertSnippet(editor, sn, pos, line ? pos + line.nodeSize : pos) : insertSnippet(editor, sn, $p.after(1), $p.after(1));
    if (done && sn.item?.synced) listSynced(sn.item);
  }
}
