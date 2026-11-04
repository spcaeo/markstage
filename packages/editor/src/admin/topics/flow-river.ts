// Where everything on the Flow view goes (flow.ts), with no page drawing in it, so the unit tests read it as it is.
// Every box is placed in world units on an 8px grid, every card CARD.w × CARD.h.
//   The river: the service page as the goal bar on top, the main page under it, then the group leads in rows of
//   `perRow` (the first row forks off the main page; the rows below are fed by a channel down the left), each open
//   group's articles stacked under its lead, indented. Each line's width says how many links it carries.
//   The step round one page: the pages linking to it on the left ("Comes from"), the page in the middle with its
//   "To fix" box and the pages linking both ways under it, the pages it links to on the right ("Goes to"); one
//   bundled trunk in, one out.
// checkLayout is the layout check the tests run (no two boxes closer than 8px, all on the grid, each column
// left-aligned, no line under a card); fitZoom how far the view zooms to fit.

export interface Colour {
  light: string;
  dark: string;
}

export interface RiverGroup {
  key: string;
  name: string;
  letter: string;
  colour: Colour;
  /** its lead page's ref, if it has one shown */
  lead: string | null;
  /** its articles shown, in order */
  members: string[];
}

export type BoxKind = 'goal' | 'card' | 'head' | 'fix' | 'note';

export interface Box {
  /** the page's ref; `none:<group>` for a group with no lead page, `none:main` for no main page, else what it is */
  id: string;
  kind: BoxKind;
  /** the page on it (null: a heading, the To fix box, a note, a placeholder) */
  ref: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** the column it lines up in (every box of one column has the same x) */
  col: string;
  /** its group's key (null: the main and service pages, headings) */
  group: string | null;
  /** a lead whose group is folded */
  folded?: boolean;
  /** what a heading or note says (from, to, both, page; none-in, none-out) */
  say?: string;
}

export interface Line {
  id: string;
  from: string;
  to: string;
  /** the SVG path, its corners rounded */
  d: string;
  /** its corners, for the checks */
  pts: [number, number][];
  /** its group's colour (null: grey) */
  colour: Colour | null;
  width: number;
  /** a link the topic expects that is not there yet: a thin dotted line */
  none: boolean;
}

export interface Layout {
  boxes: Box[];
  lines: Line[];
  w: number;
  h: number;
}

export const CARD = { w: 240, h: 120 };
export const GOAL = { w: 560, h: 48 };
/** an article's indent under its lead, the gap between cards, between levels, round the map */
export const INDENT = 24;
export const GAP = 16;
export const LEVEL = 64;
export const MARGIN = 48;
/** the gaps between the step's columns (the trunk runs down the middle): the widest that fits, else the least */
export const STEP_GAPS = [96, 80, 64, 48];
/** a heading's height, the To fix box's head and each of its rows */
export const HEAD_H = 24;
export const FIX_HEAD = 48;
export const FIX_ROW = 72;
const NOTE_H = 48;
const RADIUS = 8;
/** zoom: never below ZOOM_MIN (a card's smallest words, 13px, are 12px on screen), a small map up to ZOOM_FIT_MAX */
export const ZOOM_MIN = 0.93;
export const ZOOM_FIT_MAX = 1.25;
export const ZOOM_MAX = 1.5;

/** A line's width for the number of links it carries: one more than the links, at most 8. */
export const widthOf = (n: number) => Math.min(8, n + 1);
const snap = (v: number) => Math.round(v / 8) * 8;

/** A path through these corners, each corner rounded (at most `r`, at most half of either side). */
export function rounded(pts: [number, number][], r = RADIUS): string {
  const p = pts.filter((q, i) => !i || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  if (p.length < 2) return '';
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
    const len1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const len2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const k = Math.min(r, len1 / 2, len2 / 2);
    const s = [b[0] - ((b[0] - a[0]) / len1) * k, b[1] - ((b[1] - a[1]) / len1) * k];
    const e = [b[0] + ((c[0] - b[0]) / len2) * k, b[1] + ((c[1] - b[1]) / len2) * k];
    d += `L${s[0]} ${s[1]}Q${b[0]} ${b[1]} ${e[0]} ${e[1]}`;
  }
  const z = p[p.length - 1];
  return `${d}L${z[0]} ${z[1]}`;
}

