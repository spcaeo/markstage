// The entry's last built page for the canvas on a server (preview/shell.mjs, docs/CANVAS-FIDELITY.md "On a server"):
// who may have it, which build it comes from, and what it never does: read a file outside the build folder, fetch
// anything by address (a stylesheet or an @import on another host), answer past its size limits, or serve the page
// as a page on the CMS origin. Also the sandboxed frame the page's first scripts run in, and the built site's fonts
// and images on the CMS origin for signed-in people only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { SHELL_LIMITS, sheetPaths } from '../src/preview/shell.mjs';
import { as, client, makeFixture, startServer } from './helpers.mjs';

let fx, srv, owner, hits, other, elsewhere;
const dist = (p = '') => path.join(fx.site, 'dist', p);
const put = (p, text) => {
  fs.mkdirSync(path.dirname(dist(p)), { recursive: true });
  fs.writeFileSync(dist(p), text);
};
const page = (head, body = '<article class="post"><div class="post__body"><p>Built.</p></div></article>') => `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const shell = (c, id, headers) => owner.get(`/preview/${c}/${id}/shell`, { headers });
// a file's time moved on, so it reads as newer than another (the cache and "newest" go by it)
const touch = (file, sec) => fs.utimesSync(file, new Date(Date.now() + sec * 1000), new Date(Date.now() + sec * 1000));

before(async () => {
  fx = makeFixture({ checks: false });
  srv = await startServer(fx, { overrides: { verify: { public: 'dist' } } });
  owner = await as(srv, 'owner');
  hits = [];
  other = http.createServer((req, res) => (hits.push(req.url), res.writeHead(200, { 'Content-Type': 'text/css' }).end('body{color:red}')));
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  elsewhere = `http://127.0.0.1:${other.address().port}`;
});
after(async () => {
  await srv.close();
  await new Promise((r) => other.close(r));
});

test('signed out: 401; a collection or an entry that is not there: 404', async () => {
  assert.equal((await client(srv.base).get('/preview/posts/hello-world/shell')).status, 401);
  for (const [c, id] of [['nope', 'hello-world'], ['posts', 'nope'], ['posts', '..%2Fpages%2Fabout']]) {
    const r = await shell(c, id);
    assert.equal(r.status, 404, `${c}/${id}`);
    assert.equal(r.json.error, 'not-found');
  }
});

test('no build of the entry yet: 404 not-built, in plain words', async () => {
  const r = await shell('posts', 'hello-world');
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not-built');
  assert.equal(r.json.message, 'The page around the text shows here after the site’s next build.');
});

test("the page's HTML and its own stylesheets of the same build, in order, as JSON; every role that may read it has it", async () => {
  put('_astro/a.css', '.post{max-width:40rem}');
  put('_astro/b.css', '.post__body p{margin:0}');
  put('blog/hello-world/index.html', page(`<link rel="stylesheet" href="/_astro/b.css"><style>h1{color:red}</style><link rel=stylesheet href="../../_astro/a.css?v=2#x">`));
  const r = await shell('posts', 'hello-world');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(r.json.from, 'site');
  assert.equal(r.json.path, '/blog/hello-world/');
  assert.equal(r.json.frame, '/markstage/shell-frame');
  assert.match(r.json.html, /<style>h1\{color:red\}<\/style>/);
  assert.deepEqual(r.json.sheets, [{ path: '/_astro/b.css', text: '.post__body p{margin:0}' }, { path: '/_astro/a.css', text: '.post{max-width:40rem}' }]);
  for (const role of ['contributor', 'author', 'editor']) assert.equal((await (await as(srv, role)).get('/preview/posts/hello-world/shell')).status, 200, role);
});

test('a repeat is a 304 (ETag); a changed stylesheet is a new answer', async () => {
  const r = await shell('posts', 'hello-world');
  const etag = r.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{40}"$/);
  // never kept on the browser's disk (a draft's HTML); the editor keeps it in memory and asks with If-None-Match
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(`"${r.json.etag}"`, etag, 'the version is in the answer too, for the editor');
  assert.equal((await shell('posts', 'hello-world', { 'If-None-Match': etag })).status, 304);
  put('_astro/a.css', '.post{max-width:41rem}');
  touch(dist('_astro/a.css'), 5);
  const again = await shell('posts', 'hello-world', { 'If-None-Match': etag });
  assert.equal(again.status, 200);
  assert.equal(again.json.sheets[1].text, '.post{max-width:41rem}');
});

