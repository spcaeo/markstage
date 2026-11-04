// Page frames and types in `astro dev` and in the site's build (docs/API-PAGE-TYPES.md), on a throwaway project: the
// check every entry save makes (a frame or type that is not the site's refused, an old one left alone), a new post
// by its type, the type's checks of one entry (page-checks), the build's check, and the helpers the site's layout
// uses (frameOf, pageTypeOf, frames, pageTypes).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createConverter, readFrontmatter, setFrontmatter } from '@markstage/core';
import { devApi } from '../src/api.mjs';
import { normalizeConfig } from '../src/config.mjs';
import { checkPages } from '../src/index.mjs';
import { pagesOf } from '../src/pages.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-pages-')));
const posts = path.join(root, 'src/content/posts');
const pages = path.join(root, 'src/content/pages');
const write = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text);
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
let cfg;
let server;
let base;
let origin;

before(async () => {
  fs.mkdirSync(posts, { recursive: true });
  fs.mkdirSync(pages, { recursive: true });
  write(posts, 'guide.md', "---\ntitle: Guide\npageType: article\ncluster: moving\ndate: '2026-01-01'\n---\n\nSee [the hub](/moving/) and [our service](https://example.com/services/).\n");
  write(posts, 'lonely.md', "---\ntitle: Lonely\npageType: article\ndate: '2026-01-02'\n---\n\nNo links.\n");
  write(posts, 'odd.md', "---\ntitle: Odd\nframe: wide\ndate: '2026-01-03'\n---\n\nAn old frame.\n");
  write(pages, 'moving.json', json({ title: 'Moving', pageType: 'pillar', cluster: 'moving' }));
  write(pages, 'services.json', json({ title: 'Services', pageType: 'money', sections: [{ discriminant: 'booking', value: {} }], schema: { '@type': 'Service' } }));
  cfg = normalizeConfig(
    {
      siteUrl: 'https://example.com',
      frames: true,
      collections: [
        { id: 'posts', format: 'md', dir: 'src/content/posts', hasStatus: true, url: '/posts/{id}/', frame: 'reading' },
        { id: 'pages', format: 'json', dir: 'src/content/pages', url: '/{id}/', frame: 'full' },
      ],
      pageTypes: {
        types: [
          { id: 'money', label: 'Money page', collections: ['pages'], frame: 'full', checks: [{ label: 'A booking button', section: 'booking', level: 'block' }, { label: 'Service structured data', jsonld: 'Service' }] },
          { id: 'pillar', label: 'Pillar page', collections: ['pages'], frame: 'reading' },
          { id: 'article', label: 'Article', collections: ['posts'], checks: [{ id: 'hub', label: 'Links to its hub', linksTo: { pageType: 'pillar', sameField: 'cluster' } }, { id: 'money', label: 'Links to a money page', linksTo: 'money' }] },
        ],
      },
    },
    root,
  );
  const api = devApi(cfg, async () => ({ md: createConverter(), readFrontmatter, setFrontmatter }), { error() {} });
  server = http.createServer((req, res) => api(req, res, () => ((res.statusCode = 404), res.end())));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  base = `${origin}/markstage/api`;
});
after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const get = async (p) => {
  const r = await fetch(`${base}/${p}`);
  return { status: r.status, json: await r.json() };
};
const send = async (method, p, body) => {
  const r = await fetch(`${base}/${p}`, { method, headers: { 'Content-Type': 'application/json', Origin: origin }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

test('a save: a frame or type that is not the site’s is refused; an old one left alone', async () => {
  const g = await get('collections/posts/entries/lonely');
  const bad = await send('PUT', 'collections/posts/entries/lonely', { version: g.json.version, frontmatter: { frame: 'wide' } });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, 'invalid-page');
  assert.match(bad.json.message, /“wide” is not a frame of this site/);
  const type = await send('PUT', 'collections/posts/entries/lonely', { version: g.json.version, frontmatter: { pageType: 'money' } });
  assert.match(type.json.message, /“money” is not a page type here\. Pick one of: Article\./);
  const odd = await get('collections/posts/entries/odd');
  assert.equal((await send('PUT', 'collections/posts/entries/odd', { version: odd.json.version, frontmatter: { title: 'Still odd' } })).status, 200);
  // a JSON page through its changes
  const p = await get('collections/pages/entries/moving');
  const j = await send('PUT', 'collections/pages/entries/moving', { version: p.json.version, changes: [{ op: 'set', path: 'pageType', value: 'nope' }] });
  assert.equal(j.status, 422);
});

test('a new post by its type has the type set', async () => {
  const r = await send('POST', 'collections/posts/entries', { title: 'Fresh one', pageType: 'article' });
  assert.equal(r.status, 201);
  assert.match(fs.readFileSync(path.join(posts, 'fresh-one.md'), 'utf8'), /\npageType: article\n/);
  assert.equal((await send('POST', 'collections/posts/entries', { title: 'Wrong', pageType: 'pillar' })).status, 422);
});

test('page-checks: links to its hub and a money page (the site address counts), what is missing', async () => {
  const g = (await get('collections/posts/entries/guide/page-checks')).json;
  assert.deepEqual(g.type, { id: 'article', label: 'Article' });
  assert.deepEqual([g.frame.id, g.frame.from], ['reading', 'collection']);
  assert.deepEqual(g.checks.map((k) => [k.id, k.ok]), [['hub', true], ['money', true]]);
  const l = (await get('collections/posts/entries/lonely/page-checks')).json;
  assert.deepEqual(l.checks.map((k) => k.message), ['Set “cluster” first, then link to a pillar page with the same one.', 'Link to a money page from the text.']);
  const s = (await get('collections/pages/entries/services/page-checks')).json;
  assert.deepEqual(s.checks.map((k) => k.ok), [true, true]);
  const none = (await get('collections/posts/entries/odd/page-checks')).json;
  assert.deepEqual([none.type, none.frame.id, none.checks], [null, 'reading', []]);
});

test('the build stops on a frame or type the site does not have, naming the file', () => {
  assert.throws(() => checkPages(cfg), /markstage: an entry has a frame or page type the site does not have:\n {2}src\/content\/posts\/odd\.md: “wide” is not a frame/);
  fs.rmSync(path.join(posts, 'odd.md'));
  assert.doesNotThrow(() => checkPages(cfg));
});

test('the layout’s helpers: the frame and type of an entry, the lists', () => {
  const h = pagesOf(cfg);
  assert.deepEqual(h.frames().map((f) => f.id), ['full', 'reading', 'plain']);
  assert.deepEqual(h.pageTypes().map((t) => [t.id, t.frame]), [['money', 'full'], ['pillar', 'reading'], ['article', null]]);
  assert.deepEqual(((f) => [f.id, f.from])(h.frameOf('pages', { pageType: 'pillar' })), ['reading', 'type']);
  assert.deepEqual(((f) => [f.id, f.from])(h.frameOf('pages', {})), ['full', 'collection']);
  assert.deepEqual(((f) => [f.id, f.from])(h.frameOf('posts', { frame: 'plain' })), ['plain', 'page']);
  assert.equal(h.pageTypeOf('pages', { pageType: 'money' }).label, 'Money page');
  assert.equal(h.pageTypeOf('posts', { pageType: 'money' }), null);
  assert.equal(h.frameOf('nope', {}), null);
  assert.deepEqual([pagesOf(null).frames(), pagesOf(null).pageTypes()], [[], []]);
});
