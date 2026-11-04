// The site config loader as the server imports it (@markstage/core/site-config): templates and functions for an
// entry's page address and group.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientConfig, ConfigError, groupIdOf, groupOf, normalizeConfig, urlOf } from '@markstage/core/site-config';

const cfg = normalizeConfig(
  {
    siteName: 'T',
    collections: [
      { id: 'posts', format: 'md', dir: 'src/content/posts', url: '/blog/{id}/', group: ({ data }) => data.topic },
      { id: 'pages', format: 'json', dir: 'src/content/pages', url: ({ id }) => (id === 'home' ? '/' : `/${id}/`) },
      { id: 'authors', format: 'json', dir: 'src/content/authors' },
    ],
  },
  '/tmp/site',
);
const [posts, pages, authors] = cfg.collections;

test('urlOf: template, function, no page', () => {
  assert.equal(urlOf(posts, { id: 'hello', data: {} }), '/blog/hello/');
  assert.equal(urlOf(pages, { id: 'home', data: {} }), '/');
  assert.equal(urlOf(pages, { id: 'about', data: {} }), '/about/');
  assert.equal(urlOf(authors, { id: 'ann', data: {} }), null);
});

test('groupOf: the function, else null', () => {
  assert.equal(groupOf(posts, { id: 'a', data: { topic: 'Guides' } }), 'Guides');
  assert.equal(groupOf(posts, { id: 'a', data: {} }), null);
  assert.equal(groupOf(pages, { id: 'home', data: {} }), null);
});

test('locales: defaults, xDefault, mistakes refused', () => {
  const base = { siteName: 'T', collections: [] };
  const l = normalizeConfig({ ...base, locales: [{ code: 'en-CA', prefix: '', label: 'Canada', variety: 'Canadian', spelling: './spell.mjs' }, { code: 'en-US', prefix: '/en-us/', variety: 'US' }] }, '/tmp/site').locales;
  assert.equal(l.list[0].default, true);
  assert.equal(l.list[1].prefix, '/en-us');
  assert.equal(l.list[0].spelling, '/tmp/site/spell.mjs');
  assert.equal(l.xDefault, 'en-CA');
  assert.equal(l.overridesKey, 'locales');
  assert.equal(normalizeConfig(base, '/tmp/site').locales, null);
  const bad = (locales, extra = {}) => assert.throws(() => normalizeConfig({ ...base, locales, ...extra }, '/tmp/site'), /markstage.config: /);
  bad([{ code: 'english', prefix: '' }]);
  bad([{ code: 'en-CA', prefix: 'en-us' }]);
  bad([{ code: 'en-CA', prefix: '' }, { code: 'en-CA', prefix: '/x' }]);
  bad([{ code: 'en-CA', prefix: '' }, { code: 'en-US', prefix: '' }]);
  bad([{ code: 'en-CA', prefix: '', default: true }, { code: 'en-US', prefix: '/en-us', default: true }]);
  bad([{ code: 'en-CA', prefix: '', overrides: ['body'] }]);
  bad([{ code: 'en-CA', prefix: '' }], { xDefault: 'fr' });
});

test('locale paths and the hreflang set (as a two-locale site emits it)', async () => {
  const { alternates, localeOfPath, localePath } = await import('@markstage/core');
  const l = normalizeConfig({ siteName: 'T', collections: [], locales: [{ code: 'en-CA', prefix: '' }, { code: 'en-US', prefix: '/en-us' }] }, '/tmp/site').locales;
  assert.equal(localePath(l.list[1], '/blog/x/'), '/en-us/blog/x/');
  assert.deepEqual(alternates(l, '/blog/x/'), [
    { hreflang: 'en-CA', path: '/blog/x/' },
    { hreflang: 'en-US', path: '/en-us/blog/x/' },
    { hreflang: 'x-default', path: '/blog/x/' },
  ]);
  assert.equal(localeOfPath(l, '/en-us/blog/x/').code, 'en-US');
  assert.equal(localeOfPath(l, '/en-usa/').code, 'en-CA');
  assert.deepEqual(alternates(null, '/x/'), []);
});

