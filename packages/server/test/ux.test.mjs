// The UX benchmark's server side: autosave history (time slices, private per person, compared and restorable),
// compare against what is live, the publish sheet's preflight (validate, checks, alt text, links, addresses), image
// edits saved as a new file next to the original, and stock photo search/import through a local stand-in provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { STOCK_KEY, fakeUnsplash } from './fake-stock.mjs';
import { as, fakeCodec, makeFixture, makePng, startServer } from './helpers.mjs';

const upload = (c, q, bytes) => c.request('POST', `/media?${new URLSearchParams(q)}`, { body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });

describe('autosave history, compare with live, preflight, image edits', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  const clock = { now: Date.UTC(2026, 9, 28, 12) };
  before(async () => {
    fx = makeFixture();
    // the autosave tests move the clock by hours: keep the sessions alive
    srv = await startServer(fx, { clock, overrides: { session: { idleMinutes: 100_000, absoluteHours: 10_000 } } });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('autosaves leave a trail: one snapshot per 5 minutes, private, readable and comparable', async () => {
    const e = await alice.get('/collections/posts/entries/hello-world/source');
    const put = (extra) => alice.put('/collections/posts/entries/hello-world/autosave', { baseVersion: e.json.version, source: e.json.source.replace('First paragraph.', extra) });
    assert.equal((await put('Draft one.')).status, 200);
    clock.now += 60_000;
    await put('Draft two.'); // same slice: replaces the snapshot above
    clock.now += 6 * 60_000;
    await put('Draft three.');
    const list = await alice.get('/collections/posts/entries/hello-world/autosaves');
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 2);
    const [newest, older] = list.json;
    assert.ok(newest.savedAt > older.savedAt);
    const one = await alice.get(`/collections/posts/entries/hello-world/autosaves/${older.id}`);
    assert.match(one.json.source, /Draft two\./);
    assert.ok(one.json.doc, 'parsed for the visual compare');
    // someone else's autosaves are not theirs to read
    assert.equal((await editor.get('/collections/posts/entries/hello-world/autosaves')).json.length, 0);
    assert.equal((await editor.get(`/collections/posts/entries/hello-world/autosaves/${older.id}`)).status, 404);
    assert.equal((await editor.get(`/collections/posts/entries/hello-world/compare?from=autosave:${older.id}`)).status, 404);
    // compare an autosave with the file: both sources, no git diff (an autosave is not a commit)
    const cmp = await alice.get(`/collections/posts/entries/hello-world/compare?from=autosave:${newest.id}&to=current`);
    assert.equal(cmp.status, 200, cmp.text);
    assert.match(cmp.json.from.source, /Draft three\./);
    assert.equal(cmp.json.to.source, e.json.source);
    assert.equal(cmp.json.diff, null);
  });

  test("a JSON change save stamps the entry's modified date in its own format, unless it sets it", async () => {
    fs.writeFileSync(path.join(fx.site, 'src/content/pages/team.json'), '{\n  "title": "Team",\n  "uri": "/team/",\n  "modified": "2026-01-01"\n}\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Team page');
    const read = async () => (await editor.get('/collections/pages/entries/team/source')).json;
    let cur = await read();
    assert.equal((await editor.put('/collections/pages/entries/team', { version: cur.version, changes: [{ path: 'title', value: 'Our team' }] })).status, 200);
    cur = await read();
    assert.match(cur.source, new RegExp(`"modified": "${new Date(clock.now).toISOString().slice(0, 10)}"`));
    assert.equal((await editor.put('/collections/pages/entries/team', { version: cur.version, changes: [{ path: 'modified', value: '2025-05-05' }, { path: 'title', value: 'Team' }] })).status, 200);
    assert.match((await read()).source, /"modified": "2025-05-05"/);
  });

  test('compare docs=1 parses both sides; an autosave is restored as a new revision, status kept', async () => {
    const list = (await alice.get('/collections/posts/entries/hello-world/autosaves')).json;
    const cmp = await alice.get(`/collections/posts/entries/hello-world/compare?from=autosave:${list[0].id}&to=current&docs=1`);
    assert.equal(cmp.json.from.doc.type, 'doc');
    assert.equal(cmp.json.to.doc.type, 'doc');
    assert.equal(cmp.json.to.frontmatter.title, 'Hello World', 'and its frontmatter');
    const revs = (await alice.get('/collections/posts/entries/hello-world/revisions')).json;
    const old = await alice.get(`/collections/posts/entries/hello-world/compare?from=${revs[0].sha}&docs=1`);
    assert.ok(old.json.from.doc && old.json.to.doc);
    const pages = await editor.get('/collections/pages/entries/about/compare?from=current&docs=1');
    assert.equal(pages.status, 200);
    assert.equal(pages.json.from.data.title, 'About', 'a JSON entry gets its data');
    const e = await alice.get('/collections/posts/entries/hello-world');
    assert.equal((await alice.post(`/collections/posts/entries/hello-world/autosaves/${list[0].id}/restore`, { version: 'stale' })).status, 409);
    const r = await alice.post(`/collections/posts/entries/hello-world/autosaves/${list[0].id}/restore`, { version: e.json.version });
    assert.equal(r.status, 200, r.text);
    const src = (await alice.get('/collections/posts/entries/hello-world/source')).json.source;
    assert.match(src, /Draft three\./);
    assert.match(fx.git('log', '-1', '--format=%an|%s'), /\|Restore posts\/hello-world to the autosave of /);
    assert.equal((await editor.post(`/collections/posts/entries/hello-world/autosaves/${list[0].id}/restore`, { version: r.json.version })).status, 404, "not someone else's autosave");
  });

  test('autosave history keeps the newest 40 per person and entry', async () => {
    const e = await alice.get('/collections/posts/entries/with-html/source');
    for (let i = 0; i < 43; i++) {
      clock.now += 6 * 60_000;
      await alice.put('/collections/posts/entries/with-html/autosave', { baseVersion: e.json.version, source: `${e.json.source}\nv${i}\n` });
    }
    const list = (await alice.get('/collections/posts/entries/with-html/autosaves')).json;
    assert.equal(list.length, 40);
    const newest = await alice.get(`/collections/posts/entries/with-html/autosaves/${list[0].id}`);
    assert.match(newest.json.source, /v42\n$/);
  });

  test('compare with live: nothing deployed yet, then the deployed text; a draft is not live', async () => {
    const before = await editor.get('/collections/posts/entries/hello-world/compare?from=live&to=current');
    assert.equal(before.status, 200);
    assert.equal(before.json.from.deployed, false);
    assert.equal(before.json.from.source, null);
    assert.equal(before.json.diff, null);

    const site = await editor.post('/site/publish', {});
    await srv.app.jobs.idle();
    assert.equal((await editor.get(`/jobs/${site.json.job}`)).json.status, 'succeeded');
    const live = await editor.get('/collections/posts/entries/hello-world/compare?from=live&to=current');
    assert.equal(live.json.from.deployed, true);
    assert.equal(live.json.from.source, live.json.to.source);
    assert.equal(live.json.diff, '');
    const draft = await editor.get('/collections/posts/entries/bob-draft/compare?from=live&to=current');
    assert.equal(draft.json.from.deployed, true);
    assert.equal(draft.json.from.source, null, 'a draft at the live commit was not on the site');

    // a saved change after the deploy shows as a diff against live
    const e = await editor.get('/collections/posts/entries/hello-world/source');
    assert.equal((await editor.put('/collections/posts/entries/hello-world/source', { version: e.json.version, source: e.json.source.replace('Second paragraph.', 'Second, edited.') })).status, 200);
    const after = await editor.get('/collections/posts/entries/hello-world/compare?from=live&to=current');
    assert.match(after.json.diff, /-Second paragraph\.\n\+Second, edited\./);
  });

  test('preflight: checks, images without alt text, links to drafts or nowhere, the address', async () => {
    const created = await alice.post('/collections/posts/entries', { title: 'Sheet Test' });
    assert.equal(created.status, 201, created.text);
    const id = created.json.id;
    const e = await alice.get(`/collections/posts/entries/${id}/source`);
    const body = [
      '<p><a href="/blog/bob-draft/">a draft</a> <a href="/blog/nowhere/">gone</a> <a href="/blog/hello-world/">fine</a> <a href="/uploads/x.png">file</a> <a href="https://example.com/">out</a></p>',
      '<p><img src="/uploads/a.png"> <img src="/uploads/b.png" alt="A chart"> <img src="/uploads/c.png" alt=""> <img src="/uploads/d.png" alt="  "></p>',
      'TODO finish',
    ].join('\n\n');
    const save = await alice.put(`/collections/posts/entries/${id}/source`, { version: e.json.version, source: `${e.json.source.trimEnd()}\n\n${body}\n` });
    assert.equal(save.status, 200, save.text);
    const pf = await alice.get(`/collections/posts/entries/${id}/preflight`);
    assert.equal(pf.status, 200, pf.text);
    assert.equal(pf.json.status, 'draft');
    assert.equal(pf.json.checks.ok, true, 'the TODO check only warns');
    assert.deepEqual(pf.json.checks.results.map((r) => [r.id, r.ok]), [['words', true], ['todo', false]]);
    // no alt, or a blank one, is flagged; alt="" is HTML's decorative mark and passes
    assert.deepEqual(pf.json.altText.map((a) => a.src).sort(), ['/uploads/a.png', '/uploads/d.png']);
    assert.deepEqual(
      pf.json.links.map((l) => [l.href, l.problem]),
      [
        ['/blog/bob-draft/', 'not-live'],
        ['/blog/nowhere/', 'unknown'],
      ],
    );
    assert.equal(pf.json.links[0].target.title, 'Bob Draft');
    assert.deepEqual(pf.json.addresses, [{ locale: null, path: `/blog/${id}/`, url: null }]);
    assert.equal(pf.json.version, (await alice.get(`/collections/posts/entries/${id}`)).json.version);
    assert.equal((await alice.get('/collections/posts/entries/nope/preflight')).status, 404);
  });

  test('an image edit is a new file next to the original, which stays; the original lists its edits', async () => {
    const orig = await upload(alice, { filename: 'Team Photo.png' }, makePng());
    assert.equal(orig.status, 201);
    await alice.patch(`/media/${orig.json.id}`, { alt: 'The team at the office' });
    const before = fs.readFileSync(path.join(fx.site, orig.json.path));
    const calls = fakeCodec.calls;
    const edit = await upload(alice, { filename: 'crop.png', from: orig.json.id }, makePng(Buffer.from('cropped')));
    assert.equal(edit.status, 201, edit.text);
    assert.equal(fakeCodec.calls, calls + 1, 're-encoded like any upload');
    assert.equal(edit.json.derivedFrom, orig.json.id);
    assert.equal(edit.json.alt, 'The team at the office', "the original's alt text comes along");
    assert.equal(edit.json.filename, 'team-photo-edited.png');
    assert.notEqual(edit.json.path, orig.json.path);
    assert.deepEqual(fs.readFileSync(path.join(fx.site, orig.json.path)), before, 'the original is untouched');
    assert.match(fx.git('log', '-1', '--format=%s'), /^Edit src\/assets\/uploads\/.*team-photo\.png as .*team-photo-edited\.png/);
    const o = await alice.get(`/media/${orig.json.id}`);
    assert.deepEqual(o.json.derivatives.map((d) => d.id), [edit.json.id]);
    assert.equal(srv.app.db.prepare('SELECT action FROM audit WHERE target = ?').get(edit.json.id).action, 'media.edit');
    assert.equal((await upload(alice, { filename: 'x.png', from: 'm_nope' }, makePng())).status, 404);
  });
});

