// Presence and the soft lock (docs/OPERATIONS.md "Two people on one post"): who else has an entry open, the first
// editing tab holds the lock, others see who and may take over (the holder hears it once), a tab not heard from for
// a minute is gone, and one who may not edit is only ever a viewer.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';

describe('presence and the soft lock', () => {
  let srv;
  let editor;
  let alice;
  const clock = { now: Date.now() };
  const beat = (c, tab, mode, extra = {}) => c.post('/collections/posts/entries/hello-world/presence', { tab, mode, ...extra });

  before(async () => {
    srv = await startServer(makeFixture({ checks: false }), { clock });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('the first editing tab holds the lock; the next one sees who, as a viewer', async () => {
    const a = await beat(editor, 'tab-ed-1', 'editing');
    assert.equal(a.status, 200, a.text);
    assert.equal(a.json.mode, 'editing');
    assert.deepEqual([a.json.lock.you, a.json.people.length], [true, 0]);
    const b = (await beat(alice, 'tab-al-1', 'editing')).json;
    assert.equal(b.mode, 'viewing', 'the lock is held');
    assert.equal(b.canEdit, true);
    assert.equal(b.lock.you, false);
    assert.equal(b.lock.userId, editor.user.id);
    assert.match(b.lock.name, /^editor-/);
    assert.deepEqual(b.people.map((p) => [p.userId, p.mode]), [[editor.user.id, 'editing']]);
    // the holder sees alice looking
    assert.deepEqual((await beat(editor, 'tab-ed-1', 'editing')).json.people.map((p) => [p.userId, p.mode]), [[alice.user.id, 'viewing']]);
    // the same person in another tab: not "you", but the same user
    const other = (await beat(editor, 'tab-ed-2', 'editing')).json;
    assert.deepEqual([other.mode, other.lock.you, other.lock.sameUser], ['viewing', false, true]);
  });

  test('take over: the lock moves, the old holder hears it once, and it is audited', async () => {
    const t = (await beat(alice, 'tab-al-1', 'editing', { take: true })).json;
    assert.deepEqual([t.mode, t.lock.you], ['editing', true]);
    const told = (await beat(editor, 'tab-ed-1', 'editing')).json;
    assert.equal(told.mode, 'viewing');
    assert.match(told.takenOver.by, /^author-/);
    assert.equal(told.lock.userId, alice.user.id);
    assert.equal((await beat(editor, 'tab-ed-1', 'editing')).json.takenOver, null, 'told once');
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'entry.takeover'").get().n, 1);
  });

  test('lists see what is being edited; closing the tab frees the lock; a silent tab goes after a minute', async () => {
    const list = (await editor.get('/presence')).json.entries;
    assert.deepEqual(list.map((e) => [e.collection, e.id, e.editing.userId, e.editing.you, e.open]), [['posts', 'hello-world', alice.user.id, false, 2]]);
    assert.equal((await alice.del('/collections/posts/entries/hello-world/presence?tab=tab-al-1')).status, 200);
    assert.equal((await beat(editor, 'tab-ed-1', 'editing')).json.lock.you, true, 'free again: the waiting tab takes it');
    await beat(alice, 'tab-al-1', 'viewing');
    clock.now += 61_000;
    const later = (await beat(alice, 'tab-al-1', 'editing')).json;
    assert.deepEqual([later.mode, later.lock.you, later.people.length], ['editing', true, 0], 'the silent tabs are gone');
  });

  test('the heartbeat carries the entry\'s version, its last save and the viewer\'s role, so a save elsewhere and a role change show at once (QA pass 2, N9, N10)', async () => {
    const before = (await beat(editor, 'tab-ed-9', 'editing')).json;
    assert.equal(before.role, 'editor');
    assert.equal(typeof before.version, 'string');
    const e = (await alice.get('/collections/posts/entries/hello-world')).json;
    assert.equal(before.version, e.version);
    assert.equal((await alice.put('/collections/posts/entries/hello-world', { version: e.version, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alice wrote this.' }] }] } })).status, 200);
    const after = (await beat(editor, 'tab-ed-9', 'editing')).json;
    assert.notEqual(after.version, before.version, 'the version moved on');
    assert.equal(after.saved.by, (await alice.get('/auth/me')).json.user.name);
    assert.match(after.saved.at, /^\d{4}-\d{2}-\d{2}T/);
    // the owner demotes the editor: the next heartbeat says so
    const owner = await as(srv, 'owner');
    assert.equal((await owner.patch(`/users/${editor.user.id}`, { role: 'contributor' })).status, 200);
    const demoted = (await beat(editor, 'tab-ed-9', 'editing')).json;
    assert.equal(demoted.role, 'contributor');
    assert.equal(demoted.canEdit, false);
    assert.equal((await owner.patch(`/users/${editor.user.id}`, { role: 'editor' })).status, 200);
  });

  test('one who may not edit is a viewer; bad tabs and unknown entries are refused', async () => {
    const r = (await alice.post('/collections/posts/entries/bob-draft/presence', { tab: 'tab-al-1', mode: 'editing' })).json;
    assert.deepEqual([r.mode, r.canEdit, r.lock], ['viewing', false, null]);
    assert.equal((await alice.post('/collections/posts/entries/bob-draft/presence', { tab: 'x', mode: 'viewing' })).status, 400);
    assert.equal((await alice.post('/collections/posts/entries/nope/presence', { tab: 'tab-al-1', mode: 'viewing' })).status, 404);
  });
});
