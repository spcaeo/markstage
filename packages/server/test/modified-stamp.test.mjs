// An entry's modified date follows a real change, however it is made (entries.stampModified): a person's save, a
// release item from a person or from an AI agent's source. It is written in the date's own format, and left alone when
// the change sets the date itself or only the status changes. Before this, only a JSON save through `changes` moved it,
// so a page an agent changed over MCP kept its old date in the site's structured data and sitemap.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { as, readFile, writeFile } from './helpers.mjs';
import { releaseServer } from './release-site.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';

const POST = `---\ntitle: Dated post\nauthor: alice\ndate: '2026-01-02T10:00:00+00:00'\nmodified: '2026-01-03T10:00:00+00:00'\n---\n\nFirst words.\n`;
const PAGE = '{\n  "title": "Dated page",\n  "uri": "/dated/",\n  "modified": "2026-01-03",\n  "intro": "Old intro."\n}\n';

describe('the modified date follows a change', () => {
  let fx, srv, clock, ed, agent;
  const fieldOf = (text, name) => (text.match(new RegExp(`^${name}: '?([^'\\n]+)'?$`, 'm')) ?? text.match(new RegExp(`"${name}": "([^"]+)"`)))?.[1];
  const version = async (c, id) => (await ed.get(`/collections/${c}/entries/${id}`)).json.version;

  before(async () => {
    ({ fx, srv, clock } = await releaseServer({ checks: false }));
    writeFile(fx, 'src/content/blog/dated-post.md', POST);
    writeFile(fx, 'src/content/pages/dated.json', PAGE);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Dated entries');
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    agent = mcpClient(srv.base, await mcpToken(ed, ['mcp:draft'], 'Dating agent'));
  });
  after(() => srv.close());

  test('an AI agent’s changed source in a release: the date moves to now, in the post’s own format', async () => {
    const r = (await agent.tool('create_release', { name: 'Agent edit, dated' })).data.release;
    const e = (await agent.tool('get_entry', { collection: 'posts', id: 'dated-post' })).data;
    const add = await agent.tool('add_to_release', { release: r.id, collection: 'posts', id: 'dated-post', version: e.version, source: e.source.replace('First words.', 'First words, changed.') });
    assert.equal(add.ok, true, add.text);
    const item = (await ed.get(`/releases/${r.id}`)).json.items.find((i) => i.entryId === 'dated-post');
    const text = (await ed.get(`/releases/${r.id}/items/${item.id}`)).json.text;
    assert.equal(fieldOf(text, 'modified'), new Date(clock.now).toISOString().replace(/\.\d{3}Z$/, '+00:00'));
    assert.match(text, /First words, changed\./);
  });

  test('a person’s save of a JSON page: the date moves, as a plain date like the page had', async () => {
    const out = await ed.put('/collections/pages/entries/dated', { version: await version('pages', 'dated'), data: JSON.parse(PAGE.replace('Old intro.', 'New intro.')) });
    assert.equal(out.status, 200, out.text);
    assert.equal(fieldOf(readFile(fx, 'src/content/pages/dated.json'), 'modified'), new Date(clock.now).toISOString().slice(0, 10));
  });

  test('a change that sets the date itself keeps that date; a change to nothing writes nothing', async () => {
    const page = JSON.parse(readFile(fx, 'src/content/pages/dated.json'));
    const out = await ed.put('/collections/pages/entries/dated', { version: await version('pages', 'dated'), data: { ...page, intro: 'Third intro.', modified: '2025-12-31' } });
    assert.equal(out.status, 200, out.text);
    assert.equal(fieldOf(readFile(fx, 'src/content/pages/dated.json'), 'modified'), '2025-12-31');
    const same = await ed.put('/collections/pages/entries/dated', { version: await version('pages', 'dated'), data: JSON.parse(readFile(fx, 'src/content/pages/dated.json')) });
    assert.equal(same.json.commit, null);
  });

  test('a person’s Markdown save: the front matter date moves, the rest of the file stays as written', async () => {
    const before = readFile(fx, 'src/content/blog/dated-post.md');
    clock.now += 3_600_000;
    const out = await ed.put('/collections/posts/entries/dated-post', { version: await version('posts', 'dated-post'), frontmatter: { title: 'Dated post, retitled' } });
    assert.equal(out.status, 200, out.text);
    const after = readFile(fx, 'src/content/blog/dated-post.md');
    assert.equal(fieldOf(after, 'modified'), new Date(clock.now).toISOString().replace(/\.\d{3}Z$/, '+00:00'));
    assert.equal(after.replace(/^modified: .*$/m, '').replace(/^title: .*$/m, ''), before.replace(/^modified: .*$/m, '').replace(/^title: .*$/m, ''));
  });
});