describe('stock photos', () => {
  let fx;
  let srv;
  let provider;
  let carol;
  before(async () => {
    provider = await fakeUnsplash();
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { overrides: { stock: { provider: 'unsplash', key: STOCK_KEY, apiBase: provider.base, imageHosts: [provider.host] } } });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => {
    srv.close();
    provider.close();
  });

  test('search goes through the server with the site key; thumbnails are proxied; the key never reaches the browser', async () => {
    const info = await carol.get('/stock');
    assert.deepEqual(info.json, { enabled: true, provider: 'unsplash', label: 'Unsplash' });
    const r = await carol.get('/stock/search?q=office');
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes(STOCK_KEY));
    assert.ok(!r.text.includes(provider.base), 'no provider URLs to fetch from the browser');
    assert.deepEqual(r.json.items.map((i) => i.id), ['p1', 'p2', 'p3']);
    assert.equal(r.json.items[0].author, 'Ada Lens');
    assert.match(r.json.items[0].thumb, /^stock\/thumb\/[\w-]+$/);
    assert.equal(provider.seen.auth.at(-1), `Client-ID ${STOCK_KEY}`);
    const t = await carol.get(`/${r.json.items[0].thumb}`, { raw: true });
    assert.equal(t.status, 200);
    assert.equal(t.headers.get('content-type'), 'image/png');
    assert.equal((await carol.get('/stock/thumb/unknown-token')).status, 404);
    assert.equal((await carol.get('/stock/search?q=')).status, 422);
  });

  test('import fetches the photo by id, stores it like an upload with the credit, and counts the download', async () => {
    const r = await carol.post('/stock/import', { id: 'p2' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.alt, 'photo p2');
    assert.deepEqual(r.json.credit, { provider: 'unsplash', label: 'Unsplash', id: 'p2', author: 'Ada Lens', authorUrl: 'https://unsplash.example/@ada', sourceUrl: 'https://unsplash.example/photos/p2' });
    assert.match(r.json.path, /unsplash-ada-lens-p2\.png$/);
    assert.ok(fs.existsSync(path.join(fx.site, r.json.path)));
    for (let i = 0; i < 20 && !provider.seen.tracked; i++) await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(provider.seen.tracked, 1);
    // ids only: no URLs from the browser
    assert.equal((await carol.post('/stock/import', { id: 'http://198.51.100.7/x.png' })).status, 400);
    // a photo link off the provider's image hosts is never fetched
    const off = await carol.post('/stock/import', { id: 'offhost' });
    assert.equal(off.status, 502);
    assert.ok(!provider.seen.paths.includes('/x'), 'nothing fetched');
    // a non-image is refused like any upload
    assert.equal((await carol.post('/stock/import', { id: 'notimage' })).status, 415);
    assert.equal((await carol.post('/stock/import', { id: 'p9-missing' })).status, 404);
  });

  test('signed out: 401; not configured: off', async () => {
    const anon = await carol.post('/auth/logout', {});
    assert.ok(anon.status < 500);
    assert.equal((await carol.get('/stock/search?q=x')).status, 401);
    const fx2 = makeFixture({ checks: false });
    const srv2 = await startServer(fx2);
    try {
      const ed = await as(srv2, 'editor', { authorSlug: 'ed' });
      assert.deepEqual((await ed.get('/stock')).json, { enabled: false });
      assert.equal((await ed.get('/stock/search?q=x')).status, 404);
    } finally {
      srv2.close();
    }
  });
});

