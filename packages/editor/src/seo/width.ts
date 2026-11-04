// How wide Google draws a search title and description, in pixels: it cuts by width, not by characters ("WWW" is
// wider than "iii"). Desktop results set the title in Arial 20 px and cut it near 600 px; the description in Arial
// 14 px, near 920 px over its two lines.

export const TITLE_PX = 600;
export const DESCRIPTION_PX = 920;

let ctx: CanvasRenderingContext2D | null = null;

/** The width of `text` in `font` (a CSS font), in CSS pixels. */
export function textWidth(text: string, font: string): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 9;
  ctx.font = font;
  return Math.round(ctx.measureText(text).width);
}

export const titleWidth = (t: string) => textWidth(t, '20px Arial, Helvetica, sans-serif');
export const descriptionWidth = (t: string) => textWidth(t, '14px Arial, Helvetica, sans-serif');

/** `text` cut where Google cuts it (with …), as a result shows it. */
export function cutTo(text: string, px: number, width: (s: string) => number): string {
  if (width(text) <= px) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (width(`${text.slice(0, mid)} …`) <= px) lo = mid;
    else hi = mid - 1;
  }
  const head = text.slice(0, lo);
  // at a word's end, as Google does
  const space = head.lastIndexOf(' ');
  return `${(space > lo * 0.6 ? head.slice(0, space) : head).trimEnd()} …`;
}
