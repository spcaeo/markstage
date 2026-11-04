// Library sections dragged onto the page itself. The page is in a frame on another origin, which keeps the drag to
// itself, so while a Library drag is on a sheet lies over the frame and takes it. The page agent says where its
// sections are drawn (page:track, then page:rects after each scroll) and scrolls when the drag nears the top or the
// bottom (page:scroll). A line between two sections shows where it lands, and says so in words. Over a locked
// section, and over the whole page when its layout is locked, nothing lands: the sheet says why, in words. A drop
// goes through place.ts, as the outline's does.
import type { Lock } from '@markstage/core';
import { h } from '../panel-form';
import type { LibItem } from '../reusable/api';
import { lockReason } from '../locks';
import { LIB_DRAG } from './library';
import type { PageFrame } from './frame';
import type { PageModel } from './model';
import { dropTarget, layoutLock, placeWords, type DropTarget } from './places';
import type { SectionRect } from './types';

/** The pixels at the frame's top and bottom where a drag scrolls the page. */
const EDGE = 56;

export interface CanvasDropOpts {
  stage: HTMLElement;
  frame: PageFrame;
  model: PageModel;
  item: (id: string) => LibItem | undefined;
  place: (it: LibItem, index: number) => void;
  label: (index: number) => string;
  lockOf: (index: number) => Lock | undefined;
  /** why the page as drawn does not match the entry now (sections changed, not drawn again yet), or null */
  outOfStep: () => string | null;
}

export class CanvasDrop {
  readonly el = h('div', 'msp-dropsheet');
  private line = h('div', 'msp-dropsheet__line');
  private tag = h('span', 'msp-dropsheet__tag');
  private no = h('div', 'msp-dropsheet__no');
  private rects: SectionRect[] = [];
  private height = 0;
  private lastY: number | null = null;
  /** while the drag is near the top or the bottom: how far the page scrolls each tick */
  private edgeBy = 0;
  private edgeTimer = 0;
  private on = false;