test("alt text: an image is decorative when its figure has the site's decorative class (core image attrs)", async () => {
  const { missingAlt } = await import('../src/preflight.mjs');
  const img = (alt, figure) => ({ type: 'image', attrs: { src: `/${alt || 'x'}-${figure}.png`, alt, title: null, figure, caption: null } });
  const doc = { type: 'doc', content: [img('', null), img('', 'wide decorative'), img('', ''), img('A cat', null), img('', 'flourish')] };
  assert.deepEqual(missingAlt(doc, {}).map((a) => a.src), ['/x-null.png', '/x-.png', '/x-flourish.png']);
  assert.deepEqual(missingAlt(doc, {}, 'flourish').map((a) => a.src), ['/x-null.png', '/x-wide decorative.png', '/x-.png']);
});

test('alt text: a cover with no alt written counts as described when its altFallback key (the title) is filled', async () => {
  const { missingAlt } = await import('../src/preflight.mjs');
  const images = [{ key: 'cover.src', alt: 'cover.alt', altFallback: 'title' }];
  const cover = (alt) => ({ src: '/uploads/c.webp', alt, width: 10 });
  assert.deepEqual(missingAlt(null, { title: 'Hello', cover: cover('') }, 'decorative', images), [], 'the title stands in, as the site draws it');
  assert.deepEqual(missingAlt(null, { title: '', cover: cover('') }, 'decorative', images).map((a) => a.where), ['cover'], 'no title either: missing');
  assert.deepEqual(missingAlt(null, { title: '', cover: cover('A desk') }, 'decorative', images), []);
  assert.deepEqual(missingAlt(null, { title: 'Hello', cover: cover('') }).map((a) => a.where), ['cover'], 'without the setting the rule is as before');
  // a cover kept as a plain path with its own alt key
  const flat = [{ key: 'hero', alt: 'heroAlt', altFallback: null }];
  assert.deepEqual(missingAlt(null, { hero: '/uploads/h.png', heroAlt: '' }, 'decorative', flat).map((a) => a.where), ['hero']);
});