test('emitsHreflang: noindex or a canonical elsewhere emit none', async () => {
  const { emitsHreflang } = await import('@markstage/core');
  const l = normalizeConfig({ siteName: 'T', collections: [], locales: [{ code: 'en-CA', prefix: '' }], hreflang: { robots: 'seo.robots', canonical: 'seo.canonical' } }, '/tmp/site').locales;
  assert.equal(emitsHreflang(l, {}, '/x/').ok, true);
  assert.equal(emitsHreflang(l, { seo: { robots: ['follow', 'noindex'] } }, '/x/').ok, false);
  assert.equal(emitsHreflang(l, { seo: { robots: 'noindex, follow' } }, '/x/').ok, false);
  assert.equal(emitsHreflang(l, { seo: { canonical: 'https://ex.com/x/' } }, '/x/', 'https://ex.com').ok, true);
  assert.equal(emitsHreflang(l, { seo: { canonical: 'https://ex.com/y/' } }, '/x/', 'https://ex.com').ok, false);
  // without the keys configured nothing is read
  const plain = normalizeConfig({ siteName: 'T', collections: [], locales: [{ code: 'en-CA', prefix: '' }] }, '/tmp/site').locales;
  assert.equal(emitsHreflang(plain, { seo: { robots: ['noindex'] } }, '/x/').ok, true);
  assert.throws(() => normalizeConfig({ siteName: 'T', collections: [], locales: [{ code: 'en-CA', prefix: '' }], hreflang: { robots: 'not a key' } }, '/tmp/site'));
});

test('editor.images: widths (first writes no class), captions, decorative class; mistakes refused', () => {
  const base = { siteName: 'T', collections: [] };
  const d = normalizeConfig(base, '/tmp/x').editor.images;
  assert.deepEqual(d, { widths: [{ id: 'normal', label: 'Normal', class: null }], captions: true, decorativeClass: 'decorative' });
  const c = normalizeConfig({ ...base, editor: { images: { widths: [{ id: 'normal', label: 'Normal' }, { id: 'wide', label: 'Wide', class: 'wide' }], captions: false } } }, '/tmp/x').editor.images;
  assert.deepEqual(c.widths[1], { id: 'wide', label: 'Wide', class: 'wide' });
  assert.equal(c.captions, false);
  assert.throws(() => normalizeConfig({ ...base, editor: { images: { widths: [{ id: 'normal' }, { id: 'wide' }] } } }, '/tmp/x'), /class/);
  assert.throws(() => normalizeConfig({ ...base, editor: { images: { widths: [] } } }, '/tmp/x'), /widths/);
  assert.throws(() => normalizeConfig({ ...base, editor: { images: { widths: [{ id: 'a' }, { id: 'a', class: 'b' }] } } }, '/tmp/x'), /unique/);
});

test('themes: a dark scheme switched by an attribute or a class reaches the client; mistakes refused', async () => {
  const { clientConfig } = await import('@markstage/core/site-config');
  const base = { siteName: 'T', collections: [] };
  assert.deepEqual(normalizeConfig(base, '/tmp/x').themes, {});
  const c = normalizeConfig({ ...base, themes: { dark: { attr: 'data-theme', value: 'dark' } } }, '/tmp/x');
  assert.deepEqual(clientConfig(c).themes, { dark: { attr: 'data-theme', value: 'dark' } });
  assert.deepEqual(normalizeConfig({ ...base, themes: { dark: { attr: 'class', value: 'dark' } } }, '/tmp/x').themes.dark, { attr: 'class', value: 'dark' });
  assert.throws(() => normalizeConfig({ ...base, themes: { sepia: { attr: 'data-theme', value: 'sepia' } } }, '/tmp/x'), /only "dark"/);
  assert.throws(() => normalizeConfig({ ...base, themes: { dark: { attr: 'on click', value: 'dark' } } }, '/tmp/x'), /attribute/);
  // only a data- attribute or the class: never an event handler or a style
  assert.throws(() => normalizeConfig({ ...base, themes: { dark: { attr: 'onload', value: 'x' } } }, '/tmp/x'), /attribute/);
  assert.throws(() => normalizeConfig({ ...base, themes: { dark: { attr: 'style', value: 'x' } } }, '/tmp/x'), /attribute/);
  assert.throws(() => normalizeConfig({ ...base, themes: { dark: { attr: 'class', value: 'Dark Mode' } } }, '/tmp/x'), /value/);
});

