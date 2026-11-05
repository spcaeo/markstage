// The live demo's build pieces (scripts/demo/): what a recorded answer may hold, the blog's paths under the demo's
// base, the build's arguments, and the recorded answers themselves (nothing of a machine or a private site in them).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './build-demo.mjs';
import { brandCss, agentLoader, prefixPaths, redirectPage } from './html.mjs';
import { curate, DEMO_IP, DEMO_ORIGIN, recordedText, scrub } from './record-plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('scrub: folders, the server address, loopback and secret-looking values are replaced', () => {
  const home = ['', 'Users', 'someone', 'work'].join('/');
  const out = scrub(
    { root: `${home}/site/src`, link: 'http://127.0.0.1:23433/markstage/#/e/posts/a', ip: '127.0.0.1', v6: 'from ::1', csrfToken: 'abc', nested: [{ apiToken: 'x', name: 'Jordan' }] },
    { roots: [home, `${home}/site`], origin: 'http://127.0.0.1:23433' },
  );
  assert.deepEqual(out, { root: '/srv/example-blog/src', link: `${DEMO_ORIGIN}/markstage/#/e/posts/a`, ip: DEMO_IP, v6: `from ${DEMO_IP}`, csrfToken: 'demo', nested: [{ apiToken: 'demo', name: 'Jordan' }] });
  assert.throws(() => scrub({ p: `${['', 'Users', 'other'].join('/')}/x` }), /home folder/);
});

test('curate drops previews and notices; recordedText keeps one route per line, sorted', () => {
  const routes = new Map([
    ['notices', { status: 200, body: { items: [{ id: 'n1' }] } }],
    ['preview/posts/a', { status: 404, body: {} }],
    ['auth/me', { status: 200, body: { user: { name: 'Jordan' } } }],
  ]);
  const c = curate(routes);
  assert.deepEqual([...c.keys()], ['notices', 'auth/me']);
  assert.deepEqual(c.get('notices').body.items, []);
  const text = recordedText(c);
  assert.equal(text.split('\n').length, 5);
  assert.ok(text.indexOf('"auth/me"') < text.indexOf('"notices"'));
  assert.deepEqual(JSON.parse(text)['auth/me'].body.user.name, 'Jordan');
});

test('prefixPaths: site paths go under the base; outside addresses and paths already there stay', () => {
  const html = '<a href="/">Home</a><a href="/posts/a/">A</a><img src="/uploads/x.png" srcset="/uploads/x.png 1x, /uploads/x2.png 2x"><a href="https://example.com/">x</a><a href="//cdn.example.com/a.js">c</a><link href="/demo/blog/_astro/a.css"><a href="#top">t</a>';
  assert.equal(
    prefixPaths(html, '/demo/blog/'),
    '<a href="/demo/blog/">Home</a><a href="/demo/blog/posts/a/">A</a><img src="/demo/blog/uploads/x.png" srcset="/demo/blog/uploads/x.png 1x, /demo/blog/uploads/x2.png 2x"><a href="https://example.com/">x</a><a href="//cdn.example.com/a.js">c</a><link href="/demo/blog/_astro/a.css"><a href="#top">t</a>',
  );
});

test('the agent loader names this origin and runs only in a frame; the redirect page is noindex', () => {
  const js = agentLoader();
  assert.match(js, /window\.parent === window/);
  assert.match(js, /data-cms', location\.origin/);
  const page = redirectPage('editor/#/e/posts/a"b');
  assert.match(page, /noindex/);
  assert.match(page, /url=editor\/#\/e\/posts\/a&quot;b/);
});

test('build arguments: OUT is needed, the base has a slash at both ends, the install link is http(s)', () => {
  assert.deepEqual(parseArgs(['out', '--base', '/x/demo/', '--install', 'https://example.com/#install']), { out: 'out', base: '/x/demo/', install: 'https://example.com/#install' });
  assert.equal(parseArgs(['out']).base, '/markstage/demo/');
  assert.throws(() => parseArgs([]), /Say where/);
  assert.throws(() => parseArgs(['out', '--base', '/x/demo']), /slash at both ends/);
  assert.throws(() => parseArgs(['out', '--base', 'x/']), /slash at both ends/);
  assert.throws(() => parseArgs(['out', '--install', 'javascript:alert(1)']), /http/);
});

test('the recorded answers: valid JSON, each route on its own line, nothing of a machine or a secret in them', () => {
  const text = fs.readFileSync(path.join(here, 'recorded', 'api.json'), 'utf8');
  const data = JSON.parse(text);
  assert.equal(text.split('\n').length, Object.keys(data).length + 3);
  assert.ok(data['auth/me'] && data.index && data['collections/posts/entries/hello-markstage/source'], 'the editor boots and opens a post');
  assert.doesNotMatch(text, /\/(Users|home)\/[A-Za-z]/);
  assert.doesNotMatch(text, /127\.0\.0\.1|localhost/);
  assert.doesNotMatch(text, /"csrfToken":"(?!demo")/);
  assert.ok(!Object.keys(data).some((k) => k.startsWith('preview/')), 'previews are the demo blog’s own pages');
  // only made-up people and the example blog
  for (const email of text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []) assert.match(email, /@example\.(com|test)$/, email);

  test('brandCss gives the strip the site’s colour tokens, light and dark, and nothing that is not a colour', () => {
    const css = `:root {\n  --brand: #cdf75a;\n  --on-brand: #0e1a0b;\n  --line: rgb(1 2 3 / 50%);\n  --accent: url(x);\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --brand: #b5e83a;\n  }\n}`;
    const out = brandCss(css);
    assert.match(out, /:root \.ms-demo-bar,\n:root \.ms-demo-dialog \{\n  --ms-demo-brand: #cdf75a;\n  --ms-demo-on-brand: #0e1a0b;\n  --ms-demo-line: rgb\(1 2 3 \/ 50%\);\n\}/);
    assert.doesNotMatch(out, /url\(/);
    assert.match(out, /data-ms-theme='dark'\] :is\(\.ms-demo-bar, \.ms-demo-dialog\) \{\n  --ms-demo-brand: #b5e83a;/);
    assert.equal(brandCss('body { color: red; }'), '');
  });
});
