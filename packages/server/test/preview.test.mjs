// Preview render: its own origin, ticket sign-in (never in a URL), the caller's autosave in a private clone (never
// the content repo), per-viewer state serialized, the dev server proxied (HMR socket too), started on demand and
// stopped when idle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/app.mjs';
import { injectTag } from '../src/preview/agent.mjs';
import { createDevPaths } from '../src/preview/dev-paths.mjs';
import { createPreviewSite, relinkOutside } from '../src/preview/site.mjs';
import { as, freePort, makeFixture, startServer } from './helpers.mjs';

// stands in for `astro dev`: serves entry files from its working dir (the clone), echoes what it received
const FAKE_DEV = `import fs from 'node:fs';
import http from 'node:http';
const port = Number(process.argv[2]);
const server = http.createServer((req, res) => {
  const m = /^\\/blog\\/([a-z0-9-]+)\\/$/.exec(req.url);
  if (m) {
    const text = fs.readFileSync('src/content/blog/' + m[1] + '.md', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY' });
    return res.end('<!doctype html><pre>' + text + '</pre><script src="/app.js"></script>');
  }
  if (req.url === '/echo') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ headers: req.headers, port, preview: process.env.MARKSTAGE_PREVIEW ?? null, pid: process.pid, cwd: process.cwd() }));
  }
  if (req.url === '/app.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('console.log(1)');
  // a dev server's own tools and its file addresses (Vite /__open-in-editor, /@fs/, Astro's dev /_image)
  if (/^\\/(__|@fs\\/|_image)/.test(decodeURIComponent(req.url))) return res.writeHead(200).end('dev answered ' + req.url);
  if (req.url === '/head/') {
    const body = '<html><HEAD><title>t</title></HEAD><body>ü</body></html>';
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ETag: '"x"' }).end(body);
  }
  // breaks off mid-page, as a dev server that crashes would
  if (req.url === '/broken/') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': 1000 });
    res.write('<html><head>');
    return setTimeout(() => res.socket.destroy(), 20);
  }
  if (req.url === '/zipped/') return res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }).end('not really gzip');
  res.writeHead(req.url === '/' ? 200 : 404).end('home');
});
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n');
  socket.write('hello from dev ' + req.headers.host + ' cookie=' + (req.headers.cookie ?? ''));
});
server.listen(port, '127.0.0.1');
`;

const HTML = { Accept: 'text/html' };

