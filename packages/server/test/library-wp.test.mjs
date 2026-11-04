// The Library's import from WordPress (docs/API-LIBRARY.md "From WordPress"): reusable blocks from an export (.xml)
// and a database dump (.sql.gz), a dry run then the import; Gutenberg HTML into the site's blocks; pictures the media
// map (or the uploads path) names point at the files already here, others are fetched through the guard; drafts left
// out; a second import skips what came before. With MARKSTAGE_WP_DUMP set, the real dump's blocks are read too
// (nothing written, counts only).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { libraryCommand } from '../src/library/cli.mjs';
import { blocksOfDump, blocksOfWxr } from '../src/library/wp.mjs';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';
import { startWebSite } from './web-site.mjs';

const CTA = `<!-- wp:group {"className":"cta"} -->
<div class="wp-block-group cta"><!-- wp:heading -->
<h2 class="wp-block-heading">Ready to move?</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Book a <strong>free</strong> call &amp; get a plan.</p>
<!-- /wp:paragraph -->

<!-- wp:image {"id":42} -->
<figure class="wp-block-image"><img src="https://old.example.test/wp-content/uploads/2024/03/hero-1024x512.png" alt="Hero" class="wp-image-42"/></figure>
<!-- /wp:image -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link" href="https://example.test/contact/">Talk to us</a></div></div>
<!-- /wp:buttons --></div>
<!-- /wp:group -->`;

const wxr = (items) => `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>Old site</title>
${items.map((i) => `<item><title><![CDATA[${i.title}]]></title><wp:post_id>${i.id}</wp:post_id><wp:post_type><![CDATA[${i.type}]]></wp:post_type><wp:status><![CDATA[${i.status}]]></wp:status><content:encoded><![CDATA[${i.html}]]></content:encoded></item>`).join('\n')}
</channel></rss>`;

const sqlString = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const dump = (rows) => `-- MySQL dump
/*!40103 SET TIME_ZONE='+00:00' */;
CREATE TABLE \`wpx_posts\` (
  \`ID\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`post_content\` longtext NOT NULL,
  \`post_title\` text NOT NULL,
  \`post_status\` varchar(20) NOT NULL DEFAULT 'publish',
  \`post_type\` varchar(20) NOT NULL DEFAULT 'post',
  PRIMARY KEY (\`ID\`)
) ENGINE=InnoDB;
INSERT INTO \`wpx_posts\` VALUES ${rows.map((r) => `(${r.id},${sqlString(r.html)},${sqlString(r.title)},'${r.status}','${r.type}')`).join(',')};
`;

