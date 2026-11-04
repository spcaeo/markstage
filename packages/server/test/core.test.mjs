// The server with the real @markstage/core (not the stub): byte-safe no-op saves, one-block edits, the raw-HTML rule
// on the converter's own rawHtml nodes, YAML validation, and surgical JSON edits through JsonEntry.
// Opt-in: MARKSTAGE_REAL_SITE=<site repo> also round-trips a copy of that site's real posts through the server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { PAGES, POSTS, as, makeFixture, readFile, startServer } from './helpers.mjs';

const core = await loadCore();
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('with the real core', { skip: !core && '@markstage/core is not installed' }, () => {
  let fx;
  let srv;
  let editor;
  let carol;
  before(async () => {
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { core });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => srv.close());

  test('open + save with no edit is byte-identical for every fixture entry (no commit)', async () => {
    for (const id of Object.keys(POSTS)) {
      const e = await editor.get(`/collections/posts/entries/${id}`);
      assert.equal(e.status, 200, id);
      const r = await editor.put(`/collections/posts/entries/${id}`, { version: e.json.version, doc: e.json.doc });
      assert.equal(r.status, 200, id);
      assert.equal(r.json.changedBlocks, 0, id);
      assert.equal(r.json.commit, null, id);
      assert.equal(readFile(fx, `src/content/blog/${id}.md`), POSTS[id], id);
    }
  });

  test('editing one paragraph rewrites only that block', async () => {
    const e = await editor.get('/collections/posts/entries/hello-world');
    const doc = structuredClone(e.json.doc);
    const i = doc.content.findIndex((n) => n.type === 'paragraph' && n.content?.[0]?.text === 'Second paragraph.');
    doc.content[i] = para('Second paragraph, rewritten.');
    const r = await editor.put('/collections/posts/entries/hello-world', { version: e.json.version, doc });
    assert.equal(r.json.changedBlocks, 1);
    assert.equal(readFile(fx, 'src/content/blog/hello-world.md'), POSTS['hello-world'].replace('Second paragraph.', 'Second paragraph, rewritten.'));
    assert.deepEqual(e.json.frontmatter.tags, ['intro', 'news'], 'frontmatter parsed by core (YAML)');
  });

  test("the raw-HTML rule uses core's rawHtml nodes", async () => {
    const own = await carol.get('/collections/posts/entries/carol-draft');
    assert.ok(own.json.doc.content.some((n) => n.type === 'rawHtml'), 'core keeps unknown HTML as rawHtml');
    const keep = structuredClone(own.json.doc);
    keep.content.unshift(para('New first line.'));
    assert.equal((await carol.put('/collections/posts/entries/carol-draft', { version: own.json.version, doc: keep })).status, 200);
    const now = await carol.get('/collections/posts/entries/carol-draft');
    const add = structuredClone(now.json.doc);
    add.content.push({ type: 'rawHtml', attrs: { html: '<iframe src="https://evil.example"></iframe>' } });
    assert.equal((await carol.put('/collections/posts/entries/carol-draft', { version: now.json.version, doc: add })).status, 403);
    const src = await carol.get('/collections/posts/entries/carol-draft/source');
    const sneaky = src.json.source.replace('New first line.', 'New first line. <span onclick="x()">hi</span>');
    assert.equal((await carol.put('/collections/posts/entries/carol-draft/source', { version: src.json.version, source: sneaky })).status, 403, 'inline raw HTML too');
  });

  test('a Markdown link with a javascript: URL (parsed by core into a link mark) is refused', async () => {
    const src = await editor.get('/collections/posts/entries/with-html/source');
    const r = await editor.put('/collections/posts/entries/with-html/source', { version: src.json.version, source: src.json.source.replace('Intro.', 'Intro [click](javascript:alert(1)).') });
    assert.equal(r.status, 422);
    assert.deepEqual(r.json.urls, ['javascript:alert(1)']);
    const ok = await editor.put('/collections/posts/entries/with-html/source', { version: src.json.version, source: src.json.source.replace('Intro.', 'Intro [click](https://example.test/).') });
    assert.equal(ok.status, 200);
  });

  test('broken YAML frontmatter is refused with 422', async () => {
    const src = await editor.get('/collections/posts/entries/with-html/source');
    const bad = src.json.source.replace('title: With HTML', 'title: [unclosed');
    const r = await editor.put('/collections/posts/entries/with-html/source', { version: src.json.version, source: bad });
    assert.equal(r.status, 422);
    assert.match(r.json.message, /YAML/);
  });

  test('JSON pages: set, insert, duplicate, move, remove keep the file formatting (JsonEntry)', async () => {
    let p = await editor.get('/collections/pages/entries/about');
    const set = await editor.put('/collections/pages/entries/about', { version: p.json.version, changes: [{ path: 'sections.0.value.heading', value: 'We are still here' }] });
    assert.equal(set.status, 200);
    assert.equal(readFile(fx, 'src/content/pages/about.json'), PAGES.about.replace('We are here', 'We are still here'));
    const section = { discriminant: 'text', value: { body: 'Hi' } };
    const ops = await editor.put('/collections/pages/entries/about', {
      version: set.json.version,
      changes: [
        { op: 'insert', path: 'sections', index: 1, value: section },
        { op: 'duplicate', path: 'sections', index: 1 },
        { op: 'move', path: 'sections', from: 2, to: 0 },
        { op: 'remove', path: 'sections.1' },
      ],
    });
    assert.equal(ops.status, 200);
    const data = JSON.parse(readFile(fx, 'src/content/pages/about.json'));
    assert.deepEqual(data.sections.map((s) => s.discriminant), ['text', 'text']);
    p = await editor.get('/collections/pages/entries/about');
    assert.equal((await editor.put('/collections/pages/entries/about', { version: p.json.version, changes: [{ op: 'move', path: 'sections', from: 0, to: 9 }] })).status, 422);
    assert.equal((await editor.put('/collections/pages/entries/about', { version: p.json.version, changes: [{ path: 'constructor.x', value: 1 }] })).status, 422);
  });
});