test('editor.linkCards: a site path, or {url, fields} with the key names of the data; mistakes refused', async () => {
  const { clientConfig } = await import('@markstage/core/site-config');
  const base = { siteName: 'T', collections: [] };
  assert.equal(clientConfig(normalizeConfig(base, '/tmp/x')).linkCards, null);
  const plain = normalizeConfig({ ...base, editor: { linkCards: '/link-cards.json' } }, '/tmp/x').editor.linkCards;
  assert.deepEqual(plain, { url: '/link-cards.json', fields: { title: 'title', description: 'description', image: 'image', tag: 'tag', date: 'date' } });
  const short = normalizeConfig({ ...base, editor: { linkCards: { url: '/link-cards.json', fields: { title: 't', description: 'e', image: 'i', tag: 'g', date: 'd' } } } }, '/tmp/x');
  assert.deepEqual(clientConfig(short).linkCards.fields, { title: 't', description: 'e', image: 'i', tag: 'g', date: 'd' });
  assert.throws(() => normalizeConfig({ ...base, editor: { linkCards: 'https://elsewhere.example/cards.json' } }, '/tmp/x'), /site path/);
  assert.throws(() => normalizeConfig({ ...base, editor: { linkCards: '//elsewhere.example/cards.json' } }, '/tmp/x'), /site path/);
  assert.throws(() => normalizeConfig({ ...base, editor: { linkCards: { url: '/c.json', fields: { author: 'a' } } } }, '/tmp/x'), /fields/);
});