describe('WordPress reusable blocks', () => {
  let fx, srv, ed, site;
  const form = (file, fields = {}) => {
    const b = '----wp-boundary';
    const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.data, Buffer.from(`\r\n--${b}--\r\n`));
    return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${b}` } };
  };

  before(async () => {
    site = await startWebSite({ '/wp-content/uploads/2025/01/team.png': { type: 'image/png', body: makePng(Buffer.from('team')) } });
    fx = makeFixture({ checks: false });
    fs.mkdirSync(path.join(fx.site, 'src/assets/uploads/2024/03'), { recursive: true });
    fs.writeFileSync(path.join(fx.site, 'src/assets/uploads/2024/03/hero.png'), makePng());
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Pictures from WordPress');
    srv = await startServer(fx, { core: await loadCore(), outbound: site.outbound });
    ed = await as(srv, 'editor');
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  test('read from an export and from a dump: the reusable blocks only', async () => {
    const items = [
      { id: 7, title: 'Call to action', type: 'wp_block', status: 'publish', html: CTA },
      { id: 8, title: 'Old banner', type: 'wp_block', status: 'draft', html: '<p>old</p>' },
      { id: 9, title: 'A post', type: 'post', status: 'publish', html: '<p>post</p>' },
    ];
    assert.deepEqual(blocksOfWxr(wxr(items)).map((b) => [b.id, b.title, b.status, b.html === CTA || b.html]), [['7', 'Call to action', 'publish', true], ['8', 'Old banner', 'draft', '<p>old</p>']]);
    const fromDump = await blocksOfDump(Readable.from([dump(items)]));
    assert.deepEqual(fromDump.map((b) => [b.id, b.title, b.status, b.html === CTA || b.html]), [['7', 'Call to action', 'publish', true], ['8', 'Old banner', 'draft', '<p>old</p>']]);
    assert.throws(() => blocksOfWxr('<html></html>'), /not a WordPress export/);
    // read with indexOf only: unclosed items, CDATA and tags cost nothing; a closing tag inside CDATA is not the end
    const t = performance.now();
    for (const x of ['<item>'.repeat(50_000), `<item>${'<![CDATA['.repeat(30_000)}</item>`, `<item>${'<title'.repeat(50_000)}</item>`]) blocksOfWxr(`<rss xmlns:wp="x">${x}`);
    assert.ok(performance.now() - t < 200, `${Math.round(performance.now() - t)} ms`);
    const tricky = blocksOfWxr(wxr([{ id: 5, title: 'T', type: 'wp_block', status: 'publish', html: '<p>a</item></content:encoded> b</p>' }]));
    assert.equal(tricky[0].html, '<p>a</item></content:encoded> b</p>');
  });

  test('an export: a dry run, then sections in Imported with the picture the media map names, one commit; again: skipped', async () => {
    const map = JSON.stringify({ note: 'old -> new', urls: { 'https://old.example.test/wp-content/uploads/2024/03/hero-1024x512.png': 'src/assets/uploads/2024/03/hero.png' } });
    const xml = Buffer.from(wxr([
      { id: 7, title: 'Call to action', type: 'wp_block', status: 'publish', html: CTA },
      { id: 11, title: 'Team', type: 'wp_block', status: 'publish', html: `<!-- wp:image --><figure class="wp-block-image"><img src="${site.base}/wp-content/uploads/2025/01/team.png" alt="The team"/></figure><!-- /wp:image --><!-- wp:paragraph --><p>Our people.</p><!-- /wp:paragraph -->` },
      { id: 8, title: 'Old banner', type: 'wp_block', status: 'draft', html: '<p>old</p>' },
    ]));
    const head = fx.git('rev-parse', 'HEAD').trim();
    const dry = await ed.request('POST', '/library/import?dry=1', form({ name: 'old-site.xml', data: xml }, { mediaMap: map }));
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual(dry.json.items.map((i) => [i.wpId, i.name, i.images]), [['7', 'Call to action', 1], ['11', 'Team', 1]]);
    assert.deepEqual([dry.json.media, dry.json.found], [1, 1]);
    assert.ok(dry.json.problems.some((p) => /Old banner.*draft in WordPress, left out/.test(p)));
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
    const done = await ed.request('POST', '/library/import', form({ name: 'old-site.xml', data: xml }, { mediaMap: map }));
    assert.equal(done.status, 200, done.text);
    assert.equal(done.json.created.length, 2);
    assert.equal(done.json.media, 1);
    assert.equal(fx.git('rev-list', '--count', `${head}..HEAD`).trim(), '1');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Library: import 2 items from old-site.xml');
    const read = (id) => JSON.parse(fs.readFileSync(path.join(fx.site, `markstage/library/section/${id}.json`), 'utf8'));
    const cta = read(done.json.created[0]);
    assert.deepEqual([cta.name, cta.folder, cta.imported], ['Call to action', 'Imported', { from: 'wordpress', source: 'old-site.xml', wpId: '7' }]);
    assert.deepEqual(cta.body.doc.content.map((n) => n.type), ['heading', 'paragraph', 'image', 'paragraph']);
    const img = cta.body.doc.content[2];
    assert.equal(img.attrs.alt, 'Hero');
    assert.ok(img.attrs.src.endsWith('2024/03/hero.png'), img.attrs.src);
    assert.match(JSON.stringify(cta.body.doc.content[3]), /Talk to us.*https:\/\/example\.test\/contact\//);
    const team = read(done.json.created[1]);
    const row = srv.app.db.prepare('SELECT * FROM media ORDER BY rowid DESC').get();
    assert.ok(team.body.doc.content[0].attrs.src.endsWith(path.basename(row.path)), 'the fetched picture is in Media');
    // the same file again: nothing new
    const again = await ed.request('POST', '/library/import', form({ name: 'old-site.xml', data: xml }, { mediaMap: map }));
    assert.deepEqual([again.json.created, again.json.skipped.length, again.json.commit], [[], 2, null]);
  });

  test('a dump (.sql.gz) on the command line; authors refused', async () => {
    const file = path.join(fx.run, 'wp.sql.gz');
    fs.writeFileSync(file, zlib.gzipSync(dump([{ id: 21, title: 'Footer note', type: 'wp_block', status: 'publish', html: '<!-- wp:paragraph --><p>Made in Canada.</p><!-- /wp:paragraph -->' }])));
    const lines = [];
    assert.equal(await libraryCommand(srv.app, ['import', file, '--dry', '--as', ed.user.email], (l) => lines.push(l)), 0);
    assert.match(lines[0], /^Dry run, nothing written: 1 item, 0 media files\.$/);
    lines.length = 0;
    assert.equal(await libraryCommand(srv.app, ['import', file, '--as', ed.user.email], (l) => lines.push(l)), 0);
    assert.match(lines[0], /^Imported 1 item in [0-9a-f]{7}\.$/);
    const author = await as(srv, 'author');
    await assert.rejects(libraryCommand(srv.app, ['import', file, '--as', author.user.email], () => {}), /Only editors can import/);
  });

  // MARKSTAGE_WP_DUMP: a dump of the real site's wp_block rows (copied into a scratch dir, never into the repo);
  // MARKSTAGE_WP_SITE: the real site's repo, read only, for its media map and the pictures it names. Counts only;
  // nothing is fetched from the web (the resolver answers nothing).
  test('the real WordPress blocks, into a scratch site (MARKSTAGE_WP_DUMP)', { skip: !process.env.MARKSTAGE_WP_DUMP }, async () => {
    const file = process.env.MARKSTAGE_WP_DUMP;
    const real = process.env.MARKSTAGE_WP_SITE;
    const blocks = await blocksOfDump(fs.createReadStream(file).pipe(zlib.createGunzip()));
    const map = real ? fs.readFileSync(path.join(real, 'migration/convert/media-map.json'), 'utf8') : null;
    const rfx = makeFixture({ checks: false });
    if (map) {
      for (const rel of new Set(Object.values(JSON.parse(map).urls))) {
        const from = path.join(real, rel);
        if (!rel.startsWith('src/assets/uploads/') || !fs.existsSync(from)) continue;
        fs.mkdirSync(path.dirname(path.join(rfx.site, rel)), { recursive: true });
        fs.copyFileSync(from, path.join(rfx.site, rel));
      }
      rfx.git('add', '-A');
      rfx.git('commit', '-q', '-m', 'The real pictures');
    }
    const offline = { lookup: (name, opts, cb) => cb(Object.assign(new Error('offline'), { code: 'ENOTFOUND' })) };
    const rsrv = await startServer(rfx, { core: await loadCore(), outbound: offline });
    try {
      const red = await as(rsrv, 'editor');
      const ctx = { user: rsrv.app.users.toPublic(rsrv.app.db.prepare('SELECT * FROM users WHERE id = ?').get(red.user.id)), ip: null, userAgent: 'test' };
      const dry = await rsrv.app.libraryWp.importPath(ctx, file, { dry: true, mediaMap: map });
      const done = await rsrv.app.libraryWp.importPath(ctx, file, { mediaMap: map });
      const types = new Map();
      for (const id of done.created) {
        const it = JSON.parse(fs.readFileSync(path.join(rfx.site, `markstage/library/section/${id}.json`), 'utf8'));
        for (const n of it.body.doc.content) types.set(n.type, (types.get(n.type) ?? 0) + 1);
      }
      console.log(`real blocks: ${blocks.length} in the dump, ${dry.items.length} to import, ${dry.found} pictures found in the media folder, ${dry.media} to fetch; imported ${done.created.length} in ${done.commit?.slice(0, 7)}, ${done.problems.length} problems; blocks: ${[...types].map(([t, n]) => `${t} ${n}`).join(', ')}`);
      assert.equal(done.created.length, dry.items.length);
    } finally {
      await rsrv.close();
    }
  });
});
