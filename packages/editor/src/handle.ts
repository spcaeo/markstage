// The handle left of the block under the pointer: "+" opens the block menu (insert after it, or replace it when
// it is an empty line); the grip drags the block, and a click on it opens Move up / down / to the top / to the
// bottom / to… (only the ones that apply), Duplicate and Delete (with Undo). Inside a box the handle is on the item
// under the pointer (a list item, an FAQ question, a fact card: blocks.ts isItem), which moves among its own; near
// the box's left edge it is on the box. Moves go through blocks.ts, the same as Alt+↑/↓ and the Outline.
import type { Editor } from '@tiptap/core';
import DragHandle from '@tiptap/extension-drag-handle';
import type { Lock } from '@markstage/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { blockCount, childStarts, inSentence, isItem, itemNoun, moveChildrenTr } from './blocks';
import { toast } from './host';
import { ic } from './icons';
import type { InsertMenu } from './inserter';
import { blockLock, lockInfo, lockReason } from './locks';
import { openLockAt } from './padlocks';
import { viewerRole } from './runtime';
import { moveToDialog } from './order/move-to';
import { describe } from './outline';
import { snippetsHere } from './snippets/api';
import { blocksDoc } from './snippets/save';
import { saveToLibrary } from './reusable/save';

interface Hovered {
  node: PMNode;
  pos: number;
}

export class BlockHandle {
  readonly el: HTMLElement;
  private menu: HTMLElement;
  private hovered: Hovered | null = null;
  /** the block the menu acts on (kept while the menu is open, when the handle may move on) */
  private target: Hovered | null = null;
  private grip: HTMLButtonElement;
  private said = 0;

