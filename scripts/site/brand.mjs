// The Markstage brand in one place: the palette, the mark and the wordmark. Used by the site's pages (layout.mjs),
// the share images (render-social.mjs) and the brand files (render-brand.mjs: assets/brand/, site/icon.svg, the
// favicons).
//
// The mark is a stage: a proscenium arch, with the M standing in a pool of footlight ("edit your Markdown on the
// real stage"). The wordmark is Big Shoulders Display ExtraBold (SIL Open Font License, site/fonts/OFL.txt), kept
// below as outlines so that no file showing it needs the font.

/**
 * "Velvet curtain and brass": curtain crimson for actions and the mark, brass for the footlights, a wine-dark house
 * for the dark theme. site/styles.css holds the same values as CSS tokens; brand.test.mjs checks that they match and
 * that every text pair passes WCAG AA (4.5:1), and the mark 3:1 against the page, in both themes.
 */
export const PALETTE = {
  light: { page: '#ffffff', ink: '#1f1218', tile: '#9e1b3f', letter: '#fff6e8', pool: '#f2b33d', stage: '#2a0f1b' },
  dark: { page: '#170d12', ink: '#f8eef1', tile: '#c42a52', letter: '#fff6e8', pool: '#f5c04f', stage: '#0f070b' },
};

// the mark, on a 32 x 32 grid
const TILE = 'M0 26V13C0 5.8 7.2 1 16 1s16 4.8 16 12v13a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6z';
const ARCH = 'M4.5 28.5V14c0-5 5.1-8.7 11.5-8.7S27.5 9 27.5 14v14.5';
const LETTER = 'M10 22.4v-9.6l6 6.6 6-6.6v9.6';

/** The mark's shapes. `colors` null: classes for the site's CSS tokens (styles.css `.logo`); `arch` false for favicons. */
export function markShapes(colors = null, { arch = true } = {}) {
  const paint = (cls, attr, value) => (colors ? `${attr}="${value}"` : `class="${cls}"`);
  return [
    `<path ${paint('lt', 'fill', colors?.tile)} d="${TILE}"/>`,
    arch ? `<path ${paint('la', 'stroke', colors?.letter)} fill="none" stroke-opacity=".28" stroke-width="1.1" d="${ARCH}"/>` : '',
    `<ellipse ${paint('lp', 'fill', colors?.pool)} cx="16" cy="25.4" rx="9.6" ry="2.1"/>`,
    `<path ${paint('ll', 'stroke', colors?.letter)} fill="none" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round" d="${LETTER}"/>`,
  ].join('');
}

/** The mark as an inline SVG for a page, painted by the site's CSS tokens so it follows the theme. */
export const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false">${markShapes()}</svg>`;

