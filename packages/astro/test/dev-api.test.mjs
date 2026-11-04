// The dev API on a throwaway project: list, read, save with the version check (409), source, download, import, and
// the loopback / Origin guards.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createConverter, readFrontmatter, setFrontmatter } from '@markstage/core';
import { devApi } from '../src/api.mjs';
import { clientConfig, fillTemplate, normalizeConfig } from '../src/config.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-dev-')));
const dir = path.join(root, 'src/content/posts');
const POST = '---\ntitle: First post\ndate: 2026-10-01\n---\n\nHello **world**.\n\nSecond paragraph.\n';
let server;
let base;
let origin;

before(async () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'first-post.md'), POST);
  fs.writeFileSync(path.join(dir, 'a-draft.md'), '---\ntitle: Draft\ndraft: true\n---\n\nSoon.\n');
  const cfg = normalizeConfig(
    {
      siteName: 'Test',
      collections: [{ id: 'posts', format: 'md', dir: 'src/content/posts', hasStatus: true, url: '/posts/{id}/', group: ({ data }) => (data.draft ? 'Drafts' : 'Live') }],
      locales: [{ code: 'en-CA', prefix: '' }, { code: 'en-US', prefix: '/en-us' }],
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

const get = (p, headers = {}) => fetch(`${base}/${p}`, { headers });
const send = (method, p, body, headers = { Origin: origin }) =>
  fetch(`${base}/${p}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('config: templates, client config without functions or paths', () => {
  assert.equal(fillTemplate('/blog/{id}/{slug}/', { id: 'a', data: { slug: 'b' } }), '/blog/a/b/');
  const cfg = normalizeConfig({ collections: [{ id: 'posts', format: 'md', dir: 'posts', url: () => '/x/' }] }, root);
  const client = clientConfig(cfg);
  assert.equal(client.api, '/markstage/api/');
  const { settings, ...rest } = client.collections[0];
  assert.deepEqual(rest, { id: 'posts', label: 'posts', format: 'md', dir: 'posts', hasUrl: true, titleKey: 'title', newEntry: { ask: [] }, required: ['title'], linkKeys: {} });
  assert.deepEqual(
    settings.map((f) => [f.type, f.key]),
    [['textarea', 'excerpt'], ['tags', 'tags'], ['text', 'author'], ['date', 'date']],
  );
  assert.equal(client.media.url, '/src/assets/uploads/');
  assert.equal(normalizeConfig({ collections: [] }, root, { site: 'https://example.com/' }).siteUrl, 'https://example.com');
  const links = normalizeConfig({ collections: [], editor: { links: { special: [{ href: 'https://cal.example/x', label: 'Book' }], popup: { selector: 'a[href*="cal.example"]' } } } }, root).editor.links;
  assert.deepEqual(links.special, [{ href: 'https://cal.example/x', label: 'Book' }]);
  assert.equal(links.popup.note, 'Opens a popup on the site');
  assert.throws(() => normalizeConfig({ collections: [{ id: 'p', format: 'md', dir: 'p', settings: [{ type: 'seo', title: 'seo.title' }] }] }, root), /description must be/);
  assert.throws(() => normalizeConfig({ collections: [{ id: 'p', format: 'md', dir: 'p', settings: [{ type: 'colour', key: 'x' }] }] }, root), /type must be/);
  assert.throws(() => normalizeConfig({ collections: [{ id: 'posts', format: 'md', dir: '../outside' }] }, root), /inside the project/);
  assert.throws(() => normalizeConfig({ collections: [{ id: 'Posts', format: 'md', dir: 'p' }] }, root), /collection id/);
});

test('collections and the entry list (status, group, search, sort)', async () => {
  const cols = await (await get('collections')).json();
  assert.deepEqual(cols[0].counts, { all: 2, draft: 1, scheduled: 0, published: 1, trash: 0 });
  const list = await (await get('collections/posts/entries?sort=title')).json();
  assert.deepEqual(list.items.map((i) => [i.id, i.status, i.group, i.url]), [
    ['a-draft', 'draft', 'Drafts', '/posts/a-draft/'],
    ['first-post', 'published', 'Live', '/posts/first-post/'],
  ]);
  const found = await (await get('collections/posts/entries?q=first')).json();
  assert.equal(found.total, 1);
  assert.equal((await get('collections/posts/entries?sort=nope')).status, 400);
});

test('the light index: every entry of every collection in one answer, light rows only', async () => {
  const r = await get('index');
  assert.equal(r.status, 200);
  const { items } = await r.json();
  const post = items.find((i) => i.id === 'first-post');
  assert.deepEqual(Object.keys(post).sort(), ['collection', 'group', 'id', 'modified', 'status', 'title', 'url']);
  assert.equal(post.collection, 'posts');
  assert.equal(post.status, 'published');
  assert.equal(post.url, '/posts/first-post/');
});

test('read, save (surgical), and a stale version is a 409', async () => {
  const e = await (await get('collections/posts/entries/first-post')).json();
  assert.equal(e.title, 'First post');
  assert.equal(e.doc.content.length, 2);
  e.doc.content[1].content[0].text = 'Second paragraph, edited.';
  const r = await (await send('PUT', 'collections/posts/entries/first-post', { version: e.version, doc: e.doc })).json();
  assert.equal(r.changedBlocks, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'first-post.md'), 'utf8'), POST.replace('Second paragraph.', 'Second paragraph, edited.'));
  const stale = await send('PUT', 'collections/posts/entries/first-post', { version: e.version, doc: e.doc });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).version, r.version);
});

test('frontmatter key changes save surgically, with or without a document', async () => {
  const file = path.join(dir, 'first-post.md');
  const start = fs.readFileSync(file, 'utf8');
  const e = await (await get('collections/posts/entries/first-post')).json();
  const r = await (await send('PUT', 'collections/posts/entries/first-post', { version: e.version, frontmatter: { title: 'Renamed' } })).json();
  assert.equal(r.changedBlocks, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), start.replace('title: First post', 'title: Renamed'));
  e.doc.content[0].content[0].text = 'Hi ';
  const both = await (await send('PUT', 'collections/posts/entries/first-post', { version: r.version, doc: e.doc, frontmatter: { title: 'First post', extra: 'x' } })).json();
  assert.equal(both.changedBlocks, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), start.replace('date: 2026-10-01\n', 'date: 2026-10-01\nextra: x\n').replace('Hello **world**', 'Hi **world**'));
  const back = await (await send('PUT', 'collections/posts/entries/first-post', { version: both.version, doc: (await (await get('collections/posts/entries/first-post')).json()).doc, frontmatter: { extra: null } })).json();
  e.doc.content[0].content[0].text = 'Hello ';
  await send('PUT', 'collections/posts/entries/first-post', { version: back.version, doc: e.doc });
  assert.equal(fs.readFileSync(file, 'utf8'), start);
  const v = (await (await get('collections/posts/entries/first-post')).json()).version;
  assert.equal((await send('PUT', 'collections/posts/entries/first-post', { version: v, frontmatter: ['x'] })).status, 400);
  assert.equal((await send('PUT', 'collections/posts/entries/first-post', { version: v })).status, 400);
});

test('source: read, save with the version check, invalid frontmatter refused', async () => {
  const s = await (await get('collections/posts/entries/first-post/source')).json();
  const text = s.source.replace('title: First post', 'title: First post, renamed');
  const r = await send('PUT', 'collections/posts/entries/first-post/source', { source: text, version: s.version });
  assert.equal(r.status, 200);
  assert.equal(fs.readFileSync(path.join(dir, 'first-post.md'), 'utf8'), text);
  assert.equal((await send('PUT', 'collections/posts/entries/first-post/source', { source: text, version: s.version })).status, 409);
  const now = await (await get('collections/posts/entries/first-post/source')).json();
  const bad = await send('PUT', 'collections/posts/entries/first-post/source', { source: '---\ntitle: [\n---\n\nx\n', version: now.version });
  assert.equal(bad.status, 422);
});

test('preview: the page on this dev server (devServer: true); unknown entry 404', async () => {
  const r = await get('preview/posts/first-post');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { url: `${origin}/posts/first-post/`, devServer: true });
  assert.equal((await get('preview/posts/no-such-post')).status, 404);
  assert.equal((await (await get('preview/posts/first-post?locale=en-US')).json()).url, `${origin}/en-us/posts/first-post/`);
  assert.equal((await get('preview/posts/first-post?locale=fr')).status, 400);
});

test('download is the raw file as an attachment', async () => {
  const r = await get('collections/posts/entries/first-post/download');
  assert.match(r.headers.get('content-disposition'), /attachment; filename="first-post\.md"/);
  assert.equal(await r.text(), fs.readFileSync(path.join(dir, 'first-post.md'), 'utf8'));
});

test('import makes a new draft; a taken id is a 409; no title is a 422', async () => {
  const r = await send('POST', 'collections/posts/import', { filename: 'New Post.md', source: '---\ntitle: New post\n---\n\nBody.\n' });
  assert.equal(r.status, 201);
  const e = await r.json();
  assert.equal(e.id, 'new-post');
  assert.equal(e.status, 'draft');
  assert.equal(fs.readFileSync(path.join(dir, 'new-post.md'), 'utf8'), '---\ndraft: true\ntitle: New post\n---\n\nBody.\n');
  assert.equal((await send('POST', 'collections/posts/import', { filename: 'new-post.md', source: '---\ntitle: Again\n---\n\nx\n' })).status, 409);
  assert.equal((await send('POST', 'collections/posts/import', { filename: 'x.md', source: 'No frontmatter.\n' })).status, 422);
});

test('guards: unknown entry 404, writes need this origin, foreign Host refused', async () => {
  assert.equal((await get('collections/posts/entries/nope')).status, 404);
  assert.equal((await get('collections/posts/entries/..%2Fsecret')).status, 404);
  assert.equal((await send('PUT', 'collections/posts/entries/first-post', {}, {})).status, 403);
  assert.equal((await send('PUT', 'collections/posts/entries/first-post', {}, { Origin: 'http://evil.example' })).status, 403);
  const foreign = await new Promise((resolve) => {
    http.get(`${base}/collections`, { headers: { Host: 'evil.example' } }, (res) => resolve(res.statusCode)).end();
  });
  assert.equal(foreign, 403);
});

test('media: upload by bytes into <media.dir>/<year>/<month>/, never overwriting; list, file; SVG and junk refused', async () => {
  // a 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = (name, body, headers = { Origin: origin }) =>
    fetch(`${base}/media?filename=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body });
  const r = await up('My Screen Shot.PNG', png);
  assert.equal(r.status, 201);
  const m = await r.json();
  const now = new Date();
  const sub = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  assert.equal(m.path, `src/assets/uploads/${sub}/my-screen-shot.png`);
  assert.equal(m.type, 'image/png');
  assert.match(m.id, /^m_[a-f0-9]{20}$/);
  assert.deepEqual(fs.readFileSync(path.join(root, m.path)), png);
  // the same name again gets -2, the first file stays
  assert.equal((await (await up('My Screen Shot.PNG', png)).json()).path, `src/assets/uploads/${sub}/my-screen-shot-2.png`);
  // by bytes, not by name: an SVG called .png and text are refused; writes need this origin
  assert.equal((await up('x.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status, 415);
  assert.equal((await up('x.png', Buffer.from('hello'))).status, 415);
  assert.equal((await up('x.png', png, {})).status, 403);
  const list = await (await get('media?q=screen')).json();
  assert.equal(list.total, 2);
  assert.deepEqual((await (await get(`media/${m.id}/file`)).arrayBuffer()).byteLength, png.length);
  assert.equal((await get('media/m_00000000000000000000')).status, 404);
});

test('media: where each image is used and its alt text come from the content; unused ones can be deleted', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = async (name) =>
    (await fetch(`${base}/media?filename=${name}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: origin }, body: png })).json();
  const [cover, inline, spare] = [await up('usage-cover.png'), await up('usage-inline.png'), await up('usage-spare.png')];
  const inMedia = (m) => m.path.replace('src/assets/uploads/', '');
  // a cover as the frontmatter writes it (inside the media folder) with its alt next to it; a Markdown image by a
  // relative path; the same image twice in one entry counts once
  const text = `---\ntitle: Uses images\ncover:\n  src: ${inMedia(cover)}\n  alt: A cover\n---\n\n![Chart of sales](../../assets/uploads/${inMedia(inline)})\n\n<img src="/src/assets/uploads/${inMedia(inline)}" alt="">\n`;
  fs.writeFileSync(path.join(dir, 'uses-images.md'), text);
  try {
    const item = async (m) => (await get(`media/${m.id}`)).json();
    assert.deepEqual((await item(cover)).usedBy, [{ collection: 'posts', id: 'uses-images', title: 'Uses images' }]);
    assert.equal((await item(cover)).alt, 'A cover');
    assert.equal((await item(inline)).alt, 'Chart of sales');
    assert.equal((await item(inline)).usedBy.length, 1);
    assert.deepEqual((await item(spare)).usedBy, []);
    const unused = await (await get('media?unused=1&q=usage')).json();
    assert.deepEqual(unused.items.map((m) => m.id), [spare.id]);
    // search finds the alt text too
    assert.deepEqual((await (await get('media?q=chart%20of')).json()).items.map((m) => m.id), [inline.id]);
    // alt text lives in the content in dev mode; a used image stays, an unused one goes
    assert.equal((await send('PATCH', `media/${cover.id}`, { alt: 'x' })).status, 409);
    const refused = await send('DELETE', `media/${cover.id}`, {});
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).message, /Uses images/);
    assert.equal((await send('DELETE', `media/${spare.id}`, {})).status, 200);
    assert.equal(fs.existsSync(path.join(root, spare.path)), false);
    // what the shared library screen asks for besides
    assert.deepEqual((await (await get('stock')).json()), { enabled: false });
    assert.equal((await (await get('users?brief=1')).json()).length, 1);
  } finally {
    fs.unlinkSync(path.join(dir, 'uses-images.md'));
  }
});

test('a new entry: title, the asked values and the site defaults; a draft with the default author; 409 and 422', async () => {
  const site = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-new-')));
  const cfg = normalizeConfig(
    {
      siteName: 'Test',
      collections: [
        {
          id: 'posts',
          format: 'md',
          dir: 'src/content/posts',
          hasStatus: true,
          fields: { slug: 'slug' },
          defaultAuthor: 'site-team',
          settings: [{ type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' }],
          newEntry: { ask: ['cluster'], defaults: ({ title, now }) => ({ date: now.toISOString().slice(0, 10), seo: { title, description: '' }, cluster: 'misc' }) },
        },
        { id: 'pages', format: 'json', dir: 'src/content/pages' },
      ],
    },
    site,
  );
  const api = devApi(cfg, async () => ({ md: createConverter(), readFrontmatter, setFrontmatter }), { error() {} });
  const srv = http.createServer((req, res) => api(req, res, () => ((res.statusCode = 404), res.end())));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const o = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, body) => fetch(`${o}/markstage/api/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: o }, body: JSON.stringify(body) });
  try {
    const r = await post('collections/posts/entries', { title: 'Hello, new world', frontmatter: { cluster: 'monday-forms' } });
    assert.equal(r.status, 201);
    const e = await r.json();
    assert.equal(e.id, 'hello-new-world');
    assert.equal(e.status, 'draft');
    const fm = readFrontmatter(fs.readFileSync(path.join(site, 'src/content/posts/hello-new-world.md'), 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    assert.deepEqual(fm, { title: 'Hello, new world', slug: 'hello-new-world', cluster: 'monday-forms', date: today, seo: { title: 'Hello, new world', description: '' }, author: 'site-team', draft: true });
    // the title and slug lead, the asked value beats the site's default, as in the server's (core newEntryFrontmatter)
    assert.deepEqual(Object.keys(fm), ['title', 'slug', 'cluster', 'date', 'seo', 'author', 'draft']);
    assert.equal((await post('collections/posts/entries', { title: 'Hello new world' })).status, 409);
    assert.equal((await post('collections/posts/entries', { title: '  ' })).status, 422);
    assert.equal((await post('collections/posts/entries', { title: 'X', id: 'Bad Id' })).status, 422);
    assert.equal((await post('collections/pages/entries', { title: 'A page' })).status, 400);
  } finally {
    srv.close();
    fs.rmSync(site, { recursive: true, force: true });
  }
});

test('env: the LOCAL badge’s answer, with the branch the site’s folder is on (none outside git)', async () => {
  const outside = await (await get('env')).json();
  assert.deepEqual(outside, { name: 'local', local: true, production: false, configured: true, branch: null });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'my-change');
  assert.equal((await (await get('env')).json()).branch, 'my-change');
  git('-c', 'user.name=T', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'one');
  git('checkout', '-q', '--detach');
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal((await (await get('env')).json()).branch, sha, 'a detached HEAD: its short commit');
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
});
