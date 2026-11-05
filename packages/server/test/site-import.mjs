// Shared parts of the site import's tests (docs/IMPORT.md): a fixture site with a posts collection (cover, tags,
// categories, SEO), a pages collection, authors and a redirects hook; the old site's files on a local web site; the
// fixtures with the old address swapped for that web site's; a multipart body as a browser sends it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../src/content/converter.mjs';
import { makeFixture, makePng, startServer } from './helpers.mjs';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/import');
export const OLD = 'https://old.example.com';

export const SITE_CONFIG = `export default {
  siteUrl: 'https://example.com',
  collections: [
    {
      id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/',
      settings: [
        { type: 'image', key: 'cover.src', alt: 'cover.alt', label: 'Cover' },
        { type: 'tags', key: 'categories', label: 'Categories' },
        { type: 'seo', title: 'seo.title', description: 'seo.description' },
      ],
    },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' }, settings: [{ type: 'seo', title: 'seo.title', description: 'seo.description' }] },
  ],
  redirects: { command: ['node', 'scripts/redirects.mjs'] },
};
`;

// the site's redirects hook (docs/API.md "The redirects hook"), keeping {from: to} in src/data/redirects.json
const HOOK = `import fs from 'node:fs';
let t = '';
process.stdin.on('data', (d) => (t += d));
process.stdin.on('end', () => {
  const ask = JSON.parse(t);
  const file = 'src/data/redirects.json';
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (ask.action === 'list') return console.log(JSON.stringify({ redirects: Object.entries(map).map(([from, to]) => ({ from, to, status: 301 })) }));
  if (ask.action === 'remove') for (const f of ask.from) delete map[f];
  else for (const r of ask.redirects) map[r.from] = r.to;
  fs.mkdirSync('src/data', { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\\n');
});
`;

/** A fixture with the import's site config, an author alice, and the hook (one commit). `hook: false` leaves it out. */
export function importSite({ hook = true } = {}) {
  const fx = makeFixture({ checks: false });
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), hook ? SITE_CONFIG : SITE_CONFIG.replace(/\n {2}redirects: .*\n/, '\n'));
  fs.writeFileSync(path.join(fx.site, 'scripts/redirects.mjs'), HOOK);
  fs.mkdirSync(path.join(fx.site, 'src/content/authors'), { recursive: true });
  fs.writeFileSync(path.join(fx.site, 'src/content/authors/alice.json'), '{\n  "id": "alice",\n  "name": "Alice Example"\n}\n');
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Import site');
  return fx;
}

export async function importServer({ hook = true, outbound, clock } = {}) {
  const fx = importSite({ hook });
  const srv = await startServer(fx, { core: await loadCore(), outbound, clock, overrides: { collections: [], authors: {} } });
  return { fx, srv };
}

/** The old site's files: two pictures, a PDF, and what a test adds. */
export function oldFiles(extra = {}) {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  return {
    '/wp-content/uploads/2024/05/truck.jpg': { type: 'image/png', body: makePng(Buffer.from('truck')) },
    '/wp-content/uploads/2024/05/box.png': { type: 'image/png', body: makePng(Buffer.from('box')) },
    '/wp-content/uploads/2024/05/price-list.pdf': { type: 'application/pdf', body: pdf },
    '/content/images/2024/05/harbour.png': { type: 'image/png', body: makePng(Buffer.from('harbour')) },
    '/content/images/2024/05/crane.png': { type: 'image/png', body: makePng(Buffer.from('crane')) },
    ...extra,
  };
}

/** A fixture file with the old site's address swapped for `base`. */
export const fixture = (name, base = OLD) => fs.readFileSync(path.join(FIXTURES, name), 'utf8').split(OLD).join(base);

/** A multipart/form-data body as a browser's FormData sends it. */
export function form(fields, file) {
  const boundary = '----markstage-import-test';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${typeof v === 'string' ? v : JSON.stringify(v)}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`), Buffer.from(file.data), Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

/** Plan an upload, run it, wait: {plan, done}. */
export async function planAndRun(srv, who, fields, file) {
  const f = form(fields, file);
  const p = await who.post('/import/site', f.body, { headers: f.headers });
  if (p.status !== 201) throw new Error(`plan: ${p.status} ${p.text}`);
  const r = await who.post(`/import/${p.json.run.id}/run`, {});
  if (r.status !== 202) throw new Error(`run: ${r.status} ${r.text}`);
  await srv.app.jobs.idle();
  return { plan: p.json.plan, run: p.json.run, done: (await who.get(`/import/${p.json.run.id}`)).json };
}
