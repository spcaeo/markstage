// Find and replace across the site, and bulk actions (docs/OPERATIONS.md "Writing and finding"): a preview of every
// place that changes, then one commit across the chosen entries; each change is checked like a save (a status key
// cannot change this way); an entry changed since the preview is left out; live entries are rebuilt, and a failed
// deploy puts the texts back. Bulk: set a field, add to or take from a list, unpublish, trash, with a summary first.
// Editors and above only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { finder, samplesOf } from '../src/content/find.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

describe('find and replace across the site', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  const src = async (c, id) => (await editor.get(`/collections/${c}/entries/${id}/source`)).json;
  const put = async (id, f) => {
    const s = await src('posts', id);
    assert.equal((await editor.put(`/collections/posts/entries/${id}/source`, { version: s.version, source: f(s.source) })).status, 200);
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    await put('hello-world', (t) => `${t.trimEnd()}\n\nAcme Tools makes acme tools. Acmeish is not it.\n`);
    await put('bob-draft', (t) => `${t.trimEnd()}\n\nBob likes Acme Tools.\n`);
    await put('with-html', (t) => `${t.trimEnd()}\n\nAcme Tools again.\n`);
  });
  after(() => srv.close());

  test('the preview: every entry and place, case and whole words as asked; authors may not', async () => {
    assert.equal((await alice.get('/site/find?q=Acme')).status, 403);
    const any = (await editor.get('/site/find?q=acme')).json;
    assert.deepEqual(any.entries.map((e) => [e.id, e.count]), [['hello-world', 3], ['bob-draft', 1], ['with-html', 1]]);
    assert.equal(any.total, 5);
    const s = any.entries[0].samples[0];
    assert.equal(s.where, 'text');
    assert.equal(s.match, 'Acme');
    assert.match(s.after, /^ Tools makes acme tools/);
    assert.deepEqual((await editor.get('/site/find?q=acme&case=1')).json.entries.map((e) => [e.id, e.count]), [['hello-world', 1]]);
    assert.equal((await editor.get('/site/find?q=Acme&whole=1')).json.total, 4, '"Acmeish" is not a whole word');
    assert.equal((await editor.get('/site/find?q=Hello+World')).json.entries[0].samples[0].where, 'fields');
    assert.equal((await editor.get('/site/find?q=')).status, 400);
    assert.equal((await editor.get('/site/find?q=(a+')).json.total, 0, 'plain text, never a pattern');
  });

  test('with the new text: each entry says whether it may change (a status key may not)', async () => {
    const r = (await editor.get('/site/find?q=draft:+true&with=draft:+false')).json;
    assert.ok(r.entries.length >= 2);
    for (const e of r.entries) {
      assert.deepEqual(e.kinds, { key: 1 }, 'it starts with a field name: its own group');
      assert.equal(e.problem, null, 'plain text only: nothing would change');
      assert.match(e.problems.key, /"draft" changes only through Publish/);
    }
    assert.equal((await editor.get('/site/find?q=Acme&with=Initech')).json.entries.every((e) => e.problem === null), true);
  });

  test('replace: one commit across the chosen entries, the new text taken literally; a stale entry is left out', async () => {
    const found = (await editor.get('/site/find?q=Acme+Tools&with=x')).json.entries;
    // with-html changes after the preview
    await put('with-html', (t) => t.replace('Intro.', 'Intro, edited.'));
    const r = await editor.post('/site/replace', { q: 'Acme Tools', with: 'Initech $& Co', entries: found.map(({ collection, id, version }) => ({ collection, id, version })) });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.changed.map((e) => e.id).sort(), ['bob-draft', 'hello-world']);
    assert.deepEqual(r.json.skipped.map((e) => [e.id, e.reason]), [['with-html', 'It changed since the search. Search again to see it as it is now.']]);
    assert.ok(r.json.job, 'a live entry changed: rebuilt');
    await srv.app.jobs.idle();
    assert.equal((await editor.get(`/jobs/${r.json.job}`)).json.status, 'succeeded');
    // case-blind unless asked: the lower-case one changes too
    assert.match((await src('posts', 'hello-world')).source, /Initech \$& Co makes Initech \$& Co\. Acmeish/);
    assert.equal(fx.git('show', '--name-only', '--format=', r.json.commit).trim().split('\n').length, 2);
    assert.match(fx.git('log', '-1', '--format=%s', r.json.commit).trim(), /^Replace “Acme Tools” with “Initech \$& Co” in 2 entries$/);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'site.replace'").get().n, 1);
  });

  test('in a JSON entry the new text is written as JSON writes it', async () => {
    const found = (await editor.get('/site/find?q=We+are+here')).json.entries;
    assert.deepEqual(found.map((e) => e.id), ['about']);
    const r = await editor.post('/site/replace', { q: 'here', with: 'here, "always" \\o/', whole: true, entries: found.map(({ collection, id, version }) => ({ collection, id, version })) });
    assert.equal(r.status, 200, r.text);
    await srv.app.jobs.idle();
    assert.equal(JSON.parse((await src('pages', 'about')).source).sections[0].value.heading, 'We are here, "always" \\o/');
  });

  test('a failed deploy puts the texts back', async () => {
    const found = (await editor.get('/site/find?q=First+paragraph')).json.entries;
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      const r = await editor.post('/site/replace', { q: 'First paragraph', with: 'Opening', entries: found.map(({ collection, id, version }) => ({ collection, id, version })) });
      await srv.app.jobs.idle();
      const job = (await editor.get(`/jobs/${r.json.job}`)).json;
      assert.equal(job.status, 'failed');
      assert.match(job.log, /Put back 1 of 1 entries/);
      assert.match((await src('posts', 'hello-world')).source, /First paragraph/);
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
    }
  });
});

