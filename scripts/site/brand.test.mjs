// The brand's colours (brand.mjs, site/styles.css): every text pair passes WCAG AA (4.5:1) and every mark, chip and
// button edge 3:1, in the light and the dark theme, so nothing is dark on dark or light on light; the CSS tokens and
// the brand files use the same colours; the brand files are there.   npm run site:test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { faviconFile, lockupFile, markFile, PALETTE } from './brand.mjs';
import { REPO_ROOT } from './build-site.mjs';

const css = fs.readFileSync(path.join(REPO_ROOT, 'site', 'styles.css'), 'utf8');

/** The `--name: #hex` tokens of the first `:root { }` after `from` in styles.css. */
function tokens(from) {
  const at = css.indexOf(from);
  const block = css.slice(at, css.indexOf('}', css.indexOf(':root', at)));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}
const THEMES = { light: tokens(':root {'), dark: tokens('@media (prefers-color-scheme: dark)') };

function luminance(hex) {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)
    .map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum]: text on every surface it sits on, then marks and edges
const PAIRS = [
  ...['bg', 'bg-2', 'surface', 'code-bg'].flatMap((bg) => [
    ['ink', bg, 4.5],
    ['ink-2', bg, 4.5],
    ['ink-3', bg, 4.5],
    ['brand-ink', bg, 4.5],
  ]),
  ['brand-ink', 'brand-soft', 4.5], // chips, pills, step numbers
  ['on-brand', 'brand', 4.5], // filled buttons, the GitHub button
  ['brand-ink', 'on-brand', 4.5], // the star count on the GitHub button
  ['on-brand', 'brand-hover', 4.5],
  ['on-accent', 'accent', 4.5],
  ['stage-ink', 'stage', 4.5], // the story told on the stage
  ['stage-ink-2', 'stage', 4.5],
  ['ok', 'bg', 3], // ticks
  ['ok', 'bg-2', 3],
  ['logo-tile', 'bg', 3], // the mark on the page, the top bar and the footer
  ['logo-tile', 'bg-2', 3],
  ['logo-letter', 'logo-tile', 4.5],
  ['brand', 'bg', 3], // a filled button stands out from the page
  ['accent', 'stage', 3], // the brass floor line on the stage
  // the comparison's mark badges (site/compare.css), and Markstage's highlighted column
  ['yes-ink', 'yes-bg', 4.5],
  ['part-ink', 'part-bg', 4.5],
  ['no-ink', 'no-bg', 4.5],
  ['unk-ink', 'unk-bg', 4.5],
  ['ink', 'ms-col', 4.5],
  ['ink-2', 'ms-col', 4.5],
  ['ink-3', 'ms-col', 4.5],
  ['brand-ink', 'ms-col', 4.5],
  ['ink-3', 'bg-2', 4.5], // notes on a zebra row
  ['ink', 'brand-soft', 4.5], // a product's monogram tile, Markstage's card
];

describe('brand colours', () => {
  for (const [theme, t] of Object.entries(THEMES)) {
    test(`${theme}: every pair passes`, () => {
      const fails = [];
      for (const [fg, bg, min] of PAIRS) {
        assert.ok(t[fg] && t[bg], `${theme}: --${fg} or --${bg} missing`);
        const r = contrast(t[fg], t[bg]);
        if (r < min) fails.push(`--${fg} on --${bg}: ${r.toFixed(2)} (needs ${min})`);
      }
      assert.deepEqual(fails, []);
    });

    test(`${theme}: the CSS tokens and the brand files use the same colours`, () => {
      const p = PALETTE[theme];
      assert.equal(t['logo-tile'], p.tile);
      assert.equal(t['logo-letter'], p.letter);
      assert.equal(t['logo-pool'], p.pool);
      assert.equal(t.bg, p.page);
      assert.equal(t.ink, p.ink);
      assert.ok(contrast(p.ink, p.page) >= 4.5, 'the wordmark on the page');
      assert.ok(contrast(p.tile, p.page) >= 3, 'the mark on the page');
    });
  }

  test('the brand files are there and match brand.mjs', () => {
    const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    assert.equal(read('assets/brand/markstage.svg'), markFile('light'));
    assert.equal(read('assets/brand/markstage-dark.svg'), markFile('dark'));
    assert.equal(read('assets/brand/markstage-logo.svg'), lockupFile('light', { height: 120 }));
    assert.equal(read('assets/brand/markstage-logo-dark.svg'), lockupFile('dark', { height: 120 }));
    assert.equal(read('site/icon.svg'), faviconFile());
    for (const f of ['assets/brand/markstage-512.png', 'assets/brand/markstage-logo.png', 'assets/brand/markstage-logo-dark.png', 'site/apple-touch-icon.png', 'site/favicon.ico']) {
      assert.ok(fs.statSync(path.join(REPO_ROOT, f)).size > 0, f);
    }
    // no trace of the old indigo mark
    for (const f of ['site/styles.css', 'site/home.css', 'site/icon.svg', 'assets/brand/markstage.svg']) assert.doesNotMatch(read(f), /#4f46e5/i, f);
  });
});