test('defaultAuthor and newEntry pass through; newEntry.ask names settings keys; the client sees only what to ask', async () => {
  const { clientConfig } = await import('@markstage/core/site-config');
  const defaults = ({ title, now }) => ({ modified: now.toISOString(), seo: { title } });
  const c = normalizeConfig(
    {
      siteName: 'T',
      schema: { keystatic: './keystatic.config.ts' },
      redirects: { command: ['node', 'scripts/add-redirects.mjs'] },
      collections: [
        {
          id: 'posts',
          format: 'md',
          dir: 'src/content/posts',
          defaultAuthor: 'site-team',
          settings: [{ type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' }],
          newEntry: { ask: ['cluster'], defaults },
        },
        { id: 'notes', format: 'md', dir: 'src/content/notes', newEntry: defaults },
      ],
    },
    '/tmp/x',
  );
  const [posts, notes] = c.collections;
  assert.equal(posts.defaultAuthor, 'site-team');
  assert.deepEqual(posts.newEntry.ask, ['cluster']);
  assert.equal(posts.newEntry.defaults, defaults);
  assert.deepEqual(notes.newEntry, { ask: [], defaults });
  assert.deepEqual(c.redirects, { command: ['node', 'scripts/add-redirects.mjs'] });
  assert.deepEqual(c.schema, { keystatic: './keystatic.config.ts' });
  const client = clientConfig(c);
  assert.deepEqual(client.collections[0].newEntry, { ask: ['cluster'] });
  assert.ok(!JSON.stringify(client).includes('site-team'));
  const bad = (col) => () => normalizeConfig({ siteName: 'T', collections: [{ id: 'posts', format: 'md', dir: 'src/content/posts', ...col }] }, '/tmp/x');
  assert.throws(bad({ defaultAuthor: 'Site Team' }), /author slug/);
  assert.throws(bad({ newEntry: { ask: ['nope'] } }), /settings/);
  assert.throws(bad({ newEntry: { defaults: 'x' } }), /function/);
});

test('newEntryFrontmatter: title and slug first, asked values over the defaults, author, draft', async () => {
  const { newEntryFrontmatter } = await import('@markstage/core/site-config');
  const now = new Date('2026-10-28T12:00:00Z');
  const seen = [];
  const c = normalizeConfig(
    {
      siteName: 'T',
      collections: [
        {
          id: 'posts',
          format: 'md',
          dir: 'src/content/posts',
          hasStatus: true,
          fields: { slug: 'slug' },
          defaultAuthor: 'site-team',
          settings: [{ type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' }],
          newEntry: { ask: ['cluster'], defaults: (a) => (seen.push(a), { title: 'not this', cluster: 'misc', date: a.now.toISOString() }) },
        },
        { id: 'notes', format: 'md', dir: 'src/content/notes' },
      ],
    },
    '/tmp/x',
  ).collections;
  const fm = newEntryFrontmatter(c[0], { title: 'Hi', id: 'hi', values: { cluster: 'forms' }, user: { id: 'u1' }, now });
  assert.deepEqual(fm, { title: 'Hi', slug: 'hi', cluster: 'forms', date: '2026-10-28T12:00:00.000Z', author: 'site-team', draft: true });
  assert.deepEqual(Object.keys(fm), ['title', 'slug', 'cluster', 'date', 'author', 'draft']);
  assert.deepEqual(seen[0], { title: 'Hi', id: 'hi', collection: 'posts', values: { cluster: 'forms' }, user: { id: 'u1' }, now });
  assert.equal(newEntryFrontmatter(c[0], { title: 'Hi', id: 'hi', author: 'ana' }).author, 'ana');
  assert.deepEqual(newEntryFrontmatter(c[1], { title: 'Note', id: 'note' }), { title: 'Note' });
  // a template's seo (asked values) keeps its own keys and gets the defaults' canonical; a list is never merged
  const [d] = normalizeConfig(
    { siteName: 'T', collections: [{ id: 'posts', format: 'md', dir: 'src/content/posts', newEntry: { defaults: ({ id }) => ({ seo: { title: 'default', canonical: `https://x.test/${id}/`, robots: ['noindex'] } }) } }] },
    '/tmp/x',
  ).collections;
  const t = newEntryFrontmatter(d, { title: 'Hi', id: 'hi', values: { seo: { title: 'From the template', robots: ['index'] } }, now });
  assert.deepEqual(t.seo, { title: 'From the template', canonical: 'https://x.test/hi/', robots: ['index'] });
});

test('required: the title and slug always, plus the listed keys; bad keys refused', () => {
  const c = normalizeConfig({ siteName: 'T', collections: [{ id: 'posts', format: 'md', dir: 'src/content/posts', fields: { slug: 'slug' }, required: ['seo.title', 'date'] }] }, '/tmp/x');
  assert.deepEqual(c.collections[0].required, ['title', 'slug', 'seo.title', 'date']);
  assert.throws(() => normalizeConfig({ siteName: 'T', collections: [{ id: 'p', format: 'md', dir: 'p', required: ['bad key'] }] }, '/tmp/x'), /required/);
});

test('an image setting names the key its alt text falls back to (altFallback); the client sees it; a non-key is refused', async () => {
  const { clientConfig } = await import('@markstage/core/site-config');
  const image = (altFallback) => ({ siteName: 'T', collections: [{ id: 'posts', format: 'md', dir: 'p', settings: [{ type: 'image', key: 'cover.src', alt: 'cover.alt', altFallback, label: 'Cover' }] }] });
  const c = normalizeConfig(image('title'), '/tmp/site');
  assert.equal(c.collections[0].settings[0].altFallback, 'title');
  assert.equal(clientConfig(c).collections[0].settings[0].altFallback, 'title');
  assert.throws(() => normalizeConfig(image('the title!'), '/tmp/site'), /altFallback must be a frontmatter key/);
  assert.throws(() => normalizeConfig(image(() => 'x'), '/tmp/site'), /altFallback must be a frontmatter key/);
});

test('seo: the search keys of a collection; a JSON collection takes its seo setting only, and keeps no drawer', () => {
  const site = (pages) => ({
    siteName: 'T',
    collections: [
      { id: 'posts', format: 'md', dir: 'p', settings: [{ type: 'seo', title: 'seo.title', description: 'seo.description' }] },
      { id: 'pages', format: 'json', dir: 'g', url: '{uri}', ...pages },
    ],
  });
  const c = normalizeConfig(site({ settings: [{ type: 'seo', title: 'seo.title', description: 'meta.text' }] }), '/tmp/site');
  assert.deepEqual(c.collections.map((x) => x.seo), [{ title: 'seo.title', description: 'seo.description' }, { title: 'seo.title', description: 'meta.text' }]);
  assert.deepEqual(c.collections[1].settings, [], 'pages have no Post settings drawer');
  assert.deepEqual(clientConfig(c).collections[1].settings, []);
  assert.equal(normalizeConfig(site({}), '/tmp/site').collections[1].seo, null);
  const bad = (settings) => () => normalizeConfig(site({ settings }), '/tmp/site');
  assert.throws(bad([{ type: 'text', key: 'x' }]), /a JSON collection takes only an seo setting/);
  assert.throws(bad([{ type: 'seo', title: 'seo.title' }]), /description must be a key/);
  assert.throws(bad([{ type: 'seo', title: 'a', description: 'b' }, { type: 'seo', title: 'c', description: 'd' }]), /one seo setting only/);
  assert.throws(bad({ type: 'seo' }), /settings must be a list/);
});

test('a switch setting (on or off) keeps its default; the client sees it; a default that is not true or false is refused', () => {
  const sw = (f) => ({ siteName: 'T', collections: [{ id: 'posts', format: 'md', dir: 'p', settings: [{ type: 'switch', key: 'toc', label: 'Show contents', ...f }] }] });
  const c = normalizeConfig(sw({ default: true }), '/tmp/site');
  assert.deepEqual(clientConfig(c).collections[0].settings[0], { type: 'switch', key: 'toc', label: 'Show contents', default: true });
  assert.equal(normalizeConfig(sw({}), '/tmp/site').collections[0].settings[0].default, undefined);
  assert.throws(() => normalizeConfig(sw({ default: 'yes' }), '/tmp/site'), /default must be true or false/);
  assert.throws(() => normalizeConfig(sw({ key: 'not a key' }), '/tmp/site'), /key must be a frontmatter key/);
});

test('editor.goLive: one sentence for dev mode, the general one by default; mistakes refused', async () => {
  const { normalizeConfig, clientConfig, GO_LIVE } = await import('@markstage/core/site-config');
  const base = { collections: [{ id: 'posts', format: 'md', dir: 'content' }] };
  assert.equal(clientConfig(normalizeConfig(base, '/tmp/x')).goLive, GO_LIVE);
  assert.equal(clientConfig(normalizeConfig({ ...base, editor: { goLive: ' It goes live when the site is published. ' } }, '/tmp/x')).goLive, 'It goes live when the site is published.');
  assert.throws(() => normalizeConfig({ ...base, editor: { goLive: 42 } }, '/tmp/x'), /editor.goLive/);
});

test('locks: the site rules by section type and box name; the client sees them; mistakes refused', () => {
  const base = { collections: [{ id: 'posts', format: 'md', dir: 'content' }] };
  const c = normalizeConfig({ ...base, locks: { pages: { hero: ['remove', 'move'] }, articles: { faq: ['move'] } } }, '/tmp/x');
  assert.deepEqual(c.locks, { pages: { hero: { move: true, remove: true } }, articles: { faq: { move: true } } });
  assert.deepEqual(clientConfig(c).locks, c.locks);
  assert.deepEqual(normalizeConfig(base, '/tmp/x').locks, { pages: {}, articles: {} });
  assert.throws(() => normalizeConfig({ ...base, locks: { pages: { hero: ['hide'] } } }, '/tmp/x'), /locks must be/);
  assert.throws(() => normalizeConfig({ ...base, locks: { posts: { faq: ['move'] } } }, '/tmp/x'), /locks must be/);
});

test('linkKeys: a menu key naming an entry of a collection; the client sees it; unknown collections refused', () => {
  const cols = [
    { id: 'pages', format: 'json', dir: 'pages' },
    { id: 'navigation', format: 'json', dir: 'nav', linkKeys: { page: 'pages' } },
  ];
  const c = normalizeConfig({ collections: cols }, '/tmp/x');
  assert.deepEqual(clientConfig(c).collections[1].linkKeys, { page: 'pages' });
  assert.deepEqual(clientConfig(c).collections[0].linkKeys, {});
  assert.throws(() => normalizeConfig({ collections: [cols[1]] }, '/tmp/x'), /not a collection/);
  assert.throws(() => normalizeConfig({ collections: [cols[0], { ...cols[1], linkKeys: { href: 'pages' } }] }, '/tmp/x'), /linkKeys must/);
});

test("addressKey: the field that is a page's whole address (fields.url, or a url of just that field), else none", () => {
  const keys = (c) => clientConfig(normalizeConfig({ siteName: 'T', collections: [{ id: 'x', format: 'json', dir: 'src/x', ...c }] }, '/tmp/x')).collections[0].addressKey;
  assert.equal(keys({ url: '{uri}' }), 'uri');
  assert.equal(keys({ fields: { url: 'path' } }), 'path');
  assert.equal(keys({ url: '/blog/{id}/' }), undefined);
  assert.equal(keys({ url: ({ id }) => `/${id}/` }), undefined);
  assert.equal(keys({}), undefined);
});

test('groups: entries sorted into another collection’s entries, each with its own order; checked, and passed to the editor only when set', () => {
  const posts = { id: 'posts', format: 'md', dir: 'src/posts', settings: [{ type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' }] };
  const cols = (g, extra = []) => [{ ...posts, ...(g === undefined ? {} : { groups: g }) }, { id: 'clusters', format: 'json', dir: 'src/clusters' }, ...extra];
  const ok = normalizeConfig({ collections: cols({ field: 'cluster', collection: 'clusters', order: 'order', label: 'Topics' }) }, '/tmp/x');
  assert.deepEqual(ok.collections[0].groups, { field: 'cluster', collection: 'clusters', order: 'order', label: 'Topics' });
  assert.deepEqual(clientConfig(ok).collections[0].groups, { field: 'cluster', collection: 'clusters', order: 'order', label: 'Topics' });
  assert.equal(normalizeConfig({ collections: cols({ field: 'cluster', collection: 'clusters', order: 'order' }) }, '/tmp/x').collections[0].groups.label, 'Groups');
  // none: no key at all for the editor (the dev API's exact shapes stay as they were)
  const none = clientConfig(normalizeConfig({ collections: cols(undefined) }, '/tmp/x'));
  assert.equal('groups' in none.collections[0], false);
  assert.equal('groups' in none.collections[1], false);
  const bad = (g, re) => assert.throws(() => normalizeConfig({ collections: cols(g) }, '/tmp/x'), (e) => e instanceof ConfigError && re.test(e.message));
  bad('cluster', /groups must be \{field, collection, order, label\?\}/);
  bad({ field: 'topic', collection: 'clusters', order: 'order' }, /groups\.field must be the key of one of its settings/);
  bad({ collection: 'clusters', order: 'order' }, /groups\.field must be/);
  bad({ field: 'cluster', collection: 'topics', order: 'order' }, /groups\.collection names "topics", which is not a collection/);
  bad({ field: 'cluster', collection: 'posts', order: 'order' }, /groups\.collection must be another collection/);
  bad({ field: 'cluster', collection: 'clusters', order: 'the order' }, /groups\.order must be a key/);
  bad({ field: 'cluster', collection: 'clusters' }, /groups\.order must be a key/);
  bad({ field: 'cluster', collection: 'clusters', order: 'order', label: '  ' }, /groups\.label must be a word/);
});

test('groupIdOf: the group an entry names, by its groups field (dotted keys too); null without one', () => {
  const c = (field) => normalizeConfig({ collections: [{ id: 'posts', format: 'md', dir: 'p', settings: [{ type: 'select', key: field, label: 'T' }], groups: { field, collection: 'clusters', order: 'order' } }, { id: 'clusters', format: 'json', dir: 'c' }] }, '/tmp/x').collections[0];
  assert.equal(groupIdOf(c('cluster'), { data: { cluster: 'data-migration' } }), 'data-migration');
  assert.equal(groupIdOf(c('topic.id'), { data: { topic: { id: 'forms' } } }), 'forms');
  assert.equal(groupIdOf(c('cluster'), { data: { cluster: '' } }), null);
  assert.equal(groupIdOf(c('cluster'), { data: {} }), null);
  assert.equal(groupIdOf(normalizeConfig({ collections: [{ id: 'posts', format: 'md', dir: 'p' }] }, '/tmp/x').collections[0], { data: { cluster: 'x' } }), null);
});
