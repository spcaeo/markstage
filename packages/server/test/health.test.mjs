// Site health and the CSV exports (docs/SEO.md section 4): every live page with its findings, duplicates across the
// site, the last deploy, disk room; speed from the Chrome UX Report with the site's own key (a loopback double here,
// the key only in a header); and pages / links / images / headings as CSV, site-wide or for one entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { cell } from '../src/health.mjs';
import { as, freePort, makeFixture } from './helpers.mjs';
import { localeServer } from './locale-site.mjs';

const KEY = 'AIzaTestOnlyKey_0123456789abcdef';

describe('site health', () => {
  let fx;
  let srv;
  let admin;
  let ed;
  let fake;
  let answer = 200;
  const asked = [];

  before(async () => {
    const port = await freePort();
    fake = http.createServer((req, res) => {
      let t = '';
      req.on('data', (d) => (t += d));
      req.on('end', () => {
        const body = JSON.parse(t);
        asked.push({ url: req.url, key: req.headers['x-goog-api-key'], body });
        if (answer !== 200) return res.writeHead(answer, { 'content-type': 'application/json' }).end('{"error":{"code":' + answer + '}}');
        const phone = body.formFactor === 'PHONE';
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            record: {
              metrics: {
                largest_contentful_paint: { percentiles: { p75: phone ? 3100 : 1800 } },
                interaction_to_next_paint: { percentiles: { p75: phone ? 620 : 90 } },
                cumulative_layout_shift: { percentiles: { p75: '0.05' } },
              },
              collectionPeriod: { lastDate: { year: 2026, month: 10, day: 27 } },
            },
          }),
        );
      });
    });
    await new Promise((r) => fake.listen(port, '127.0.0.1', r));
    ({ fx, srv } = await localeServer({ crux: { key: KEY, endpoint: `http://127.0.0.1:${port}/v1/records:queryRecord` } }));
    admin = await as(srv, 'administrator');
    ed = await as(srv, 'editor', { authorSlug: 'ed' });
    // a live page with the same title as hello-world, an image without alt and a link to nowhere
    fs.writeFileSync(
      path.join(fx.site, 'src/content/blog/twin.md'),
      `---\ntitle: Hello World\nauthor: alice\ndate: '2026-01-08T10:00:00.000Z'\n---\n\n# Twin\n\n#### Deep\n\n<p><img src="/uploads/x.png"> <a href="/blog/nowhere/" rel="nofollow">gone</a> <a href="https://example.org/">=out</a></p>\n`,
    );
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Twin');
  });
  after(async () => {
    await srv.close();
    await new Promise((r) => fake.close(r));
  });

  test('owner and administrators only', async () => {
    assert.equal((await ed.get('/site/health')).status, 403);
    assert.equal((await ed.get('/site/export/pages')).status, 403);
    assert.equal((await ed.post('/site/health/speed', {})).status, 403);
  });

  test('every live page with its findings; duplicates grouped; deploy and disk', async () => {
    const h = await admin.get('/site/health');
    assert.equal(h.status, 200, h.text);
    const twin = h.json.pages.find((p) => p.id === 'twin');
    assert.equal(twin.path, '/blog/twin/');
    assert.equal(twin.url, 'https://example.com/blog/twin/');
    assert.equal(twin.altText, 1);
    assert.deepEqual(twin.links.map((l) => [l.href, l.problem]), [['/blog/nowhere/', 'unknown']]);
    assert.equal(twin.headings, 1);
    assert.ok(twin.words > 0);
    assert.equal(h.json.counts.altText >= 1, true);
    const dup = h.json.duplicates.find((d) => d.what === 'title' && d.text === 'Hello World');
    assert.deepEqual(dup.entries.map((e) => e.id).sort(), ['hello-world', 'twin']);
    assert.ok(!h.json.pages.some((p) => p.id === 'bob-draft'), 'drafts are not on the site');
    assert.equal(typeof h.json.deploy.failedSince.length, 'number');
    // a backup is not a deploy (QA F8): with only a backup done, nothing was deployed from here
    srv.app.db.prepare("INSERT INTO jobs (id, kind, status, created_at, finished_at) VALUES ('j_backup1', 'backup', 'succeeded', '2026-11-02T10:00:00.000Z', '2026-11-02T10:00:05.000Z')").run();
    const again = (await admin.get('/site/health')).json.deploy;
    assert.equal(again.job, null, 'the backup is not the last deploy');
    assert.equal(again.at, null);
    srv.app.db.prepare("DELETE FROM jobs WHERE id = 'j_backup1'").run();
    assert.equal(typeof h.json.disk.media.files, 'number');
    assert.equal(h.json.speed.on, true);
    assert.equal(h.json.speed.site, null, 'nothing asked yet');
    assert.deepEqual(h.json.backup, { on: false }, 'not set up here: said, not hidden (backup.test.mjs has it on)');
  });

  test('speed: the site and one page, phone and desktop, rated; the key only in a header; kept for an hour', async () => {
    const s = await admin.post('/site/health/speed', {});
    assert.equal(s.status, 200, s.text);
    assert.deepEqual(asked.map((a) => [a.body.origin, a.body.formFactor]), [['https://example.com', 'PHONE'], ['https://example.com', 'DESKTOP']]);
    assert.ok(asked.every((a) => a.key === KEY && !a.url.includes(KEY)));
    assert.deepEqual(s.json.phone.lcp, { p75: 3100, rating: 'needs-work' });
    assert.deepEqual(s.json.phone.inp, { p75: 620, rating: 'poor' });
    assert.deepEqual(s.json.desktop.cls, { p75: 0.05, rating: 'good' });
    // asked again within the hour: the kept answer, no call
    await admin.post('/site/health/speed', {});
    assert.equal(asked.length, 2);
    const p = await admin.post('/site/health/speed', { path: '/blog/twin/' });
    assert.equal(asked.at(-1).body.url, 'https://example.com/blog/twin/');
    assert.equal(p.json.desktop.lcp.rating, 'good');
    const h = (await admin.get('/site/health')).json;
    assert.equal(h.speed.site.phone.lcp.p75, 3100);
    assert.equal(h.pages.find((x) => x.id === 'twin').speed.desktop.inp.rating, 'good');
    // too few visitors: Google says 404, the screen says there is no data yet
    answer = 404;
    const none = await admin.post('/site/health/speed', { path: '/blog/linker/' });
    assert.deepEqual(none.json.phone, { none: true });
    // a refused key is said in plain words and asked again next time
    answer = 403;
    const bad = await admin.post('/site/health/speed', { path: '/blog/hello-world/' });
    assert.match(bad.json.error, /refused the key/);
    answer = 200;
    assert.equal((await admin.post('/site/health/speed', { path: '//evil.example/' })).status, 400);
  });

  test('CSV: pages, links, images, headings; one entry; formulas made inert', async () => {
    const pages = await admin.get('/site/export/pages');
    assert.equal(pages.status, 200);
    assert.match(pages.headers.get('content-type'), /^text\/csv/);
    assert.match(pages.headers.get('content-disposition'), /attachment; filename="site-pages.csv"/);
    // (fetch's text() drops the byte-order mark the file starts with)
    assert.match(pages.text, /^collection,id,title,status,address/);
    assert.match(pages.text, /posts,twin,Hello World,published,https:\/\/example.com\/blog\/twin\//);
    const links = await admin.get('/site/export/links?entry=posts/twin');
    assert.match(links.headers.get('content-disposition'), /posts-twin-links.csv/);
    const lines = links.text.trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[1], /^https:\/\/example.com\/blog\/twin\/,\/blog\/nowhere\/,gone,yes,nofollow,goes to no page,block 3$/);
    assert.match(lines[2], /,https:\/\/example.org\/,'=out,no,,,block 3$/);
    const images = await admin.get('/site/export/images?entry=posts/twin');
    assert.match(images.text, /\/uploads\/x.png,,block 3/);
    const heads = await admin.get('/site/export/headings?entry=posts/twin');
    assert.match(heads.text, /H1,Twin,block 1\r\nhttps:\/\/example.com\/blog\/twin\/,H4,Deep,block 2/);
    assert.equal((await admin.get('/site/export/secrets')).status, 404);
    assert.equal((await admin.get('/site/export/pages?entry=posts/nope')).status, 404);
    assert.equal((await admin.get('/site/export/pages?entry=../x')).status, 400);
  });
});

