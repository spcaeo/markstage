// The page's colours on the canvas (canvas-shell/scheme.ts): when the page turns dark by itself for a dark reader,
// and which <meta name=color-scheme> values the canvas takes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followsScheme, metaScheme } from '../src/canvas-shell/scheme.ts';

test('a page turns dark for a dark reader only when its CSS or its scripts read the system scheme', () => {
  // the example blog: dark colours behind an attribute nothing on the page sets: light for every reader
  assert.equal(followsScheme([":root { --text: #1d1f23 }\n:root[data-theme='dark'] { --text: #e4e5e8 }"], []), false);
  // the starter: the visitor's setting
  assert.equal(followsScheme(['@media (prefers-color-scheme: dark) { :root { --bg: #141518 } }'], []), true);
  assert.equal(followsScheme(['@media (prefers-color-scheme:dark){:root{--bg:#000}}'], []), true);
  // a light-only rule is not a dark design
  assert.equal(followsScheme(['@media (prefers-color-scheme: light) { :root { --bg: #fff } }'], []), false);
  // a theme switch in a head script that starts from the system's setting
  assert.equal(followsScheme([], ["document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'"]), true);
  assert.equal(followsScheme([], ["document.documentElement.classList.add('js')"]), false);
});

test('<meta name=color-scheme>: the values CSS takes, nothing else', () => {
  assert.equal(metaScheme('light dark'), 'light dark');
  assert.equal(metaScheme(' Dark '), 'dark');
  assert.equal(metaScheme('only light'), 'only light');
  assert.equal(metaScheme('normal'), 'normal');
  assert.equal(metaScheme('dark; color: red'), null);
  assert.equal(metaScheme('}'), null);
  assert.equal(metaScheme(null), null);
});
