// Small drawings of page sections (72x48, the block menu's style) for the outline and the section picker. A section
// kind is matched by the words in its name (hero, cards, faq, ...), so any site's kinds get a fitting picture; a
// site can give its own through its editor pack (`sections`, see pagePictures).
import { PREVIEW_COLORS, svgBar, svgPreview } from '../builtins';

const A = PREVIEW_COLORS.accent;
const T = PREVIEW_COLORS.tint;
const G = PREVIEW_COLORS.grey;
const box = (x: number, y: number, w: number, h: number, fill = T, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const ring = (x: number, y: number, w: number, h: number, rx = 2) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="#fff" stroke="${G}"/>`;
const dot = (cx: number, cy: number, r = 3, fill = T) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

const DRAW: [RegExp, string][] = [
  [/hero|banner|intro/, svgBar(8, 10, 30, A, 4) + svgBar(8, 18, 26) + svgBar(8, 23, 22) + box(8, 31, 16, 6, A, 3) + box(44, 9, 20, 30)],
  [/logo|client|partner|badge/, [10, 26, 42, 58].map((x) => box(x - 6, 20, 12, 8, T, 2)).join('') + svgBar(22, 10, 28)],
  [/testimonial|quote|review/, `<text x="8" y="22" font-size="16" fill="${A}" font-family="Georgia,serif">“</text>` + svgBar(20, 13, 42) + svgBar(20, 19, 38) + svgBar(20, 25, 30) + dot(24, 37) + svgBar(30, 36, 18)],
  [/faq|question|accordion/, [10, 21, 32].map((y) => ring(8, y, 56, 8) + svgBar(12, y + 3, 30) + svgBar(57, y + 3, 4, A)).join('')],
  [/process|step|timeline/, [12, 30, 48].map((x, i) => dot(x + 6, 18, 5, i === 0 ? A : T) + svgBar(x, 29, 12)).join('') + svgBar(23, 17, 7, G, 1) + svgBar(41, 17, 7, G, 1)],
  [/cta|call|action|signup/, box(6, 12, 60, 24, T, 4) + svgBar(14, 19, 28, A, 4) + svgBar(14, 27, 20) + box(48, 20, 12, 7, A, 3)],
  [/contact|form/, svgBar(8, 9, 24, A, 4) + ring(8, 16, 26, 7) + ring(38, 16, 26, 7) + ring(8, 26, 56, 10) + box(8, 39, 14, 5, A, 2)],
  [/table|migration|compare|pricing/, [12, 20, 28, 36].map((y, i) => svgBar(8, y, 18, i ? G : A) + svgBar(30, y, 16, i ? G : A) + box(52, y - 1, 10, 5, i ? T : A)).join('')],
  [/source|reference|footnote|citation/, [10, 18, 26, 34].map((y, i) => `<text x="8" y="${y + 4}" font-size="6" fill="${A}" font-family="sans-serif">${i + 1}</text>` + svgBar(15, y, 44 - i * 5)).join('')],
  [/credential|certif|award/, [8, 30, 52].map((x) => box(x, 10, 14, 18, T, 2) + dot(x + 7, 17, 3.5, A) + svgBar(x, 31, 14)).join('')],
  [/use.?case|card|feature|grid|service/, [6, 28, 50].map((x) => ring(x, 10, 18, 28) + box(x + 3, 13, 12, 7) + svgBar(x + 3, 24, 11) + svgBar(x + 3, 29, 8)).join('')],
  [/list|post|archive|child|page/, [9, 19, 29].map((y) => box(8, y, 12, 8) + svgBar(24, y + 1, 30) + svgBar(24, y + 5, 20)).join('')],
  [/html|code|embed|raw/, `<text x="18" y="30" font-size="13" fill="${A}" font-family="monospace">&lt;/&gt;</text>`],
  [/prose|text|content|article|about|legal/, svgBar(8, 10, 34, A, 4) + [17, 22, 27, 32, 37].map((y, i) => svgBar(8, y, i === 4 ? 30 : 56)).join('')],
];

const GENERIC = svgBar(8, 12, 30, A, 4) + svgBar(8, 21, 56) + svgBar(8, 27, 50) + svgBar(8, 33, 40);

let custom: Record<string, string> = {};

/** A site's own drawings by section kind (inner SVG for the 72x48 frame), e.g. from its editor pack. */
export function pagePictures(pictures: Record<string, string>): void {
  custom = { ...pictures };
}

/** The drawing for a section kind. */
export function sectionPicture(kind: string): string {
  if (custom[kind]) return svgPreview(custom[kind]);
  const name = kind.toLowerCase();
  return svgPreview(DRAW.find(([re]) => re.test(name))?.[1] ?? GENERIC);
}
