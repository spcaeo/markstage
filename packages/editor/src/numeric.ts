// Which table columns hold numbers (owner, 2026-10-28: numbers are right-aligned with tabular figures, text stays
// left). Pure, so it is tested on its own; num-columns.ts applies it to every table the editor draws.
const UNIT = String.raw`(?:%|[KMGT]i?B|[kMGT]?B|bytes?|ms|px|x|×)`;
const TIME = String.raw`(?:ms|s|sec|min|m|h|hrs?|d|days?)`;
// digits grouped by commas or thin spaces, never plain spaces (a phone number is not a quantity)
const NUMBER = String.raw`[-+−]?[$€£¥]?\d[\d,\u202f\u00a0]*(?:\.\d+)?`;
// one number with an optional unit, a fraction ("3 / 12", "3 of 12"), or a duration in parts ("2 min 30 s")
const NUMERIC = new RegExp(
  String.raw`^(?:${NUMBER} ?(?:${UNIT}|${TIME})?(?: ?(?:/|of) ?${NUMBER} ?(?:${UNIT}|${TIME})?)?|(?:${NUMBER} ?${TIME} ?){2,})$`,
  'i',
);
// what an empty numeric cell shows
const BLANK = /^(?:|—|–|-|n\/a)$/i;

/** True when `text` reads as a number (with its unit). */
export function isNumeric(text: string): boolean {
  const t = text.replace(/[ \t\r\n]+/g, ' ').trim();
  return /\d/.test(t) && NUMERIC.test(t);
}

/** Which columns of a table hold only numbers (at least one, the rest blank). */
export function numericColumns(rows: string[][]): Set<number> {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const out = new Set<number>();
  for (let c = 0; c < width; c++) {
    const cells = rows.map((r) => (r[c] ?? '').trim()).filter((t) => !BLANK.test(t));
    if (cells.length && cells.every(isNumeric)) out.add(c);
  }
  return out;
}
