// Authors in `astro dev` and in the site's build (docs/API-AUTHORS.md), on a throwaway project in a common shape:
// the dev API's author routes (list with post counts, create, surgical change, archive, an author with posts never
// deleted or renamed without saying where the posts go, reassign and rename in one step), the check every entry
// save makes, the build's check, and the helpers the site's pages use (getAuthors, getAuthor, getEntriesByAuthor,
// personJsonLd).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createConverter, readFrontmatter, setFrontmatter } from '@markstage/core';
import { devApi } from '../src/api.mjs';
import { authorsOf } from '../src/authors.mjs';
import { normalizeConfig } from '../src/config.mjs';
import { checkAuthors } from '../src/index.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-authors-')));
const posts = path.join(root, 'src/content/posts');
const authors = path.join(root, 'src/content/authors');
const SAM = '{\n  "id": "sam",\n  "name": "Sam Example",\n  "designation": "Founder",\n  "bio": "Builds things.",\n  "avatar": "2024/02/sam.png",\n  "seo": {\n    "title": "Sam Example, Founder",\n    "robots": ["index"]\n  }\n}\n';
const post = (title, author) => `---\ntitle: ${title}\nauthor: ${author}\ndate: '2026-01-01'\n---\n\n${title}.\n`;
const write = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text);
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
let cfg;
let server;
let base;
let origin;

