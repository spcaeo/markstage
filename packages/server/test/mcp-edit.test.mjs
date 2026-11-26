// Small edits over MCP (docs/API-MCP.md "Small edits"): edit_entry sends only what to find and what to put there, and
// goes through exactly the path update_entry (a draft) or add_to_release (with a release) takes, so their rules hold:
// the version, drafts only (409 live), synced blocks (423), the modified date. Each find matches once, or all: true;
// 0 or several places are refused in words with the file untouched. The answer is small (never the whole source), and
// get_entry with find gives only the passages around a phrase.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, readFile, writeFile } from './helpers.mjs';
import { releaseServer } from './release-site.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';

const filler = Array.from({ length: 60 }, (_, i) => `Filler paragraph number ${i + 1}, here so the post is long.`).join('\n\n');
const DRAFT = `---\ntitle: Edit draft\nauthor: alice\ndate: '2026-01-02T10:00:00+00:00'\nmodified: '2026-01-03T10:00:00+00:00'\ndraft: true\n---\n\nThe quick brown fox jumps.\n\n${filler}\n\nA cat and a cat and a cat.\n`;
const LIVE = `---\ntitle: Edit live\nauthor: alice\ndate: '2026-01-02T10:00:00+00:00'\nmodified: '2026-01-03T10:00:00+00:00'\n---\n\nLive words here.\n\n${filler}\n\nThe last line.\n`;
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('edit_entry and get_entry with find: small edits over MCP', () => {
  let fx, srv, clock, ed, agent;
  const rel = (id) => `src/content/blog/${id}.md`;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const entry = async (id) => (await agent.tool('get_entry', { collection: 'posts', id })).data;
  const nowStamp = () => new Date(clock.now).toISOString().replace(/\.\d{3}Z$/, '+00:00');

  before(async () => {
    ({ fx, srv, clock } = await releaseServer({ checks: false }));
    writeFile(fx, rel('edit-draft'), DRAFT);
    writeFile(fx, rel('edit-live'), LIVE);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Entries to edit');
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    agent = mcpClient(srv.base, await mcpToken(ed, ['mcp:draft'], 'Edit agent'));
  });
  after(() => srv.close());

  test('listed for a draft token, with its input schema; not for a read-only one', async () => {
    const tools = (await agent.rpc('tools/list')).json.result.tools;
    const t = tools.find((x) => x.name === 'edit_entry');
    assert.ok(t, 'edit_entry is listed');
    assert.deepEqual(t.inputSchema.required, ['collection', 'id', 'version', 'edits']);
    assert.equal(t.inputSchema.properties.edits.type, 'array');
    assert.deepEqual(t.inputSchema.properties.edits.items.required, ['find', 'replace']);
    assert.equal(t.annotations.readOnlyHint, false);
    assert.match(t.description, /small change/);
    const reader = mcpClient(srv.base, await mcpToken(ed, ['mcp:read'], 'Reader'));
    assert.equal((await reader.rpc('tools/list')).json.result.tools.some((x) => x.name === 'edit_entry'), false);
    const no = await reader.rpc('tools/call', { name: 'edit_entry', arguments: {} });
    assert.match(no.json.error.message, /can only read/);
  });

  test('a one-word edit to a draft changes that word only (and the modified date moves); the answer is small', async () => {
    const before = readFile(fx, rel('edit-draft'));
    const e = await entry('edit-draft');
    const start = head();
    const r = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: 'quick', replace: 'slow' }] });
    assert.equal(r.ok, true, r.text);
    assert.equal(r.data.changed, true);
    assert.notEqual(r.data.version, e.version);
    assert.ok(r.data.commit, 'a commit');
    assert.notEqual(head(), start);
    assert.deepEqual(r.data.edits, [{ find: 'quick', matches: 1 }]);
    const after = readFile(fx, rel('edit-draft'));
    assert.equal(after.match(/^modified: '([^']*)'$/m)[1], nowStamp(), 'the modified date is now');
    assert.equal(after.replace(/^modified: '[^']*'$/m, "modified: '2026-01-03T10:00:00+00:00'"), before.replace('quick', 'slow'), 'only that word');
    // the answer: the changed lines with a little context, never the whole source
    assert.match(r.data.diff, /^- The quick brown fox jumps\.$/m);
    assert.match(r.data.diff, /^\+ The slow brown fox jumps\.$/m);
    assert.match(r.data.diff, /^\+ modified: '/m);
    assert.doesNotMatch(r.data.diff, /Filler paragraph number 30/);
    assert.equal(r.data.source, undefined);
    assert.ok(!r.raw.includes('Filler paragraph number 30'), 'the answer does not hold the whole source');
    assert.ok(r.raw.length < 2000, `a small answer (${r.raw.length} characters)`);
    // the same version again is stale now
    const stale = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: 'slow', replace: 'quick' }] });
    assert.deepEqual([stale.data.status, stale.data.error], [409, 'conflict'], stale.text);
    assert.equal(stale.data.version, r.data.version, 'the stale refusal gives the version now');
    assert.equal(readFile(fx, rel('edit-draft')), after);
  });

  test('0 matches and several matches are refused in words, nothing written; all: true changes every one; edits apply in order', async () => {
    const before = readFile(fx, rel('edit-draft'));
    const start = head();
    let e = await entry('edit-draft');
    const none = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: 'slow', replace: 'quick' }, { find: 'a dog', replace: 'a bird' }] });
    assert.deepEqual([none.ok, none.data.status, none.data.error, none.data.edit, none.data.matches], [false, 422, 'no-match', 2, 0], none.text);
    assert.match(none.data.message, /^Edit 2 finds nothing: “a dog” is not in the entry as the edits before it left it\./);
    const many = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: 'cat', replace: 'dog' }] });
    assert.deepEqual([many.data.status, many.data.error, many.data.edit, many.data.matches], [422, 'many-matches', 1, 3], many.text);
    assert.match(many.data.message, /^Edit 1 finds “cat” in 3 places, and it must find one\. .*all: true/);
    const empty = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: '', replace: 'x' }] });
    assert.deepEqual([empty.data.status, empty.data.error], [400, 'bad-request'], empty.text);
    assert.match(empty.data.message, /cannot be empty/);
    const bad = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: 'a cat' });
    assert.match(bad.data.message, /"edits" must be a list/);
    assert.equal(readFile(fx, rel('edit-draft')), before, 'the file is untouched');
    assert.equal(head(), start, 'no commit');
    // all: true, then a second edit that only matches after the first
    const all = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: 'cat', replace: 'dog', all: true }, { find: 'A dog and a dog', replace: 'One dog and a dog' }] });
    assert.equal(all.ok, true, all.text);
    assert.deepEqual(all.data.edits, [{ find: 'cat', matches: 3 }, { find: 'A dog and a dog', matches: 1 }]);
    assert.match(readFile(fx, rel('edit-draft')), /^One dog and a dog and a dog\.$/m);
    // a removal (replace '') and an edit that changes nothing
    e = await entry('edit-draft');
    const gone = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: ' brown', replace: '' }] });
    assert.equal(gone.ok, true, gone.text);
    assert.match(readFile(fx, rel('edit-draft')), /^The slow fox jumps\.$/m);
    e = await entry('edit-draft');
    const same = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: 'fox', replace: 'fox' }] });
    assert.deepEqual([same.data.changed, same.data.version, same.data.diff], [false, e.version, '']);
  });

  test('a live entry without a release: refused as update_entry refuses it (409 live); with a release it goes in, as add_to_release puts it', async () => {
    const file = readFile(fx, rel('edit-live'));
    const start = head();
    let e = await entry('edit-live');
    const live = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-live', version: e.version, edits: [{ find: 'Live words', replace: 'Changed words' }] });
    assert.deepEqual([live.data.status, live.data.error], [409, 'live'], live.text);
    assert.match(live.data.message, /^“Edit live” is published: an AI agent’s change to it goes into a release, for a person to publish\. Send the same edits with a release/);
    const viaUpdate = await agent.tool('update_entry', { collection: 'posts', id: 'edit-live', version: e.version, source: e.source.replace('Live words', 'Changed words') });
    assert.deepEqual([viaUpdate.data.status, viaUpdate.data.error], [live.data.status, live.data.error], 'the same refusal as update_entry');

    const r = (await agent.tool('create_release', { name: 'Small edits' })).data.release;
    const add = await agent.tool('edit_entry', { release: r.id, collection: 'posts', id: 'edit-live', version: e.version, edits: [{ find: 'Live words', replace: 'Changed words' }] });
    assert.equal(add.ok, true, add.text);
    assert.deepEqual([add.data.changed, add.data.version, add.data.from], [true, e.version, 'saved']);
    assert.equal(add.data.release.id, r.id);
    assert.equal(add.data.item.entryId, 'edit-live');
    assert.match(add.data.diff, /^\+ Changed words here\.$/m);
    assert.ok(!add.raw.includes('Filler paragraph number 30'), 'the answer does not hold the whole source');
    // the file on the site is as it was; the release's item holds the change, with the date moved
    assert.equal(readFile(fx, rel('edit-live')), file);
    assert.equal(head(), start);
    const text = async () => (await ed.get(`/releases/${r.id}/items/${add.data.item.id}`)).json.text;
    let t = await text();
    assert.match(t, /^Changed words here\.$/m);
    assert.equal(t.match(/^modified: '([^']*)'$/m)[1], nowStamp());
    // a second edit to the same entry in the same release builds on the first
    e = await entry('edit-live');
    const more = await agent.tool('edit_entry', { release: r.id, collection: 'posts', id: 'edit-live', version: e.version, edits: [{ find: 'The last line.', replace: 'The very last line.' }] });
    assert.equal(more.ok, true, more.text);
    assert.equal(more.data.from, 'release');
    assert.equal(more.data.item.id, add.data.item.id, 'the same item');
    t = await text();
    assert.match(t, /^Changed words here\.$/m);
    assert.match(t, /^The very last line\.$/m);
    assert.equal((await ed.get(`/releases/${r.id}`)).json.counts.items, 1);
    // the saved file's words that the release already changed are not there any more, and the refusal says where it looked
    const gone = await agent.tool('edit_entry', { release: r.id, collection: 'posts', id: 'edit-live', version: e.version, edits: [{ find: 'Live words', replace: 'Other words' }] });
    assert.deepEqual([gone.data.status, gone.data.error], [422, 'no-match'], gone.text);
    assert.match(gone.data.message, /^Edit 1 finds nothing: “Live words” is not in the entry as the release “Small edits” holds it/);
    // stale with a release too
    const stale = await agent.tool('edit_entry', { release: r.id, collection: 'posts', id: 'edit-live', version: 'v-old', edits: [{ find: 'here', replace: 'there' }] });
    assert.deepEqual([stale.data.status, stale.data.error], [409, 'conflict'], stale.text);
  });

  test('a synced block is refused (423 synced) through edit_entry, with and without a release, as through update_entry', async () => {
    const body = { doc: { type: 'doc', content: [para('Book a free call with our team.'), para('We reply within one business day.')] } };
    const piece = (await ed.post('/library', { kind: 'snippet', name: 'Call to action', synced: true, body })).json;
    const made = await ed.post('/collections/posts/entries', { title: 'Synced note', frontmatter: { author: 'alice', synced: [{ id: piece.id }] }, doc: { type: 'doc', content: [para('Intro words here.'), ...body.doc.content, para('Outro.')] } });
    assert.equal(made.status, 201, made.text);
    const id = made.json.id;
    const file = readFile(fx, rel(id));
    const start = head();
    const r = (await agent.tool('create_release', { name: 'Synced tries' })).data.release;
    const e = await entry(id);
    assert.deepEqual(e.synced.map((u) => [u.id, u.state]), [[piece.id, 'synced']]);
    const edits = [{ find: 'within one business day', replace: 'within an hour' }];
    for (const extra of [{}, { release: r.id }]) {
      const x = await agent.tool('edit_entry', { collection: 'posts', id, version: e.version, edits, ...extra });
      assert.deepEqual([x.ok, x.data.status, x.data.error], [false, 423, 'synced'], x.text);
    }
    const u = await agent.tool('update_entry', { collection: 'posts', id, version: e.version, source: e.source.replace(edits[0].find, edits[0].replace) });
    assert.deepEqual([u.data.status, u.data.error], [423, 'synced']);
    assert.equal(readFile(fx, rel(id)), file);
    assert.equal(head(), start);
    assert.equal((await ed.get(`/releases/${r.id}`)).json.counts.items, 0);
    // a change beside it goes in
    const ok = await agent.tool('edit_entry', { collection: 'posts', id, version: e.version, edits: [{ find: 'Intro words here.', replace: 'Intro words there.' }] });
    assert.equal(ok.ok, true, ok.text);
  });

  test('a value kept back from the agent ([hidden]) is never written by an edit', async () => {
    const e = await entry('edit-draft');
    const x = await agent.tool('edit_entry', { collection: 'posts', id: 'edit-draft', version: e.version, edits: [{ find: 'slow', replace: '[hidden]' }] });
    assert.deepEqual([x.data.status, x.data.error], [422, 'hidden'], x.text);
  });

  test('get_entry with find: only the passages around it, with line numbers, the version and no source', async () => {
    const full = await entry('edit-live');
    const lines = full.source.split('\n');
    const g = await agent.tool('get_entry', { collection: 'posts', id: 'edit-live', find: 'Filler paragraph number 30,' });
    assert.equal(g.ok, true, g.text);
    assert.equal(g.data.source, undefined);
    assert.equal(g.data.version, full.version);
    assert.equal(g.data.title, 'Edit live');
    assert.equal(g.data.matches, 1);
    assert.equal(g.data.lines, lines.length);
    assert.equal(g.data.passages.length, 1);
    const p = g.data.passages[0];
    const at = lines.findIndex((l) => l.includes('Filler paragraph number 30,')) + 1;
    assert.deepEqual([p.from, p.to], [at - 3, at + 3]);
    assert.equal(p.text, lines.slice(at - 4, at + 3).join('\n'));
    assert.ok(g.raw.length < full.source.length, 'smaller than the source');
    // several matches: passages that touch are joined (number 5, then 50 to 59 one after another)
    const many = await agent.tool('get_entry', { collection: 'posts', id: 'edit-live', find: 'Filler paragraph number 5' });
    assert.equal(many.data.matches, 11);
    assert.equal(many.data.passages.length, 2);
    assert.match(many.data.passages[1].text, /number 50,[\s\S]*number 59,/);
    const none = await agent.tool('get_entry', { collection: 'posts', id: 'edit-live', find: 'not in the post' });
    assert.deepEqual([none.data.matches, none.data.passages], [0, []]);
    const empty = await agent.tool('get_entry', { collection: 'posts', id: 'edit-live', find: '' });
    assert.equal(empty.data.status, 400);
    // without find: the whole source as before
    assert.equal(full.source, readFile(fx, rel('edit-live')));
  });
});
