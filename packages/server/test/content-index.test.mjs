// The content index (content/index.mjs, docs/ARCHITECTURE.md "The content index"): lists come from memory, and
// the index is never stale: a write through the store shows at once, a file changed, added or removed by hand
// shows on the next ask, and so does a git commit or pull made outside the server. And the site check-up yields:
// a list asked for while it runs is answered in well under 300 ms.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';

const post = (title, words = 40) => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-01-02T10:00:00.000Z'\nmodified: '2026-01-03T10:00:00.000Z'\n---\n\n${Array.from({ length: words }, (_, i) => `word${i}`).join(' ')}\n`;

describe('the content index', () => {
  let fx;
  let srv;
  let owner;
  let store;
  let posts;
  const file = (id) => path.join(fx.site, 'src/content/blog', `${id}.md`);
  const titles = () => srv.app.store.list(posts, { perPage: 200, sort: 'id' }).items.map((e) => `${e.id}:${e.title}`);

  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx);
    owner = await as(srv, 'owner');
    store = srv.app.store;
    posts = store.collection('posts');
  });
  after(() => srv.close());

  test('a list reads no file: every record comes from the index, with the words kept per version', () => {
    const idx = store.index(posts);
    assert.equal(idx.size, 4);
    const hello = idx.get('hello-world');
    assert.equal(hello.fields.title, 'Hello World');
    assert.equal(typeof hello.words, 'number');
    assert.equal(hello.version, store.read(posts, 'hello-world').version);
    const s = store.summaryOf(posts, hello);
    assert.deepEqual(s, store.summarize(posts, 'hello-world', store.read(posts, 'hello-world').text));
    const { items } = store.list(posts, { perPage: 50, sort: 'title' });
    assert.equal(items.find((e) => e.id === 'hello-world').words, hello.words);
  });

  test('the content version moves on a change only; a second ask in the same turn does not sweep again', () => {
    const r1 = store.rev();
    assert.equal(store.rev(), r1);
    fs.writeFileSync(file('hello-world'), post('Hello again'));
    // a change made by hand shows on the next turn of the event loop
    return new Promise((resolve) => setImmediate(resolve)).then(() => {
      assert.ok(store.rev() > r1, 'the version moved');
      assert.ok(titles().includes('hello-world:Hello again'));
      const r2 = store.rev();
      assert.equal(store.rev(), r2);
    });
  });

  test('a write through the store (a save) shows at once, before any sweep', async () => {
    const cur = await owner.get('/collections/posts/entries/hello-world');
    const r = await owner.put('/collections/posts/entries/hello-world', { version: cur.json.version, frontmatter: { title: 'Saved title' } });
    assert.equal(r.status, 200);
    assert.ok(titles().includes('hello-world:Saved title'));
    assert.equal(store.index(posts).get('hello-world').version, r.json.version);
  });

  test('a file added or removed by hand shows on the next ask', async () => {
    fs.writeFileSync(file('by-hand'), post('By hand'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(titles().includes('by-hand:By hand'));
    const list = await owner.get('/collections/posts/entries?perPage=50');
    assert.ok(list.json.items.some((e) => e.id === 'by-hand'));
    fs.unlinkSync(file('by-hand'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(!titles().some((t) => t.startsWith('by-hand:')));
  });

  test('a commit and a pull made outside the server (another clone) are seen: changed, new and deleted files', async () => {
    const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Elsewhere', '-c', 'user.email=elsewhere@example.test', ...args], { cwd, encoding: 'utf8' });
    const other = path.join(fx.run, 'other-clone');
    git(fx.run, 'clone', '-q', fx.site, other);
    fs.writeFileSync(path.join(other, 'src/content/blog/with-html.md'), post('Pulled title'));
    fs.writeFileSync(path.join(other, 'src/content/blog/pulled-new.md'), post('Pulled new'));
    fs.unlinkSync(path.join(other, 'src/content/blog/carol-draft.md'));
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'Changes from elsewhere');
    // the site's checkout takes them in (what a terminal `git pull` does)
    git(fx.site, 'pull', '-q', '--ff-only', other, 'main');
    await new Promise((resolve) => setImmediate(resolve));
    const now = titles();
    assert.ok(now.includes('with-html:Pulled title'), 'a changed file');
    assert.ok(now.includes('pulled-new:Pulled new'), 'a new file');
    assert.ok(!now.some((t) => t.startsWith('carol-draft:')), 'a deleted file');
    // the same through the API, and the known pages the link checks use follow too
    const list = await owner.get('/collections/posts/entries?perPage=50&sort=id');
    assert.deepEqual(
      list.json.items.map((e) => e.id),
      ['bob-draft', 'hello-world', 'pulled-new', 'with-html'],
    );
    assert.ok(srv.app.preflight.knownPages().has('/blog/pulled-new'));
    assert.ok(!srv.app.preflight.knownPages().has('/blog/carol-draft'));
  });

  test('a checkout to another commit is seen as well (what the environments do)', async () => {
    const before = fx.git('rev-parse', 'HEAD').trim();
    fs.writeFileSync(file('hello-world'), post('Committed here'));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Here');
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(titles().includes('hello-world:Committed here'));
    fx.git('checkout', '-q', before, '--', 'src/content/blog/hello-world.md');
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(!titles().includes('hello-world:Committed here'));
  });
});

describe('the site check-up yields to other requests', () => {
  let fx;
  let srv;
  let owner;

  before(async () => {
    fx = makeFixture({ checks: false });
    // a few hundred live posts with text, links and images, so the check-up has real work per entry
    for (let i = 0; i < 300; i++) {
      const body = Array.from({ length: 12 }, (_, p) => `## Part ${p}\n\nSome words about part ${p} of post ${i}, with a [link](/blog/post-${(i + p) % 300}/) and more words here.\n\n![](/uploads/pic-${p}.png)\n`).join('\n');
      fs.writeFileSync(path.join(fx.site, 'src/content/blog', `post-${i}.md`), `---\ntitle: Post ${i}\nauthor: alice\ndate: '2026-01-02T10:00:00.000Z'\nmodified: '2026-01-03T10:00:00.000Z'\nexcerpt: Post ${i}\n---\n\n${body}`);
    }
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Many posts');
    srv = await startServer(fx);
    owner = await as(srv, 'owner');
  });
  after(() => srv.close());

  test('a list asked for during a check-up of 300 pages is answered in under 300 ms; a second check-up works nothing out again', async () => {
    const t0 = performance.now();
    const health = owner.get('/site/health');
    // give the check-up a head start, then ask for a list while it runs
    await new Promise((resolve) => setTimeout(resolve, 30));
    const l0 = performance.now();
    const list = await owner.get('/collections/posts/entries?perPage=50');
    const listMs = performance.now() - l0;
    const h = await health;
    const firstMs = performance.now() - t0;
    assert.equal(list.status, 200);
    assert.equal(h.status, 200);
    assert.equal(h.json.pages.length, 303, 'every live page is in the check-up (300 posts, two live posts of the fixture, one page)');
    const sample = h.json.pages.find((p) => p.id === 'post-7');
    assert.ok(sample && sample.headings >= 0 && Array.isArray(sample.links), `the findings are real: ${JSON.stringify(sample)}`);
    assert.ok(listMs < 300, `the list answered in ${Math.round(listMs)} ms while the check-up ran (${Math.round(firstMs)} ms)`);
    // the second check-up reuses the kept findings: nothing is worked out again (counted, not timed: on a fast
    // machine the answer's own cost is as large as the work it saves)
    const before = srv.app.preflight.stats();
    const again = await owner.get('/site/health');
    const after = srv.app.preflight.stats();
    assert.equal(again.status, 200);
    assert.equal(after.misses, before.misses, `the second check-up worked out ${after.misses - before.misses} entries again`);
    assert.ok(after.hits - before.hits >= 303, `the second check-up used the kept findings of every page (${after.hits - before.hits})`);
  });
});
