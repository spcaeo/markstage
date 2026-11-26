// What the independent review of the head kit found (26 Nov 2026), each held by a test: a protected page still in the
// output folder leaks into no public file; a page path with non-ASCII letters gets its copy where a server finds it;
// a page that names the kit's attribute in its text is still done; previews never track; every CSP meta is widened
// (not the Report-Only one) and its entities are read; a locale's 404 page has no copy; a page that loads a tool
// itself is named in the log; small escaping and ID shapes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { normalizeConfig } from '@markstage/core/site-config';
import { buildHead } from '../src/head/index.mjs';
import { rewritePage } from '../src/head/rewrite.mjs';
import { trackingTags } from '../src/head/tracking.mjs';
import { llmsFiles } from '../src/head/llms.mjs';
import { okfFiles } from '../src/head/okf.mjs';
import { readHead } from '@markstage/core/head';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-head-fix-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const SITE = 'https://www.example.com';
const quiet = () => ({ warned: [], infos: [], info(m) { this.infos.push(m); }, warn(m) { this.warned.push(m); } });
const page = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}<title>${title}</title></head><body><main>${body}</main></body></html>`;

function site(name, { head = {}, entries = {}, pages = {}, locales } = {}) {
  const root = path.join(tmp, name);
  const out = path.join(root, 'dist');
  fs.mkdirSync(path.join(root, 'src/site'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/content/posts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/site/head.json'), JSON.stringify(head));
  for (const [id, fm] of Object.entries(entries)) fs.writeFileSync(path.join(root, 'src/content/posts', `${id}.md`), `---\n${fm}\n---\n\nText.\n`);
  for (const [rel, html] of Object.entries(pages)) {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), html);
  }
  const raw = { siteName: 'Example Co', siteUrl: SITE, head: {}, collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/posts', url: '/posts/{id}/' }] };
  if (locales) raw.locales = locales;
  return { cfg: normalizeConfig(raw, root), out, read: (rel) => fs.readFileSync(path.join(out, rel), 'utf8'), has: (rel) => fs.existsSync(path.join(out, rel)) };
}

test('a protected page still in the output folder gets no copy, is in no list, and is left untouched', async () => {
  const s = site('protected', {
    head: { tracking: { gtm: 'GTM-ABC1234' } },
    entries: { secret: 'title: Secret\nprotected: true', open: 'title: Open' },
    pages: { 'posts/secret/index.html': page('Secret', '<p>SECRET BODY</p>'), 'posts/open/index.html': page('Open', '<p>Open body</p>'), 'index.html': page('Home', '<p>Home</p>') },
  });
  const before = s.read('posts/secret/index.html');
  await buildHead({ cfg: s.cfg, outDir: s.out, logger: quiet() });
  assert.ok(!s.has('posts/secret.md'));
  assert.ok(!fs.readdirSync(path.join(s.out, 'okf')).some((f) => f.includes('secret')));
  for (const f of ['llms.txt', 'llms-full.txt', 'okf/index.md']) assert.doesNotMatch(s.read(f), /SECRET|Secret/, f);
  assert.equal(s.read('posts/secret/index.html'), before, 'not touched');
  assert.ok(s.has('posts/open.md'), 'the open post is done as usual');
});

test('a draft and a scheduled entry that were built anyway are left out too, in every locale', async () => {
  const s = site('not-live', {
    entries: { soon: 'title: Soon\npublishAt: 2999-01-01T00:00:00Z', wip: 'title: WIP\ndraft: true' },
    locales: [{ code: 'en', prefix: '', default: true }, { code: 'fr', prefix: '/fr' }],
    pages: { 'posts/soon/index.html': page('Soon', '<p>x</p>'), 'fr/posts/wip/index.html': page('WIP', '<p>x</p>'), 'index.html': page('Home', '<p>Home</p>') },
  });
  await buildHead({ cfg: s.cfg, outDir: s.out, logger: quiet() });
  assert.ok(!s.has('posts/soon.md'));
  assert.ok(!s.has('fr/posts/wip.md'));
  assert.ok(s.has('index.md'));
});

test('a page path with non-ASCII letters: the copy is where a server looks, the links are encoded, skip matches', async () => {
  const s = site('cafe', { head: { markdown: { skip: ['/thé/'] } }, pages: { 'café/index.html': page('Café', '<p>Menu</p>'), 'thé/index.html': page('Thé', '<p>Tea</p>') } });
  await buildHead({ cfg: s.cfg, outDir: s.out, logger: quiet() });
  assert.ok(s.has('café.md'), 'the file a server finds for /caf%C3%A9.md');
  assert.match(s.read('café/index.html'), /href="https:\/\/www\.example\.com\/caf%C3%A9\.md"/);
  assert.match(s.read('okf/index.md'), /\(https:\/\/www\.example\.com\/okf\/caf%C3%A9\.md\)/);
  assert.match(s.read('llms.txt'), /\(https:\/\/www\.example\.com\/caf%C3%A9\.md\)/);
  assert.ok(!s.has('thé.md'), 'skipped, written decoded');
});

test('a page whose text names data-markstage-head still gets its links; one with the kit’s element in its head does not', () => {
  const html = page('About the kit', '<p>The kit marks its tags with data-markstage-head.</p>');
  assert.match(rewritePage(html, { links: '<link rel="x" data-markstage-head>' }), /<link rel="x" data-markstage-head><\/head>/);
  const done = page('Done', '<p>x</p>', '<link rel="x" data-markstage-head>');
  assert.equal(rewritePage(done, { links: '<link rel="y" data-markstage-head>' }), done);
});

test('a preview build (MARKSTAGE_NO_TRACKING=1) gets no tracking, and the log says why', async (t) => {
  const s = site('preview', { head: { tracking: { gtm: 'GTM-ABC1234' } }, pages: { 'index.html': page('Home', '<p>Home</p>') } });
  process.env.MARKSTAGE_NO_TRACKING = '1';
  t.after(() => delete process.env.MARKSTAGE_NO_TRACKING);
  const log = quiet();
  const done = await buildHead({ cfg: s.cfg, outDir: s.out, logger: log });
  assert.deepEqual(done.tracking, []);
  assert.doesNotMatch(s.read('index.html'), /googletagmanager/);
  assert.match(log.infos.join('\n'), /tracking left out of this build/);
});

test('every CSP meta is widened, the Report-Only one is not, and entities in the policy are read', () => {
  const tags = trackingTags({ ahrefs: 'a1B2c3D4e5F6g7H8i9J0kL' });
  const html = page('Home', '<p>x</p>', `<meta http-equiv="Content-Security-Policy" content="script-src &apos;self&apos;"><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><meta http-equiv="Content-Security-Policy-Report-Only" content="script-src 'none'">`);
  const out = rewritePage(html, { tags });
  const metas = [...out.matchAll(/<meta http-equiv="(Content-Security-Policy[^"]*)" content="([^"]*)">/g)].map((m) => [m[1], m[2]]);
  assert.equal(metas.length, 3);
  assert.match(metas[0][1], /^script-src 'self' 'sha256-[^']+' https:\/\/analytics\.ahrefs\.com/, 'the site’s own self kept');
  assert.match(metas[1][1], /script-src 'self' 'sha256-[^']+' https:\/\/analytics\.ahrefs\.com/);
  assert.equal(metas[2][1], "script-src 'none'", 'Report-Only left alone');
});

test('a locale’s own 404 page gets no copy and is in no list', async () => {
  const s = site('fr404', { pages: { 'index.html': page('Home', '<p>Home</p>'), 'fr/404.html': page('Introuvable', '<p>x</p>'), '404.html': page('Not found', '<p>x</p>') } });
  await buildHead({ cfg: s.cfg, outDir: s.out, logger: quiet() });
  assert.ok(!s.has('fr/404.md') && !s.has('404.md'));
  assert.doesNotMatch(s.read('okf/index.md'), /Introuvable|Not found/);
});

test('a page that already loads a tool itself is named in the log (each visit would count twice)', async () => {
  const own = '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-OLD1234"></script>';
  const s = site('own-tag', { head: { tracking: { gtm: 'GTM-ABC1234' } }, pages: { 'index.html': page('Home', '<p>x</p>', own), 'a/index.html': page('A', '<p>x</p>') } });
  const log = quiet();
  await buildHead({ cfg: s.cfg, outDir: s.out, logger: log });
  assert.match(log.warned.join('\n'), /a page already loads gtm itself/);
});

test('small ones: GA4 alone needs no frame; a backslash in a title cannot end a link; a Plausible roll-up is taken', () => {
  assert.deepEqual(trackingTags({ ga4: 'G-ABC123DEF4' }).csp.frameOrigins, []);
  const docs = [{ page: { path: '/a/', title: 'Ends in \\', description: '', canonical: `${SITE}/a/` }, markdown: '# a' }];
  assert.match(llmsFiles(docs, { siteName: 'Example Co', siteUrl: SITE })[0].text, /- \[Ends in \\\\\]\(/);
  assert.match(okfFiles(docs, { siteName: 'Example Co', siteUrl: SITE })[0].text, /\* \[Ends in \\\\\]\(/);
  assert.equal(readHead({ tracking: { plausible: 'example.com,blog.example.com' } }).issues.length, 0);
});

test('the settings checks name typos, wrong types and a collection listed twice', () => {
  const { issues } = readHead({ markdown: { okF: false }, feeds: [{ id: 'b', title: 'B', path: '/rss.xml', collections: ['posts', 'posts'], limt: 5 }], tracking: { ga4: 123 } }, { collections: ['posts'] });
  const paths = issues.map((i) => i.path);
  assert.deepEqual(paths, ['markdown.okF', 'feeds.0.limt', 'feeds.0.collections', 'tracking.ga4']);
});
