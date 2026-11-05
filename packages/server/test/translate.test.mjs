// Translate the site with AI (docs/API-TRANSLATIONS.md "AI drafts of a whole site") with the stub provider: no
// network and no key from this machine. The plan writes nothing and asks nothing; the run keeps each draft beside the
// site (markstage/translations/<code>.json), committed in batches by the person who ran it, never in an entry; a
// second run skips what waits for review; a saved translation retires its draft; the limits pace it (a fake sleep
// moves the test's clock); pause, resume and cancel; rights, tokens, AI off; the command line. Test people are made
// up here, with generated passwords.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, client, makeFixture, readFile, startServer, writeFile } from './helpers.mjs';
import { mcpToken } from './mcp-support.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { translateCommand } from '../src/translate/cli.mjs';

const SITE = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  locales: [
    { code: 'en-CA', prefix: '', label: 'Canada' },
    { code: 'fr-CA', prefix: '/fr', label: 'Français', overrides: ['title', 'description'] },
    { code: 'de', prefix: '/de', label: 'Deutsch', overrides: ['title', 'description'] },
  ],
};
`;
const POST = (title, excerpt, fr = null) => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-01-02T10:00:00.000Z'\n${excerpt ? `excerpt: ${excerpt}\n` : ''}${fr ? `locales:\n  fr-CA:\n    title: ${fr}\n` : ''}---\n\nText.\n`;
const FILE = 'markstage/translations/fr-CA.json';
const drafts = (fx) => (fs.existsSync(path.join(fx.site, FILE)) ? JSON.parse(readFile(fx, FILE)).drafts : {});

/** A fixture site with two regions of their own words, an entry translated already and one the stub fails on. */
function localeFixture() {
  const fx = makeFixture({ checks: false });
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE);
  writeFile(fx, 'src/content/blog/harbour.md', POST('The harbour', 'Boats and gulls.', 'Le port'));
  writeFile(fx, 'src/content/blog/broken.md', POST('STUB-FAIL here', null));
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Locales');
  return fx;
}

