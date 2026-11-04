// The import API (docs/API-IMPORT.md): a plan first (nothing written), then its run as a job; entries through the
// editor's own create and save (drafts, the guard, locks, the site's validate), media through the SSRF guard and the
// upload's pipeline; idempotent on the source's ids, and never over a person's change unless asked. Against a small
// site on loopback, reached through the test seam only. Test people are made up here, with generated passwords.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, makePng, readFile, startServer, writeFile } from './helpers.mjs';
import { startWebSite } from './web-site.mjs';

describe('the import API', () => {
  let fx, srv, site, ed;
  const head = () => fx.git('rev-parse', 'HEAD').trim();
  const run = async (who, body) => {
    const p = await who.post('/import', body);
    assert.equal(p.status, 201, p.text);
    const r = await who.post(`/import/${p.json.run.id}/run`, {});
    assert.equal(r.status, 202, r.text);
    await srv.app.jobs.idle();
    return { plan: p.json, done: (await who.get(`/import/${p.json.run.id}`)).json };
  };
  let payload;

  before(async () => {
    site = await startWebSite({ '/a.png': { type: 'image/png', body: makePng() }, '/b.png': { type: 'image/png', body: makePng() }, '/notes.txt': { type: 'text/plain', body: 'hi' } });
    fx = makeFixture({ checks: false });
    srv = await startServer(fx, { core: await loadCore(), outbound: site.outbound });
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    payload = {
      source: 'oldcms',
      media: [{ sourceId: 'img-1', url: `${site.base}/a.png`, alt: 'A truck' }],
      entries: [
        { sourceId: 'p-1', collection: 'posts', title: 'Moving day', frontmatter: { author: 'alice', tags: ['news'], image: `${site.base}/a.png` }, body: '# Moving day\n\nWe moved. ![Truck](media:img-1)\n' },
        { sourceId: 'p-2', collection: 'posts', id: 'second-post', title: 'Second', frontmatter: { author: 'alice' }, body: 'Two.\n' },
        { sourceId: 'pg-1', collection: 'pages', title: 'Old about', data: { uri: '/old-about/', sections: [] } },
      ],
    };
  });
  after(async () => {
    await srv?.close();
    await site?.close();
  });

  test('the plan writes nothing and fetches nothing, and says what each item would do', async () => {
    const h = head();
    const hits = site.hits.length;
    const p = await ed.post('/import', payload);
    assert.equal(p.status, 201, p.text);
    assert.deepEqual(p.json.entries.map((e) => [e.sourceId, e.action, e.id]), [['p-1', 'create', 'moving-day'], ['p-2', 'create', 'second-post'], ['pg-1', 'create', 'old-about']]);
    assert.deepEqual(p.json.media.map((m) => m.action), ['fetch']);
    assert.match(p.json.media[0].path, /^src\/assets\/uploads\/\d{4}\/\d\d\/a\.png$/);
    assert.equal(p.json.run.status, 'planned');
    assert.equal(head(), h);
    assert.equal(site.hits.length, hits);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
  });

  test('the run: media in one commit, then each entry as a draft through the editor’s create; links to media follow', async () => {
    const h = head();
    const { done } = await run(ed, payload);
    assert.equal(done.run.status, 'done');
    assert.deepEqual(done.result.counts, { create: 3 });
    const stored = done.result.media[0].path;
    const text = readFile(fx, 'src/content/blog/moving-day.md');
    assert.match(text, /^draft: true$/m);
    assert.ok(text.includes(`![Truck](/uploads/${stored.replace('src/assets/uploads/', '')})`), text);
    assert.ok(text.includes(`image: /uploads/${stored.replace('src/assets/uploads/', '')}`), text);
    assert.doesNotMatch(text, /127\.0\.0\.1/);
    assert.equal(JSON.parse(readFile(fx, 'src/content/pages/old-about.json')).title, 'Old about');
    // one commit for the media, one per entry, each by the person
    const subjects = fx.git('log', '--format=%s|%an', `${h}..HEAD`).trim().split('\n').reverse();
    assert.deepEqual(subjects.map((s) => s.split('|')[0]), ['Import 1 media file from oldcms', 'Create posts/moving-day', 'Create posts/second-post', 'Create pages/old-about']);
    assert.ok(subjects.every((s) => s.endsWith(`|${ed.user.email.split('@')[0]}`)));
    const audit = srv.app.db.prepare("SELECT action FROM audit WHERE action LIKE 'import.%' OR action = 'entry.import' ORDER BY id").all().map((r) => r.action);
    assert.deepEqual(audit, ['import.plan', 'import.plan', 'entry.import', 'entry.import', 'entry.import', 'import.run']);
  });

  test('again with the same payload: nothing changes, nothing is fetched', async () => {
    const h = head();
    const hits = site.hits.length;
    const { plan, done } = await run(ed, payload);
    assert.deepEqual(plan.entries.map((e) => e.action), ['unchanged', 'unchanged', 'unchanged']);
    assert.deepEqual(plan.media.map((m) => m.action), ['reuse']);
    assert.deepEqual(done.result.counts, { unchanged: 3 });
    assert.equal(head(), h);
    assert.equal(site.hits.length, hits);
  });

  test('a changed source updates what it made, keeping the draft status; a person’s change is never overwritten unless asked', async () => {
    const next = structuredClone(payload);
    next.entries[1].body = 'Two, longer now.\n';
    const { done } = await run(ed, next);
    assert.deepEqual(done.result.entries.map((e) => e.action), ['unchanged', 'update', 'unchanged']);
    const second = readFile(fx, 'src/content/blog/second-post.md');
    assert.match(second, /Two, longer now\./);
    assert.match(second, /^draft: true$/m);

    // a person edits it in Markstage
    writeFile(fx, 'src/content/blog/second-post.md', second.replace('longer now', 'edited by a person'));
    fx.git('commit', '-qam', 'A person edits');
    next.entries[1].body = 'Two, from the source again.\n';
    const p = (await ed.post('/import', next)).json;
    assert.equal(p.entries[1].action, 'skip');
    assert.match(p.entries[1].problem, /changed in Markstage since it was imported/);
    const forced = await run(ed, { ...next, overwrite: true });
    assert.equal(forced.done.result.entries[1].action, 'update');
    assert.match(readFile(fx, 'src/content/blog/second-post.md'), /from the source again/);
  });

  test('problems are per item, said in words; the rest goes on', async () => {
    const p = (
      await ed.post('/import', {
        source: 'oldcms',
        media: [{ sourceId: 'bad', url: 'http://169.254.169.254/latest.png' }, { sourceId: 'txt', url: `${site.base}/notes.txt` }],
        entries: [
          { sourceId: 'x-1', collection: 'nope', title: 'X' },
          { sourceId: 'x-2', collection: 'posts', body: 'no title' },
          { sourceId: 'x-3', collection: 'posts', title: 'Live?', frontmatter: { draft: false } },
          { sourceId: 'x-4', collection: 'posts', id: 'hello-world', title: 'Taken' },
          { sourceId: 'x-5', collection: 'posts', title: 'Bad link', frontmatter: { author: 'alice' }, body: '[x](javascript:alert(1))\n' },
          { sourceId: 'x-6', collection: 'posts', title: 'Needs a file', frontmatter: { author: 'alice' }, body: '![a](media:nowhere)\n' },
          { sourceId: 'x-7', collection: 'posts', title: 'Fine', frontmatter: { author: 'alice' }, body: 'Ok.\n' },
          { sourceId: 'x-8', collection: 'posts', title: 'No alt', frontmatter: { author: 'alice' }, body: '![](https://example.com/x.png)\n' },
        ],
      })
    ).json;
    assert.deepEqual(p.media.map((m) => m.action), ['skip', 'fetch']);
    assert.match(p.media[0].problem, /public|private|not allowed|refused/i);
    const by = Object.fromEntries(p.entries.map((e) => [e.sourceId, e]));
    assert.match(by['x-1'].problem, /No collection "nope"/);
    assert.match(by['x-2'].problem, /needs a title/);
    assert.match(by['x-3'].problem, /an import brings drafts/);
    assert.match(by['x-4'].problem, /already has the address posts\/hello-world/);
    assert.match(by['x-5'].problem, /Links must start with/);
    assert.match(by['x-6'].problem, /media:nowhere/);
    assert.equal(by['x-7'].action, 'create');
    // a draft can come in with what would stop its publish: the plan says so
    assert.equal(by['x-8'].action, 'create');
    assert.deepEqual(by['x-8'].rules.map((r) => [r.rule, r.level]), [['altText', 'block']]);
    // the text file is refused when it is fetched, in the run's result
    const r = await ed.post(`/import/${(await ed.post('/import', { source: 'oldcms', media: [{ sourceId: 'txt', url: `${site.base}/notes.txt` }] })).json.run.id}/run`, {});
    await srv.app.jobs.idle();
    const res = (await ed.get(`/import/${r.json.run.id}`)).json.result;
    assert.ok(res.media[0].problem);
  });

  test('locks are kept: an update that changes a locked block is refused in the plan and the run', async () => {
    const page = (html) => ({ source: 'locks', entries: [{ sourceId: 'lp', collection: 'pages', title: 'Locked page', data: { uri: '/locked-page/', sections: [{ discriminant: 'prose', value: { html, _lock: { edit: true } } }] } }] });
    assert.deepEqual((await run(ed, page('<p>One</p>'))).done.result.counts, { create: 1 });
    const before = readFile(fx, 'src/content/pages/locked-page.json');
    const p = (await ed.post('/import', page('<p>Two</p>'))).json;
    assert.equal(p.entries[0].action, 'skip');
    assert.match(p.entries[0].problem, /locked/i);
    assert.equal(readFile(fx, 'src/content/pages/locked-page.json'), before);
  });

  test('editors and up; a run by its maker only, once, within the hour; wrong shapes are 422 naming the field', async () => {
    const author = await as(srv, 'author', { authorSlug: 'bob' });
    assert.equal((await author.post('/import', payload)).status, 403);
    assert.equal((await author.get('/import')).status, 403);
    const p = (await ed.post('/import', payload)).json;
    const other = await as(srv, 'editor');
    assert.equal((await other.post(`/import/${p.run.id}/run`, {})).status, 403);
    assert.equal((await ed.post(`/import/${p.run.id}/run`, {})).status, 202);
    await srv.app.jobs.idle();
    assert.equal((await ed.post(`/import/${p.run.id}/run`, {})).status, 409);
    assert.equal((await ed.get('/import/im_missing')).status, 404);
    const list = (await ed.get('/import')).json.items;
    assert.ok(list.length >= 5 && list.every((r) => r.id.startsWith('im_')));
    for (const [body, field] of [
      [{ entries: [] }, 'source'],
      [{ source: 'Old CMS', entries: [] }, 'source'],
      [{ source: 'x', entries: [] }, 'entries'],
      [{ source: 'x', entries: [{ collection: 'posts' }] }, 'entries[0].sourceId'],
      [{ source: 'x', entries: [{ sourceId: 'a', collection: 'posts' }, { sourceId: 'a', collection: 'posts' }] }, 'entries[1].sourceId'],
      [{ source: 'x', media: [{ sourceId: 'm' }] }, 'media[0].url'],
      [{ source: 'x', entries: Array.from({ length: 501 }, (_, i) => ({ sourceId: `s${i}`, collection: 'posts' })) }, 'entries'],
      [{ source: 'x', entries: [{ sourceId: 'a', collection: 'posts', title: 'A' }], mediaAs: 'inline' }, 'mediaAs'],
    ]) {
      const r = await ed.post('/import', body);
      assert.deepEqual([r.status, r.json.field], [422, field], JSON.stringify(body).slice(0, 80));
    }
  });
});

describe('the import API: a plan expires', () => {
  let fx, srv, clock, ed;
  before(async () => {
    fx = makeFixture({ checks: false });
    clock = { now: Date.parse('2026-10-29T09:00:00.000Z') };
    srv = await startServer(fx, { core: await loadCore(), clock });
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
  });
  after(() => srv?.close());

  test('after an hour it must be made again', async () => {
    const p = (await ed.post('/import', { source: 'old', entries: [{ sourceId: 'a', collection: 'posts', title: 'A', frontmatter: { author: 'alice' } }] })).json;
    clock.now += 61 * 60 * 1000;
    await ed.login(ed.user.email, ed.user.password);
    const r = await ed.post(`/import/${p.run.id}/run`, {});
    assert.deepEqual([r.status, r.json.error], [410, 'expired']);
    assert.equal((await ed.get(`/import/${p.run.id}`)).json.run.status, 'expired');
  });
});
