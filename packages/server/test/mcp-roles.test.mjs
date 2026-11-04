// The MCP server as each role meets it (docs/API-MCP.md "Who sees and changes what"): reads show only what the token's
// person may read (an editor every draft, an author or a contributor live entries and their own drafts), and writes
// meet the editor's own rights, plus the agent's limits: drafts only, never a page without drafts, never a scheduled
// release (refused in words, also when it is scheduled while the agent adds), and what an agent put into a release is
// named in the audit where the release goes out or is stopped. Test people and tokens are made up here.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, readFile, writeFile } from './helpers.mjs';
import { releaseServer } from './release-site.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';

describe('the MCP server, role by role', () => {
  let fx, srv, clock, ed, bob, carol, agent;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const audits = (action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
  const release = async (name) => (await ed.post('/releases', { name })).json;
  const get = async (id) => (await ed.get(`/releases/${id}`)).json;
  const schedule = async (id, ms = 3_600_000) => {
    const s = await ed.post(`/releases/${id}/schedule`, { version: (await get(id)).version, publishAt: new Date(clock.now + ms).toISOString() });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    await srv.app.jobs.idle();
  };
  // a person's own item, so a release can be scheduled (an empty one cannot)
  const personAdds = async (rid, id = 'person-note') => {
    const r = await ed.post(`/releases/${rid}/items`, { kind: 'entry', collection: 'posts', id, version: (await ed.get(`/collections/posts/entries/${id}`)).json.version });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  };
  const ids = (r) => r.data.items.map((e) => e.id).sort();
  const v = async (who, id) => (await who.tool('get_entry', { collection: 'posts', id })).data.version;

  before(async () => {
    ({ fx, srv, clock } = await releaseServer());
    writeFile(fx, 'src/content/blog/person-note.md', `---\ntitle: Person note\nauthor: alice\ndate: '2026-10-01T10:00:00.000Z'\ndraft: true\n---\n\nA person's note.\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A person’s draft');
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    const bobS = await as(srv, 'author', { authorSlug: 'bob' });
    const carolS = await as(srv, 'contributor', { authorSlug: 'carol' });
    agent = {
      ed: mcpClient(srv.base, await mcpToken(ed, ['mcp:draft'], 'Editor agent')),
      bob: mcpClient(srv.base, await mcpToken(bobS, ['mcp:draft'], 'Bob agent')),
      carol: mcpClient(srv.base, await mcpToken(carolS, ['mcp:draft'], 'Carol agent')),
    };
    bob = agent.bob;
    carol = agent.carol;
  });
  after(() => srv.close());

  test('reads follow the role: an editor sees every draft; an author and a contributor the live entries and their own drafts only', async () => {
    const live = ['hello-world', 'with-html'];
    const want = { ed: [...live, 'bob-draft', 'carol-draft', 'person-note'].sort(), bob: [...live, 'bob-draft'].sort(), carol: [...live, 'carol-draft'].sort() };
    const drafts = (who) => want[who].filter((id) => !live.includes(id));
    for (const [who, c] of Object.entries(agent)) {
      const list = await c.tool('list_entries', { collection: 'posts' });
      assert.equal(list.ok, true, list.text);
      assert.deepEqual(ids(list), want[who], `list_entries as ${who}`);
      assert.equal(list.data.total, want[who].length);
      // the drafts filter shows only theirs too
      assert.deepEqual(ids(await c.tool('list_entries', { collection: 'posts', status: 'draft' })), drafts(who), `drafts as ${who}`);
      // search: every draft's file says "draft: true"; each finds only the drafts it may read
      assert.deepEqual(ids(await c.tool('search', { q: 'draft' })), drafts(who), `search as ${who}`);
      for (const id of ['hello-world', 'bob-draft', 'carol-draft']) {
        const g = await c.tool('get_entry', { collection: 'posts', id });
        assert.equal(g.ok, want[who].includes(id), `get_entry ${id} as ${who}: ${g.text}`);
        if (!g.ok) {
          // never "it is there, but not yours": the words of an entry that does not exist
          assert.equal(g.data.status, 404);
          assert.equal(g.data.message, `No entry "${id}" in posts, or it is not available to you.`);
        } else assert.equal(g.data.source, readFile(fx, `src/content/blog/${id}.md`));
      }
    }
    // a page collection (no drafts) is all live: everyone reads it
    for (const c of Object.values(agent)) assert.ok((await c.tool('list_entries', { collection: 'pages' })).data.total >= 1);
  });

  test('what else names a draft follows the role too: a Library item’s pages, a release’s items, the plans; no tool gives revisions', async () => {
    // a synced snippet carol's new draft uses, and her draft in a release an editor made
    const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const body = { doc: { type: 'doc', content: [para('Book a call with us.')] } };
    const it = (await ed.post('/library', { kind: 'snippet', name: 'Book a call', synced: true, body })).json;
    const carolS = await as(srv, 'contributor', { authorSlug: 'carol' });
    const made = await carolS.post('/collections/posts/entries', { title: 'Carol uses it', frontmatter: { author: 'carol', synced: [{ id: it.id }] }, doc: { type: 'doc', content: [para('Hi.'), ...body.doc.content] } });
    assert.equal(made.status, 201, made.text);
    const r = await release('Names a draft');
    await personAdds(r.id, made.json.id);
    await personAdds(r.id, 'person-note');
    const uses = async (c) => (await c.tool('get_library_item', { id: it.id })).data;
    const items = async (c) => (await c.tool('get_release', { id: r.id })).data;
    for (const [who, c, sees] of [['editor', agent.ed, true], ['carol', carol, true], ['bob', bob, false]]) {
      const u = await uses(c);
      assert.deepEqual([u.uses.map((x) => x.id), u.usedOn], sees ? [[made.json.id], 1] : [[], 0], `Library uses as ${who}`);
      const g = await items(c);
      const want = [...(sees ? [made.json.id] : []), ...(who === 'editor' ? ['person-note'] : [])].sort();
      assert.deepEqual(g.items.map((i) => i.entryId).sort(), want, `release items as ${who}`);
      assert.equal(g.counts.items, want.length);
      for (const t of [JSON.stringify(u), JSON.stringify(g)]) if (!sees) assert.equal(t.includes(made.json.id) || t.includes('Carol uses it'), false, `${who} learns nothing of it`);
    }
    // the plans name every file they move: editors and up
    const env = await bob.tool('env_status');
    assert.equal(env.ok, true, env.text);
    assert.deepEqual([env.data.plans, typeof env.data.plansNote], [null, 'string']);
    assert.notEqual((await agent.ed.tool('env_status')).data.plans, null);
    const plan = await bob.tool('get_plan', { id: 'pl_none' });
    assert.deepEqual([plan.data.status, plan.data.error], [403, 'forbidden']);
    // no tool gives an entry's revisions or history, and get_entry has none
    const names = (await bob.rpc('tools/list')).json.result.tools.map((t) => t.name);
    assert.equal(names.some((n) => /revision|history|diff/.test(n)), false, names.join(', '));
    const e = (await bob.tool('get_entry', { collection: 'posts', id: 'bob-draft' })).data;
    assert.deepEqual(Object.keys(e).filter((k) => /revision|history|commit/i.test(k)), []);
  });

  test('a contributor: changes their own draft and makes new ones; cannot put anything into a release (no right to publish)', async () => {
    const before = readFile(fx, 'src/content/blog/carol-draft.md');
    const u = await carol.tool('update_entry', { collection: 'posts', id: 'carol-draft', version: await v(carol, 'carol-draft'), source: before.replace('Carol writes.', 'Carol writes, with help.') });
    assert.equal(u.ok, true, u.text);
    assert.equal(readFile(fx, 'src/content/blog/carol-draft.md'), before.replace('Carol writes.', 'Carol writes, with help.'));
    const n = await carol.tool('create_draft', { collection: 'posts', title: 'Carol’s second', markdown: 'A new one.' });
    assert.equal(n.ok, true, n.text);
    assert.equal(n.data.status, 'draft');
    assert.match(readFile(fx, `src/content/blog/${n.data.id}.md`), /^author: carol$/m);
    assert.match(readFile(fx, `src/content/blog/${n.data.id}.md`), /^draft: true$/m);
    // someone else's draft: not even there
    const other = await carol.tool('update_entry', { collection: 'posts', id: 'bob-draft', version: 'x', source: 'x' });
    assert.equal(other.data.status, 404);
    const r = await release('Carol tries');
    const a = await carol.tool('add_to_release', { release: r.id, collection: 'posts', id: 'carol-draft', version: await v(carol, 'carol-draft') });
    assert.equal(a.ok, false);
    assert.equal(a.data.status, 403, a.text);
    assert.equal((await get(r.id)).counts.items, 0);
  });

  test('an author: their own draft yes; a live entry, theirs or not, never through update_entry (409 live, pointing at add_to_release)', async () => {
    const src = readFile(fx, 'src/content/blog/bob-draft.md');
    const u = await bob.tool('update_entry', { collection: 'posts', id: 'bob-draft', version: await v(bob, 'bob-draft'), source: src.replace('A draft by Bob.', 'A draft by Bob, tidied.') });
    assert.equal(u.ok, true, u.text);
    const start = head();
    const hello = readFile(fx, 'src/content/blog/hello-world.md');
    const l = await bob.tool('update_entry', { collection: 'posts', id: 'hello-world', version: await v(bob, 'hello-world'), source: hello.replace('First paragraph.', 'Changed by an agent.') });
    assert.equal(l.ok, false);
    assert.deepEqual([l.data.status, l.data.error], [409, 'live']);
    assert.match(l.data.message, /^“Hello World” is published: an AI agent’s change to it goes into a release, for a person to publish\. Use add_to_release with the change\.$/);
    assert.equal(readFile(fx, 'src/content/blog/hello-world.md'), hello);
    assert.equal(head(), start);
  });

  test('an editor: any draft; a live entry 409; a page collection has no drafts (422), so neither a new page nor a change to one; a stale version 409', async () => {
    const src = readFile(fx, 'src/content/blog/carol-draft.md');
    const old = await v(agent.ed, 'carol-draft');
    const u = await agent.ed.tool('update_entry', { collection: 'posts', id: 'carol-draft', version: old, source: src.replace('Carol writes, with help.', 'Carol writes, edited.') });
    assert.equal(u.ok, true, u.text);
    // the version it read before that save: stale now
    const stale = await agent.ed.tool('update_entry', { collection: 'posts', id: 'carol-draft', version: old, source: src.replace('Carol writes, with help.', 'Carol writes, twice.') });
    assert.equal(stale.data.status, 409, stale.text);
    assert.notEqual(stale.data.error, 'live');
    assert.match(readFile(fx, 'src/content/blog/carol-draft.md'), /Carol writes, edited\./);
    const start = head();
    const live = await agent.ed.tool('update_entry', { collection: 'posts', id: 'with-html', version: await v(agent.ed, 'with-html'), source: readFile(fx, 'src/content/blog/with-html.md').replace('Intro.', 'Intro, changed.') });
    assert.deepEqual([live.data.status, live.data.error], [409, 'live']);
    const page = await agent.ed.tool('create_draft', { collection: 'pages', title: 'A new page', data: {} });
    assert.deepEqual([page.data.status, page.data.error], [422, 'no-drafts']);
    const about = await agent.ed.tool('get_entry', { collection: 'pages', id: 'about' });
    const p = await agent.ed.tool('update_entry', { collection: 'pages', id: 'about', version: about.data.version, source: about.data.source.replace('"About"', '"About us"') });
    assert.deepEqual([p.data.status, p.data.error], [409, 'live']);
    assert.match(p.data.message, /live \(pages here have no drafts\)/);
    assert.equal(head(), start);
  });

  test('add_to_release: into an open release, recorded as the agent’s; never into a scheduled one, in plain words', async () => {
    const r = await release('Agent changes');
    const hello = readFile(fx, 'src/content/blog/hello-world.md');
    const start = head();
    const a = await agent.ed.tool('add_to_release', { release: r.id, collection: 'posts', id: 'hello-world', version: await v(agent.ed, 'hello-world'), source: hello.replace('First paragraph.', 'First paragraph, for the release.') });
    assert.equal(a.ok, true, a.text);
    assert.equal(a.data.release.status, 'open');
    // nothing on the site yet; the item knows it came from the agent
    assert.equal(readFile(fx, 'src/content/blog/hello-world.md'), hello);
    assert.equal(head(), start);
    const meta = JSON.parse(srv.app.db.prepare('SELECT meta FROM release_items WHERE release_id = ?').get(r.id).meta);
    assert.deepEqual([meta.via, meta.tokenName], ['mcp', 'Editor agent']);
    // scheduled: refused, nothing added
    const s = await release('Friday');
    await personAdds(s.id);
    await schedule(s.id);
    const before = (await get(s.id)).version;
    const no = await agent.ed.tool('add_to_release', { release: s.id, collection: 'posts', id: 'bob-draft', version: await v(agent.ed, 'bob-draft') });
    assert.deepEqual([no.ok, no.data.status, no.data.error], [false, 409, 'scheduled']);
    assert.equal(no.data.message, '“Friday” is scheduled: it goes live by itself at its time, so an AI agent cannot add to it. Add to a release that is not scheduled; a person schedules it.');
    const after = await get(s.id);
    assert.deepEqual([after.counts.items, after.version], [1, before]);
    // a person still can
    assert.equal((await ed.post(`/releases/${s.id}/items`, { kind: 'entry', collection: 'posts', id: 'bob-draft', version: (await ed.get('/collections/posts/entries/bob-draft')).json.version })).status, 201);
  });

  test('a release scheduled while the agent adds to it: the add is refused and leaves nothing', async () => {
    const r = await release('Raced');
    await personAdds(r.id);
    const { validate } = srv.app.entries;
    let once = true;
    srv.app.entries.validate = async (...args) => {
      const out = await validate.apply(srv.app.entries, args);
      if (once) {
        once = false;
        await schedule(r.id);
      }
      return out;
    };
    try {
      const a = await agent.ed.tool('add_to_release', { release: r.id, collection: 'posts', id: 'bob-draft', version: await v(agent.ed, 'bob-draft') });
      assert.equal(once, false, 'the release was scheduled during the add');
      assert.deepEqual([a.ok, a.data.status, a.data.error], [false, 409, 'scheduled']);
    } finally {
      srv.app.entries.validate = validate;
    }
    const cur = await get(r.id);
    assert.deepEqual([cur.status, cur.counts.items], ['scheduled', 1]);
  });

  test('at its time: a release stopped by a file changed since names the agent’s items in release.blocked; one a person publishes names them in release.publish', async () => {
    // blocked: the agent's item, then the file changes on the site, then its time
    const r = await release('Agent at nine');
    const src = readFile(fx, 'src/content/blog/bob-draft.md');
    assert.equal((await agent.ed.tool('add_to_release', { release: r.id, collection: 'posts', id: 'bob-draft', version: await v(agent.ed, 'bob-draft'), source: src.replace('tidied.', 'tidied, for nine.') })).ok, true);
    // a person's item next to it: not named
    await personAdds(r.id);
    await schedule(r.id, 60_000);
    writeFile(fx, 'src/content/blog/bob-draft.md', src.replace('tidied.', 'tidied by hand.'));
    fx.git('commit', '-q', '-am', 'A change by hand');
    clock.now += 61_000;
    assert.deepEqual(await srv.app.releases.tick(), []);
    assert.equal((await get(r.id)).status, 'scheduled');
    const blocked = audits('release.blocked').filter((x) => x.target === r.id);
    assert.equal(blocked.length, 1);
    const d = JSON.parse(blocked[0].detail);
    assert.match(d.words, /“Bob Draft” changed on the site since it was added/);
    assert.deepEqual(d.mcpItems, [{ rel: 'src/content/blog/bob-draft.md', title: 'Bob Draft', token: 'Editor agent' }]);
    assert.equal((await ed.post(`/releases/${r.id}/unschedule`, { version: (await get(r.id)).version })).status, 200);

    // published by a person: the commit goes out, and the audit names what the agent added
    const p = await release('Agent, reviewed');
    const hello = readFile(fx, 'src/content/blog/hello-world.md');
    assert.equal((await agent.ed.tool('add_to_release', { release: p.id, collection: 'posts', id: 'hello-world', version: await v(agent.ed, 'hello-world'), source: hello.replace('First paragraph.', 'First paragraph, reviewed.') })).ok, true);
    const go = await ed.post(`/releases/${p.id}/publish`, { version: (await get(p.id)).version });
    assert.equal(go.status, 202, JSON.stringify(go.json));
    await srv.app.jobs.idle();
    assert.equal((await get(p.id)).status, 'published');
    assert.match(readFile(fx, 'src/content/blog/hello-world.md'), /First paragraph, reviewed\./);
    const pub = audits('release.publish').filter((x) => x.target === p.id);
    assert.equal(pub.length, 1);
    assert.deepEqual(JSON.parse(pub[0].detail).mcpItems, [{ rel: 'src/content/blog/hello-world.md', title: 'Hello World', token: 'Editor agent' }]);
    // a release with no agent item has no mcpItems
    assert.equal(audits('release.publish').some((x) => x.target !== p.id && 'mcpItems' in JSON.parse(x.detail ?? '{}')), false);
  });
});
