// Authors on the server (docs/API-AUTHORS.md): author files in the content repo, each change one commit by the person;
// who may do what (editors manage, anyone their own profile, the email only for them); the check every entry write
// makes (a new unknown or archived author refused, an old one left alone, new entries and bulk changes too); an
// author with posts never deleted or renamed without saying where the posts go; reassign and rename in one commit,
// the live posts rebuilt; the author page's old address redirected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, gitLog, makeFixture, readFile, startServer, writeFile } from './helpers.mjs';

const ALICE = '{\n  "id": "alice",\n  "name": "Alice Example",\n  "designation": "Editor",\n  "avatar": "2024/alice.png",\n  "seo": {\n    "title": "Alice Example",\n    "robots": ["index"]\n  }\n}\n';
const HOOK = `import fs from 'node:fs';
let t = '';
process.stdin.on('data', (d) => (t += d));
process.stdin.on('end', () => {
  const ask = JSON.parse(t);
  const file = 'src/data/redirects.json';
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (ask.action === 'list') return console.log(JSON.stringify({ redirects: Object.entries(map).map(([from, to]) => ({ from, to })) }));
  for (const r of ask.redirects ?? []) map[r.from] = r.to;
  fs.mkdirSync('src/data', { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\\n');
});
`;
const authorLine = (fx, id) => /\nauthor: (.+)\n/.exec(readFile(fx, `src/content/blog/${id}.md`))?.[1];