describe('translate the site: plan, run, report', () => {
  let fx, srv, ed, au;
  const audits = (action) => srv.app.db.prepare('SELECT * FROM audit WHERE action = ? ORDER BY id').all(action);
  const done = async (rid) => {
    await srv.app.translate.idle();
    return (await ed.get(`/translate/${rid}`)).json;
  };

  before(async () => {
    fx = localeFixture();
    srv = await startServer(fx, { overrides: { collections: [], ai: { provider: 'stub', perMinute: 600, perDay: 100_000 } }, core: await loadCore() });
    ed = await as(srv, 'editor', { authorSlug: 'eve' });
    au = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv?.close());

  test('GET /translate: the regions with their own words, the collections that can be included, AI on', async () => {
    const r = await ed.get('/translate');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.locales.map((l) => l.code), ['fr-CA', 'de']);
    assert.deepEqual(r.json.collections.map((c) => [c.id, c.offered]), [['posts', true], ['pages', false]]);
    assert.match(r.json.collections[1].why, /not edited in the text editor/);
    assert.equal(r.json.ai.on, true);
    assert.deepEqual(r.json.runs, []);
  });

  test('the plan is a dry run: counts, skips with reasons, the estimate; nothing written, nothing asked', async () => {
    const head = fx.git('rev-parse', 'HEAD').trim();
    const r = await ed.post('/translate', { locale: 'fr-CA' });
    assert.equal(r.status, 201, r.text);
    const p = r.json.plan;
    assert.equal(r.json.run.status, 'planned');
    assert.match(r.json.run.id, /^tr_/);
    const byId = Object.fromEntries(p.items.map((i) => [i.id, i]));
    // the harbour has its French title; its description (the excerpt) is still missing, so it is drafted for that
    assert.deepEqual(byId.harbour.fields, ['description']);
    assert.deepEqual(byId['hello-world'].fields, ['title', 'description']);
    assert.deepEqual(byId['bob-draft'].fields, ['title']);
    assert.equal(p.counts.entries, 6);
    assert.equal(p.counts.draft, 6);
    assert.ok(p.counts.chars > 30 && p.counts.tokens.input > p.counts.draft * 100, JSON.stringify(p.counts));
    assert.match(p.time.words, /6 asks of the AI, at most 600 asks a minute: about a minute/);
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
    assert.equal(fx.git('status', '--porcelain').trim(), '');
    assert.equal(audits('ai.suggest').length, 0);
    assert.equal(audits('translate.plan').length, 1);
    // the choices are checked
    assert.deepEqual([(await ed.post('/translate', { locale: 'en-CA' })).status, (await ed.post('/translate', { locale: 'en-CA' })).json.error], [422, 'locale']);
    const bad = await ed.post('/translate', { locale: 'fr-CA', collections: ['pages'] });
    assert.deepEqual([bad.status, bad.json.field], [422, 'collections']);
    assert.equal((await ed.post('/translate', { locale: 'fr-CA', skipExisting: 'no' })).json.field, 'skipExisting');
  });

  test('the run: drafts beside the site in one commit by the runner, entries untouched, a failure in plain words', async () => {
    const files = Object.fromEntries(fs.readdirSync(path.join(fx.site, 'src/content/blog')).map((f) => [f, readFile(fx, `src/content/blog/${f}`)]));
    const made = (await ed.post('/translate', { locale: 'fr-CA' })).json;
    const r = await ed.post(`/translate/${made.run.id}/run`, {});
    assert.equal(r.status, 202, r.text);
    const out = await done(made.run.id);
    assert.equal(out.run.status, 'done');
    assert.deepEqual([out.run.progress.created, out.run.progress.skipped, out.run.progress.failed], [5, 0, 1]);
    const broken = out.result.items.find((i) => i.id === 'broken');
    assert.deepEqual([broken.action, broken.why], ['failed', 'The AI provider answered with an error (500). Try again in a moment.']);
    assert.ok(out.result.items.filter((i) => i.action === 'created').every((i) => i.open));
    // no entry changed: nothing goes live, and nobody's words were replaced
    for (const [f, text] of Object.entries(files)) assert.equal(readFile(fx, `src/content/blog/${f}`), text, f);
    const d = drafts(fx);
    assert.deepEqual(Object.keys(d).sort(), ['posts/bob-draft', 'posts/carol-draft', 'posts/harbour', 'posts/hello-world', 'posts/with-html']);
    assert.deepEqual(d['posts/hello-world'].fields, { title: 'Hello World (stub)', description: 'The first post. (stub)' });
    assert.deepEqual(d['posts/harbour'], { ...d['posts/harbour'], fields: { description: 'Boats and gulls. (stub)' }, before: { description: '' }, source: { description: 'Boats and gulls.' } });
    assert.equal(fx.git('log', '-1', '--format=%an|%s').trim(), `${ed.user.email.split('@')[0]}|Draft 5 Français translations with AI`);
    assert.equal(out.result.commits.length, 1);
    // each ask is audited as the other AI kinds are; the run too
    const asks = audits('ai.suggest');
    assert.equal(asks.length, 6);
    assert.ok(asks.every((a) => JSON.parse(a.detail).kind === 'translate' && a.user_id === ed.user.id));
    assert.deepEqual(JSON.parse(audits('translate.run')[0].detail), { locale: 'fr-CA', status: 'done', created: 5, skipped: 0, failed: 1, commits: 1 });
  });

  test('a second run skips what waits for review, and writes nothing', async () => {
    const head = fx.git('rev-parse', 'HEAD').trim();
    const p = (await ed.post('/translate', { locale: 'fr-CA' })).json.plan;
    assert.deepEqual(p.counts.skipped, { waiting: 5 });
    assert.deepEqual(p.items.filter((i) => i.action === 'draft').map((i) => i.id), ['broken']);
    const rid = (await ed.post('/translate', { locale: 'fr-CA', collections: ['posts'] })).json.run.id;
    await ed.post(`/translate/${rid}/run`, {});
    const out = await done(rid);
    assert.deepEqual([out.run.status, out.run.progress.created, out.run.progress.skipped, out.run.progress.failed], ['done', 0, 5, 1]);
    // the report carries the plan's skips, each with its reason: every entry the plan considered is accounted for
    const planned = (await ed.get(`/translate/${rid}`)).json.plan;
    const skipped = out.result.items.filter((i) => i.action === 'skipped');
    assert.deepEqual(skipped.map((i) => [i.id, i.reason, i.why]), planned.items.filter((i) => i.action === 'skip').map((i) => [i.id, 'waiting', 'An AI draft is already waiting for review.']));
    assert.equal(out.run.progress.created + out.run.progress.skipped + out.run.progress.failed, planned.counts.entries);
    assert.deepEqual([out.run.progress.done, out.run.progress.total], [6, 6]);
    assert.equal(fx.git('rev-parse', 'HEAD').trim(), head);
  });

  test('the drafts of an entry; a saved translation retires its draft; Discard removes one', async () => {
    const g = await ed.get('/translate/drafts/posts/hello-world');
    assert.equal(g.status, 200, g.text);
    assert.deepEqual(g.json.drafts.map((x) => [x.locale, x.fields.title, x.by]), [['fr-CA', 'Hello World (stub)', ed.user.email.split('@')[0]]]);
    // accepted in Post settings: the entry's own save, with other words for the title; the description stays open
    const e = (await ed.get('/collections/posts/entries/hello-world')).json;
    const s = await ed.put('/collections/posts/entries/hello-world', { version: e.version, frontmatter: { locales: { 'fr-CA': { title: 'Bonjour le monde' } } } });
    assert.equal(s.status, 200, s.text);
    assert.deepEqual((await ed.get('/translate/drafts/posts/hello-world')).json.drafts[0].fields, { description: 'The first post. (stub)' });
    // Discard: one commit, and gone
    const del = await ed.del('/translate/drafts/posts/hello-world/fr-CA');
    assert.equal(del.status, 200, del.text);
    assert.match(fx.git('log', '-1', '--format=%s').trim(), /^Discard the AI draft of posts\/hello-world in fr-CA$/);
    assert.deepEqual((await ed.get('/translate/drafts/posts/hello-world')).json.drafts, []);
    assert.equal((await ed.del('/translate/drafts/posts/hello-world/fr-CA')).status, 404);
    assert.ok(!('posts/hello-world' in drafts(fx)));
    assert.equal(audits('translate.discard').length, 1);
    // an author may read a live entry's drafts, but not discard another author's region words
    assert.equal((await au.get('/translate/drafts/posts/with-html')).status, 200);
    assert.equal((await au.get('/translate/drafts/posts/bob-draft')).status, 404);
  });

  test('“include translated” drafts beside a translation, never over it', async () => {
    const p = (await ed.post('/translate', { locale: 'de', skipExisting: false })).json;
    assert.equal(p.plan.counts.draft, 6);
    const before = readFile(fx, 'src/content/blog/hello-world.md');
    const p2 = (await ed.post('/translate', { locale: 'fr-CA', skipExisting: false })).json.plan;
    // the harbour's French title is there and its description waits for review: skipped; hello-world's title has words
    const hello = p2.items.find((i) => i.id === 'hello-world');
    assert.deepEqual([hello.action, hello.fields], ['draft', ['title', 'description']]);
    const rid = (await ed.post('/translate', { locale: 'fr-CA', skipExisting: false, collections: ['posts'] })).json.run.id;
    await ed.post(`/translate/${rid}/run`, {});
    await done(rid);
    assert.equal(readFile(fx, 'src/content/blog/hello-world.md'), before);
    assert.deepEqual(drafts(fx)['posts/hello-world'].before, { title: 'Bonjour le monde', description: '' });
  });

  test('rights: editors and up; an author, a token and an agent are refused', async () => {
    assert.equal((await au.get('/translate')).status, 403);
    assert.equal((await au.post('/translate', { locale: 'fr-CA' })).status, 403);
    for (const scopes of [['mcp:draft'], ['env:read']]) {
      const secret = await mcpToken(ed, scopes);
      for (const [method, p] of [['GET', '/translate'], ['POST', '/translate']]) {
        const r = await fetch(`${srv.base}/markstage/api${p}`, { method, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ locale: 'fr-CA' }) : undefined });
        assert.equal(r.status, 403, `${scopes} ${p}`);
      }
    }
    // a run is its person's: another editor may look, not run it
    const other = await as(srv, 'editor');
    const rid = (await ed.post('/translate', { locale: 'de' })).json.run.id;
    assert.equal((await other.get(`/translate/${rid}`)).status, 200);
    assert.equal((await other.post(`/translate/${rid}/run`, {})).status, 403);
    assert.equal((await au.get(`/translate/${rid}`)).status, 403);
  });
});

