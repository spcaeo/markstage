// Translation status (docs/API.md "Translation status"): each entry in each locale that takes its own title or
// description is missing, outdated (the source changed in a later commit than its translation) or done, read from
// git. Test people are made up here, with generated passwords.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, readFile, startServer, writeFile } from './helpers.mjs';
import { loadCore } from '../src/content/converter.mjs';

const SITE = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  locales: [
    { code: 'en-CA', prefix: '', label: 'Canada' },
    { code: 'en-US', prefix: '/en-us', label: 'United States', overrides: ['title', 'description'] },
    { code: 'fr-CA', prefix: '/fr', label: 'Français', overrides: ['title', 'description'] },
    { code: 'de', prefix: '/de', label: 'Deutsch', overrides: ['slug'] },
  ],
};
`;

const POST = (title, excerpt, locales = '') => `---\ntitle: ${title}\nauthor: alice\ndate: '2026-01-02T10:00:00.000Z'\nexcerpt: ${excerpt}\n${locales}---\n\nText.\n`;
const fr = (t, d) => `locales:\n  fr-CA:\n    title: ${t}\n${d ? `    description: ${d}\n` : ''}`;

describe('translation status', () => {
  let fx, srv, ed;
  const commit = (rel, text, msg = 'change') => {
    writeFile(fx, rel, text);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', msg);
  };
  const row = async (id, locale = 'fr-CA') => (await ed.get(`/collections/posts/entries/${id}/translations`)).json.locales.find((l) => l.code === locale);

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Locales');
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
    ed = await as(srv, 'contributor', { authorSlug: 'carol' });
  });
  after(() => srv?.close());

  test('only the locales with their own title or description are tracked; another language is missing until written', async () => {
    const r = await ed.get('/translations?status=all');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.locales, [{ code: 'en-US', label: 'United States', sameLanguage: true }, { code: 'fr-CA', label: 'Français', sameLanguage: false }]);
    const hello = await row('hello-world');
    assert.equal(hello.status, 'missing');
    assert.deepEqual(hello.fields.title, { status: 'missing', source: 'Hello World', value: '', sourceChangedAt: hello.fields.title.sourceChangedAt, translatedAt: null });
    assert.match(hello.fields.title.sourceChangedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
    // the same language as the source: an empty field means "the same", so done
    assert.equal((await row('hello-world', 'en-US')).status, 'done');
  });

  test('written, then the source changes later: outdated; written again: done; both in one commit: done', async () => {
    const rel = 'src/content/blog/hello-world.md';
    commit(rel, POST('Hello World', 'The first post.', fr('Bonjour le monde', 'Le premier article.')), 'French');
    let s = await row('hello-world');
    assert.deepEqual([s.status, s.fields.title.status, s.fields.description.status], ['done', 'done', 'done']);
    assert.equal(s.fields.title.value, 'Bonjour le monde');
    assert.ok(s.translatedAt);

    commit(rel, POST('Hello, World', 'The first post.', fr('Bonjour le monde', 'Le premier article.')), 'New title');
    s = await row('hello-world');
    assert.deepEqual([s.status, s.fields.title.status, s.fields.description.status], ['outdated', 'outdated', 'done']);
    assert.equal(s.fields.title.source, 'Hello, World');

    commit(rel, POST('Hello, World', 'The first post.', fr('Bonjour, le monde', 'Le premier article.')), 'French again');
    assert.equal((await row('hello-world')).status, 'done');

    commit(rel, POST('Hello there', 'The first post!', fr('Salut', 'Le premier article !')), 'Both');
    assert.equal((await row('hello-world')).status, 'done');

    // a change in the working copy, not committed yet, is the newest
    writeFile(fx, rel, POST('Hello again', 'The first post!', fr('Salut', 'Le premier article !')));
    s = await row('hello-world');
    assert.deepEqual([s.status, s.fields.title.status], ['outdated', 'outdated']);
    commit(rel, readFile(fx, rel), 'Saved');
    assert.equal((await row('hello-world')).fields.title.status, 'outdated');
  });

  test('the same language with its own words follows the same rule', async () => {
    const rel = 'src/content/blog/with-html.md';
    commit(rel, POST('With HTML', 'Boxes.', 'locales:\n  en-US:\n    title: With HTML (US)\n'), 'US title');
    assert.equal((await row('with-html', 'en-US')).status, 'done');
    commit(rel, POST('With markup', 'Boxes.', 'locales:\n  en-US:\n    title: With HTML (US)\n'), 'Retitled');
    assert.equal((await row('with-html', 'en-US')).status, 'outdated');
  });

  test('the entries list: language chips per entry, and the not-translated filter', async () => {
    // after the tests above: hello-world has its French (outdated, but words are there), with-html has none
    const list = (await ed.get('/collections/posts/entries?sort=title')).json;
    const chips = Object.fromEntries(list.items.map((e) => [e.id, e.locales]));
    assert.deepEqual(chips['hello-world'], [{ code: 'en-US', done: true }, { code: 'fr-CA', done: true }]);
    assert.deepEqual(chips['with-html'], [{ code: 'en-US', done: true }, { code: 'fr-CA', done: false }]);
    const missing = (await ed.get('/collections/posts/entries?attention=not-translated&sort=title')).json;
    assert.ok(missing.items.every((e) => e.locales.some((l) => !l.done)));
    assert.ok(missing.items.some((e) => e.id === 'with-html'));
    assert.ok(!missing.items.some((e) => e.id === 'hello-world'));
  });

  test('the list: needs by default, filters, counts, sort and pages', async () => {
    const all = (await ed.get('/translations?status=all&perPage=200')).json;
    const needs = (await ed.get('/translations')).json;
    assert.ok(needs.items.length && needs.items.every((i) => i.status !== 'done'));
    assert.equal(needs.total, all.items.filter((i) => i.status !== 'done').length);
    // the counts are for every row, whatever the status filter
    assert.deepEqual(needs.counts, all.counts);
    const fr = all.counts['fr-CA'];
    assert.equal(fr.missing + fr.outdated + fr.done, all.items.filter((i) => i.locale === 'fr-CA').length);

    const missing = (await ed.get('/translations?status=missing&locale=fr-CA&collection=posts&sort=title')).json;
    assert.ok(missing.items.every((i) => i.status === 'missing' && i.locale === 'fr-CA' && i.collection === 'posts'));
    assert.deepEqual(missing.items.map((i) => i.title), [...missing.items.map((i) => i.title)].sort((a, b) => a.localeCompare(b)));
    assert.ok(missing.items.some((i) => i.id === 'bob-draft' && i.entryStatus === 'draft'));

    const out = (await ed.get('/translations?status=outdated')).json.items.map((i) => `${i.id}:${i.locale}`).sort();
    assert.deepEqual(out, ['hello-world:fr-CA', 'with-html:en-US']);
    const hit = (await ed.get('/translations?status=all&q=markup')).json.items;
    assert.deepEqual(hit.map((i) => i.id), ['with-html', 'with-html']);
    assert.equal(hit[0].url, '/blog/with-html/');

    const p1 = (await ed.get('/translations?status=all&perPage=2&page=1&sort=title')).json;
    const p2 = (await ed.get('/translations?status=all&perPage=2&page=2&sort=title')).json;
    assert.deepEqual([p1.items.length, p1.total, p2.page], [2, all.total, 2]);
    assert.notDeepEqual(p1.items[0], p2.items[0]);
  });

  test('wrong filters are said plainly, naming the field; it needs a sign-in', async () => {
    for (const [qs, field] of [['locale=de', 'locale'], ['locale=xx', 'locale'], ['status=soon', 'status'], ['sort=new', 'sort'], ['collection=nope', 'collection'], ['perPage=201', 'perPage'], ['perPage=0', 'perPage'], ['page=x', 'page']]) {
      const r = await ed.get(`/translations?${qs}`);
      assert.deepEqual([r.status, r.json.error, r.json.field], [422, 'invalid', field], qs);
    }
    assert.equal((await ed.get('/translations?perPage=200')).status, 200);
    assert.equal((await ed.get('/collections/posts/entries/nope/translations')).status, 404);
    assert.equal((await fetch(`${srv.base}/markstage/api/translations`)).status, 401);
  });

  test('can.edit: the entry save’s own rule (a contributor: own drafts only; an editor: all)', async () => {
    const mine = (await ed.get('/translations?status=all&q=carol')).json.items;
    assert.ok(mine.length && mine.every((i) => i.can.edit === true));
    const live = (await ed.get('/translations?status=all&q=hello')).json.items;
    assert.ok(live.length && live.every((i) => i.can.edit === false));
    assert.deepEqual((await ed.get('/collections/posts/entries/hello-world/translations')).json.can, { edit: false });
    const boss = await as(srv, 'editor');
    assert.ok((await boss.get('/translations?status=all')).json.items.every((i) => i.can.edit === true));
  });

  test('a page (JSON) is tracked too, by its title', async () => {
    const about = (await ed.get('/collections/pages/entries/about/translations')).json.locales.find((l) => l.code === 'fr-CA');
    assert.deepEqual([about.status, about.fields.title.source], ['missing', 'About']);
  });
});

describe('translation status on a site with one locale', () => {
  let srv, ed;
  before(async () => {
    srv = await startServer(makeFixture({ checks: false }));
    ed = await as(srv, 'editor');
  });
  after(() => srv?.close());

  test('nothing to track: empty answers, not errors', async () => {
    const r = await ed.get('/translations');
    assert.deepEqual([r.status, r.json.locales, r.json.items, r.json.total], [200, [], [], 0]);
    assert.deepEqual((await ed.get('/collections/posts/entries/hello-world/translations')).json, { locales: [], can: { edit: true } });
  });
});
