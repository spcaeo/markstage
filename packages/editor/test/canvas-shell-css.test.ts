// The page shell's CSS (src/canvas-shell/css.ts, docs/CANVAS-FIDELITY.md): the site's rules only reach the shell,
// html / :root / body land on the shell's stand-ins at the same weight, width media queries become container
// queries on the canvas, and vw follows the canvas's width.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const css = await import('../src/canvas-shell/css.ts');
const { mediaToQueries, rewriteVw, scopeRules, scopeSelector, splitTop } = css;

test('a selector list is split at its own commas only', () => {
  assert.deepEqual(splitTop(':is(a, b) .c, [data-x="1,2"], d', ','), [':is(a, b) .c', ' [data-x="1,2"]', ' d']);
});

test('html, :root and body become the stand-ins; the rest only matches inside the shell', () => {
  assert.equal(scopeSelector(':root'), '.ms-pg');
  assert.equal(scopeSelector("html[data-frame='reading'] .prose .sidenote"), ":where(.ms-pg):is(div)[data-frame='reading'] .prose .sidenote");
  assert.equal(scopeSelector('body'), ':where(.ms-pg-body):is(div)');
  assert.equal(scopeSelector('.post__body > p'), ':where(.ms-pg) .post__body > p, :where(.ms-pg).post__body > p');
  assert.equal(scopeSelector('h1'), ':where(.ms-pg) h1');
  assert.equal(scopeSelector('::selection'), ':where(.ms-pg) ::selection');
  // about <html> itself: [data-theme='dark'] .x also matches when the stand-in has the attribute
  assert.equal(scopeSelector("[data-theme='dark'] .x"), ":where(.ms-pg) [data-theme='dark'] .x, :where(.ms-pg)[data-theme='dark'] .x");
  assert.equal(scopeSelector('a, :root[data-theme="dark"]'), ':where(.ms-pg) a, .ms-pg[data-theme="dark"]');
});

test('width media queries become container queries on the canvas; other features stay media queries', () => {
  assert.deepEqual(mediaToQueries('(min-width: 1280px)'), [{ media: '', container: '(min-width: 1280px)' }]);
  assert.deepEqual(mediaToQueries('screen and (max-width: 35em)'), [{ media: '', container: '(max-width: 560px)' }]);
  assert.deepEqual(mediaToQueries('(prefers-reduced-motion: reduce)'), [{ media: '(prefers-reduced-motion: reduce)', container: '' }]);
  assert.deepEqual(mediaToQueries('(hover: hover) and (min-width: 600px)'), [{ media: '(hover: hover)', container: '(min-width: 600px)' }]);
  assert.deepEqual(mediaToQueries('(width >= 600px), print'), [{ media: '', container: '(width >= 600px)' }]);
  assert.equal(mediaToQueries('print'), null);
});

test('vw follows the canvas', () => {
  assert.equal(rewriteVw('calc(100vw - 2rem)'), 'calc(calc(100 * var(--ms-vw, 1vw)) - 2rem)');
  assert.equal(rewriteVw('clamp(1.875rem, 1.5rem + 1.2vw, 2.5rem)'), 'clamp(1.875rem, 1.5rem + calc(1.2 * var(--ms-vw, 1vw)), 2.5rem)');
  assert.equal(rewriteVw('width: 50dvw; height: 100vh'), 'width: calc(50 * var(--ms-vw, 1vw)); height: 100vh');
});

test('a sheet: rules, media rules and the rest, as the browser parsed them', () => {
  const style = (selectorText: string, cssText: string) => ({ selectorText, style: { cssText }, cssText: `${selectorText} { ${cssText} }` });
  const rules = [
    style(':root', '--bleed: 0px;'),
    { cssText: '@media (min-width: 1280px) { … }', media: { mediaText: '(min-width: 1280px)' }, cssRules: [style("html[data-frame='reading']", '--bleed: calc(100vw - 10px);')] },
    { cssText: '@media print { … }', media: { mediaText: 'print' }, cssRules: [style('a', 'color: black;')] },
    { cssText: '@font-face { font-family: X; src: url(x.woff2); }' },
    { cssText: '@import url(x.css);' },
  ];
  const out = scopeRules(rules);
  assert.match(out, /^\.ms-pg\{--bleed: 0px;\}/);
  assert.match(out, /@container ms-vp \(min-width: 1280px\)\{:where\(\.ms-pg\):is\(div\)\[data-frame='reading'\]\{--bleed: calc\(calc\(100 \* var\(--ms-vw, 1vw\)\) - 10px\);\}/);
  assert.doesNotMatch(out, /print|color: black|@import/);
  assert.match(out, /@font-face/);
});

test("a sheet's rules are read from its text, every declaration as written (the CSSOM loses var() shorthands)", () => {
  const { parseRules, scopeSheet } = css;
  const rules = parseRules(`/* a comment { } */
.rcta--inline { border: 1px solid var(--line); border-left: 2px solid var(--accent); }
.a { content: "{;}"; background: url(data:image/svg+xml;utf8,<svg/>); --x: { a: b }; }
@media (min-width: 1280px) { .b { margin: var(--m); margin-top: 0 } }
.card { color: red; &:hover { color: blue } padding: 0; @media (min-width: 600px) { gap: 2px; } }
@keyframes spin { from { rotate: 0 } to { rotate: 1turn } }
@layer base, site;
@import url(x.css);`);
  assert.equal(rules[0].selectorText, '.rcta--inline');
  assert.equal(rules[0].style?.cssText, 'border: 1px solid var(--line); border-left: 2px solid var(--accent);');
  assert.equal(rules[1].style?.cssText, 'content: "{;}"; background: url(data:image/svg+xml;utf8,<svg/>); --x: { a: b };');
  assert.equal(rules[2].media?.mediaText, '(min-width: 1280px)');
  assert.equal(rules[2].cssRules?.[0].style?.cssText, 'margin: var(--m); margin-top: 0;');
  // nesting: the rule's own declarations, then its nested rules in order (later declarations as a rule of their own)
  assert.equal(rules[3].style?.cssText, 'color: red;');
  assert.deepEqual([...(rules[3].cssRules ?? [])].map((r) => r.selectorText ?? r.cssText), ['&:hover', 'padding: 0;', '@media (min-width: 600px){}']);
  assert.equal(rules[3].cssRules?.[2].cssRules?.[0].cssText, 'gap: 2px;');
  assert.equal(rules[4].cssText, '@keyframes spin{ from { rotate: 0 } to { rotate: 1turn } }');
  assert.deepEqual([rules[5].cssText, rules[6].cssText], ['@layer base, site;', '@import url(x.css);']);
  const out = scopeSheet('.rcta--inline { border: 1px solid var(--line); border-left: 2px solid var(--accent); } @import url(x.css);');
  assert.equal(out, ':where(.ms-pg) .rcta--inline, :where(.ms-pg).rcta--inline{border: 1px solid var(--line); border-left: 2px solid var(--accent);}\n');
});
