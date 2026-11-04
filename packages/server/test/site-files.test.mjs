// The built editor on the CMS origin (editorDir) and the site files it draws with (site-files.mjs): fonts and images
// only, public/ for anyone, the rest of the repo for signed-in people, never .git, node_modules, dot-folders or a
// link out of the repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { as, client, makeFixture, makePng, startServer } from './helpers.mjs';

let fx;
let srv;
let editorDir;
before(async () => {
  fx = makeFixture({ checks: false });
  const put = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(fx.site, rel)), { recursive: true });
    fs.writeFileSync(path.join(fx.site, rel), data);
  };
  put('public/fonts/site.woff2', 'wOF2-font');
  put('public/img/logo.png', makePng());
  put('public/page.html', '<script>alert(1)</script>');
  put('src/assets/uploads/2026/10/draft.png', makePng());
  put('src/assets/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  put('node_modules/pkg/x.png', makePng());
  put('.hidden/x.png', makePng());
  // a link out of the repo, to the folder that holds the data dir
  fs.symlinkSync(fx.run, path.join(fx.site, 'public', 'out'));
  fs.writeFileSync(path.join(fx.run, 'outside.png'), makePng());
  fx.git('add', 'public', 'src');
  fx.git('commit', '-q', '-m', 'Site files');
  editorDir = path.join(fx.run, 'editor-build');
  fs.mkdirSync(path.join(editorDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(editorDir, 'index.html'), '<!doctype html><title>Editor</title>');
  fs.writeFileSync(path.join(editorDir, 'assets', 'editor-abc.js'), 'export {}');
  fs.writeFileSync(path.join(editorDir, 'assets', 'editor-abc.css'), 'body{}');
  srv = await startServer(fx, { overrides: { editorDir } });
});
after(() => srv.close());

test('the built editor: its page, script and styles under the base path, with the app CSP', async () => {
  const c = client(srv.base);
  const page = await c.get(`${srv.base}/markstage/`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Editor<\/title>/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const js = await c.get(`${srv.base}/markstage/assets/editor-abc.js`);
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await c.get(`${srv.base}/markstage/assets/editor-abc.css`)).headers.get('content-type'), 'text/css; charset=utf-8');
  // an editor route (#/… is never sent) or a missing file: the page
  assert.match((await c.get(`${srv.base}/markstage/p/pages/x`)).text, /<title>Editor/);
});

test('public/ fonts and images for anyone (the editor page asks for its fonts before sign-in)', async () => {
  const c = client(srv.base);
  const font = await c.get(`${srv.base}/fonts/site.woff2`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(font.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(font.text, 'wOF2-font');
  const img = await c.get(`${srv.base}/img/logo.png`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await c.request('HEAD', `${srv.base}/img/logo.png`)).status, 200);
});

test('images elsewhere in the repo: signed-in people only', async () => {
  const anon = client(srv.base);
  // signed out, a repo file and a missing one answer alike: nothing says which exist (review 3 Nov, S15)
  const hidden = await anon.get(`${srv.base}/src/assets/uploads/2026/10/draft.png`);
  const missing = await anon.get(`${srv.base}/src/assets/uploads/2026/10/no-such.png`);
  assert.deepEqual([hidden.status, hidden.text], [missing.status, missing.text]);
  assert.equal(hidden.status, 404);
  const writer = await as(srv, 'author');
  const r = await writer.get(`${srv.base}/src/assets/uploads/2026/10/draft.png`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-cache');
  // an SVG cannot run anything, even opened on its own
  const svg = await writer.get(`${srv.base}/src/assets/icon.svg`);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-security-policy'), /sandbox/);
  assert.match(svg.headers.get('content-security-policy'), /default-src 'none'/);
});

test('never HTML, scripts or data; never node_modules, dot-folders, links out or other methods', async () => {
  const c = await as(srv, 'owner');
  for (const p of ['/page.html', '/package.json', '/node_modules/pkg/x.png', '/.hidden/x.png', '/.git/HEAD', '/out/outside.png', '/src/assets/%2e%2e/%2e%2e/%2e%2e/etc/x.png', '/nope.png']) {
    assert.equal((await c.get(`${srv.base}${p}`)).status, 404, p);
  }
  assert.equal((await c.post(`${srv.base}/img/logo.png`, {})).status, 404);
});

test('the CMS host is never for search engines: noindex on every answer (production too) and a disallow-all robots.txt', async () => {
  const c = client(srv.base);
  const robots = await c.get(`${srv.base}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.equal(robots.text, 'User-agent: *\nDisallow: /\n');
  for (const p of ['/robots.txt', '/markstage/', '/fonts/site.woff2', '/markstage/api/auth/me', '/nope']) {
    assert.equal((await c.get(`${srv.base}${p}`)).headers.get('x-robots-tag'), 'noindex, nofollow', p);
  }
});
