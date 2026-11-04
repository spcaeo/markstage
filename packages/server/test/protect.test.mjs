// Password-protected pages: setting a password (roles, rebuild into the private output), the visitor gate on the
// site host (form, wrong/right password, signed per-page cookie, noindex, lockout, auth_request), and isolation of
// the CMS from the site host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pagePath } from '../src/protect.mjs';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';

const SITE_HOST = 'www.site.test';

/** A raw request with a chosen Host header (fetch does not allow setting Host). */
function siteRequest(port, { method = 'GET', path: p, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { Host: SITE_HOST, ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const unlock = (port, p, password, origin = `https://${SITE_HOST}`, headers = {}) =>
  siteRequest(port, {
    method: 'POST',
    path: '/markstage/unlock',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ path: p, password }).toString(),
  });

describe('password-protected pages', () => {
  let fx;
  let srv;
  let editor;
  let carol;
  let cookie;
  const password = `page-${Math.random().toString(36).slice(2)}`;
  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { overrides: { trustProxy: true, protectedPages: { dir: path.join(fx.site, 'dist-private'), hosts: [SITE_HOST] }, login: { accountFreeFailures: 4, ipMaxAttempts: 1000, accountMaxFailures: 10, accountWindowSeconds: 3600 } } });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => srv.close());

  test('setting a password needs the publish right; the flag only changes through this route', async () => {
    const e = await carol.get('/collections/posts/entries/carol-draft');
    assert.equal((await carol.put('/collections/posts/entries/carol-draft/protection', { version: e.json.version, password })).status, 403);
    const hw = await editor.get('/collections/posts/entries/hello-world');
    const short = await editor.put('/collections/posts/entries/hello-world/protection', { version: hw.json.version, password: 'abc1234' });
    assert.equal(short.status, 422);
    assert.equal(short.json.fields.password, 'Use 8 to 200 characters.');
    assert.equal((await editor.put('/collections/posts/entries/hello-world', { version: hw.json.version, frontmatter: { protected: true } })).status, 422);
  });

  test('protecting a live page rebuilds it into the private output', async () => {
    const hw = await editor.get('/collections/posts/entries/hello-world');
    const r = await editor.put('/collections/posts/entries/hello-world/protection', { version: hw.json.version, password });
    assert.equal(r.status, 202);
    await srv.app.jobs.idle();
    assert.equal((await editor.get(`/jobs/${r.json.job}`)).json.status, 'succeeded');
    assert.ok(readFile(fx, 'src/content/blog/hello-world.md').includes('protected: true'));
    assert.ok(fs.existsSync(path.join(fx.site, 'dist-private/blog/hello-world/index.html')));
    assert.ok(!JSON.parse(fs.readFileSync(path.join(fx.live, 'index.json'), 'utf8')).includes('hello-world'), 'not in the public output');
    const src = await editor.get('/collections/posts/entries/hello-world/source');
    assert.ok(!src.json.source.includes(password), 'the password is never in the repo');
  });

  test('a visitor sees the password form (noindex), never the page', async () => {
    const r = await siteRequest(srv.port, { path: '/blog/hello-world/' });
    assert.equal(r.status, 200);
    assert.match(r.text, /This page is protected/);
    assert.ok(!r.text.includes('SECRET BODY'));
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    assert.equal((await siteRequest(srv.port, { path: '/blog/hello-world' })).status, 200, 'without the trailing slash too');
  });

  test('wrong password: 401 form; right password: 303 with a signed, page-scoped cookie', async () => {
    const bad = await unlock(srv.port, '/blog/hello-world/', 'nope');
    assert.equal(bad.status, 401);
    assert.match(bad.text, /not right/);
    const ok = await unlock(srv.port, '/blog/hello-world/', password);
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.location, '/blog/hello-world/');
    const sc = ok.headers['set-cookie'][0];
    for (const flag of ['Path=/blog/hello-world/', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(sc.includes(flag), flag);
    cookie = sc.split(';')[0];
    const page = await siteRequest(srv.port, { path: '/blog/hello-world/', headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.match(page.text, /SECRET BODY hello-world/);
    assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(page.headers['cache-control'], 'private, no-store');
    assert.equal(page.headers['content-security-policy'], undefined, "the site's own page keeps its own policy");
    const [name, value] = cookie.split('=');
    const [exp, mac] = value.split('.');
    const forged = `${name}=${Number(exp) + 1000}.${mac}`;
    assert.match((await siteRequest(srv.port, { path: '/blog/hello-world/', headers: { Cookie: forged } })).text, /This page is protected/);
  });

  test('nginx auth_request endpoint', async () => {
    assert.equal((await siteRequest(srv.port, { path: '/markstage/page-auth', headers: { 'X-Original-URI': '/blog/hello-world/', Cookie: cookie } })).status, 204);
    assert.equal((await siteRequest(srv.port, { path: '/markstage/page-auth', headers: { 'X-Original-URI': '/blog/hello-world/' } })).status, 401);
    assert.equal((await siteRequest(srv.port, { path: '/markstage/page-auth', headers: { 'X-Original-URI': '/blog/with-html/', Cookie: cookie } })).status, 401);
  });

  test('the site host reaches only the gate: no CMS API, no editor, no other files', async () => {
    assert.equal((await siteRequest(srv.port, { path: '/markstage/api/auth/me' })).status, 404);
    assert.equal((await siteRequest(srv.port, { path: '/markstage/' })).status, 404);
    assert.equal((await siteRequest(srv.port, { path: '/blog/with-html/' })).status, 404, 'not protected = not served here');
    for (const p of ['/blog/hello-world/../../../secret.txt', '/%2e%2e/%2e%2e/secret.txt', '/blog/hello-world/%2e%2e/x', '/blog/hello-world/index.html%00']) {
      const r = await siteRequest(srv.port, { path: p, headers: { Cookie: cookie } });
      assert.equal(r.status, 404, p);
      assert.ok(!r.text.includes('not content'));
    }
    assert.equal(pagePath('/a/%2e%2e/b'), null);
    assert.equal(pagePath('/a/b'), '/a/b/');
  });

  test('unlock from another origin is refused; repeated misses lock the page for that address, not for everyone', async () => {
    assert.equal((await unlock(srv.port, '/blog/hello-world/', password, 'https://evil.example')).status, 403);
    const from = (ip) => ({ 'X-Forwarded-For': ip });
    for (let i = 0; i < 4; i++) assert.equal((await unlock(srv.port, '/blog/hello-world/', 'nope', undefined, from('203.0.113.5'))).status, 401);
    const locked = await unlock(srv.port, '/blog/hello-world/', password, undefined, from('203.0.113.5'));
    assert.equal(locked.status, 423, 'the guesser\'s address waits');
    const other = await unlock(srv.port, '/blog/hello-world/', password, undefined, from('198.51.100.7'));
    assert.equal(other.status, 303, 'a visitor at another address gets in with the right password');
    const fail = srv.app.audit.list({ action: 'page.unlock.fail' }).items.find((e) => e.detail?.locked);
    assert.deepEqual([fail.detail.locked, fail.detail.seconds], ['device', 60]);
    // many misses from many addresses (the right password above cleared the page's hourly count): then the page
    // locks for everyone for a while
    for (let i = 0; i < 10; i++) assert.equal((await unlock(srv.port, '/blog/hello-world/', 'nope', undefined, from(`192.0.2.${i + 1}`))).status, 401);
    assert.equal((await unlock(srv.port, '/blog/hello-world/', password, undefined, from('198.51.100.8'))).status, 423, 'ten misses in the hour: the page itself is locked');
    srv.app.limiter.accountSuccess('page:posts/hello-world', '203.0.113.5');
    assert.equal((await unlock(srv.port, '/blog/hello-world/', password, undefined, from('198.51.100.9'))).status, 303);
  });

  test('a failed rebuild reverts the flag, and the gate follows the file, not the password table', async () => {
    const e = await editor.get('/collections/posts/entries/with-html');
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      const r = await editor.put('/collections/posts/entries/with-html/protection', { version: e.json.version, password });
      await srv.app.jobs.idle();
      assert.equal((await editor.get(`/jobs/${r.json.job}`)).json.status, 'failed');
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
    }
    assert.ok(!readFile(fx, 'src/content/blog/with-html.md').includes('protected'));
    assert.equal((await unlock(srv.port, '/blog/with-html/', password)).status, 404, 'not protected: no unlock');
  });

  test('a new password ends every old cookie; unprotecting moves the page back to public', async () => {
    let hw = await editor.get('/collections/posts/entries/hello-world');
    const r = await editor.put('/collections/posts/entries/hello-world/protection', { version: hw.json.version, password: `${password}-2` });
    assert.equal(r.status, 200, 'already protected: no file change, no rebuild');
    assert.equal(r.json.job, null);
    assert.match((await siteRequest(srv.port, { path: '/blog/hello-world/', headers: { Cookie: cookie } })).text, /This page is protected/);
    hw = await editor.get('/collections/posts/entries/hello-world');
    const off = await editor.del(`/collections/posts/entries/hello-world/protection?version=${hw.json.version}`);
    assert.equal(off.status, 202);
    await srv.app.jobs.idle();
    assert.ok(JSON.parse(fs.readFileSync(path.join(fx.live, 'index.json'), 'utf8')).includes('hello-world'));
    assert.equal((await siteRequest(srv.port, { path: '/blog/hello-world/' })).status, 404);
    assert.ok(!readFile(fx, 'src/content/blog/hello-world.md').includes('protected'));
  });
});
