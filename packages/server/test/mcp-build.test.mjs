// "Nothing an agent does publishes", proved on the example blog (examples/blog) with a real Astro build: the site is
// built, an MCP session uses every write tool (a new draft, changes to two drafts, a live post's change and a draft
// put into a release), and the site is built again. The two builds are the same files, byte for byte: no page more
// or changed, nothing more in the sitemap or the feed. The agent's commits are in the repo; drafts are not built.
// Then a person's save of a live post does change the build, so the comparison can see a change.
// The example has no sitemap or feed, so its copy here gets both, filtered as its pages are (src/lib/live.ts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { build } from 'astro';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';
import { mcpClient, mcpToken } from './mcp-support.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXAMPLE = path.join(REPO, 'examples/blog');
const SITE_URL = 'https://blog.example.test';
const SITEMAP = `import { getCollection } from 'astro:content';
import { isLive } from '../lib/live';

export async function GET() {
  const ids = (await getCollection('posts', isLive)).map((p) => p.id).sort();
  const urls = ['/', ...ids.map((id) => \`/posts/\${id}/\`)].map((u) => \`  <url><loc>${SITE_URL}\${u}</loc></url>\`);
  return new Response(\`<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\\n\${urls.join('\\n')}\\n</urlset>\\n\`, { headers: { 'Content-Type': 'application/xml' } });
}
`;
const FEED = `import { getCollection } from 'astro:content';
import { isLive } from '../lib/live';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function GET() {
  const posts = (await getCollection('posts', isLive)).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
  const items = posts.map((p) => \`  <item><title>\${esc(p.data.title)}</title><link>${SITE_URL}/posts/\${p.id}/</link><description>\${esc(p.data.description)}</description><pubDate>\${p.data.date.toUTCString()}</pubDate></item>\`);
  return new Response(\`<?xml version="1.0" encoding="UTF-8"?>\\n<rss version="2.0"><channel><title>Example blog</title><link>${SITE_URL}/</link>\\n\${items.join('\\n')}\\n</channel></rss>\\n\`, { headers: { 'Content-Type': 'application/rss+xml' } });
}
`;

