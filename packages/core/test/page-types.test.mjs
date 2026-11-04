// Page frames and page types (@markstage/core/page-types): the config with its defaults and mistakes; an entry's type
// and frame (its own, its type's, its collection's); the locks a save is held to; the save check; each kind of check
// (section, field, JSON-LD in the data or the built page, links to a type with the same field); the client config.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_FRAMES,
  frameOf,
  framesConfigOf,
  lockRulesFor,
  pageLinks,
  pageProblems,
  pageTypeOf,
  pageTypesClientConfig,
  pageTypesConfigOf,
  pathKey,
  runPageChecks,
  typeChanged,
  typesFor,
} from '@markstage/core/page-types';
import { clientConfig, normalizeConfig } from '@markstage/core/site-config';

const COLLECTIONS = [
  { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', frame: 'reading' },
  { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', frame: 'full' },
];
const TYPES = {
  types: [
    {
      id: 'money',
      label: 'Money page',
      collections: ['pages'],
      frame: 'full',
      template: 'lib_money-page',
      locks: { pages: { booking: ['remove'] } },
      checks: [
        { label: 'A booking button', section: 'booking', level: 'block' },
        { label: 'Questions and answers', field: 'faq.items' },
        { label: 'Service structured data', jsonld: 'Service' },
      ],
    },
    { id: 'pillar', label: 'Pillar page', collections: ['pages'], frame: 'reading' },
    { id: 'legal', label: 'Legal page', collections: ['pages'], frame: 'plain' },
    { id: 'article', label: 'Article', collections: ['posts'], checks: [{ id: 'hub', label: 'Links to its hub', linksTo: { pageType: 'pillar', sameField: 'cluster' } }, { label: 'Links to a money page', linksTo: 'money', hint: 'Link to the service it sells.' }] },
  ],
};
const fail = (m) => {
  throw new Error(m);
};
const frames = framesConfigOf(true, COLLECTIONS, fail);
const site = { frames, pageTypes: pageTypesConfigOf(TYPES, { collections: COLLECTIONS, frames, fail }), collections: COLLECTIONS };

test('frames: true gives the three frames, each collection its default', () => {
  assert.deepEqual(frames.list.map((f) => f.id), ['full', 'reading', 'plain']);
  assert.deepEqual(frames.list, DEFAULT_FRAMES.map((f) => ({ ...f })));
  assert.equal(frames.key, 'frame');
  assert.deepEqual(frames.defaults, { posts: 'reading', pages: 'full' });
  // a collection without one gets "reading"; a site's own list and key
  const own = framesConfigOf({ key: 'layout', list: [{ id: 'wide', label: 'Wide' }, { id: 'narrow', label: 'Narrow', hint: 'Text' }] }, [{ id: 'posts' }], fail);
  assert.deepEqual([own.key, own.defaults], ['layout', { posts: 'wide' }]);
  assert.equal(framesConfigOf(undefined, [{ id: 'posts' }], fail), null);
});

test('frames: the mistakes said plainly', () => {
  assert.throws(() => framesConfigOf(undefined, [{ id: 'posts', frame: 'full' }], fail), /collection "posts": frame needs frames/);
  assert.throws(() => framesConfigOf(true, [{ id: 'posts', frame: 'wide' }], fail), /frame "wide" is not one of the frames \(full, reading, plain\)/);
  assert.throws(() => framesConfigOf({ list: [] }, [], fail), /frames\.list must list the frames/);
  assert.throws(() => framesConfigOf({ list: [{ id: 'A', label: 'x' }] }, [], fail), /lowercase/);
  assert.throws(() => framesConfigOf({ list: [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }] }, [], fail), /names a frame twice/);
});

test('page types: defaults, check ids, the mistakes', () => {
  const pt = site.pageTypes;
  assert.equal(pt.key, 'pageType');
  assert.deepEqual(pt.types[0].checks.map((k) => [k.id, k.kind, k.level]), [['section-1', 'section', 'block'], ['field-2', 'field', 'warn'], ['jsonld-3', 'jsonld', 'warn']]);
  assert.deepEqual(pt.types[0].locks, { pages: { booking: { remove: true } }, articles: {} });
  assert.deepEqual(pt.types[3].checks[1].linksTo, { pageType: ['money'], sameField: null });
  const bad = (t, re) => assert.throws(() => pageTypesConfigOf({ types: [{ id: 'x', label: 'X', ...t }] }, { collections: COLLECTIONS, frames, fail }), re);
  bad({ collections: ['nope'] }, /collections must list collections of this site \(posts, pages\)/);
  bad({ frame: 'wide' }, /frame "wide" is not one of the frames/);
  bad({ template: 'money' }, /shared Library template's id/);
  bad({ checks: [{ label: 'Two', section: 'a', field: 'b' }] }, /a check names one of section, field, jsonld, linksTo/);
  bad({ checks: [{ section: 'a' }] }, /give the check a label/);
  bad({ checks: [{ label: 'L', section: 'a', level: 'error' }] }, /level must be "warn" or "block"/);
  bad({ checks: [{ label: 'L', linksTo: { pageType: 'nope' } }] }, /links to the type "nope", which is not a page type/);
  bad({ locks: { pages: { hero: ['hide'] } } }, /locks must be/);
  assert.throws(() => pageTypesConfigOf({ types: [{ id: 'x', label: 'X', frame: 'full' }] }, { collections: COLLECTIONS, frames: null, fail }), /frame needs frames/);
  assert.throws(() => pageTypesConfigOf({ key: 'frame', types: [{ id: 'x', label: 'X' }] }, { collections: COLLECTIONS, frames, fail }), /must be different keys/);
  assert.equal(pageTypesConfigOf(undefined, { collections: COLLECTIONS, frames, fail }), null);
});

test('an entry’s type and frame: its own, its type’s, its collection’s', () => {
  const pages = COLLECTIONS[1];
  assert.deepEqual(typesFor(site, 'posts').map((t) => t.id), ['article']);
  assert.equal(pageTypeOf(site, pages, { pageType: 'money' }).id, 'money');
  assert.equal(pageTypeOf(site, pages, { pageType: 'article' }), null, 'not a type of pages');
  assert.deepEqual(((f) => [f.id, f.from])(frameOf(site, pages, { pageType: 'legal', frame: 'reading' })), ['reading', 'page']);
  assert.deepEqual(((f) => [f.id, f.from])(frameOf(site, pages, { pageType: 'legal' })), ['plain', 'type']);
  assert.deepEqual(((f) => [f.id, f.from])(frameOf(site, pages, { frame: 'odd' })), ['full', 'collection']);
  assert.deepEqual(((f) => [f.id, f.from])(frameOf(site, 'posts', {})), ['reading', 'collection']);
  assert.equal(frameOf({ frames: null }, pages, {}), null);
});

test('locks: the site’s, with those of the types before and after the save', () => {
  const money = site.pageTypes.types[0];
  const r = lockRulesFor({ pages: { booking: { move: true }, hero: { remove: true } }, articles: {} }, [money, null]);
  assert.deepEqual(r.pages, { booking: { move: true, remove: true }, hero: { remove: true } });
  assert.deepEqual(lockRulesFor(undefined, []), { pages: {}, articles: {} });
});

test('the save check: only changed values; a type change', () => {
  const pages = COLLECTIONS[1];
  assert.deepEqual(pageProblems(site, pages, { frame: 'odd' }, { frame: 'odd', title: 'x' }), []);
  assert.deepEqual(pageProblems(site, pages, null, { frame: 'odd' }).map((p) => p.problem), ['frame']);
  assert.match(pageProblems(site, pages, {}, { pageType: 'article' })[0].message, /Pick one of: Money page, Pillar page, Legal page\./);
  assert.match(pageProblems({ ...site, pageTypes: { key: 'pageType', types: [] } }, pages, {}, { pageType: 'x' })[0].message, /Pages here have no page types/);
  assert.equal(typeChanged(site, { pageType: 'money' }, { pageType: 'pillar' }), true);
  assert.equal(typeChanged(site, { pageType: 'money' }, { pageType: 'money', title: 'y' }), false);
  assert.equal(typeChanged(site, null, { pageType: 'money' }), false, 'a new entry');
});

test('checks: a section, a field, JSON-LD in the data or the built page', () => {
  const money = site.pageTypes.types[0];
  const run = (data, built = null) => runPageChecks(site, money, { collection: 'pages', format: 'json', data, doc: null, built, links: [] }).map((k) => k.ok);
  assert.deepEqual(run({ sections: [] }), [false, false, false]);
  const full = { sections: [{ discriminant: 'booking', value: {} }], faq: { items: [{ q: 'Why?' }] }, schema: { '@type': ['Service', 'Thing'] } };
  assert.deepEqual(run(full), [true, true, true]);
  const html = '<script type="application/ld+json">{"@graph":[{"@type":"Service"}]}</script><script type="application/ld+json">not json</script>';
  assert.deepEqual(run({ sections: [] }, html), [false, false, true]);
  const res = runPageChecks(site, money, { collection: 'pages', format: 'json', data: {}, doc: null, built: null, links: [] });
  assert.deepEqual(res[0], { id: 'section-1', label: 'A booking button', level: 'block', ok: false, message: 'Add a “booking” section: this page has none.' });
  assert.match(res[2].message, /yet \(the built page is read once it is published\)/);
  // an article box: a node of that type in the document
  const art = { id: 't', label: 'T', checks: [{ id: 'faq', label: 'FAQ', level: 'warn', kind: 'section', section: 'faq', hint: '' }] };
  const doc = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'faq', attrs: {} }] };
  assert.equal(runPageChecks(site, art, { format: 'md', data: {}, doc, links: [] })[0].ok, true);
  assert.match(runPageChecks(site, art, { format: 'md', data: {}, doc: { type: 'doc', content: [] }, links: [] })[0].message, /Add a “faq” box/);
});

