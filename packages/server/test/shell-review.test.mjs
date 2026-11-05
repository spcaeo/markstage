// The security review of the canvas's page route (preview/shell.mjs, 5 Nov 2026), each finding as a test that failed
// before its fix:
//   1. a page full of <link rel=stylesheet> must not stall the server (it was a scan of the list per link);
//   2. a page over the size limit is never read, not even to see whether it is a redirect stub (it was read whole on
//      every request); a stub check reads the file's head only, wherever it is made;
//   3. the answers kept in memory have a byte budget, not only a count;
//   4. (no-store: shell-page.test.mjs "a repeat is a 304")
// and the same kind of scan per item found elsewhere (the images of an imported page).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
// as namespaces: each test stands on its own (one that needs a helper the fix added fails alone without it)
import * as shell from '../src/preview/shell.mjs';
import * as verify from '../src/verify.mjs';
import { imagesOf, parseHtml } from '../src/library/html.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

let fx, srv, owner;
const dist = (p) => path.join(fx.site, 'dist', p);
const put = (p, text) => {
  fs.mkdirSync(path.dirname(dist(p)), { recursive: true });
  fs.writeFileSync(dist(p), text);
};

before(async () => {
  fx = makeFixture({ checks: false });
  srv = await startServer(fx, { overrides: { verify: { public: 'dist' } } });
  owner = await as(srv, 'owner');
});
after(() => srv.close());

/** Runs `fn` counting the characters fs.readFileSync returns for files whose path ends with `suffix`. */
async function readCount(suffix, fn) {
  const orig = fs.readFileSync;
  let chars = 0;
  fs.readFileSync = function (p, ...rest) {
    const out = orig.call(fs, p, ...rest);
    if (String(p).endsWith(suffix)) chars += out.length;
    return out;
  };
  try {
    await fn();
  } finally {
    fs.readFileSync = orig;
  }
  return chars;
}

test('1. 60,000 stylesheet links: at most 64 distinct .css paths, found in one quick pass', () => {
  let html = '<html><head>';
  for (let i = 0; i < 60_000; i++) html += `<link rel=stylesheet href=/${i}.css>`;
  const t = performance.now();
  const out = shell.sheetPaths(html, '/blog/x/');
  const ms = performance.now() - t;
  assert.equal(out.length, shell.SHELL_LIMITS.sheets);
  assert.deepEqual(out.slice(0, 2), ['/0.css', '/1.css']);
  assert.ok(ms < 500, `${Math.round(ms)} ms`);
  // the same link many times is one path; what is not a .css file is not counted
  assert.deepEqual(shell.sheetPaths('<link rel=stylesheet href=/a.css>'.repeat(50_000) + '<link rel=stylesheet href=/b.php><link rel=stylesheet href=/c.css>', '/'), ['/a.css', '/c.css']);
});

test('1. the route: a page with 60,000 links answers at once, with its first 64 stylesheets', async () => {
  for (let i = 0; i < 70; i++) put(`_astro/s${i}.css`, `.s${i}{}`);
  let links = '';
  for (let i = 0; i < 60_000; i++) links += `<link rel="stylesheet" href="/_astro/s${i}.css">`;
  put('blog/hello-world/index.html', `<!doctype html><html><head>${links}</head><body><article class="post"><div class="post__body"><p>x</p></div></article></body></html>`);
  const t = performance.now();
  const r = await owner.get('/preview/posts/hello-world/shell');
  assert.equal(r.status, 200);
  assert.equal(r.json.sheets.length, shell.SHELL_LIMITS.sheets);
  assert.ok(performance.now() - t < 1500, `${Math.round(performance.now() - t)} ms`);
});

test('2. a page over the limit is never read: 413, without one character of it read, again and again', async () => {
  put('blog/hello-world/index.html', `<!doctype html><html><body><div class="post__body">${'x'.repeat(shell.SHELL_LIMITS.html * 4)}</div></body></html>`);
  const chars = await readCount('hello-world/index.html', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await owner.get('/preview/posts/hello-world/shell');
      assert.deepEqual([r.status, r.json.error], [413, 'too-large']);
    }
  });
  assert.equal(chars, 0);
});

test('2. a redirect stub check reads the head of the file only, however large it is', async () => {
  const big = path.join(fx.run, 'big-stub.html');
  fs.writeFileSync(big, `<!doctype html><meta http-equiv="refresh" content="0;url=/elsewhere/">${' '.repeat(32 * 1024 * 1024)}`);
  const chars = await readCount('big-stub.html', () => assert.equal(verify.isRedirectStub(big), true));
  assert.equal(chars, 0, 'not read whole');
  assert.equal(verify.readHead(big).length, 4000);
  // a character cut at the end of what is read is no problem
  fs.writeFileSync(big, '€'.repeat(5000));
  assert.equal(verify.readHead(big), '€'.repeat(4000));
  fs.writeFileSync(big, '<p>short</p>');
  assert.equal(verify.isRedirectStub(big), false);
});

test('3. the answers kept in memory stay within their byte budget', async () => {
  const src = fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8');
  for (let i = 0; i < 12; i++) {
    fs.writeFileSync(path.join(fx.site, 'src/content/blog', `big-${i}.md`), src);
    // one character past Latin-1: the string takes two bytes a character in memory
    put(`blog/big-${i}/index.html`, `<!doctype html><html><body><div class="post__body">€${i}${'x'.repeat(3.9 * 1024 * 1024)}</div></body></html>`);
  }
  for (let i = 0; i < 12; i++) assert.equal((await owner.get(`/preview/posts/big-${i}/shell`)).status, 200, `big-${i}`);
  const { entries, bytes } = srv.app.shellPage.cacheStats();
  assert.ok(bytes <= shell.CACHE_BYTES, `${Math.round(bytes / 1024 / 1024)} MB kept`);
  assert.ok(entries >= 1 && entries < 12, `${entries} kept`);
  // the newest is kept: asked again with its version, a 304
  const last = await owner.get('/preview/posts/big-11/shell');
  assert.equal((await owner.get('/preview/posts/big-11/shell', { headers: { 'If-None-Match': last.headers.get('etag') } })).status, 304);
});

test('the same sweep: an imported page with very many images is read in one pass, each image once', () => {
  let html = '<article>';
  for (let i = 0; i < 60_000; i++) html += `<img src="https://img.example/${i}.png"><img src="https://img.example/${i}.png">`;
  const node = parseHtml(`${html}</article>`);
  const t = performance.now();
  const out = imagesOf(node, 'https://site.example/');
  assert.equal(out.length, 60_000);
  assert.ok(performance.now() - t < 1500, `${Math.round(performance.now() - t)} ms`);
});