const line = (id: string, from: string, to: string, pts: [number, number][], colour: Colour | null, n: number | null): Line => ({
  id,
  from,
  to,
  d: rounded(pts),
  pts,
  colour,
  width: n ? widthOf(n) : 1,
  none: n === 0,
});

/** How many groups go in a row on a canvas this wide (at the least zoom, with the margins and the left channel). */
export function perRow(canvasW: number): number {
  return Math.max(1, Math.floor((canvasW / ZOOM_MIN - 2 * MARGIN - INDENT + GAP) / (INDENT + CARD.w + GAP)));
}

export interface RiverIn {
  groups: RiverGroup[];
  /** the main page's and the service page's refs (null: the topic has none) */
  main: string | null;
  service: string | null;
  mainColour: Colour;
  /** the links from one page to another */
  count: (from: string, to: string) => number;
  /** the groups shown open (the rest folded: their lead only) */
  open: Set<string>;
  perRow: number;
}

/** The river: goal bar, main page, group leads in rows, each open group's articles stacked under its lead. */
export function riverLayout(o: RiverIn): Layout {
  const boxes: Box[] = [];
  const lines: Line[] = [];
  const branch = INDENT + CARD.w;
  const rows: RiverGroup[][] = [];
  for (let i = 0; i < o.groups.length; i += Math.max(1, o.perRow)) rows.push(o.groups.slice(i, i + Math.max(1, o.perRow)));
  // rows below the first are fed by a channel down the left: room for it
  const ox = rows.length > 1 ? INDENT : 0;
  const rowW = (r: RiverGroup[]) => r.length * branch + (r.length - 1) * GAP;
  const contentW = Math.max(o.service ? GOAL.w : 0, CARD.w, ...rows.map(rowW));
  const cx = ox + snap(contentW / 2);
  const main = o.main ?? 'none:main';
  let top = 0;
  if (o.service) {
    boxes.push({ id: o.service, kind: 'goal', ref: o.service, x: cx - GOAL.w / 2, y: 0, ...GOAL, col: 'S', group: null });
    top = GOAL.h + MARGIN;
  }
  boxes.push({ id: main, kind: 'card', ref: o.main, x: cx - CARD.w / 2, y: top, ...CARD, col: 'M', group: null });
  if (o.service) lines.push(line(`${main}>${o.service}`, main, o.service, [[cx, top], [cx, GOAL.h]], o.mainColour, o.main ? o.count(o.main, o.service) : 0));
  const mainBottom = top + CARD.h;
  const fork = mainBottom + 24;
  let y = mainBottom + LEVEL;
  let bottom = mainBottom;
  rows.forEach((row, ri) => {
    const x0 = ox + snap((contentW - rowW(row)) / 2);
    const bus = y - 24;
    let tallest = CARD.h;
    row.forEach((g, i) => {
      const bx = x0 + i * (branch + GAP);
      const lx = bx + CARD.w / 2;
      const lead = g.lead ?? `none:${g.key}`;
      const folded = !o.open.has(g.key);
      const n = g.lead && o.main ? o.count(o.main, g.lead) : 0;
      const pts: [number, number][] = ri === 0 ? [[cx, mainBottom], [cx, fork], [lx, fork], [lx, y]] : [[cx, mainBottom], [cx, fork], [0, fork], [0, bus], [lx, bus], [lx, y]];
      lines.push(line(`${main}>${lead}`, main, lead, pts, g.colour, n));
      boxes.push({ id: lead, kind: 'card', ref: g.lead, x: bx, y, ...CARD, col: `b:${g.key}`, group: g.key, folded });
      if (folded) return;
      const tx = bx + 12;
      g.members.forEach((r, j) => {
        const ay = y + CARD.h + GAP + j * (CARD.h + GAP);
        boxes.push({ id: r, kind: 'card', ref: r, x: bx + INDENT, y: ay, ...CARD, col: `a:${g.key}`, group: g.key });
        lines.push(line(`${lead}>${r}`, lead, r, [[tx, y + CARD.h], [tx, ay + CARD.h / 2], [bx + INDENT, ay + CARD.h / 2]], g.colour, g.lead ? o.count(g.lead, r) : 0));
        tallest = Math.max(tallest, ay + CARD.h - y);
      });
    });
    bottom = y + tallest;
    y = bottom + LEVEL + 24;
  });
  return { boxes, lines, w: ox + contentW, h: bottom };
}

