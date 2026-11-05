// The page's colours on the canvas (docs/CANVAS-FIDELITY.md "Colours: the page as readers see it"). The canvas shows
// the page as a reader whose system is in the editor's colour scheme sees it, never the editor's own colours:
//   - the site's dark scheme (config `themes.dark`) is turned on only when the page turns dark by itself for such a
//     reader (`followsScheme`): a site whose dark colours nothing on the page turns on stays light in a dark editor,
//     as it is for its readers;
//   - what the page leaves to the browser stays the browser's, as on the page: the text colour (CanvasText), the
//     colour scheme of its controls (light, or the page's `<meta name=color-scheme>`), and the window's background
//     (the page's `<html>` background, else its `<body>`'s, else Canvas), never the editor's dark ones;
//   - a code block takes the colours the site's highlighter gives the page's own code blocks (an inline style: Astro's
//     Shiki, `pre.astro-code`): the canvas's code is the editor's, without them, so its text would take the page's
//     text colour on the site's code background (light text on a light box in a dark page).

/** The page turns dark by itself for a reader whose system is dark: its CSS or its scripts read the system's scheme. */
export function followsScheme(sheets: string[], scripts: string[]): boolean {
  const reads = /prefers-color-scheme\s*:\s*dark/i;
  return sheets.some((s) => reads.test(s)) || scripts.some((s) => /prefers-color-scheme/i.test(s));
}

/** A `<meta name=color-scheme>` content the canvas can use as a `color-scheme` value, or null. */
export function metaScheme(content: string | null | undefined): string | null {
  const v = (content ?? '').trim().toLowerCase();
  return /^(normal|(only\s+)?(light|dark)(\s+(light|dark))?(\s+only)?)$/.test(v) ? v : null;
}

/** The site's dark scheme on the stand-in for <html>: a class, or an attribute. */
export function hasScheme(el: Element, t: { attr: string; value: string }): boolean {
  return t.attr === 'class' ? el.classList.contains(t.value) : el.getAttribute(t.attr) === t.value;
}
export function setScheme(el: Element, t: { attr: string; value: string }, on: boolean): void {
  if (t.attr === 'class') el.classList.toggle(t.value, on);
  else if (on) el.setAttribute(t.attr, t.value);
  else el.removeAttribute(t.attr);
}

/** The colours a code block of the page has inline (its highlighter's), as declarations safe to apply: only `color`
 *  and `background-color`, read back through the CSSOM (nothing of the attribute's text is copied as text). */
export function codeColours(style: string | null): [string, string][] {
  if (!style) return [];
  const s = document.createElement('i').style;
  s.cssText = style;
  const out: [string, string][] = [];
  for (const name of ['color', 'background-color']) {
    const v = s.getPropertyValue(name);
    if (v && !/url\(|var\(|expression/i.test(v)) out.push([name, v]);
  }
  return out;
}

const CLEAR = /^(transparent|rgba\(0, 0, 0, 0\))$/;

/** The window's background, as the browser paints it for the page: <html>'s, else <body>'s, else Canvas. */
export function windowBackground(root: HTMLElement, body: HTMLElement): string {
  const own = getComputedStyle(root).backgroundColor;
  if (!CLEAR.test(own)) return own;
  const b = getComputedStyle(body).backgroundColor;
  if (!CLEAR.test(b)) return b;
  const probe = root.appendChild(document.createElement('i'));
  probe.style.cssText = 'position:absolute;width:0;height:0;background:Canvas';
  const c = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return c;
}
