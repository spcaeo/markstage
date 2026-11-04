// Library import from a web page, and media imports (docs/API-LIBRARY.md "From a web page", docs/API.md "Importing
// media"), against a small site on loopback reached through the test seam only: the page's parts to choose from,
// cleaned (no script, no event attributes, no javascript: links); the chosen parts become sections in "Imported" with
// their pictures in Media, all in one commit, audited; robots.txt and private addresses refused; a list of picture
// addresses and a zip as jobs, each one commit; the command line with a folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { parseHtml, partsOf, toMarkdown } from '../src/library/html.mjs';
import { titleOf } from '../src/library/url-import.mjs';
import { mediaCommand } from '../src/media/cli.mjs';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';
import { startWebSite } from './web-site.mjs';

const PAGE = `<!doctype html><html><head><title>Acme Moving &amp; Storage</title><script>steal()</script></head>
<body><header><nav><a href="/">Home</a></nav></header><main>
<section><h1>Move your data</h1><p>We move <strong>everything</strong>. <a href="javascript:steal()" onclick="steal()">Click</a> <a href="/contact">Talk to us</a></p><img src="/truck.png" alt="Our truck" onerror="steal()"></section>
<section><h2>What we do</h2><ul><li>Plan</li><li>Move</li></ul></section>
<section><h2>Pricing</h2><p>From $99.</p><img src="/missing.png" alt="gone"></section>
</main></body></html>`;

