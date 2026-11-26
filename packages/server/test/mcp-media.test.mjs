// The MCP server's picture tool (docs/API-MCP.md "Pictures"): an AI agent adds a picture, from a web address or its
// bytes in base64, with alt text, through the editor's own upload routes. The scope (mcp:draft), a good PNG (bytes,
// a data: URL and an address), what is refused in words (no alt text, a file that is not a picture, an SVG, a PDF,
// an address into the server's own network or one that redirects there, over the size limit, the request's own
// limit), the roles (a contributor's agent uploads its bytes, and neither fetches nor adds to a release), a picture
// that waits in a release and goes live with the entry that uses it, in the release's one commit, and a site whose
// media folder is served as it is (public/), where an agent's picture always waits in a release. Test
// people, tokens and pictures are made here; the web site the server fetches from is on loopback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { as, makePng, readFile } from './helpers.mjs';
import { releaseServer } from './release-site.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';
import { startWebSite } from './web-site.mjs';

describe('the MCP picture tool', () => {
  let fx, srv, clock, web, ed, carol, reader, agent, carolAgent;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const audits = (action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
  const b64 = (buf) => buf.toString('base64');
  const uploads = () => {
    const dir = path.join(fx.site, 'src/assets/uploads');
    const out = [];
    const walk = (d) => fs.existsSync(d) && fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.relative(fx.site, path.join(d, e.name)))));
    walk(dir);
    return out.sort();
  };
  /** Nothing new in the repo or the media folder since `start`. */
  const nothingWritten = (start, files) => {
    assert.equal(head(), start);
    assert.deepEqual(uploads(), files);
  };

  before(async () => {
    const big = Buffer.concat([makePng(), Buffer.alloc(80 * 1024)]);
    web = await startWebSite({
      '/pics/team-photo.png': { type: 'image/png', body: makePng() },
      '/pics/page.html': { type: 'text/html', body: '<!doctype html><title>Not a picture</title><p>Hello</p>' },
      '/pics/huge.png': { type: 'image/png', body: big },
      '/pics/to-metadata': { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } },
    });
    ({ fx, srv, clock } = await releaseServer({ outbound: web.outbound }));
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
    reader = mcpClient(srv.base, await mcpToken(ed, ['mcp:read'], 'Reader'));
    agent = mcpClient(srv.base, await mcpToken(ed, ['mcp:draft'], 'Picture bot'));
    carolAgent = mcpClient(srv.base, await mcpToken(carol, ['mcp:draft'], 'Carol bot'));
  });
  // each test in a minute of its own: the agent's 30 changes a minute (index.mjs) count refusals too
  beforeEach(() => {
    if (clock) clock.now += 61_000;
  });
  after(async () => {
    await srv?.close();
    await web?.close();
  });

  test('the scope: listed with mcp:draft only, and a reading token is told why', async () => {
    const tools = (await agent.rpc('tools/list')).json.result.tools;
    const t = tools.find((x) => x.name === 'add_image');
    assert.ok(t, 'add_image is listed for mcp:draft');
    assert.deepEqual(t.inputSchema.required, ['alt']);
    assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['alt', 'collection', 'data', 'filename', 'release', 'url']);
    assert.deepEqual([t.annotations.readOnlyHint, t.annotations.destructiveHint], [false, false]);
    assert.equal((await reader.rpc('tools/list')).json.result.tools.some((x) => x.name === 'add_image'), false);
    const start = head();
    const files = uploads();
    const refused = await reader.tool('add_image', { alt: 'A rhino', data: b64(makePng()) });
    assert.equal(refused.ok, false);
    assert.match(refused.rpcError.message, /"add_image" changes content, and this token can only read \(mcp:read\)\. Ask for a token with mcp:draft\./);
    nothingWritten(start, files);
    assert.match((await agent.tool('site_info')).data.rules.join(' '), /add_image adds a picture, with alt text/);
    assert.doesNotMatch((await reader.tool('site_info')).data.rules.join(' '), /add_image/);
  });

  test('a good PNG in base64: through the editor’s upload (re-encoded, named, indexed, committed naming the agent), with what to write in an entry', async () => {
    const calls = srv.app.codec.calls;
    const out = await agent.tool('add_image', { alt: 'A rhino on the grass', data: b64(makePng()), filename: 'Rhino Field.PNG' });
    assert.equal(out.ok, true, out.text);
    const d = out.data;
    assert.equal(d.added, true);
    assert.equal(d.path, 'src/assets/uploads/2026/11/rhino-field.png');
    assert.equal(d.url, '/uploads/2026/11/rhino-field.png');
    assert.deepEqual([d.type, d.width, d.height, d.alt, d.release], ['image/png', 2, 2, 'A rhino on the grass', null]);
    assert.match(d.media, /^m_/);
    // re-encoded by the codec, as an upload is
    assert.equal(srv.app.codec.calls, calls + 1);
    assert.deepEqual(fs.readFileSync(path.join(fx.site, d.path)), makePng());
    // what the editor writes: the field's path inside the media folder, the Markdown's relative to the collection's folder
    assert.equal(d.use.field, '2026/11/rhino-field.png');
    assert.deepEqual(d.use.markdown, { posts: '![A rhino on the grass](../../assets/uploads/2026/11/rhino-field.png)' });
    // committed as the person, naming the agent; in the media library with its alt text; audited via MCP
    assert.equal(fx.git('log', '-1', '--format=%s|%an').trim(), `Upload src/assets/uploads/2026/11/rhino-field.png (an AI agent, via MCP: Picture bot)|${ed.user.email.split('@')[0]}`);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
    const row = (await ed.get(`/media/${d.media}`)).json;
    assert.deepEqual([row.path, row.alt, row.uploadedBy], [d.path, 'A rhino on the grass', srv.app.db.prepare('SELECT id FROM users WHERE email = ?').get(ed.user.email).id]);
    assert.equal(row.credit, null, 'bytes came from no address');
    const up = audits('media.upload').at(-1);
    assert.deepEqual([up.target, JSON.parse(up.detail).via, JSON.parse(up.detail).token], [d.media, 'mcp', 'Picture bot']);
    // the agent then uses it in a draft, as the answer says
    const e = (await agent.tool('get_entry', { collection: 'posts', id: 'bob-draft' })).data;
    const source = e.source.replace('A draft by Bob.', `A draft by Bob.\n\n${d.use.markdown.posts}`);
    const saved = await agent.tool('update_entry', { collection: 'posts', id: 'bob-draft', version: e.version, source });
    assert.equal(saved.ok, true, saved.text);
    assert.match(readFile(fx, 'src/content/blog/bob-draft.md'), /!\[A rhino on the grass\]\(\.\.\/\.\.\/assets\/uploads\/2026\/11\/rhino-field\.png\)/);
    // the editor's media library sees it used there
    assert.deepEqual((await ed.get(`/media/${d.media}`)).json.usedBy.map((u) => u.id ?? u.entryId ?? u), ['bob-draft']);
  });

  test('a data: URL, a name from the alt text, and the same name twice (the second gets -2)', async () => {
    const a = await agent.tool('add_image', { alt: 'Team at the whiteboard, planning', data: `data:image/png;base64,${b64(makePng())}` });
    assert.equal(a.ok, true, a.text);
    assert.equal(a.data.path, 'src/assets/uploads/2026/11/team-at-the-whiteboard-planning.png');
    const b = await agent.tool('add_image', { alt: 'Team at the whiteboard, planning', data: b64(makePng()), collection: 'posts' });
    assert.equal(b.data.path, 'src/assets/uploads/2026/11/team-at-the-whiteboard-planning-2.png');
    assert.deepEqual(Object.keys(b.data.use.markdown), ['posts']);
    // a page collection (JSON) has no Markdown: the field value only
    const p = await agent.tool('add_image', { alt: 'About hero', data: b64(makePng()), collection: 'pages' });
    assert.deepEqual(p.data.use, { field: '2026/11/about-hero.png', markdown: {} });
    // brackets in the alt text are escaped in the Markdown
    const br = await agent.tool('add_image', { alt: 'Chart [2026] of \\ growth', data: b64(makePng()), collection: 'posts' });
    assert.equal(br.data.use.markdown.posts, '![Chart \\[2026\\] of \\\\ growth](../../assets/uploads/2026/11/chart-2026-of-growth.png)');
  });

  test('from a web address: fetched through the guard, named after the address', async () => {
    const out = await agent.tool('add_image', { alt: 'The team', url: `${web.base}/pics/team-photo.png` });
    assert.equal(out.ok, true, out.text);
    assert.equal(out.data.path, 'src/assets/uploads/2026/11/team-photo.png');
    assert.ok(web.hits.includes('/pics/team-photo.png'));
    // the address it came from is kept with it, to check its licence later
    const host = new URL(web.base).host;
    assert.deepEqual((await ed.get(`/media/${out.data.media}`)).json.credit, { provider: 'web', label: host, sourceUrl: `${web.base}/pics/team-photo.png` });
    assert.ok(web.calls.filter((c) => c.url.startsWith('/pics/')).every((c) => c.method === 'GET'));
  });

  test('refused in words, nothing written: no alt text, not one source, not a picture, an SVG, a PDF, a page', async () => {
    const start = head();
    const files = uploads();
    const png = b64(makePng());
    const cases = [
      [{ data: png }, /add_image needs "alt"\./],
      [{ alt: '', data: png }, /add_image needs "alt"\./],
      [{ alt: '   ', data: png }, /Give the picture alt text: a few words on what it shows/],
      [{ alt: 'x'.repeat(501), data: png }, /Alt text is up to 500 characters\./],
      [{ alt: 'Both', data: png, url: `${web.base}/pics/team-photo.png` }, /Send the picture once: its web address in "url", or its bytes in base64 in "data"\./],
      [{ alt: 'Neither' }, /Send the picture once/],
      [{ alt: 'Not base64', data: 'this is not base64!' }, /"data" is not base64\./],
      [{ alt: 'Text', data: b64(Buffer.from('Just some words, not a picture at all.')) }, /This is not a picture\. add_image takes JPEG, PNG, GIF, WebP, AVIF or an iPhone HEIC\./],
      [{ alt: 'Script', data: b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')) }, /SVG files are not accepted \(they can carry scripts\)/],
      [{ alt: 'A brochure', data: b64(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')) }, /This is a PDF document, not a picture\./],
      [{ alt: 'A page', url: `${web.base}/pics/page.html` }, /What this address sends is not a picture\./],
      [{ alt: 'Mine', data: png, collection: 'nope' }, /No collection "nope"/],
      [{ alt: 'Extra', data: png, from: 'm_1' }, /add_image takes no "from"/],
    ];
    for (const [args, words] of cases) {
      const r = await agent.tool('add_image', args);
      assert.equal(r.ok, false, JSON.stringify(args).slice(0, 80));
      assert.match(r.text, words, JSON.stringify(args).slice(0, 80));
    }
    nothingWritten(start, files);
  });

  test('an address into the server’s own network is refused before anything is sent (127.0.0.1, 169.254.169.254, localhost, a redirect there)', async () => {
    const start = head();
    const files = uploads();
    const hits = web.hits.length;
    for (const url of ['http://127.0.0.1/secret.png', `http://127.0.0.1:${web.port + 1}/x.png`, 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/x.png', 'http://localhost/x.png', 'http://10.0.0.5/x.png', 'file:///etc/passwd', 'https://user:pw@example.test/x.png']) {
      const r = await agent.tool('add_image', { alt: 'Sneaky', url });
      assert.equal(r.ok, false, url);
      assert.equal(r.data.error, 'unsafe-url', `${url}: ${r.text}`);
      assert.match(r.text, /not on the public internet|Only http and https|name and password|usual ports/, url);
    }
    assert.equal(web.hits.length, hits, 'nothing on loopback was asked');
    // a public-looking start that redirects into the network: each hop is checked again
    const r = await agent.tool('add_image', { alt: 'Sneaky', url: `${web.base}/pics/to-metadata` });
    assert.equal(r.ok, false);
    assert.match(r.text, /cannot be read|not on the public internet/);
    nothingWritten(start, files);
  });

  test('the size limit: bytes over it and an address that sends more are refused in words; a request past the raised limit is 413, and a reading token keeps the usual one', async () => {
    const start = head();
    const files = uploads();
    const max = srv.config.media.maxBytes;
    const over = Buffer.concat([makePng(), Buffer.alloc(max)]);
    const r = await agent.tool('add_image', { alt: 'Too big', data: b64(over) });
    assert.equal(r.ok, false);
    assert.equal(r.data.status, 413);
    assert.match(r.text, new RegExp(`This file is ${Math.ceil(over.length / 1024)} KB; the limit is ${max / 1024} KB\\. Export it smaller`));
    const f = await agent.tool('add_image', { alt: 'Too big', url: `${web.base}/pics/huge.png` });
    assert.equal(f.ok, false);
    assert.match(f.text, new RegExp(`sends more than ${max / 1024} KB, so it is not fetched`));
    // past what a picture at the limit takes in base64: the request itself is refused before any tool runs
    const limit = srv.app.mcp.bodyBytes({ token: { scopes: ['mcp:read', 'mcp:draft'] } });
    assert.equal(limit, Math.max(srv.config.maxBodyBytes, Math.ceil(max / 3) * 4 + 256 * 1024));
    const huge = await agent.rpc('tools/call', { name: 'add_image', arguments: { alt: 'Huge', data: 'A'.repeat(limit + 1) } });
    assert.equal(huge.status, 413);
    // a reading token never gets the larger limit
    assert.equal(srv.app.mcp.bodyBytes({ token: { scopes: ['mcp:read'] } }), srv.config.maxBodyBytes);
    const big = await reader.rpc('tools/call', { name: 'get_entry', arguments: { collection: 'posts', id: 'x', pad: 'A'.repeat(srv.config.maxBodyBytes + 1) } });
    assert.equal(big.status, 413);
    nothingWritten(start, files);
  });

  test('a contributor’s agent: uploads its bytes as the editor lets it; neither fetches an address (an import) nor adds to a release', async () => {
    const ok = await carolAgent.tool('add_image', { alt: 'Carol’s sketch', data: b64(makePng()) });
    assert.equal(ok.ok, true, ok.text);
    assert.match(fx.git('log', '-1', '--format=%s').trim(), /\(an AI agent, via MCP: Carol bot\)$/);
    const start = head();
    const files = uploads();
    const hits = web.hits.length;
    const url = await carolAgent.tool('add_image', { alt: 'From the web', url: `${web.base}/pics/team-photo.png` });
    assert.deepEqual([url.ok, url.data.status], [false, 403]);
    assert.match(url.text, /Fetching a picture from a web address is an import, and your role cannot import media\. Send the picture’s bytes/);
    assert.equal(web.hits.length, hits);
    const r = (await ed.post('/releases', { name: 'Carol’s try' })).json;
    const rel = await carolAgent.tool('add_image', { alt: 'Into a release', data: b64(makePng()), release: r.id });
    assert.deepEqual([rel.ok, rel.data.status], [false, 403]);
    assert.match(rel.text, /a contributor puts nothing into a release/);
    assert.equal((await ed.get(`/releases/${r.id}`)).json.counts.items, 0);
    nothingWritten(start, files);
  });

  test('with a release: nothing in the repo; it waits in the release (counted as media) and goes live with the entry that uses it, in one commit', async () => {
    const r = (await ed.post('/releases', { name: 'Spring refresh' })).json;
    const start = head();
    const files = uploads();
    const out = await agent.tool('add_image', { alt: 'A new hero', data: b64(makePng()), filename: 'spring-hero.png', release: r.id });
    assert.equal(out.ok, true, out.text);
    const d = out.data;
    assert.equal(d.path, 'src/assets/uploads/2026/11/spring-hero.png');
    assert.equal(d.media, null);
    assert.deepEqual([d.release.id, d.release.status, d.release.counts], [r.id, 'open', { items: 1, entries: 0, library: 0, media: 1 }]);
    assert.match(d.note, /waits in the release “Spring refresh” and is not on the site yet/);
    // nothing written: no commit, no file, no media row yet
    nothingWritten(start, files);
    assert.equal(fs.existsSync(path.join(fx.site, d.path)), false);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM media WHERE path = ?').get(d.path).n, 0);
    // an upload meanwhile takes another name: the release keeps its own
    const other = await agent.tool('add_image', { alt: 'Another', data: b64(makePng()), filename: 'spring-hero.png' });
    assert.equal(other.data.path, 'src/assets/uploads/2026/11/spring-hero-2.png');
    // the agent's get_release counts it, and the live page's change that uses it joins the same release
    const seen = (await agent.tool('get_release', { id: r.id })).data;
    assert.deepEqual(seen.counts, { items: 1, entries: 0, library: 0, media: 1 });
    assert.deepEqual(seen.items.map((i) => [i.kind, i.path, i.alt]), [['media', d.path, 'A new hero']]);
    const e = (await agent.tool('get_entry', { collection: 'posts', id: 'hello-world' })).data;
    const source = e.source.replace('First paragraph.', `First paragraph.\n\n${d.use.markdown.posts}`);
    const add = await agent.tool('add_to_release', { release: r.id, collection: 'posts', id: 'hello-world', version: e.version, source });
    assert.equal(add.ok, true, add.text);
    const view = (await ed.get(`/releases/${r.id}`)).json;
    assert.deepEqual(view.counts, { items: 2, entries: 1, library: 0, media: 1 });
    assert.equal(view.decision.effect, 'allow', view.decision.words);
    // a person publishes: the picture and the page go live together, in the release's one commit
    const beforePublish = head();
    const p = await ed.post(`/releases/${r.id}/publish`, { version: view.version });
    assert.equal(p.status, 202, JSON.stringify(p.json));
    await srv.app.jobs.idle();
    const done = (await ed.get(`/releases/${r.id}`)).json;
    assert.equal(done.status, 'published', done.error);
    assert.equal(fx.git('rev-list', '--count', `${beforePublish}..HEAD`).trim(), '1');
    assert.deepEqual(fx.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(), [d.path, 'src/content/blog/hello-world.md'].sort());
    assert.ok(fs.existsSync(path.join(fx.live, 'uploads/2026/11/spring-hero.png')), 'the picture is live');
    assert.match(fs.readFileSync(path.join(fx.live, 'blog/hello-world/index.html'), 'utf8'), /spring-hero\.png/);
    // now in the media library, with its alt text and the person as its uploader, used by the page
    const row = (await ed.get('/media')).json.items.find((m) => m.path === d.path);
    assert.equal(row.alt, 'A new hero');
    assert.deepEqual((await ed.get(`/media/${row.id}`)).json.usedBy.map((u) => u.id ?? u.entryId ?? u), ['hello-world']);
    // the release's audit names both of the agent's items
    const pub = JSON.parse(audits('release.publish').at(-1).detail);
    assert.deepEqual(pub.mcpItems.map((i) => [i.rel, i.token]).sort(), [[d.path, 'Picture bot'], ['src/content/blog/hello-world.md', 'Picture bot']].sort());
  });

  test('from a web address into a release: the address is kept with the picture when the release goes live', async () => {
    const r = (await ed.post('/releases', { name: 'Fetched picture' })).json;
    const out = await agent.tool('add_image', { alt: 'Fetched for a release', url: `${web.base}/pics/team-photo.png`, release: r.id });
    assert.equal(out.ok, true, out.text);
    const e = (await agent.tool('get_entry', { collection: 'posts', id: 'hello-world' })).data;
    const add = await agent.tool('add_to_release', { release: r.id, collection: 'posts', id: 'hello-world', version: e.version, source: e.source.replace('First paragraph.', `First paragraph.\n\n${out.data.use.markdown.posts}`) });
    assert.equal(add.ok, true, add.text);
    const view = (await ed.get(`/releases/${r.id}`)).json;
    assert.equal((await ed.post(`/releases/${r.id}/publish`, { version: view.version })).status, 202);
    await srv.app.jobs.idle();
    assert.equal((await ed.get(`/releases/${r.id}`)).json.status, 'published');
    const row = (await ed.get('/media')).json.items.find((m) => m.path === out.data.path);
    assert.deepEqual((await ed.get(`/media/${row.id}`)).json.credit, { provider: 'web', label: new URL(web.base).host, sourceUrl: `${web.base}/pics/team-photo.png` });
  });

  test('a site whose media folder is served as it is (public/): an agent’s picture waits in a release, never straight in the folder', async () => {
    const other = await releaseServer({ overrides: { media: { dir: 'public/uploads', url: '/uploads/{path}', maxBytes: 64 * 1024 } } });
    try {
      const pe = await as(other.srv, 'editor', { authorSlug: 'alice' });
      const bot = mcpClient(other.srv.base, await mcpToken(pe, ['mcp:draft'], 'Public bot'));
      const start = other.fx.git('rev-parse', 'HEAD').trim();
      const now = await bot.tool('add_image', { alt: 'Straight in', data: b64(makePng()) });
      assert.deepEqual([now.ok, now.data.status, now.data.error], [false, 409, 'served-as-is']);
      assert.match(now.text, /every file in the media folder is put on the site as it is at the next build, used or not, so a picture an AI agent adds waits in a release instead/);
      assert.equal(other.fx.git('rev-parse', 'HEAD').trim(), start);
      assert.equal(fs.existsSync(path.join(other.fx.site, 'public/uploads')), false);
      const r = (await pe.post('/releases', { name: 'Public pictures' })).json;
      const held = await bot.tool('add_image', { alt: 'In a release', data: b64(makePng()), filename: 'held.png', release: r.id, collection: 'posts' });
      assert.equal(held.ok, true, held.text);
      // under public/ the entry names it by its site path, as the editor writes it
      assert.deepEqual([held.data.path, held.data.use.field, held.data.use.markdown.posts], ['public/uploads/2026/11/held.png', '/uploads/2026/11/held.png', '![In a release](/uploads/2026/11/held.png)']);
      assert.equal(other.fx.git('rev-parse', 'HEAD').trim(), start);
    } finally {
      await other.srv.close();
    }
  });

  test('a scheduled release takes no picture from an agent, nor does a missing one', async () => {
    const r = (await ed.post('/releases', { name: 'Later' })).json;
    const e = (await ed.get('/collections/posts/entries/with-html')).json;
    const src = readFile(fx, 'src/content/blog/with-html.md').replace('Intro.', 'Intro, later.');
    const added = await ed.post(`/releases/${r.id}/items`, { kind: 'entry', collection: 'posts', id: 'with-html', version: e.version, source: src });
    assert.equal(added.status, 201, added.text);
    const sch = await ed.post(`/releases/${r.id}/schedule`, { version: added.json.release.version, publishAt: '2026-12-01T09:00:00.000Z' });
    assert.equal(sch.status, 200, sch.text);
    const start = head();
    const files = uploads();
    const out = await agent.tool('add_image', { alt: 'Late', data: b64(makePng()), release: r.id });
    assert.deepEqual([out.ok, out.data.status, out.data.error], [false, 409, 'scheduled']);
    assert.match(out.text, /“Later” is scheduled: it goes live by itself at its time, so an AI agent cannot add to it/);
    assert.equal((await ed.get(`/releases/${r.id}`)).json.counts.media, 0);
    const none = await agent.tool('add_image', { alt: 'Nowhere', data: b64(makePng()), release: 'rl_none' });
    assert.deepEqual([none.ok, none.data.status], [false, 404]);
    nothingWritten(start, files);
  });
});
