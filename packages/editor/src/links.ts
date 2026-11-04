// Links with a meaning on the site (config editor.links): the special links offered first in the link search (e.g.
// "Book a call"), and links the site opens in a popup (a CSS selector, the site's own rule): those get a small
// calendar badge on the canvas and a note on their link card. The badges sit in a layer over the canvas, outside the
// edited text, so neither the text nor the site's own link styles change.
import { ic } from './icons';
import { config } from './runtime';

export const popupRule = () => config().links?.popup ?? null;
export const specialLinks = () => config().links?.special ?? [];

/** True when `a` (a link on the canvas) opens the site's popup. */
export function opensPopup(a: Element | null): boolean {
  const rule = popupRule();
  if (!a || !rule) return false;
  try {
    return a.matches(rule.selector);
  } catch {
    return false;
  }
}

// what a badge must not cover (its size is the CSS's .ms-badge; .is-small fits in the gap between two lines)
export const CLICKABLE = 'a, button, input, select, textarea, summary, [role="button"], .ms-padlock, .ms-synced-pill';
const SIZE = 16;
const SMALL = 10;

/** The letters of the text in `root`, line by line: each line's box less the line spacing above and below. */
export function letters(root: Element): DOMRect[] {
  const out: DOMRect[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent?.trim() || !n.parentElement) continue;
    const size = parseFloat(getComputedStyle(n.parentElement).fontSize);
    range.selectNodeContents(n);
    for (const b of range.getClientRects()) {
      const pad = Math.max(0, (b.height - size) / 2);
      out.push(new DOMRect(b.left, b.top + pad, b.width, b.height - 2 * pad));
    }
  }
  return out;
}

/** How much of the box `x, y, w, h` the `boxes` cover (touching, or a pixel's rounding, is not covering). */
export function covered(x: number, y: number, w: number, h: number, boxes: DOMRect[]): number {
  return boxes.reduce((sum, t) => {
    const cw = Math.min(x + w, t.right) - Math.max(x, t.left);
    const ch = Math.min(y + h, t.bottom) - Math.max(y, t.top);
    return cw > 1 && ch > 1 ? sum + cw * ch : sum;
  }, 0);
}

/** Keeps a badge at the end of every popup link in `canvas`; call `update()` after the canvas changes. */
export class PopupBadges {
  private layer: HTMLElement;
  private frame = 0;

  constructor(
    private canvas: HTMLElement,
    private sheet: HTMLElement,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'ms-badges';
    this.layer.setAttribute('aria-hidden', 'true');
    sheet.append(this.layer);
    // the canvas moves without changing size when something above it does (the cover loads): watch the sheet too
    const ro = new ResizeObserver(() => this.update());
    ro.observe(canvas);
    ro.observe(sheet);
  }

  update(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    const rule = popupRule();
    this.layer.replaceChildren();
    if (!rule) return;
    let links: Element[];
    try {
      links = [...this.canvas.querySelectorAll(`a`)].filter((a) => a.matches(rule.selector));
    } catch {
      return;
    }
    const s = this.sheet.getBoundingClientRect();
    // a badge sits beside its link, never on a control: the first of these places that covers nothing clickable
    const taken = [...this.sheet.querySelectorAll(CLICKABLE)]
      .filter((e) => !this.layer.contains(e))
      // a link wrapped over two lines covers its two lines, not the box around both
      .flatMap((e) => [...e.getClientRects()])
      .filter((r) => r.width && r.height);
    const text = links.length ? letters(this.canvas) : [];
    const spot = ([x, y, n]: [number, number, number], boxes: DOMRect[]) => covered(x, y, n, n, boxes);
    for (const a of links) {
      const rects = [...a.getClientRects()].filter((r) => r.width && r.height);
      const r = rects[rects.length - 1];
      const first = rects[0];
      if (!r || !first) continue;
      const mid = (x: DOMRect) => x.top + x.height / 2 - SIZE / 2;
      const places: [number, number, number][] = [
        [r.right + 2, r.top - 6, SIZE],
        [r.right + 4, mid(r), SIZE],
        [first.left - SIZE - 4, mid(first), SIZE],
        [r.right - SIZE, r.top - SIZE - 4, SIZE],
        // a small one over the link's end, in the gap between its line and the one above (just touching both), where
        // text follows the link on its line
        [r.right - SMALL, r.top - SMALL + 0.5, SMALL],
        [first.left, first.top - SMALL + 0.5, SMALL],
      ];
      // clear of controls and of the text, else clear of controls and on the least text
      const clear = places.filter((p) => !spot(p, taken));
      const at = clear.find((p) => !spot(p, text)) ?? clear.sort((p, q) => spot(p, text) - spot(q, text))[0] ?? places[0]!;
      taken.push(new DOMRect(at[0], at[1], at[2], at[2]));
      const b = document.createElement('span');
      b.className = at[2] === SMALL ? 'ms-badge is-small' : 'ms-badge';
      b.innerHTML = ic('calendar', at[2] === SMALL ? 7 : 10);
      b.title = rule.note;
      b.style.left = `${at[0] - s.left}px`;
      b.style.top = `${at[1] - s.top}px`;
      this.layer.append(b);
    }
  }
}
