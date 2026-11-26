// The head kit's RSS feeds (src/head/feeds.mjs) over a throwaway project: live entries only (a draft, a protected page
// and a scheduled one are out), newest first, the limit, Markdown, MDX and JSON entries, authors, valid XML with
// everything escaped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { readFrontmatter } from '@markstage/core';
import { readHead } from '@markstage/core/head';
import { normalizeConfig } from '../src/config.mjs';
import { feedFiles } from '../src/head/feeds.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-feeds-')));
const dir = (...p) => path.join(root, ...p);
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(dir(rel)), { recursive: true });
  fs.writeFileSync(dir(rel), text);
};
const post = (front, body = 'Body.') => `---\n${front}\n---\n\n${body}\n`;
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
const siteUrl = 'https://example.com';
let cfg;

// A strict reader for the XML the kit writes: every tag closed in order, attributes quoted, only the five entities and
// numbered ones after "&", no "<" in text. Returns the tree {name, attrs, children, text}; throws on anything else.
function parseXml(xml) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n/, 'XML declaration first');
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = (s) => {
    assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(s), `a bare & in: ${s}`);
    return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => entities[n]);
  };
  const top = { name: '#top', attrs: {}, children: [], text: '' };
  const stack = [top];
  let i = xml.indexOf('?>') + 2;
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/y;
  while (i < xml.length) {
    if (xml[i] === '<') {
      tag.lastIndex = i;
      const m = tag.exec(xml);
      assert.ok(m, `a broken tag at ${i}: ${xml.slice(i, i + 40)}`);
      i = tag.lastIndex;
      if (m[1]) {
        const open = stack.pop();
        assert.equal(open.name, m[2], `</${m[2]}> closes <${open.name}>`);
      } else {
        const attrs = {};
        for (const a of m[3].matchAll(/([\w:.-]+)="([^"<]*)"/g)) attrs[a[1]] = decode(a[2]);
        const node = { name: m[2], attrs, children: [], text: '' };
        stack.at(-1).children.push(node);
        if (!m[4]) stack.push(node);
      }
    } else {
      const next = xml.indexOf('<', i);
      const t = xml.slice(i, next < 0 ? xml.length : next);
      if (t.trim()) stack.at(-1).text += decode(t);
      else assert.ok(/^\s*$/.test(t));
      i += t.length;
    }
  }
  assert.equal(stack.length, 1, 'every tag is closed');
  assert.equal(top.children.length, 1, 'one root');
  return top.children[0];
}
const kids = (n, name) => n.children.filter((c) => c.name === name);
const kid = (n, name) => kids(n, name)[0];
const rss = (xml) => {
  const r = parseXml(xml);
  assert.equal(r.name, 'rss');
  assert.equal(r.attrs.version, '2.0');
  return kid(r, 'channel');
};
const titles = (channel) => kids(channel, 'item').map((i) => kid(i, 'title').text);

const feed = (over = {}) => ({ id: 'blog', title: 'Example Co blog', description: '', path: '/rss.xml', collections: ['posts'], limit: 50, ...over });
const head = (...feeds) => readHead({ feeds }, { collections: ['posts', 'notes', 'guides', 'plain'] }).head;
const files = (h) => feedFiles(cfg, h, { siteUrl, readFrontmatter });

