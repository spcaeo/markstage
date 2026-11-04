// Topics and internal links on the server (docs/API-LINKS.md): topic files (add, change, a page in one topic only,
// place and drag, delete), the link map of every page's text, the Health findings and their one-click fixes,
// suggestions both ways, Accept as a normal save (one commit, Undo, the rights and the publish rules), Skip
// remembered, the inbox, a page type's `links` checks and the publish sheet's links part.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, readFile, startServer, writeFile } from './helpers.mjs';

const CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '/{id}/' },
  ],
  pageTypes: {
    types: [
      { id: 'service', label: 'Service page', collections: ['pages'] },
      { id: 'article', label: 'Article', collections: ['posts'], checks: [
        { id: 'up', label: 'Links up to its topic’s main page', links: 'pillar', level: 'block' },
        { id: 'sell', label: 'Links to the service page', links: 'money' },
      ] },
    ],
  },
  topics: { money: ['service'], follow: ['docs.example.com'] },
};
`;
const post = (title, body, extra = '') => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-03-01T10:00:00.000Z'\n${extra}---\n\n${body}\n`;
const page = (o) => `${JSON.stringify(o, null, 2)}\n`;

describe('topics and internal links on the server', () => {
  let fx, srv, ed, alice;

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG);
    writeFile(fx, 'src/content/blog/guide.md', post('The editing guide', 'Everything about editing pages. Start with [canvas basics](/blog/canvas/).'));
    writeFile(fx, 'src/content/blog/canvas.md', post('Canvas basics', 'The canvas shows the page as it will look. Read the [editing guide](/blog/guide/) first.'));
    writeFile(fx, 'src/content/blog/shortcuts.md', post('Keyboard shortcuts for editors', 'Shortcuts save time when you edit every day. See [old notes](/old-notes/) and [a blog](https://blog.example.org/x).', 'pageType: article\n'));
    writeFile(fx, 'src/content/blog/notes.md', post('Field notes', 'These notes talk about keyboard shortcuts for editors and about other habits, at some length here.'));
    writeFile(fx, 'src/content/pages/services.json', page({ title: 'Editing services', pageType: 'service', sections: [] }));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Linked pages');
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
    ed = await as(srv, 'editor');
    alice = await as(srv, 'author', { authorSlug: 'alice' });
  });
  after(() => srv.close());

  test('topics: add one, a page in one topic only, place and drag, change with its version, plain mistakes', async () => {
    assert.equal((await alice.post('/topics', { title: 'Nope' })).status, 403);
    const r = await ed.post('/topics', { title: 'Editing', pillar: 'posts/guide', groups: [{ name: 'Modes', lead: 'posts/canvas', members: [] }] });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.topic.id, 'editing');
    assert.deepEqual(JSON.parse(readFile(fx, 'markstage/topics/editing.json')).groups, [{ id: 'modes', name: 'Modes', lead: 'posts/canvas', members: [] }]);
    assert.match(fx.git('log', '-1', '--format=%s'), /Add topic Editing/);
    const noVersion = await ed.del('/topics/editing');
    assert.equal(noVersion.status, 400, 'a missing version is said plainly (QA F18)');
    assert.match(noVersion.json.message, /^Send the version you opened/);
    const long = await ed.post('/topics', { title: 'n'.repeat(101) });
    assert.equal(long.status, 422, 'a topic name is at most 100 characters (QA F4)');
    assert.equal(long.json.message, 'The topic name is at most 100 characters.');
    const bad = await ed.post('/topics', { title: 'Other', pillar: 'posts/guide' });
    assert.equal(bad.status, 422);
    assert.match(bad.json.message, /in the topic “Editing” already/);
    assert.match((await ed.post('/topics', { title: 'Ghost', pillar: 'posts/none' })).json.message, /not a page of the site/);
    // the Page box and drag: a page goes into a group; then moves to the topic's own pages
    const p = await ed.post('/topics/place', { ref: 'posts/shortcuts', topic: 'editing', group: 'modes' });
    assert.equal(p.status, 200, p.text);
    assert.deepEqual(JSON.parse(readFile(fx, 'markstage/topics/editing.json')).groups[0].members, ['posts/shortcuts']);
    assert.equal(p.json.page.topic, 'editing');
    assert.match(fx.git('log', '-1', '--format=%s'), /Put “Keyboard shortcuts for editors” in topic Editing/);
    const list = await ed.get('/topics');
    assert.equal(list.json.items[0].counts.pages, 3);
    assert.equal(list.json.pages.find((x) => x.ref === 'posts/shortcuts').group, 'modes');
    // a change needs the version it was read at
    const stale = await ed.put('/topics/editing', { version: 'old', keywords: ['editing'] });
    assert.equal(stale.status, 409);
    const ok = await ed.put('/topics/editing', { version: list.json.items[0].version, keywords: ['editing'], money: 'pages/services' });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json.topic.keywords, ['editing']);
  });

  test('the map, health and its fixes: no links in, no link up, a redirect, an outside link', async () => {
    const pages = await ed.get('/links/pages');
    const row = (ref) => pages.json.items.find((x) => x.ref === ref);
    assert.equal(row('posts/guide').in, 1);
    assert.equal(row('posts/shortcuts').in, 0);
    assert.equal(row('pages/services').money, true);
    assert.equal(row('posts/canvas').edit, '#/e/posts/canvas');
    const h = await ed.get('/links/health?topic=editing');
    const kinds = h.json.items.map((f) => `${f.kind} ${f.ref}`);
    assert.ok(kinds.includes('no-links-in posts/shortcuts'), kinds.join('\n'));
    assert.ok(kinds.includes('no-pillar-link posts/shortcuts'));
    const missing = h.json.items.find((f) => f.kind === 'to-missing');
    assert.match(missing.open, /^#\/e\/posts\/shortcuts\?b=0&find=old\+notes$/);
    const out = h.json.items.find((f) => f.kind === 'outside-follow');
    assert.equal(out.fix.rel, 'nofollow');
    // the one-click fix marks the outside link nofollow, as one commit
    const fix = await ed.post('/links/fix', { id: out.id });
    assert.equal(fix.status, 200, fix.text);
    assert.match(readFile(fx, 'src/content/blog/shortcuts.md'), /<a href="https:\/\/blog\.example\.org\/x" rel="nofollow">a blog<\/a>/);
    assert.equal((await ed.post('/links/fix', { id: out.id })).status, 409);
    assert.equal((await ed.post('/links/fix', { id: missing.id })).json.error, 'no-quick-fix');
  });

  test('suggestions both ways; Accept changes the other page in one commit, with Undo; Skip is remembered', async () => {
    const s = await ed.get('/links/suggest?ref=posts/shortcuts');
    assert.equal(s.status, 200, s.text);
    assert.deepEqual(s.json.out.map((x) => x.to), ['posts/guide', 'posts/canvas', 'pages/services']);
    assert.equal(s.json.out[0].how, 'add');
    const inc = s.json.in.find((x) => x.from === 'posts/notes');
    assert.equal(inc.anchor, 'keyboard shortcuts for editors');
    assert.equal(inc.open, '#/e/posts/notes?b=0&find=keyboard+shortcuts+for+editors');
    const box = await ed.get('/links/inbox');
    assert.ok(box.json.items.some((x) => x.id === inc.id));
    // Accept: the notes page gets the link, as a normal save of it
    const a = await alice.post('/links/accept', { id: inc.id, from: inc.from, to: inc.to, dir: 'in' });
    assert.equal(a.status, 200, a.text);
    assert.match(readFile(fx, 'src/content/blog/notes.md'), /talk about \[keyboard shortcuts for editors\]\(\/blog\/shortcuts\/\) and/);
    assert.match(fx.git('log', '-1', '--format=%an %s'), /^author-\w+ Link “keyboard shortcuts for editors” on Field notes to Keyboard shortcuts for editors/);
    assert.equal((await ed.get('/links/pages')).json.items.find((x) => x.ref === 'posts/shortcuts').in, 1);
    // gone once applied; Undo (by whoever accepted it) puts the page back
    assert.equal((await ed.post('/links/accept', { id: inc.id, from: inc.from, to: inc.to, dir: 'in' })).status, 409);
    const u = await alice.post('/site/undo', { commit: a.json.commit });
    assert.equal(u.status, 200, u.text);
    assert.doesNotMatch(readFile(fx, 'src/content/blog/notes.md'), /\]\(\/blog\/shortcuts\/\)/);
    // Skip: left out of the suggestions and the inbox for everyone, until brought back
    const again = (await ed.get('/links/suggest?ref=posts/shortcuts&dir=in')).json.in.find((x) => x.from === 'posts/notes');
    assert.equal(again.id, inc.id);
    assert.equal((await alice.post('/links/skip', { id: inc.id, from: inc.from, to: inc.to, anchor: inc.anchor })).status, 200);
    assert.equal((await ed.get('/links/suggest?ref=posts/shortcuts&dir=in')).json.in.length, 0);
    assert.equal((await ed.get('/links/inbox')).json.skipped, 1);
    assert.equal((await ed.get('/links/skips')).json.items[0].anchor, 'keyboard shortcuts for editors');
    assert.equal((await ed.del(`/links/skips/${inc.id}`)).status, 200);
    assert.equal((await ed.get('/links/suggest?ref=posts/shortcuts&dir=in')).json.in.length, 1);
    // an outgoing one with no sentence asks for words to be written
    const add = await ed.post('/links/accept', { id: s.json.out[0].id, from: 'posts/shortcuts', to: 'posts/guide', dir: 'out' });
    assert.equal(add.status, 422);
    assert.equal(add.json.error, 'needs-words');
  });

  test('a page type’s links checks and the publish sheet’s links part', async () => {
    const c = await ed.get('/collections/posts/entries/shortcuts/page-checks');
    assert.equal(c.status, 200, c.text);
    const up = c.json.checks.find((k) => k.id === 'up');
    assert.equal(up.ok, false);
    assert.match(up.message, /Link to its topic’s main page, “The editing guide”, from the text\./);
    assert.equal(c.json.checks.find((k) => k.id === 'sell').ok, false);
    const pf = await ed.get('/collections/posts/entries/shortcuts/preflight');
    assert.equal(pf.json.topicLinks.ref, 'posts/shortcuts');
    assert.ok(pf.json.topicLinks.incoming >= 1);
    assert.equal(pf.json.topicLinks.review, '#/links?view=page&ref=posts%2Fshortcuts');
    assert.ok(pf.json.rules.some((r) => r.rule === 'pageType' && r.level === 'block'));
  });

  test('the inbox is kept per map and skip list, and pages on request; the topics alone with ?pages=0', async () => {
    const all = await ed.get('/links/inbox');
    assert.equal(all.status, 200, all.text);
    assert.ok(all.json.items.length >= 1, 'the fixture has at least one open suggestion');
    assert.equal(all.json.page, undefined, 'no paging unless asked');
    const one = await ed.get('/links/inbox?perPage=1&page=1');
    assert.equal(one.json.items.length, 1);
    assert.deepEqual([one.json.page, one.json.perPage, one.json.counts.total], [1, 1, all.json.counts.total]);
    assert.deepEqual(one.json.items[0].id, all.json.items[0].id);
    // the same map and skips: the kept answer is returned again (the same items in the same order)
    assert.deepEqual((await ed.get('/links/inbox')).json.items.map((s) => s.id), all.json.items.map((s) => s.id));
    // a skip moves it
    const s = all.json.items[0];
    assert.equal((await ed.post('/links/skip', { id: s.id, from: s.from, to: s.to, anchor: s.anchor })).status, 200);
    const fewer = await ed.get('/links/inbox');
    assert.equal(fewer.json.counts.total, all.json.counts.total - 1);
    assert.ok(!fewer.json.items.some((x) => x.id === s.id));
    assert.equal((await ed.del(`/links/skips/${s.id}`)).status, 200);
    assert.equal((await ed.get('/links/inbox')).json.counts.total, all.json.counts.total);
    const light = await ed.get('/topics?pages=0');
    assert.deepEqual(light.json.pages, []);
    assert.ok(light.json.items.length >= 1);
  });

  test('taking a page out of its topic, deleting a topic', async () => {
    const out = await ed.post('/topics/place', { ref: 'posts/shortcuts', topic: null });
    assert.equal(out.status, 200, out.text);
    assert.equal(out.json.page.topic, null);
    const t = (await ed.get('/topics/editing')).json.topic;
    assert.equal((await ed.del(`/topics/editing?version=${t.version}`)).status, 200);
    assert.equal(fs.existsSync(path.join(fx.site, 'markstage/topics/editing.json')), false);
    assert.equal((await ed.get('/topics')).json.items.length, 0);
  });
});