/** The widest gap between the step's columns that lets it fit a canvas this wide at the least zoom. */
export function stepGap(canvasW: number): number {
  return STEP_GAPS.find((g) => (3 * CARD.w + 2 * g) * ZOOM_MIN + 2 * MARGIN <= canvasW) ?? STEP_GAPS[STEP_GAPS.length - 1];
}

export interface StepIn {
  focus: string;
  /** the gap between the columns (stepGap) */
  gap: number;
  /** the pages that link to it only, that it links to only, and both ways, each in code order */
  from: string[];
  to: string[];
  both: string[];
  /** its missing links (the To fix box's rows) */
  fixes: number;
}

/** The step round one page: Comes from | the page, To fix, Both ways | Goes to. */
export function stepLayout(o: StepIn): Layout {
  const boxes: Box[] = [];
  const lines: Line[] = [];
  const X = { from: 0, mid: CARD.w + o.gap, to: 2 * (CARD.w + o.gap) };
  const top = HEAD_H + GAP;
  const head = (id: string, x: number, y: number, say: string) => boxes.push({ id: `head:${id}`, kind: 'head', ref: null, x, y, w: CARD.w, h: HEAD_H, col: id === 'both' ? 'mid' : id, group: null, say });
  head('from', X.from, 0, 'from');
  head('mid', X.mid, 0, 'page');
  head('to', X.to, 0, 'to');
  boxes.push({ id: o.focus, kind: 'card', ref: o.focus, x: X.mid, y: top, ...CARD, col: 'mid', group: null });
  const midY = top + CARD.h / 2;
  const trunkIn = CARD.w + o.gap / 2;
  const trunkOut = X.mid + CARD.w + o.gap / 2;
  const side = (refs: string[], x: number, col: 'from' | 'to') => {
    if (!refs.length) boxes.push({ id: `note:${col}`, kind: 'note', ref: null, x, y: top, w: CARD.w, h: NOTE_H, col, group: null, say: col === 'from' ? 'none-in' : 'none-out' });
    refs.forEach((r, i) => {
      const y = top + i * (CARD.h + GAP);
      const yy = y + CARD.h / 2;
      boxes.push({ id: r, kind: 'card', ref: r, x, y, ...CARD, col, group: null });
      if (col === 'from') lines.push(line(`${r}>${o.focus}`, r, o.focus, [[CARD.w, yy], [trunkIn, yy], [trunkIn, midY], [X.mid, midY]], null, null));
      else lines.push(line(`${o.focus}>${r}`, o.focus, r, [[X.mid + CARD.w, midY], [trunkOut, midY], [trunkOut, yy], [X.to, yy]], null, null));
    });
  };
  side(o.from, X.from, 'from');
  side(o.to, X.to, 'to');
  let y = top + CARD.h + GAP;
  if (o.fixes) {
    const h = FIX_HEAD + o.fixes * FIX_ROW;
    boxes.push({ id: 'fix', kind: 'fix', ref: null, x: X.mid, y, w: CARD.w, h, col: 'mid', group: null });
    y += h + 32;
  }
  if (o.both.length) {
    head('both', X.mid, y, 'both');
    o.both.forEach((r, i) => boxes.push({ id: r, kind: 'card', ref: r, x: X.mid, y: y + HEAD_H + GAP + i * (CARD.h + GAP), ...CARD, col: 'mid', group: null }));
  }
  const h = Math.max(...boxes.map((b) => b.y + b.h));
  return { boxes, lines, w: X.to + CARD.w, h };
}

