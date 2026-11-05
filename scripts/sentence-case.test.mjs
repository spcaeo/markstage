// Sentence case in the editor: no text is drawn in capitals only. Labels like "CONTENT" or "NEW AI ASSISTANT TOKEN" are
// hard to read, so a label keeps its weight with size, weight or colour instead. The public site has the same rule
// (scripts/site/brand.test.mjs); this one covers the editor, the Astro package and core (the "Edit this page" button,
// the preview bars), anything the server draws, and the sample sites we ship. Keys (⌘S, Esc) and acronyms (SEO, MDX,
// URL) are written as they are.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [
  'packages/editor/src',
  'packages/astro/src',
  'packages/astro/bin',
  'packages/core/src',
  'packages/server/src',
  'examples/blog/src',
  'examples/starter/src',
];
const EXT = /\.(css|ts|tsx|mjs|js|astro|html)$/;

// CSS (text-transform: uppercase; font-variant: small-caps / all-small-caps; font-variant-caps) and the same set
// from script (el.style.textTransform = 'uppercase', { fontVariantCaps: 'small-caps' }, setProperty('text-transform', …))
const CAPS = [
  /text-transform\s*:\s*(full-width\s+)?uppercase/i,
  /font-variant(-caps)?\s*:\s*[^;}"'`]*\b(all-|petite-|all-petite-)?small-caps/i,
  /textTransform\s*[:=]\s*['"`]uppercase/,
  /fontVariant(Caps)?\s*[:=]\s*['"`][^'"`]*small-caps/,
  /setProperty\(\s*['"`]text-transform['"`]\s*,\s*['"`]uppercase/,
];

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' || d.name === 'dist' ? [] : walk(p);
    return EXT.test(d.name) ? [p] : [];
  });

const files = DIRS.map((d) => path.join(root, d)).filter((d) => fs.existsSync(d)).flatMap(walk);

test('the guard sees the editor and its styles', () => {
  assert.ok(files.some((f) => f.endsWith('.css')), 'no CSS found');
  assert.ok(files.length > 100, `only ${files.length} files scanned`);
});

test('the guard catches every way of setting capitals', () => {
  for (const s of [
    '.x { text-transform: uppercase; }',
    '.x{text-transform:UPPERCASE}',
    '.x { font-variant: small-caps; }',
    '.x { font-variant-caps: all-small-caps; }',
    "el.style.textTransform = 'uppercase';",
    "Object.assign(el.style, { fontVariantCaps: 'all-small-caps' });",
    "el.style.setProperty('text-transform', 'uppercase');",
  ]) assert.ok(CAPS.some((re) => re.test(s)), s);
  for (const s of ['.x { text-transform: none; }', '.x { font-variant-numeric: tabular-nums; }', '// innerText is the text as drawn (CSS uppercase and all)']) {
    assert.ok(!CAPS.some((re) => re.test(s)), s);
  }
});

test('no text in the editor, its packages or the sample sites is set in capitals only (sentence case)', () => {
  const bad = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (CAPS.some((re) => re.test(line))) bad.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], 'write labels in sentence case; keep their weight with size, weight or colour, not capitals');
});