before(() => {
  write('src/content/authors/sam.json', json({ id: 'sam', name: 'Sam <Writer> & Co' }));
  write('src/content/authors/kim.json', json({ id: 'kim', name: 'Kim Example' }));
  // posts: Markdown with a status
  write('src/content/posts/oldest.md', post("title: Oldest post\ndate: '2026-01-05'\nexcerpt: The first words.\ntags: [news, tips]\nauthor: sam"));
  write('src/content/posts/middle.md', post("title: Rock & Roll <b>Basics</b>\ndate: '2026-03-10T09:30:00Z'\nexcerpt: 'Fish & chips, 2 < 3'\ntags: [news]\nauthor: kim\ncoAuthors: [sam]"));
  write('src/content/posts/newest.md', post("title: Newest post\ndate: '2026-06-01'\nauthor: nobody-here"));
  write('src/content/posts/a-draft.md', post("title: A draft\ndate: '2026-07-01'\ndraft: true"));
  write('src/content/posts/later.md', post("title: Scheduled for later\ndate: '2026-08-01'\npublishAt: '2999-01-01T00:00:00Z'"));
  write('src/content/posts/was-scheduled.md', post("title: Scheduled and now live\ndate: '2026-02-01'\npublishAt: '2026-02-01T00:00:00Z'"));
  write('src/content/posts/secret.md', post("title: Protected page\ndate: '2026-07-02'\nprotected: true"));
  write('src/content/posts/no-date.md', post('title: No date at all'));
  write('src/content/posts/Not_An_Id.md', post("title: Bad file name\ndate: '2026-07-03'"));
  write('src/content/posts/readme.txt', 'not an entry');
  // notes: JSON entries, no status; one broken file
  write('src/content/notes/first-note.json', json({ title: 'A note', date: '2026-04-01', excerpt: 'Short note.', tags: ['notes'] }));
  write('src/content/notes/draft-note.json', json({ title: 'Note draft', date: '2026-04-02', draft: true }));
  write('src/content/notes/broken.json', '{ not json');
  // guides: MDX
  write('src/content/guides/how-to.mdx', post("title: How to\ndate: '2026-05-01'\nexcerpt: Steps.", "import X from './x.astro'\n\n<X />"));
  // a collection with no page address
  write('src/content/plain/hidden.md', post("title: Has no page\ndate: '2026-05-05'"));
  cfg = normalizeConfig(
    {
      siteName: 'Example Co',
      siteUrl,
      authors: { coAuthors: 'coAuthors' },
      collections: [
        { id: 'posts', format: 'md', dir: 'src/content/posts', hasStatus: true, url: '/posts/{id}/' },
        { id: 'notes', format: 'json', dir: 'src/content/notes', url: '/notes/{id}/' },
        { id: 'guides', format: 'mdx', dir: 'src/content/guides', url: '/guides/{id}/' },
        { id: 'plain', format: 'md', dir: 'src/content/plain' },
      ],
    },
    root,
  );
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('no feeds in the settings, no files', async () => {
  assert.deepEqual(await files(head()), []);
});

test('live entries only: a draft, a protected page, a scheduled one and a bad file name are out', async () => {
  const [f] = await files(head(feed()));
  assert.equal(f.path, '/rss.xml');
  assert.equal(f.title, 'Example Co blog');
  const t = titles(rss(f.text));
  assert.deepEqual(t, ['Newest post', 'Rock & Roll <b>Basics</b>', 'Scheduled and now live', 'Oldest post', 'No date at all']);
  for (const hidden of ['A draft', 'Scheduled for later', 'Protected page', 'Bad file name']) assert.ok(!t.includes(hidden), hidden);
});

test('newest first by the date field; an entry with no date goes last; a tie keeps a fixed order', async () => {
  write('src/content/posts/tie-b.md', post("title: Tie B\ndate: '2026-06-01'"));
  write('src/content/posts/tie-a.md', post("title: Tie A\ndate: '2026-06-01'"));
  try {
    const t = titles(rss((await files(head(feed())))[0].text));
    // all three share 2026-06-01: ordered by link (newest, tie-a, tie-b)
    assert.deepEqual(t.slice(0, 3), ['Newest post', 'Tie A', 'Tie B']);
    assert.equal(t.at(-1), 'No date at all');
  } finally {
    fs.rmSync(dir('src/content/posts/tie-a.md'));
    fs.rmSync(dir('src/content/posts/tie-b.md'));
  }
});

test('limit keeps the newest entries', async () => {
  const t = titles(rss((await files(head(feed({ limit: 2 }))))[0].text));
  assert.deepEqual(t, ['Newest post', 'Rock & Roll <b>Basics</b>']);
});

test('an item: link and guid from the url template, RFC 822 date, excerpt, tags, authors', async () => {
  const channel = rss((await files(head(feed())))[0].text);
  const item = kids(channel, 'item').find((i) => kid(i, 'title').text.startsWith('Rock'));
  assert.equal(kid(item, 'link').text, 'https://example.com/posts/middle/');
  assert.equal(kid(item, 'guid').text, 'https://example.com/posts/middle/');
  assert.equal(kid(item, 'guid').attrs.isPermaLink, 'true');
  assert.equal(kid(item, 'pubDate').text, 'Tue, 10 Mar 2026 09:30:00 GMT');
  assert.equal(kid(item, 'description').text, 'Fish & chips, 2 < 3');
  assert.deepEqual(kids(item, 'category').map((c) => c.text), ['news']);
  // the author, then the co-author, by name from their author files
  assert.deepEqual(kids(item, 'dc:creator').map((c) => c.text), ['Kim Example', 'Sam <Writer> & Co']);
  const oldest = kids(channel, 'item').find((i) => kid(i, 'title').text === 'Oldest post');
  assert.deepEqual(kids(oldest, 'category').map((c) => c.text), ['news', 'tips']);
  assert.equal(kid(oldest, 'pubDate').text, 'Mon, 05 Jan 2026 00:00:00 GMT');
});

test('an author the site does not know, and an entry with no excerpt or date, leave those tags out', async () => {
  const channel = rss((await files(head(feed())))[0].text);
  const newest = kids(channel, 'item').find((i) => kid(i, 'title').text === 'Newest post');
  assert.equal(kid(newest, 'dc:creator'), undefined);
  assert.equal(kid(newest, 'description'), undefined);
  const none = kids(channel, 'item').find((i) => kid(i, 'title').text === 'No date at all');
  assert.equal(kid(none, 'pubDate'), undefined);
});

test('the channel: title, home page link, description (the feed’s own, else the site name), a link to itself', async () => {
  const [a] = await files(head(feed()));
  const channel = rss(a.text);
  assert.equal(kid(channel, 'title').text, 'Example Co blog');
  assert.equal(kid(channel, 'link').text, 'https://example.com/');
  assert.equal(kid(channel, 'description').text, 'Example Co');
  const self = kid(channel, 'atom:link');
  assert.deepEqual(self.attrs, { href: 'https://example.com/rss.xml', rel: 'self', type: 'application/rss+xml' });
  assert.equal(kid(channel, 'lastBuildDate').text, 'Mon, 01 Jun 2026 00:00:00 GMT');
  const [b] = await files(head(feed({ description: 'News & notes' })));
  assert.equal(kid(rss(b.text), 'description').text, 'News & notes');
});

test('JSON and MDX entries, many collections in one feed, a collection with no page address left out', async () => {
  const [f] = await files(head(feed({ collections: ['notes', 'guides', 'plain'], path: '/all/rss.xml' })));
  assert.equal(f.path, '/all/rss.xml');
  const channel = rss(f.text);
  assert.deepEqual(titles(channel), ['How to', 'A note']);
  assert.deepEqual(kids(channel, 'item').map((i) => kid(i, 'link').text), ['https://example.com/guides/how-to/', 'https://example.com/notes/first-note/']);
  assert.equal(kid(kids(channel, 'item')[1], 'description').text, 'Short note.');
  assert.deepEqual(kids(kids(channel, 'item')[1], 'category').map((c) => c.text), ['notes']);
});

test('two feeds from one call, each its own file; no entries gives a valid empty feed', async () => {
  const out = await files(head(feed(), feed({ id: 'plain', title: 'Plain', path: '/plain.xml', collections: ['plain'] })));
  assert.deepEqual(out.map((f) => f.path), ['/rss.xml', '/plain.xml']);
  assert.deepEqual(kids(rss(out[1].text), 'item'), []);
});

test('XML is well formed and escaped: & < > quotes in titles, descriptions and tags; control characters dropped', async () => {
  write('src/content/posts/odd.md', post(`title: "He said \\"Fish & Chips\\" <now> ]]> it's \\x07 here"\ndate: '2026-09-01'\nexcerpt: 'a & b < c > d'\ntags: ['R&D', "<script>"]`));
  try {
    const [f] = await files(head(feed()));
    assert.ok(!f.text.includes('<now>') && !f.text.includes('<script>'));
    assert.ok(f.text.includes('Fish &amp; Chips'));
    assert.ok(!f.text.includes('\x07'));
    const first = kids(rss(f.text), 'item')[0];
    assert.equal(kid(first, 'title').text, 'He said "Fish & Chips" <now> ]]> it\'s  here');
    assert.equal(kid(first, 'description').text, 'a & b < c > d');
    assert.deepEqual(kids(first, 'category').map((c) => c.text), ['R&D', '<script>']);
  } finally {
    fs.rmSync(dir('src/content/posts/odd.md'));
  }
});

test('the same entries give the same file (nothing depends on the clock)', async () => {
  const a = (await files(head(feed())))[0].text;
  const b = (await files(head(feed())))[0].text;
  assert.equal(a, b);
});

test('a preview build lists every entry, as the site does', async () => {
  process.env.MARKSTAGE_PREVIEW = '1';
  try {
    const t = titles(rss((await files(head(feed())))[0].text));
    assert.ok(t.includes('A draft') && t.includes('Protected page') && t.includes('Scheduled for later'));
  } finally {
    delete process.env.MARKSTAGE_PREVIEW;
  }
});
