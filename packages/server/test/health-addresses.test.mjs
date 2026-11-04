// Site health, addresses: the site's health hook says what the host serves for each address of the build; the
// server runs it after a deploy (never during a build) and on "Check again", keeps the last good answer when a run
// fails, and matches each broken address's linking pages with their entries. Owner and administrators only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { readAnswer } from '../src/health-addresses.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { localeSite } from './locale-site.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

// the site's hook: every page of the build, a redirect chain and a broken address linked from /blog/linker/;
// the file .health-fail makes it fail, .health-junk makes it print something that is not the answer, .health-more
// adds a second broken address
const HOOK = `import fs from 'node:fs';
import path from 'node:path';
if (fs.existsSync('.health-fail')) { console.error('dist is missing'); process.exit(2); }
if (fs.existsSync('.health-junk')) { console.log('hello'); process.exit(0); }
const dist = process.env.MARKSTAGE_DIST;
const pages = [];
const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { if (e.isDirectory()) walk(path.join(d, e.name)); else if (e.name === 'index.html') pages.push({ path: '/' + path.relative(dist, d).split(path.sep).join('/') + (d === dist ? '' : '/'), status: 200 }); } };
walk(dist);
pages.push({ path: '/old/', status: 301, redirectsTo: '/older/' }, { path: '/older/', status: 301, redirectsTo: '/blog/hello-world/' });
const more = fs.existsSync('.health-more') ? [{ path: '/blog/also-gone/', linkedFrom: ['/blog/linker/'] }] : [];
console.log(JSON.stringify({ pages: pages.map((p) => ({ ...p, path: p.path.replace('//', '/') })), chains: [['/old/', '/older/', '/blog/hello-world/']], broken: [{ path: '/blog/gone/', linkedFrom: ['/blog/linker/', '/old/'] }, ...more] }));
`;

