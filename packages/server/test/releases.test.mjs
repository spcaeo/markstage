// Releases: a draft, a change to a live page, a shared Library item and a picture go live together in one commit,
// by hand or at their time, through the promotion rules (publish-release). Nothing reaches the repo before; a file
// changed on the site meanwhile is named and stops it; a failed build puts every file back; a published release
// rolls back. The preview, built as of the publish time, is the published build byte for byte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makePng, readFile } from './helpers.mjs';
import { keep, releaseServer, treeOf } from './release-site.mjs';

describe('releases', () => {
  let fx, srv, clock, ed, owner;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const idle = () => srv.app.jobs.idle();
  const entryV = async (c, id) => (await ed.get(`/collections/${c}/entries/${id}`)).json.version;
  const release = async (name, who = ed) => (await who.post('/releases', { name })).json;
  const get = async (id, who = ed) => (await who.get(`/releases/${id}`)).json;
  const addEntry = async (rid, c, id, extra = {}, who = ed) => who.post(`/releases/${rid}/items`, { kind: 'entry', collection: c, id, version: await entryV(c, id), ...extra });
  const job = async (id) => (await ed.get(`/jobs/${id}`)).json;
  const audits = (action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
  const rules = async (doc) => {
    const cur = (await owner.get('/env/rules')).json;
    const r = await owner.put('/env/rules', { version: cur.version, ...doc(cur) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const starter = async () => rules((cur) => ({ groups: cur.starter.groups, rules: cur.starter.rules }));

  before(async () => {
    ({ fx, srv, clock } = await releaseServer());
    ed = await as(srv, 'editor');
    owner = await as(srv, 'owner');
  });
  after(() => srv.close());

  test('a draft, a live page’s change, a Library item and a picture: nothing in the repo before; one commit, one build, one deploy', async () => {
    const r = await release('Autumn launch');
    assert.equal(r.status, 'open');
    assert.match(r.id, /^rl_/);
    const start = head();
    // the draft as it is, the live post with new words, a new shared snippet, a picture
    assert.equal((await addEntry(r.id, 'posts', 'bob-draft')).status, 201);
    const src = readFile(fx, 'src/content/blog/hello-world.md').replace('First paragraph.', 'First paragraph, for the launch.');
    assert.equal((await addEntry(r.id, 'posts', 'hello-world', { source: src })).status, 201);
    const lib = await ed.post(`/releases/${r.id}/items`, { kind: 'library', item: { kind: 'snippet', name: 'Launch note', body: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Now open.' }] }] } } } });
    assert.equal(lib.status, 201, JSON.stringify(lib.json));
    const pic = await ed.post(`/releases/${r.id}/media?filename=Launch%20Hero.png&alt=The%20hero`, makePng());
    assert.equal(pic.status, 201, JSON.stringify(pic.json));
    assert.equal(pic.json.item.path, 'src/assets/uploads/2026/11/launch-hero.png');
    assert.equal(pic.json.item.url, '/uploads/2026/11/launch-hero.png');
    const view = pic.json.release;
    assert.deepEqual(view.counts, { items: 4, entries: 2, library: 1, media: 1 });
    assert.deepEqual(view.items.map((i) => [i.kind, i.isNew, i.changedSince]), [['entry', false, false], ['entry', false, false], ['library', true, false], ['media', true, false]]);
    assert.equal(view.decision.effect, 'allow', view.decision.words);
    // the site has none of it yet
    assert.equal(head(), start);
    assert.match(readFile(fx, 'src/content/blog/bob-draft.md'), /^draft: true$/m);
    assert.equal(fs.existsSync(path.join(fx.site, pic.json.item.path)), false);
    // an upload meanwhile takes another name: the release keeps its own
    const up = await ed.post('/media?filename=Launch%20Hero.png', makePng());
    assert.equal(up.json.path, 'src/assets/uploads/2026/11/launch-hero-2.png');
    const p = await ed.post(`/releases/${r.id}/publish`, { version: view.version });
    assert.equal(p.status, 202, JSON.stringify(p.json));
    await idle();
    const done = await get(r.id);
    assert.equal(done.status, 'published', done.error);
    assert.equal((await job(p.json.job)).status, 'succeeded');
    // one commit with the four files, named for the release, by who published it
    const log = fx.git('log', '-1', '--format=%s|%an').trim();
    assert.equal(log, `Release “Autumn launch”|${ed.user.email.split('@')[0]}`);
    assert.deepEqual(fx.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(), ['markstage/library/snippet/' + lib.json.item.libraryId + '.json', 'src/assets/uploads/2026/11/launch-hero.png', 'src/content/blog/bob-draft.md', 'src/content/blog/hello-world.md'].sort());
    assert.doesNotMatch(readFile(fx, 'src/content/blog/bob-draft.md'), /^draft:/m);
    assert.match(readFile(fx, 'src/content/blog/hello-world.md'), /for the launch/);
    // live: the build that was deployed has the draft's page, the new words, the snippet and the picture
    assert.match(fs.readFileSync(path.join(fx.live, 'blog/bob-draft/index.html'), 'utf8'), /A draft by Bob/);
    assert.match(fs.readFileSync(path.join(fx.live, 'blog/hello-world/index.html'), 'utf8'), /for the launch/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fx.live, 'library.json'), 'utf8')), ['Launch note']);
    assert.ok(fs.existsSync(path.join(fx.live, 'uploads/2026/11/launch-hero.png')));
    // the picture is in the media library with its alt text, the snippet in the Library
    const media = (await ed.get('/media')).json.items.find((m) => m.path === 'src/assets/uploads/2026/11/launch-hero.png');
    assert.equal(media.alt, 'The hero');
    assert.ok((await ed.get(`/library/${lib.json.item.libraryId}`)).json?.name === 'Launch note');
    // a published release takes no more changes
    assert.equal((await addEntry(r.id, 'posts', 'carol-draft')).status, 409);
    assert.equal(audits('release.published').length, 1);
  });

  test('a file changed on the site since it was added: the publish names it and writes nothing', async () => {
    const r = await release('Stale');
    await addEntry(r.id, 'posts', 'carol-draft', { source: readFile(fx, 'src/content/blog/carol-draft.md').replace('Carol writes.', 'Carol writes more.') });
    // someone saves the draft meanwhile
    const v = await entryV('posts', 'carol-draft');
    assert.equal((await ed.put('/collections/posts/entries/carol-draft/source', { version: v, source: readFile(fx, 'src/content/blog/carol-draft.md').replace('Carol writes.', 'Carol edits.') })).status, 200);
    const before = head();
    const cur = await get(r.id);
    assert.equal(cur.items[0].changedSince, true);
    const p = await ed.post(`/releases/${r.id}/publish`, { version: cur.version });
    assert.equal(p.status, 409);
    assert.equal(p.json.error, 'changed');
    assert.match(p.json.message, /“Carol Draft” changed on the site since it was added\. Add it again/);
    assert.equal(head(), before);
    // added again, it goes
    await addEntry(r.id, 'posts', 'carol-draft');
    assert.equal((await get(r.id)).items[0].changedSince, false);
    assert.equal((await get(r.id)).counts.items, 1, 'the same file is one item, replaced');
  });

  test('a scheduled release goes live at its time, not before, built as of that time; its preview is the published build byte for byte', async () => {
    const r = await release('Monday morning');
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/monday.md'), `---\ntitle: Monday\nauthor: alice\ndate: '2026-11-01T10:00:00.000Z'\ndraft: true\n---\n\nThe Monday post.\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A Monday draft');
    await addEntry(r.id, 'posts', 'monday');
    await ed.post(`/releases/${r.id}/media?filename=monday.png`, makePng());
    const at = new Date(clock.now + 3_600_000).toISOString();
    const s = await ed.post(`/releases/${r.id}/schedule`, { version: (await get(r.id)).version, publishAt: at });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    assert.equal(s.json.status, 'scheduled');
    assert.equal(s.json.publishAt, at);
    // the preview is built as soon as it is scheduled, as of that time
    await idle();
    const pv = (await get(r.id)).preview;
    assert.deepEqual([pv.status, pv.fresh, pv.buildTime, pv.stale, pv.words], ['ready', true, at, null, null]);
    // the site is pinned for this test: the preview was built on this commit, and the release goes on top of it
    const pinned = head();
    assert.equal(pv.head, pinned);
    const previewDir = path.join(fx.data, 'releases', 'builds', `r_${r.id}`, 'dist');
    assert.match(fs.readFileSync(path.join(previewDir, 'blog/monday/index.html'), 'utf8'), new RegExp(`content="${at}"`));
    const kept = keep(previewDir);
    // not yet
    clock.now += 3_599_000;
    assert.deepEqual(await srv.app.releases.tick(), []);
    assert.equal((await get(r.id)).status, 'scheduled');
    assert.equal(fs.existsSync(path.join(fx.live, 'blog/monday/index.html')), false);
    // its time, a minute late (the next tick): still built as of its time, not of now
    clock.now += 61_000;
    const started = await srv.app.releases.tick();
    assert.equal(started.length, 1);
    await idle();
    const done = await get(r.id);
    assert.equal(done.status, 'published', done.error);
    assert.equal(done.buildTime, at);
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Release “Monday morning”');
    assert.equal(fx.git('rev-parse', 'HEAD^').trim(), pinned, 'nothing else went live in between');
    assert.match(fs.readFileSync(path.join(fx.live, 'blog/monday/index.html'), 'utf8'), new RegExp(`content="${at}"`));
    // byte for byte: every file the preview built is the file the publish built, and no other
    const a = treeOf(kept);
    const b = treeOf(path.join(fx.site, 'dist'));
    assert.ok(Object.keys(a).length >= 8, Object.keys(a).join(', '));
    assert.deepEqual(b, a);
    // the preview's folder is gone with it
    assert.equal(fs.existsSync(path.join(fx.data, 'releases', 'builds', `r_${r.id}`)), false);
    assert.equal(audits('release.published').at(-1).user_name, 'scheduler');
  });

  test('a preview goes stale, in words, when the site moves under it or the release changes; built again, it is fresh', async () => {
    const r = await release('Stale');
    await addEntry(r.id, 'posts', 'carol-draft');
    assert.equal((await ed.post(`/releases/${r.id}/preview`, {})).status, 202);
    await idle();
    let pv = (await get(r.id)).preview;
    assert.deepEqual([pv.status, pv.fresh, pv.stale, pv.head], ['ready', true, null, head()]);
    // another change goes live on the site's branch
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/elsewhere.md'), `---\ntitle: Elsewhere\nauthor: alice\ndate: '2026-11-01T10:00:00.000Z'\n---\n\nAnother change.\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Another change went live');
    pv = (await get(r.id)).preview;
    assert.deepEqual([pv.status, pv.fresh, pv.stale], ['ready', false, 'site']);
    assert.equal(pv.words, 'The site changed since this preview was built (another change went live). It is not what would go live now: build it again.');
    // and the release changed too
    await ed.post(`/releases/${r.id}/media?filename=stale.png`, makePng());
    pv = (await get(r.id)).preview;
    assert.equal(pv.stale, 'both');
    assert.match(pv.words, /^The site and the release changed since this preview was built\. It is not what would go live now: build it again\.$/);
    // built again: fresh, on the new head
    assert.equal((await ed.post(`/releases/${r.id}/preview`, {})).status, 202);
    await idle();
    pv = (await get(r.id)).preview;
    assert.deepEqual([pv.fresh, pv.stale, pv.words, pv.head], [true, null, null, head()]);
    // only the release changed: said so
    await ed.post(`/releases/${r.id}/media?filename=stale-2.png`, makePng());
    pv = (await get(r.id)).preview;
    assert.deepEqual([pv.fresh, pv.stale], [false, 'release']);
    assert.match(pv.words, /^The release changed since this preview was built\./);
  });

  test('the rules: a deny stops a publish and a schedule, in words, audited; a freeze at the scheduled time stops the schedule', async () => {
    const r = await release('Ruled');
    await addEntry(r.id, 'posts', 'carol-draft', { source: readFile(fx, 'src/content/blog/carol-draft.md').replace('Carol', 'Carol R') });
    await rules((cur) => ({ groups: cur.groups, rules: [...cur.rules, { id: 'no-releases', name: 'No releases this week', action: ['publish-release'], effect: 'deny' }] }));
    const before = head();
    const p = await ed.post(`/releases/${r.id}/publish`, { version: (await get(r.id)).version });
    assert.equal(p.status, 403);
    assert.equal(p.json.error, 'rule');
    assert.equal(p.json.message, 'Refused by the rule “No releases this week”.');
    assert.equal(p.json.rule.id, 'no-releases');
    assert.equal(head(), before);
    const row = audits('release.publish').at(-1);
    assert.equal(row.ok, 0);
    assert.equal(JSON.parse(row.detail).rule, 'no-releases');
    assert.equal((await ed.post(`/releases/${r.id}/schedule`, { version: (await get(r.id)).version, publishAt: new Date(clock.now + 60_000).toISOString() })).status, 403);
    // the starter rules, and a freeze the owner set from tomorrow: today goes, tomorrow does not
    await rules((cur) => {
      const list = structuredClone(cur.starter.rules);
      list.find((x) => x.id === 'owner-freeze').when.freezes.push({ from: new Date(clock.now + 86_400_000).toISOString(), words: 'the launch week' });
      return { groups: cur.starter.groups, rules: list };
    });
    const frozen = await ed.post(`/releases/${r.id}/schedule`, { version: (await get(r.id)).version, publishAt: new Date(clock.now + 2 * 86_400_000).toISOString() });
    assert.equal(frozen.status, 403);
    assert.equal(frozen.json.rule.id, 'owner-freeze');
    assert.match(frozen.json.message, /the launch week/);
    await starter();
  });

  test('at its time, as who scheduled it: a freeze that began since, or a right they lost, blocks it; it stays scheduled, says why once, and goes when nothing stops it', async () => {
    const sched = await as(srv, 'editor');
    const r = await release('Blocked', sched);
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/blocked.md'), `---\ntitle: Blocked\nauthor: alice\ndate: '2026-11-01T10:00:00.000Z'\ndraft: true\n---\n\nBlocked for now.\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A blocked draft');
    await addEntry(r.id, 'posts', 'blocked', {}, sched);
    const at = new Date(clock.now + 60_000).toISOString();
    assert.equal((await sched.post(`/releases/${r.id}/schedule`, { version: (await get(r.id, sched)).version, publishAt: at })).status, 200);
    await idle();
    const before = head();
    const notices = () => srv.app.db.prepare("SELECT * FROM notices WHERE kind = 'release.blocked' AND user_id = ? ORDER BY rowid").all(sched.user.id);
    // the owner freezes production from now on, after it was scheduled
    await rules((cur) => {
      const list = structuredClone(cur.starter.rules);
      list.find((x) => x.id === 'owner-freeze').when.freezes.push({ from: new Date(clock.now).toISOString(), words: 'the launch week' });
      return { groups: cur.starter.groups, rules: list };
    });
    clock.now += 61_000;
    assert.deepEqual(await srv.app.releases.tick(), []);
    let cur = await get(r.id, sched);
    assert.equal(cur.status, 'scheduled', 'it stays scheduled');
    assert.equal(cur.blocked.rule.id, 'owner-freeze');
    assert.match(cur.blocked.words, /^Refused by the rule “Nobody puts changes live on production during a freeze the owner set”: the launch week\.$/);
    assert.equal(head(), before);
    assert.equal(notices().length, 1);
    assert.match(notices()[0].text, /^The release “Blocked” was due at .* and is blocked: Refused by the rule .*the launch week\. It stays scheduled/);
    assert.equal(JSON.parse(audits('release.blocked').at(-1).detail).rule, 'owner-freeze');
    // the next ticks, for the same reason: no more alerts
    await srv.app.releases.tick();
    await srv.app.releases.tick();
    assert.equal(notices().length, 1);
    // the freeze lifted, but who scheduled it is an author now: blocked again, for that, said once
    await starter();
    srv.app.db.prepare("UPDATE users SET role = 'author', author_slug = 'alice' WHERE id = ?").run(sched.user.id);
    await srv.app.releases.tick();
    cur = await get(r.id);
    assert.equal(cur.status, 'scheduled');
    assert.equal(cur.blocked.rule, null);
    assert.match(cur.blocked.words, /^No rule lets .* publish-release from release to production with this change\.$/);
    assert.equal(notices().length, 2);
    // the right back: out on the next tick, as of its time
    srv.app.db.prepare("UPDATE users SET role = 'editor' WHERE id = ?").run(sched.user.id);
    assert.equal((await srv.app.releases.tick()).length, 1);
    await idle();
    cur = await get(r.id);
    assert.deepEqual([cur.status, cur.blocked, cur.buildTime], ['published', null, at]);
    assert.ok(fs.existsSync(path.join(fx.live, 'blog/blocked/index.html')));
  });

  test('a rule that needs an approval: never the author’s own; a change to the release cancels it', async () => {
    await rules((cur) => ({ groups: cur.groups, rules: cur.rules.map((x) => (x.id === 'releases' ? { ...x, effect: 'allow-with-approval' } : x)) }));
    const r = await release('Approved');
    await addEntry(r.id, 'posts', 'carol-draft');
    let cur = await get(r.id);
    assert.equal(cur.decision.effect, 'needs');
    assert.match(cur.decision.words, /1 more approval of this exact version from an owner or an administrator/);
    assert.equal((await ed.post(`/releases/${r.id}/approve`, { version: cur.version })).status, 422, 'not the author');
    // only someone whose approval the rule counts may approve (review 3 Nov, S10): an editor or a contributor here
    // would only add a misleading line to the list
    for (const role of ['contributor', 'editor']) {
      const other = await as(srv, role, { authorSlug: role === 'contributor' ? 'carol' : null });
      assert.equal((await other.get(`/releases/${r.id}`)).json.canApprove, false, role);
      assert.equal((await other.post(`/releases/${r.id}/approve`, { version: cur.version })).status, 403, role);
    }
    assert.equal((await get(r.id)).approvals.length, 0, 'nothing stored');
    assert.equal((await owner.get(`/releases/${r.id}`)).json.canApprove, true);
    assert.equal((await owner.post(`/releases/${r.id}/approve`, { version: cur.version })).status, 200);
    cur = await get(r.id);
    assert.equal(cur.decision.effect, 'allow');
    // a change: the approval was of what it was before
    await ed.post(`/releases/${r.id}/media?filename=late.png`, makePng());
    cur = await get(r.id);
    assert.deepEqual([cur.decision.effect, cur.approvals.length], ['needs', 0]);
    assert.equal((await ed.post(`/releases/${r.id}/publish`, { version: cur.version })).status, 403);
    await owner.post(`/releases/${r.id}/approve`, { version: cur.version });
    const p = await ed.post(`/releases/${r.id}/publish`, { version: (await get(r.id)).version });
    assert.equal(p.status, 202, JSON.stringify(p.json));
    await idle();
    assert.equal((await get(r.id)).status, 'published');
    await starter();
  });

  test('a failed build puts every file back in one commit; the release is open again and says why; a rollback takes a live one off', async () => {
    const r = await release('Fragile');
    fs.writeFileSync(path.join(fx.site, 'src/content/blog/fragile.md'), `---\ntitle: Fragile\nauthor: alice\ndate: '2026-11-01T10:00:00.000Z'\ndraft: true\n---\n\nFragile.\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A fragile draft');
    await addEntry(r.id, 'posts', 'fragile');
    await ed.post(`/releases/${r.id}/media?filename=fragile.png`, makePng());
    const rel = (await get(r.id)).items[1].path;
    fs.writeFileSync(`${fx.failMarker}.build`, '');
    const p = await ed.post(`/releases/${r.id}/publish`, { version: (await get(r.id)).version });
    assert.equal(p.status, 202);
    await idle();
    fs.rmSync(`${fx.failMarker}.build`);
    const back = await get(r.id);
    assert.equal(back.status, 'open');
    assert.match(back.error, /The publish failed.*open again/);
    assert.deepEqual(fx.git('log', '-2', '--format=%s').trim().split('\n'), ['Put back the release “Fragile”: the publish failed', 'Release “Fragile”']);
    assert.match(readFile(fx, 'src/content/blog/fragile.md'), /^draft: true$/m);
    assert.equal(fs.existsSync(path.join(fx.site, rel)), false);
    assert.equal(srv.app.db.prepare('SELECT COUNT(*) AS n FROM media WHERE path = ?').get(rel).n, 0);
    assert.equal(fs.existsSync(path.join(fx.live, 'blog/fragile/index.html')), false);
    // again, and it goes; then rolled back: off the site and out of the repo
    assert.equal((await ed.post(`/releases/${r.id}/publish`, { version: back.version })).status, 202);
    await idle();
    assert.equal((await get(r.id)).status, 'published');
    assert.ok(fs.existsSync(path.join(fx.live, 'blog/fragile/index.html')));
    assert.equal((await ed.post(`/releases/${r.id}/rollback`, {})).status, 403, 'the starter rules: owners and administrators roll back');
    const rb = await owner.post(`/releases/${r.id}/rollback`, { reason: 'wrong week' });
    assert.equal(rb.status, 202, JSON.stringify(rb.json));
    await idle();
    assert.equal((await get(r.id)).status, 'rolled-back');
    assert.equal(fx.git('log', '-1', '--format=%s').trim(), 'Roll back the release “Fragile” (reason: wrong week)');
    assert.match(readFile(fx, 'src/content/blog/fragile.md'), /^draft: true$/m);
    assert.equal(fs.existsSync(path.join(fx.live, 'blog/fragile/index.html')), false);
    assert.equal(fs.existsSync(path.join(fx.site, rel)), false);
  });

  test('what goes in is checked as a save would be: rights, the status keys, a synced item, an SVG, versions', async () => {
    const r = await release('Checked');
    const writer = await as(srv, 'contributor', { authorSlug: 'bob' });
    assert.equal((await writer.post('/releases', { name: 'Mine' })).status, 403);
    assert.equal((await addEntry(r.id, 'posts', 'bob-draft', {}, writer)).status, 403);
    // nothing to release: a live page as it is
    const same = await addEntry(r.id, 'posts', 'with-html');
    assert.equal(same.status, 422);
    assert.equal(same.json.error, 'nothing');
    // a password goes on through Protect only
    const prot = await addEntry(r.id, 'posts', 'with-html', { source: readFile(fx, 'src/content/blog/with-html.md').replace('title: With HTML', 'title: With HTML\nprotected: true') });
    assert.equal(prot.status, 422);
    // an unsafe link, as a save
    const bad = await addEntry(r.id, 'posts', 'with-html', { source: readFile(fx, 'src/content/blog/with-html.md').replace('Intro.', '[x](javascript:alert(1))') });
    assert.equal(bad.status, 422);
    const synced = await ed.post(`/releases/${r.id}/items`, { kind: 'library', item: { kind: 'section', name: 'Banner', synced: true, body: { value: { discriminant: 'hero', value: { heading: 'Hi' } } } } });
    assert.equal(synced.status, 422);
    assert.equal(synced.json.error, 'synced');
    const svg = await ed.post(`/releases/${r.id}/media?filename=x.svg`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    assert.equal(svg.status, 415);
    assert.equal((await ed.post(`/releases/${r.id}/items`, { kind: 'entry', collection: 'posts', id: 'bob-draft', version: 'old' })).status, 409);
    assert.equal((await ed.post(`/releases/${r.id}/publish`, { version: 'r0' })).status, 409);
    assert.equal((await ed.post(`/releases/${r.id}/publish`, { version: (await get(r.id)).version })).status, 422, 'empty');
    // cancelled: no more changes, no publish
    assert.equal((await ed.post(`/releases/${r.id}/cancel`, { version: (await get(r.id)).version })).json.status, 'cancelled');
    assert.equal((await addEntry(r.id, 'posts', 'bob-draft')).status, 409);
    const list = (await ed.get('/releases?status=published')).json.releases;
    assert.ok(list.every((x) => x.status === 'published' && x.items === undefined && x.counts.items > 0));
  });
});
