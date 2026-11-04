// The site's entry check (`validate`): blocking before every write (create, save, source, import, publish), 422
// with the issues, 503 when the checker itself breaks; and a failed build names the entry that broke it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';

// stands in for a site's schema check: "BAD-FIELD" breaks the schema (JSON issues), "PLAIN-FAIL" fails in plain
// text, "SLOW" never finishes; it also reports the file it was told about
const VALIDATE = `let t = '';
process.stdin.on('data', (d) => (t += d));
process.stdin.on('end', () => {
  if (t.includes('SLOW')) return setTimeout(() => {}, 60_000);
  if (t.includes('BAD-FIELD')) {
    console.log(JSON.stringify({ issues: [{ severity: 'error', message: 'author: Required (' + process.env.MARKSTAGE_FILE + ')', line: 2 }] }));
    process.exit(1);
  }
  if (t.includes('PLAIN-FAIL')) {
    console.error('schema says no');
    process.exit(2);
  }
});
`;

describe('validate: the site checks every write', () => {
  let fx, srv, ed, alice;
  const head = () => fx.git('rev-parse', 'HEAD').trim();

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.run, 'validate.mjs'), VALIDATE);
    srv = await startServer(fx, { overrides: { validate: { command: [process.execPath, path.join(fx.run, 'validate.mjs')], timeoutSeconds: 2 } } });
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('save: 422 with the issues, nothing written or committed', async () => {
    const was = head();
    const src = await ed.get('/collections/posts/entries/hello-world/source');
    const r = await ed.put('/collections/posts/entries/hello-world/source', { version: src.json.version, source: src.json.source.replace('First paragraph.', 'BAD-FIELD') });
    assert.equal(r.status, 422);
    assert.equal(r.json.error, 'invalid-entry');
    assert.match(r.json.message, /author: Required \(src\/content\/blog\/hello-world\.md\)/);
    assert.deepEqual(r.json.issues, [{ severity: 'error', message: 'author: Required (src/content/blog/hello-world.md)', line: 2 }]);
    assert.equal(readFile(fx, 'src/content/blog/hello-world.md'), src.json.source);
    assert.equal(head(), was);
    // the document save goes through it too, and a plain-text failure is shown as is
    const e = await ed.get('/collections/posts/entries/hello-world');
    const doc = structuredClone(e.json.doc);
    doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'PLAIN-FAIL' }] });
    const p = await ed.put('/collections/posts/entries/hello-world', { version: e.json.version, doc });
    assert.equal(p.status, 422);
    assert.equal(p.json.issues[0].message, 'schema says no');
  });

  test('create and import are checked before the file exists', async () => {
    const was = head();
    const c = await alice.post('/collections/posts/entries', { title: 'Broken', frontmatter: { excerpt: 'BAD-FIELD' } });
    assert.equal(c.status, 422);
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/broken.md')));
    const i = await alice.post('/collections/posts/import', { filename: 'imp.md', source: '---\ntitle: Imp\n---\n\nPLAIN-FAIL\n' });
    assert.equal(i.status, 422);
    assert.ok(!fs.existsSync(path.join(fx.site, 'src/content/blog/imp.md')));
    assert.equal(head(), was);
    assert.equal((await alice.post('/collections/posts/entries', { title: 'Fine' })).status, 201, 'a valid entry still goes through');
  });

  test('publish with a bad change: 422 and no job', async () => {
    const src = await ed.get('/collections/posts/entries/bob-draft/source');
    const r = await ed.post('/collections/posts/entries/bob-draft/publish', { version: src.json.version, source: src.json.source.replace('A draft by Bob.', 'BAD-FIELD') });
    assert.equal(r.status, 422);
    assert.equal(r.json.job, undefined);
    assert.equal((await ed.get('/collections/posts/entries/bob-draft')).json.status, 'draft');
  });

  test('restoring from the trash is checked too (the site may have changed its schema since)', async () => {
    const made = await alice.post('/collections/posts/entries', { title: 'Short lived' });
    const del = await alice.del(`/collections/posts/entries/${made.json.id}?version=${made.json.version}`);
    assert.equal(del.status, 200);
    // as if the schema had changed after it was deleted: the kept text no longer passes
    srv.app.db.prepare("UPDATE trash SET text = text || 'BAD-FIELD' WHERE id = ?").run(del.json.trashId);
    const r = await alice.post(`/trash/${del.json.trashId}/restore`, {});
    assert.equal(r.status, 422);
    assert.ok(!fs.existsSync(path.join(fx.site, `src/content/blog/${made.json.id}.md`)));
  });

  test('a checker that does not finish: 503, nothing saved', async () => {
    const src = await ed.get('/collections/posts/entries/hello-world/source');
    const r = await ed.put('/collections/posts/entries/hello-world/source', { version: src.json.version, source: `${src.json.source}\nSLOW\n` });
    assert.equal(r.status, 503);
    assert.match(r.json.message, /did not finish within 2 s/);
    assert.equal(readFile(fx, 'src/content/blog/hello-world.md'), src.json.source);
  });
});

describe('a failed build names the entry that broke it', () => {
  test('job error: "The build step failed on “Title” (posts/...)"; the entry blocks every build until fixed (QA F1)', async () => {
    const fx = makeFixture({ checks: false });
    // a build that fails the way Astro does, naming the file in its output
    const build = [process.execPath, '-e', "console.error('[InvalidContentEntryDataError] blog -> hello-world data does not match');console.error('  Location:\\n    ' + process.cwd() + '/src/content/blog/hello-world.md:0:0');process.exit(1)"];
    const srv = await startServer(fx, { overrides: { commands: { build, deploy: null } } });
    try {
      const ed = await as(srv, 'editor');
      const r = await ed.post('/site/publish', {});
      await srv.app.jobs.idle();
      const job = (await ed.get(`/jobs/${r.json.job}`)).json;
      assert.equal(job.status, 'failed');
      assert.equal(job.error, 'The build step failed on “Hello World” (posts/hello-world). The live site was not changed.');
      assert.match(job.log, /src\/content\/blog\/hello-world\.md/, 'the server path is in the log for developers, not in the words');
      assert.deepEqual(job.blocked, [{ collection: 'posts', id: 'hello-world', title: 'Hello World', file: 'src/content/blog/hello-world.md' }]);
      // the Site check-up and Go live name the entry too, with a way to open it
      const admin = await as(srv, 'administrator');
      const health = (await admin.get('/site/health')).json;
      assert.equal(health.deploy.blocked.job, r.json.job);
      assert.equal(health.deploy.blocked.entries[0].title, 'Hello World');
      assert.equal((await ed.get('/releases')).json.buildBlocked.entries[0].id, 'hello-world');
      // a build that goes through clears it
      srv.config.commands.build = [process.execPath, '-e', 'process.exit(0)'];
      const again = await ed.post('/site/publish', {});
      await srv.app.jobs.idle();
      assert.equal((await ed.get(`/jobs/${again.json.job}`)).json.status, 'succeeded');
      assert.equal((await admin.get('/site/health')).json.deploy.blocked, null);
    } finally {
      await srv.close();
    }
  });
});
