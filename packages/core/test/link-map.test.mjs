// Topics and the link map (@markstage/core/topics, /link-map, /link-suggest): the config, topic files, placing a page,
// the body links of a page (never the cards), the map with its links in and out, what the Health screen finds, the
// suggestions both ways with the sentence and the words, and the document edits that apply them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConverter } from '@markstage/core';
import { buildLinkMap, entryText, hrefKind, isGeneric, linkFindings, normAnchor, sentenceAt } from '@markstage/core/link-map';
import { incomingSuggestions, linkInbox, linkWords, outgoingSuggestions, phrasesOf, setLinkAt, shortTitle } from '@markstage/core/link-suggest';
import { placePage, refOf, topicData, topicMap, topicOf, topicProblems, topicsConfigOf } from '@markstage/core/topics';
import { normalizeConfig, clientConfig } from '@markstage/core/site-config';

const md = createConverter();
const COLLS = [
  { id: 'posts', hasUrl: true },
  { id: 'pages', hasUrl: true },
];
const cfg = topicsConfigOf({ money: ['/services/'], follow: ['docs.example.com'], sponsored: ['shop.example.com'] }, { collections: COLLS });

test('config: defaults, money by path and by type, the lists, mistakes in plain words', () => {
  assert.equal(topicsConfigOf(undefined), null);
  const d = topicsConfigOf(true, { collections: COLLS });
  assert.equal(d.dir, 'markstage/topics');
  assert.deepEqual(d.collections, ['posts', 'pages']);
  assert.equal(d.enough, 3);
  assert.deepEqual(cfg.money, { pageTypes: [], paths: ['/services/'] });
  assert.deepEqual(cfg.follow, ['docs.example.com']);
  const fail = (m) => {
    throw new Error(m);
  };
  assert.throws(() => topicsConfigOf({ dir: '../x' }, { collections: COLLS, fail }), /inside the project/);
  assert.throws(() => topicsConfigOf({ collections: ['nope'] }, { collections: COLLS, fail }), /names collections/);
  assert.throws(() => topicsConfigOf({ money: ['service'] }, { collections: COLLS, pageTypes: { types: [{ id: 'money' }] }, fail }), /not a page type/);
  assert.throws(() => topicsConfigOf({ follow: ['not a domain'] }, { collections: COLLS, fail }), /lists domains/);
  // the site's own finder: a command, no shell
  assert.equal(d.related, null);
  assert.deepEqual(topicsConfigOf({ related: { command: ['node', 'scripts/related.mjs'] } }, { collections: COLLS }).related, { command: ['node', 'scripts/related.mjs'], timeoutSeconds: 20 });
  assert.throws(() => topicsConfigOf({ related: 'node related.mjs' }, { collections: COLLS, fail }), /argv, no shell/);
  const site = normalizeConfig({ collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', url: '/posts/{slug}/' }], topics: true }, '/tmp/site');
  assert.equal(site.topics.absDir, '/tmp/site/markstage/topics');
  assert.deepEqual(clientConfig(site).topics.collections, ['posts']);
});

test('topic files: normalized, written back in a stable shape, one topic per page, placing a page moves it', () => {
  assert.equal(refOf('posts/a'), 'posts/a');
  assert.equal(refOf('posts/'), null);
  assert.equal(refOf('../x'), null);
  const t = topicOf('editing', { title: 'Editing', pillar: 'posts/guide', groups: [{ name: 'Canvas', lead: 'posts/canvas', members: ['posts/a', 'posts/a', 'bad ref'] }, { name: 'Canvas' }] });
  assert.deepEqual(t.groups.map((g) => g.id), ['canvas', 'canvas-2']);
  assert.deepEqual(t.groups[0].members, ['posts/a']);
  assert.deepEqual(Object.keys(topicData(t)), ['title', 'pillar', 'money', 'anchors', 'keywords', 'members', 'groups']);
  const other = topicOf('seo', { title: 'SEO', members: ['posts/a'] });
  assert.match(topicProblems(t, { others: [other] })['groups.canvas'], /in the topic “SEO” already/);
  assert.match(topicProblems({ ...t, title: '' }).title, /name/);
  assert.match(topicProblems(t, { known: (r) => r !== 'posts/guide' }).pillar, /not a page/);
  // placing: out of SEO, into Editing's ungrouped pages; then made the lead of Canvas (the old lead stays a member)
  let { changed, from } = placePage([t, other], 'posts/a', { topic: 'editing' });
  assert.deepEqual(from, { topic: 'editing', group: 'canvas', role: 'member' });
  const ed = changed.find((x) => x.id === 'editing');
  assert.deepEqual(ed.members, ['posts/a']);
  assert.deepEqual(ed.groups[0].members, []);
  assert.deepEqual(changed.find((x) => x.id === 'seo').members, []);
  ({ changed } = placePage([ed], 'posts/a', { topic: 'editing', group: 'canvas', role: 'lead' }));
  assert.equal(changed[0].groups[0].lead, 'posts/a');
  assert.deepEqual(changed[0].groups[0].members, ['posts/canvas']);
  assert.equal(topicMap(changed).get('posts/a').role, 'lead');
  assert.throws(() => placePage([t], 'posts/x', { topic: 'nope' }), /no topic/);
  // out of every topic
  assert.deepEqual(placePage([t], 'posts/guide', { topic: null }).changed[0].pillar, null);
});

const doc = (text) => md.mdToDoc(`---\ntitle: x\n---\n${text}`).doc;

test('body links: anchors, sentences, sections, rel; HTML links; JSON pages only from their text, never cards', () => {
  const d = doc('Intro text here.\n\n## Setup\n\nFirst sentence. Read the [complete editing guide](/posts/guide/) before you start. Last one.\n\n- A list item with [an outside link](https://shop.example.com/x) in it.\n\n<p>Raw <a href="/posts/raw/" rel="nofollow">raw words</a> here.</p>\n');
  const { links, blocks } = entryText({ format: 'md', doc: d });
  assert.equal(links.length, 3);
  assert.deepEqual({ href: links[0].href, anchor: links[0].anchor, section: links[0].section }, { href: '/posts/guide/', anchor: 'complete editing guide', section: 'Setup' });
  assert.equal(links[0].sentence, 'Read the complete editing guide before you start.');
  assert.equal(links[2].rel, 'nofollow');
  assert.equal(links[2].start, null);
  assert.ok(blocks.some((b) => b.kind === 'heading' && b.text === 'Setup'));
  const json = entryText({ format: 'json', data: { sections: [{ type: 'cta', href: '/contact/', text: '<p>See <a href="/posts/guide/">the guide</a>.</p>' }] } });
  assert.deepEqual(json.links.map((l) => [l.href, l.anchor]), [['/posts/guide/', 'the guide']]);
  // a JSON page's link keeps the sentence it is in (not the start of the text) and the heading of its part
  const long = entryText({ format: 'json', data: { title: 'Page', sections: [{ heading: 'When to move', body: '<p>Moving is not always the answer. Stay put if you must.</p><ul><li>Book <a href="/data-migration/">our data migration service</a> today.</li></ul>' }] } });
  assert.equal(long.links[0].sentence, 'Book our data migration service today.');
  assert.equal(long.links[0].section, 'When to move');
  assert.equal(normAnchor('  Read More →'), 'read more');
  assert.ok(isGeneric('Click here'));
  assert.ok(isGeneric('Source'));
  assert.ok(!isGeneric('editing guide'));
  assert.deepEqual(hrefKind('https://www.example.com/a/', 'https://www.example.com'), { kind: 'internal', path: '/a/' });
  assert.equal(hrefKind('https://www.docs.example.com/x').domain, 'docs.example.com');
  assert.equal(hrefKind('mailto:a@example.com').kind, 'other');
  assert.equal(sentenceAt('One. Two words here. Three.', 5, 8), 'Two words here.');
});

/** A small site: a guide (main page), a lead, members, a service page, a stray page; texts given in Markdown. */
function site(extra = {}) {
  const texts = {
    'posts/guide': ['The editing guide', '/posts/guide/', 'Everything about editing. Start with [canvas basics](/posts/canvas/) and the [source mode tips](/posts/source/).'],
    'posts/canvas': ['Canvas basics', '/posts/canvas/', 'The canvas shows the page. Read the [editing guide](/posts/guide/) first.'],
    'posts/source': ['Source mode tips', '/posts/source/', 'Source mode shows Markdown. [Click here](/posts/canvas/) for the canvas. See [old page](/old/) too and [docs](https://docs.example.com/a) and [a shop](https://shop.example.com/b) and [a blog](https://blog.example.org/c).'],
    'posts/shortcuts': ['Keyboard shortcuts for editors', '/posts/shortcuts/', 'Shortcuts save time when you edit every day on the canvas.'],
    'posts/stray': ['A stray note', '/posts/stray/', 'This page talks about keyboard shortcuts for editors and about source mode tips in passing, at some length here.'],
    'pages/services': ['Editing services', '/services/', 'We help with editing.'],
    'posts/draft': ['A draft', '/posts/draft/', 'A draft links to [the guide](/posts/guide/).'],
    ...extra,
  };
  const pages = Object.entries(texts).map(([ref, [title, url, body]]) => {
    const { links, blocks } = entryText({ format: 'md', doc: doc(body) });
    return { ref, title, url, live: ref !== 'posts/draft', noindex: false, type: null, keywords: [], format: 'md', links, blocks };
  });
  const topic = topicOf('editing', { title: 'Editing', pillar: 'posts/guide', money: 'pages/services', anchors: ['editing guide'], groups: [{ name: 'Modes', lead: 'posts/canvas', members: ['posts/source', 'posts/shortcuts'] }] });
  return buildLinkMap({ pages, topics: [topic], redirects: [{ from: '/old/', to: '/posts/guide/' }], cfg, siteUrl: 'https://www.example.com' });
}

test('the map: links in from live pages only, out, anchors per page, redirects resolved', () => {
  const m = site();
  assert.equal(m.pages.get('posts/guide').in, 2); // canvas and source (old address); the draft does not count
  assert.equal(m.pages.get('posts/canvas').in, 2);
  assert.equal(m.pages.get('posts/shortcuts').in, 0);
  assert.equal(m.pages.get('posts/source').out, 2);
  assert.equal(m.pages.get('posts/source').external, 3);
  assert.equal(m.pages.get('pages/services').money, true);
  assert.deepEqual([...m.anchors.get('editing guide')], [['posts/guide', 1]]);
  assert.equal(m.edges.find((e) => e.address === '/old/').status, 'redirect');
});

test('findings: no links in, weak, no link up, vague words, words for two pages, redirects, outside links; fixes', () => {
  const m = site({ 'posts/clash': ['Clash', '/posts/clash/', 'One [editing guide](/posts/canvas/) link that names another page.'] });
  const f = linkFindings(m);
  const of = (kind, ref) => f.find((x) => x.kind === kind && x.ref === ref);
  assert.ok(of('no-links-in', 'posts/shortcuts'));
  assert.equal(of('no-links-in', 'posts/shortcuts').fix.kind, 'suggest-in');
  assert.ok(of('no-links-in', 'posts/source') === undefined && of('weak', 'posts/source'));
  assert.equal(of('no-pillar-link', 'posts/shortcuts').fix.to, 'posts/guide');
  assert.ok(of('no-lead-link', 'posts/shortcuts'));
  assert.ok(of('not-in-topic', 'posts/stray'));
  assert.match(of('generic-anchor', 'posts/source').message, /does not say where/);
  assert.equal(of('to-redirect', 'posts/source').fix.href, '/posts/guide/');
  assert.equal(of('outside-sponsored', 'posts/source').fix.rel, 'sponsored');
  assert.equal(of('outside-follow', 'posts/source').href, 'https://blog.example.org/c');
  assert.equal(f.filter((x) => x.kind === 'outside-follow').length, 1); // the docs site is on the allowlist
  assert.equal(f.filter((x) => x.kind === 'anchor-clash').length, 2);
  assert.ok(f.every((x) => /^lf_[0-9a-z]+$/.test(x.id)));
  assert.equal(new Set(f.map((x) => x.id)).size, f.length);
  // a JSON page's link has a string path (its field), not a list: findings still work
  const json = entryText({ format: 'json', data: { sections: [{ text: '<p><a href="/posts/guide/">Click here</a>.</p>' }] } });
  const withJson = buildLinkMap({ pages: [{ ref: 'pages/about', title: 'About', url: '/about/', live: true, noindex: false, type: null, keywords: [], format: 'json', ...json }], topics: [], cfg });
  assert.ok(linkFindings(withJson).some((x) => x.kind === 'generic-anchor' && x.ref === 'pages/about'));
  // a page hidden from search engines (a thank-you page) is never asked for links in
  const hidden = site({ 'pages/thanks': ['Thanks', '/thanks/', 'Thanks for writing.'] });
  hidden.pages.get('pages/thanks').noindex = true;
  assert.ok(linkFindings(hidden).every((x) => x.ref !== 'pages/thanks' || !['no-links-in', 'weak'].includes(x.kind)));
  assert.ok(of('no-links-in', 'posts/shortcuts')); // a shown page still is
  // a topic that names a gone page
  const gone = buildLinkMap({ pages: [], topics: [topicOf('t', { title: 'T', pillar: 'posts/none' })], cfg });
  assert.equal(linkFindings(gone)[0].kind, 'missing-page');
  // a service-page address with articles under it: one note for the address, naming them
  assert.equal(f.filter((x) => x.kind === 'money-path-wide').length, 0);
  const wide = linkFindings(site({ 'posts/under': ['Under', '/services/how-we-work/', 'An article under the service address.'] })).filter((x) => x.kind === 'money-path-wide');
  assert.equal(wide.length, 1);
  assert.equal(wide[0].ref, 'pages/services');
  assert.match(wide[0].message, /\/services\/ \(site config topics\.money\) also covers the page under it, such as “Under”/);
});

test('suggestions out: main page, lead, service page, pages next to it, with the sentence or "add one"', () => {
  const m = site();
  assert.equal(shortTitle('How to Edit Pages: A Complete Guide (2026)'), 'Edit Pages');
  assert.ok(phrasesOf(m, 'posts/guide').some((p) => p.norm === 'editing guide' && p.strong));
  const out = outgoingSuggestions(m, 'posts/shortcuts');
  assert.deepEqual(out.map((s) => s.to), ['posts/guide', 'posts/canvas', 'pages/services', 'posts/source']);
  const lead = out.find((s) => s.to === 'posts/canvas');
  assert.equal(lead.how, 'add'); // "canvas basics" is not in the text
  assert.equal(lead.anchor, 'Canvas basics');
  const fromStray = outgoingSuggestions(site({ 'posts/stray': ['A stray note', '/posts/stray/', 'Nothing.'] }), 'posts/source');
  assert.deepEqual(fromStray.map((s) => s.to), ['pages/services', 'posts/shortcuts']);
  // the guide lists its group lead (linked already) and the service page
  assert.deepEqual(outgoingSuggestions(m, 'posts/guide').map((s) => s.to), ['pages/services']);
});

test('suggestions in: sentences on other pages that name the page, closest first; skipped ones stay away', () => {
  const m = site();
  const sg = incomingSuggestions(m, 'posts/shortcuts');
  assert.equal(sg.length, 1);
  assert.equal(sg[0].from, 'posts/stray');
  assert.equal(sg[0].anchor, 'keyboard shortcuts for editors');
  assert.equal(sg[0].sentence.slice(sg[0].at, sg[0].at + sg[0].anchor.length), sg[0].anchor);
  assert.equal(sg[0].how, 'link');
  assert.deepEqual(incomingSuggestions(m, 'posts/shortcuts', { skipped: new Set([sg[0].id]) }), []);
  // the same suggestion keeps its id while the pages do not change
  assert.equal(incomingSuggestions(site(), 'posts/shortcuts')[0].id, sg[0].id);
  const inbox = linkInbox(m);
  assert.ok(inbox.items.some((s) => s.id === sg[0].id));
  assert.equal(inbox.counts.total, inbox.items.length);
});

test('applying: the words get a link (only if they are still there), a link gets a new address or rel', () => {
  const m = site();
  const sg = incomingSuggestions(m, 'posts/shortcuts')[0];
  const d = doc('This page talks about keyboard shortcuts for editors and about source mode tips in passing, at some length here.');
  const next = linkWords(d, { path: sg.path, start: sg.start, end: sg.end, expect: sg.anchor, href: '/posts/shortcuts/' });
  assert.match(md.docToMd(next, '---\ntitle: x\n---\n'), /\[keyboard shortcuts for editors\]\(\/posts\/shortcuts\/\)/);
  assert.equal(linkWords(d, { path: sg.path, start: sg.start, end: sg.end, expect: 'other words', href: '/x/' }), null);
  assert.equal(linkWords(next, { path: sg.path, start: sg.start, end: sg.end, expect: sg.anchor, href: '/x/' }), null);
  const withLink = doc('See [old page](/old/) now.');
  const moved = setLinkAt(withLink, { path: [0], start: 4, end: 12, href: '/posts/guide/' });
  assert.match(md.docToMd(moved, ''), /\[old page\]\(\/posts\/guide\/\)/);
  const rel = setLinkAt(withLink, { path: [0], start: 4, end: 12, rel: 'nofollow' });
  assert.match(md.docToMd(rel, ''), /<a href="\/old\/" rel="nofollow">old page<\/a>/);
  assert.equal(setLinkAt(withLink, { path: [0], start: 0, end: 3, rel: 'nofollow' }), null);
});