/** A .zip of these files (deflated), as a tool would make it. */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const packed = zlib.deflateRawSync(data);
    const n = Buffer.from(name);
    const crc = zlib.crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    locals.push(head, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

describe('the HTML reader', () => {
  test('parts by section, else by second-level heading; Markdown keeps structure and drops what runs', () => {
    const parts = partsOf(parseHtml(PAGE));
    assert.deepEqual(parts.map((p) => p.label), ['Move your data', 'What we do', 'Pricing']);
    const md = toMarkdown(parts[0].node, { base: 'https://acme.test/', src: (u) => (u === 'https://acme.test/truck.png' ? '/2026/10/truck.png' : null) });
    assert.equal(md, '# Move your data\n\nWe move **everything**. Click [Talk to us](https://acme.test/contact)\n\n![Our truck](/2026/10/truck.png)');
    const flat = partsOf(parseHtml('<body><div><h1>T</h1><p>intro</p><h2>One</h2><p>a</p><h2>Two</h2><pre>x\n  y</pre></div></body>'));
    assert.deepEqual(flat.map((p) => toMarkdown(p.node)), ['# T\n\nintro', '## One\n\na', '## Two\n\n```\nx\n  y\n```']);
    assert.equal(toMarkdown(parseHtml('<ol start="9"><li>a<ul><li>b</li></ul></li></ol><blockquote><p>q</p></blockquote>')), '9. a\n   - b\n\n> q');
  });

  test('hostile pages take linear time and never overflow the stack (unclosed tags, quotes, comments, deep nesting)', () => {
    const n = 200_000;
    for (const html of ['<a ' + 'b=c '.repeat(n / 4), '<a b="' + 'x'.repeat(n), '<a'.repeat(n / 2), '<!--'.repeat(n / 4), '<div>'.repeat(n / 5) + 'x', '&#x'.repeat(n / 3), '<a' + ' '.repeat(n), '<ul>' + '<li>x'.repeat(n / 5), '<p>x'.repeat(n / 4), '<script>'.repeat(n / 8), '<meta '.repeat(n / 6) + '<title'.repeat(n / 6)]) {
      const t = performance.now();
      for (const p of partsOf(parseHtml(html)).slice(0, 3)) toMarkdown(p.node);
      titleOf(html);
      assert.ok(performance.now() - t < 1500, `${html.slice(0, 12)}…: ${Math.round(performance.now() - t)} ms`);
    }
  });
});

describe('import from a web page, and media imports', () => {
  let fx, srv, ed, site;
  const robots = { type: 'text/plain', body: 'User-agent: *\nDisallow: /members/\n' };
  const audits = (action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY rowid').all(action);

  before(async () => {
    site = await startWebSite({
      '/robots.txt': () => robots,
      '/services': { body: PAGE },
      '/members/list': { body: PAGE },
      '/truck.png': { type: 'image/png', body: makePng() },
      '/logo.png': { type: 'image/png', body: makePng(Buffer.from('logo')) },
      '/notes.txt': { type: 'text/plain', body: 'not a picture' },
      '/feed': { type: 'application/json', body: '{}' },
    });
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { core: await loadCore(), outbound: site.outbound });
    ed = await as(srv, 'editor');
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  test('a page: its parts to choose from, cleaned; the chosen ones become sections in "Imported" with their pictures, in one commit', async () => {
    const pre = await ed.post('/library/import/url', { url: `${site.base}/services` });
    assert.equal(pre.status, 200, pre.text);
    assert.equal(pre.json.title, 'Acme Moving & Storage');
    assert.deepEqual(pre.json.parts.map((p) => [p.id, p.label, p.images]), [['p1', 'Move your data', 1], ['p2', 'What we do', 0], ['p3', 'Pricing', 1]]);
    const shown = pre.json.parts.map((p) => p.html).join('');
    assert.doesNotMatch(shown, /script|steal|onclick|onerror|javascript:/i);
    assert.match(shown, /<a href="http:\/\/127\.0\.0\.1:\d+\/contact">Talk to us<\/a>/);
    // the dry run writes nothing
    const head = fx.git('rev-parse', 'HEAD').trim();
    const dry = await ed.post('/library/import/url/parts', { url: `${site.base}/services`, parts: ['p1', 'p3'], dry: true });
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual([dry.json.items.map((i) => [i.id, i.name, i.images]), dry.json.media], [[['p1', 'Move your data', 1], ['p3', 'Pricing', 1]], 2]);
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
    const mediaBefore = srv.app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
    // for real: the missing picture is a problem, the rest comes in
    const done = await ed.post('/library/import/url/parts', { url: `${site.base}/services`, parts: ['p1', 'p3'], kind: 'section' });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.json.created.length, 2);
    assert.equal(done.json.media, 1);
    assert.ok(done.json.problems.some((p) => /missing\.png: .*answered 404/.test(p)), done.json.problems.join(' | '));
    assert.equal(fx.git('rev-list', '--count', `${head}..HEAD`).trim(), '1', 'one commit');
    assert.match(fx.git('log', '-1', '--format=%s').trim(), /^Library: import 2 items from 127\.0\.0\.1:\d+$/);
    const changed = fx.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort();
    const row = srv.app.db.prepare('SELECT * FROM media ORDER BY rowid DESC').get();
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n, mediaBefore + 1);
    assert.deepEqual(changed, [row.path, ...done.json.created.map((id) => `markstage/library/section/${id}.json`)].sort());
    const item = JSON.parse(fs.readFileSync(path.join(fx.site, `markstage/library/section/${done.json.created[0]}.json`), 'utf8'));
    assert.deepEqual([item.name, item.folder, item.kind, item.imported], ['Move your data', 'Imported', 'section', { from: 'url', source: `${site.base}/services` }]);
    const text = JSON.stringify(item.body);
    const img = item.body.doc.content.find((n) => n.type === 'image');
    assert.equal(img.attrs.alt, 'Our truck');
    assert.ok(img.attrs.src.endsWith(path.relative(srv.config.media.dir, row.path).split(path.sep).join('/')), 'the picture points at the media file');
    assert.deepEqual(item.body.doc.content.map((n) => n.type), ['heading', 'paragraph', 'image']);
    assert.doesNotMatch(text, /javascript|steal/);
    const a = audits('library.import').at(-1);
    assert.deepEqual(JSON.parse(a.detail).created, done.json.created);
    assert.equal(JSON.parse(a.detail).from, 'url');
  });

  test('refused: robots.txt, a private address, not a web page, a changed page; editors only', async () => {
    const r = await ed.post('/library/import/url', { url: `${site.base}/members/list` });
    assert.deepEqual([r.status, r.json.error], [422, 'robots']);
    assert.match(r.json.message, /asks robots not to fetch \/members\/list/);
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://localhost:4321/', `http://127.0.0.1:${srv.port}/api/users`]) {
      const x = await ed.post('/library/import/url', { url });
      assert.deepEqual([x.status, x.json.error], [400, 'unsafe-url'], url);
    }
    assert.equal((await ed.post('/library/import/url', { url: `${site.base}/feed` })).status, 415);
    assert.equal((await ed.post('/library/import/url/parts', { url: `${site.base}/services`, parts: ['p9'] })).status, 409);
    const author = await as(srv, 'author');
    assert.equal((await author.post('/library/import/url', { url: `${site.base}/services` })).status, 403);
  });

  test('media from a list of addresses: a dry run, then a job with one commit; refused addresses never fetched', async () => {
    const urls = [`${site.base}/logo.png`, `${site.base}/notes.txt`, 'http://169.254.169.254/x.png', 'http://10.1.1.1/a.png', `${site.base}/logo.png`];
    const dry = await ed.post('/media/import/urls', { urls, dry: true });
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual(dry.json.items.map((i) => Boolean(i.problem)), [false, false, true, true, true]);
    const hits = site.hits.length;
    const head = fx.git('rev-parse', 'HEAD').trim();
    const go = await ed.post('/media/import/urls', { urls });
    assert.equal(go.status, 200, go.text);
    await srv.app.jobs.idle();
    const job = (await ed.get(`/jobs/${go.json.job.id}`)).json;
    assert.equal(job.status, 'succeeded', job.log);
    assert.match(job.log, /notes\.txt: This kind of file cannot be uploaded/);
    assert.deepEqual(site.hits.slice(hits).sort(), ['/logo.png', '/notes.txt']);
    assert.equal(fx.git('rev-list', '--count', `${head}..HEAD`).trim(), '1');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Import 1 media file from the web');
    const author = await as(srv, 'contributor');
    assert.equal((await author.post('/media/import/urls', { urls, dry: true })).status, 403);
  });

  test('media from a zip: what is in it first, then a job with one commit', async () => {
    const zip = makeZip({ 'photos/a.png': makePng(Buffer.from('a')), 'photos/b.png': makePng(Buffer.from('b')), 'readme.txt': Buffer.from('hello'), 'logo.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'), '__MACOSX/._a.png': Buffer.from('x') });
    const send = (q) => ed.request('POST', `/media/import/zip?filename=photos.zip${q}`, { body: zip, headers: { 'Content-Type': 'application/zip' } });
    const dry = await send('&dry=1');
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual(dry.json.items.map((i) => [i.name, i.problem ?? null]), [['photos/a.png', null], ['photos/b.png', null], ['readme.txt', 'not an image or PDF, left out'], ['logo.svg', 'SVG is not accepted (it can carry scripts), left out']]);
    const head = fx.git('rev-parse', 'HEAD').trim();
    const go = await send('');
    await srv.app.jobs.idle();
    const job = (await ed.get(`/jobs/${go.json.job.id}`)).json;
    assert.equal(job.status, 'succeeded', job.log);
    assert.equal(fx.git('rev-list', '--count', `${head}..HEAD`).trim(), '1');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Import 2 media files from photos.zip');
    assert.equal((await ed.request('POST', '/media/import/zip?dry=1', { body: Buffer.from('not a zip'), headers: { 'Content-Type': 'application/zip' } })).status, 400);
  });

  test('media from a folder on the command line, as a named person', async () => {
    const dir = path.join(fx.run, 'pictures');
    fs.mkdirSync(path.join(dir, 'more'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'one.png'), makePng(Buffer.from('1')));
    fs.writeFileSync(path.join(dir, 'more', 'two.png'), makePng(Buffer.from('2')));
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'x');
    const lines = [];
    assert.equal(await mediaCommand(srv.app, ['import', dir, '--dry', '--as', ed.user.email], (l) => lines.push(l)), 0);
    assert.equal(lines[0], 'Dry run, nothing written: 2 files would come in.');
    lines.length = 0;
    assert.equal(await mediaCommand(srv.app, ['import', dir, '--as', ed.user.email], (l) => lines.push(l)), 0);
    assert.match(lines[0], /^Imported 2 files in [0-9a-f]{7}\.$/);
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Import 2 media files from pictures');
    await assert.rejects(mediaCommand(srv.app, ['import', dir], () => {}), /Say who does it/);
  });
});