describe('translate the site: a translator’s role, AI off, the limits, pause and cancel, a restart, the command line', () => {
  let fx, srv, clock, owner, admin, ed;
  const gates = [];
  let keep;
  // a wait that ends when the test says so, or one that moves the clock and ends at once
  let mode = 'clock';
  const sleep = (ms) => (mode === 'clock' ? ((clock.now += ms), Promise.resolve()) : new Promise((r) => gates.push(r)));
  // a day on: the sessions have ended, so everyone signs in again
  const nextDay = async () => {
    clock.now += 24 * 3600 * 1000;
    for (const who of [owner, admin, ed]) await who.login(who.user.email, who.user.password);
  };
  const state = async (who, rid) => (await who.get(`/translate/${rid}`)).json.run;
  const until = async (who, rid, test) => {
    for (let i = 0; i < 200; i++) {
      const r = await state(who, rid);
      if (test(r)) return r;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out');
  };

  before(async () => {
    fx = localeFixture();
    clock = { now: Date.parse('2026-11-05T09:00:00.000Z') };
    srv = await startServer(fx, { overrides: { collections: [], ai: { provider: 'stub', perMinute: 2, perDay: 5 } }, core: await loadCore(), clock, translate: { sleep } });
    owner = await as(srv, 'owner');
    admin = await as(srv, 'administrator');
    ed = await as(srv, 'editor', { authorSlug: 'eve' });
    // a never-answering wait holds the event loop open until the test ends it
    keep = setInterval(() => {}, 1000);
  });
  after(async () => {
    clearInterval(keep);
    for (const g of gates.splice(0)) g();
    await srv?.close();
  });

  test('a translator whose role writes French: French only, and only the entries the role covers', async () => {
    const role = { id: 'translator-fr', name: 'French translator', base: 'contributor', rules: [{ id: 'fr', name: 'Edits the French words of posts', action: ['entry.edit'], collections: ['posts'], fields: ['locales.fr-CA.**'], effect: 'allow' }] };
    assert.equal((await admin.post('/roles', role)).status, 201);
    const tr = await as(srv, 'contributor', { authorSlug: 'tara' });
    assert.equal((await admin.patch(`/users/${tr.user.id}`, { customRole: 'translator-fr' })).status, 200);
    const de = await tr.post('/translate', { locale: 'de' });
    assert.deepEqual([de.status, de.json.message], [403, 'Your role cannot write Deutsch’s words, so it cannot translate the site into it.']);
    const fr = await tr.post('/translate', { locale: 'fr-CA' });
    assert.equal(fr.status, 201, fr.text);
    assert.equal(fr.json.plan.counts.draft, 6);
  });

  test('AI off: said in the same words as every AI button, and a plan is refused', async () => {
    const orig = srv.app.ai.provider.status;
    srv.app.ai.provider.status = () => ({ ...orig(), on: false, why: 'AI suggestions are off: MARKSTAGE_AI_KEY is not set on the server and there is no ai.keyFile.', reason: 'key' });
    try {
      const g = (await ed.get('/translate')).json;
      assert.deepEqual([g.ai.on, g.ai.why], [false, 'AI suggestions are off: MARKSTAGE_AI_KEY is not set on the server and there is no ai.keyFile.']);
      const r = await ed.post('/translate', { locale: 'fr-CA' });
      assert.deepEqual([r.status, r.json.error], [503, 'ai-off']);
    } finally {
      srv.app.ai.provider.status = orig;
    }
  });

  test('the limits: the plan says how long; the run waits for the minute, pauses for the day, resumes after it', async () => {
    const made = (await ed.post('/translate', { locale: 'fr-CA', collections: ['posts'] })).json;
    assert.match(made.plan.time.words, /at most 2 asks a minute: about 3 minutes today\. You have 5 asks left today/);
    await ed.post(`/translate/${made.run.id}/run`, {});
    await srv.app.translate.idle();
    let run = await state(ed, made.run.id);
    // five asks in the day, waiting a minute after every two: then it pauses, saying when to resume
    assert.deepEqual([run.status, run.progress.done], ['paused', 5]);
    assert.match(run.reason, /^You have used your 5 AI asks for today\. Resume it after 2026-11-0[56] \d\d:\d\d UTC\.$/);
    await nextDay();
    assert.equal((await ed.post(`/translate/${made.run.id}/resume`, {})).status, 202);
    await srv.app.translate.idle();
    run = await state(ed, made.run.id);
    assert.deepEqual([run.status, run.progress.done, run.progress.created, run.progress.failed], ['done', 6, 5, 1]);
    assert.equal(srv.app.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'ai.limited'").get().n, 0, 'paced: never refused');
  });

  test('pause and cancel act between asks; what was drafted stays; one run at a time', async () => {
    await nextDay();
    mode = 'gate';
    const rid = (await ed.post('/translate', { locale: 'de' })).json.run.id;
    await ed.post(`/translate/${rid}/run`, {});
    // two asks, then it waits for the minute (a wait the test holds)
    let run = await until(ed, rid, (r) => r.progress.waiting);
    assert.match(run.progress.waiting.why, /^At most 2 asks a minute: waiting \d+ seconds\.$/);
    const other = (await ed.post('/translate', { locale: 'fr-CA' })).json.run.id;
    const busy = await ed.post(`/translate/${other}/run`, {});
    assert.deepEqual([busy.status, busy.json.error], [409, 'busy']);
    run = (await ed.post(`/translate/${rid}/pause`, {})).json.run;
    // bob-draft drafted, broken failed (the entries go in order of their ids)
    assert.deepEqual([run.status, run.progress.done, run.progress.created], ['paused', 2, 1]);
    assert.deepEqual(Object.keys(JSON.parse(readFile(fx, 'markstage/translations/de.json')).drafts), ['posts/bob-draft']);
    await ed.post(`/translate/${rid}/resume`, {});
    await until(ed, rid, (r) => r.progress.waiting);
    // an administrator may cancel another's run
    run = (await admin.post(`/translate/${rid}/cancel`, {})).json.run;
    assert.deepEqual([run.status, run.reason], ['cancelled', 'Cancelled. The drafts made before are kept for review.']);
    assert.deepEqual(Object.keys(JSON.parse(readFile(fx, 'markstage/translations/de.json')).drafts), ['posts/bob-draft']);
    assert.equal((await ed.post(`/translate/${rid}/resume`, {})).status, 409);
    mode = 'clock';
  });

  test('the command line: the plan with --dry, then the run, as the person named by --as', async () => {
    await nextDay();
    const lines = [];
    const out = (l) => lines.push(l);
    const owner2 = srv.app.db.prepare('SELECT email FROM users WHERE id = ?').get(owner.user.id).email;
    assert.equal(await translateCommand(srv.app, ['--to', 'de', '--dry', '--as', owner2], { out }), 0);
    assert.equal(lines[0], '5 entries to draft in Deutsch, 1 skipped (of 6).');
    assert.ok(lines.includes('Skipped, 1: An AI draft is already waiting for review.'), lines.join('\n'));
    assert.match(lines.at(-1), /^Dry run, nothing written\. To see it in the editor: #\/translate\/tr_/);
    lines.length = 0;
    assert.equal(await translateCommand(srv.app, ['--to', 'de', '--only', 'posts', '--as', owner2], { out }), 0);
    assert.ok(lines.includes('Done in 1 commit: 4 drafted, 1 skipped, 1 failed.'), lines.join('\n'));
    assert.ok(lines.includes('  Skipped: posts/bob-draft: An AI draft is already waiting for review.'), lines.join('\n'));
    assert.ok(lines.some((l) => /^ {2}Failed: posts\/broken: The AI provider answered with an error/.test(l)));
    await assert.rejects(translateCommand(srv.app, ['--to', 'xx', '--as', owner2], { out }), /Choose one of this site's regions/);
    await assert.rejects(translateCommand(srv.app, ['--to', 'de'], { out }), /--as/);
  });

  test('a restart pauses a run that was going; Resume carries on', async () => {
    await nextDay();
    for (const id of ['north', 'south', 'west']) writeFile(fx, `src/content/blog/${id}.md`, POST(`The ${id}`, `Going ${id}.`));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Three more');
    mode = 'gate';
    const rid = (await owner.post('/translate', { locale: 'fr-CA' })).json.run.id;
    await owner.post(`/translate/${rid}/run`, {});
    await until(owner, rid, (r) => r.progress.waiting);
    await srv.close();
    mode = 'clock';
    srv = await startServer(fx, { overrides: { collections: [], ai: { provider: 'stub', perMinute: 2, perDay: 5 } }, core: await loadCore(), clock, translate: { sleep } });
    const again = await as(srv, 'editor');
    const row = srv.app.db.prepare('SELECT status, reason FROM translate_runs WHERE id = ?').get(rid);
    assert.equal(row.status, 'paused');
    assert.ok(row.reason);
    assert.equal((await again.get(`/translate/${rid}`)).json.run.status, 'paused');
    // only its person resumes it, after signing in to the new server
    assert.equal((await again.post(`/translate/${rid}/resume`, {})).status, 403);
    const o = client(srv.base);
    await o.login(owner.user.email, owner.user.password);
    assert.equal((await o.post(`/translate/${rid}/resume`, {})).status, 202);
    await srv.app.translate.idle();
    const run = (await o.get(`/translate/${rid}`)).json.run;
    // the five the plan skipped (drafts waiting from before) are in the report too: 3 + 5 + 1 = the 9 entries
    assert.deepEqual([run.status, run.progress.done, run.progress.total, run.progress.created, run.progress.skipped, run.progress.failed], ['done', 9, 9, 3, 5, 1]);
  });
});