describe('preview render', () => {
  let fx, srv, pOrigin, alice, ed, clock, lo;

  before(async () => {
    fx = makeFixture({ checks: false });
    const fake = path.join(fx.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    // an editor build with the preview agent in it
    const editorDir = path.join(fx.run, 'editor-dist');
    fs.mkdirSync(editorDir);
    fs.writeFileSync(path.join(editorDir, 'index.html'), '<!doctype html><title>editor</title>');
    fs.writeFileSync(path.join(editorDir, 'preview-agent.js'), '/* agent */');
    const pport = await freePort();
    lo = (await freePort()) | 1;
    pOrigin = `http://127.0.0.1:${pport}`;
    clock = { now: Date.now() };
    srv = await startServer(fx, {
      clock,
      overrides: { editorDir, preview: { origin: pOrigin, port: pport, command: [process.execPath, fake, '{port}'], ports: [lo, lo + 40], settleFile: null, settleMs: 50, idleMinutes: 5, warm: false } },
    });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  /** Follow the sign-in hand-off like a browser: preview origin -> CMS page -> ticket POST -> preview cookie. */
  async function signIn(c, to) {
    const first = await c.get(pOrigin + to, { headers: HTML });
    assert.equal(first.status, 303);
    const auth = new URL(first.headers.get('location'));
    assert.equal(auth.origin, srv.base, 'the hand-off goes through the CMS origin');
    const pg = await c.get(auth.href);
    assert.equal(pg.status, 200);
    const ticket = /name="ticket" value="([^"]+)"/.exec(pg.text)[1];
    const enter = await c.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ ticket }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(enter.status, 303);
    assert.equal(enter.headers.get('location'), to);
    return { pg, ticket };
  }

  const view = async (c, entry) => {
    const sel = await c.get(`${pOrigin}/markstage/preview/posts/${entry}/`, { headers: HTML });
    assert.equal(sel.status, 303);
    return c.get(pOrigin + sel.headers.get('location'), { headers: HTML });
  };

  test('config: the preview origin must not be the CMS origin or a site host', () => {
    const base = { env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: 18231 } };
    assert.throws(() => loadConfig({ ...base, overrides: { ...base.overrides, preview: { origin: 'http://127.0.0.1:18231' } } }), /must differ from publicOrigin/);
    assert.throws(() => loadConfig({ ...base, overrides: { ...base.overrides, preview: { origin: 'http://127.0.0.1:18245' }, protectedPages: { dir: '/tmp/x', hosts: ['127.0.0.1:18245'] } } }), /protectedPages\.hosts/);
    assert.throws(() => loadConfig({ ...base, env: { ...base.env, NODE_ENV: 'production' }, overrides: { ...base.overrides, publicOrigin: 'https://cms.example.com', preview: { origin: 'http://preview.example.com' } } }), /https/);
  });

  test('the API gives the preview URL on the preview origin', async () => {
    const r = await alice.get('/preview/posts/hello-world');
    assert.equal(r.status, 200);
    assert.equal(r.json.url, `${pOrigin}/markstage/preview/posts/hello-world/`);
    assert.equal((await alice.get('/preview/posts/no-such')).status, 404);
    // the editor page may frame the preview origin and talk to it (the screen check's fetch, QA F14)
    const csp = (await fetch(`${srv.base}/markstage/`)).headers.get('content-security-policy');
    assert.match(csp, new RegExp(`frame-src 'self' ${pOrigin}`));
    assert.match(csp, new RegExp(`connect-src 'self' ${pOrigin}`));
  });

  test('sign-in hand-off: CMS session required, ticket only in a form body, one use, CMS origin only', async () => {
    const anon = await fetch(`${srv.base}/markstage/preview-auth?to=/x/`, { redirect: 'manual' });
    assert.equal(anon.status, 401);
    const { pg, ticket } = await signIn(alice, '/markstage/preview/posts/hello-world/');
    const csp = pg.headers.get('content-security-policy');
    assert.match(csp, new RegExp(`form-action ${pOrigin}`));
    assert.match(csp, /frame-ancestors 'self'/);
    // a no-referrer page makes browsers post with `Origin: null`, which preview-enter refuses (found in Chromium)
    assert.equal(pg.headers.get('referrer-policy'), 'strict-origin');
    assert.match(pg.text, new RegExp(`action="${pOrigin}/markstage/preview-enter"`), 'ticket goes in the body, not the action URL');
    assert.match(pg.text, /name="to" value="\/markstage\/preview\/posts\/hello-world\/"/, 'the form carries `to`, so a repeat knows where to go without the ticket');
    // used once: the ticket is gone, but this browser holds the preview cookie by now, so a repeat of the post (a
    // frame reloaded after a cold first page, back, a second tab) still reaches the page
    const form = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
    const again = await alice.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ ticket, to: '/markstage/preview/posts/hello-world/' }).toString(), form);
    assert.equal(again.status, 303);
    assert.equal(again.headers.get('location'), '/markstage/preview/posts/hello-world/');
    assert.equal(again.headers.get('set-cookie'), null, 'no second preview cookie');
    // the same with Origin: null (a no-referrer page), with the cookie: the cookie path
    const nullOrigin = await alice.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ ticket, to: '/blog/hello-world/' }).toString(), { ...form, noOrigin: true, headers: { ...form.headers, Origin: 'null' } });
    assert.equal(nullOrigin.status, 303);
    assert.equal(nullOrigin.headers.get('location'), '/blog/hello-world/');
    assert.equal((await alice.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ to: '//evil.example/' }).toString(), form)).headers.get('location'), '/', 'an unsafe `to` goes to the root');
    // without the cookie the used ticket is a dead end, with one link that starts over (a fresh ticket from the CMS)
    const fresh = await as(srv, 'author');
    const dead = await fresh.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ ticket, to: '/markstage/preview/posts/hello-world/' }).toString(), form);
    assert.equal(dead.status, 403);
    assert.match(dead.text, /This preview link has expired/);
    assert.match(dead.text, new RegExp(`href="${srv.base}/markstage/preview-auth\\?to=%2Fmarkstage%2Fpreview%2Fposts%2Fhello-world%2F"`), 'the link to open the preview again');
    assert.match(dead.text, /Open the preview again/);
    assert.match(dead.text, /postMessage\(\{markstage:'preview-expired'\}/, 'the framed page tells the editor');
    assert.match(dead.headers.get('content-security-policy'), /script-src 'nonce-/);
    const noCookieNull = await fresh.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ ticket }).toString(), { ...form, noOrigin: true, headers: { ...form.headers, Origin: 'null' } });
    assert.equal(noCookieNull.status, 403);
    // a fresh ticket posted from another origin is refused
    const pg2 = await alice.get(`${srv.base}/markstage/preview-auth?to=/`);
    const t2 = /name="ticket" value="([^"]+)"/.exec(pg2.text)[1];
    const foreign = await fetch(`${pOrigin}/markstage/preview-enter`, { method: 'POST', redirect: 'manual', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket: t2 }) });
    assert.equal(foreign.status, 403);
    assert.doesNotMatch(await foreign.text(), /Open the preview again/, 'a foreign post gets no link');
    // ...and the ticket is still unused: the CMS's own page may still post it
    const own = await alice.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ ticket: t2 }).toString(), form);
    assert.equal(own.status, 303);
    // a foreign post with the cookie is refused as well (the cookie path takes the CMS and `null` only)
    const foreignCookie = await alice.post(`${pOrigin}/markstage/preview-enter`, new URLSearchParams({ to: '/' }).toString(), { ...form, noOrigin: true, headers: { ...form.headers, Origin: 'https://evil.example' } });
    assert.equal(foreignCookie.status, 403);
    assert.equal((await alice.get(`${srv.base}/markstage/preview-auth?to=//evil.example/`)).status, 400, 'only same-origin paths');
  });

  test("the viewer's autosave is rendered from the clone; the content repo is untouched", async () => {
    const e = await alice.get('/collections/posts/entries/hello-world');
    const before = fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8');
    const source = before.replace('First paragraph.', 'First paragraph, ALICE UNSAVED.');
    assert.equal((await alice.put('/collections/posts/entries/hello-world/autosave', { baseVersion: e.json.version, source })).status, 200);
    const r = await view(alice, 'hello-world');
    assert.equal(r.status, 200);
    assert.match(r.text, /ALICE UNSAVED/);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(r.headers.get('x-frame-options'), null, "the site's DENY is dropped; frame-ancestors decides");
    assert.match(r.headers.get('content-security-policy'), new RegExp(`frame-ancestors ${srv.base}`));
    assert.equal(fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8'), before);
    assert.equal(fx.git('status', '--porcelain'), '', 'content repo clean');
    assert.match(fs.readFileSync(path.join(srv.config.preview.dir, 'site/src/content/blog/hello-world.md'), 'utf8'), /ALICE UNSAVED/);
  });

  test('the dev server gets no Markstage cookies, a loopback Host, MARKSTAGE_PREVIEW=1, an odd port in range', async () => {
    const r = await alice.get(`${pOrigin}/echo`);
    assert.equal(r.status, 200);
    const { headers, port, preview, cwd } = r.json;
    assert.equal(headers.host, `127.0.0.1:${port}`);
    assert.ok(!/markstage/i.test(headers.cookie ?? ''), 'no session or preview cookie reaches site code');
    assert.equal(preview, '1');
    assert.ok(port % 2 === 1 && port >= lo && port <= lo + 40);
    assert.equal(fs.realpathSync(cwd), fs.realpathSync(path.join(srv.config.preview.dir, 'site')));
  });

  test('the preview host is never for search engines: a disallow-all robots.txt for anyone, noindex on every answer', async () => {
    const anon = await fetch(`${pOrigin}/robots.txt`);
    assert.equal(anon.status, 200);
    assert.equal(await anon.text(), 'User-agent: *\nDisallow: /\n');
    assert.equal(anon.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await fetch(`${pOrigin}/blog/hello-world/`, { redirect: 'manual' })).headers.get('x-robots-tag'), 'noindex, nofollow', 'the sign-in redirect');
    assert.equal((await alice.get(`${pOrigin}/echo`)).headers.get('x-robots-tag'), 'noindex, nofollow', 'a proxied answer');
  });

  test("Markstage's own addresses are never passed to the clone's dev server (its no-sign-in editor and API)", async () => {
    for (const p of ['/markstage', '/markstage/', '/markstage/api/auth/me', '/markstage/api/collections/posts/entries/hello-world']) {
      const r = await alice.get(`${pOrigin}${p}`);
      assert.equal(r.status, 404, p);
      assert.equal(r.json?.error, 'not-found', p);
    }
    assert.equal((await alice.put(`${pOrigin}/markstage/api/collections/posts/entries/hello-world`, { source: 'x' })).status, 404);
  });

  test("the dev server's own tools and files outside the site never reach it (S4); files of the site still do", async () => {
    const clone = path.join(srv.config.preview.dir, 'site');
    const reached = async (p) => {
      const r = await alice.get(`${pOrigin}${p}`);
      return r.text.startsWith('dev answered');
    };
    for (const p of [
      '/__open-in-editor?file=/etc/hosts',
      '/__open-in-editor/',
      '/%5F%5Fopen-in-editor?file=x',
      '/__inspect/',
      '/@fs/etc/hosts',
      `/@fs${fx.data}/markstage.db`,
      `/@fs${fx.site}/src/content/blog/hello-world.md`,
      `/@fs${clone}/../../../../../../etc/hosts`,
      '/%40fs/etc/hosts',
      '/_image?href=/@fs/etc/hosts&w=10&f=png',
      `/_image?href=${encodeURIComponent('/@fs/etc/hosts')}&w=10`,
      `/_image?href=${encodeURIComponent(encodeURIComponent('/@fs/etc/hosts'))}&w=10`,
      `/@fs${clone}/src/content/blog/hello-world.md?x=/@fs/etc/hosts`,
    ]) {
      assert.equal(await reached(p), false, p);
      assert.equal((await alice.get(`${pOrigin}${p}`)).status, 404, p);
    }
    // the site's own files by their /@fs/ address, and Astro's image endpoint for a picture of the site, still go
    assert.equal(await reached(`/@fs${clone}/src/content/blog/hello-world.md`), true);
    assert.equal(await reached(`/_image?href=/@fs${clone}/src/content/blog/hello-world.md&w=10`), true);
    assert.equal(await reached('/_image?href=/src/assets/x.png&w=10'), true);
  });

  test("two viewers: each sees their own state (serialized), then the first sees theirs again", async () => {
    await signIn(ed, '/markstage/preview/posts/hello-world/');
    const e = await ed.get('/collections/posts/entries/hello-world');
    await ed.put('/collections/posts/entries/hello-world/autosave', { baseVersion: e.json.version, source: e.json.version && fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8').replace('Second paragraph.', 'Second paragraph, EDITOR UNSAVED.') });
    const [a, b] = await Promise.all([view(alice, 'hello-world'), view(ed, 'hello-world')]);
    assert.match(a.text, /ALICE UNSAVED/);
    assert.doesNotMatch(a.text, /EDITOR UNSAVED/);
    assert.match(b.text, /EDITOR UNSAVED/);
    assert.doesNotMatch(b.text, /ALICE UNSAVED/);
    assert.match((await view(alice, 'hello-world')).text, /ALICE UNSAVED/);
  });

  test('an autosave refreshes the shown state (so HMR updates the frame)', async () => {
    await view(alice, 'hello-world');
    const e = await alice.get('/collections/posts/entries/hello-world');
    const source = fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8').replace('First paragraph.', 'First paragraph, ALICE TYPED MORE.');
    await alice.put('/collections/posts/entries/hello-world/autosave', { baseVersion: e.json.version, source });
    const file = path.join(srv.config.preview.dir, 'site/src/content/blog/hello-world.md');
    for (let i = 0; i < 40 && !/TYPED MORE/.test(fs.readFileSync(file, 'utf8')); i++) await new Promise((r) => setTimeout(r, 50));
    assert.match(fs.readFileSync(file, 'utf8'), /TYPED MORE/);
  });

  test('pushed state: shown by the preview, not stored as an autosave; a later autosave or the entry changing drops it', async () => {
    const clone = path.join(srv.config.preview.dir, 'site/src/content/blog/hello-world.md');
    const waitFor = async (re) => {
      for (let i = 0; i < 40 && !re.test(fs.readFileSync(clone, 'utf8')); i++) await new Promise((r) => setTimeout(r, 50));
      return fs.readFileSync(clone, 'utf8');
    };
    await view(alice, 'hello-world');
    const e = await alice.get('/collections/posts/entries/hello-world');
    const auto = (await alice.get('/collections/posts/entries/hello-world/autosave')).text;
    const base = fs.readFileSync(path.join(fx.site, 'src/content/blog/hello-world.md'), 'utf8');
    const push = (text, version = e.json.version, c = alice) => c.put('/preview/posts/hello-world/state', { baseVersion: version, source: base.replace('First paragraph.', text) });
    assert.equal((await push('First paragraph, PUSHED ONE.')).status, 200);
    assert.match(await waitFor(/PUSHED ONE/), /PUSHED ONE/, 'the frame updates (HMR) without an autosave');
    assert.match((await view(alice, 'hello-world')).text, /PUSHED ONE/);
    assert.equal((await alice.get('/collections/posts/entries/hello-world/autosave')).text, auto, 'the autosave is untouched');
    assert.equal((await push('x', 'stale')).status, 409);
    const unsafe = await alice.put('/preview/posts/hello-world/state', { baseVersion: e.json.version, frontmatter: { cover: { src: 'javascript:alert(1)' } } });
    assert.equal(unsafe.status, 422, 'unsafe links refused, as the preview does for an autosave');
    const bob = await as(srv, 'author', { authorSlug: 'bob' });
    assert.equal((await push('First paragraph, BOB.', e.json.version, bob)).status, 403, "only someone who may edit the entry");
    // a later autosave is newer: it wins
    await alice.put('/collections/posts/entries/hello-world/autosave', { baseVersion: e.json.version, source: base.replace('First paragraph.', 'First paragraph, AUTOSAVED AFTER.') });
    assert.match(await waitFor(/AUTOSAVED AFTER/), /AUTOSAVED AFTER/);
    // push again, then drop it: back to the autosave
    await push('First paragraph, PUSHED TWO.');
    await waitFor(/PUSHED TWO/);
    assert.equal((await alice.del('/preview/posts/hello-world/state')).status, 200);
    assert.match(await waitFor(/AUTOSAVED AFTER/), /AUTOSAVED AFTER/);
  });

  test('a published change reaches the clone (HEAD sync); an unsafe link shows a plain message', async () => {
    const e = await ed.get('/collections/posts/entries/bob-draft/source');
    assert.equal((await ed.put('/collections/posts/entries/bob-draft/source', { version: e.json.version, source: e.json.source.replace('A draft by Bob.', 'A draft by Bob, SAVED.') })).status, 200);
    assert.match((await view(ed, 'bob-draft')).text, /SAVED\./);
    const e2 = await ed.get('/collections/posts/entries/bob-draft/source');
    await ed.put('/collections/posts/entries/bob-draft/autosave', { baseVersion: e2.json.version, frontmatter: { cover: { src: 'javascript:alert(1)' } } });
    const bad = await view(ed, 'bob-draft');
    assert.equal(bad.status, 422);
    assert.match(bad.text, /cannot be previewed yet/);
  });

  test('HMR socket: viewers only, same origin only, proxied without Markstage cookies', async () => {
    await view(alice, 'hello-world');
    const cookieHeader = [...alice.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const ws = (headers) =>
      new Promise((resolve) => {
        const port = new URL(pOrigin).port;
        const s = net.connect(port, '127.0.0.1', () => {
          const lines = Object.entries({ Host: `127.0.0.1:${port}`, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': Buffer.from('the sample nonce').toString('base64'), 'Sec-WebSocket-Version': '13', ...headers }).map(([k, v]) => `${k}: ${v}`);
          s.write(`GET /?token=x HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
        });
        let got = '';
        s.on('data', (d) => {
          got += d;
          if (/hello from dev|\r\n\r\n$/.test(got)) setTimeout(() => (s.destroy(), resolve(got)), 50);
        });
        s.on('error', () => resolve(got));
      });
    assert.match(await ws({ Origin: pOrigin }), /^HTTP\/1.1 401/);
    assert.match(await ws({ Origin: 'https://evil.example', Cookie: cookieHeader }), /^HTTP\/1.1 403/);
    const ok = await ws({ Origin: pOrigin, Cookie: cookieHeader });
    assert.match(ok, /^HTTP\/1.1 101/);
    assert.match(ok, /hello from dev 127\.0\.0\.1:\d+ cookie=$/);
  });

  test('signing out of the CMS ends the preview cookie too', async () => {
    const c = await as(srv, 'contributor');
    await signIn(c, '/markstage/preview/posts/hello-world/');
    assert.equal((await c.get(`${pOrigin}/echo`)).status, 200);
    await c.post('/auth/logout', {});
    const r = await c.get(`${pOrigin}/blog/hello-world/`, { headers: HTML });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /\/markstage\/preview-auth\?to=/);
    assert.equal((await c.get(`${pOrigin}/echo`)).status, 401);
  });

  test('stopped when idle, started again on the next request', async () => {
    const pid = (await alice.get(`${pOrigin}/echo`)).json.pid;
    clock.now += 6 * 60_000;
    await srv.app.preview.site.checkIdle();
    assert.equal(srv.app.preview.site.running, false);
    assert.throws(() => process.kill(pid, 0), 'the dev server process is gone');
    const again = await alice.get(`${pOrigin}/echo`);
    assert.equal(again.status, 200);
    assert.notEqual(again.json.pid, pid);
    clock.now = Date.now();
  });

  test('preview.warm (the default): the dev server starts with Markstage, the home page is asked for once, and it never idles out', async () => {
    const fx2 = makeFixture({ checks: false });
    const fake = path.join(fx2.run, 'fake-dev.mjs');
    fs.writeFileSync(fake, FAKE_DEV);
    const pport = await freePort();
    const lo2 = (await freePort()) | 1;
    const clock2 = { now: Date.now() };
    const srv2 = await startServer(fx2, { clock: clock2, overrides: { preview: { origin: `http://127.0.0.1:${pport}`, port: pport, command: [process.execPath, fake, '{port}'], ports: [lo2, lo2 + 40], settleFile: null, settleMs: 50, idleMinutes: 1 } } });
    try {
      assert.equal(srv2.config.preview.warm, true);
      const seconds = await srv2.app.preview.warming;
      assert.equal(typeof seconds, 'number');
      assert.equal(srv2.app.preview.site.running, true, 'started without any page asked for');
      clock2.now += 10 * 60_000;
      await srv2.app.preview.site.checkIdle();
      assert.equal(srv2.app.preview.site.running, true, 'a warm preview is kept running');
    } finally {
      await srv2.close();
    }
    assert.equal(srv.app.preview.site.running, srv.app.preview.site.running, 'the first server is untouched');
    assert.equal(await srv.app.preview.warming, null, 'warm: false starts nothing');
  });

  test('every proxied page gets the agent, which names the CMS origins it may answer', async () => {
    const tag = `<script src="/markstage/preview-agent.js" data-cms="${srv.base}`;
    const page = await view(alice, 'hello-world');
    assert.ok(page.text.includes(tag), 'added to the page');
    assert.ok(page.text.endsWith('</script>'), 'no </head>: at the end');
    const head = await alice.get(`${pOrigin}/head/`, { headers: HTML });
    assert.match(head.text, /<\/title><script src="\/markstage\/preview-agent\.js"[^>]*async><\/script><\/HEAD>/, 'before </head>');
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(head.text), 'Content-Length matches the new body');
    assert.equal(head.headers.get('etag'), null, "the site's ETag no longer fits");
    // the dev server is asked for plain bodies; a compressed page, scripts and JSON pass through untouched
    assert.equal((await alice.get(`${pOrigin}/echo`)).json.headers['accept-encoding'], 'identity');
    assert.equal((await alice.get(`${pOrigin}/app.js`)).text, 'console.log(1)');
    const zipped = await new Promise((resolve, reject) => {
      const cookie = [...alice.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      http.get(`${pOrigin}/zipped/`, { headers: { ...HTML, Cookie: cookie } }, (r) => {
        let body = '';
        r.on('data', (d) => (body += d));
        r.on('end', () => resolve({ enc: r.headers['content-encoding'], body }));
      }).on('error', reject);
    });
    assert.deepEqual(zipped, { enc: 'gzip', body: 'not really gzip' }, 'a compressed page is passed through, not rewritten');
    const broken = await alice.get(`${pOrigin}/broken/`, { headers: HTML });
    assert.equal(broken.status, 502, 'a page cut off mid-way: a plain 502, no half page');
    // the agent itself: served from the preview origin, as a script
    const js = await fetch(`${pOrigin}/markstage/preview-agent.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /^text\/javascript/);
    assert.equal(await js.text(), '/* agent */');
  });

  test('injectTag: before </head>, else </body>, else at the end', () => {
    assert.equal(injectTag('<head></head><body></body>', 'X'), '<head>X</head><body></body>');
    assert.equal(injectTag('<p>a</p></BODY >', 'X'), '<p>a</p>X</BODY >');
    assert.equal(injectTag('<p>a</p>', 'X'), '<p>a</p>X');
  });

  test('a wrong Host on the preview listener is refused (DNS rebinding)', async () => {
    const port = new URL(pOrigin).port;
    const res = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => s.write('GET /echo HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n'));
      let got = '';
      s.on('data', (d) => (got += d));
      s.on('end', () => resolve(got));
    });
    assert.match(res, /^HTTP\/1.1 421/);
  });

  test('closing while the dev server is still starting leaves none behind (found by the e2e run hanging)', async () => {
    const pidFile = path.join(fx.run, 'race.pid');
    const fake = path.join(fx.run, 'fake-dev-pid.mjs');
    fs.writeFileSync(fake, `${FAKE_DEV}\nfs.writeFileSync(process.env.PIDFILE, String(process.pid));\n`);
    const lo2 = (await freePort()) | 1;
    const pv = { ...srv.app.config.preview, dir: path.join(fx.run, 'race'), ports: [lo2, lo2 + 20], command: [process.execPath, fake, '{port}'], env: { PIDFILE: pidFile } };
    const site = createPreviewSite({ ...srv.app, config: { ...srv.app.config, preview: pv } });
    const starting = site.start();
    await site.close();
    await assert.rejects(starting, /shut down/);
    await assert.rejects(site.start(), /shut down/);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(alive(), false, 'the dev server that came up after close was stopped');
  });
});

describe('preview: off and dev mode', () => {
  test('not configured: the API says so', async () => {
    const fx = makeFixture({ checks: false });
    const srv = await startServer(fx);
    try {
      const c = await as(srv, 'editor');
      const r = await c.get('/preview/posts/hello-world');
      assert.equal(r.status, 404);
      assert.match(r.json.message, /not set up/);
    } finally {
      await srv.close();
    }
  });

  test("dev mode: the site's own dev server URL", async () => {
    const fx = makeFixture({ checks: false });
    const srv = await startServer(fx, { env: { MARKSTAGE_DEV_NO_AUTH: '1' }, overrides: { host: '127.0.0.1', preview: { devServer: 'http://127.0.0.1:4323' } } });
    try {
      const r = await fetch(`${srv.base}/markstage/api/preview/posts/hello-world`);
      assert.deepEqual(await r.json(), { url: 'http://127.0.0.1:4323/blog/hello-world/', devServer: true });
    } finally {
      await srv.close();
    }
  });
});

test('relinkOutside: a package linked from outside node_modules by a relative link points at the same folder from the copy', () => {
  const run = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ms-relink-'));
  const from = path.join(run, 'site', 'node_modules');
  fs.mkdirSync(path.join(run, 'tool', 'packages', 'astro'), { recursive: true });
  fs.mkdirSync(path.join(from, '@tool'), { recursive: true });
  fs.mkdirSync(path.join(from, 'plain'), { recursive: true });
  fs.mkdirSync(path.join(from, '.bin'), { recursive: true });
  // npm's file: link (relative, out of node_modules), a link inside node_modules, an absolute link
  fs.symlinkSync('../../../tool/packages/astro', path.join(from, '@tool', 'astro'));
  fs.symlinkSync('../plain', path.join(from, '.bin', 'plain'));
  fs.symlinkSync(path.join(run, 'tool'), path.join(from, 'abs'));
  const to = path.join(run, 'data', 'preview', 'site', 'node_modules');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  assert.equal(fs.existsSync(path.join(to, '@tool', 'astro')), false, 'broken before');
  relinkOutside(from, to);
  assert.equal(fs.readlinkSync(path.join(to, '@tool', 'astro')), path.join(run, 'tool', 'packages', 'astro'));
  assert.ok(fs.existsSync(path.join(to, '@tool', 'astro')));
  assert.equal(fs.readlinkSync(path.join(to, '.bin', 'plain')), '../plain', 'links inside stay relative');
  assert.equal(fs.readlinkSync(path.join(to, 'abs')), path.join(run, 'tool'));
  fs.rmSync(run, { recursive: true, force: true });
});

test('dev-paths: /@fs/ reaches a package linked from outside and the node_modules it resolves from, nothing else (S4)', () => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-devpaths-')));
  try {
    const site = path.join(top, 'site');
    const pkg = path.join(top, 'tools/packages/astro');
    for (const d of [path.join(site, 'node_modules/@x'), path.join(site, 'src'), path.join(pkg, 'src'), path.join(top, 'tools/node_modules/yaml')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(site, 'src/page.astro'), 'x');
    fs.writeFileSync(path.join(pkg, 'src/client.mjs'), 'x');
    fs.writeFileSync(path.join(top, 'tools/node_modules/yaml/index.js'), 'x');
    fs.writeFileSync(path.join(top, 'tools/secret.env'), 'x');
    fs.symlinkSync('../../../tools/packages/astro', path.join(site, 'node_modules/@x/astro'));
    // a link inside the site to a file outside it does not make that file the site's
    fs.symlinkSync(path.join(top, 'tools/secret.env'), path.join(site, 'src/leak.env'));
    const { refusal } = createDevPaths(site);
    const at = (p) => refusal(new URL(`http://x${p}`));
    assert.equal(at(`/@fs${site}/src/page.astro`), null);
    assert.equal(at(`/@fs${pkg}/src/client.mjs?v=1`), null, 'the linked package');
    assert.equal(at(`/@fs${top}/tools/node_modules/yaml/index.js`), null, 'its own dependency');
    assert.equal(at(`/@fs${top}/tools/secret.env`), 'outside-site');
    assert.equal(at(`/@fs${site}/src/leak.env`), 'outside-site', 'a link out of the site is followed, then refused');
    assert.equal(at(`/@fs${site}/src/missing.astro`), 'outside-site', 'only a file that exists');
    assert.equal(at('/@fs/etc/hosts'), 'outside-site');
    assert.equal(at('/__open-in-editor?file=src/page.astro'), 'dev-only');
    assert.equal(at('/src/page.astro'), null, 'the dev server’s own paths go on');
  } finally {
    fs.rmSync(top, { recursive: true, force: true });
  }
});