// Proof on real content: copy a real site's Markdown posts into a fixture repo and round-trip each through the server.
const REAL = process.env.MARKSTAGE_REAL_SITE;
describe('real site round trip', { skip: (!REAL || !core) && 'set MARKSTAGE_REAL_SITE to run' }, () => {
  test('every real post: GET then PUT the same doc = 0 changed blocks, identical file', async () => {
    const fx = makeFixture({ checks: false });
    const src = path.join(REAL, 'src/content/blog');
    const dst = path.join(fx.site, 'src/content/blog');
    for (const f of fs.readdirSync(dst)) fs.unlinkSync(path.join(dst, f));
    const files = fs.readdirSync(src).filter((f) => /^[a-z0-9][a-z0-9-]*\.md$/.test(f));
    for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Real posts');
    const srv = await startServer(fx, { core });
    try {
      const ed = await as(srv, 'editor');
      const list = await ed.get('/collections/posts/entries?perPage=200');
      assert.equal(list.json.total, files.length);
      const failures = [];
      for (const f of files) {
        const id = f.slice(0, -3);
        const e = await ed.get(`/collections/posts/entries/${id}`);
        if (e.status !== 200) {
          failures.push(`${id}: GET ${e.status} ${e.json?.message}`);
          continue;
        }
        const r = await ed.put(`/collections/posts/entries/${id}`, { version: e.json.version, doc: e.json.doc });
        if (r.status !== 200 || r.json.changedBlocks !== 0) failures.push(`${id}: PUT ${r.status} changed=${r.json?.changedBlocks}`);
        if (fs.readFileSync(path.join(dst, f), 'utf8') !== fs.readFileSync(path.join(src, f), 'utf8')) failures.push(`${id}: bytes differ`);
      }
      assert.deepEqual(failures, [], `${failures.length} of ${files.length} posts failed`);
      assert.equal(fx.git('status', '--porcelain').trim(), '', 'nothing written');
      console.log(`# real site: ${files.length} posts round-tripped byte-identical`);
    } finally {
      await srv.close();
    }
  });
});
