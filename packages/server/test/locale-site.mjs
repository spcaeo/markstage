// A two-locale fixture site (root = en-CA, /en-us/ = en-US) for the move and locale tests: a site config with
// locales and a redirects hook, entries that link to hello-world, and a build that emits every locale copy.
import fs from 'node:fs';
import path from 'node:path';
import { loadCore } from '../src/content/converter.mjs';
import { makeFixture, startServer } from './helpers.mjs';

export const LOCALE_CONFIG = `export default {
  siteUrl: 'https://example.com',
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  locales: [{ code: 'en-CA', prefix: '' }, { code: 'en-US', prefix: '/en-us' }],
  redirects: { command: ['node', 'scripts/redirects.mjs'] },
};
`;

// the site's redirects hook (docs/API.md "The redirects hook"), keeping {from: to} in src/data/redirects.json: adds,
// lists and removes; "/blog/explode/" makes an add fail, and the file .hook-adds-only makes it a hook that only adds
const HOOK = `import fs from 'node:fs';
let t = '';
process.stdin.on('data', (d) => (t += d));
process.stdin.on('end', () => {
  const ask = JSON.parse(t);
  const file = 'src/data/redirects.json';
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (ask.action && fs.existsSync('.hook-adds-only')) { console.error('unknown input'); process.exit(2); }
  if (ask.action === 'list') {
    console.log('reading ' + file);
    console.log(JSON.stringify({ redirects: Object.entries(map).map(([from, to]) => ({ from, to, status: 301 })) }));
    return;
  }
  if (ask.action === 'remove') for (const f of ask.from) delete map[f];
  else for (const r of ask.redirects) map[r.from] = r.to;
  fs.mkdirSync('src/data', { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\\n');
  if (!ask.action && ask.redirects.some((r) => r.to.includes('explode'))) { console.error('no redirects for explosions'); process.exit(3); }
});
`;

export const LINKER = `---\ntitle: Linker\nauthor: alice\ndate: '2026-01-07T10:00:00.000Z'\nseo:\n  canonical: https://example.com/blog/linker/\n  related: https://example.com/en-us/blog/hello-world/\n---\n\nSee [hello](/blog/hello-world/) and the [US copy](https://example.com/en-us/blog/hello-world/#top).\n\nThe text /blog/hello-world/ is just words.\n\nUntouched paragraph.\n`;
export const LINKS_PAGE = `{\n  "title": "Links",\n  "uri": "/links/",\n  "cta": {\n    "href": "/blog/hello-world",\n    "text": "/blog/hello-world/"\n  },\n  "sections": [\n    {\n      "discriminant": "prose",\n      "value": {\n        "html": "<p><a href=\\"/en-us/blog/hello-world/?a=1\\">US</a> and <a href='/blog/other/'>other</a></p>"\n      }\n    }\n  ]\n}\n`;

// the site's build, as a real one: every live entry in every locale (/x/ and /en-us/x/) with its hreflang links,
// protected ones to dist-private/, redirect stubs for src/data/redirects.json. Faults on demand: the file
// .drop-en-us leaves out the /en-us/ copies, .no-hreflang leaves out the hreflang links.
const LOCALE_BUILD = `import fs from 'node:fs';
const now = Date.parse(process.env.MARKSTAGE_BUILD_TIME ?? new Date().toISOString());
const prefixes = fs.existsSync('.drop-en-us') ? [''] : ['', '/en-us'];
for (const d of ['dist', 'dist-private']) fs.rmSync(d, { recursive: true, force: true });
const page = (dir, p, title) => {
  fs.mkdirSync(dir + p, { recursive: true });
  const alt = fs.existsSync('.no-hreflang') ? '' : ['', '/en-us'].map((x, i) => '<link rel="alternate" hreflang="' + ['en-CA', 'en-US'][i] + '" href="' + x + p.replace(/^\\/en-us/, '') + '">').join('');
  fs.writeFileSync(dir + p + 'index.html', '<!doctype html><head>' + alt + '</head><title>' + title + '</title>');
};
const entries = [];
for (const f of fs.readdirSync('src/content/blog').filter((f) => f.endsWith('.md'))) {
  const t = fs.readFileSync('src/content/blog/' + f, 'utf8');
  const at = /^publishAt: "?([^"\\n]+)"?$/m.exec(t);
  if (/^draft: true$/m.test(t) || (at && Date.parse(at[1]) > now)) continue;
  entries.push({ url: '/blog/' + f.replace(/\\.md$/, '') + '/', title: /^title: (.*)$/m.exec(t)[1], prot: /^protected: true$/m.test(t) });
}
for (const f of fs.readdirSync('src/content/pages').filter((f) => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync('src/content/pages/' + f, 'utf8'));
  entries.push({ url: d.uri, title: d.title, prot: d.protected === true });
}
for (const e of entries) for (const p of prefixes) page(e.prot ? 'dist-private' : 'dist', p + e.url, e.title);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.json', JSON.stringify(entries.filter((e) => !e.prot).map((e) => e.url)));
const redirects = fs.existsSync('src/data/redirects.json') ? JSON.parse(fs.readFileSync('src/data/redirects.json', 'utf8')) : {};
for (const [from, to] of Object.entries(redirects)) {
  if (fs.existsSync('dist' + from + 'index.html')) continue;
  fs.mkdirSync('dist' + from, { recursive: true });
  fs.writeFileSync('dist' + from + 'index.html', '<meta http-equiv="refresh" content="0;url=' + to + '">');
}
`;

// a post-build hreflang check: every locale copy of the entry links to every locale (reads MARKSTAGE_URLS)
const HREFLANG_CHECK = `import fs from 'node:fs';
const issues = [];
for (const p of (process.env.MARKSTAGE_URLS ?? '').split(' ').filter(Boolean)) {
  const f = 'dist' + p + 'index.html';
  if (!fs.existsSync(f)) continue;
  const html = fs.readFileSync(f, 'utf8');
  for (const code of ['en-CA', 'en-US']) if (!html.includes('hreflang="' + code + '"')) issues.push({ severity: 'error', message: p + ' has no hreflang ' + code });
}
console.log(JSON.stringify({ issues }));
process.exit(issues.length ? 1 : 0);
`;

/** Make a fixture a two-locale site with a redirects hook and entries that link to hello-world (one commit). */
export function localeSite(fx, { siteUrl = null } = {}) {
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), siteUrl ? LOCALE_CONFIG.replace('https://example.com', siteUrl) : LOCALE_CONFIG);
  fs.writeFileSync(path.join(fx.site, 'scripts/redirects.mjs'), HOOK);
  fs.writeFileSync(path.join(fx.site, 'src/content/blog/linker.md'), LINKER);
  fs.writeFileSync(path.join(fx.site, 'src/content/pages/links.json'), LINKS_PAGE);
  fs.writeFileSync(path.join(fx.site, 'scripts/build-locales.mjs'), LOCALE_BUILD);
  fs.writeFileSync(path.join(fx.site, 'scripts/hreflang-check.mjs'), HREFLANG_CHECK);
  fs.appendFileSync(path.join(fx.site, '.gitignore'), '.drop-en-us\n.no-hreflang\n.hook-adds-only\n');
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Two locales, links');
  return fx;
}

/** A server on a fixture site with two locales (localeSite). `siteUrl`: another address for the site. */
export async function localeServer(overrides = {}, { siteUrl = null } = {}) {
  const fx = localeSite(makeFixture({ checks: false }), { siteUrl });
  const srv = await startServer(fx, { overrides: { collections: [], ...overrides }, core: await loadCore() });
  return { fx, srv };
}