test('checks: links to a type, with the same field', () => {
  const article = site.pageTypes.types[3];
  const hub = { collection: 'pages', id: 'basics', title: 'Basics', data: { pageType: 'pillar', cluster: 'basics' } };
  const other = { collection: 'pages', id: 'other', title: 'Other', data: { pageType: 'pillar', cluster: 'other' } };
  const money = { collection: 'pages', id: 'services', title: 'Services', data: { pageType: 'money' } };
  const run = (data, targets) => runPageChecks(site, article, { collection: 'posts', format: 'md', data, doc: null, links: targets.map((t) => ({ href: '/x/', target: t })) });
  assert.deepEqual(run({ cluster: 'basics' }, [hub, money]).map((k) => k.ok), [true, true]);
  const miss = run({ cluster: 'basics' }, [other, null]);
  assert.deepEqual(miss.map((k) => k.ok), [false, false]);
  assert.equal(miss[0].message, 'Link to a pillar page with the same “cluster” from the text.');
  assert.equal(miss[1].message, 'Link to the service it sells.', "the check's own hint");
  assert.equal(run({}, [hub])[0].message, 'Set “cluster” first, then link to a pillar page with the same one.');
  assert.deepEqual(runPageChecks(site, null, {}), []);
});

test('the site config: frames and page types normalized, the client config carries them', () => {
  const cfg = normalizeConfig({ frames: true, collections: COLLECTIONS, pageTypes: TYPES }, '/tmp/site');
  assert.deepEqual(cfg.frames.defaults, { posts: 'reading', pages: 'full' });
  assert.equal(cfg.pageTypes.types.length, 4);
  const cc = clientConfig(cfg);
  assert.deepEqual(cc.frames.list.map((f) => f.id), ['full', 'reading', 'plain']);
  assert.deepEqual(cc.pageTypes.types[0].checks, [
    { id: 'section-1', label: 'A booking button', level: 'block' },
    { id: 'field-2', label: 'Questions and answers', level: 'warn' },
    { id: 'jsonld-3', label: 'Service structured data', level: 'warn' },
  ]);
  assert.deepEqual(cc.pageTypes.types[0].locks.pages, { booking: { remove: true } });
  const none = clientConfig(normalizeConfig({ collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog' }] }, '/tmp/site'));
  assert.deepEqual([none.frames, none.pageTypes], [null, null]);
  assert.deepEqual(pageTypesClientConfig({}), { frames: null, pageTypes: null });
  assert.throws(() => normalizeConfig({ collections: COLLECTIONS }, '/tmp/site'), /frame needs frames/);
});

test('the links of an entry (dev mode’s finder): marks, HTML, link values; site paths only', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'https://example.com/services/' } }] }, { type: 'text', text: 'b', marks: [{ type: 'link', attrs: { href: 'https://other.example/x' } }] }] }, { type: 'html', attrs: { html: '<a href="/guide/#top">g</a>' } }] };
  const data = { cta: { href: '/book/' }, items: [{ url: '//cdn.example/x' }, { text: '<a href=\'/faq/\'>faq</a>' }], title: '/not-a-link/' };
  assert.deepEqual(pageLinks(doc, data, 'https://example.com/'), ['/services/', '/guide/#top', '/book/', '/faq/']);
  assert.deepEqual([pathKey('/guide/#top'), pathKey('/a/b/?q=1'), pathKey('/'), pathKey('')], ['/guide', '/a/b', '/', '/']);
});