describe('site health: duplicates are pages', () => {
  let srv;
  let admin;

  before(async () => {
    let fx;
    ({ fx, srv } = await localeServer());
    admin = await as(srv, 'administrator');
    const post = (id, title) => fs.writeFileSync(path.join(fx.site, `src/content/blog/${id}.md`), `---\ntitle: ${title}\nauthor: alice\ndate: '2026-01-08T10:00:00.000Z'\n---\n\nText.\n`);
    const page = (id, d) => fs.writeFileSync(path.join(fx.site, `src/content/pages/${id}.json`), JSON.stringify(d, null, 2) + '\n');
    // a page at a post's own address (a topic at its main page's), a page with no address, and a real twin
    post('same', 'Same Place');
    page('same-topic', { title: 'Same Place', uri: '/blog/same/' });
    post('alone', 'No Address');
    page('no-address', { title: 'No Address' });
    post('twice', 'Twice');
    page('twice-page', { title: 'Twice', uri: '/twice/' });
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Duplicates');
  });
  after(() => srv.close());

  test('entries at one address are one page, and an entry with no address is not a page', async () => {
    const h = await admin.get('/site/health');
    assert.equal(h.status, 200, h.text);
    const titles = h.json.duplicates.filter((d) => d.what === 'title').map((d) => d.text);
    assert.ok(!titles.includes('Same Place'), 'the topic at the post’s address is the same page');
    assert.ok(!titles.includes('No Address'), 'a page with no address is not on the site');
    const twice = h.json.duplicates.find((d) => d.what === 'title' && d.text === 'Twice');
    assert.deepEqual(twice.entries.map((e) => `${e.collection}/${e.id}`).sort(), ['pages/twice-page', 'posts/twice']);
    assert.ok(twice.entries.every((e) => !('at' in e)), 'the address used to group stays inside');
  });
});

test('csv cells: quotes, line breaks, and a leading = + - @ made inert', () => {
  assert.equal(cell('plain'), 'plain');
  assert.equal(cell('a, "b"'), '"a, ""b"""');
  assert.equal(cell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(cell('@sum'), "'@sum");
  assert.equal(cell(null), '');
});

test('config: the CrUX key is the site’s own, checked at start, and never on http outside loopback', () => {
  const fx = makeFixture({ checks: false });
  const env = { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
  assert.throws(() => loadConfig({ env, overrides: { crux: {} } }), /own Chrome UX Report API key/);
  assert.throws(() => loadConfig({ env, overrides: { crux: { key: KEY, endpoint: 'http://crux.example/x' } } }), /must be https/);
  assert.equal(loadConfig({ env, overrides: { crux: { key: KEY } } }).crux.endpoint, 'https://chromeuxreport.googleapis.com/v1/records:queryRecord');
});
