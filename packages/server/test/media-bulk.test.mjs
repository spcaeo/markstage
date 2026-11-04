// Media library, many at once: every selected file nothing uses is deleted in one commit; a used one, one this
// person may not delete, or one already gone is left and named with the reason. The Undo brings the files back with
// their library rows (alt text, uploader), once, for editors or whoever deleted them; a file put at the same place
// since is left.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';

const upload = (c, name) => c.request('POST', `/media?filename=${encodeURIComponent(name)}`, { body: makePng(), headers: { 'Content-Type': 'image/png' } });

describe('media: delete many unused files at once, with Undo', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  let carol;
  const up = async (c, name) => {
    const r = await upload(c, name);
    assert.equal(r.status, 201, r.text);
    return r.json;
  };
  const exists = (m) => fs.existsSync(path.join(fx.site, m.path));
  const row = (id) => srv.app.db.prepare('SELECT * FROM media WHERE id = ?').get(id);

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { clock: { now: Date.UTC(2026, 9, 28, 12) } });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => srv.close());

  test('the request is checked', async () => {
    assert.equal((await editor.post('/media/delete', {})).status, 400);
    assert.equal((await editor.post('/media/delete', { ids: [] })).status, 400);
    assert.equal((await editor.post('/media/delete', { ids: [5] })).status, 400);
    assert.equal((await editor.post('/media/delete', { ids: Array.from({ length: 201 }, (_, i) => `m${i}`) })).status, 400);
  });

  test('only the unused files this person may delete go, in one commit; the rest are named with why', async () => {
    const used = await up(alice, 'in-use.png');
    const theirs = await up(editor, 'theirs.png');
    const own1 = await up(alice, 'own-one.png');
    const own2 = await up(alice, 'own-two.png');
    const p = await editor.get('/collections/posts/entries/hello-world');
    const doc = structuredClone(p.json.doc);
    doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: '![x](/uploads/2026/10/in-use.png)' }] });
    assert.equal((await editor.put('/collections/posts/entries/hello-world', { version: p.json.version, doc })).status, 200);
    const commits = Number(fx.git('rev-list', '--count', 'HEAD').trim());

    const r = await alice.post('/media/delete', { ids: [used.id, theirs.id, own1.id, own2.id, own1.id, 'nope'] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.deleted.map((x) => x.filename).sort(), ['own-one.png', 'own-two.png']);
    assert.deepEqual(r.json.skipped.map((x) => [x.filename, x.reason]), [
      ['in-use.png', 'It is still used.'],
      ['theirs.png', 'You can only delete your own uploads.'],
      [null, 'It is not in the library any more.'],
    ]);
    assert.deepEqual(r.json.skipped[0].usedBy.map((u) => u.id), ['hello-world']);
    assert.equal(Number(fx.git('rev-list', '--count', 'HEAD').trim()), commits + 1, 'one commit');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Delete 2 unused media files');
    assert.deepEqual(fx.git('show', '--name-status', '--format=', r.json.commit).trim().split('\n').sort(), [`D\t${own1.path}`, `D\t${own2.path}`]);
    assert.ok(!exists(own1) && !exists(own2) && exists(used) && exists(theirs));
    assert.equal(row(own1.id), undefined);
    assert.equal(fx.git('status', '--porcelain', '--', 'src/assets/uploads').trim(), '');
    const audit = JSON.parse(srv.app.db.prepare("SELECT detail FROM audit WHERE action = 'media.delete.many' ORDER BY id DESC LIMIT 1").get().detail);
    assert.deepEqual(audit, { commit: r.json.commit, count: 2, skipped: 3 });

    const c = await up(carol, 'carol.png');
    const none = await carol.post('/media/delete', { ids: [c.id] });
    assert.equal(none.status, 200);
    assert.deepEqual([none.json.commit, none.json.skipped[0].reason], [null, 'Your role cannot delete files.']);
    assert.ok(exists(c));
  });

  test('Undo brings the files and their rows back, once; editors or the person who deleted them', async () => {
    const a = await up(alice, 'back-a.png');
    const b = await up(alice, 'back-b.png');
    assert.equal((await alice.request('PATCH', `/media/${a.id}`, { body: { alt: 'A red square' } })).status, 200);
    const was = row(a.id);
    const r = await alice.post('/media/delete', { ids: [a.id, b.id] });
    assert.equal(r.json.deleted.length, 2);
    assert.equal((await carol.post('/site/undo', { commit: r.json.commit })).status, 403);
    const u = await alice.post('/site/undo', { commit: r.json.commit });
    assert.equal(u.status, 200, u.text);
    assert.deepEqual(u.json.restored.map((x) => x.filename).sort(), ['back-a.png', 'back-b.png']);
    assert.deepEqual([u.json.undone, u.json.skipped, u.json.job], [[], [], null]);
    assert.ok(exists(a) && exists(b));
    assert.deepEqual(row(a.id), was, 'the same row: alt text, uploader, date');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Undo: Delete 2 unused media files');
    assert.equal(fx.git('status', '--porcelain', '--', 'src/assets/uploads').trim(), '');
    assert.deepEqual(fs.readFileSync(path.join(fx.site, a.path)), makePng(), 'the same bytes');
    assert.equal((await alice.post('/site/undo', { commit: r.json.commit })).status, 409);
    // someone else's delete: an author may not undo it, an editor may
    const e1 = await up(editor, 'ed-one.png');
    const d = await editor.post('/media/delete', { ids: [e1.id] });
    assert.equal((await alice.post('/site/undo', { commit: d.json.commit })).status, 403);
    assert.equal((await editor.post('/site/undo', { commit: d.json.commit })).json.restored.length, 1);
  });

  test('a file put at the same place since is left as it is', async () => {
    const a = await up(editor, 'same-place.png');
    const b = await up(editor, 'other-place.png');
    const r = await editor.post('/media/delete', { ids: [a.id, b.id] });
    const again = await up(editor, 'same-place.png');
    assert.equal(again.path, a.path, 'the new upload took the freed name');
    const u = await editor.post('/site/undo', { commit: r.json.commit });
    assert.deepEqual(u.json.restored.map((x) => x.filename), ['other-place.png']);
    assert.deepEqual(u.json.skipped.map((x) => [x.title, x.reason]), [['same-place.png', 'A file was put at that place since, so it was left as it is.']]);
    assert.equal(row(a.id), undefined);
    assert.equal(row(again.id).path, a.path);
  });
});
