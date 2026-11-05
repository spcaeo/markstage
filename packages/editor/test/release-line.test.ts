// Every screen ends with the release line (the owner's rule, 2026-11-02): page() in admin/ui.ts appends
// releaseFooter(), and the two builds (build-editor.mjs, the Astro integration) stamp __MS_RELEASE__.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const astro = (p: string) => readFileSync(new URL(`../../astro/src/${p}`, import.meta.url), 'utf8');

test('every admin screen gets the release footer from page()', () => {
  assert.ok(src('admin/ui.ts').includes('releaseFooter()'), 'page() appends the footer');
  assert.ok(src('release.ts').includes("from 'virtual:markstage/release'"));
});

test('one release line per screen: the page hides its own while the drawer shows the drawer’s', () => {
  // the drawer (nav.ts) ends with the line; page() ends with it too, for screens and widths where the drawer's is hidden
  assert.ok(src('nav.ts').includes('releaseFooter()'), 'the drawer has the line');
  const css = src('admin/admin.css').replace(/\s+/g, ' ');
  assert.ok(css.includes('@media (min-width: 721px) { .ms-app.has-nav:not(.nav-folded) .ms-adm > .ms-release { display: none; } }'), 'admin.css hides the page’s line beside an open drawer');
  // a folded drawer hides its line (host.css), so the page's shows then
  assert.match(src('styles/host.css').replace(/\s+/g, ' '), /\.nav-folded :is\([^)]*\.ms-nav__foot[^)]*\) \{ display: none;/);
});

test('the virtual module stamps the release line for dev and build-editor alike', () => {
  assert.ok(astro('client.mjs').includes("if (name === 'release') return `export default ${js(releaseInfo("), 'client.mjs answers virtual:markstage/release');
});
