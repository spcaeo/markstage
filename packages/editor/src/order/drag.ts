// Dragging in the order component (index.ts): from a grip, a small label follows the pointer and a line shows where
// the items will land; in a tree, moving sideways sets the depth (in, out). Near the edges of the scrolling area it
// scrolls. Escape, or a drop outside the list, cancels.
import type { Place } from '@markstage/core';

export interface DragRow {
  id: string;
  depth: number;
  el: HTMLElement;
}

export interface DragOpts {
  list: HTMLElement;
  scroller: HTMLElement;
  /** the rows on screen in reading order */
  rows: DragRow[];
  /** the ids being dragged, and every row that moves with them (their children) */
  moving: Set<string>;
  /** the depth of the first dragged row, and how many levels its deepest child adds */
  depth: number;
  below: number;
  tree: boolean;
  maxDepth: number;
  /** px per level */
  indent: number;
  label: string;
  /** whether the items may land at a place; the drag takes the nearest depth that fits, or none (no line, no drop) */
  fits?(to: Place): boolean;
  start: PointerEvent;
  drop(to: Place): void;
  end(): void;
}

const EDGE = 48;

export function drag(o: DragOpts): void {
  const rows = o.rows.filter((r) => !o.moving.has(r.id));
  const line = document.createElement('div');
  line.className = 'ms-order__line';
  const ghost = document.createElement('div');
  ghost.className = 'ms-order__ghost';
  ghost.textContent = o.label;
  document.body.append(ghost);
  o.list.append(line);
  o.list.classList.add('is-dragging');
  for (const r of o.rows) if (o.moving.has(r.id)) r.el.classList.add('is-moving');

  let x = o.start.clientX;
  let y = o.start.clientY;
  let place: Place | null = null;
  let frame = 0;

  const compute = () => {
    // the slot: before the first row whose middle is below the pointer
    let slot = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!.el.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        slot = i;
        break;
      }
    }
    const prev = rows[slot - 1];
    const next = rows[slot];
    // the parent: the nearest row above at one level less; the index: the rows between at this level
    const placeAt = (depth: number): { to: Place; depth: number } => {
      let parent: string | null = null;
      let index = 0;
      for (let i = slot - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.depth === depth) index++;
        if (r.depth < depth) {
          parent = r.id;
          break;
        }
      }
      return { to: { parent, index }, depth: depth > 0 && parent === null ? 0 : depth };
    };
    let depths = [0];
    if (o.tree) {
      const wanted = o.depth + Math.round((x - o.start.clientX) / o.indent);
      const most = Math.min(prev ? prev.depth + 1 : 0, o.maxDepth - o.below);
      const least = next ? next.depth : 0;
      // the depth the pointer asks for; with fits(), the nearest one between the rows that the items may take
      depths = [Math.max(least, Math.min(wanted, most))];
      if (o.fits) for (let d = least; d <= most; d++) if (d !== depths[0]) depths.push(d);
      depths.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted));
    }
    const found = depths.map(placeAt).find((p) => !o.fits || o.fits(p.to)) ?? null;
    place = found?.to ?? null;
    line.hidden = !found;
    if (!found) return;
    const depth = found.depth;
    // the line: at the slot, indented to the depth
    const box = o.list.getBoundingClientRect();
    const at = next ? next.el.getBoundingClientRect().top : prev ? prev.el.getBoundingClientRect().bottom : box.top;
    line.style.top = `${at - box.top + o.list.scrollTop - 1}px`;
    line.style.left = `${depth * o.indent}px`;
  };

  const scroll = () => {
    const r = o.scroller.getBoundingClientRect();
    const d = y < r.top + EDGE ? -Math.ceil((r.top + EDGE - y) / 4) : y > r.bottom - EDGE ? Math.ceil((y - (r.bottom - EDGE)) / 4) : 0;
    if (d) {
      o.scroller.scrollTop += d;
      compute();
    }
    frame = requestAnimationFrame(scroll);
  };

  const onMove = (e: PointerEvent) => {
    x = e.clientX;
    y = e.clientY;
    ghost.style.transform = `translate(${x + 12}px, ${y + 10}px)`;
    compute();
  };
  const finish = (to: Place | null) => {
    cancelAnimationFrame(frame);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('keydown', onKey, true);
    line.remove();
    ghost.remove();
    o.list.classList.remove('is-dragging');
    for (const r of o.rows) r.el.classList.remove('is-moving');
    if (to) o.drop(to);
    o.end();
  };
  const onUp = (e: PointerEvent) => {
    const r = o.list.getBoundingClientRect();
    const inside = e.clientX >= r.left - 40 && e.clientX <= r.right + 40 && e.clientY >= r.top - 40 && e.clientY <= r.bottom + 40;
    finish(inside ? place : null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish(null);
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('keydown', onKey, true);
  onMove(o.start);
  frame = requestAnimationFrame(scroll);
}
