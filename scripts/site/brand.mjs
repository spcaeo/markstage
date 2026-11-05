// The Markstage brand in one place: the palette, the mark, the wordmark and the tagline. Used by the site's pages
// (layout.mjs), the share images (render-social.mjs) and the brand files (render-brand.mjs: assets/brand/,
// site/icon.svg, the favicons).
//
// The mark is the slash command: a "/" and a text caret on a rounded tile, the way every block starts when a writer
// types "/". On light backgrounds the tile is ink with a lime slash and caret; on dark ones it turns lime with ink
// marks, so it never sits dark on dark. The caret blinks on the site only, and only where the visitor allows motion
// (styles.css, prefers-reduced-motion); every file and image here is still. The wordmark is "markstage" in lowercase
// Bricolage Grotesque ExtraBold and the tagline Figtree SemiBold, kept as outlines (brand-type.mjs).
import { TAGLINE_TYPE, WORDMARK } from './brand-type.mjs';

export { TAGLINE_TYPE, WORDMARK };

/** The words of the tagline that TAGLINE_TYPE draws (config.mjs TAGLINE says the same; brand.test.mjs checks). */
export const TAGLINE_WORDS = 'Type it. Ship it.';

/**
 * "Bold and fresh": volt lime on ink, a soft green-grey for surfaces, pink as the second accent. site/styles.css holds
 * the same values as CSS tokens; brand.test.mjs checks that they match and that every text pair passes WCAG AA
 * (4.5:1), and the mark 3:1 against the page, in both themes.
 */
export const LIME = '#cdf75a';
export const INK = '#0e1a0b';
export const PINK = '#ffb4e4';
export const PALETTE = {
  light: { page: '#ffffff', soft: '#f2f6e6', ink: INK, muted: '#4c5446', tile: INK, glyph: LIME },
  dark: { page: INK, soft: '#1c2a18', ink: '#f4f8ea', muted: '#b7c2ab', tile: LIME, glyph: INK },
};

/**
 * The mark on a 32 x 32 grid. The slash leans at about 65 degrees, the angle of a typed "/"; the caret is as tall as
 * the slash's straight part and as thick as its stroke, so the two weigh the same. Together they sit on the tile's
 * optical centre (the round caps reach a little further than the caret's square ends, so the pair sits a little left of
 * the arithmetic centre). The gap at the top, between the slash's end and the caret, is wide enough to stay open at
 * 16 pixels.
 */
const MARK = {
  tile: { rx: 9 },
  slash: 'M8.6 23.75 15.9 8.25',
  slashWidth: 4.2,
  caret: { x: 21, y: 8, width: 4, height: 16, rx: 1.4 },
};

/**
 * The small mark for 16 and 32 pixels (favicons): on a 16 x 16 grid, with the caret on whole pixels and the slash
 * two pixels thick, so it stays crisp in a browser tab.
 */
const SMALL = {
  tile: { rx: 4 },
  slash: 'M4.2 12 7.9 4',
  slashWidth: 2.1,
  caret: { x: 10, y: 4, width: 2, height: 8, rx: 0.6 },
};

/** The mark's shapes. `colors` null: classes for the site's CSS tokens (styles.css `.logo`). */
export function markShapes(colors = null, { small = false } = {}) {
  const m = small ? SMALL : MARK;
  const size = small ? 16 : 32;
  const paint = (cls, attr, value) => (colors ? `${attr}="${value}"` : `class="${cls}"`);
  const c = m.caret;
  return [
    `<rect ${paint('lt', 'fill', colors?.tile)} width="${size}" height="${size}" rx="${m.tile.rx}"/>`,
    `<path ${paint('ls', 'stroke', colors?.glyph)} fill="none" stroke-width="${m.slashWidth}" stroke-linecap="round" d="${m.slash}"/>`,
    `<rect ${paint('lc', 'fill', colors?.glyph)} x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="${c.rx}"/>`,
  ].join('');
}

/** The mark as an inline SVG for a page, painted by the site's CSS tokens so it follows the theme. */
export const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="40" height="40" aria-hidden="true" focusable="false">${markShapes()}</svg>`;

/** A standalone mark file in one theme's colours (`small`: the 16-grid favicon drawing). */
export function markFile(theme, { size = 32, small = false } = {}) {
  const grid = small ? 16 : 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" width="${size}" height="${size}">${markShapes(PALETTE[theme], { small })}</svg>\n`;
}

/** The favicon: the small mark, ink on a light browser and lime on a dark one. Still: a favicon never blinks. */
export function faviconFile() {
  const { light, dark } = PALETTE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><style>.lt{fill:${light.tile}}.ls{stroke:${light.glyph}}.lc{fill:${light.glyph}}@media (prefers-color-scheme:dark){.lt{fill:${dark.tile}}.ls{stroke:${dark.glyph}}.lc{fill:${dark.glyph}}}</style>${markShapes(null, { small: true })}</svg>\n`;
}

const n = (v) => Number(v.toFixed(3));

/**
 * The logo: the mark, "markstage" and, under it, the tagline, for the README and other files (`height` is the mark's
 * height in pixels). `tagline: false` gives the mark and the name alone, the name centred on the mark.
 */
export function lockupFile(theme, { height = 120, pad = 0, tagline = true } = {}) {
  const c = PALETTE[theme];
  const h = height;
  const gap = h * 0.26;
  const nameSize = tagline ? h * 0.6 : h * 0.66;
  const nameBase = tagline ? h * 0.55 : h * 0.69;
  const tagSize = h * 0.27;
  const tagBase = h * 0.91;
  const nameScale = nameSize / 1000;
  const tagScale = tagSize / 1000;
  const textX = pad + h + gap;
  const width = Math.ceil(textX + Math.max(WORDMARK.box.width * nameScale, tagline ? TAGLINE_TYPE.box.width * tagScale : 0) + pad);
  const total = Math.ceil(h + pad * 2);
  const tag = tagline
    ? `\n  <path fill="${c.muted}" transform="translate(${n(textX - TAGLINE_TYPE.box.x * tagScale + h * 0.012)} ${n(pad + tagBase)}) scale(${n(tagScale)})" d="${TAGLINE_TYPE.d}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${total}" width="${width}" height="${total}" role="img" aria-label="Markstage${tagline ? `: ${TAGLINE_WORDS}` : ''}">
  <g transform="translate(${pad} ${pad}) scale(${n(h / 32)})">${markShapes(c)}</g>
  <path fill="${c.ink}" transform="translate(${n(textX - WORDMARK.box.x * nameScale)} ${n(pad + nameBase)}) scale(${n(nameScale)})" d="${WORDMARK.d}"/>${tag}
</svg>
`;
}