describe('bulk actions', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  const pick = (...ids) => ids.map((id) => ({ collection: 'posts', id }));
  const withVersions = async (...ids) => Promise.all(ids.map(async (id) => ({ collection: 'posts', id, version: (await editor.get(`/collections/posts/entries/${id}`)).json.version })));
  const fields = async (id) => (await editor.get(`/collections/posts/entries/${id}`)).json.frontmatter;

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('the fields to choose from, with the values in use; never status, title or address', async () => {
    assert.equal((await alice.get('/site/bulk/fields?collection=posts')).status, 403);
    const f = (await editor.get('/site/bulk/fields?collection=posts')).json.fields;
    const tags = f.find((x) => x.name === 'tags');
    assert.equal(tags.list, true);
    assert.deepEqual(tags.values.map((v) => [v.value, v.entries]), [['news', 2], ['intro', 1]]);
    assert.deepEqual(f.find((x) => x.name === 'author').values.map((v) => v.value).sort(), ['alice', 'bob', 'carol']);
    for (const no of ['title', 'draft', 'publishAt']) assert.equal(f.find((x) => x.name === no), undefined, no);
  });

  test('the summary before anything is written', async () => {
    const plan = async (body) => (await editor.post('/site/bulk/plan', body)).json.entries;
    const add = await plan({ action: 'add', field: 'tags', value: 'guides', entries: pick('hello-world', 'carol-draft') });
    assert.deepEqual(add.map((e) => [e.id, e.from, e.to, e.problem]), [
      ['hello-world', ['intro', 'news'], ['intro', 'news', 'guides'], undefined],
      ['carol-draft', null, ['guides'], undefined],
    ]);
    assert.equal((await plan({ action: 'remove', field: 'tags', value: 'intro', entries: pick('bob-draft') }))[0].problem, 'No change.');
    assert.equal((await plan({ action: 'set', field: 'title', value: 'Same', entries: pick('bob-draft') }))[0].problem, '“title” cannot be changed here.');
    assert.equal((await plan({ action: 'set', field: 'draft', value: false, entries: pick('bob-draft') }))[0].problem, '“draft” cannot be changed here.');
    assert.equal((await plan({ action: 'unpublish', entries: pick('bob-draft') }))[0].problem, 'Already a draft.');
    assert.equal((await plan({ action: 'add', field: 'author', value: 'x', entries: pick('bob-draft') }))[0].problem, '“author” is not a list here.');
    assert.equal((await plan({ action: 'set', field: 'cluster', value: 'basics', entries: pick('nope') }))[0].problem, 'It is no longer there.');
    assert.equal((await editor.post('/site/bulk/plan', { action: 'explode', entries: pick('bob-draft') })).status, 400);
    assert.equal((await alice.post('/site/bulk/plan', { action: 'unpublish', entries: pick('hello-world') })).status, 403);
  });

  test('add a tag and set a field: one commit each; the live entry is rebuilt; a stale entry is left out', async () => {
    const r = await editor.post('/site/bulk', { action: 'add', field: 'tags', value: 'guides', entries: await withVersions('hello-world', 'carol-draft') });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.changed.length, 2);
    assert.ok(r.json.job);
    await srv.app.jobs.idle();
    assert.equal((await editor.get(`/jobs/${r.json.job}`)).json.status, 'succeeded');
    assert.deepEqual((await fields('hello-world')).tags, ['intro', 'news', 'guides']);
    assert.deepEqual((await fields('carol-draft')).tags, ['guides']);
    assert.match(fx.git('log', '-1', '--format=%s').trim(), /^Add guides to tags in 2 entries$/);

    const stale = await withVersions('bob-draft', 'carol-draft');
    stale[1].version = 'old';
    const s = await editor.post('/site/bulk', { action: 'set', field: 'cluster', value: 'guides', entries: stale });
    assert.deepEqual(s.json.changed.map((e) => e.id), ['bob-draft']);
    assert.match(s.json.skipped[0].problem, /changed since the summary/);
    assert.equal(s.json.job, null, 'only a draft changed: nothing to rebuild');
    assert.equal((await fields('bob-draft')).cluster, 'guides');
  });

  test('unpublish and trash: off the site in one job; the trash can give them back', async () => {
    const u = await editor.post('/site/bulk', { action: 'unpublish', entries: await withVersions('hello-world', 'bob-draft') });
    assert.deepEqual(u.json.changed.map((e) => [e.id, e.from, e.to]), [['hello-world', 'published', 'draft']]);
    await srv.app.jobs.idle();
    assert.equal((await editor.get(`/jobs/${u.json.job}`)).json.status, 'succeeded');
    assert.equal((await editor.get('/collections/posts/entries/hello-world')).json.status, 'draft');

    const t = await editor.post('/site/bulk', { action: 'trash', entries: await withVersions('carol-draft', 'with-html') });
    assert.equal(t.status, 200, t.text);
    assert.equal(t.json.changed.length, 2);
    assert.ok(t.json.job, 'with-html was live');
    await srv.app.jobs.idle();
    assert.equal((await editor.get('/collections/posts/entries/with-html')).status, 404);
    const trash = (await editor.get('/trash')).json;
    const row = trash.find((x) => x.id === 'carol-draft');
    assert.ok(row);
    assert.equal((await editor.post(`/trash/${row.trashId}/restore`, {})).status, 201);
    assert.equal((await editor.get('/collections/posts/entries/carol-draft')).json.status, 'draft');
  });

  test('a failed deploy puts the trashed entries back and takes them out of the trash', async () => {
    const p = await editor.post('/collections/posts/entries/bob-draft/publish', { version: (await withVersions('bob-draft'))[0].version });
    await srv.app.jobs.idle();
    assert.equal((await editor.get(`/jobs/${p.json.job}`)).json.status, 'succeeded');
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      const t = await editor.post('/site/bulk', { action: 'trash', entries: await withVersions('bob-draft') });
      await srv.app.jobs.idle();
      const job = (await editor.get(`/jobs/${t.json.job}`)).json;
      assert.equal(job.status, 'failed');
      assert.match(job.log, /Put back 1 of 1 entries/);
      assert.equal((await editor.get('/collections/posts/entries/bob-draft')).json.status, 'published');
      assert.equal((await editor.get('/trash')).json.filter((x) => x.id === 'bob-draft').length, 0);
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
    }
  });
});

test('finder and samples: plain text, whole words in any script, where each match is', () => {
  assert.equal('Café café CAFÉ cafés'.match(finder('café', { whole: true })).length, 3);
  assert.equal('a.b axb'.match(finder('a.b')).length, 1);
  assert.equal('"say \\"hi\\""'.match(finder('say "hi"', { json: true })).length, 1);
  const s = samplesOf('---\ntitle: Acme\n---\n\nHello Acme.\n', finder('acme')).samples;
  assert.deepEqual(s.map((x) => [x.line, x.where, x.before, x.after]), [[2, 'fields', 'title: ', ''], [5, 'text', 'Hello ', '.']]);
});