describe('site health: addresses', () => {
  let fx;
  let srv;
  let admin;
  let editor;

  before(async () => {
    fx = localeSite(makeFixture({ checks: false }));
    const cfg = path.join(fx.site, 'markstage.config.mjs');
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace("  redirects: {", "  health: { command: ['node', 'scripts/health.mjs'] },\n  redirects: {"));
    fs.writeFileSync(path.join(fx.site, 'scripts/health.mjs'), HOOK);
    fs.appendFileSync(path.join(fx.site, '.gitignore'), '.health-fail\n.health-junk\n.health-more\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A health hook');
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
    admin = await as(srv, 'administrator');
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(() => srv.close());

  test('the first look starts a check; then counts per kind; editors may not', async () => {
    assert.equal((await editor.get('/site/health/addresses')).status, 403);
    assert.equal((await editor.post('/site/health/addresses', {})).status, 403);
    const first = (await admin.get('/site/health')).json.addresses;
    assert.equal(first.on, true);
    assert.equal(first.running, true);
    await srv.app.addresses.refresh();
    const a = (await admin.get('/site/health')).json.addresses;
    assert.deepEqual(a.counts, { pages: a.counts.pages, redirects: 2, chains: 1, broken: 1 });
    assert.equal(a.error, null);
    assert.ok(a.at);
  });

  test('the lists: a broken address with the entries that link to it; chains; redirects; pages with their entries', async () => {
    const b = (await admin.get('/site/health/addresses?show=broken')).json;
    assert.equal(b.total, 1);
    assert.equal(b.items[0].path, '/blog/gone/');
    assert.deepEqual(b.items[0].linkedFrom.map((l) => [l.path, l.entry?.id ?? null]), [['/blog/linker/', 'linker'], ['/old/', null]]);
    assert.deepEqual((await admin.get('/site/health/addresses?show=chains')).json.items, [{ hops: ['/old/', '/older/', '/blog/hello-world/'], from: '/old/', to: '/blog/hello-world/' }]);
    assert.equal((await admin.get('/site/health/addresses?show=redirects&q=older')).json.total, 2);
    assert.equal((await admin.get('/site/health/addresses?show=nope')).status, 400);
  });

  test('a deploy checks again once the queue is idle', async () => {
    const was = (await admin.get('/site/health')).json.addresses.at;
    const e = await editor.get('/collections/posts/entries/hello-world');
    const r = await editor.post('/collections/posts/entries/hello-world/publish', { version: e.json.version });
    assert.equal(r.status, 202, r.text);
    await srv.app.jobs.idle();
    await new Promise((res) => setImmediate(res));
    await srv.app.addresses.refresh();
    const now = (await admin.get('/site/health')).json.addresses;
    assert.ok(now.at > was, 'checked again after the deploy');
    assert.equal(now.stale, false);
  });

  test('a failing hook says why and keeps the last good answer; Check again is audited', async () => {
    fs.writeFileSync(path.join(fx.site, '.health-fail'), '');
    try {
      const r = await admin.post('/site/health/addresses', {});
      assert.equal(r.status, 200, r.text);
      assert.match(r.json.error.message, /stopped with code 2: dist is missing/);
      assert.equal(r.json.counts.broken, 1, 'the last good answer stays');
      // the same failure again is not logged again (QA F20: one line, then quiet)
      const logged = [];
      const orig = console.error;
      console.error = (...a) => logged.push(a.join(' '));
      try {
        await admin.post('/site/health/addresses', {});
        await admin.post('/site/health/addresses', {});
      } finally {
        console.error = orig;
      }
      assert.equal(logged.filter((l) => l.includes('site health hook')).length, 0, 'logged once, at the first failure');
    } finally {
      fs.unlinkSync(path.join(fx.site, '.health-fail'));
    }
    fs.writeFileSync(path.join(fx.site, '.health-junk'), '');
    try {
      assert.match((await admin.post('/site/health/addresses', {})).json.error.message, /did not print JSON/);
    } finally {
      fs.unlinkSync(path.join(fx.site, '.health-junk'));
    }
    assert.equal((await admin.post('/site/health/addresses', {})).json.error, null);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'site.health.addresses'").get().n, 5);
  });

  test('a newly broken address is an alert for the administrators: once, never on the first check or a failure', async () => {
    const told = () => srv.app.db.prepare("SELECT user_id, text, link FROM notices WHERE kind = 'health.broken'").all();
    assert.deepEqual(told(), [], 'the same broken address as before is not news');
    fs.writeFileSync(path.join(fx.site, '.health-more'), '');
    try {
      await srv.app.addresses.refresh();
      const n = told();
      assert.deepEqual(n.map((x) => x.user_id), [admin.user.id], 'the administrator, not the editor');
      assert.equal(n[0].text, 'A page or link is broken on the live site since the last check: /blog/also-gone/.');
      assert.equal(n[0].link, '#/health?show=broken');
      await srv.app.addresses.refresh();
      assert.equal(told().length, 1, 'still broken: not told again');
    } finally {
      fs.unlinkSync(path.join(fx.site, '.health-more'));
    }
  });
});

test('config: the hook is an argv (no shell), from markstage.config or config.json', () => {
  const fx = makeFixture({ checks: false });
  const env = { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
  assert.throws(() => loadConfig({ env, overrides: { health: { command: 'node health.mjs' } } }), /health must be \{ command/);
  assert.deepEqual(loadConfig({ env, overrides: { health: { command: ['node', 'h.mjs'] } } }).health, { command: ['node', 'h.mjs'], timeoutSeconds: 120 });
  assert.equal(loadConfig({ env }).health, null);
});

test('the hook answer is checked: wrong shapes are refused, bad rows dropped', () => {
  assert.throws(() => readAnswer('{"pages": 3}'), /must print \{pages/);
  const a = readAnswer(JSON.stringify({ pages: [{ path: '/a/', status: 200 }, { path: 5, status: 200 }, { path: '/b/', status: '301' }], chains: [['/x/'], ['/x/', '/y/']], broken: [{ path: '/z/', linkedFrom: ['/a/', 7] }] }));
  assert.deepEqual(a, { pages: [{ path: '/a/', status: 200 }], chains: [['/x/', '/y/']], broken: [{ path: '/z/', linkedFrom: ['/a/'] }] });
});