describe('authors on the server', () => {
  let fx, srv, ed, owner, alice, contrib;
  before(async () => {
    fx = makeFixture({ checks: false });
    const dir = path.join(fx.site, 'src/content/authors');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'alice.json'), ALICE);
    fs.writeFileSync(path.join(dir, 'bob.json'), '{\n  "id": "bob",\n  "name": "Bob Example",\n  "email": "bob@example.com"\n}\n');
    fs.writeFileSync(path.join(dir, 'carol.json'), '{\n  "id": "carol",\n  "name": "Carol Example"\n}\n');
    fs.writeFileSync(path.join(dir, 'retired.json'), '{\n  "id": "retired",\n  "name": "Retired Example",\n  "archived": true\n}\n');
    fs.writeFileSync(path.join(fx.site, 'scripts/redirects.mjs'), HOOK);
    // hello-world (live) and with-html (live) are alice's; bob-draft bob's; carol-draft carol's (fixture posts)
    writeFile(fx, 'src/content/blog/co-written.md', "---\ntitle: Co-written\nauthor: carol\ncoAuthors:\n  - bob\ndate: '2026-03-01T10:00:00.000Z'\ndraft: true\n---\n\nTogether.\n");
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Authors');
    srv = await startServer(fx, { core: await loadCore(), overrides: { authors: { coAuthors: 'coAuthors', organization: 'https://example.com/#organization' } } });
    ed = await as(srv, 'editor', { authorSlug: 'carol' });
    owner = await as(srv, 'owner');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    contrib = await as(srv, 'contributor', { authorSlug: 'bob' });
  });
  after(() => srv.close());

  test('the list: post counts, the archived marked; the email only for editors and the person themselves', async () => {
    const r = await ed.get('/authors');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items.map((a) => [a.slug, a.posts, a.live, a.archived]), [
      ['alice', 2, 2, false],
      ['bob', 2, 0, false],
      ['carol', 2, 0, false],
      ['retired', 0, 0, true],
    ]);
    assert.equal(r.json.items[0].url, '/author/alice/');
    assert.equal(r.json.items[1].email, 'bob@example.com');
    assert.equal(r.json.can.manage, true);
    const a = await alice.get('/authors');
    assert.equal(a.json.can.manage, false);
    assert.ok(!('email' in a.json.items[1]), "another author's email is private");
    assert.equal((await contrib.get('/authors/bob')).json.author.email, 'bob@example.com', 'their own');
    const one = await ed.get('/authors/carol');
    assert.deepEqual(one.json.posts.map((p) => [p.id, p.role]), [['co-written', 'author'], ['carol-draft', 'author']]);
    assert.deepEqual((await ed.get('/authors/bob')).json.posts.map((p) => [p.id, p.role]), [['co-written', 'co-author'], ['bob-draft', 'author']]);
    assert.equal((await ed.get('/authors/nobody')).status, 404);
    assert.equal((await ed.get('/authors/..%2Fsecret')).status, 404);
  });

  test('create: editors only, one commit by the person, the file in the site shape', async () => {
    assert.equal((await alice.post('/authors', { name: 'Dana Example' })).status, 403);
    const r = await ed.post('/authors', { name: 'Dana Example', role: 'Writer', social: ['https://x.example/dana'], email: 'dana@example.com' });
    assert.equal(r.status, 201);
    assert.equal(r.json.author.slug, 'dana-example');
    assert.equal(readFile(fx, 'src/content/authors/dana-example.json'), '{\n  "id": "dana-example",\n  "name": "Dana Example",\n  "designation": "Writer",\n  "email": "dana@example.com",\n  "social": [\n    "https://x.example/dana"\n  ]\n}\n');
    assert.match(gitLog(fx, 'src/content/authors/dana-example.json')[0], /^editor-[0-9a-f]+\|.*\|Add author dana-example$/);
    assert.equal((await ed.post('/authors', { name: 'Dana Example' })).status, 409);
    const bad = await ed.post('/authors', { name: 'X', website: 'not a url' });
    assert.equal(bad.status, 422);
    assert.match(bad.json.fields.website, /https:\/\//);
  });

  test('change: surgical; a stale version is a 409; your own profile yes, someone else or archiving no', async () => {
    const a = (await alice.get('/authors/alice')).json.author;
    assert.equal((await alice.put('/authors/alice', { version: 'stale', role: 'Chief' })).status, 409);
    const r = await alice.put('/authors/alice', { version: a.version, role: 'Chief editor', website: 'https://alice.example' });
    assert.equal(r.status, 200);
    // a key the file did not have goes at its end; every other line stays as it was
    assert.equal(readFile(fx, 'src/content/authors/alice.json'), ALICE.replace('"Editor"', '"Chief editor"').replace('  }\n}\n', '  },\n  "website": "https://alice.example"\n}\n'));
    assert.equal((await alice.put('/authors/bob', { version: 'x', role: 'Mine now' })).status, 403);
    assert.equal((await alice.put('/authors/alice', { version: r.json.author.version, archived: true })).status, 403);
    // nothing changed: no commit, the file byte for byte
    const commits = gitLog(fx, 'src/content/authors/alice.json').length;
    await alice.put('/authors/alice', { version: r.json.author.version, name: 'Alice Example' });
    assert.equal(gitLog(fx, 'src/content/authors/alice.json').length, commits);
  });

  test('saving an entry: a new unknown or archived author refused, an old one left alone', async () => {
    const e = (await ed.get('/collections/posts/entries/bob-draft')).json;
    const bad = await ed.put('/collections/posts/entries/bob-draft', { version: e.version, frontmatter: { author: 'ghost' } });
    assert.equal(bad.status, 422);
    assert.equal(bad.json.error, 'unknown-author');
    assert.match(bad.json.fields.author, /“ghost” is not one of the site's authors/);
    const archived = await ed.put('/collections/posts/entries/bob-draft', { version: e.version, frontmatter: { coAuthors: ['retired'] } });
    assert.match(archived.json.message, /Retired Example \(“retired”\) is archived/);
    assert.equal((await ed.put('/collections/posts/entries/bob-draft', { version: e.version, frontmatter: { coAuthors: ['alice'] } })).status, 200);
    // an entry whose author left before the check came keeps saving
    writeFile(fx, 'src/content/blog/orphan.md', "---\ntitle: Orphan\nauthor: gone-person\ndate: '2026-01-01T10:00:00.000Z'\ndraft: true\n---\n\nOld.\n");
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'An orphan');
    const o = (await ed.get('/collections/posts/entries/orphan')).json;
    assert.equal((await ed.put('/collections/posts/entries/orphan', { version: o.version, frontmatter: { title: 'Orphan, still' } })).status, 200);
    // a new entry needs a real author; a bulk change to an unknown one is left out with the reason
    const made = await owner.post('/collections/posts/entries', { title: 'Nobody wrote this', frontmatter: { author: 'nobody' } });
    assert.equal(made.status, 422);
    assert.equal((await owner.post('/collections/posts/entries', { title: 'Carol wrote this', frontmatter: { author: 'carol' } })).status, 201);
    const plan = await ed.post('/site/bulk/plan', { action: 'set', field: 'author', value: 'nobody', entries: [{ collection: 'posts', id: 'bob-draft' }] });
    assert.match(plan.json.entries[0].problem, /“nobody” is not one of the site's authors/);
  });

  test('delete: blocked with the posts; reassigned and deleted in one commit; the live posts rebuilt', async () => {
    const a = (await ed.get('/authors/alice')).json.author;
    const blocked = await ed.del(`/authors/alice?version=${a.version}`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error, 'author-has-posts');
    assert.deepEqual(blocked.json.posts.map((p) => p.id).sort(), ['bob-draft', 'hello-world', 'with-html']);
    assert.equal((await alice.del(`/authors/alice?version=${a.version}&reassign=bob`)).status, 403);
    assert.equal((await ed.del(`/authors/alice?version=${a.version}&reassign=retired`)).status, 422, 'not to an archived author');
    const r = await ed.del(`/authors/alice?version=${a.version}&reassign=bob`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.moved.map((m) => m.id).sort(), ['bob-draft', 'hello-world', 'with-html']);
    assert.ok(r.json.job, 'live posts changed: rebuilt');
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/authors/alice.json')));
    assert.equal(authorLine(fx, 'hello-world'), 'bob');
    // bob was bob-draft's primary already: the co-author goes rather than name him twice
    assert.doesNotMatch(readFile(fx, 'src/content/blog/bob-draft.md'), /coAuthors/);
    const subject = fx.git('log', '-1', '--format=%s').trim();
    assert.equal(subject, 'Delete author alice, 3 entries given to bob');
    assert.deepEqual(fx.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(), ['src/content/authors/alice.json', 'src/content/blog/bob-draft.md', 'src/content/blog/hello-world.md', 'src/content/blog/with-html.md']);
    await srv.app.jobs.idle();
  });

  test('rename: blocked with posts; with movePosts the file, its id, the posts and a redirect in one commit', async () => {
    const c = (await ed.get('/authors/carol')).json.author;
    const blocked = await ed.post('/authors/carol/rename', { version: c.version, to: 'carol-x' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.posts.length, 3);
    assert.equal((await ed.post('/authors/carol/rename', { version: c.version, to: 'bob', movePosts: true })).status, 409, 'a taken slug');
    const r = await ed.post('/authors/carol/rename', { version: c.version, to: 'carol-x', movePosts: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.author.slug, 'carol-x');
    assert.equal(JSON.parse(readFile(fx, 'src/content/authors/carol-x.json')).id, 'carol-x');
    assert.equal(authorLine(fx, 'co-written'), 'carol-x');
    assert.equal(authorLine(fx, 'carol-draft'), 'carol-x');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Rename author carol to carol-x (3 entries)');
  });

  test('the folder must be inside the content repo, and not a Markdown collection', async () => {
    await assert.rejects(startServer(fx, { overrides: { authors: { dir: '../elsewhere' } } }), /authors.dir must be a folder inside the project/);
    await assert.rejects(startServer(fx, { overrides: { authors: { dir: 'src/content/blog' } } }), /author files are JSON/);
  });
});

describe('authors: the redirect of a renamed author page, and a site without authors', () => {
  test('the hook gets /author/old/ -> /author/new/', async () => {
    const fx = makeFixture({ checks: false });
    fs.mkdirSync(path.join(fx.site, 'src/content/authors'), { recursive: true });
    fs.writeFileSync(path.join(fx.site, 'src/content/authors/zed.json'), '{\n  "id": "zed",\n  "name": "Zed"\n}\n');
    fs.writeFileSync(path.join(fx.site, 'scripts/redirects.mjs'), HOOK);
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), `export default { siteUrl: 'https://example.com', authors: true, redirects: { command: ['node', 'scripts/redirects.mjs'] }, collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' }] };\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Zed');
    const srv = await startServer(fx, { core: await loadCore(), overrides: { collections: [] } });
    try {
      const ed = await as(srv, 'editor');
      const z = (await ed.get('/authors/zed')).json.author;
      const r = await ed.post('/authors/zed/rename', { version: z.version, to: 'zed-a' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual(JSON.parse(readFile(fx, 'src/data/redirects.json')), { '/author/zed/': '/author/zed-a/' });
      assert.match(fx.git('show', '--name-only', '--format=', 'HEAD'), /src\/data\/redirects\.json/);
    } finally {
      await srv.close();
    }
  });

  test('no authors config: the routes say so, saves are not checked', async () => {
    const fx = makeFixture({ checks: false });
    const srv = await startServer(fx);
    try {
      const ed = await as(srv, 'editor');
      const r = await ed.get('/authors');
      assert.equal(r.status, 404);
      assert.equal(r.json.error, 'no-authors');
      const e = (await ed.get('/collections/posts/entries/bob-draft')).json;
      assert.equal((await ed.put('/collections/posts/entries/bob-draft', { version: e.version, frontmatter: { author: 'anyone' } })).status, 200);
    } finally {
      await srv.close();
    }
  });
});
