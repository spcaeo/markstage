// One topic as a journey (GET /links/map, docs/API-LINKS.md): each page's place on the way (articles, group lead,
// main page, service page, pages of other topics), every link with its words, sentence and heading, what Health says
// about a link (vague words, words for two pages, a link to no page), the links the topic expects that are missing
// (with the suggestion that adds one), the page's status, first-published and last-changed dates, and form messages only when the site has
// some (never a made-up zero).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, startServer, writeFile } from './helpers.mjs';

const CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '/{id}/' },
  ],
  pageTypes: { types: [{ id: 'service', label: 'Service page', collections: ['pages'] }] },
  topics: { money: ['service'] },
};
`;
const post = (title, body) => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-03-01T10:00:00.000Z'\n---\n\n${body}\n`;
const TOPIC = { title: 'Editing', pillar: 'posts/guide', money: 'pages/services', members: ['posts/notes'], groups: [{ id: 'modes', name: 'Modes', lead: 'posts/canvas', members: ['posts/shortcuts'] }] };

describe('one topic as a journey (GET /links/map)', () => {
  let fx, srv, ed;

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG);
    writeFile(fx, 'src/content/blog/guide.md', post('The editing guide', 'Everything about editing. Start with [canvas basics](/blog/canvas/).'));
    writeFile(fx, 'src/content/blog/canvas.md', post('Canvas basics', 'The canvas shows the page. Read the [editing guide](/blog/guide/) first.').replace('\n---\n\n', "\nmodified: '2026-09-15T08:00:00.000Z'\n---\n\n"));
    writeFile(fx, 'src/content/blog/shortcuts.md', post('Keyboard shortcuts', '## Habits\n\nShortcuts save time. [Click here](/blog/guide/) for the guide. See [old notes](/old-notes/) too.'));
    writeFile(fx, 'src/content/blog/notes.md', post('Field notes', 'These notes cover [canvas basics](/blog/guide/) as well.'));
    writeFile(fx, 'src/content/blog/elsewhere.md', post('Elsewhere', 'Another topic reads the [editing guide](/blog/guide/) too.'));
    writeFile(fx, 'src/content/pages/services.json', `${JSON.stringify({ title: 'Editing services', pageType: 'service', sections: [] }, null, 2)}\n`);
    fs.mkdirSync(path.join(fx.site, 'markstage/topics'), { recursive: true });
    writeFile(fx, 'markstage/topics/editing.json', `${JSON.stringify(TOPIC, null, 2)}\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A topic');
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('each page’s place, its status and last change; plain mistakes', async () => {
    assert.equal((await ed.get('/links/map')).status, 400);
    assert.equal((await ed.get('/links/map?topic=nope')).status, 404);
    const r = await ed.get('/links/map?topic=editing');
    assert.equal(r.status, 200, r.text);
    const place = Object.fromEntries(r.json.pages.map((p) => [p.ref, p.place]));
    assert.deepEqual(place, { 'posts/notes': 'member', 'posts/shortcuts': 'member', 'posts/canvas': 'lead', 'posts/guide': 'pillar', 'pages/services': 'money', 'posts/elsewhere': 'outside' });
    assert.deepEqual(r.json.topic, { id: 'editing', title: 'Editing', pillar: 'posts/guide', money: 'pages/services', moneyGuessed: false, groups: [{ id: 'modes', name: 'Modes', lead: 'posts/canvas' }] });
    const guide = r.json.pages.find((p) => p.ref === 'posts/guide');
    assert.equal(guide.status, 'published');
    assert.equal(guide.updated, '2026-03-01T10:00:00.000Z');
    assert.equal(guide.in, 4);
    // when each first went out and last changed, as the entry says; none made up where the entry has none
    assert.deepEqual([guide.published, guide.modified], ['2026-03-01T10:00:00.000Z', null]);
    const canvas = r.json.pages.find((p) => p.ref === 'posts/canvas');
    assert.deepEqual([canvas.published, canvas.modified, canvas.updated], ['2026-03-01T10:00:00.000Z', '2026-09-15T08:00:00.000Z', '2026-09-15T08:00:00.000Z']);
    const services = r.json.pages.find((p) => p.ref === 'pages/services');
    assert.deepEqual([services.published, services.modified, services.updated], [null, null, null]);
    // nobody links to the notes or the shortcuts; the shortcuts page does not link up to its group lead
    assert.deepEqual(r.json.pages.find((p) => p.ref === 'posts/notes').problems, ['no-links-in']);
    assert.deepEqual(r.json.pages.find((p) => p.ref === 'posts/shortcuts').problems.sort(), ['no-lead-link', 'no-links-in']);
    // Markstage keeps no visit counts, and this site has no form messages: neither is a number
    assert.deepEqual(r.json.numbers, { visits: false, leads: false });
    assert.equal('leads' in guide, false);
  });

  test('every link with its words, sentence and heading, and what Health says about it', async () => {
    const r = await ed.get('/links/map?topic=editing');
    const edge = (from, to) => r.json.edges.filter((e) => e.from === from && e.to === to);
    const click = edge('posts/shortcuts', 'posts/guide')[0];
    assert.equal(click.anchor, 'Click here');
    assert.equal(click.sentence, 'Click here for the guide.');
    assert.equal(click.at, 0);
    assert.equal(click.section, 'Habits');
    assert.equal(click.status, 'ok');
    assert.equal(click.open, '#/e/posts/shortcuts?b=1&find=Click+here');
    assert.deepEqual(click.warn.map((w) => w.kind), ['generic-anchor']);
    assert.match(click.id, /^le_[0-9a-z]+$/);
    assert.match(click.pair, /^lp_[0-9a-z]+$/);
    // a link to no page of the site: kept, with its address
    const broken = edge('posts/shortcuts', null)[0];
    assert.equal(broken.status, 'missing');
    assert.equal(broken.address, '/old-notes/');
    assert.deepEqual(broken.warn.map((w) => w.kind), ['to-missing']);
    // the same words for two pages: both links say so
    assert.ok(edge('posts/notes', 'posts/guide')[0].warn.some((w) => w.kind === 'anchor-clash'));
    assert.ok(edge('posts/guide', 'posts/canvas')[0].warn.some((w) => w.kind === 'anchor-clash'));
    // a page of another topic that links in is on the map, its link too
    assert.equal(edge('posts/elsewhere', 'posts/guide').length, 1);
    // every link of one page to another shares its pair
    assert.equal(new Set(r.json.edges.filter((e) => e.from === 'posts/shortcuts' && e.to === 'posts/guide').map((e) => e.pair)).size, 1);
  });

  test('the links the topic expects that are missing, each with its suggestion or none', async () => {
    const r = await ed.get('/links/map?topic=editing');
    const got = r.json.missing.map((m) => `${m.kind} ${m.from} > ${m.to}`).sort();
    assert.deepEqual(got, ['no-lead-link posts/shortcuts > posts/canvas', 'no-money-link posts/canvas > pages/services', 'no-money-link posts/guide > pages/services']);
    const up = r.json.missing.find((m) => m.kind === 'no-lead-link');
    // the same id as Health's finding, so a link to one opens the other
    const h = await ed.get('/links/health?topic=editing&kind=no-lead-link');
    assert.equal(up.id, h.json.items[0].id);
    assert.match(up.message, /lead page of “Modes”, “Canvas basics”/);
    // no sentence on the page names the canvas yet: the suggestion asks for one to be written
    assert.equal(up.suggestion.how, 'add');
    assert.equal(up.suggestion.dir, 'out');
    assert.equal(up.open, '#/e/posts/shortcuts');
    // skipped, the suggestion is gone but the missing link stays
    assert.equal((await ed.post('/links/skip', { id: up.suggestion.id, from: up.from, to: up.to, anchor: up.suggestion.anchor })).status, 200);
    const again = (await ed.get('/links/map?topic=editing')).json.missing.find((m) => m.kind === 'no-lead-link');
    assert.equal(again.suggestion, null);
    assert.equal((await ed.del(`/links/skips/${up.suggestion.id}`)).status, 200);
  });

  test('form messages by the page their visit began on, once the site has any (spam left out)', async () => {
    const add = srv.app.db.prepare("INSERT INTO form_messages (id, form, at, status, fields, meta, spam) VALUES (?, 'contact', '2026-10-01T10:00:00.000Z', ?, '{}', ?, ?)");
    add.run('m1', 'new', JSON.stringify({ landing: 'https://example.com/blog/shortcuts/?utm_source=x', page: 'https://example.com/contact/' }), null);
    add.run('m2', 'read', JSON.stringify({ page: '/blog/shortcuts/' }), null);
    add.run('m3', 'spam', JSON.stringify({ landing: '/blog/guide/' }), 'honeypot');
    const r = await ed.get('/links/map?topic=editing');
    assert.deepEqual(r.json.numbers, { visits: false, leads: true });
    const leads = Object.fromEntries(r.json.pages.map((p) => [p.ref, p.leads]));
    assert.equal(leads['posts/shortcuts'], 2);
    assert.equal(leads['posts/guide'], 0);
  });

  test('a site without topics answers 404 no-topics', async () => {
    const plain = makeFixture({ checks: false });
    const s = await startServer(plain, { core: await loadCore() });
    try {
      const r = await (await as(s, 'editor')).get('/links/map?topic=editing');
      assert.equal(r.status, 404);
      assert.equal(r.json.error, 'no-topics');
    } finally {
      await s.close();
    }
  });
});
