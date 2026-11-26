// The head kit's build step with feeds and tracking on, over a small built site: the feed is written from the
// collections' entries and linked from every page (the 404 page too, which gets no Markdown copy); a feed file the
// site builds itself is kept and logged; the tracking loader and Tag Manager's <noscript> are in every page, and a
// page's own CSP <meta> gains exactly what the loader needs; a broken settings file stops the step in words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { normalizeConfig } from '@markstage/core/site-config';
import { cspHash } from '@markstage/core/csp';
import { buildHead } from '../src/head/index.mjs';
import { trackingTags } from '../src/head/tracking.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-head-track-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const SITE = 'https://www.example.com';
const TRACKING = { gtm: 'GTM-ABC1234', ahrefs: 'a1B2c3D4e5F6g7H8i9J0kL', skald: 'www.example.com' };

function site(name, { head, ownFeed = false } = {}) {
  const root = path.join(tmp, name);
  const out = path.join(root, 'dist');
  const posts = path.join(root, 'src/content/posts');
  fs.mkdirSync(posts, { recursive: true });
  fs.mkdirSync(path.join(root, 'src/site'), { recursive: true });
  fs.mkdirSync(path.join(out, 'posts/hello'), { recursive: true });
  fs.writeFileSync(path.join(posts, 'hello.md'), '---\ntitle: "Hello & welcome"\ndate: 2026-11-20\ndescription: The first post.\n---\n\nHello.\n');
  fs.writeFileSync(path.join(posts, 'later.md'), '---\ntitle: Later\ndate: 2026-11-21\ndraft: true\n---\n\nNot yet.\n');
  fs.writeFileSync(path.join(root, 'src/site/head.json'), JSON.stringify(head));
  const page = (title, body, csp = '') =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8">${csp}<title>${title}</title><link rel="canonical" href="${SITE}/"></head><body><header>Menu</header><main>${body}</main></body></html>`;
  fs.writeFileSync(path.join(out, 'index.html'), page('Example Co', '<h1>Example Co</h1><p>We make things.</p>', `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'">`));
  fs.writeFileSync(path.join(out, 'posts/hello/index.html'), page('Hello &amp; welcome', '<h1>Hello &amp; welcome</h1><p>Hello.</p>'));
  fs.writeFileSync(path.join(out, '404.html'), page('Page not found', '<h1>Page not found</h1>'));
  if (ownFeed) fs.writeFileSync(path.join(out, 'rss.xml'), '<rss version="2.0"><channel><title>Own</title></channel></rss>');
  const cfg = normalizeConfig(
    { siteName: 'Example Co', siteUrl: SITE, head: {}, collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/posts', url: '/posts/{id}/', fields: { excerpt: 'description' } }] },
    root,
  );
  return { cfg, out };
}

const quiet = { warned: [], info() {}, warn(m) { this.warned.push(m); } };
const FEED = { id: 'posts', title: 'Example Co news', path: '/rss.xml', collections: ['posts'] };

test('the feed is written from the live entries and linked from every page, the 404 page too', async () => {
  const { cfg, out } = site('feeds', { head: { feeds: [FEED] } });
  const done = await buildHead({ cfg, outDir: out, logger: quiet });
  assert.deepEqual(done.feeds, ['/rss.xml']);
  const rss = fs.readFileSync(path.join(out, 'rss.xml'), 'utf8');
  assert.match(rss, /<title>Hello &amp; welcome<\/title>/);
  assert.match(rss, /<link>https:\/\/www\.example\.com\/posts\/hello\/<\/link>/);
  assert.doesNotMatch(rss, /Later/, 'a draft is not in the feed');
  for (const f of ['index.html', 'posts/hello/index.html', '404.html']) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    assert.match(html, /<link rel="alternate" type="application\/rss\+xml" title="Example Co news" href="https:\/\/www\.example\.com\/rss\.xml" data-markstage-head>/, f);
  }
  assert.ok(!fs.existsSync(path.join(out, '404.md')));
  assert.doesNotMatch(fs.readFileSync(path.join(out, '404.html'), 'utf8'), /Markdown version of this page/);
});

test('a feed file the site builds itself is kept, and the log says so', async () => {
  const { cfg, out } = site('own-feed', { head: { feeds: [FEED] }, ownFeed: true });
  const logger = { ...quiet, warned: [] };
  const done = await buildHead({ cfg, outDir: out, logger });
  assert.deepEqual(done.kept, ['/rss.xml']);
  assert.match(fs.readFileSync(path.join(out, 'rss.xml'), 'utf8'), /<title>Own<\/title>/);
  assert.match(logger.warned.join('\n'), /builds this file itself.*\/rss\.xml/);
});

test('the tracking loader is in every page once, and a page’s own CSP gains exactly its hash and origins', async () => {
  const { cfg, out } = site('tracking', { head: { tracking: TRACKING } });
  const done = await buildHead({ cfg, outDir: out, logger: quiet });
  assert.deepEqual([...done.tracking].sort(), ['ahrefs', 'gtm', 'skald']);
  const tags = trackingTags({ ...TRACKING, gtmLoad: 'first-interaction' });
  const hash = cspHash(tags.head.replace(/^<script[^>]*>|<\/script>$/g, ''));
  for (const f of ['index.html', 'posts/hello/index.html', '404.html']) {
    const html = fs.readFileSync(path.join(out, f), 'utf8');
    assert.equal(html.split('<script data-markstage-head').length - 1, 1, `${f}: one loader`);
    assert.match(html, /<body><noscript data-markstage-head><iframe src="https:\/\/www\.googletagmanager\.com\/ns\.html\?id=GTM-ABC1234"/, `${f}: GTM noscript right after <body>`);
    assert.doesNotMatch(html, /\bstyle=/, `${f}: no inline style attribute for the CSP to refuse`);
  }
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const policy = home.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1].replace(/&#39;/g, "'");
  const dir = (n) => policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${n} `)) ?? '';
  assert.ok(dir('script-src').includes(hash), 'the loader’s hash');
  for (const o of ['https://www.googletagmanager.com', 'https://analytics.ahrefs.com', 'https://app.skaldanalytics.com']) assert.ok(dir('script-src').includes(o), o);
  assert.ok(dir('img-src').startsWith("img-src 'self'"), 'the site’s own img-src kept, origins added after it');
  assert.ok(dir('frame-src').includes('https://www.googletagmanager.com'));
  assert.doesNotMatch(policy, /unsafe-inline/);
  // a second run over the same output changes nothing
  const again = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  await buildHead({ cfg, outDir: out, logger: quiet });
  assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), again);
});

test('no tracking ID set: no loader, no noscript, the policy untouched', async () => {
  const { cfg, out } = site('no-tracking', { head: {} });
  await buildHead({ cfg, outDir: out, logger: quiet });
  const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(home, /<script data-markstage-head|<noscript data-markstage-head/);
  assert.match(home, /content="default-src 'self'; img-src 'self'"/);
});

test('a wrong ID in the settings stops the step with the problem in words, before any file is written', async () => {
  const { cfg, out } = site('bad', { head: { tracking: { gtm: 'UA-1234' } } });
  await assert.rejects(buildHead({ cfg, outDir: out, logger: quiet }), /tracking\.gtm: “UA-1234” is not a Google Tag Manager ID/);
  assert.ok(!fs.existsSync(path.join(out, 'index.md')));
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /data-markstage-head/);
});
