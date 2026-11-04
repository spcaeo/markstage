// The Outline (the header's Outline button, ?side=outline in the URL): every block of the article in a list in the
// right column, where the settings go (one of them at a time). The blocks before the first H2 come first, then a
// section per H2 (or H1) with its blocks under it; a section folds (its chevron, ← and → on its row, fold=2,5 in the
// URL), and "Headings only" (heads=1) hides the other blocks. A click on a row goes to that block; the order
// component (order/index.ts) moves them: drag by the grip, Alt+↑/↓ on a row, Move to the top / bottom / to…,
// ⌘-click or Shift-click several, Delete with Undo, ⌘D duplicates. A row stands for the blocks it hides: moving (or
// deleting) a heading takes its section along, and a heading keeps to the top level, after the opening blocks.
// Every change is one transaction on the canvas (blocks.ts), so ⌘Z there takes it back and a moved block is saved
// as it was. The list follows the canvas as the writer types.
import './styles/outline.css';
import { Extension, type Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { blockCount, blockStarts, moveBlocksTr } from './blocks';
import { blockLock, lockInfo, lockReason } from './locks';
import { openLockAt } from './padlocks';
import { toast } from './host';
import { ic } from './icons';
import { mountOrder, type OrderItem, type OrderList, type Place } from './order';
import { Panel } from './panel';
import * as router from './router';
import { boxLabel, viewerRole } from './runtime';

export interface BlockItem extends OrderItem {
  kind: string;
  text: string;
  level: number;
  /** the block's index in the article */
  index: number;
  /** the blocks the row stands for, from `index`: itself and the ones hidden after it (a folded section, Headings
   *  only); a heading's shown blocks are its children */
  span: number;
  /** a section's heading (H1, H2): the blocks up to the next one are its section, which ends before `end` */
  head: boolean;
  end: number;
  children?: BlockItem[];
}

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What a row says about a block: its kind ("H2", "Text", "Image", a box's name) and its words. */
export function describe(node: PMNode): { kind: string; text: string; level: number } {
  // the words of every paragraph inside, apart (a box's list items do not run together), at most a line's worth
  const t = short(node.textBetween(0, node.content.size, ' ', ' ').replace(/\s+/g, ' ').trim());
  const name = node.type.name;
  if (name === 'heading') return { kind: `H${node.attrs.level}`, text: t || 'Empty heading', level: node.attrs.level };
  if (name === 'paragraph') return { kind: 'Text', text: t || 'Empty line', level: 0 };
  if (LISTS.has(name)) {
    const first = short(node.firstChild?.textContent.trim() ?? '', 70);
    return { kind: 'List', text: `${first || 'Empty item'}${node.childCount > 1 ? ` (+${node.childCount - 1})` : ''}`, level: 0 };
  }
  if (name === 'blockquote') return { kind: 'Quote', text: t, level: 0 };
  if (name === 'codeBlock') return { kind: 'Code', text: t.split('\n')[0] ?? '', level: 0 };
  if (name === 'horizontalRule') return { kind: 'Divider', text: '', level: 0 };
  if (name === 'image') return { kind: 'Image', text: node.attrs.alt || String(node.attrs.src ?? '').split('/').pop() || '', level: 0 };
  if (name === 'table') return { kind: 'Table', text: t, level: 0 };
  return { kind: boxLabel(name), text: t, level: 0 };
}

export class Outline {
  private body: HTMLElement;
  private count: HTMLElement;
  private headsBtn: HTMLButtonElement;
  private foldBtn: HTMLButtonElement;
  private order: OrderList | null = null;
  /** a block keeps its row (and its place in a selection) while it moves: the same node object, the same id */
  private ids = new WeakMap<PMNode, string>();
  private next = 0;
  private items: BlockItem[] = [];
  private byId = new Map<string, BlockItem>();
  /** the row each block of the article shows in (its own, or the one that hides it) */
  private rowAt: (string | undefined)[] = [];
  /** the sections' headings in order (fold=2: the second), the folded ones, and the folds the URL asks for */
  private heads: string[] = [];
  private folded = new Set<string>();
  private want: number[] | null = null;
  private headsOnly = false;
  private timer = 0;

  constructor(
    readonly el: HTMLElement,
    private button: HTMLButtonElement,
    private getEditor: () => Editor | null,
    /** the writer opened or closed it (the URL follows) */
    private onToggle: (open: boolean) => void,
  ) {
    el.innerHTML = `<header class="ms-panel__head"><h2 class="ms-panel__title">Outline <span class="ms-outline__count"></span></h2><button type="button" class="ms-iconbtn ms-panel__close" aria-label="Close the Outline (Esc)" title="Close the Outline (Esc)">${ic('x', 16)}</button></header><div class="ms-panel__body ms-outline__body"><p class="ms-panel__note">Click a block (or Enter) to go to it. Drag by the grip to move, or Alt+↑/↓ on a row; a heading takes its section along. ⌘-click or Shift-click to take several.</p><div class="ms-outline__tools"><button type="button" class="ms-btn ms-btn--quiet ms-btn--sm" data-heads aria-pressed="false" title="Show the headings only (the other blocks move with the heading above them)">Headings only</button><button type="button" class="ms-btn ms-btn--quiet ms-btn--sm" data-foldall>Fold all</button></div></div>`;
    this.body = el.querySelector('.ms-outline__body')!;
    this.count = el.querySelector('.ms-outline__count')!;
    this.headsBtn = el.querySelector('[data-heads]')!;
    this.foldBtn = el.querySelector('[data-foldall]')!;
    el.querySelector('.ms-panel__close')!.addEventListener('click', () => this.close());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation();
        this.close();
        this.getEditor()?.view.focus();
      }
    });
    button.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.headsBtn.addEventListener('click', () => {
      this.headsOnly = !this.headsOnly;
      this.refresh();
    });
    // every section folded, or (all folded already) every one open
    this.foldBtn.addEventListener('click', () => {
      const all = this.heads.length > 0 && this.heads.every((id) => this.folded.has(id));
      this.folded = new Set(all ? [] : this.heads);
      this.refresh();
    });
    // a lock was set or lifted (the padlock's popover): the rows' marks and menus follow
    addEventListener('ms-locks', () => this.refresh());
    // Back, Forward or a typed address changed the folds or Headings only
    router.onChange((r) => {
      if (!this.isOpen || r.side !== 'outline' || (r.heads === this.headsOnly && r.fold.join() === this.foldNumbers().join())) return;
      this.headsOnly = r.heads;
      this.want = r.fold;
      this.refresh();
    });
    this.show(false);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  /** Shows or hides it without telling the URL (it already says so). */
  show(on: boolean): void {
    this.el.classList.toggle('is-open', on);
    this.el.inert = !on;
    this.el.setAttribute('aria-hidden', String(!on));
    this.button.setAttribute('aria-pressed', String(on));
    this.button.classList.toggle('is-on', on);
    if (on) {
      this.headsOnly = router.route().heads;
      this.want = router.route().fold;
      this.refresh();
    } else {
      this.order?.destroy();
      this.order = null;
      this.body.querySelector('.ms-outline')?.remove();
    }
  }

  open(): void {
    if (this.isOpen) return;
    this.show(true);
    this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.show(false);
    this.onToggle(false);
  }

  /** The TipTap extension that keeps the list in step with the canvas (and the row of the caret marked). */
  extension() {
    const self = this;
    return Extension.create({
      name: 'outline',
      // another entry opened (a new editor): its blocks
      onCreate() {
        self.refresh();
      },
      onUpdate() {
        // typing: once it pauses; the outline's own moves draw at once (the order component)
        clearTimeout(self.timer);
        self.timer = window.setTimeout(() => self.refresh(), 250);
      },
      onSelectionUpdate() {
        self.mark();
      },
    });
  }

  /** The article's blocks as rows: the opening blocks, then a row per section heading with its blocks under it. */
  private read(): BlockItem[] {
    const doc = this.getEditor()?.state.doc;
    this.byId.clear();
    this.rowAt = [];
    if (!doc) return (this.heads = []);
    const used = new Set<string>();
    const blocks: BlockItem[] = [];
    doc.forEach((node, _, i) => {
      if (i >= blockCount(doc)) return;
      let id = this.ids.get(node);
      // the same node twice in a document: the second gets its own row
      if (!id || used.has(id)) this.ids.set(node, (id = `b${++this.next}`));
      used.add(id);
      const d = describe(node);
      const lock = blockLock(node);
      const head = node.type.name === 'heading' && d.level <= 2;
      blocks.push({ id, label: d.text ? `${d.kind}: ${short(d.text, 50)}` : d.kind, ...d, index: i, span: 1, head, end: i + 1, ...(lock ? { lock } : {}) });
    });
    // the folds: the URL's (by number), else the same headings as before; a heading the writer typed in is a new
    // node, so it keeps the fold of the one that stood at its place
    const before = this.heads;
    this.heads = blocks.filter((b) => b.head).map((b) => b.id);
    const now = new Set(this.heads);
    if (this.want) this.folded = new Set(this.want.map((n) => this.heads[n - 1]!).filter(Boolean));
    else this.folded = new Set(this.heads.filter((id, k) => this.folded.has(id) || (!before.includes(id) && before[k] !== undefined && !now.has(before[k]!) && this.folded.has(before[k]!))));
    this.want = null;
    const top: BlockItem[] = [];
    let section: BlockItem | null = null;
    let last: BlockItem | null = null;
    for (const b of blocks) {
      if (b.head) {
        section = last = b;
        b.children = [];
        top.push(b);
      } else if (section && this.folded.has(section.id)) section.span++;
      else if (this.headsOnly && !b.level) {
        // hidden: it goes with the row above it (none for the opening blocks)
        if (last) last.span++;
      } else {
        (section ? section.children! : top).push(b);
        last = b;
      }
      if (section) section.end = b.index + 1;
      this.rowAt[b.index] = section && this.folded.has(section.id) ? section.id : this.headsOnly && !b.level ? last?.id : b.id;
    }
    for (const b of blocks) this.byId.set(b.id, b);
    // a row that takes a move-locked block along (the FAQ in its section) can't move either: its menu says why
    for (const row of top.flatMap((t) => [t, ...(t.children ?? [])])) {
      const held = row.lock?.move ? null : this.covered([row.id]).map((i) => blocks[i]!).find((b) => b !== row && b.lock?.move);
      if (held) row.lock = { move: true, remove: !!row.lock?.remove, by: `${held.lock!.by ?? 'the site'} (the ${held.kind} in it)` };
    }
    this.count.textContent = `· ${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
    return top;
  }

  /** The section numbers that are folded (fold= in the URL). */
  private foldNumbers(): number[] {
    return this.heads.flatMap((id, k) => (this.folded.has(id) ? [k + 1] : []));
  }

  /** Draws the list again from the canvas (keeping the focused row), and the URL follows the folds. */
  refresh(): void {
    clearTimeout(this.timer);
    if (!this.isOpen) return;
    this.items = this.read();
    this.headsBtn.setAttribute('aria-pressed', String(this.headsOnly));
    const all = this.heads.length > 0 && this.heads.every((id) => this.folded.has(id));
    this.foldBtn.textContent = all ? 'Unfold all' : 'Fold all';
    this.foldBtn.hidden = !this.heads.length;
    const r = router.route();
    if (r.side === 'outline' && (r.heads !== this.headsOnly || r.fold.join() !== this.foldNumbers().join())) router.go({ heads: this.headsOnly, fold: this.foldNumbers() });
    if (!this.order) {
      const root = document.createElement('div');
      root.className = 'ms-outline';
      this.body.append(root);
      root.addEventListener('keydown', (e) => this.key(e), true);
      this.order = mountOrder<BlockItem>({
        root,
        noun: 'block',
        label: 'Blocks of the article',
        tree: true,
        maxDepth: 1,
        items: () => this.items,
        row: (it) => this.row(it),
        move: (ids, to) => this.move(ids, to),
        remove: (ids) => this.remove(ids),
        duplicate: (ids) => this.duplicate(ids),
        fits: (ids, to) => this.fits(ids, to),
        expanded: (it) => (it.head && it.end - it.index > 1 ? !this.folded.has(it.id) : undefined),
        note: (ids) => this.note(ids),
        // a box or a heading: its lock (the padlock's popover on the canvas), for the roles that may change it
        extra: (id) => {
          const it = this.byId.get(id);
          const node = it && this.getEditor()?.state.doc.maybeChild(it.index);
          if (!it || !lockInfo(node) || !['owner', 'administrator', 'editor'].includes(viewerRole())) return [];
          return [{ label: blockLock(node) ? 'Unlock…' : 'Lock…', icon: blockLock(node) ? 'unlock' : 'lock', run: () => openLockAt(it.index) }];
        },
        scroller: this.body,
      });
    } else {
      const focused = (document.activeElement as Element | null)?.closest<HTMLElement>('.ms-outline .ms-order__row')?.dataset.id;
      this.order.refresh();
      if (focused) this.order.focus(focused);
    }
    this.mark();
  }

  /** Enter goes to the block (the grip's menu is on Shift+F10 and the context-menu key, as in every list); ← folds
   *  a section (or goes up to its heading), → opens it. */
  private key(e: KeyboardEvent): void {
    const row = (e.target as Element).closest<HTMLElement>('.ms-order__row');
    if (!row || e.target !== row || e.altKey || e.metaKey || e.ctrlKey) return;
    const it = this.byId.get(row.dataset.id!);
    if (!it) return;
    if (e.key === 'Enter') this.goTo(it.id, true);
    else if (e.key === 'ArrowLeft' && row.getAttribute('aria-expanded') === 'true') this.fold(it.id, true);
    else if (e.key === 'ArrowRight' && row.getAttribute('aria-expanded') === 'false') this.fold(it.id, false);
    else if (e.key === 'ArrowLeft' && !it.head) {
      const up = this.items.find((s) => s.children?.includes(it));
      if (!up) return;
      this.order?.focus(up.id);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private fold(id: string, on: boolean): void {
    if (on) this.folded.add(id);
    else this.folded.delete(id);
    this.refresh();
    this.order?.focus(id);
  }

  private row(it: BlockItem): HTMLElement {
    // not a button: a click also selects the row (⌘-click and Shift-click add to it); Enter on the row goes there
    const go = document.createElement('span');
    go.className = 'ms-outline__go';
    go.dataset.kind = it.kind;
    if (it.level) go.dataset.level = String(it.level);
    go.title = 'Go to this block';
    const kind = document.createElement('span');
    kind.className = 'ms-outline__kind';
    kind.textContent = it.kind;
    const text = document.createElement('span');
    text.className = 'ms-outline__text';
    text.textContent = it.text;
    if (it.head && it.end - it.index > 1) {
      const folded = this.folded.has(it.id);
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'ms-outline__fold';
      t.tabIndex = -1;
      t.innerHTML = ic('down', 13);
      t.setAttribute('aria-label', `${folded ? 'Unfold' : 'Fold'} the section (${folded ? '→' : '←'})`);
      t.title = t.getAttribute('aria-label')!;
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        this.fold(it.id, !folded);
      });
      go.append(t);
    }
    go.append(kind, text);
    // what a row hides: a folded section's blocks, or the ones after a heading under Headings only
    if (it.span > 1) {
      const more = document.createElement('span');
      more.className = 'ms-outline__more';
      more.textContent = `+${it.span - 1}`;
      more.title = `${it.span - 1} more block${it.span === 2 ? '' : 's'} hidden here`;
      go.append(more);
    }
    go.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      this.goTo(it.id);
    });
    return go;
  }

  /** Puts the caret in the block (or selects it) and shows it; `focus`: the writer goes on there (Enter). A click
   *  leaves them in the list, the row selected. */
  private goTo(id: string, focus = false): void {
    const editor = this.getEditor();
    const it = this.byId.get(id);
    if (!editor || !it) return;
    Panel.selectBlock(editor, it.index);
    if (focus) editor.view.focus();
  }

  /** The row of the block the caret is in. */
  private mark(): void {
    const editor = this.getEditor();
    if (!this.isOpen || !editor) return;
    const here = this.rowAt[editor.state.doc.resolve(editor.state.selection.from).index(0)];
    for (const r of this.el.querySelectorAll<HTMLElement>('.ms-order__row')) r.classList.toggle('is-here', r.dataset.id === here);
  }

  /** The article's blocks the rows stand for: each row with what it hides, a heading with its section. */
  private covered(ids: string[]): number[] {
    const out = new Set<number>();
    const add = (it: BlockItem) => {
      for (let i = it.index; i < it.index + it.span; i++) out.add(i);
      for (const c of it.children ?? []) add(c);
    };
    for (const id of ids) {
      const it = this.byId.get(id);
      if (it) add(it);
    }
    return [...out].sort((a, b) => a - b);
  }

  /** A heading stays at the top level, after the opening blocks; another block goes into a section, or among the
   *  opening blocks. */
  private fits(ids: string[], to: Place): boolean {
    const first = ids.map((id) => this.byId.get(id)).filter((x): x is BlockItem => !!x).sort((a, b) => a.index - b.index)[0];
    if (!first) return false;
    if (to.parent) return !first.head && !!this.byId.get(to.parent)?.head;
    const stay = this.items.filter((s) => !ids.includes(s.id));
    const lead = stay.findIndex((s) => s.head);
    const opening = lead < 0 ? stay.length : lead;
    return first.head ? to.index >= opening : to.index <= opening;
  }

  private note(ids: string[]): string {
    const heads = ids.filter((id) => this.byId.get(id)?.head);
    const n = this.covered(ids).length;
    if (n <= ids.length) return '';
    if (!heads.length) return `The ${n - ids.length} hidden block${n - ids.length === 1 ? '' : 's'} under it move${n - ids.length === 1 ? 's' : ''} and delete${n - ids.length === 1 ? 's' : ''} with it.`;
    return `${heads.length === 1 ? 'The heading moves and deletes with its section' : 'The headings move and delete with their sections'} (${n} blocks).`;
  }

  /** One move on the canvas: the blocks the rows stand for, before the row they land on (or at the end of the
   *  section, or of the article). */
  private move(ids: string[], to: Place): void {
    const doc = this.getEditor()?.state.doc;
    if (!doc) return;
    const moving = this.covered(ids);
    const locked = moving.map((i) => blockLock(doc.child(i))).find((l) => l?.move);
    if (locked && moving.length > ids.length) return void toast(`${lockReason(locked)} Its section stays where it is.`, 'info');
    const parent = to.parent ? this.byId.get(to.parent) : null;
    const gone = new Set(moving);
    const stay = (parent ? (parent.children ?? []) : this.items).filter((s) => !gone.has(s.index));
    const at = stay[to.index]?.index ?? (parent ? parent.end : blockCount(doc));
    this.change((tr) => moveBlocksTr(tr, moving, at - moving.filter((i) => i < at).length));
  }

  /** One transaction on the canvas, and the list read again at once. */
  private change(fill: (tr: Transaction) => unknown): void {
    const editor = this.getEditor();
    if (!editor) return;
    const tr = editor.state.tr;
    if (fill(tr) === null || !tr.docChanged) return;
    editor.view.dispatch(tr.scrollIntoView());
    this.items = this.read();
    clearTimeout(this.timer);
  }

  private remove(ids: string[]): () => void {
    const doc = this.getEditor()!.state.doc;
    const idx = this.covered(ids);
    const gone = idx.map((i) => ({ i, node: doc.child(i) }));
    let filler = false;
    this.change((tr) => {
      const starts = blockStarts(tr.doc);
      for (const { i, node } of [...gone].reverse()) tr.delete(starts[i]!, starts[i]! + node.nodeSize);
      // a document is never empty: one empty line stays (and goes again when the blocks come back)
      if (tr.doc.childCount === 0) {
        tr.insert(0, tr.doc.type.schema.nodes.paragraph!.create());
        filler = true;
      }
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(starts[idx[0]!]!, tr.doc.content.size))));
    });
    // back where they were, each at its old index (the earlier ones first, so the indexes hold): one more change
    return () =>
      this.change((tr) => {
        if (filler && tr.doc.childCount === 1 && tr.doc.firstChild!.type.name === 'paragraph' && tr.doc.firstChild!.content.size === 0) tr.delete(0, tr.doc.firstChild!.nodeSize);
        for (const { i, node } of gone) {
          const at = blockStarts(tr.doc)[i] ?? tr.doc.content.size;
          tr.insert(at, node);
        }
      });
  }

  /** A copy of each run of blocks the rows stand for (a heading's section, whole), right after it. */
  private duplicate(ids: string[]): void {
    const runs: number[][] = [];
    for (const i of this.covered(ids)) {
      const run = runs[runs.length - 1];
      if (run && run[run.length - 1] === i - 1) run.push(i);
      else runs.push([i]);
    }
    this.change((tr) => {
      for (const run of runs.reverse()) {
        const nodes = run.map((i) => tr.doc.child(i));
        const end = run[run.length - 1]!;
        tr.insert(blockStarts(tr.doc)[end]! + tr.doc.child(end).nodeSize, Fragment.fromArray(nodes.map((n) => n.copy(n.content))));
      }
    });
  }
}
