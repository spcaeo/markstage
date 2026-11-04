// Roll back a bad release from the editor (docs/OPERATIONS.md): owner and administrators only, through the site's
// own rollback command; what was live before comes back, the content stays saved, editors are told, and the next
// publish lists the rolled-back changes again ("what else goes live" counts from the commit live now).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';

// the site's rollback command (a stand-in for markstage-deploy rollback): records that it ran
const ROLLBACK = `import fs from 'node:fs';
fs.appendFileSync(process.argv[2], 'rolled back\\n');
process.exit(fs.existsSync(process.argv[2] + '.fail') ? 1 : 0);
`;

describe('roll back', () => {
  let fx;
  let srv;
  let admin;
  let editor;
  let marker;
  const head = () => srv.app.db.prepare("SELECT value FROM kv WHERE key = 'deploy.head'").get()?.value ?? null;

  before(async () => {
    fx = makeFixture();
    const script = path.join(fx.data, 'rollback.mjs');
    marker = path.join(fx.data, 'rollback.log');
    fs.writeFileSync(script, ROLLBACK);
    const cfg = JSON.parse(fs.readFileSync(path.join(fx.data, 'config.json'), 'utf8'));
    srv = await startServer(fx, { overrides: { commands: { ...cfg.commands, rollback: [process.execPath, script, marker] } } });
    admin = await as(srv, 'administrator');
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(() => srv.close());

  test('two deploys, then a rollback: the commit before is live again, editors told, audited', async () => {
    assert.equal((await admin.get('/site/health')).json.deploy.canRollBack, false, 'nothing to go back to yet');
    await admin.post('/site/publish', {});
    await srv.app.jobs.idle();
    const first = head();
    const e = await editor.get('/collections/posts/entries/with-html');
    assert.equal((await editor.post('/collections/posts/entries/with-html/publish', { version: e.json.version, source: (await editor.get('/collections/posts/entries/with-html/source')).json.source.replace('Intro.', 'Intro, changed.') })).status, 202);
    await srv.app.jobs.idle();
    assert.notEqual(head(), first);
    assert.equal((await admin.get('/site/health')).json.deploy.canRollBack, true);

    assert.equal((await editor.post('/site/rollback', {})).status, 403);
    const r = await admin.post('/site/rollback', {});
    assert.equal(r.status, 202, r.text);
    await srv.app.jobs.idle();
    const job = (await admin.get(`/jobs/${r.json.job}`)).json;
    assert.equal(job.status, 'succeeded', job.log);
    assert.deepEqual(job.steps.map((s) => s.name), ['rollback']);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'rolled back\n');
    assert.equal(head(), first, 'the commit live before is live again');
    assert.match((await editor.get('/notices')).json.items[0].text, /rolled the site back to the release before\. Changes saved since are not live/);
    assert.ok((await admin.get('/audit?action=site.rollback')).json.items.length >= 1);
    // the content stays saved; the next publish's sheet lists it as going live again
    assert.match((await editor.get('/collections/posts/entries/with-html/source')).json.source, /Intro, changed\./);
    const pf = (await editor.get('/collections/posts/entries/bob-draft/preflight')).json;
    assert.deepEqual(pf.alsoLive.entries.map((x) => x.id), ['with-html']);
    const h = (await admin.get('/site/health')).json.deploy;
    assert.equal(h.kind, 'rollback');
    assert.equal(h.canRollBack, false, 'one step back at a time: nothing older is known');
  });

  test('a failed rollback leaves the live commit as it was; not set up: refused in plain words', async () => {
    const was = head();
    fs.writeFileSync(`${marker}.fail`, '');
    const r = await admin.post('/site/rollback', {});
    await srv.app.jobs.idle();
    assert.equal((await admin.get(`/jobs/${r.json.job}`)).json.status, 'failed');
    assert.equal(head(), was);
    fs.unlinkSync(`${marker}.fail`);
    const plain = await startServer(makeFixture());
    try {
      const a = await as(plain, 'owner');
      const no = await a.post('/site/rollback', {});
      assert.equal(no.status, 400);
      assert.match(no.json.message, /not set up on this server/);
    } finally {
      await plain.close();
    }
  });
});
