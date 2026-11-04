// Environments end to end (docs/ENVIRONMENTS.md "Proof required before done"): production and staging, each its own
// server, clone and data dir, sharing one bare remote, with a developer's clone as the laptop. Every step goes
// through the HTTP API as people would, and the proof is read back from git, the live folders and the audit log.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as } from './helpers.mjs';
import { LAYOUT_V2, PRODUCTION, STAGING, commit, makeEnvFixture, page, plan, sh, startEnv, waitJob } from './env-fixture.mjs';

describe('Environments: production and staging sharing one remote', () => {
  let fx, prod, staging, pOwner, sOwner, pEditor;
  const live = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const remoteSha = (branch) => sh(fx.remote, 'rev-parse', branch);
  const audits = (srv, action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
  const rebuild = async (srv, c) => waitJob(srv, (await c.post('/site/publish', {})).json.job);
  /** Publish a new heading for a page through the editor's API (commit, build, deploy, push). */
  async function publish(srv, c, id, heading) {
    const cur = await c.get(`/collections/pages/entries/${id}`);
    const r = await c.post(`/collections/pages/entries/${id}/publish`, { version: cur.json.version, changes: [{ path: 'sections.0.value.heading', value: heading }] });
    assert.equal(r.status, 202, JSON.stringify(r.json));
    const j = await waitJob(srv, r.json.job);
    assert.equal(j.status, 'succeeded', j.error);
  }
  /** Run a ready plan and wait for it; returns {plan, job}. */
  async function runPlan(srv, c, p, body = {}) {
    const r = await c.post(`/env/plans/${p.id}/run`, { version: p.version, ...body });
    assert.equal(r.status, 202, JSON.stringify(r.json));
    const job = await waitJob(srv, r.json.job);
    return { plan: (await c.get(`/env/plans/${p.id}`)).json, job };
  }

  before(async () => {
    fx = makeEnvFixture();
    prod = await startEnv(fx, 'production', { environment: PRODUCTION });
    staging = await startEnv(fx, 'staging', { environment: STAGING(prod.base) });
    pOwner = await as(prod, 'owner');
    pEditor = await as(prod, 'editor');
    sOwner = await as(staging, 'owner');
    // each environment has a release live before anything is promoted
    assert.equal((await rebuild(prod, pOwner)).status, 'succeeded');
    assert.equal((await rebuild(staging, sOwner)).status, 'succeeded');
  });
  after(async () => {
    await prod?.close();
    await staging?.close();
  });

  test('each server says which environment it is; staging says noindex on every answer', async () => {
    const p = (await pOwner.get('/env?fetch=1')).json;
    assert.equal(p.name, 'production');
    assert.equal(p.production, true);
    assert.equal(p.branch, 'main');
    assert.equal(p.remote.ok, true);
    assert.equal(p.remote.head, p.head, 'production pushed what it deployed');
    const s = await sOwner.get('/env?fetch=1');
    assert.equal(s.json.name, 'staging');
    assert.equal(s.json.production, false);
    assert.equal(s.json.ribbon, '#b45309');
    assert.equal(s.json.handoff.to, 'production');
    assert.equal(s.json.handoff.url, `${prod.base}/markstage/#/environments?plan=promote&source=staging&sha=${s.json.head}`);
    assert.equal(s.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await fetch(`${staging.base}/markstage/`)).headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await fetch(`${staging.base}/markstage/api/env`)).headers.get('x-robots-tag'), 'noindex, nofollow', 'even a refusal');
    // the CMS is never for search engines, production included (the live site is served by the release, not here)
    assert.equal((await fetch(`${prod.base}/markstage/`)).headers.get('x-robots-tag'), 'noindex, nofollow');
  });

  test('a developer promotes a template change and a new page to staging, then staging to production', async () => {
    sh(fx.laptop, 'checkout', '-q', '-b', 'my-change');
    commit(fx.laptop, { 'src/layouts/page.html': LAYOUT_V2, 'src/content/pages/pricing.json': page('Pricing', '/pricing/', 'Plans and prices') }, 'New layout and a pricing page', { push: 'my-change' });

    const toStaging = await plan(sOwner, staging, { action: 'promote', source: 'my-change' });
    assert.equal(toStaging.status, 'ready', JSON.stringify(toStaging.checks));
    assert.equal(toStaging.from.env, 'branch');
    assert.deepEqual(toStaging.files.groups.templates.map((f) => f.path), ['src/layouts/page.html']);
    assert.deepEqual(toStaging.files.groups.pages.map((f) => [f.path, f.status]), [['src/content/pages/pricing.json', 'added']]);
    assert.deepEqual(toStaging.pages.added, ['/pricing/']);
    assert.deepEqual(toStaging.pages.changed, ['/', '/about/', '/old-offer/', '/services/'], 'the layout changed every page');
    assert.equal(toStaging.decision.effect, 'allow');
    assert.equal(toStaging.decision.rule.id, 'developers-to-staging');
    assert.equal(toStaging.summary.status, 'facts');
    assert.match(toStaging.summary.text, /1 template, 1 content file changed; 4 pages look different; 1 new page; 3 checks passed\./);
    const done = await runPlan(staging, sOwner, toStaging);
    assert.equal(done.job.status, 'succeeded', done.job.error);
    assert.equal(done.plan.status, 'done');
    assert.match(live(fx.stagingLive, 'pricing/index.html'), /Site v2/);
    assert.equal(remoteSha('staging'), sh(fx.stagingSite, 'rev-parse', 'HEAD'), 'staging pushed what went live');

    const toProd = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(toProd.from.env, 'staging');
    assert.equal(toProd.status, 'ready');
    assert.equal(toProd.decision.rule.id, 'staging-to-production');
    const before = sh(fx.prodSite, 'rev-parse', 'HEAD');
    const ran = await runPlan(prod, pOwner, toProd, { reason: 'New layout' });
    assert.equal(ran.job.status, 'succeeded', ran.job.error);
    assert.match(live(fx.prodLive, 'pricing/index.html'), /Plans and prices/);
    assert.match(live(fx.prodLive, 'about/index.html'), /Site v2/);
    assert.equal(sh(fx.prodSite, 'rev-parse', 'HEAD'), toProd.merged);
    assert.equal(remoteSha('main'), toProd.merged);
    const me = (await pOwner.get('/auth/me')).json.user;
    assert.deepEqual(ran.plan.runBy, { id: me.id, name: me.name }, 'who ran it, like the author');
    // a screenshot by the name plan.shots gives it (a name with a dot: the route has the extension in it)
    const shots = path.join(prod.app.config.dataDir, 'env', 'plans', toProd.id, 'shots');
    fs.mkdirSync(shots, { recursive: true });
    fs.writeFileSync(path.join(shots, '1-1440-after.png'), 'PNG BYTES');
    const shot = await pOwner.get(`/env/plans/${toProd.id}/shots/1-1440-after.png`);
    assert.equal(shot.status, 200, shot.text);
    assert.equal(shot.text, 'PNG BYTES');
    for (const bad of ['1-1440-after.jpg', '1-1440-sideways.png', 'x.png']) assert.equal((await pOwner.get(`/env/plans/${toProd.id}/shots/${bad}`)).status, 404, bad);
    const row = audits(prod, 'env.promote').at(-1);
    assert.equal(row.ok, 1);
    const d = JSON.parse(row.detail);
    assert.deepEqual([d.from, d.to, d.merged, d.release, d.reason], [toProd.from.sha, before, toProd.merged, toProd.merged, 'New layout']);
  });

  test('sync down brings production content to staging and keeps a staging-only page', async () => {
    commit(fx.stagingSite, { 'src/content/pages/lab.json': page('Lab', '/lab/', 'Only on staging') }, 'A staging-only page');
    await rebuild(staging, sOwner);
    await publish(prod, pEditor, 'about', 'Edited on production');
    const p = await plan(sOwner, staging, { action: 'sync' });
    assert.equal(p.action, 'sync');
    assert.equal(p.from.env, 'production');
    assert.equal(p.decision.rule.id, 'sync-down');
    assert.equal(p.status, 'ready');
    const ran = await runPlan(staging, sOwner, p);
    assert.equal(ran.job.status, 'succeeded', ran.job.error);
    assert.match(live(fx.stagingLive, 'lab/index.html'), /Only on staging/);
    assert.match(live(fx.stagingLive, 'about/index.html'), /Edited on production/);
    assert.ok(fs.existsSync(path.join(fx.stagingSite, 'src/content/pages/lab.json')));
  });

  test('a conflict is named in plain words, then resolved each way; a page both edited in different places merges', async () => {
    await publish(prod, pEditor, 'services', 'Production words');
    commit(fx.stagingSite, { 'src/content/pages/services.json': page('Services', '/services/', 'Staging words') }, 'Staging edits services');
    await rebuild(staging, sOwner);
    let p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(p.status, 'conflicts');
    assert.equal(p.conflicts.length, 1);
    const c = p.conflicts[0];
    assert.equal(c.path, 'src/content/pages/services.json');
    assert.equal(c.entry.title, 'Services');
    assert.match(c.words, /^the page “Services” \(src\/content\/pages\/services\.json\): production changed it \(editor-[0-9a-f]+, \d+ \w+\) and staging changed it too, in 1 place both changed differently\.$/);
    assert.match(c.ours, /Production words/);
    assert.match(c.theirs, /Staging words/);
    const run409 = await pOwner.post(`/env/plans/${p.id}/run`, { version: p.version });
    assert.equal(run409.status, 409, 'a plan with conflicts does not run');
    const r = await pOwner.post(`/env/plans/${p.id}/resolve`, { conflictId: c.id, take: 'ours', version: p.version });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await waitJob(prod, r.json.job);
    p = (await pOwner.get(`/env/plans/${p.id}`)).json;
    assert.equal(p.status, 'ready');
    assert.equal((await runPlan(prod, pOwner, p)).job.status, 'succeeded');
    assert.match(live(fx.prodLive, 'services/index.html'), /Production words/);

    // theirs and a hand-merged text, plus a page both changed in different leaves (git sees a conflict, the
    // content-aware merge does not: staging wrote it on one line)
    await publish(prod, pEditor, 'home', 'Home from production');
    await publish(prod, pEditor, 'about', 'About from production');
    const oldOffer = JSON.parse(fs.readFileSync(path.join(fx.prodSite, 'src/content/pages/old-offer.json'), 'utf8'));
    const cur = await pEditor.get('/collections/pages/entries/old-offer');
    const t = await pEditor.post('/collections/pages/entries/old-offer/publish', { version: cur.json.version, changes: [{ path: 'title', value: 'Old offer (2025)' }] });
    await waitJob(prod, t.json.job);
    sh(fx.stagingSite, 'pull', '-q', '--no-rebase', 'origin', 'staging');
    commit(fx.stagingSite, { 'src/content/pages/home.json': page('Home', '/', 'Home from staging'), 'src/content/pages/about.json': page('About', '/about/', 'About from staging'), 'src/content/pages/old-offer.json': JSON.stringify({ ...oldOffer, sections: [{ discriminant: 'hero', value: { heading: 'Heading from staging' } }] }) }, 'Staging edits three pages');
    await rebuild(staging, sOwner);
    p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(p.status, 'conflicts');
    assert.deepEqual(p.conflicts.map((x) => x.path).sort(), ['src/content/pages/about.json', 'src/content/pages/home.json']);
    assert.deepEqual(p.files.autoMerged, ['src/content/pages/old-offer.json']);
    const home = p.conflicts.find((x) => x.path.endsWith('home.json'));
    const about = p.conflicts.find((x) => x.path.endsWith('about.json'));
    let v = (await pOwner.post(`/env/plans/${p.id}/resolve`, { conflictId: home.id, take: 'theirs', version: p.version })).json;
    assert.equal(v.plan.status, 'conflicts', 'one is still open');
    v = (await pOwner.post(`/env/plans/${p.id}/resolve`, { conflictId: about.id, take: 'text', text: page('About', '/about/', 'About, merged by hand'), version: v.plan.version })).json;
    await waitJob(prod, v.job);
    p = (await pOwner.get(`/env/plans/${p.id}`)).json;
    assert.equal(p.status, 'ready', JSON.stringify(p.checks));
    assert.equal((await runPlan(prod, pOwner, p)).job.status, 'succeeded');
    assert.match(live(fx.prodLive, 'index.html'), /Home from staging/);
    assert.match(live(fx.prodLive, 'about/index.html'), /About, merged by hand/);
    assert.match(live(fx.prodLive, 'old-offer/index.html'), /<title>Old offer \(2025\)<\/title>.*Heading from staging/s, 'both edits of the page kept');
    assert.deepEqual(audits(prod, 'env.resolve').slice(-2).map((a) => JSON.parse(a.detail).take), ['theirs', 'text']);
  });

  test('a failed check blocks; a failed build leaves production unchanged; a rollback leaves the branch equal to what is live', async () => {
    sh(fx.stagingSite, 'pull', '-q', '--no-rebase', 'origin', 'staging');
    commit(fx.stagingSite, { 'src/content/pages/careers.json': page('Careers', '/careers/', 'FORBIDDEN-WORD here') }, 'A page that fails the check');
    await rebuild(staging, sOwner);
    let p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(p.status, 'blocked');
    const words = p.checks.find((c) => c.id === 'words');
    assert.equal(words.status, 'failed');
    assert.match(words.words, /pages\/careers: Remove FORBIDDEN-WORD/);
    const refused = await pOwner.post(`/env/plans/${p.id}/run`, { version: p.version });
    assert.equal(refused.status, 409);

    commit(fx.stagingSite, { 'src/content/pages/careers.json': page('Careers', '/careers/', 'Join us') }, 'Fix the careers page');
    await rebuild(staging, sOwner);
    p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(p.status, 'ready');
    const head = sh(fx.prodSite, 'rev-parse', 'HEAD');
    const liveBefore = live(fx.prodLive, 'index.html');
    fs.writeFileSync(`${fx.fail}.build`, '');
    try {
      const ran = await runPlan(prod, pOwner, p);
      assert.equal(ran.job.status, 'failed');
      assert.equal(ran.plan.status, 'failed');
      assert.match(ran.plan.error, /production is unchanged/);
    } finally {
      fs.rmSync(`${fx.fail}.build`, { force: true });
    }
    assert.equal(sh(fx.prodSite, 'rev-parse', 'HEAD'), head, 'the branch went back');
    assert.equal(live(fx.prodLive, 'index.html'), liveBefore);
    assert.equal(fs.existsSync(path.join(fx.prodLive, 'careers')), false);
    assert.equal(remoteSha('main'), head);

    // put a release live, then roll it back
    p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal((await runPlan(prod, pOwner, p)).job.status, 'succeeded');
    assert.ok(fs.existsSync(path.join(fx.prodLive, 'careers/index.html')));
    const back = prod.app.jobs.liveHistory().at(-1);
    const rb = await pOwner.post('/env/rollback', { reason: 'Careers page is not ready' });
    assert.equal(rb.status, 202, JSON.stringify(rb.json));
    assert.equal(rb.json.to, back);
    const j = await waitJob(prod, rb.json.job);
    assert.equal(j.status, 'succeeded', j.error);
    assert.equal(fs.existsSync(path.join(fx.prodLive, 'careers')), false, 'the release before is live');
    const now = sh(fx.prodSite, 'rev-parse', 'HEAD');
    assert.equal(sh(fx.prodSite, 'diff', '--stat', back, now), '', 'the branch has exactly the files of the live release');
    assert.equal(sh(fx.prodSite, 'rev-parse', `${now}^`), p.merged, 'a new commit on top: history is kept');
    assert.equal(remoteSha('main'), now, 'and it is pushed');
    assert.equal(prod.app.jobs.liveHead(), now);
    const a = JSON.parse(audits(prod, 'env.rollback').at(-1).detail);
    assert.deepEqual([a.from, a.to, a.revert, a.reason], [p.merged, back, now, 'Careers page is not ready']);
  });

  test('a person the rules do not allow is refused, in words, and it is audited', async () => {
    const dev = await as(prod, 'contributor');
    const r = await dev.post('/env/plans', { action: 'promote', source: 'staging' });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'rule');
    assert.match(r.json.words, /^No rule lets contributor-[0-9a-f]+ promote from staging to production\.$/);
    const row = audits(prod, 'env.promote').at(-1);
    assert.equal(row.ok, 0);
    assert.equal(row.user_id, dev.user.id);
    assert.equal(JSON.parse(row.detail).stage, 'plan');

    // on staging, a contributor in the developers group may promote a branch there
    const sdev = await as(staging, 'contributor');
    assert.equal((await sdev.post('/env/plans', { action: 'promote', source: 'my-change' })).status, 403);
    const rules = (await sOwner.get('/env/rules')).json;
    const put = await sOwner.put('/env/rules', { version: rules.version, groups: { ...rules.groups, developers: [sdev.user.id] }, rules: rules.rules });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.equal(put.json.version, 'r1');
    assert.equal(fs.statSync(path.join(fx.stagingData, 'promotion-rules.json')).mode & 0o777, 0o600);
    assert.equal((await sdev.post('/env/plans', { action: 'promote', source: 'my-change' })).status, 202);
    const notice = staging.app.db.prepare("SELECT * FROM notices WHERE kind = 'env.rules-changed'").get();
    assert.match(notice.text, /changed the promotion rules on staging: changed the groups\./);
  });

  test('a freeze that begins between the plan and the run refuses the run, naming the rule', async () => {
    commit(fx.stagingSite, { 'src/content/pages/team.json': page('Team', '/team/', 'The team') }, 'A team page');
    await rebuild(staging, sOwner);
    const p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(p.status, 'ready');
    const rules = (await pOwner.get('/env/rules')).json;
    const frozen = rules.rules.map((r) => (r.id === 'owner-freeze' ? { ...r, when: { freezes: [{ from: new Date(Date.now() - 60_000).toISOString(), words: 'launch week' }] } } : r));
    assert.equal((await pOwner.put('/env/rules', { version: rules.version, groups: rules.groups, rules: frozen })).status, 200);
    const r = await pOwner.post(`/env/plans/${p.id}/run`, { version: p.version });
    assert.equal(r.status, 403);
    assert.equal(r.json.rule.id, 'owner-freeze');
    assert.equal(r.json.words, 'Refused by the rule “Nobody puts changes live on production during a freeze the owner set”: launch week.');
    assert.equal(JSON.parse(audits(prod, 'env.promote').at(-1).detail).rule, 'owner-freeze');
    const now = (await pOwner.get('/env/rules')).json;
    assert.equal((await pOwner.put('/env/rules', { version: now.version, groups: now.groups, rules: rules.rules })).status, 200);
    assert.equal((await runPlan(prod, pOwner, (await pOwner.get(`/env/plans/${p.id}`)).json)).job.status, 'succeeded');
  });

  test('a plan goes stale when production moves, and cannot run', async () => {
    commit(fx.stagingSite, { 'src/content/pages/faq.json': page('FAQ', '/faq/', 'Questions') }, 'An FAQ page');
    await rebuild(staging, sOwner);
    const p = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(p.status, 'ready');
    await publish(prod, pEditor, 'home', 'Home moved on');
    const now = (await pOwner.get(`/env/plans/${p.id}`)).json;
    assert.equal(now.status, 'stale');
    assert.match(now.note, /production moved since this plan was made .* Re-plan\./);
    const r = await pOwner.post(`/env/plans/${p.id}/run`, { version: now.version });
    assert.equal(r.status, 409);
    const again = await plan(pOwner, prod, { action: 'promote', source: 'staging' });
    assert.equal(again.status, 'ready', 're-plan works');
    assert.equal((await pOwner.post(`/env/plans/${again.id}/cancel`, { version: again.version })).json.plan.status, 'cancelled');
  });
});
