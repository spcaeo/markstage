// The Flow view's layout check in the browser (links.e2e.mjs runs it; so can a script against a real site): what the
// map draws now, read back from the page. Pass `flowCheck` to page.evaluate. Every box drawn at the size the layout
// meant and on the 8px grid, none closer than 8px to another, each column left-aligned; every word 12px or more on
// screen and shown in full (no "…", nothing cut); no line under a card; no control over a card; the 48px margin; no
// sideways scroll, of the page or of the map.
export function flowCheck() {
  const canvas = document.querySelector('.ms-fl-canvas');
  const world = document.querySelector('.ms-fl-world');
  if (!canvas || !world) return { pass: false, fail: ['no map on the page'] };
  const k = Number(world.dataset.k);
  const boxes = [...world.querySelectorAll('[data-x]')].map((e) => ({ e, x: +e.dataset.x, y: +e.dataset.y, w: +e.dataset.w, h: +e.dataset.h, col: e.dataset.col }));
  const fail = [];
  const name = (b) => b.e.querySelector('.ms-fl-code')?.textContent ?? b.e.className;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      if (Math.max(gx, gy) < 8) fail.push(`${name(a)} and ${name(b)} overlap or touch`);
    }
  for (const b of boxes) for (const v of ['x', 'y', 'w', 'h']) if (b[v] % 8) fail.push(`${name(b)}: ${v} ${b[v]} is not on the 8px grid`);
  for (const b of boxes) if (b.e.offsetWidth !== b.w || b.e.offsetHeight !== b.h) fail.push(`${name(b)}: drawn ${b.e.offsetWidth}×${b.e.offsetHeight}, meant ${b.w}×${b.h}`);
  const cols = new Map();
  for (const b of boxes) cols.set(b.col, [...(cols.get(b.col) ?? []), b.x]);
  for (const [c, xs] of cols) if (new Set(xs).size > 1) fail.push(`column ${c} is not left-aligned: ${[...new Set(xs)]}`);
  // every word: 12px or more on screen, never "…"
  let small = 0;
  let least = 99;
  for (const e of world.querySelectorAll('*')) {
    if (e.closest('[hidden]') || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const px = parseFloat(getComputedStyle(e).fontSize) * k;
    least = Math.min(least, px);
    if (px < 11.95) small++;
    if (/…/.test(e.textContent) || getComputedStyle(e).textOverflow === 'ellipsis') fail.push(`"…" in ${e.textContent.trim().slice(0, 40)}`);
  }
  if (small) fail.push(`${small} pieces of text under 12px on screen`);
  // nothing cut: every title, foot line, heading and note in full
  for (const e of world.querySelectorAll('.ms-fl-card__title, .ms-fl-card__foot, .ms-fl-goal__title, .ms-fl-fix__what, .ms-fl-colhead, .ms-fl-note'))
    if (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) fail.push(`cut short: ${e.textContent.trim().slice(0, 40)}`);
  // the lines of the map never under a card, their two ends aside
  const cards = boxes.filter((b) => !b.e.matches('.ms-fl-colhead'));
  let under = 0;
  for (const p of world.querySelectorAll('path.ms-fl-ln:not(.is-hover, .is-side, .is-deep)')) {
    const len = p.getTotalLength();
    for (let s = 4; s < len - 4; s += 4) {
      const q = p.getPointAtLength(s);
      if (cards.some((b) => q.x > b.x + 1 && q.x < b.x + b.w - 1 && q.y > b.y + 1 && q.y < b.y + b.h - 1)) {
        under++;
        break;
      }
    }
  }
  if (under) fail.push(`${under} lines pass under a card`);
  // no control over a card: the zoom, the trail, the bar under the map and the toolbar (the View popover open aside)
  const view = canvas.getBoundingClientRect();
  const seen = (b) => {
    const r = b.e.getBoundingClientRect();
    const x = { left: Math.max(r.left, view.left), top: Math.max(r.top, view.top), right: Math.min(r.right, view.right), bottom: Math.min(r.bottom, view.bottom) };
    return x.right > x.left && x.bottom > x.top ? x : null;
  };
  for (const ctl of document.querySelectorAll('.ms-fl-zoom, .ms-fl-trail:not([hidden]), .ms-fl-foot, .ms-fl-groups, .ms-fl-bar')) {
    const c = ctl.getBoundingClientRect();
    for (const b of boxes) {
      const x = seen(b);
      if (x && c.left < x.right - 1 && c.right > x.left + 1 && c.top < x.bottom - 1 && c.bottom > x.top + 1) fail.push(`${ctl.className} covers ${name(b)}`);
    }
  }
  const r = world.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  const margin = Math.round(Math.min(r.left - c.left + canvas.scrollLeft, r.top - c.top + canvas.scrollTop));
  if (margin < 47) fail.push(`margin ${margin}px, under 48px`);
  const sideways = { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, map: canvas.scrollWidth - canvas.clientWidth };
  if (sideways.page > 0) fail.push(`the page scrolls sideways by ${sideways.page}px`);
  if (sideways.map > 1) fail.push(`the map scrolls sideways by ${sideways.map}px (${canvas.clientWidth}px wide at ${Math.round(k * 100)}%)`);
  return { pass: !fail.length, zoom: Math.round(k * 100), boxes: boxes.length, leastText: Math.round(least * 10) / 10, margin, fail };
}

/** The weakest contrast of the Flow view's words against what is behind them (WCAG 2), and which words. */
export function flowContrast() {
  // rgb(…) in 0 to 255, or color(srgb …) in 0 to 1 (what color-mix() computes to)
  const rgb = (c) => {
    const v = (c.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    return c.startsWith('color(srgb') ? v.map((x, i) => (i < 3 ? x * 255 : x)) : v;
  };
  const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bg = (n) => {
    for (let e = n; e; e = e.parentElement) {
      const c = rgb(getComputedStyle(e).backgroundColor);
      if (c.length && (c[3] === undefined || c[3] > 0.5)) return c;
    }
    return [255, 255, 255];
  };
  let low = 21;
  let what = '';
  const words = '.ms-fl-card__title span, .ms-fl-card__count, .ms-fl-card__group, .ms-fl-code, .ms-fl-age, .ms-fl-tos, .ms-fl-colhead, .ms-fl-note, .ms-fl-goal__label, .ms-fl-goal__title, .ms-fl-goal__n, .ms-fl-fix__what, .ms-fl-trail__here, .ms-fl-key > span, .ms-fl-how, .ms-fl-side__title, .ms-fl-side__place';
  for (const n of document.querySelectorAll(words)) {
    if (n.closest('.is-dim, [hidden]')) continue;
    const ratio = ((a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))(lum(rgb(getComputedStyle(n).color)), lum(bg(n)));
    if (ratio < low) (low = ratio), (what = `${n.className}: ${n.textContent.trim().slice(0, 40)}`);
  }
  return { low, what };
}
