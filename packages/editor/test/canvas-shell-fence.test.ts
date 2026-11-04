// The page shell's two ways of keeping the page as the page draws it (docs/CANVAS-FIDELITY.md): the editor's own copy
// of the site's CSS is fenced out of the shell (src/canvas-shell/css.ts, fence.ts), and the page's first <head> scripts run
// in a sandboxed frame with no network, to learn what they set on <html> (src/canvas-shell/first-paint.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { FENCE, fenceRules, fenceSelector } = await import('../src/canvas-shell/css.ts');
const { firstPaintDoc, headScripts } = await import('../src/canvas-shell/first-paint.ts');

test('a fenced selector matches outside the shell only, at its own weight, before its pseudo-element', () => {
  assert.equal(FENCE, ':where(:not(.ms-pg, .ms-pg *))');
  assert.equal(fenceSelector(':root:not([data-theme="dark"]) .logo-night'), `:root:not([data-theme="dark"]) .logo-night${FENCE}`);
  assert.equal(fenceSelector('.a > .b::before'), `.a > .b${FENCE}::before`);
  assert.equal(fenceSelector('.a:hover:after'), `.a:hover${FENCE}:after`);
  assert.equal(fenceSelector('.x::-webkit-scrollbar-thumb:hover'), `.x${FENCE}::-webkit-scrollbar-thumb:hover`);
  // a pseudo-element of an earlier compound does not count; commas inside :is() are not the list's
  assert.equal(fenceSelector(':is(.a, .b) .c, [data-x="a::b"]'), `:is(.a, .b) .c${FENCE}, [data-x="a::b"]${FENCE}`);
  assert.equal(fenceSelector('html'), `html${FENCE}`);
});

test('a fenced sheet: style rules (nested too) fenced, at-rules kept with their prelude', () => {
  const style = (selectorText: string, cssText: string, cssRules: unknown[] = []) => ({ selectorText, style: { cssText }, cssText: `${selectorText} { ${cssText} }`, cssRules });
  const out = fenceRules([
    style('.card', 'color: red;', [style('&:hover', 'color: blue;')]),
    { cssText: '@media (min-width: 1280px) { .a { … } }', cssRules: [style('.a', 'margin: 0;')] },
    { cssText: '@font-face { font-family: X; src: url(x.woff2); }' },
    { cssText: '@import url(x.css);' },
  ]);
  assert.match(out, /^\.card:where\(:not\(\.ms-pg, \.ms-pg \*\)\)\{color: red;&:hover:where\(:not\(\.ms-pg, \.ms-pg \*\)\)\{color: blue;\}/);
  assert.match(out, /@media \(min-width: 1280px\) \{\.a:where\(:not\(\.ms-pg, \.ms-pg \*\)\)\{margin: 0;\}/);
  assert.match(out, /@font-face/);
  assert.doesNotMatch(out, /@import/);
});

/** Enough of a parsed page for first-paint.ts: <html>, <body> and the <head>'s scripts. */
function page(scripts: { type?: string; src?: string; text: string }[]) {
  const attrs = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));
  const els = scripts.map((s) => ({ getAttribute: (n: string) => (n === 'type' ? (s.type ?? null) : null), textContent: s.text, src: s.src }));
  return {
    documentElement: { attributes: attrs({ lang: 'en-CA', 'data-frame': 'reading' }) },
    body: { attributes: attrs({ class: 'a"b' }) },
    head: { querySelectorAll: () => els.filter((e) => !e.src) },
  } as unknown as Document;
}

test("the page's first scripts: inline classic ones of <head> only, in a frame that loads nothing and reports back", () => {
  const doc = page([
    { text: "document.documentElement.classList.add('js');" },
    { type: 'application/ld+json', text: '{"@context":"https://schema.org"}' },
    { type: 'module', text: 'import x from "/x.js";' },
    { type: 'speculationrules', text: '{}' },
    { type: 'text/javascript', text: 'window.dataLayer = [];' },
  ]);
  assert.deepEqual(headScripts(doc), ["document.documentElement.classList.add('js');", 'window.dataLayer = [];']);
  const html = firstPaintDoc(doc, 'n1');
  assert.match(html, /^<!doctype html><html lang="en-CA" data-frame="reading"><head>/);
  // no network: nothing but inline scripts may run, nothing may load (no analytics from the editor)
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">/);
  assert.match(html, /<script>document\.documentElement\.classList\.add\('js'\);<\/script><script>window\.dataLayer = \[\];<\/script><\/head>/);
  assert.match(html, /<body class="a&quot;b"><script>parent\.postMessage\(\{ms:"n1",/);
  assert.doesNotMatch(html, /ld\+json|import x|speculationrules/);
});
