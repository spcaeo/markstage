// The head kit's settings API (src/head/routes.mjs): GET head and PUT head. Everyone who looks at the design reads;
// only owner/administrator write; a stale version is 409; a setting readHead refuses is 422 and nothing is written;
// a save is written pretty-printed, committed as the person, audited, and built and deployed as one job, and goes back
// when that job fails; the file never leaves the repo (no link).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, gitLog, makeFixture, readFile, startServer } from './helpers.mjs';

const SITE_CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  head: {},
};
`;

function headFixture(config = SITE_CONFIG) {
  const fx = makeFixture({ checks: false });
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), config);
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Site config');
  return fx;
}

describe('Head settings API', () => {
  let fx;
  let srv;
  let admin;
  let owner;
  let editor;
  let contributor;
  before(async () => {
    fx = headFixture();
    srv = await startServer(fx, { core: await loadCore(), overrides: { collections: [] } });
    owner = await as(srv, 'owner');
    admin = await as(srv, 'administrator');
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    contributor = await as(srv, 'contributor', { authorSlug: 'cora' });
  });
  after(() => srv.close());

  const job = async (id) => {
    await srv.app.jobs.idle();
    return (await admin.get(`/jobs/${id}`)).json;
  };
  const FILE = 'src/site/head.json';

  test('GET: the defaults while there is no file, the site’s collections, the tools in words; others read, only managers edit', async () => {
    const g = await admin.get('/head');
    assert.equal(g.status, 200, g.text);
    assert.equal(g.json.enabled, true);
    assert.equal(g.json.canEdit, true);
    assert.equal(g.json.file, FILE);
    assert.equal(g.json.version, null);
    assert.equal(g.json.settings, null);
    assert.deepEqual(g.json.issues, []);
    assert.deepEqual(g.json.head.markdown, { pages: true, okf: true, llms: true, skip: [] });
    assert.deepEqual(g.json.collections, [{ id: 'posts', label: 'Posts' }, { id: 'pages', label: 'Pages' }]);
    assert.deepEqual(g.json.trackers.map((t) => t.id), ['gtm', 'ga4', 'ahrefs', 'skald', 'plausible']);
    const gtm = g.json.trackers[0];
    assert.equal(gtm.label, 'Google Tag Manager');
    assert.equal(gtm.example, 'GTM-ABC1234');
    assert.match(gtm.hint, /tagmanager\.google\.com/);
    assert.equal(new RegExp(gtm.pattern).test('GTM-ABC1234'), true, 'the pattern travels as source, so the editor checks as the build does');
    assert.equal(new RegExp(gtm.pattern).test('UA-1234'), false);
    assert.deepEqual(g.json.gtmLoads, ['first-interaction', 'at-once']);
    const c = await contributor.get('/head');
    assert.equal(c.status, 200);
    assert.equal(c.json.canEdit, false);
    assert.equal((await editor.get('/head')).json.canEdit, false);
    assert.equal((await owner.get('/head')).json.canEdit, true);
  });

  test('PUT: below administrator is 403 and writes nothing', async () => {
    const body = { version: null, settings: { tracking: { gtm: 'GTM-ABC1234' } } };
    const r = await editor.put('/head', body);
    assert.equal(r.status, 403);
    assert.match(r.json.message, /owner or administrator/);
    assert.equal((await contributor.put('/head', body)).status, 403);
    assert.ok(!fs.existsSync(path.join(fx.site, FILE)));
  });

  test('PUT: a setting the checks refuse is 422 with its plain words, and nothing is written', async () => {
    const put = (settings) => admin.put('/head', { version: null, settings });
    const bad = await put({ tracking: { gtm: 'not-an-id' } });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.json.issues.map((i) => i.path), ['tracking.gtm']);
    assert.match(bad.json.issues[0].message, /Google Tag Manager ID \(such as GTM-ABC1234\)/);
    const feed = await put({ feeds: [{ id: 'blog', title: 'Blog', path: '/rss.xml', collections: ['nope'] }] });
    assert.equal(feed.status, 422);
    assert.match(feed.json.issues[0].message, /no collection “nope”/);
    const skip = await put({ markdown: { skip: ['private'] } });
    assert.equal(skip.status, 422);
    assert.equal((await put('text')).status, 400);
    assert.equal((await put([])).status, 400);
    assert.ok(!fs.existsSync(path.join(fx.site, FILE)), 'nothing written');
    assert.equal(gitLog(fx, FILE)[0], '', 'nothing committed');
  });

  test('PUT: written pretty-printed, committed as the person, audited, then built and deployed; the answer is 202', async () => {
    const settings = { markdown: { pages: true, okf: false, llms: true, skip: ['/thanks/'] }, feeds: [{ id: 'blog', title: 'Example Co blog', description: '', path: '/rss.xml', collections: ['posts'], limit: 20 }], tracking: { gtm: 'GTM-ABC1234', gtmLoad: 'at-once' } };
    const r = await admin.put('/head', { version: null, settings });
    assert.equal(r.status, 202, r.text);
    assert.equal(r.json.ok, true);
    assert.match(r.json.commit, /^[0-9a-f]{40}$/);
    assert.equal(readFile(fx, FILE), `${JSON.stringify(settings, null, 2)}\n`);
    assert.equal(r.json.version, (await admin.get('/head')).json.version);
    const j = await job(r.json.job);
    assert.equal(j.status, 'succeeded', JSON.stringify(j.steps));
    assert.deepEqual(j.steps.map((s) => s.name), ['commit', 'build', 'deploy']);
    const line = gitLog(fx, FILE)[0];
    assert.match(line, new RegExp(`\\|Site settings: search and AI and tracking$`));
    assert.ok(line.includes(admin.user.email), 'committed as the person');
    const audit = await admin.get('/audit?action=head.');
    assert.ok(audit.json.items.some((a) => a.action === 'head.write' && a.target === FILE));
    const g = (await contributor.get('/head')).json;
    assert.deepEqual(g.settings, settings);
    assert.equal(g.head.tracking.gtmLoad, 'at-once');
    assert.deepEqual(g.issues, []);
  });

  test('PUT: a stale version is 409 with the current one; the same settings again change nothing; the message names what changed', async () => {
    const cur = (await admin.get('/head')).json;
    const stale = await admin.put('/head', { version: 'old', settings: { tracking: { gtm: 'GTM-ZZZZ999' } } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.version, cur.version);
    assert.equal((await admin.put('/head', { version: null, settings: cur.settings })).status, 409, 'null is a stale version now the file exists');
    const same = await owner.put('/head', { version: cur.version, settings: cur.settings });
    assert.equal(same.status, 200, same.text);
    assert.deepEqual([same.json.commit, same.json.job], [null, null]);
    const next = structuredClone(cur.settings);
    next.tracking = { ...next.tracking, ga4: 'G-ABC123DEF4' };
    const r = await owner.put('/head', { version: cur.version, settings: next });
    assert.equal(r.status, 202, r.text);
    assert.equal((await job(r.json.job)).status, 'succeeded');
    assert.match(gitLog(fx, FILE)[0], /\|Site settings: tracking$/);
    const feeds = structuredClone(next);
    feeds.feeds[0].limit = 10;
    const f = await owner.put('/head', { version: r.json.version, settings: feeds });
    assert.equal((await job(f.json.job)).status, 'succeeded');
    assert.match(gitLog(fx, FILE)[0], /\|Site settings: search and AI$/);
  });

  test('a save whose build fails goes back to what it was', async () => {
    const cur = (await admin.get('/head')).json;
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      const next = structuredClone(cur.settings);
      next.tracking.plausible = 'example.com';
      const r = await admin.put('/head', { version: cur.version, settings: next });
      assert.equal(r.status, 202);
      const j = await job(r.json.job);
      assert.equal(j.status, 'failed');
      assert.match(j.log, /build exploded/);
      assert.deepEqual(JSON.parse(readFile(fx, FILE)), cur.settings, 'reverted');
      assert.match(gitLog(fx, FILE)[0], /\|Revert src\/site\/head\.json/);
    } finally {
      fs.rmSync(`${fx.failMarker}.build`, { force: true });
    }
  });

  test('a file that is not JSON is told in words, and a save replaces it', async () => {
    fs.writeFileSync(path.join(fx.site, FILE), '{ not json');
    const g = (await admin.get('/head')).json;
    assert.equal(g.settings, null);
    assert.match(g.issues[0].message, /not valid JSON/);
    assert.equal(g.head.markdown.pages, true, 'the defaults stand in');
    const r = await admin.put('/head', { version: g.version, settings: { tracking: { gtm: 'GTM-ABC1234' } } });
    assert.equal(r.status, 202, r.text);
    assert.equal((await job(r.json.job)).status, 'succeeded');
    assert.deepEqual(JSON.parse(readFile(fx, FILE)), { tracking: { gtm: 'GTM-ABC1234' } });
  });

  test('the file may not be a link out of the repo: nothing is written through it', async () => {
    const outside = path.join(fx.run, 'outside.json');
    fs.writeFileSync(outside, '{"tracking":{"gtm":"GTM-OUTSIDE1"}}\n');
    fs.rmSync(path.join(fx.site, FILE));
    fs.symlinkSync(outside, path.join(fx.site, FILE));
    const g = await admin.get('/head');
    assert.equal(g.status, 403);
    assert.match(g.json.message, /link/);
    const r = await admin.put('/head', { version: null, settings: { tracking: { gtm: 'GTM-ABC1234' } } });
    assert.equal(r.status, 403);
    assert.equal(fs.readFileSync(outside, 'utf8'), '{"tracking":{"gtm":"GTM-OUTSIDE1"}}\n', 'the file outside is untouched');
    fs.rmSync(path.join(fx.site, FILE));
  });
});

describe('Head settings API: a site that does not use it', () => {
  let fx;
  let srv;
  let admin;
  before(async () => {
    fx = headFixture(SITE_CONFIG.replace('  head: {},\n', ''));
    srv = await startServer(fx, { core: await loadCore(), overrides: { collections: [] } });
    admin = await as(srv, 'administrator');
  });
  after(() => srv.close());

  test('GET says it is off; PUT is 404 and writes nothing', async () => {
    const g = await admin.get('/head');
    assert.equal(g.status, 200);
    assert.deepEqual(g.json, { enabled: false, canEdit: true });
    const r = await admin.put('/head', { version: null, settings: {} });
    assert.equal(r.status, 404);
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/site/head.json')));
  });
});