test('no request leaves the server: a stylesheet or @import on another host, url() in the CSS', async () => {
  put('_astro/imports.css', `@import url(${elsewhere}/imported.css);\n@import "${elsewhere}/two.css";\n.x{background:url(${elsewhere}/bg.png)}`);
  put('blog/with-html/index.html', page(`<link rel="stylesheet" href="${elsewhere}/linked.css"><link rel="stylesheet" href="//127.0.0.1:${other.address().port}/scheme-less.css"><link rel="stylesheet" href="/_astro/imports.css">`));
  const r = await shell('posts', 'with-html');
  assert.equal(r.status, 200);
  // the CSS as it is (the editor drops @import and the CMS's CSP keeps url() on its own origin); nothing fetched
  assert.deepEqual(r.json.sheets.map((s) => s.path), ['/_astro/imports.css']);
  assert.match(r.json.sheets[0].text, /^@import url\(http:\/\/127\.0\.0\.1:\d+\/imported\.css\);/);
  await new Promise((res) => setTimeout(res, 100));
  assert.deepEqual(hits, []);
});

test('never a file outside the build folder: .., encoded .., links out of it, the repo, other types', async () => {
  fs.writeFileSync(path.join(fx.run, 'outside.css'), '.secret{color:red}');
  fs.mkdirSync(dist('_astro'), { recursive: true });
  fs.symlinkSync(path.join(fx.run, 'outside.css'), dist('_astro/linked-out.css'));
  put('data.json', '{"secret":1}');
  put('blog/carol-draft/index.html', page([
    '<link rel="stylesheet" href="/../outside.css">',
    '<link rel="stylesheet" href="/%2e%2e/outside.css">',
    '<link rel="stylesheet" href="/_astro/%2e%2e%2f%2e%2e%2foutside.css">',
    '<link rel="stylesheet" href="/_astro/linked-out.css">',
    '<link rel="stylesheet" href="/data.json">',
    '<link rel="stylesheet" href="/../../site/secret.txt">',
    '<link rel="stylesheet" href="file:///etc/hosts">',
  ].join('')));
  const r = await shell('posts', 'carol-draft');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.sheets, []);
  // the page itself: a link out of the build is not the entry's page
  fs.writeFileSync(path.join(fx.run, 'outside.html'), page(''));
  fs.mkdirSync(dist('blog/bob-draft'), { recursive: true });
  fs.symlinkSync(path.join(fx.run, 'outside.html'), dist('blog/bob-draft/index.html'));
  assert.equal((await shell('posts', 'bob-draft')).json.error, 'not-built');
});

test("an entry whose address leaves the site or the folder: no file is read", async () => {
  const about = (uri) => fs.writeFileSync(path.join(fx.site, 'src/content/pages/about.json'), JSON.stringify({ title: 'About', uri, sections: [] }, null, 2));
  fs.mkdirSync(path.join(fx.run, 'elsewhere'), { recursive: true });
  fs.writeFileSync(path.join(fx.run, 'elsewhere/index.html'), page(''));
  about('/../elsewhere/');
  assert.equal((await shell('pages', 'about')).json.error, 'not-built');
  about('/%2e%2e/elsewhere/');
  assert.equal((await shell('pages', 'about')).json.error, 'not-built');
  about('//evil.example/x/');
  assert.equal((await shell('pages', 'about')).status, 409);
  about('https://evil.example/x/');
  assert.equal((await shell('pages', 'about')).status, 409);
});

test('a redirect stub is not the page; size limits: a page too large is 413, a stylesheet too large or one too many is left out', async () => {
  put('blog/hello-world/index.html', '<!doctype html><meta http-equiv="refresh" content="0;url=/blog/elsewhere/">');
  assert.equal((await shell('posts', 'hello-world')).json.error, 'not-built');
  put('blog/hello-world/index.html', page(`<style>${'x'.repeat(SHELL_LIMITS.html)}</style>`));
  const big = await shell('posts', 'hello-world');
  assert.deepEqual([big.status, big.json.error], [413, 'too-large']);
  put('_astro/huge.css', `.h{}${' '.repeat(SHELL_LIMITS.sheet)}`);
  const links = Array.from({ length: SHELL_LIMITS.sheets + 5 }, (_, i) => (put(`_astro/n${i}.css`, `.n${i}{}`), `<link rel="stylesheet" href="/_astro/n${i}.css">`));
  put('blog/hello-world/index.html', page(`<link rel="stylesheet" href="/_astro/huge.css">${links.join('')}`));
  const r = await shell('posts', 'hello-world');
  assert.equal(r.status, 200);
  // the first 64 the page names are looked at (no further: a page full of links costs no more); of them the one too
  // large is left out
  assert.equal(r.json.sheets.length, SHELL_LIMITS.sheets - 1);
  assert.equal(r.json.sheets[0].path, '/_astro/n0.css', 'the one too large is left out');
});

