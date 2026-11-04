// Padlocks on the article's canvas (locks.ts, lock-ui.ts): a "Locked" pill just above the top right of every
// locked box or heading, always shown, for every role; an open one ("Lock") on hover over a box or heading that can be locked (for the roles that may).
// A click opens its popover, and the URL says which (lock=<block index>), so a reload opens it again. A box locked
// against edits can't be typed in. The padlocks sit in a layer over the canvas, outside the edited text.
import { Extension, type Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { blockCount, blockStarts } from './blocks';
import { closeLockPopover, openLockPopover, padlockButton, type LockTarget } from './lock-ui';
import { freshLockRules, lockInfo, setLock, useLockStore } from './locks';
import * as router from './router';
import { boxLabel, viewerRole } from './runtime';
import type { FrontmatterEdits } from './settings/state';

const EDITORS = ['owner', 'administrator', 'editor'];
let current: Padlocks | null = null;
/** Opens the lock popover of the block at `index` (the grip menu's "Lock…" / "Unlock…"). */
export const openLockAt = (index: number) => current?.open(index);

export class Padlocks {
  /** The canvas's padlocks (made with the first editor, then kept). */
  static on(sheet: HTMLElement, getEditor: () => Editor | null, edits: FrontmatterEdits): Padlocks {
    return current ?? new Padlocks(sheet, getEditor, edits);
  }

  private layer: HTMLElement;
  private frame = 0;
  private hovered = -1;
  private opened: number | null = null;

  constructor(
    private sheet: HTMLElement,
    private getEditor: () => Editor | null,
    edits: FrontmatterEdits,
  ) {
    current = this;
    useLockStore({ get: () => edits.get('locks'), set: (v) => edits.set('locks', v) });
    edits.onChange((path) => (path === null || path === 'locks') && this.changed());
    this.layer = document.createElement('div');
    this.layer.className = 'ms-padlocks';
    sheet.append(this.layer);
    sheet.addEventListener('mousemove', (e) => this.hover(e));
    sheet.addEventListener('mouseleave', () => this.setHover(-1));
    new ResizeObserver(() => this.update()).observe(sheet);
    // Back, Forward or a typed address opened or closed a popover
    router.onChange((r) => r.lock !== this.opened && this.follow());
    // the site's rules as the server has them now
    addEventListener('ms-lock-rules', () => this.changed());
  }

  /** The TipTap extension: the padlocks follow the text, and a box locked against edits takes no typing. */
  extension() {
    const self = this;
    return Extension.create({
      name: 'padlocks',
      onCreate() {
        freshLockRules();
        self.update();
        requestAnimationFrame(() => self.follow());
      },
      onUpdate() {
        self.update();
      },
      addProseMirrorPlugins() {
        return [
          new Plugin({
            props: {
              decorations(state) {
                const out: Decoration[] = [];
                const starts = blockStarts(state.doc);
                state.doc.forEach((node, _, i) => {
                  if (lockInfo(node)?.lock?.edit) out.push(Decoration.node(starts[i]!, starts[i]! + node.nodeSize, { contenteditable: 'false', class: 'ms-edit-locked' }));
                });
                return DecorationSet.create(state.doc, out);
              },
            },
          }),
        ];
      },
    });
  }

  update(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  /** The entry's locks changed (a switch, Undo, another entry): the canvas, the Outline and the popover follow. */
  private changed(): void {
    const editor = this.getEditor();
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('ms-locks', true));
    dispatchEvent(new Event('ms-locks'));
    this.update();
  }

  /** Where a block's pill goes: just above its top right corner, clear of its border and of the box's own buttons
   *  (an FAQ's "Expand all"), in the layer's terms (its right edge). */
  private spot(index: number): { right: number; top: number } | null {
    const editor = this.getEditor();
    if (!editor || index < 0 || index >= editor.state.doc.childCount) return null;
    const dom = editor.view.nodeDOM(blockStarts(editor.state.doc)[index]!) as HTMLElement | null;
    if (!dom?.getBoundingClientRect) return null;
    const r = dom.getBoundingClientRect();
    const s = this.sheet.getBoundingClientRect();
    return { right: r.right - s.left, top: r.top - s.top - 30 };
  }

  private draw(): void {
    const editor = this.getEditor();
    // a redraw keeps the keyboard on the padlock it was on (Esc out of a popover lands back on its padlock)
    const focused = this.layer.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.index : undefined;
    this.layer.replaceChildren();
    if (!editor || editor.isDestroyed) return;
    const doc = editor.state.doc;
    const n = blockCount(doc);
    doc.forEach((node, _, i) => {
      const lock = i < n ? lockInfo(node)?.lock : undefined;
      if (lock || i === this.hovered || i === this.opened || String(i) === focused) this.put(i, !!lock);
    });
    if (focused) this.layer.querySelector<HTMLElement>(`[data-index="${focused}"]`)?.focus();
  }

  private put(index: number, locked: boolean): HTMLButtonElement | null {
    const at = this.spot(index);
    const info = lockInfo(this.getEditor()?.state.doc.maybeChild(index));
    if (!at || !info) return null;
    const b = padlockButton(info.lock, () => this.open(index));
    b.dataset.index = String(index);
    if (!locked) b.classList.add('is-hover');
    b.setAttribute('aria-expanded', String(this.opened === index));
    b.style.top = `${at.top}px`;
    this.layer.append(b);
    b.style.left = `${at.right - b.offsetWidth}px`;
    return b;
  }

  /** An open padlock over the box or heading under the pointer (for the roles that may lock). */
  private hover(e: MouseEvent): void {
    const editor = this.getEditor();
    if (!editor || !EDITORS.includes(viewerRole()) || (e.target as Element).closest('.ms-padlock')) return;
    const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    const doc = editor.state.doc;
    const i = pos ? doc.resolve(Math.min(pos.pos, doc.content.size)).index(0) : -1;
    this.setHover(i >= 0 && i < blockCount(doc) && lockInfo(doc.child(i)) ? i : -1);
  }

  private setHover(i: number): void {
    if (i === this.hovered) return;
    this.hovered = i;
    this.update();
  }

  /** What the popover shows for the block at `index`, read again after each change. */
  private target(index: number): LockTarget | null {
    const node = this.getEditor()?.state.doc.maybeChild(index);
    const info = lockInfo(node);
    if (!info) return null;
    const box = 'box' in info.on ? info.on.box : null;
    // a run drawn as one (a group of FAQs) is named by its items
    const group = !!box && node!.type.name !== box;
    return {
      label: box ? `${boxLabel(box)}${group ? 's' : ' box'}` : `Section “${'heading' in info.on ? info.on.heading : ''}”`,
      site: info.site,
      lock: info.lock,
      set: (want) => setLock(info, want, this.getEditor(), blockStarts(this.getEditor()!.state.doc)[index]),
      ruleHref: box ? `#/settings/locks?kind=articles&type=${encodeURIComponent(box)}` : undefined,
    };
  }

  open(index: number): void {
    if (!this.target(index)) return;
    this.opened = index;
    this.draw();
    const anchor = this.layer.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? this.put(index, false);
    if (!anchor) return;
    anchor.scrollIntoView({ block: 'nearest' });
    if (router.route().lock !== index) router.go({ lock: index });
    openLockPopover(anchor, () => this.target(index), () => {
      this.opened = null;
      if (router.route().lock !== null) router.go({ lock: null });
      this.update();
    });
  }

  /** The URL's popover (lock=), once the canvas is drawn. */
  private follow(): void {
    const want = router.route().lock;
    if (want === null) return void (this.opened !== null && closeLockPopover());
    if (want !== this.opened) this.open(want);
  }
}