/** A thin curve from one card to another (a page's links on hover, side links, deep links): edge to edge. */
export function crossLine(a: Box, b: Box): string {
  const ac = [a.x + a.w / 2, a.y + a.h / 2];
  const bc = [b.x + b.w / 2, b.y + b.h / 2];
  const dx = bc[0] - ac[0];
  const dy = bc[1] - ac[1];
  // across when the cards sit side by side, else up or down
  if (Math.abs(dx) > Math.abs(dy) * 1.5 || Math.abs(dy) < CARD.h) {
    const s = Math.sign(dx) || 1;
    const x1 = s > 0 ? a.x + a.w : a.x;
    const x2 = s > 0 ? b.x : b.x + b.w;
    const c = Math.max(32, Math.abs(x2 - x1) / 2);
    return `M${x1} ${ac[1]}C${x1 + s * c} ${ac[1]} ${x2 - s * c} ${bc[1]} ${x2} ${bc[1]}`;
  }
  const s = Math.sign(dy);
  const y1 = s > 0 ? a.y + a.h : a.y;
  const y2 = s > 0 ? b.y : b.y + b.h;
  const c = Math.max(32, Math.abs(y2 - y1) / 2);
  return `M${ac[0]} ${y1}C${ac[0]} ${y1 + s * c} ${bc[0]} ${y2 - s * c} ${bc[0]} ${y2}`;
}

/**
 * The zoom that fits the map: the width filled, a small map up to ZOOM_FIT_MAX, a tall one no more than 100% (it
 * scrolls down; the step always), never under ZOOM_MIN.
 */
export function fitZoom(canvas: { w: number; h: number }, world: { w: number; h: number }, tall = false): number {
  const across = (canvas.w - 2 * MARGIN) / Math.max(1, world.w);
  const down = tall ? 1 : (canvas.h - 2 * MARGIN) / Math.max(1, world.h);
  return Math.max(ZOOM_MIN, Math.min(ZOOM_FIT_MAX, across, Math.max(down, Math.min(1, across))));
}

/** The layout check: what breaks the rules, in words (empty: none). */
export function checkLayout(l: Layout): string[] {
  const fail: string[] = [];
  const b = l.boxes;
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++) {
      const [p, q] = [b[i], b[j]];
      const gx = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w));
      const gy = Math.max(q.y - (p.y + p.h), p.y - (q.y + q.h));
      if (Math.max(gx, gy) < 8) fail.push(`${p.id} and ${q.id} overlap or are closer than 8px`);
    }
  for (const x of b) for (const k of ['x', 'y', 'w', 'h'] as const) if (x[k] % 8) fail.push(`${x.id}: ${k} ${x[k]} is not on the 8px grid`);
  const cols = new Map<string, Set<number>>();
  for (const x of b) cols.set(x.col, (cols.get(x.col) ?? new Set()).add(x.x));
  for (const [c, xs] of cols) if (xs.size > 1) fail.push(`column ${c} is not left-aligned: ${[...xs].join(', ')}`);
  // lines never under a card, their two ends aside: walked every 4px along their corners
  const cards = b.filter((x) => x.kind !== 'head');
  for (const ln of l.lines) {
    let under: Box | undefined;
    for (let i = 1; i < ln.pts.length && !under; i++) {
      const [a, z] = [ln.pts[i - 1], ln.pts[i]];
      const len = Math.hypot(z[0] - a[0], z[1] - a[1]);
      for (let s = 0; s <= len && !under; s += 4) {
        const [px, py] = [a[0] + ((z[0] - a[0]) * s) / (len || 1), a[1] + ((z[1] - a[1]) * s) / (len || 1)];
        under = cards.find((c) => px > c.x + 1 && px < c.x + c.w - 1 && py > c.y + 1 && py < c.y + c.h - 1);
      }
    }
    if (under) fail.push(`line ${ln.id} runs under ${under.id}`);
  }
  if (l.w <= 0 || l.h <= 0) fail.push('the map has no size');
  return fail;
}