/** A standalone mark file in one theme's colours. */
export function markFile(theme, { size = 32, arch = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">${markShapes(PALETTE[theme], { arch })}</svg>\n`;
}

/** The favicon: the light mark, and the dark one when the browser is in dark mode. */
export function faviconFile() {
  const { light, dark } = PALETTE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.lt{fill:${light.tile}}.lp{fill:${light.pool}}.ll{stroke:${light.letter}}@media (prefers-color-scheme:dark){.lt{fill:${dark.tile}}.lp{fill:${dark.pool}}}</style>${markShapes(null, { arch: false })}</svg>\n`;
}

/** "Markstage" in Big Shoulders Display ExtraBold, as outlines: 2000 units per em, baseline at y = 0. */
export const WORDMARK = {
  box: { x: 86, y: -1600, width: 7757, height: 1984 },
  capHeight: 1600,
  d: 'M86 0V-1600H509L632 -982L667 -230H716L749 -982L874 -1600H1295V0H1036V-486L1086 -1372H1034L944 -469L833 -2H547L438 -469L347 -1372H297L345 -486V0ZM1696 15Q1572 15 1513.5 -47.5Q1455 -110 1442 -257Q1441 -277 1441 -303Q1441 -329 1442 -349Q1448 -428 1476.5 -485Q1505 -542 1565 -586.5Q1625 -631 1724 -670Q1776 -692 1825 -707.5Q1874 -723 1927 -738V-918Q1927 -970 1906 -997Q1885 -1024 1825 -1024Q1774 -1024 1752.5 -1002Q1731 -980 1728 -926Q1727 -909 1726.5 -875.5Q1726 -842 1726.5 -807Q1727 -772 1728 -751H1477Q1476 -769 1475 -815.5Q1474 -862 1475 -897Q1480 -1009 1515 -1080Q1550 -1151 1626.5 -1184.5Q1703 -1218 1832 -1218Q1967 -1218 2043.5 -1181Q2120 -1144 2151.5 -1064.5Q2183 -985 2183 -857L2182 0H1924V-124H1890Q1858 -53 1815 -19Q1772 15 1696 15ZM1801 -171Q1843 -171 1875 -195Q1907 -219 1926 -260V-567Q1890 -558 1856 -545.5Q1822 -533 1790 -515Q1737 -487 1718 -444.5Q1699 -402 1696 -349Q1696 -330 1696 -312.5Q1696 -295 1697 -278Q1702 -226 1728 -198.5Q1754 -171 1801 -171ZM2357 0V-1200H2615V-1059H2661Q2672 -1142 2713.5 -1174.5Q2755 -1207 2820 -1207Q2844 -1207 2866.5 -1205Q2889 -1203 2901 -1202V-1004H2824Q2716 -1004 2671.5 -970Q2627 -936 2615 -874V0ZM3007 0V-1600H3248V-1264L3218 -723H3259L3346 -969L3453 -1200H3721L3486 -740L3762 0H3498L3324 -480L3253 -362V0ZM4165 18Q3988 18 3911.5 -58Q3835 -134 3828 -309Q3827 -344 3827.5 -389Q3828 -434 3830 -452H4056Q4054 -399 4054 -354.5Q4054 -310 4055 -282Q4058 -224 4085.5 -200Q4113 -176 4165 -176Q4228 -176 4256 -200Q4284 -224 4285 -282Q4285 -309 4285 -317.5Q4285 -326 4285 -334Q4285 -342 4285 -366Q4285 -408 4270 -433.5Q4255 -459 4216 -471L4086 -508Q4001 -534 3942 -571.5Q3883 -609 3852.5 -668Q3822 -727 3821 -815Q3821 -834 3821 -851Q3821 -868 3821 -886Q3822 -1064 3901.5 -1141Q3981 -1218 4177 -1218Q4356 -1218 4430.5 -1143.5Q4505 -1069 4512 -897Q4514 -863 4513 -817Q4512 -771 4510 -751H4276Q4277 -773 4277.5 -808Q4278 -843 4277.5 -876Q4277 -909 4276 -926Q4273 -980 4252 -1002Q4231 -1024 4177 -1024Q4120 -1024 4097.5 -1002Q4075 -980 4073 -926Q4072 -901 4071.5 -887Q4071 -873 4071 -837Q4071 -791 4085 -759.5Q4099 -728 4148 -715L4263 -686Q4392 -654 4457.5 -584.5Q4523 -515 4523 -380Q4523 -362 4523 -341.5Q4523 -321 4523 -303Q4522 -131 4440 -56.5Q4358 18 4165 18ZM5103 18Q4897 18 4808.5 -58Q4720 -134 4720 -309V-1004H4614V-1200H4722V-1540H4982V-1200H5178V-1004H4978V-281Q4978 -222 5002 -198Q5026 -174 5104 -174Q5128 -174 5149.5 -175Q5171 -176 5198 -177V8Q5177 14 5153.5 16Q5130 18 5103 18ZM5539 15Q5415 15 5356.5 -47.5Q5298 -110 5285 -257Q5284 -277 5284 -303Q5284 -329 5285 -349Q5291 -428 5319.5 -485Q5348 -542 5408 -586.5Q5468 -631 5567 -670Q5619 -692 5668 -707.5Q5717 -723 5770 -738V-918Q5770 -970 5749 -997Q5728 -1024 5668 -1024Q5617 -1024 5595.5 -1002Q5574 -980 5571 -926Q5570 -909 5569.5 -875.5Q5569 -842 5569.5 -807Q5570 -772 5571 -751H5320Q5319 -769 5318 -815.5Q5317 -862 5318 -897Q5323 -1009 5358 -1080Q5393 -1151 5469.5 -1184.5Q5546 -1218 5675 -1218Q5810 -1218 5886.5 -1181Q5963 -1144 5994.5 -1064.5Q6026 -985 6026 -857L6025 0H5767V-124H5733Q5701 -53 5658 -19Q5615 15 5539 15ZM5644 -171Q5686 -171 5718 -195Q5750 -219 5769 -260V-567Q5733 -558 5699 -545.5Q5665 -533 5633 -515Q5580 -487 5561 -444.5Q5542 -402 5539 -349Q5539 -330 5539 -312.5Q5539 -295 5540 -278Q5545 -226 5571 -198.5Q5597 -171 5644 -171ZM6540 384Q6372 384 6286.5 338Q6201 292 6184 204Q6181 192 6179.5 173.5Q6178 155 6180 137Q6186 89 6219.5 52.5Q6253 16 6311 9V-29Q6259 -38 6228 -67Q6197 -96 6190 -142Q6189 -155 6189 -169Q6189 -183 6190 -199Q6195 -242 6233.5 -269Q6272 -296 6331 -304V-342Q6252 -378 6214 -449Q6176 -520 6168 -636Q6167 -676 6166 -707.5Q6165 -739 6165 -767Q6165 -795 6166 -824Q6167 -853 6168 -887Q6175 -1002 6212 -1075Q6249 -1148 6328.5 -1183Q6408 -1218 6541 -1218Q6666 -1218 6739.5 -1186.5Q6813 -1155 6854 -1086H6892Q6899 -1146 6935 -1173Q6971 -1200 7043 -1200V-1004H7011Q6963 -1004 6936 -980Q6909 -956 6909 -895V-824Q6909 -799 6909 -777.5Q6909 -756 6909.5 -735Q6910 -714 6909.5 -690Q6909 -666 6907 -636Q6899 -516 6861.5 -442.5Q6824 -369 6746 -336.5Q6668 -304 6539 -304Q6448 -304 6414 -290Q6380 -276 6380 -243V-236Q6380 -215 6389 -202.5Q6398 -190 6430 -184Q6462 -178 6534 -177Q6730 -174 6821 -115Q6912 -56 6929 60Q6933 79 6933 99.5Q6933 120 6929 146Q6921 228 6875.5 280.5Q6830 333 6746.5 358.5Q6663 384 6540 384ZM6546 206Q6599 206 6635.5 197Q6672 188 6693 170.5Q6714 153 6721 127Q6726 111 6725 97.5Q6724 84 6720 70Q6712 43 6690.5 27Q6669 11 6633 3.5Q6597 -4 6546 -5Q6468 -6 6430.5 12Q6393 30 6383 70Q6379 84 6379.5 99Q6380 114 6383 127Q6389 154 6408 171.5Q6427 189 6461 197.5Q6495 206 6546 206ZM6538 -498Q6604 -498 6627 -525Q6650 -552 6653 -600Q6655 -629 6656.5 -671Q6658 -713 6658 -759Q6658 -805 6656.5 -847.5Q6655 -890 6653 -921Q6650 -974 6625.5 -999Q6601 -1024 6538 -1024Q6475 -1024 6449 -998.5Q6423 -973 6421 -918Q6419 -868 6418 -824.5Q6417 -781 6417 -742Q6417 -703 6418 -669Q6419 -635 6421 -606Q6425 -559 6446.5 -528.5Q6468 -498 6538 -498ZM7488 18Q7301 18 7215.5 -58Q7130 -134 7120 -309Q7118 -355 7117 -431.5Q7116 -508 7116 -595Q7116 -682 7117 -760.5Q7118 -839 7120 -887Q7132 -1066 7216.5 -1142Q7301 -1218 7485 -1218Q7668 -1218 7750.5 -1143.5Q7833 -1069 7841 -897Q7842 -873 7842.5 -816.5Q7843 -760 7842.5 -690Q7842 -620 7839 -556H7375Q7375 -487 7376.5 -418.5Q7378 -350 7379 -282Q7381 -224 7406 -200Q7431 -176 7488 -176Q7540 -176 7562.5 -200Q7585 -224 7588 -282Q7590 -310 7590 -354.5Q7590 -399 7588 -453H7839Q7841 -434 7842 -389Q7843 -344 7841 -309Q7833 -134 7751.5 -58Q7670 18 7488 18ZM7375 -736H7590Q7590 -779 7590 -818.5Q7590 -858 7589.5 -886.5Q7589 -915 7588 -926Q7585 -978 7561.5 -1001Q7538 -1024 7485 -1024Q7429 -1024 7405 -1001Q7381 -978 7379 -926Q7378 -877 7377 -830Q7376 -783 7375 -736Z',
};

/**
 * The logo: the mark and the wordmark side by side, for the README and other files (`height` in pixels). The
 * wordmark's capitals are half the mark's height, standing on the stage floor.
 */
export function lockupFile(theme, { height = 120, pad = 0 } = {}) {
  const c = PALETTE[theme];
  const markSize = height;
  const scale = (markSize * 0.52) / WORDMARK.capHeight;
  const baseline = markSize * 0.76;
  const gap = markSize * 0.24;
  const width = Math.round(pad * 2 + markSize + gap + WORDMARK.box.width * scale);
  const total = Math.round(markSize + pad * 2);
  const x = pad + markSize + gap - WORDMARK.box.x * scale;
  const n = (v) => Number(v.toFixed(3));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${total}" width="${width}" height="${total}" role="img" aria-label="Markstage">
  <g transform="translate(${pad} ${pad}) scale(${n(markSize / 32)})">${markShapes(c)}</g>
  <path fill="${c.ink}" transform="translate(${n(x)} ${n(pad + baseline)}) scale(${n(scale)})" d="${WORDMARK.d}"/>
</svg>
`;
}
