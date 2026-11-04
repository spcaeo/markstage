// Undo a change to many entries (the Undo on the toast after find and replace, or replacing an image everywhere):
// each entry goes back to its text before that commit in one new commit, and the live ones are rebuilt; an entry
// changed since is named and left as it is; a change is undone once; only those two kinds of change, and only for
// editors and above.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, fakeCodec, makeFixture, makePng, startServer } from './helpers.mjs';

const upload = (c, name) => c.request('POST', `/media?filename=${encodeURIComponent(name)}`, { body: makePng(), headers: { 'Content-Type': 'application/octet-stream' } });

describe('undo a change to many entries', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  const src = async (id) => (await editor.get(`/collections/posts/entries/${id}/source`)).json;
  const put = async (id, f) => {
    const s = await src(id);
    assert.equal((await editor.put(`/collections/posts/entries/${id}/source`, { version: s.version, source: f(s.source) })).status, 200);
  };
  const replace = async (q, w) => {
    const found = (await editor.get(`/site/find?q=${encodeURIComponent(q)}&with=x`)).json.entries;
    const r = await editor.post('/site/replace', { q, with: w, entries: found.map(({ collection, id, version }) => ({ collection, id, version })) });
    assert.equal(r.status, 200, r.text);
    await srv.app.jobs.idle();
    return r.json;
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { codec: fakeCodec });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    await put('hello-world', (t) => `${t.trimEnd()}\n\nAcme Tools makes tools.\n`);
    await put('bob-draft', (t) => `${t.trimEnd()}\n\nBob likes Acme Tools.\n`);
  });
  after(() => srv.close());

  test('find and replace, undone: every entry back as it was, in one commit; the live one rebuilt; once only', async () => {
    const before = { hw: (await src('hello-world')).source, bob: (await src('bob-draft')).source };
    const r = await replace('Acme Tools', 'Initech');
    assert.equal(r.changed.length, 2);
    assert.equal((await alice.post('/site/undo', { commit: r.commit })).status, 403, 'authors may not');
    const u = await editor.post('/site/undo', { commit: r.commit });
    assert.equal(u.status, 200, u.text);
    assert.deepEqual(u.json.undone.map((e) => e.id).sort(), ['bob-draft', 'hello-world']);
    assert.deepEqual(u.json.skipped, []);
    assert.ok(u.json.job, 'a live entry changed: rebuilt');
    await srv.app.jobs.idle();
    assert.equal((await editor.get(`/jobs/${u.json.job}`)).json.status, 'succeeded');
    assert.equal((await src('hello-world')).source, before.hw);
    assert.equal((await src('bob-draft')).source, before.bob);
    assert.match(fx.git('log', '-1', '--format=%s', u.json.commit).trim(), /^Undo: Replace “Acme Tools” with “Initech” in 2 entries$/);
    assert.equal(fx.git('show', '--name-only', '--format=', u.json.commit).trim().split('\n').length, 2, 'one commit, both files');
    const again = await editor.post('/site/undo', { commit: r.commit });
    assert.deepEqual([again.status, again.json.error], [409, 'already-undone']);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'site.undo'").get().n, 1);
  });

  test('an entry changed since is named and left as it is; the others go back', async () => {
    const r = await replace('Acme Tools', 'Globex');
    await put('bob-draft', (t) => t.replace('Bob likes', 'Bob loves'));
    const u = (await editor.post('/site/undo', { commit: r.commit })).json;
    assert.deepEqual(u.undone.map((e) => e.id), ['hello-world']);
    assert.deepEqual(u.skipped.map((e) => [e.id, e.reason]), [['bob-draft', 'It was changed since, so it was left as it is.']]);
    assert.match((await src('hello-world')).source, /Acme Tools makes tools/);
    assert.match((await src('bob-draft')).source, /Bob loves Globex/, 'the later edit is kept');
    await srv.app.jobs.idle();
  });

  test('replacing an image everywhere, undone; any other commit cannot be undone this way', async () => {
    const oldImg = (await upload(editor, 'team.png')).json;
    const newImg = (await upload(editor, 'team-2026.png')).json;
    await put('hello-world', (t) => `${t.trimEnd()}\n\n![The team](${oldImg.url})\n`);
    const was = (await src('hello-world')).source;
    const plan = (await editor.get(`/media/${oldImg.id}/replace?with=${newImg.id}`)).json;
    assert.deepEqual(plan.entries.map((e) => [e.id, e.count, e.url]), [['hello-world', 1, '/blog/hello-world/']], 'the plan names each entry with its address');
    const r = (await editor.post(`/media/${oldImg.id}/replace`, { with: newImg.id })).json;
    await srv.app.jobs.idle();
    const u = await editor.post('/site/undo', { commit: r.commit });
    assert.equal(u.status, 200, u.text);
    await srv.app.jobs.idle();
    assert.equal((await src('hello-world')).source, was);
    // an ordinary save is not "a change to many entries"
    assert.equal((await editor.post('/site/undo', { commit: fx.git('rev-parse', 'HEAD').trim() })).status, 404);
    assert.equal((await editor.post('/site/undo', { commit: 'HEAD' })).status, 400);
  });
});