  private onStart = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(LIB_DRAG)) this.start();
  };
  private onEnd = () => this.stop();
  // a drag whose source was drawn again ends without a dragend reaching the document: the next mouse move with no
  // button held ends it
  private onMove = (e: MouseEvent) => this.on && e.buttons === 0 && this.stop();

  private o: CanvasDropOpts;

  constructor(o: CanvasDropOpts) {
    this.o = o;
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    this.line.append(this.tag);
    this.el.append(this.line, this.no);
    o.stage.append(this.el);
    this.el.addEventListener('dragover', (e) => this.over(e));
    this.el.addEventListener('dragleave', (e) => {
      if (this.el.contains(e.relatedTarget as Node | null)) return;
      this.clear();
      this.scroll(0);
    });
    this.el.addEventListener('drop', (e) => this.drop(e));
    document.addEventListener('dragstart', this.onStart);
    document.addEventListener('dragend', this.onEnd);
    document.addEventListener('drop', this.onEnd);
    document.addEventListener('mousemove', this.onMove);
  }

  /** The page agent's answer: where the sections are now. */
  rectsAre(rects: SectionRect[], height: number): void {
    this.rects = rects;
    this.height = height;
    if (this.on && this.lastY !== null) this.show(this.lastY);
  }

  private start(): void {
    const f = this.o.frame.el;
    // over the frame's window, inside its border
    Object.assign(this.el.style, { top: `${f.offsetTop + f.clientTop}px`, left: `${f.offsetLeft + f.clientLeft}px`, width: `${f.clientWidth}px`, height: `${f.clientHeight}px` });
    this.on = true;
    this.el.hidden = false;
    this.clear();
    this.o.frame.post({ markstage: 'page:track', on: true });
  }

  private stop(): void {
    this.scroll(0);
    if (!this.on) return;
    this.on = false;
    this.el.hidden = true;
    this.lastY = null;
    this.o.frame.post({ markstage: 'page:track', on: false });
  }

  private clear(): void {
    this.line.hidden = true;
    this.no.hidden = true;
  }

  private yOf(e: DragEvent): number {
    return e.clientY - this.el.getBoundingClientRect().top;
  }

  private target(y: number): DropTarget {
    const why = layoutLock(this.o.model) ?? this.o.outOfStep();
    if (why) return { why };
    const n = Array.isArray(this.o.model.get('sections')) ? (this.o.model.get('sections') as unknown[]).length : 0;
    return dropTarget(y, this.rects, n, (i) => {
      const lock = this.o.lockOf(i);
      return lock ? lockReason(lock) : null;
    }, this.o.label);
  }

  /** The line where it lands and what it says, or the reason nothing lands here. */
  private show(y: number): DropTarget {
    const t = this.target(y);
    const vh = this.height || this.el.clientHeight;
    if ('index' in t) {
      this.no.hidden = true;
      this.line.style.top = `${Math.max(2, Math.min(vh - 3, t.y)) - 1}px`;
      Object.assign(this.line.style, this.across(t.left, t.right));
      this.tag.textContent = `Drop here: ${placeWords(this.o.model, t.index, this.o.label)}`;
      this.line.classList.toggle('is-low', t.y < 28);
      this.line.hidden = false;
    } else {
      this.line.hidden = true;
      const box = t.box ? { top: Math.max(0, t.box.top), bottom: Math.min(vh, t.box.bottom) } : { top: 0, bottom: vh };
      Object.assign(this.no.style, { top: `${box.top}px`, height: `${Math.max(48, box.bottom - box.top)}px` }, this.across(t.box?.left, t.box?.right, 0));
      this.no.replaceChildren(Object.assign(h('span', 'msp-dropsheet__why'), { textContent: t.why }));
      this.no.hidden = false;
    }
    return t;
  }

  /** Left and right of the line or the box: the section's own sides when the page says them, else the window's. */
  private across(left?: number, right?: number, inset = 16): { left: string; right: string } {
    const w = this.el.clientWidth;
    if (left === undefined || right === undefined || right - left < 120) return { left: `${inset}px`, right: `${inset}px` };
    return { left: `${Math.max(0, left) + inset}px`, right: `${Math.max(0, w - right) + inset}px` };
  }

  private over(e: DragEvent): void {
    if (!this.on || !e.dataTransfer?.types.includes(LIB_DRAG)) return;
    const y = this.yOf(e);
    this.lastY = y;
    const t = this.show(y);
    // near an edge the page scrolls, a little more the nearer, also while the pointer rests there
    const vh = this.el.clientHeight;
    this.scroll(y < EDGE ? -Math.ceil((EDGE - y) / 3) - 3 : y > vh - EDGE ? Math.ceil((y - (vh - EDGE)) / 3) + 3 : 0);
    if (!('index' in t)) return void (e.dataTransfer.dropEffect = 'none');
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  /** Scrolls the page by `by` every 40 ms from now (0: stops). */
  private scroll(by: number): void {
    this.edgeBy = by;
    if (!by) {
      window.clearInterval(this.edgeTimer);
      this.edgeTimer = 0;
    } else if (!this.edgeTimer) {
      const tick = () => this.edgeBy && this.o.frame.post({ markstage: 'page:scroll', by: this.edgeBy });
      tick();
      this.edgeTimer = window.setInterval(tick, 40);
    }
  }

  private drop(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes(LIB_DRAG)) return;
    e.preventDefault();
    const t = this.target(this.yOf(e));
    const it = this.o.item(e.dataTransfer.getData(LIB_DRAG));
    this.stop();
    if (it && 'index' in t) this.o.place(it, t.index);
  }

  destroy(): void {
    this.stop();
    document.removeEventListener('dragstart', this.onStart);
    document.removeEventListener('dragend', this.onEnd);
    document.removeEventListener('drop', this.onEnd);
    document.removeEventListener('mousemove', this.onMove);
    this.el.remove();
  }
}
