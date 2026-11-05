// The canvas's contrast guard (docs/CANVAS-FIDELITY.md "The guard"): every run of text on the canvas, and in the
// article around it (the title, the head, what follows), must be readable against what is really behind it, in the
// editor's light and dark themes alike: a WCAG contrast of at least 4.5:1. Nothing light on light, nothing dark on
// dark.
//
// The background is the first one that is not transparent, walking up from the text through the page shell to the
// editor around it; one partly transparent is laid over what is under it, as the browser paints it. The text's own
// colour likewise. canvas-fidelity.mjs runs it with every comparison; `contrastIn` works on any Playwright page.

/** WCAG 2 relative luminance of an [r, g, b] (0–255). */
export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two opaque colours, rounded to two decimals. */
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** `top` (with alpha) laid over the opaque `under`. */
export function over([r, g, b, a = 1], [r2, g2, b2]) {
  return [r * a + r2 * (1 - a), g * a + g2 * (1 - a), b * a + b2 * (1 - a)];
}

/** What a run of text is, by the nearest of these around it (in this order); none of them: a paragraph's (`p`). */
export const TEXT_KINDS = [
  ['link', 'a'],
  ['code', 'pre, code'],
  ['table', 'th, td'],
  ['quote', 'blockquote'],
  ['list', 'li'],
  ['heading', 'h1, h2, h3, h4, h5, h6'],
  ['caption', 'figcaption'],
];

/**
 * Every shown run of text in `textSel` (the canvas's text: paragraphs, headings, lists, quotations, code, tables,
 * links), and in the article around it: the title (its h1), the head above the text (byline, date) and what follows
 * it (`after`): [{kind, text, ratio, fg, bg}]. Run in the browser (Playwright's evaluate).
 */
export async function contrastIn(page, { textSel = '.ms-canvas > .ProseMirror' } = {}) {
  return page.evaluate(
    ([textSel, kinds]) => {
      const parse = (c) => {
        const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(c);
        return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
      };
      const over = ([r, g, b, a = 1], [r2, g2, b2]) => [r * a + r2 * (1 - a), g * a + g2 * (1 - a), b * a + b2 * (1 - a)];
      const lum = ([r, g, b]) => {
        const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      };
      // what is behind the element: its own background and its ancestors', top first, laid over each other down to
      // the first opaque one (the window: white when there is none)
      const behind = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && c[3] > 0) {
            layers.push(c);
            if (c[3] >= 1) break;
          }
        }
        let bg = [255, 255, 255];
        for (const c of layers.reverse()) bg = over(c, bg);
        return bg;
      };
      const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
      const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(', ')})`;
      const out = [];
      const check = (kind, el) => {
        if (!ownText(el) || !shown(el)) return;
        const fg = parse(getComputedStyle(el).color);
        if (!fg) return;
        const bg = behind(el);
        const f = over(fg, bg);
        out.push({ kind, text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40), ratio: ratio(f, bg), fg: rgb(f), bg: rgb(bg) });
      };
      const text = document.querySelector(textSel);
      if (!text) return out;
      const kindIn = (el) => kinds.find(([, sel]) => el.closest(sel) && text.contains(el.closest(sel)))?.[0] ?? 'p';
      for (const el of text.querySelectorAll('*')) check(kindIn(el), el);
      // the article around the text: the title, the head above the text, what follows it
      const article = text.closest('article') ?? text.parentElement;
      for (const el of article.querySelectorAll('*')) {
        if (text.contains(el) || el.contains(text)) continue;
        const kind = el.closest('h1') ? 'title' : text.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING ? 'head' : 'after';
        check(kind, el);
      }
      return out;
    },
    [textSel, TEXT_KINDS],
  );
}

/** The failures (each run under `min`, 4.5 by default) and the lowest ratio per kind, for the report. */
export function judge(found, min = 4.5) {
  const worst = {};
  const failures = [];
  for (const r of found) {
    if (!(r.kind in worst) || r.ratio < worst[r.kind]) worst[r.kind] = r.ratio;
    if (r.ratio < min) failures.push(`contrast ${r.kind}: ${r.ratio}:1, ${r.fg} on ${r.bg} ("${r.text}")`);
  }
  return { worst, failures, count: found.length };
}
