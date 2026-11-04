// Publish jobs against the fixture site's fake build + atomic deploy: success, failing checks/build/deploy (live
// site untouched, revert commit, autosave kept), unpublish, schedule + scheduler, delete of a live entry, roles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, gitLog, makeFixture, readFile, startServer } from './helpers.mjs';

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const liveIds = (fx) => JSON.parse(fs.readFileSync(path.join(fx.live, 'index.json'), 'utf8'));

async function finish(c, srv, jobId) {
  await srv.app.jobs.idle();
  const r = await c.get(`/jobs/${jobId}`);
  assert.equal(r.status, 200);
  return r.json;
}

describe('publish, schedule, unpublish', () => {
  let fx;
  let srv;
  let editor;
  let alice;
  let carol;
  const clock = { now: Date.now() };
  before(async () => {
    fx = makeFixture();
    srv = await startServer(fx, { clock });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
    alice = await as(srv, 'author', { authorSlug: 'alice' });
    carol = await as(srv, 'contributor', { authorSlug: 'carol' });
    // first deploy so there is a live site to protect
    const site = await editor.post('/site/publish', {});
    assert.equal(site.status, 202);
    assert.equal((await finish(editor, srv, site.json.job)).status, 'succeeded');
  });
  after(() => srv.close());

  test('the initial live site has only the published posts', () => {
    assert.deepEqual(liveIds(fx), ['hello-world', 'with-html']);
  });

  test('contributors cannot publish, schedule or rebuild', async () => {
    const d = await carol.get('/collections/posts/entries/carol-draft');
    assert.equal((await carol.post('/collections/posts/entries/carol-draft/publish', { version: d.json.version })).status, 403);
    assert.equal((await carol.post('/collections/posts/entries/carol-draft/schedule', { version: d.json.version, publishAt: new Date(clock.now + 86_400_000).toISOString() })).status, 403);
    assert.equal((await carol.post('/site/publish', {})).status, 403);
    assert.equal((await alice.post('/site/publish', {})).status, 403);
    const bob = await alice.get('/collections/posts/entries/bob-draft');
    assert.equal((await alice.post('/collections/posts/entries/bob-draft/publish', { version: bob.json.version })).status, 403, "an author cannot publish someone else's post");
  });

  test('publish: save + clear draft + commit, then checks, build, deploy; the job log tells the story', async () => {
    const d = await editor.get('/collections/posts/entries/bob-draft');
    const doc = structuredClone(d.json.doc);
    doc.content.push(para('Ready to go.'));
    const r = await editor.post('/collections/posts/entries/bob-draft/publish', { version: d.json.version, doc });
    assert.equal(r.status, 202);
    const job = await finish(editor, srv, r.json.job);
    assert.equal(job.status, 'succeeded', job.log);
    assert.deepEqual(job.steps.map((s) => [s.name, s.status]), [['commit', 'succeeded'], ['checks', 'succeeded'], ['build', 'succeeded'], ['deploy', 'succeeded']]);
    assert.match(job.log, /pass Forbidden words/);
    assert.match(job.log, /deployed/);
    assert.deepEqual(liveIds(fx), ['bob-draft', 'hello-world', 'with-html']);
    const text = readFile(fx, 'src/content/blog/bob-draft.md');
    assert.ok(!text.includes('draft: true'));
    assert.ok(text.endsWith('Ready to go.\n'));
    assert.match(gitLog(fx, 'src/content/blog/bob-draft.md')[0], /\|Publish posts\/bob-draft$/);
    assert.equal((await editor.get('/collections/posts/entries/bob-draft')).json.status, 'published');
    // the log can be followed from an offset
    const tail = await editor.get(`/jobs/${r.json.job}?since=${job.logOffset - 9}`);
    assert.equal(tail.json.log, 'deployed\n');
  });

  test('a blocking check stops the publish before build; the file goes back and the text is kept as autosave', async () => {
    const d = await alice.get('/collections/posts/entries/with-html');
    const before1 = readFile(fx, 'src/content/blog/with-html.md');
    const doc = structuredClone(d.json.doc);
    doc.content.push(para('This has FORBIDDEN-WORD in it.'));
    const r = await alice.post('/collections/posts/entries/with-html/publish', { version: d.json.version, doc });
    assert.equal(r.status, 202);
    const job = await finish(alice, srv, r.json.job);
    assert.equal(job.status, 'failed');
    assert.deepEqual(job.steps.map((s) => s.name), ['commit', 'checks', 'revert']);
    assert.match(job.error, /checks step failed/);
    assert.equal(readFile(fx, 'src/content/blog/with-html.md'), before1, 'repo matches live again');
    assert.match(gitLog(fx, 'src/content/blog/with-html.md')[0], /Revert posts\/with-html: publish failed$/);
    const auto = await alice.get('/collections/posts/entries/with-html/autosave');
    assert.ok(auto.json.source.includes('FORBIDDEN-WORD'), 'nothing the writer typed is lost');
    // the direct check endpoint shows the issue
    const chk = await alice.post('/collections/posts/entries/with-html/checks', { doc });
    assert.equal(chk.json.ok, false);
    assert.equal(chk.json.results[0].issues[0].message, 'Remove FORBIDDEN-WORD');
    // a non-blocking failure is reported but does not block
    const warn = await alice.post('/collections/posts/entries/with-html/checks', { doc: { type: 'doc', content: [para('TODO later')] } });
    assert.equal(warn.json.ok, true);
    assert.equal(warn.json.results[1].ok, false);
  });

  test('a failed build leaves the live site untouched and reverts', async () => {
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    try {
      const d = await editor.get('/collections/posts/entries/carol-draft');
      const before1 = readFile(fx, 'src/content/blog/carol-draft.md');
      const liveBefore = liveIds(fx);
      const r = await editor.post('/collections/posts/entries/carol-draft/publish', { version: d.json.version });
      const job = await finish(editor, srv, r.json.job);
      assert.equal(job.status, 'failed');
      assert.equal(job.steps.find((s) => s.name === 'build').exitCode, 2);
      assert.ok(!job.steps.some((s) => s.name === 'deploy'), 'deploy never ran');
      assert.deepEqual(liveIds(fx), liveBefore);
      assert.equal(readFile(fx, 'src/content/blog/carol-draft.md'), before1);
      assert.equal((await editor.get('/collections/posts/entries/carol-draft')).json.status, 'draft');
    } finally {
      fs.unlinkSync(`${fx.failMarker}.build`);
    }
  });

  test('a failed deploy keeps the previous deploy and reverts', async () => {
    fs.writeFileSync(`${fx.failMarker}.deploy`, '');
    try {
      const d = await editor.get('/collections/posts/entries/carol-draft');
      const r = await editor.post('/collections/posts/entries/carol-draft/publish', { version: d.json.version });
      const job = await finish(editor, srv, r.json.job);
      assert.equal(job.status, 'failed');
      assert.equal(job.steps.find((s) => s.name === 'deploy').exitCode, 3);
      assert.ok(!liveIds(fx).includes('carol-draft'));
      assert.equal((await editor.get('/collections/posts/entries/carol-draft')).json.status, 'draft');
    } finally {
      fs.unlinkSync(`${fx.failMarker}.deploy`);
    }
  });

  test('unpublish takes it off the live site', async () => {
    const d = await alice.get('/collections/posts/entries/hello-world');
    const r = await alice.post('/collections/posts/entries/hello-world/unpublish', { version: d.json.version });
    assert.equal(r.status, 202);
    assert.equal((await finish(alice, srv, r.json.job)).status, 'succeeded');
    assert.ok(!liveIds(fx).includes('hello-world'));
    assert.ok(readFile(fx, 'src/content/blog/hello-world.md').includes('draft: true'));
    assert.equal((await alice.post('/collections/posts/entries/hello-world/unpublish', { version: r.json.version })).status, 409);
  });

  test('saving a live entry needs the publish right; contributors cannot touch it', async () => {
    const live = await editor.get('/collections/posts/entries/bob-draft');
    assert.equal(live.json.status, 'published');
    assert.equal((await carol.put('/collections/posts/entries/bob-draft', { version: live.json.version, doc: live.json.doc })).status, 403);
  });

  test('schedule: future only, not for live entries; the scheduler builds when the time comes', async () => {
    const d = await alice.get('/collections/posts/entries/hello-world');
    assert.equal((await alice.post('/collections/posts/entries/hello-world/schedule', { version: d.json.version, publishAt: new Date(clock.now - 1000).toISOString() })).status, 422);
    const at = new Date(clock.now + 3_600_000).toISOString();
    const r = await alice.post('/collections/posts/entries/hello-world/schedule', { version: d.json.version, publishAt: at });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'scheduled');
    assert.equal((await alice.get('/collections/posts/entries/hello-world')).json.status, 'scheduled');
    assert.equal((await alice.get('/collections/posts/entries?status=scheduled')).json.total, 1);
    // the schedule is cancelled: a draft again, no build (the site never had it), audited as entry.unschedule (QA F9)
    const cancel = await alice.post('/collections/posts/entries/hello-world/unpublish', { version: r.json.version });
    assert.equal(cancel.status, 200, cancel.text);
    assert.deepEqual([cancel.json.job, cancel.json.status], [null, 'draft']);
    assert.equal((await alice.get('/collections/posts/entries/hello-world')).json.status, 'draft');
    assert.equal(srv.app.audit.list({ action: 'entry.unschedule' }).items.length, 1);
    const back = await alice.post('/collections/posts/entries/hello-world/schedule', { version: cancel.json.version, publishAt: at });
    assert.equal(back.status, 200, back.text);
    r.json.version = back.json.version;
    const live = await editor.get('/collections/posts/entries/with-html');
    assert.equal((await editor.post('/collections/posts/entries/with-html/schedule', { version: live.json.version, publishAt: at })).status, 409);

    assert.equal(srv.app.scheduler.tick(clock.now), null, 'nothing due yet');
    clock.now += 3_600_001;
    const jobId = srv.app.scheduler.tick(clock.now);
    assert.ok(jobId);
    assert.equal(srv.app.scheduler.tick(clock.now), null, 'no second job while one is pending');
    const job = await finish(editor, srv, jobId);
    assert.equal(job.status, 'succeeded', job.log);
    assert.equal(job.kind, 'schedule');
    assert.ok(liveIds(fx).includes('hello-world'));
    assert.equal(srv.app.scheduler.tick(clock.now), null, 'covered: not built again');
    assert.equal((await alice.get('/collections/posts/entries/hello-world')).json.status, 'published');
  });

  test('deleting a live entry rebuilds without it; a failed rebuild restores it', async () => {
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    let d = await editor.get('/collections/posts/entries/with-html');
    let r = await editor.del(`/collections/posts/entries/with-html?version=${d.json.version}`);
    assert.ok(r.json.job);
    let job = await finish(editor, srv, r.json.job);
    fs.unlinkSync(`${fx.failMarker}.build`);
    assert.equal(job.status, 'failed');
    assert.ok(fs.existsSync(path.join(fx.site, 'src/content/blog/with-html.md')), 'restored after the failed rebuild');
    assert.equal((await editor.get('/trash')).json.some((t) => t.id === 'with-html'), false);

    d = await editor.get('/collections/posts/entries/with-html');
    r = await editor.del(`/collections/posts/entries/with-html?version=${d.json.version}`);
    job = await finish(editor, srv, r.json.job);
    assert.equal(job.status, 'succeeded');
    assert.ok(!liveIds(fx).includes('with-html'));
  });

  test('pages (no status): PUT commits, and publish works as "Update" (save + checks + build + deploy)', async () => {
    const p = await editor.get('/collections/pages/entries/about');
    const r = await editor.post('/collections/pages/entries/about/publish', { version: p.json.version, changes: [{ path: 'title', value: 'About us' }] });
    assert.equal(r.status, 202);
    const job = await finish(editor, srv, r.json.job);
    assert.equal(job.status, 'succeeded', job.log);
    assert.deepEqual(job.steps.map((s) => s.name), ['commit', 'checks', 'build', 'deploy']);
    assert.equal(JSON.parse(readFile(fx, 'src/content/pages/about.json')).title, 'About us');
    assert.equal((await alice.post('/collections/pages/entries/about/publish', { version: r.json.version })).status, 403, 'authors cannot update pages');
    assert.equal((await editor.post('/collections/pages/entries/about/unpublish', { version: r.json.version })).status, 400, 'no draft status for pages');
  });

  test('jobs list and the audit trail of publishing', async () => {
    const list = await editor.get('/jobs?limit=50');
    assert.ok(list.json.length >= 8);
    assert.ok(list.json.every((j) => j.log === undefined));
    // a job's log (build and deploy output) is for whoever started it and for editors and up, never every role
    const mine = list.json.find((j) => j.userId === alice.user.id);
    assert.ok(mine, 'alice started a job above');
    const theirs = list.json.find((j) => j.userId !== alice.user.id);
    assert.equal((await alice.get(`/jobs/${mine.id}`)).status, 200, 'her own');
    assert.equal((await alice.get(`/jobs/${theirs.id}`)).status, 403, 'someone else\'s: not an editor');
    const contributor = await as(srv, 'contributor', { authorSlug: 'carol' });
    assert.equal((await contributor.get(`/jobs/${mine.id}`)).status, 403);
    assert.equal((await contributor.get('/jobs')).status, 200, 'the list without logs stays open');
    assert.equal((await editor.get(`/jobs/${mine.id}`)).status, 200, 'an editor reads every job');
    assert.equal((await editor.get('/jobs/j_nothing')).status, 404);
    const owner = await as(srv, 'owner');
    const audit = await owner.get('/audit?action=job.');
    assert.ok(audit.json.items.some((a) => a.action === 'job.failed'));
    assert.ok(audit.json.items.some((a) => a.action === 'job.succeeded'));
    const pub = await owner.get('/audit?action=entry.publish');
    assert.ok(pub.json.items.length >= 1);
  });
});
