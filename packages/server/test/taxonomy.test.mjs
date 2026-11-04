// Categories, tags, authors: every value of a field with how many entries use it (and how many are live); a value
// renamed everywhere, two merged into one, one taken out or given to another, each as one commit that changes only
// that field, the live entries rebuilt, and Undo. Editors and above.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';

describe('taxonomy: rename, merge, delete with reassignment', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  const values = async (field) => (await editor.get(`/site/taxonomy?field=${field}`)).json.values.map((v) => [v.value, v.entries, v.live]);
  /** The summary for a change, then the change itself with the versions the summary saw. */
  const change = async (field, from, to) => {
    const plan = await editor.post('/site/taxonomy/plan', { field, from, to });
    assert.equal(plan.status, 200, plan.text);
    const entries = plan.json.entries.filter((e) => !e.problem).map(({ collection, id, version }) => ({ collection, id, version }));
    const r = await editor.post('/site/bulk', { action: 'rename', field, from, value: to, entries });
    assert.equal(r.status, 200, r.text);
    await srv.app.jobs.idle();
    return { plan: plan.json, ...r.json };
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('every value with its entries and live entries; editors only; a field bulk changes leave alone has none', async () => {
    assert.deepEqual(await values('tags'), [['news', 2, 1], ['intro', 1, 1]]);
    assert.deepEqual(await values('author'), [['alice', 2, 2], ['bob', 1, 0], ['carol', 1, 0]]);
    const t = (await editor.get('/site/taxonomy?field=tags')).json;
    assert.equal(t.list, true);
    assert.deepEqual(t.values[0].collections, ['posts']);
    assert.deepEqual(await values('title'), []);
    assert.equal((await alice.get('/site/taxonomy?field=tags')).status, 403);
    assert.equal((await alice.post('/site/taxonomy/plan', { field: 'tags', from: ['news'], to: 'x' })).status, 403);
    assert.equal((await editor.get('/site/taxonomy?field=bad%20name')).status, 400);
    assert.equal((await editor.post('/site/taxonomy/plan', { field: 'tags', from: [], to: 'x' })).status, 400);
    const long = await editor.post('/site/taxonomy/plan', { field: 'tags', from: ['news'], to: 'x'.repeat(101) });
    assert.equal(long.status, 422, 'a new name is at most 100 characters (QA F4)');
    assert.equal(long.json.message, 'The new name is at most 100 characters.');
    assert.equal((await editor.post('/site/taxonomy/plan', { field: 'tags', from: ['news'], to: '' })).status, 400);
    assert.equal((await editor.post('/site/bulk', { action: 'rename', field: 'tags', from: Array.from({ length: 21 }, (_, i) => `t${i}`), value: 'x', entries: [{ collection: 'posts', id: 'hello-world', version: 'x' }] })).status, 400);
  });

  test('rename everywhere: the summary first, then one commit that changes only that field; the live one rebuilt', async () => {
    const commits = Number(fx.git('rev-list', '--count', 'HEAD').trim());
    const r = await change('tags', ['news'], 'updates');
    assert.deepEqual(r.plan.entries.map((e) => [e.id, e.from, e.to]), [['bob-draft', ['news'], ['updates']], ['hello-world', ['intro', 'news'], ['intro', 'updates']]]);
    assert.deepEqual(r.changed.map((e) => e.id), ['bob-draft', 'hello-world']);
    assert.ok(r.job, 'the live entry is rebuilt');
    assert.equal(Number(fx.git('rev-list', '--count', 'HEAD').trim()), commits + 1);
    assert.equal(fx.git('log', '-1', '--format=%s', r.commit).trim(), 'tags: news becomes updates in 2 entries');
    const diff = fx.git('show', '--format=', '-U0', r.commit, '--', 'src/content/blog/hello-world.md').split('\n').filter((l) => /^[-+][^-+]/.test(l));
    assert.deepEqual(diff.filter((l) => !/^[-+]modified:/.test(l)), ['-  - news', '+  - updates'], 'only the tag line (and the modified date)');
    assert.deepEqual(await values('tags'), [['updates', 2, 1], ['intro', 1, 1]]);
  });

  test('merge two into one: an entry with both keeps it once', async () => {
    const r = await change('tags', ['intro', 'updates'], 'news');
    assert.deepEqual(r.plan.entries.map((e) => [e.id, e.to]), [['bob-draft', ['news']], ['hello-world', ['news']]]);
    assert.deepEqual(await values('tags'), [['news', 2, 1]]);
  });

  test('delete with reassignment (a scalar field), and delete outright (taken out of the lists)', async () => {
    await change('author', ['carol'], 'alice');
    assert.deepEqual(await values('author'), [['alice', 3, 2], ['bob', 1, 0]]);
    const r = await change('tags', ['news'], null);
    assert.equal(fx.git('log', '-1', '--format=%s', r.commit).trim(), 'Take news out of tags in 2 entries');
    assert.deepEqual(await values('tags'), []);
  });

  test('Undo puts a rename back in every entry; a bulk unpublish is not undone here', async () => {
    const was = (await editor.get('/collections/posts/entries/hello-world/source')).json.source;
    await change('author', ['alice'], 'ada');
    const last = JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'entries.bulk' ORDER BY id DESC LIMIT 1").get().detail);
    assert.deepEqual([last.action, last.from, last.value], ['rename', ['alice'], 'ada']);
    const u = await editor.post('/site/undo', { commit: last.commit });
    assert.equal(u.status, 200, u.text);
    assert.deepEqual(u.json.undone.map((e) => e.id).sort(), ['carol-draft', 'hello-world', 'with-html']);
    assert.ok(u.json.job);
    await srv.app.jobs.idle();
    assert.equal((await editor.get('/collections/posts/entries/hello-world/source')).json.source, was, 'byte for byte');
    const v = (await editor.get('/collections/posts/entries/hello-world')).json.version;
    const un = await editor.post('/site/bulk', { action: 'unpublish', entries: [{ collection: 'posts', id: 'hello-world', version: v }] });
    assert.equal(un.status, 200, un.text);
    await srv.app.jobs.idle();
    assert.equal((await editor.post('/site/undo', { commit: un.json.commit })).status, 404);
  });
});