describe('the site’s own finder of related words (topics.related)', () => {
  let fx, srv, ed;

  before(async () => {
    fx = makeFixture({ checks: false });
    const related = `related: { command: [${JSON.stringify(process.execPath)}, 'scripts/related.mjs'] }`;
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONFIG.replace("follow: ['docs.example.com']", related));
    // stands in for an embeddings index: "other habits" names the shortcuts page; it reads the page it is asked about
    writeFile(fx, 'scripts/related.mjs', "let s = '';\nprocess.stdin.on('data', (d) => (s += d)).on('end', () => {\n  const { page } = JSON.parse(s);\n  console.log(JSON.stringify({ phrases: page.ref === 'posts/shortcuts' && page.text.includes('Shortcuts save time') ? ['other habits'] : [] }));\n});\n");
    writeFile(fx, 'src/content/blog/shortcuts.md', post('Keyboard shortcuts', 'Shortcuts save time when you edit every day.'));
    writeFile(fx, 'src/content/blog/notes.md', post('Field notes', 'These notes talk about other habits, at some length here.'));
    writeFile(fx, 'src/content/pages/services.json', page({ title: 'Editing services', pageType: 'service', sections: [] }));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A related hook');
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('the words it answers are matched like the page’s own keywords, and Accept links them', async () => {
    const s = await ed.get('/links/suggest?ref=posts%2Fshortcuts&dir=in');
    assert.equal(s.status, 200, s.text);
    const sg = s.json.in.find((x) => x.from === 'posts/notes');
    assert.ok(sg, JSON.stringify(s.json.in));
    assert.equal(sg.anchor, 'other habits');
    const a = await ed.post('/links/accept', { id: sg.id, from: sg.from, to: sg.to, dir: 'in' });
    assert.equal(a.status, 200, a.text);
    assert.match(readFile(fx, 'src/content/blog/notes.md'), /\[other habits\]\(\/blog\/shortcuts\/\)/);
  });
});