describe('nothing an agent does publishes: the example blog, built before and after every write tool', () => {
  let fx, srv, ed, agent;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const read = (rel) => fs.readFileSync(path.join(fx.site, rel), 'utf8');

  /** The site built into <run>/<name>: {relative path: bytes}. */
  async function built(name) {
    const outDir = path.join(fx.run, name);
    await build({ root: fx.site, outDir, logLevel: 'error', cacheDir: path.join(fx.run, `cache-${name}`) });
    const files = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else files[path.relative(outDir, f)] = fs.readFileSync(f);
      }
    };
    walk(outDir);
    return files;
  }
  const same = (a, b, why) => {
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), `${why}: the same files`);
    for (const f of Object.keys(a)) assert.ok(b[f].equals(a[f]), `${why}: ${f} byte for byte`);
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    // the example blog in place of the fixture's content, with its own config, and the workspace's packages
    fs.rmSync(path.join(fx.site, 'src/content'), { recursive: true });
    fs.cpSync(path.join(EXAMPLE, 'src'), path.join(fx.site, 'src'), { recursive: true });
    for (const f of ['astro.config.mjs', 'markstage.config.mjs', 'package.json']) fs.copyFileSync(path.join(EXAMPLE, f), path.join(fx.site, f));
    fs.writeFileSync(path.join(fx.site, 'src/pages/sitemap.xml.js'), SITEMAP);
    fs.writeFileSync(path.join(fx.site, 'src/pages/rss.xml.js'), FEED);
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(fx.site, 'node_modules'));
    fs.appendFileSync(path.join(fx.site, '.gitignore'), 'node_modules\n.astro/\n');
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'The example blog');
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
    // one of the blog's authors (src/content/authors/): a new draft is theirs, and the save checks the author exists
    ed = await as(srv, 'editor', { authorSlug: 'alex-rivera' });
    agent = mcpClient(srv.base, await mcpToken(ed, ['mcp:draft'], 'Nothing ships'));
  });
  after(() => srv?.close());

  test('every write tool, then a real build: byte for byte the build before; a person’s save of a live post does change it', { timeout: 300_000 }, async () => {
    const before = await built('before');
    assert.ok(before['sitemap.xml'] && before['rss.xml'] && before['index.html'], Object.keys(before).join(', '));
    assert.match(before['rss.xml'].toString(), /Hello, Markstage/);
    assert.doesNotMatch(before['sitemap.xml'].toString(), /a-draft/);
    const start = head();

    // create_draft
    const made = await agent.tool('create_draft', { collection: 'posts', title: 'An agent’s post', markdown: 'Written by an agent, to stay a draft.\n\nA second paragraph.', frontmatter: { description: 'An agent wrote this.' } });
    assert.equal(made.ok, true, made.text);
    const mine = made.data.id;
    // update_entry, on the new draft and on the example's own draft
    for (const [id, from, to] of [[mine, 'A second paragraph.', 'A second paragraph, changed by the agent.'], ['a-draft', 'the built site does not.', 'the built site does not. The agent added this.']]) {
      const e = (await agent.tool('get_entry', { collection: 'posts', id })).data;
      assert.ok(e.source.includes(from), `${id}: ${e.source}`);
      const u = await agent.tool('update_entry', { collection: 'posts', id, version: e.version, source: e.source.replace(from, to) });
      assert.equal(u.ok, true, `${id}: ${u.text}`);
      assert.equal(u.data.changed, true);
    }
    // add_to_release: a live post's change, and a draft as it is, into an open release
    const r = (await ed.post('/releases', { name: 'The agent’s release' })).json;
    const hello = (await agent.tool('get_entry', { collection: 'posts', id: 'hello-markstage' })).data;
    const a1 = await agent.tool('add_to_release', { release: r.id, collection: 'posts', id: 'hello-markstage', version: hello.version, source: hello.source.replace('## Text and lists', '## Text and lists, by an agent') });
    assert.equal(a1.ok, true, a1.text);
    const a2 = await agent.tool('add_to_release', { release: r.id, collection: 'posts', id: mine, version: (await agent.tool('get_entry', { collection: 'posts', id: mine })).data.version });
    assert.equal(a2.ok, true, a2.text);

    // the agent's work is in the repo, as drafts and as a release that is still open
    assert.equal(Number(fx.git('rev-list', '--count', `${start}..HEAD`).trim()), 3, 'three commits: the new draft and two changes');
    assert.match(read(`src/content/posts/${mine}.md`), /^draft: true$/m);
    assert.match(read(`src/content/posts/${mine}.md`), /changed by the agent/);
    assert.match(read('src/content/posts/a-draft.md'), /The agent added this\./);
    assert.doesNotMatch(read('src/content/posts/hello-markstage.md'), /by an agent/);
    const rel = (await ed.get(`/releases/${r.id}`)).json;
    assert.deepEqual([rel.status, rel.counts.items], ['open', 2]);
    assert.deepEqual(srv.app.db.prepare("SELECT action FROM audit WHERE action LIKE 'release.publish%' OR action = 'entry.publish'").all(), []);
    const calls = srv.app.db.prepare("SELECT target, ok FROM audit WHERE action = 'mcp.call' AND target IN ('create_draft', 'update_entry', 'add_to_release') ORDER BY id").all();
    assert.deepEqual(calls.map((c) => [c.target, c.ok]), [['create_draft', 1], ['update_entry', 1], ['update_entry', 1], ['add_to_release', 1], ['add_to_release', 1]]);

    // built again: the same site, byte for byte; nothing the agent wrote is in it
    const afterAgent = await built('after-agent');
    same(before, afterAgent, 'after the agent');
    for (const [f, bytes] of Object.entries(afterAgent)) for (const w of ['by an agent', 'An agent', 'The agent added this', mine]) assert.equal(bytes.includes(w), false, `${f} has “${w}”`);

    // the control: a person saves the live post (a save of a live entry goes live), and the build shows it
    const s = (await ed.get('/collections/posts/entries/hello-markstage/source')).json;
    assert.equal((await ed.put('/collections/posts/entries/hello-markstage/source', { version: s.version, source: s.source.replace('title: Hello, Markstage', 'title: Hello again, Markstage') })).status, 200);
    const afterPerson = await built('after-person');
    assert.deepEqual(Object.keys(afterPerson).sort(), Object.keys(before).sort());
    const changed = Object.keys(before).filter((f) => !afterPerson[f].equals(before[f])).sort();
    assert.ok(changed.includes('posts/hello-markstage/index.html') && changed.includes('rss.xml') && changed.includes('index.html'), changed.join(', '));
  });
});
