// Custom roles (docs/API-ROLES.md): a named role on a base role, with rules in the promotion rules' shape. Deny wins,
// an allow gives what the base lacks but never an administrator's right, no rule leaves the base to answer; a rule's
// fields keep a translator to their own words. Test people are made up here, with generated passwords.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, makePng, startServer } from './helpers.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';

const TRANSLATOR = {
  id: 'translator-fr',
  name: 'French translator',
  base: 'contributor',
  rules: [
    { id: 'fr-words', name: 'Edits the French words of posts', action: ['entry.edit'], collections: ['posts'], fields: ['locales.fr-ca.**'], effect: 'allow' },
    { id: 'no-live', name: 'Never publishes or deletes', action: ['entry.publish', 'entry.delete'], effect: 'deny' },
  ],
};

describe('custom roles', () => {
  let srv, owner, admin, ed, tr, au;
  const save = async (who, id, frontmatter, c = 'posts') => {
    const e = (await who.get(`/collections/${c}/entries/${id}`)).json;
    return who.put(`/collections/${c}/entries/${id}`, { version: e.version, ...(c === 'posts' ? { frontmatter } : { changes: Object.entries(frontmatter).map(([path, value]) => ({ path, value })) }) });
  };
  const give = async (who, user, customRole) => {
    const r = await admin.patch(`/users/${user.user.id}`, { customRole });
    assert.equal(r.status, 200, r.text);
    // the session carries the person as they were signed in: a new request reads them again
    return r.json;
  };

  before(async () => {
    // the real converter: a translator's words are nested frontmatter (locales.fr-ca.title)
    srv = await startServer(makeFixture({ checks: false }), { core: await loadCore() });
    owner = await as(srv, 'owner');
    admin = await as(srv, 'administrator');
    ed = await as(srv, 'editor', { authorSlug: 'eve' });
    tr = await as(srv, 'contributor', { authorSlug: 'tara' });
    au = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv?.close());

  test('the owner and administrators only; a role is checked in plain words', async () => {
    assert.equal((await ed.get('/roles')).status, 403);
    const g = (await admin.get('/roles')).json;
    assert.deepEqual(g.bases, ['administrator', 'editor', 'author', 'contributor']);
    assert.ok(g.actions.entry.includes('entry.publish'));
    assert.ok(g.actions.abilities.some((a) => a.name === 'inbox.read' && a.min === 'editor'));
    const bad = async (body, field, re) => {
      const r = await admin.post('/roles', body);
      assert.deepEqual([r.status, r.json.field], [422, field], r.text);
      assert.match(r.json.message, re);
    };
    await bad({ ...TRANSLATOR, id: 'editor' }, 'id', /not a built-in/);
    await bad({ ...TRANSLATOR, base: 'owner' }, 'base', /administrator, editor, author, contributor/);
    await bad({ ...TRANSLATOR, rules: [{ id: 'x', name: 'Manages people', action: ['users.manage'], effect: 'allow' }] }, 'rules', /stays with the owner and administrators/);
    await bad({ ...TRANSLATOR, rules: [{ id: 'x', name: 'X', action: ['entry.edit'], collections: ['nope'], effect: 'allow' }] }, 'rules', /this site’s collections/);
    await bad({ ...TRANSLATOR, rules: [{ id: 'x', name: 'X', action: ['entry.publish'], fields: ['title'], effect: 'allow' }] }, 'rules', /fields is for one allow rule on entry.edit/);
    await bad({ ...TRANSLATOR, rules: [{ id: 'x', name: 'X', action: ['inbox.read'], collections: ['posts'], effect: 'allow' }] }, 'rules', /with entry actions only/);
    await bad({ ...TRANSLATOR, rules: [{ id: 'x', name: 'X', action: ['entry.edit'], effect: 'allow-with-approval' }] }, 'rules', /allow or deny/);
    await bad({ ...TRANSLATOR, rules: [{ id: 'x', name: 'X', action: ['entry.edit'], effect: 'allow', when: { windows: [{ from: '25:00' }] } }] }, 'rules', /times like/);
    await bad({ ...TRANSLATOR, rules: [{ id: 'x', name: 'X', action: ['entry.edit'], effect: 'allow', token: 'y' }] }, 'rules', /keys it does not know: token/);
  });

  test('a translator: their locale’s words of any post, nothing else, never publishing', async () => {
    const r = await admin.post('/roles', TRANSLATOR);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.role.version, 'r1');
    const u = await give(admin, tr, 'translator-fr');
    assert.deepEqual([u.role, u.customRole], ['contributor', { id: 'translator-fr', name: 'French translator' }]);
    // alice's live post: a plain contributor may not touch it; the translator may change its French words
    const e = (await tr.get('/collections/posts/entries/hello-world')).json;
    assert.deepEqual([e.can.edit, e.can.publish, e.can.delete, e.can.fields], [true, false, false, ['locales.fr-ca.**']]);
    const ok = await save(tr, 'hello-world', { locales: { 'fr-ca': { title: 'Bonjour le monde' } } });
    assert.equal(ok.status, 200, ok.text);
    const no = await save(tr, 'hello-world', { title: 'Changed', locales: { 'fr-ca': { title: 'Salut' } } });
    assert.equal(no.status, 403);
    assert.deepEqual(no.json.outside, ['title']);
    assert.match(no.json.message, /As French translator you change only locales\.fr-ca\.\*\*/);
    // the body is not theirs either, by whichever route the text comes
    const cur = (await tr.get('/collections/posts/entries/hello-world/source')).json;
    const body = await tr.put('/collections/posts/entries/hello-world/source', { version: cur.version, source: cur.source.replace('First paragraph.', 'Premier paragraphe.') });
    assert.deepEqual([body.status, body.json.outside], [403, ['body']]);
    const other = await save(tr, 'hello-world', { locales: { 'en-us': { title: 'Howdy' } } });
    assert.deepEqual([other.status, other.json.outside], [403, ['locales.en-us.title']]);
    assert.equal((await tr.post('/collections/posts/entries/hello-world/unpublish', { version: (await tr.get('/collections/posts/entries/hello-world')).json.version })).status, 403);
    // their AI assistant is them: its token keeps to the same words
    const agent = mcpClient(srv.base, await mcpToken(tr, ['mcp:read', 'mcp:draft']));
    const made = await tr.post('/collections/posts/entries', { title: 'Tara draft' });
    assert.equal(made.status, 201, made.text);
    const draft = (await tr.get(`/collections/posts/entries/${made.json.id}/source`)).json;
    const words = await agent.tool('update_entry', { collection: 'posts', id: made.json.id, version: draft.version, source: draft.source.replace('draft: true\n', 'draft: true\nlocales:\n  fr-ca:\n    title: Brouillon de Bob\n') });
    assert.equal(words.ok, true, words.text);
    const again = (await tr.get(`/collections/posts/entries/${made.json.id}/source`)).json;
    assert.match(again.source, /title: Brouillon de Bob/);
    const prose = await agent.tool('update_entry', { collection: 'posts', id: made.json.id, version: again.version, source: `${again.source}\nUn paragraphe.\n` });
    assert.equal(prose.ok, false);
    assert.match(prose.text, /As French translator you change only/);
    // pages are not in its rules: the base (contributor) answers
    assert.equal((await save(tr, 'about', { title: 'X' }, 'pages')).status, 403);
  });

  test('a role that changes a page’s sections: its save is taken although the server stamps the page’s modified date', async () => {
    assert.equal((await save(owner, 'about', { modified: '2026-01-01T10:00:00+00:00' }, 'pages')).status, 200);
    const r = await admin.post('/roles', { id: 'section-writer', name: 'Section writer', base: 'contributor', rules: [{ id: 's', name: 'Sections of pages', action: ['entry.edit'], collections: ['pages'], fields: ['sections'], effect: 'allow' }] });
    assert.equal(r.status, 201, r.text);
    const sam = await as(srv, 'contributor', { authorSlug: 'sam' });
    await give(admin, sam, 'section-writer');
    const ok = await save(sam, 'about', { 'sections.0.value.heading': 'Who we are' }, 'pages');
    assert.equal(ok.status, 200, ok.text);
    const page = (await sam.get('/collections/pages/entries/about')).json;
    assert.equal(page.data.sections[0].value.heading, 'Who we are');
    assert.notEqual(page.data.modified, '2026-01-01T10:00:00+00:00', 'stamped by the server');
    // anything else is still refused
    const no = await save(sam, 'about', { title: 'Changed' }, 'pages');
    assert.deepEqual([no.status, no.json.outside], [403, ['title']]);
  });

  test('an allow gives what the base lacks (an editor’s right); a deny takes one away; no rule leaves the base', async () => {
    await admin.post('/roles', { id: 'author-inbox', name: 'Author who answers forms', base: 'author', rules: [{ id: 'inbox', name: 'Reads the Inbox', action: ['inbox.read'], effect: 'allow' }] });
    await admin.post('/roles', { id: 'editor-no-upload', name: 'Editor without uploads', base: 'editor', rules: [{ id: 'no-upload', name: 'No uploads', action: ['media.upload'], effect: 'deny' }] });
    assert.equal((await au.get('/inbox')).status, 403);
    await give(admin, au, 'author-inbox');
    assert.equal((await au.get('/inbox')).status, 200);
    // the rest is the author's, as before: their own post yes, someone else's no
    assert.equal((await save(au, 'hello-world', { excerpt: 'Mine.' })).status, 200);
    assert.equal((await save(au, 'bob-draft', { excerpt: 'Not mine.' })).status, 403);
    const upload = (who) => who.request('POST', '/media?filename=a.png', { body: makePng(), headers: { 'Content-Type': 'image/png' } });
    assert.equal((await upload(ed)).status, 201);
    await give(admin, ed, 'editor-no-upload');
    assert.equal((await upload(ed)).status, 403);
    assert.equal((await save(ed, 'bob-draft', { excerpt: 'An editor still edits.' })).status, 200);
  });

  test('scope by collection and own; when: a freeze denies, hours limit an allow', async () => {
    await admin.post('/roles', {
      id: 'page-author',
      name: 'Author of pages',
      base: 'author',
      rules: [
        { id: 'pages', name: 'Edits pages', action: ['entry.edit'], collections: ['pages'], effect: 'allow' },
        { id: 'own-only', name: 'Publishes own posts only on weekdays at night', action: ['entry.publish'], collections: ['posts'], own: true, when: { windows: [{ days: ['sun'], from: '00:00', to: '00:01' }] }, effect: 'allow' },
        { id: 'freeze', name: 'No deleting during the freeze', action: ['entry.delete'], when: { freezes: [{ from: '2026-01-01T00:00:00Z', words: 'Year-end freeze' }] }, effect: 'deny' },
      ],
    });
    await give(admin, au, 'page-author');
    assert.equal((await save(au, 'about', { title: 'About us, again' }, 'pages')).status, 200);
    const e = (await au.get('/collections/posts/entries/hello-world')).json;
    // the publish rule is outside its hours: the author base answers (own post: yes); the freeze denies delete
    assert.deepEqual([e.can.publish, e.can.delete, e.can.edit], [true, false, true]);
    const check = await admin.post('/roles/check', { userId: au.user.id, action: 'entry.publish', collection: 'posts', id: 'hello-world' });
    assert.equal(check.status, 200, check.text);
    assert.deepEqual([check.json.allowed, check.json.by], [true, 'base']);
    assert.match(check.json.trace.find((t) => t.rule === 'own-only').why, /outside its hours/);
    const del = await admin.post('/roles/check', { userId: au.user.id, action: 'entry.delete', collection: 'posts', id: 'hello-world' });
    assert.deepEqual([del.json.allowed, del.json.by, del.json.rule.id], [false, 'rule', 'freeze']);
  });

  test('a role on administrator is the owner’s to make and give; editing is version-checked; a new base moves its people', async () => {
    const adminRole = { id: 'site-admin-lite', name: 'Administrator without users', base: 'administrator', rules: [{ id: 'no-users', name: 'No people', action: ['users.manage'], effect: 'deny' }] };
    assert.equal((await admin.post('/roles', adminRole)).status, 403);
    assert.equal((await owner.post('/roles', adminRole)).status, 201);
    assert.equal((await admin.patch(`/users/${tr.user.id}`, { customRole: 'site-admin-lite' })).status, 403);
    const cur = (await admin.get('/roles')).json.custom.find((r) => r.id === 'translator-fr');
    assert.equal(cur.people, 1);
    const up = await admin.put('/roles/translator-fr', { ...TRANSLATOR, base: 'author', version: cur.version });
    assert.equal(up.status, 200, up.text);
    assert.equal(up.json.role.version, 'r2');
    assert.equal((await admin.put('/roles/translator-fr', { ...TRANSLATOR, version: cur.version })).status, 409);
    assert.equal((await admin.get(`/users/${tr.user.id}`)).json.role, 'author');
  });

  test('removed: its people keep its base; every change audited and the administrators told', async () => {
    const d = await admin.del('/roles/translator-fr');
    assert.deepEqual([d.status, d.json.people], [200, 1]);
    const u = (await admin.get(`/users/${tr.user.id}`)).json;
    assert.deepEqual([u.role, u.customRole], ['author', null]);
    assert.equal((await save(tr, 'hello-world', { locales: { 'fr-ca': { title: 'Encore' } } })).status, 403);
    const acts = srv.app.db.prepare("SELECT action FROM audit WHERE action LIKE 'role.%' ORDER BY id").all().map((a) => a.action);
    assert.deepEqual(acts, ['role.create', 'role.create', 'role.create', 'role.create', 'role.create', 'role.create', 'role.update', 'role.delete']);
    const told = srv.app.db.prepare("SELECT DISTINCT text FROM notices WHERE kind = 'roles.changed'").all().map((n) => n.text);
    assert.ok(told.some((t) => /removed the role French translator; the person with it keeps author/.test(t)), told.join('\n'));
    // a built-in role given takes the custom one away
    await give(admin, au, 'page-author');
    const back = await admin.patch(`/users/${au.user.id}`, { role: 'author' });
    assert.equal(back.json.customRole, null);
  });

  test('a role that restores any entry but may not add raw HTML cannot bring raw HTML back from the trash (review 3 Nov, S16)', async () => {
    assert.equal((await admin.post('/roles', { id: 'editor-no-html', name: 'Editor without raw HTML', base: 'editor', rules: [{ id: 'no-html', name: 'No raw HTML', action: ['entry.rawHtml'], effect: 'deny' }] })).status, 201);
    const plain = await as(srv, 'editor', { authorSlug: 'pat' });
    const limited = await as(srv, 'editor', { authorSlug: 'lim' });
    await give(admin, limited, 'editor-no-html');
    // the fixture's post with raw HTML, put in the trash by an editor
    const cur = await plain.get('/collections/posts/entries/with-html');
    const d = await plain.del(`/collections/posts/entries/with-html?version=${cur.json.version}`);
    assert.equal(d.status, 200, d.text);
    assert.ok((await limited.get('/trash')).json.some((x) => x.trashId === d.json.trashId), 'the role sees it in the trash');
    const r = await limited.post(`/trash/${d.json.trashId}/restore`, {});
    assert.equal(r.status, 403, r.text);
    assert.match(r.json.message, /raw HTML/);
    assert.equal((await plain.post(`/trash/${d.json.trashId}/restore`, {})).status, 201, 'an editor with the right still restores it');
  });
});