before(async () => {
  fs.mkdirSync(posts, { recursive: true });
  fs.mkdirSync(authors, { recursive: true });
  write(authors, 'sam.json', SAM);
  write(authors, 'kim.json', '{\n  "id": "kim",\n  "name": "Kim Example"\n}\n');
  write(authors, 'old-hand.json', '{\n  "id": "old-hand",\n  "name": "Old Hand",\n  "archived": true\n}\n');
  write(posts, 'first.md', `---\ntitle: First\nauthor: sam\ndate: '2026-01-01'\ncoAuthors:\n  - kim\n---\n\nFirst.\n`);
  write(posts, 'second.md', `---\ntitle: Second\nauthor: sam\ndate: '2026-03-01'\n---\n\nSecond.\n`);
  write(posts, 'a-draft.md', `---\ntitle: A draft\nauthor: kim\ndate: '2026-04-01'\ndraft: true\n---\n\nSoon.\n`);
  write(posts, 'by-old.md', `---\ntitle: By an old hand\nauthor: old-hand\ndate: '2025-01-01'\n---\n\nOld.\n`);
  cfg = normalizeConfig(
    {
      siteUrl: 'https://example.com',
      authors: { coAuthors: 'coAuthors', organization: 'https://example.com/#organization' },
      collections: [{ id: 'posts', format: 'md', dir: 'src/content/posts', hasStatus: true, url: '/posts/{id}/' }],
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

test('the list: every author with their posts counted, the archived one marked, names in order', async () => {
  const r = await get('authors');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items.map((a) => [a.slug, a.posts, a.live, a.archived, a.url]), [
    ['kim', 2, 1, false, '/author/kim/'],
    ['old-hand', 1, 1, true, '/author/old-hand/'],
    ['sam', 2, 2, false, '/author/sam/'],
  ]);
  const one = await get('authors/sam');
  assert.equal(one.json.author.role, 'Founder');
  assert.deepEqual(one.json.posts.map((p) => [p.id, p.role]), [['second', 'author'], ['first', 'author']]);
  assert.deepEqual((await get('authors/kim')).json.posts.map((p) => [p.id, p.role, p.status]), [['a-draft', 'author', 'draft'], ['first', 'co-author', 'published']]);
  assert.equal((await get('authors/nobody')).status, 404);
});

test('create: slug from the name, the site keys, mistakes named; a taken slug is a 409', async () => {
  const r = await send('POST', 'authors', { name: 'Ana María', role: 'Editor', website: 'https://ana.example', social: ['https://x.example/ana'], email: 'ana@example.com' });
  assert.equal(r.status, 201);
  assert.equal(r.json.author.slug, 'ana-maria');
  assert.deepEqual(JSON.parse(read(authors, 'ana-maria.json')), { id: 'ana-maria', name: 'Ana María', designation: 'Editor', email: 'ana@example.com', website: 'https://ana.example', social: ['https://x.example/ana'] });
  assert.equal((await send('POST', 'authors', { name: 'Ana María' })).status, 409);
  const bad = await send('POST', 'authors', { name: '', website: 'ana.example' });
  assert.equal(bad.status, 422);
  assert.ok(bad.json.fields.name && bad.json.fields.website);
  assert.equal((await send('POST', 'authors', { name: 'X', slug: 'Not A Slug' })).status, 422);
});

test('change: only the changed keys move; a stale version is a 409; archive and bring back', async () => {
  const a = (await get('authors/sam')).json.author;
  assert.equal((await send('PUT', 'authors/sam', { version: 'stale', role: 'CEO' })).status, 409);
  const r = await send('PUT', 'authors/sam', { version: a.version, role: 'Founder and CEO', seoTitle: '' });
  assert.equal(r.status, 200);
  assert.equal(read(authors, 'sam.json'), SAM.replace('"Founder"', '"Founder and CEO"').replace('    "title": "Sam Example, Founder",\n', ''));
  // open and save with nothing changed: the file stays byte for byte
  const before = read(authors, 'sam.json');
  await send('PUT', 'authors/sam', { version: r.json.author.version, name: 'Sam Example' });
  assert.equal(read(authors, 'sam.json'), before);
  const arch = await send('PUT', 'authors/kim', { version: (await get('authors/kim')).json.author.version, archived: true });
  assert.equal(arch.json.author.archived, true);
  await send('PUT', 'authors/kim', { version: arch.json.author.version, archived: false });
  assert.doesNotMatch(read(authors, 'kim.json'), /archived/);
});

test('saving an entry: a new unknown or archived author is refused; an old one is left alone', async () => {
  const e = (await get('collections/posts/entries/second')).json;
  const bad = await send('PUT', 'collections/posts/entries/second', { version: e.version, frontmatter: { author: 'ghost' } });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, 'unknown-author');
  assert.match(bad.json.fields.author, /“ghost” is not one of the site's authors/);
  const archived = await send('PUT', 'collections/posts/entries/second', { version: e.version, frontmatter: { coAuthors: ['old-hand'] } });
  assert.match(archived.json.message, /Old Hand \(“old-hand”\) is archived/);
  // the post by the archived author still saves (its author was already there)
  const old = (await get('collections/posts/entries/by-old')).json;
  assert.equal((await send('PUT', 'collections/posts/entries/by-old', { version: old.version, frontmatter: { title: 'By an old hand, again' } })).status, 200);
  assert.equal((await send('PUT', 'collections/posts/entries/second', { version: e.version, frontmatter: { coAuthors: ['kim'] } })).status, 200);
});

test('delete: blocked with the posts listed; reassigned and deleted in one step', async () => {
  const d = (await get('authors/kim')).json;
  const blocked = await send('DELETE', `authors/kim?version=${d.author.version}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, 'author-has-posts');
  assert.deepEqual(blocked.json.posts.map((p) => p.id).sort(), ['a-draft', 'first', 'second']);
  assert.ok(fs.existsSync(path.join(authors, 'kim.json')));
  assert.equal((await send('DELETE', `authors/kim?version=${d.author.version}&reassign=old-hand`)).status, 422, 'not to an archived author');
  const r = await send('DELETE', `authors/kim?version=${d.author.version}&reassign=sam`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.moved.map((m) => m.id).sort(), ['a-draft', 'first', 'second']);
  assert.ok(!fs.existsSync(path.join(authors, 'kim.json')));
  assert.match(read(posts, 'a-draft.md'), /^author: sam$/m);
  // sam was the primary already: the co-author list goes rather than name them twice
  assert.doesNotMatch(read(posts, 'first.md'), /coAuthors/);
  assert.doesNotMatch(read(posts, 'second.md'), /coAuthors/);
});

test('rename: blocked with posts; with movePosts the file, its id and every post move together', async () => {
  const a = (await get('authors/sam')).json.author;
  const blocked = await send('POST', 'authors/sam/rename', { version: a.version, to: 'sam-p' });
  assert.equal(blocked.status, 409);
  assert.equal((await send('POST', 'authors/sam/rename', { version: a.version, to: 'old-hand', movePosts: true })).status, 409, 'a taken slug');
  const r = await send('POST', 'authors/sam/rename', { version: a.version, to: 'sam-p', movePosts: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.author.slug, 'sam-p');
  assert.equal(JSON.parse(read(authors, 'sam-p.json')).id, 'sam-p');
  assert.ok(!fs.existsSync(path.join(authors, 'sam.json')));
  for (const f of ['first.md', 'second.md', 'a-draft.md']) assert.match(read(posts, f), /^author: sam-p$/m);
});

test("the build's check names every entry with an unknown author", () => {
  checkAuthors(cfg);
  write(posts, 'stray.md', post('Stray', 'nobody'));
  assert.throws(() => checkAuthors(cfg), /an entry names an author the site does not have \(src\/content\/authors\):\n {2}src\/content\/posts\/stray\.md: “nobody” is not one of the site's authors/);
  fs.rmSync(path.join(posts, 'stray.md'));
});

test("the site's helpers: authors without the email or the archived, published posts newest first, Person JSON-LD", () => {
  write(posts, 'later.md', `---\ntitle: Later\nauthor: sam-p\ndate: '2026-06-01'\npublishAt: '2999-01-01T00:00:00Z'\n---\n\nLater.\n`);
  write(posts, 'shared.md', `---\ntitle: Shared\nauthor: ana-maria\ndate: '2026-05-01'\ncoAuthors:\n  - sam-p\n---\n\nShared.\n`);
  const h = authorsOf(cfg, { cache: false });
  const all = h.getAuthors();
  assert.deepEqual(all.map((a) => a.slug), ['ana-maria', 'sam-p']);
  assert.ok(all.every((a) => !('email' in a)));
  assert.deepEqual(h.getAuthors({ archived: true }).map((a) => a.slug), ['ana-maria', 'old-hand', 'sam-p']);
  assert.equal(h.getAuthor('old-hand').archived, true);
  assert.equal(h.getAuthor('nobody'), null);
  assert.deepEqual(h.getEntriesByAuthor('sam-p').map((e) => [e.id, e.role, e.url]), [['shared', 'co-author', '/posts/shared/'], ['second', 'author', '/posts/second/'], ['first', 'author', '/posts/first/']]);
  assert.deepEqual(h.getEntriesByAuthor('sam-p', { coAuthored: false }).map((e) => e.id), ['second', 'first']);
  // a preview build shows every entry
  process.env.MARKSTAGE_PREVIEW = '1';
  assert.deepEqual(h.getEntriesByAuthor('sam-p').map((e) => e.id), ['later', 'shared', 'a-draft', 'second', 'first']);
  delete process.env.MARKSTAGE_PREVIEW;
  const ld = h.personJsonLd(h.getAuthor('ana-maria'));
  assert.deepEqual(ld, {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': 'https://example.com/author/ana-maria/',
    url: 'https://example.com/author/ana-maria/',
    name: 'Ana María',
    jobTitle: 'Editor',
    sameAs: ['https://ana.example', 'https://x.example/ana'],
    worksFor: { '@id': 'https://example.com/#organization' },
  });
});
