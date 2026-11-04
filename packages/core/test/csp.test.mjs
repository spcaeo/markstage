// What a page's own code needs from its CSP: a hash per inline script that runs and per inline style, the origins
// of external ones, and the problems a hash cannot allow; then the policy with them added.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cspHash, cspHashes, withCspSources } from '../src/csp.mjs';

test('the hash is the one browsers compute (the CSP spec example)', () => {
  assert.equal(cspHash("alert('Hello, world.');"), "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='");
  // UTF-8, exact text: whitespace counts
  assert.notEqual(cspHash('a()'), cspHash('a() '));
  // openssl dgst -sha256 of the UTF-8 bytes
  assert.equal(cspHash('é'), "'sha256-SplVfkAzw1Od4utlRyAXytX5VX96BiWgnxw/biumnEw='");
});

test('inline scripts that run, styles, external origins; data blocks and comments need nothing', () => {
  const html = `<!-- <script>commented()</script> -->
<script>track('a')</script>
<script type="module">import x from '/x.js'</script>
<script type="application/ld+json">{"@type":"Thing"}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<script src="/local.js"></script>
<SCRIPT>upper()</SCRIPT>
<script>track('a')</script>
<style>.a{color:red}</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="preload" as="script" href="//cdn.example.net/p.js">
<link rel="icon" href="https://icons.example/f.ico">`;
  const n = cspHashes(html);
  assert.deepEqual(n.script, [cspHash("track('a')"), cspHash("import x from '/x.js'"), cspHash('upper()')]);
  assert.deepEqual(n.style, [cspHash('.a{color:red}')]);
  assert.deepEqual(n.scriptOrigins, ['https://www.googletagmanager.com', 'https://cdn.example.net']);
  assert.deepEqual(n.styleOrigins, ['https://fonts.googleapis.com']);
  assert.deepEqual(n.problems, []);
});

test('what a hash cannot allow is named: event attributes, style attributes, javascript: addresses', () => {
  const n = cspHashes(`<img src="/a.png" onerror="x()"><div style="color:red">a</div><div style="">b</div><a href=" javascript:go()">c</a><p data-on="1">ok</p>`);
  assert.deepEqual(n.problems.map((p) => [p.kind, p.tag, p.attr]), [['handler', 'img', 'onerror'], ['style-attr', 'div', 'style'], ['javascript-url', 'a', 'href']]);
  assert.match(n.problems[0].message, /addEventListener/);
});

test('the policy gets them; from default-src when it has no script-src; never next to a bare unsafe-inline', () => {
  const needs = { script: ["'sha256-AAA='"], style: ["'sha256-BBB='"], scriptOrigins: ['https://cdn.example'], styleOrigins: [] };
  assert.equal(
    withCspSources("default-src 'self'; script-src 'self'; img-src *", needs),
    "default-src 'self'; script-src 'self' 'sha256-AAA=' https://cdn.example; img-src *; style-src 'self' 'sha256-BBB='",
  );
  // a hash would turn 'unsafe-inline' off: left as it is (it already allows inline code); origins still added
  assert.equal(withCspSources("script-src 'self' 'unsafe-inline'", needs), "script-src 'self' 'unsafe-inline' https://cdn.example");
  // with a hash already there, 'unsafe-inline' is off anyway: the new ones go in
  assert.equal(withCspSources("script-src 'unsafe-inline' 'sha256-OLD='", needs), "script-src 'unsafe-inline' 'sha256-OLD=' 'sha256-AAA=' https://cdn.example");
  assert.equal(withCspSources("script-src 'none'", needs), "script-src 'sha256-AAA=' https://cdn.example");
  assert.equal(withCspSources("img-src 'self'", needs), "img-src 'self'", 'nothing restricts scripts: nothing to add');
  assert.equal(withCspSources('', needs), '');
  assert.equal(withCspSources("script-src 'self' 'sha256-AAA='", needs), "script-src 'self' 'sha256-AAA=' https://cdn.example", 'no doubles');
});