  constructor(
    private getEditor: () => Editor | null,
    private inserter: InsertMenu,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'ms-handle is-off';
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'ms-handle__btn';
    plus.dataset.msPlus = '';
    plus.setAttribute('aria-label', 'Add a block below');
    plus.title = 'Add a block below';
    plus.innerHTML = ic('plus', 16);
    const grip = (this.grip = document.createElement('button'));
    grip.type = 'button';
    grip.className = 'ms-handle__btn ms-handle__grip';
    grip.setAttribute('aria-label', 'Drag to move, click for block actions');
    grip.title = 'Drag to move · click for actions';
    grip.innerHTML = ic('grip', 16);
    this.el.append(plus, grip);
    plus.addEventListener('mousedown', (e) => e.preventDefault());
    plus.addEventListener('click', () => this.plus(plus));
    grip.addEventListener('click', () => this.openMenu(grip));

    this.menu = document.createElement('div');
    this.menu.className = 'ms-pop ms-menu';
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'menu');
    this.menu.addEventListener('keydown', (e) => {
      const items = [...this.menu.querySelectorAll<HTMLElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
      else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
      else if (e.key === 'Escape') this.closeMenu(true);
      else return;
      e.preventDefault();
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.el.contains(e.target as Node)) this.closeMenu();
    });
    document.body.append(this.menu);
    // a box the site locks against moves is not dragged (before the drag handle starts it)
    document.addEventListener(
      'dragstart',
      (e) => {
        const lock = this.topLock(this.hovered);
        if (!lock?.move || !(e.target instanceof Node) || !this.el.contains(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        // one note per attempt (the browser may start the drag twice)
        if (Date.now() - this.said > 1500) toast(lockReason(lock), 'info');
        this.said = Date.now();
      },
      true,
    );
  }

  /** The site's lock on a top-level block (a box's own items are not locked by it). */
  private topLock(h: Hovered | null) {
    const editor = this.getEditor();
    return h && editor && editor.state.doc.resolve(h.pos).depth === 0 ? blockLock(h.node) : undefined;
  }

  /** The TipTap extension that positions this handle next to the hovered top-level block. */
  extension() {
    return DragHandle.configure({
      render: () => this.el,
      // the items of a box too, nothing else inside one (its paragraphs and headings move with the box)
      nested: { rules: [{ id: 'boxItems', evaluate: ({ node, parent }) => (!parent || parent.type.name === 'doc' || isItem(node, parent) ? 0 : 1000) }] },
      computePositionConfig: { placement: 'left-start', strategy: 'absolute' },
      onNodeChange: (o: { node: PMNode | null; pos?: number }) => {
        this.hovered = o.node && typeof o.pos === 'number' && o.pos >= 0 ? { node: o.node, pos: o.pos } : null;
        this.el.classList.toggle('is-off', !this.hovered);
        // "+" adds blocks between blocks, not inside a list or a FAQ
        this.el.classList.toggle('is-nested', !!this.hovered && this.getEditor()?.state.doc.resolve(this.hovered.pos).depth !== 0);
        this.el.classList.toggle('is-empty-line', !!o.node && o.node.type.name === 'paragraph' && o.node.content.size === 0);
        const lock = this.topLock(this.hovered);
        this.el.classList.toggle('is-locked', !!lock);
        this.grip.title = lock ? `${lockReason(lock)} Click for actions.` : 'Drag to move · click for actions';
      },
    });
  }

  private fresh(h: Hovered | null): Hovered | null {
    const editor = this.getEditor();
    if (!editor || !h) return null;
    const node = editor.state.doc.nodeAt(h.pos);
    return node ? { node, pos: h.pos } : null;
  }

  private plus(anchor: HTMLElement): void {
    const h = this.fresh(this.hovered);
    if (!h) return;
    const empty = h.node.type.name === 'paragraph' && h.node.content.size === 0;
    this.inserter.open(anchor.getBoundingClientRect(), empty ? { replace: h.pos } : { at: h.pos + h.node.nodeSize });
  }

  private openMenu(anchor: HTMLElement): void {
    this.target = this.fresh(this.hovered);
    const editor = this.getEditor();
    if (!this.target || !editor) return;
    // the block being acted on is shown selected
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, this.target.pos)));
    editor.commands.lockDragHandle?.();
    const at = this.place(this.target);
    this.fill(at.index, at.count, this.nesting(this.target), this.topLock(this.target), at.top && !!lockInfo(this.target.node), at.top);
    this.menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    this.menu.style.top = `${Math.min(r.bottom + 4, innerHeight - this.menu.offsetHeight - 8)}px`;
    this.menu.style.left = `${r.left}px`;
    this.menu.querySelector<HTMLElement>('button')?.focus();
  }

  closeMenu(refocus = false): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.getEditor()?.commands.unlockDragHandle?.();
    if (refocus) this.getEditor()?.view.focus();
  }

  /** A list item can go inside the one above (not the first) and out of a list inside another (not the top list). */
  private nesting(t: Hovered): { indent: boolean; outdent: boolean } | null {
    if (!/^(listItem|taskItem)$/.test(t.node.type.name)) return null;
    const $p = this.getEditor()!.state.doc.resolve(t.pos);
    return { indent: $p.index() > 0, outdent: $p.depth >= 2 && /^(listItem|taskItem)$/.test($p.node($p.depth - 1).type.name) };
  }

  /** Indents (inside the item above) or outdents the list item, as Tab and Shift+Tab do in it. */
  private nest(inward: boolean): void {
    const editor = this.getEditor();
    const t = this.fresh(this.target);
    if (!editor || !t) return;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(t.pos + 2))));
    const chain = editor.chain().focus();
    void (inward ? chain.sinkListItem(t.node.type.name) : chain.liftListItem(t.node.type.name)).run();
  }

  /** Only what applies to the block at `index` of `count`: no "Move up" for the first. */
  private fill(index: number, count: number, nesting: { indent: boolean; outdent: boolean } | null = null, lock?: Lock, lockable = false, top = false): void {
    // a locked action stays in the menu, greyed, and says why (focusable, so a screen reader reads the reason)
    const item = (icon: string, label: string, run: () => void, danger = false, why = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.className = `ms-menu__item${danger ? ' is-danger' : ''}`;
      b.innerHTML = `${ic(icon, 15)}<span>${label}</span>`;
      if (why) {
        b.setAttribute('aria-disabled', 'true');
        b.title = why;
      }
      b.addEventListener('click', () => {
        this.closeMenu();
        if (why) toast(why, 'info');
        else run();
      });
      return b;
    };
    const mv = lock?.move ? lockReason(lock) : '';
    const first = index === 0;
    const last = index >= count - 1;
    this.menu.replaceChildren(
      ...(first ? [] : [item('up', 'Move up', () => this.move(index - 1), false, mv)]),
      ...(last ? [] : [item('down', 'Move down', () => this.move(index + 1), false, mv)]),
      ...(first ? [] : [item('up', 'Move to the top', () => this.move(0), false, mv)]),
      ...(last ? [] : [item('down', 'Move to the bottom', () => this.move(count - 1), false, mv)]),
      ...(count > 1 ? [item('layers', 'Move to…', () => void this.moveTo(), false, mv)] : []),
      ...(nesting?.indent ? [item('redo', 'Indent (inside the one above)', () => this.nest(true))] : []),
      ...(nesting?.outdent ? [item('undo', 'Outdent', () => this.nest(false))] : []),
      item('duplicate', 'Duplicate', () => this.duplicate()),
      // a block of the article (not a box's item) kept in the Library to use again, where the server keeps one
      ...(top && snippetsHere() ? [item('copy', 'Save section to Library…', () => this.getEditor() && saveToLibrary(this.getEditor()!, blocksDoc(this.getEditor()!, index, index), 1))] : []),
      // a box or a heading: its lock (the padlock's popover), for the roles that may change it
      ...(lockable && ['owner', 'administrator', 'editor'].includes(viewerRole()) ? [item(lock ? 'unlock' : 'lock', lock ? 'Unlock…' : 'Lock…', () => openLockAt(index))] : []),
      item('trash', 'Delete', () => this.remove(), true, lock?.remove ? lockReason(lock) : ''),
    );
    if (lock) this.menu.append(Object.assign(document.createElement('p'), { className: 'ms-menu__empty', textContent: lockReason(lock) }));
  }

  /** Where the target sits: among the article's blocks, or among a box's items. */
  private place(t: Hovered) {
    const doc = this.getEditor()!.state.doc;
    const $p = doc.resolve(t.pos);
    const top = $p.depth === 0;
    return { top, base: top ? 0 : $p.start(), parent: $p.parent, index: $p.index(), count: top ? blockCount(doc) : $p.parent.childCount, noun: itemNoun(t.node, top) };
  }

  /** Moves the block (or item) to `to` (an index among the others), selected where it lands. */
  private move(to: number): void {
    const editor = this.getEditor();
    const t = this.fresh(this.target);
    if (!editor || !t) return;
    const p = this.place(t);
    const tr = editor.state.tr;
    const at = moveChildrenTr(tr, p.base, [p.index], to);
    if (at === null) return;
    tr.setSelection(NodeSelection.create(tr.doc, at));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  }

  private async moveTo(): Promise<void> {
    const editor = this.getEditor();
    const t = this.fresh(this.target);
    if (!editor || !t) return;
    const p = this.place(t);
    const items: { id: string; label: string }[] = [];
    p.parent.forEach((node, _, i) => {
      if (i >= p.count) return;
      const d = describe(node);
      items.push({ id: String(i), label: d.text ? `${d.kind}: ${d.text}` : d.kind });
    });
    const to = await moveToDialog({ noun: inSentence(p.noun), count: 1, items, moving: new Set([String(p.index)]), tree: false, maxDepth: 0, below: 0 });
    // the article may have changed while the dialog was open: the block is found again
    this.target = t;
    if (to) this.move(to.index);
    else editor.view.focus();
  }

  private duplicate(): void {
    const editor = this.getEditor();
    const t = this.fresh(this.target);
    if (!editor || !t) return;
    const at = t.pos + t.node.nodeSize;
    const tr = editor.state.tr.insert(at, t.node.copy(t.node.content));
    tr.setSelection(NodeSelection.create(tr.doc, at));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  }

  private remove(): void {
    const editor = this.getEditor();
    const t = this.fresh(this.target);
    if (!editor || !t) return;
    const p = this.place(t);
    const tr = editor.state.tr.delete(t.pos, t.pos + t.node.nodeSize);
    const filler = tr.doc.childCount === 0;
    if (filler) tr.insert(0, editor.state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(t.pos, tr.doc.content.size))));
    editor.view.dispatch(tr);
    editor.view.focus();
    const d = describe(t.node);
    const what = !p.top ? inSentence(p.noun) : /^H\d$/.test(d.kind) ? 'heading' : d.kind === 'Text' ? 'paragraph' : inSentence(d.kind);
    // back where it was (one more change, so ⌘Z takes that back too)
    toast(`Deleted the ${what}.`, 'ok', {
      action: {
        label: 'Undo',
        run: () => {
          const e = this.getEditor();
          if (!e || e !== editor) return;
          const back = e.state.tr;
          // the box it was in, still there (else nothing to put it back into)
          const parent = p.top ? back.doc : p.base <= back.doc.content.size ? back.doc.resolve(p.base).parent : null;
          if (!parent || parent.type !== p.parent.type) return;
          const only = back.doc.childCount === 1 && back.doc.firstChild!.type.name === 'paragraph' && !back.doc.firstChild!.content.size;
          if (p.top && filler && only) back.delete(0, back.doc.firstChild!.nodeSize);
          const now = p.top ? back.doc : back.doc.resolve(p.base).parent;
          const at = childStarts(now, p.base)[p.index] ?? p.base + now.content.size;
          back.insert(at, t.node);
          back.setSelection(NodeSelection.create(back.doc, at));
          e.view.dispatch(back.scrollIntoView());
          e.view.focus();
        },
      },
    });
  }
}
