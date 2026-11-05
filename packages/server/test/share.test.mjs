// Share links: a release's preview, or one draft as it would go live, for people without an account, on the share
// origin only. The token opens it once into a cookie for that link; every page view is audited; every answer says
// noindex, no-store, no-referrer. Turned off or expired, it answers 410. Nothing else is reachable with it.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, readFile, startServer } from './helpers.mjs';
import { redactShare } from '../src/releases/share.mjs';
import { releaseServer } from './release-site.mjs';

describe('share links', () => {
  let fx, srv, clock, shareOrigin, ed, rel;
  const idle = () => srv.app.jobs.idle();
  const audits = (action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
  /** A visitor with no account: a cookie jar of its own, on the share origin. */
  const visitor = () => {
    let jar = '';
    return async (p, { method = 'GET', headers = {} } = {}) => {
      const res = await fetch(p.startsWith('http') ? p : `${shareOrigin}${p}`, { method, redirect: 'manual', headers: { ...(jar ? { Cookie: jar } : {}), ...headers } });
      const set = res.headers.get('set-cookie');
      if (set) jar = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, headers: res.headers, text: await res.text(), jar: () => jar, setJar: (j) => (jar = j) };
    };
  };
  const tokens = []; // every link's token made here: none may be anywhere in the data folder (the last test)
  const linkFor = async (body, who = ed) => {
    const r = await who.post('/share-links', body);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    tokens.push(r.json.url.split('/share/')[1]);
    return r.json;
  };

  before(async () => {
    // behind a proxy: a request without X-Forwarded-For is its socket's address, one with it is many visitors
    ({ fx, srv, clock, shareOrigin } = await releaseServer({ overrides: { trustProxy: true } }));
    ed = await as(srv, 'editor');
    rel = (await ed.post('/releases', { name: 'Preview me' })).json;
    const v = (await ed.get('/collections/posts/entries/bob-draft')).json.version;
    assert.equal((await ed.post(`/releases/${rel.id}/items`, { kind: 'entry', collection: 'posts', id: 'bob-draft', version: v })).status, 201);
  });
  after(() => srv.close());

  test('a link opens the release’s preview without an account: the token leaves the address; noindex, no-store, no-referrer; each page view audited', async () => {
    const { link, url } = await linkFor({ release: rel.id, label: 'For the client' });
    assert.match(url, new RegExp(`^${shareOrigin}/share/[A-Za-z0-9_-]{43}$`));
    assert.deepEqual([link.state, link.views, link.label], ['active', 0, 'For the client']);
    assert.equal(Date.parse(link.expiresAt) - clock.now, 7 * 86_400_000, 'a week by default');
    // only the token's hash is kept
    const token = url.split('/share/')[1];
    assert.equal(JSON.stringify(srv.app.db.prepare('SELECT * FROM share_links').all()).includes(token), false);
    const go = visitor();
    const open = await go(url);
    assert.equal(open.status, 303);
    assert.equal(open.headers.get('location'), '/blog/bob-draft/');
    assert.match(open.headers.get('set-cookie'), /^ms_share=sl_[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/);
    // the first look builds it; the page says so and reloads itself
    const wait = await go('/blog/bob-draft/');
    assert.equal(wait.status, 503);
    assert.equal(wait.headers.get('refresh'), '3');
    assert.match(wait.text, /Preparing this preview/);
    await idle();
    const page = await go('/blog/bob-draft/');
    assert.equal(page.status, 200);
    assert.match(page.text, /A draft by Bob/, 'the draft, as it would go live');
    for (const [h, v] of [['x-robots-tag', 'noindex, nofollow, noarchive'], ['cache-control', 'no-store'], ['referrer-policy', 'no-referrer'], ['content-type', 'text/html; charset=utf-8']]) assert.equal(page.headers.get(h), v, h);
    // the site's own files load, the robots file says no whatever the build has, and a missing page is the site's 404
    assert.equal((await go('/site.js')).status, 200);
    assert.equal((await go('/robots.txt')).text, 'User-agent: *\nDisallow: /\n');
    const missing = await go('/nope/');
    assert.deepEqual([missing.status, missing.text], [404, '<!doctype html><title>Not found</title>']);
    await go('/blog/hello-world/');
    const views = audits('share.view');
    assert.deepEqual(views.map((a) => [a.target, a.user_name, JSON.parse(a.detail).path]), [[link.id, 'share link', '/blog/bob-draft/'], [link.id, 'share link', '/blog/hello-world/']]);
    const listed = (await ed.get(`/share-links?release=${rel.id}`)).json.links.find((l) => l.id === link.id);
    assert.equal(listed.views, 2);
    assert.equal(listed.token, undefined);
    // the repo and the live site are as they were
    assert.match(readFile(fx, 'src/content/blog/bob-draft.md'), /^draft: true$/m);
  });

  test('a link turned off answers 410, at its address and on every page; the person who made it or an editor turns it off', async () => {
    const { link, url } = await linkFor({ release: rel.id });
    const go = visitor();
    await go(url);
    await idle();
    assert.equal((await go('/blog/bob-draft/')).status, 200);
    const author = await as(srv, 'author', { authorSlug: 'alice' });
    assert.equal((await author.del(`/share-links/${link.id}`)).status, 403);
    const off = await ed.del(`/share-links/${link.id}`);
    assert.equal(off.json.link.state, 'revoked');
    const page = await go('/blog/bob-draft/');
    assert.equal(page.status, 410);
    assert.match(page.text, /This link was turned off/);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal((await visitor()(url)).status, 410);
    assert.ok(audits('share.refused').some((a) => a.target === link.id));
    assert.ok(audits('share.revoke').some((a) => a.target === link.id));
  });

  test('an expired link answers 410; a link lasts 1 to 30 days', async () => {
    const { url } = await linkFor({ release: rel.id, days: 2 });
    const go = visitor();
    assert.equal((await go(url)).status, 303);
    await idle();
    assert.equal((await go('/blog/bob-draft/')).status, 200);
    clock.now += 2 * 86_400_000;
    const page = await go('/blog/bob-draft/');
    assert.equal(page.status, 410);
    assert.match(page.text, /This link has expired/);
    assert.equal((await visitor()(url)).status, 410);
    // two days on, the editor's session is over too
    ed = await as(srv, 'editor');
    assert.equal((await ed.post('/share-links', { release: rel.id, days: 31 })).status, 400);
    assert.equal((await ed.post('/share-links', { release: rel.id, days: 0 })).status, 400);
  });

  test('nothing else is reachable: no API, no writes, no path out of the build, no forged cookie, no other host, no link without its token', async () => {
    const { url } = await linkFor({ release: rel.id });
    const go = visitor();
    await go(url);
    await idle();
    for (const p of ['/markstage/api/auth/session', '/markstage/', '/markstage/api/releases']) assert.equal((await go(p)).status, 404, p);
    assert.equal((await go('/blog/bob-draft/', { method: 'POST' })).status, 405);
    for (const p of ['/..%2f..%2fsecret.txt', '/%2e%2e/%2e%2e/secret.txt', '/../../markstage.db']) assert.equal((await go(p)).status, 404, p);
    // the cookie names one link, signed: another id, or a bad signature, is nobody's
    const jar = (await go('/site.js')).jar();
    const [name, value] = jar.split('=');
    const [, exp, sig] = value.split('.');
    const forged = visitor();
    for (const v of [`sl_other.${exp}.${sig}`, `${value.split('.')[0]}.${exp}.${sig.slice(0, -2)}xx`, value.split('.').slice(0, 2).join('.')]) {
      const r = await forged('/blog/bob-draft/', { headers: { Cookie: `${name}=${v}` } });
      assert.equal(r.status, 403, v);
      assert.match(r.text, /Not available to you/);
    }
    assert.equal((await visitor()('/blog/bob-draft/')).status, 403, 'no cookie');
    assert.equal((await visitor()('/share/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status, 404);
    // another host name (a rebinding page): fetch keeps its own Host header, so a raw request
    const other = await new Promise((resolve, reject) => {
      const req = http.request(`${shareOrigin}/blog/bob-draft/`, { headers: { Host: 'evil.example', Cookie: jar } }, (res) => (res.resume(), resolve(res.statusCode)));
      req.on('error', reject);
      req.end();
    });
    assert.equal(other, 421);
    // the CMS origin does not serve the share address either
    assert.equal((await fetch(`${srv.base}${new URL(url).pathname}`, { redirect: 'manual' })).status, 404);
  });

  test('a draft’s own link shows it as published; once it is live the link has nothing to show (410); writers share only what they can edit', async () => {
    const author = await as(srv, 'author', { authorSlug: 'carol' });
    assert.equal((await author.post('/share-links', { collection: 'posts', id: 'bob-draft' })).status, 403);
    assert.equal((await author.post('/share-links', { release: rel.id })).status, 403);
    assert.equal((await ed.post('/share-links', { collection: 'posts', id: 'hello-world' })).status, 422, 'live already');
    const { link, url } = await linkFor({ collection: 'posts', id: 'carol-draft' }, author);
    const go = visitor();
    const open = await go(url);
    assert.equal(open.headers.get('location'), '/blog/carol-draft/');
    assert.equal((await go('/blog/carol-draft/')).status, 503);
    await idle();
    const page = await go('/blog/carol-draft/');
    assert.equal(page.status, 200);
    assert.match(page.text, /Carol writes\./);
    // the draft changes: the next look builds it again
    const v = (await ed.get('/collections/posts/entries/carol-draft')).json.version;
    assert.equal((await ed.put('/collections/posts/entries/carol-draft/source', { version: v, source: readFile(fx, 'src/content/blog/carol-draft.md').replace('Carol writes.', 'Carol rewrites.') })).status, 200);
    assert.equal((await go('/blog/carol-draft/')).status, 503);
    await idle();
    assert.match((await go('/blog/carol-draft/')).text, /Carol rewrites\./);
    // published: the link is done
    const pub = await ed.post('/collections/posts/entries/carol-draft/publish', { version: (await ed.get('/collections/posts/entries/carol-draft')).json.version });
    assert.equal(pub.status, 202);
    await idle();
    const gone = await go('/blog/carol-draft/');
    assert.equal(gone.status, 410);
    assert.match(gone.text, /This page is live now/);
    // turned off, its preview folder goes at the next sweep
    const dir = path.join(fx.data, 'releases', 'builds', 'e_posts_carol-draft');
    assert.ok(fs.existsSync(dir));
    await srv.app.releases.sweep();
    assert.ok(fs.existsSync(dir), 'a live link keeps it');
    await author.del(`/share-links/${link.id}`);
    await srv.app.releases.sweep();
    assert.equal(fs.existsSync(dir), false);
  });

  test('tries at /share/ are limited to 30 a minute for each address: then 429 with Retry-After, audited once; a minute on it opens again', async () => {
    clock.now += 61_000; // the earlier tests' tries are a minute old
    const go = visitor();
    const fake = (i) => `/share/${String(i).padStart(43, 'x')}`;
    for (let i = 0; i < 30; i++) assert.equal((await go(fake(i))).status, 404, `try ${i + 1}`);
    const first = audits('share.limited').length;
    const over = await go(fake(30));
    assert.equal(over.status, 429);
    assert.equal(over.headers.get('retry-after'), '60');
    assert.match(over.text, /Too many tries/);
    assert.equal(over.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    // a real link is refused too while the limit holds; pages under a cookie are not tries
    const { url } = await linkFor({ release: rel.id });
    assert.equal((await go(url)).status, 429);
    assert.equal((await go(fake(31))).status, 429);
    assert.equal(audits('share.limited').length, first + 1, 'audited once, not on every try');
    assert.equal((await visitor()('/robots.txt')).status, 200);
    clock.now += 61_000;
    const open = await go(url);
    assert.equal(open.status, 303);
    assert.equal((await go(open.headers.get('location'))).status === 429, false);
  });

  test('a flood of tries stays small in the database: a refused try is not stored, an IPv6 /64 counts as one address, passed tries go within a minute', async () => {
    const rows = () => srv.app.db.prepare("SELECT COUNT(*) AS n FROM limit_hits WHERE bucket = 'share.try'").get().n;
    // the address comes from the proxy's header here (trustProxy), so one test can be many visitors
    clock.now += 61_000;
    const go = visitor();
    const fake = (i) => `/share/${String(i).padStart(43, 'y')}`;
    const statuses = [];
    // rotating addresses inside one IPv6 /64, as a flood would
    for (let i = 0; i < 120; i++) statuses.push((await go(fake(i), { headers: { 'X-Forwarded-For': `2001:db8:7:9::${(i + 1).toString(16)}` } })).status);
    assert.deepEqual([statuses.filter((s) => s === 404).length, statuses.filter((s) => s === 429).length], [30, 90], 'the whole /64 gets 30 tries a minute');
    assert.equal(rows(), 30, 'only the tries let through are stored (the earlier tests’ were swept, a minute old)');
    // one try a minute on, from anywhere: every passed try of every address is deleted by it
    clock.now += 61_000;
    assert.equal((await go(fake(500), { headers: { 'X-Forwarded-For': '198.51.100.7' } })).status, 404);
    assert.equal(rows(), 1);
  });

  test('the site moves under a link: the next page builds it again on the new commit, never the old build', async () => {
    clock.now += 61_000;
    const { url } = await linkFor({ release: rel.id });
    const go = visitor();
    assert.equal((await go(url)).status, 303);
    let page = await go('/blog/bob-draft/');
    if (page.status === 503) {
      await idle();
      page = await go('/blog/bob-draft/');
    }
    assert.equal(page.status, 200);
    assert.equal((await go('/blog/moved-on-main/')).status, 404, 'not on the site yet');
    // an unrelated change goes live on the site's branch
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/moved-on-main.md'), `---\ntitle: Moved on main\nauthor: alice\ndate: '2026-11-01T10:00:00.000Z'\n---\n\nA change that went live meanwhile.\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Another change went live');
    const wait = await go('/blog/bob-draft/');
    assert.equal(wait.status, 503, 'the old build is not served');
    assert.match(wait.text, /Preparing this preview/);
    await idle();
    const now = await go('/blog/moved-on-main/');
    assert.equal(now.status, 200);
    assert.match(now.text, /A change that went live meanwhile/);
    assert.match((await go('/blog/bob-draft/')).text, /A draft by Bob/, 'with the release on top');
  });

  test('an error while a link is opened is logged with /share/[link], never the token', async () => {
    clock.now += 61_000;
    const { url } = await linkFor({ release: rel.id });
    const token = url.split('/share/')[1];
    const said = [];
    const was = { error: console.error, prepare: srv.app.db.prepare };
    console.error = (...a) => said.push(a.map(String).join(' '));
    srv.app.db.prepare = function (sql) {
      if (sql.includes('token_hash = ?')) throw new Error(`the lookup failed for GET ${url}`);
      return was.prepare.call(this, sql);
    };
    let r;
    try {
      r = await visitor()(url);
    } finally {
      console.error = was.error;
      srv.app.db.prepare = was.prepare;
    }
    assert.equal(r.status, 500);
    assert.equal(r.text.includes(token), false);
    const out = said.join('\n');
    assert.match(out, /\[markstage\] share: Error: the lookup failed for GET https?:\/\/[^ ]+\/share\/\[link\]/);
    assert.equal(out.includes(token), false);
  });

  test('a token is nowhere in the data folder (database, its journal, builds, everything), only its hash; logs say /share/[link]', async () => {
    // one more, through its whole life: made, opened, two pages seen, turned off
    const { link, url } = await linkFor({ release: rel.id });
    clock.now += 61_000;
    const go = visitor();
    assert.equal((await go(url)).status, 303);
    for (const p of ['/blog/bob-draft/', '/blog/hello-world/']) {
      let r = await go(p);
      if (r.status === 503) {
        await idle();
        r = await go(p);
      }
      assert.equal(r.status, 200, p);
    }
    assert.equal((await ed.del(`/share-links/${link.id}`)).status, 200);
    assert.equal((await go('/blog/bob-draft/')).status, 410);
    assert.ok(tokens.length >= 8, String(tokens.length));
    await idle();
    srv.app.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    const files = [];
    const walk = (dir) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p);
        else if (d.isFile()) files.push(p);
      }
    };
    walk(fx.data);
    assert.ok(files.some((f) => f.endsWith('.db')) && files.some((f) => f.includes(`${path.sep}builds${path.sep}`)), files.join('\n'));
    for (const f of files) {
      const bytes = fs.readFileSync(f);
      for (const t of tokens) assert.equal(bytes.includes(t), false, `${path.relative(fx.data, f)} holds a token`);
    }
    const hashes = new Set(srv.app.db.prepare('SELECT token_hash FROM share_links').all().map((r) => r.token_hash));
    for (const t of tokens) assert.ok(hashes.has(crypto.createHash('sha256').update(t).digest('hex')), 'its hash is kept');
    assert.equal(redactShare(`Error at GET https://share.example.com/share/${tokens[0]} (x)`), 'Error at GET https://share.example.com/share/[link] (x)');
  });
});

describe('share links off', () => {
  test('without share.origin a link cannot be made, in words; the share origin must be its own', async () => {
    const { srv } = await releaseServer({ share: false });
    try {
      const ed = await as(srv, 'editor');
      const r = (await ed.post('/releases', { name: 'x' })).json;
      const s = await ed.post('/share-links', { release: r.id });
      assert.equal(s.status, 409);
      assert.match(s.json.message, /share\.origin/);
      assert.deepEqual((await ed.get('/share-links')).json, { links: [], on: false });
    } finally {
      await srv.close();
    }
    const { fx, srv: other } = await releaseServer({ share: false });
    await other.close();
    await assert.rejects(startServer(fx, { overrides: { share: { origin: 'https://share.example.com/x', port: 18251 } } }), /origin only/);
    await assert.rejects(startServer(fx, { overrides: { share: { origin: 'http://share.example.com', port: 18251 } } }), /https/);
    await assert.rejects(startServer(fx, { overrides: { share: { origin: 'https://share.example.com', port: 18251, days: 40 } } }), /share\.days/);
  });
});