test("the newest build has it: the site's, or the draft's preview build", async () => {
  put('blog/hello-world/index.html', page('<style>.site{}</style>'));
  const target = 'e_posts_hello-world';
  const draftDir = path.join(srv.app.releases.builds.dirOf(target), 'dist');
  fs.mkdirSync(path.join(draftDir, 'blog/hello-world'), { recursive: true });
  fs.writeFileSync(path.join(draftDir, 'blog/hello-world/index.html'), page('<style>.draft{}</style>'));
  const later = new Date(Date.now() + 60_000).toISOString();
  srv.app.db.prepare("INSERT INTO release_builds (target, key, status, build_time, built_at) VALUES (?, 'k', 'ready', ?, ?)").run(target, later, later);
  let r = await shell('posts', 'hello-world');
  assert.equal(r.json.from, 'draft');
  assert.match(r.json.html, /\.draft\{\}/);
  touch(dist('blog/hello-world/index.html'), 120);
  r = await shell('posts', 'hello-world');
  assert.equal(r.json.from, 'site');
  // a draft build being made again is not read meanwhile
  srv.app.db.prepare("UPDATE release_builds SET status = 'building', built_at = NULL WHERE target = ?").run(target);
  touch(path.join(draftDir, 'blog/hello-world/index.html'), 600);
  assert.equal((await shell('posts', 'hello-world')).json.from, 'site');
});

test('the stylesheets the page names, as the editor looks them up', () => {
  const html = `<link href="/a.css" rel="preload stylesheet"><LINK REL="StyleSheet" HREF='b.css?v=1'><link rel="alternate" href="/feed.xml"><link rel=stylesheet href="https://cdn.example/x.css"><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/c&amp;d.css">`;
  assert.deepEqual(sheetPaths(html, '/blog/x/'), ['/a.css', '/blog/x/b.css', '/c&d.css']);
});

test('the frame the first <head> scripts run in: sandboxed by its own header, framed by the editor only, nothing loaded', async () => {
  const r = await fetch(`${srv.base}/markstage/shell-frame`);
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  for (const part of ['sandbox allow-scripts', "default-src 'none'", "frame-ancestors 'self'", "base-uri 'none'"]) assert.ok(csp.includes(part), part);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.equal(r.headers.get('x-frame-options'), null);
  const html = await r.text();
  assert.match(html, /e\.source!==parent/);
  assert.equal((await fetch(`${srv.base}/markstage/shell-frame`, { method: 'POST' })).status, 405);
});

test("the built site's fonts and images on the CMS origin: signed-in people only, never its CSS, HTML or a link out", async () => {
  put('_astro/font.woff2', 'wOF2');
  put('_astro/pic.webp', 'RIFF');
  fs.symlinkSync(path.join(fx.run, 'outside.css'), dist('_astro/out.png'));
  const anon = client(srv.base);
  assert.equal((await anon.get(`${srv.base}/_astro/font.woff2`)).status, 404);
  const font = await owner.get(`${srv.base}/_astro/font.woff2`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal(font.headers.get('cache-control'), 'private, no-cache');
  assert.equal((await owner.get(`${srv.base}/_astro/pic.webp`)).status, 200);
  for (const p of ['/_astro/a.css', '/blog/hello-world/index.html', '/_astro/out.png']) assert.equal((await owner.get(`${srv.base}${p}`)).status, 404, p);
});

test('a server that does not know its build folder: not-built, saying so', async () => {
  const fx2 = makeFixture({ checks: false });
  const s2 = await startServer(fx2);
  try {
    const r = await (await as(s2, 'owner')).get('/preview/posts/hello-world/shell');
    assert.deepEqual([r.status, r.json.error], [404, 'not-built']);
    assert.match(r.json.message, /verify\.public/);
  } finally {
    await s2.close();
  }
});
