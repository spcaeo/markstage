// The starter works as shipped: it builds (live posts and the MDX guide, the draft left out), the "Edit this page" button is one
// inline script when it is set, and in `astro dev` the editor page and its API answer at /markstage/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import { build, dev } from 'astro';
import markstage from '@markstage/astro';
import starter from '../markstage.config.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-starter-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Builds the starter into tmp/<name>; returns the built files' paths. */
async function built(name, integrations) {
  const outDir = path.join(tmp, name);
  await build({ root, outDir, configFile: false, site: 'https://www.example.com', trailingSlash: 'always', integrations, logLevel: 'error', cacheDir: path.join(tmp, `cache-${name}`) });
  return { outDir, files: fs.readdirSync(outDir, { recursive: true }).map(String).sort() };
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

test('the config is the plain object both sides read, with no edit button unless MARKSTAGE_CMS_URL is set', () => {
  assert.equal(starter.collections[0].id, 'posts');
  assert.equal(starter.collections[0].dir, 'src/content/posts');
  if (!process.env.MARKSTAGE_CMS_URL) assert.equal(starter.editButton, undefined);
  const text = fs.readFileSync(path.join(root, 'markstage.config.mjs'), 'utf8');
  assert.doesNotMatch(text, /^import /m, 'a server reads it before the site is installed: no imports');
});

test('it builds: the home page, each live post, the MDX guide, the 404 page; the draft stays out', { timeout: 180_000 }, async () => {
  const { outDir, files } = await built('plain', [mdx(), markstage()]);
  for (const f of ['index.html', '404.html', 'posts/welcome/index.html', 'posts/writing-in-markdown/index.html', 'posts/from-draft-to-live/index.html', 'guides/using-components/index.html', 'favicon.svg']) assert.ok(files.includes(f), `${f} is built`);
  assert.ok(!files.some((f) => f.includes('a-draft-post')), 'the draft is not built');
  const home = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.match(home, /<a href="\/posts\/welcome\/">/);
  assert.match(home, /<a href="\/guides\/using-components\/">/);
  const guide = fs.readFileSync(path.join(outDir, 'guides/using-components/index.html'), 'utf8');
  assert.match(guide, /<aside class="callout callout--tip" role="note"><p class="callout__title">Try it<\/p>/, 'the MDX component is drawn');
  assert.doesNotMatch(home, /A draft post/);
  assert.match(home, /<link rel="canonical" href="https:\/\/www\.example\.com\/"/);
  const post = fs.readFileSync(path.join(outDir, 'posts/writing-in-markdown/index.html'), 'utf8');
  assert.match(post, /<article class="post">/);
  assert.match(post, /<div class="post__body">/, 'the classes the editor canvas draws in (editor.canvas)');
  assert.doesNotMatch(post, /<script>/, 'no inline script without an edit button');
});

test('with an edit button, every page gains one inline script', { timeout: 180_000 }, async () => {
  const { outDir, files } = await built('button', [mdx(), markstage({ config: { ...starter, editButton: { cms: 'https://cms.example.com' } } })]);
  const pages = files.filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 4, pages.join());
  for (const f of pages) {
    const html = fs.readFileSync(path.join(outDir, f), 'utf8');
    assert.equal(html.split('<script>').length, 2, `${f}: one inline script`);
    assert.ok(!html.includes('cms.example.com'), `${f}: the page never names the CMS`);
  }
});

test('astro dev: the editor at /markstage/ and its API list the posts', { timeout: 120_000 }, async () => {
  const port = await freePort();
  const server = await dev({ root, server: { host: '127.0.0.1', port }, logLevel: 'error' });
  try {
    const base = `http://127.0.0.1:${server.address.port}`;
    const editor = await fetch(`${base}/markstage/`);
    assert.equal(editor.status, 200);
    assert.match(editor.headers.get('content-type') ?? '', /text\/html/);
    const cols = await (await fetch(`${base}/markstage/api/collections`)).json();
    const posts = cols.find((c) => c.id === 'posts');
    assert.ok(posts, JSON.stringify(cols));
    assert.equal(posts.counts.all, 4);
    assert.equal(posts.counts.draft, 1);
    const guides = cols.find((c) => c.id === 'guides');
    assert.equal(guides?.counts.all, 1, JSON.stringify(cols));
    // the MDX guide opens for editing: its words as blocks, not read-only
    const guide = await (await fetch(`${base}/markstage/api/collections/guides/entries/using-components`)).json();
    assert.equal(guide.mdx, true);
    assert.equal(guide.unreadable, undefined);
    assert.notEqual(guide.can?.edit, false);
    assert.match(JSON.stringify(guide.doc), /Click this box in the editor/);
    const list = await (await fetch(`${base}/markstage/api/collections/posts/entries?sort=title`)).json();
    assert.deepEqual(list.items.map((i) => [i.id, i.status]), [
      ['a-draft-post', 'draft'],
      ['from-draft-to-live', 'published'],
      ['welcome', 'published'],
      ['writing-in-markdown', 'published'],
    ]);
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
  } finally {
    await server.stop();
  }
});
