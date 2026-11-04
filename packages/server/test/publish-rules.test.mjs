// The publish rules (docs/SEO.md section 3): an image without a description, a link to a page that is not live, or
// the same search title or description as another live page stops a publish and a schedule (the sheet says why,
// and the routes refuse it); heading problems only warn. Each rule can be set to block, warn or off.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { addressOf, duplicatesOf, headingIssues } from '../src/publish-rules.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';

const later = () => new Date(Date.now() + 3 * 86400_000).toISOString();

describe('publish rules', () => {
  let srv;
  let editor;
  const draft = async (title, body) => {
    const made = await editor.post('/collections/posts/entries', { title });
    assert.equal(made.status, 201, made.text);
    const id = made.json.id;
    const e = await editor.get(`/collections/posts/entries/${id}/source`);
    const save = await editor.put(`/collections/posts/entries/${id}/source`, { version: e.json.version, source: `${e.json.source.trimEnd()}\n\n${body}\n` });
    assert.equal(save.status, 200, save.text);
    return { id, version: save.json.version };
  };

  before(async () => {
    // the real core: the stub reads only the first levels of headings
    srv = await startServer(makeFixture({ checks: false }), { core: await loadCore() });
    editor = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(() => srv.close());

  test('an image without a description blocks; the sheet says so, publish and schedule refuse it', async () => {
    const { id, version } = await draft('Pictures', '<p><img src="/uploads/a.png"></p>');
    const pf = (await editor.get(`/collections/posts/entries/${id}/preflight`)).json;
    assert.equal(pf.blocked, true);
    assert.deepEqual(pf.rules.map((r) => [r.rule, r.level]), [['altText', 'block']]);
    assert.equal(pf.publishRules.headings, 'warn');
    const pub = await editor.post(`/collections/posts/entries/${id}/publish`, { version });
    assert.equal(pub.status, 422);
    assert.equal(pub.json.error, 'blocked');
    assert.match(pub.json.message, /1 image without a description/);
    assert.equal((await editor.post(`/collections/posts/entries/${id}/schedule`, { version, publishAt: later() })).status, 422);
    // publishing with the fix in the same request goes through
    const e = await editor.get(`/collections/posts/entries/${id}/source`);
    const fixed = await editor.post(`/collections/posts/entries/${id}/publish`, { version, source: e.json.source.replace('<img src="/uploads/a.png">', '<img src="/uploads/a.png" alt="A chart">') });
    assert.equal(fixed.status, 202, fixed.text);
    await srv.app.jobs.idle();
  });

  test('a link to a draft blocks; a link to a page the server cannot look up only warns', async () => {
    const { id, version } = await draft('Links', '<p><a href="/blog/bob-draft/">a draft</a> <a href="/blog/nowhere/">maybe</a></p>');
    const pf = (await editor.get(`/collections/posts/entries/${id}/preflight`)).json;
    assert.deepEqual(pf.rules.map((r) => [r.rule, r.level, r.count]), [['links', 'block', 1], ['links', 'warn', 1]]);
    assert.equal((await editor.post(`/collections/posts/entries/${id}/publish`, { version })).status, 422);
  });

  test('the same title as another live page blocks; a draft with the same title does not count', async () => {
    const same = await draft('Hello World', 'Different words.');
    const pf = (await editor.get(`/collections/posts/entries/${same.id}/preflight`)).json;
    assert.deepEqual(pf.duplicates.title.map((d) => d.id), ['hello-world']);
    assert.equal(pf.blocked, true);
    assert.equal((await editor.post(`/collections/posts/entries/${same.id}/publish`, { version: same.version })).status, 422);
    // two drafts may share a title: neither is on the site
    const twin = await draft('Carol Draft', 'Words.');
    assert.equal((await editor.get(`/collections/posts/entries/${twin.id}/preflight`)).json.duplicates.title.length, 0);
  });

  test('heading problems warn and do not stop a publish', async () => {
    const { id, version } = await draft('Headings', '# One\n\n#### Four\n\n# Two');
    const pf = (await editor.get(`/collections/posts/entries/${id}/preflight`)).json;
    assert.deepEqual(pf.rules.map((r) => [r.rule, r.level]), [['headings', 'warn']]);
    assert.equal(pf.headings.length, 2);
    assert.equal((await editor.post(`/collections/posts/entries/${id}/publish`, { version })).status, 202);
    await srv.app.jobs.idle();
  });
});

describe('publish rules: set per site', () => {
  test('links set to warn let the publish through; unknown rules and levels are refused at start', async () => {
    const srv = await startServer(makeFixture({ checks: false }), { overrides: { publishRules: { links: 'warn', altText: 'off' } } });
    try {
      const editor = await as(srv, 'editor', { authorSlug: 'ed' });
      const made = await editor.post('/collections/posts/entries', { title: 'Relaxed' });
      const e = await editor.get(`/collections/posts/entries/${made.json.id}/source`);
      const save = await editor.put(`/collections/posts/entries/${made.json.id}/source`, { version: e.json.version, source: `${e.json.source}\n<p><a href="/blog/bob-draft/">x</a><img src="/a.png"></p>\n` });
      const pf = (await editor.get(`/collections/posts/entries/${made.json.id}/preflight`)).json;
      assert.deepEqual(pf.rules.map((r) => [r.rule, r.level]), [['links', 'warn']], 'alt text is off');
      assert.equal((await editor.post(`/collections/posts/entries/${made.json.id}/publish`, { version: save.json.version })).status, 202);
      await srv.app.jobs.idle();
    } finally {
      await srv.close();
    }
    const fx = makeFixture({ checks: false });
    const env = { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
    assert.throws(() => loadConfig({ env, overrides: { publishRules: { spelling: 'block' } } }), /unknown rule/);
    assert.throws(() => loadConfig({ env, overrides: { publishRules: { links: 'maybe' } } }), /block", "warn" or "off"/);
  });
});

test('headings: a second H1 and a skipped level, in the body', () => {
  const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
  const doc = { type: 'doc', content: [h(1, 'Title'), h(2, 'Part'), h(3, 'Fine'), h(2, 'Next'), h(4, 'Jump'), h(1, 'Again')] };
  assert.deepEqual(headingIssues(doc).map((i) => i.where), ['block 5', 'block 6']);
  assert.match(headingIssues(doc)[0].message, /H4 right after an H2: an H3 is skipped/);
  assert.match(headingIssues(doc)[1].message, /second main heading/);
});

describe('duplicates: pages only', () => {
  // a store over plain objects: each entry's fields are its text (JSON), its address from the collection
  const col = (id, url, seo = null) => ({ id, url, seo, fields: { title: 'title', excerpt: 'excerpt' } });
  const pages = col('pages', (e) => e.uri, { title: 'seo.title', description: 'seo.description' });
  const topics = col('topics', (e) => e.path);
  const authors = col('authors', () => null);
  const data = {
    pages: { forms: { title: 'Forms', uri: '/forms/', seo: { title: 'Forms guide | Site' } }, other: { title: 'Other', uri: '/other/', seo: { title: 'Forms' } } },
    topics: { forms: { title: 'Forms', path: '/forms/' } },
    authors: { ann: { title: 'Forms' } },
  };
  const store = {
    collections: [pages, topics, authors],
    ids: (c) => Object.keys(data[c.id]),
    read: (c, id) => ({ text: JSON.stringify(data[c.id][id]) }),
    fieldsOf: (c, text) => JSON.parse(text),
    summarize: (c, id, text) => ({ title: JSON.parse(text).title, url: c.url(JSON.parse(text)) }),
    // the content index: a record per entry (its fields), and the summary from a record
    index: (c) => new Map(Object.entries(data[c.id]).map(([id, fields]) => [id, { id, version: id, fields }])),
    summaryOf: (c, e) => ({ title: e.fields.title, url: c.url(e.fields) }),
  };
  const ids = (d) => d.title.map((x) => `${x.collection}/${x.id}`).sort();

  test('a page reads its seo title (a JSON collection with the seo setting)', () => {
    assert.deepEqual(ids(duplicatesOf(store, pages, 'forms', data.pages.forms, '/forms/')), []);
  });
  test('an entry with no URL is not a page; an entry at the same address is the same page', () => {
    // the topic "Forms" lives at /forms/, the address of the page "forms": not a duplicate of it, nor of the author
    assert.deepEqual(ids(duplicatesOf(store, topics, 'forms', data.topics.forms, '/forms/')), ['pages/other']);
    assert.deepEqual(ids(duplicatesOf(store, authors, 'ann', data.authors.ann, null)), [], 'an author with no page has no duplicates');
    // with no address given, only the others are looked at
    assert.deepEqual(ids(duplicatesOf(store, topics, 'forms', data.topics.forms)), ['pages/other']);
  });
  test('addressOf: path without host, query, hash or trailing slash; null for none', () => {
    assert.equal(addressOf('https://example.com/a/b/?x=1#y'), '/a/b');
    assert.equal(addressOf('/a/'), '/a');
    assert.equal(addressOf('/'), '/');
    assert.equal(addressOf(''), null);
    assert.equal(addressOf(null), null);
  });
});
