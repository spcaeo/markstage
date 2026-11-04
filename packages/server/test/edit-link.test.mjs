// "Edit this page": the marker cookie a signed-in user gets (JS-readable, no longer than the session, gone at
// sign-out), refused with a reason when the site cannot read it or its build expects another CMS; and the entry at
// a page address, for the editor's #/edit screen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createMarkstage, loadConfig } from '../src/app.mjs';
import { cookieDomain } from '../src/edit-link.mjs';
import { as, client, fakeCodec, freePort, makeFixture } from './helpers.mjs';
import * as stubCore from './stub-core.mjs';

const siteConfig = ({ cms, siteUrl }) => `export default {
  siteName: 'Fixture',
  siteUrl: ${JSON.stringify(siteUrl)},
  ${cms ? `editButton: { cms: ${JSON.stringify(cms)} },` : ''}
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '{uri}' },
  ],
};
`;

async function serve({ cms = 'self', siteUrl }) {
  const fx = makeFixture({ checks: false });
  const port = await freePort();
  const own = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), siteConfig({ cms: cms === 'self' ? own : cms, siteUrl: siteUrl ?? `http://127.0.0.1:${port + 2}` }));
  // the edit address names this server's own origin, so the port is chosen before the config is written
  const config = loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port, collections: [] } });
  const app = await createMarkstage(config, { core: stubCore, codec: fakeCodec });
  await app.listen(port, '127.0.0.1');
  return { app, base: own, close: () => app.close() };
}

test('cookieDomain: the same host (any port) is host-only; a shared parent of two labels; else none', () => {
  assert.equal(cookieDomain('127.0.0.1', '127.0.0.1'), null);
  assert.equal(cookieDomain('example.com', 'example.com'), null);
  assert.equal(cookieDomain('cms.example.com', 'www.example.com'), 'example.com');
  assert.equal(cookieDomain('cms.example.com', 'example.com'), 'example.com');
  assert.equal(cookieDomain('cms.agency.com', 'client.com'), undefined);
  assert.equal(cookieDomain('a.com', 'b.com'), undefined);
  assert.equal(cookieDomain('127.0.0.1', 'localhost'), undefined);
  assert.equal(cookieDomain('10.0.0.2', '10.0.0.3'), undefined);
});

describe('edit button: the cookie', () => {
  let srv, ed, author;
  before(async () => {
    srv = await serve({});
    ed = await as(srv, 'editor');
    author = await as(srv, 'contributor');
  });
  after(() => srv.close());

  test('a signed-in user gets the JS-readable cookie with the edit address, for the session only', async () => {
    const r = await ed.get('/site/edit-button');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.on, true);
    assert.equal(r.json.domain, null);
    const sc = r.res.headers.getSetCookie().find((c) => c.startsWith('_ed='));
    assert.ok(sc, 'the cookie is set');
    assert.equal(decodeURIComponent(sc.split(';')[0].slice(4)), `${srv.base}/markstage/#/edit?to=`);
    assert.doesNotMatch(sc, /HttpOnly|Domain=/);
    assert.match(sc, /Path=\//);
    assert.match(sc, /SameSite=Lax/);
    const age = Number(/Max-Age=(\d+)/.exec(sc)[1]);
    assert.ok(age > 0 && age <= srv.app.sessions.absoluteMs / 1000, String(age));
    assert.equal(r.json.bookmarklet, `javascript:location.href="${srv.base}/markstage/#/edit?to="+encodeURIComponent(location.pathname)`);
    // every role can edit something (a contributor their own drafts): it is set for them too
    assert.equal((await author.get('/site/edit-button')).json.on, true);
  });

  test('signed out: no cookie (401); signing out clears it', async () => {
    const anon = client(srv.base);
    assert.equal((await anon.get('/site/edit-button')).status, 401);
    const out = await ed.post('/auth/logout', {});
    assert.ok([200, 204].includes(out.status), out.text);
    const cleared = out.res.headers.getSetCookie().find((c) => c.startsWith('_ed='));
    assert.ok(cleared, 'cleared at sign-out');
    assert.match(cleared, /^_ed=;.*Max-Age=0/);
  });
});

describe('edit button: refused with a reason', () => {
  test('the site does not have one; its build expects another CMS; the site cannot read the cookie', async () => {
    for (const [opts, reason, re] of [
      [{ cms: null }, 'off', /no edit button/],
      [{ cms: 'https://cms.example.com' }, 'other-cms', /expects the editor at https:\/\/cms\.example\.com/],
      [{ siteUrl: 'https://www.example.com' }, 'other-domain', /share no host name/],
    ]) {
      const srv = await serve(opts);
      try {
        const ed = await as(srv, 'editor');
        const r = await ed.get('/site/edit-button');
        assert.equal(r.status, 200, r.text);
        assert.equal(r.json.on, false);
        assert.equal(r.json.reason, reason);
        assert.match(r.json.message, re);
        assert.ok(r.json.bookmarklet.startsWith('javascript:location.href='), 'the bookmarklet still works');
        assert.equal(r.res.headers.getSetCookie().filter((c) => c.startsWith('_ed=')).length, 0);
      } finally {
        await srv.close();
      }
    }
  });
});

describe('the entry at a page address', () => {
  let srv, ed, contributor;
  before(async () => {
    srv = await serve({});
    ed = await as(srv, 'editor');
    contributor = await as(srv, 'contributor');
  });
  after(() => srv.close());

  test('a page and a post by their address (with or without the trailing slash, index.html, a query)', async () => {
    const at = async (p) => (await ed.get(`/site/entry-at?path=${encodeURIComponent(p)}`)).json;
    assert.deepEqual(await at('/about/'), { collection: 'pages', id: 'about', title: 'About', url: '/about/', locale: null, can: { edit: true, publish: true, delete: true, rawHtml: true } });
    for (const p of ['/about', '/about/index.html', '/about/?utm=x#top']) assert.equal((await at(p)).id, 'about', p);
    const post = await at('/blog/hello-world/');
    assert.deepEqual([post.collection, post.id], ['posts', 'hello-world']);
  });

  test('says what the user may do; unknown address 404; a bad path 400; signed out 401', async () => {
    const r = await contributor.get('/site/entry-at?path=/about/');
    assert.equal(r.json.can.edit, false);
    assert.equal((await ed.get('/site/entry-at?path=/nowhere/')).status, 404);
    assert.equal((await ed.get('/site/entry-at?path=/nowhere/')).json.message, 'No entry has this address.');
    for (const p of ['about', '//evil.example/', '']) assert.equal((await ed.get(`/site/entry-at?path=${encodeURIComponent(p)}`)).status, 400, p);
    assert.equal((await client(srv.base).get('/site/entry-at?path=/about/')).status, 401);
  });
});
