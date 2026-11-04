// The site's link-card data (site config editor.linkCards) on the CMS origin: the editor fetches it from its own
// origin, so the server answers that one path with the file from the last build; nothing else outside its base path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadCore } from '../src/content/converter.mjs';
import { client, makeFixture, startServer } from './helpers.mjs';

const SITE = `export default {
  siteUrl: 'https://example.com',
  collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' }],
  editor: { linkCards: { url: '/link-cards.json', fields: { title: 't', description: 'd', image: 'i', tag: 'g', date: 'w' } } },
};
`;

let fx;
let srv;
before(async () => {
  fx = makeFixture({ checks: false });
  fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE);
  fx.git('add', '-A');
  fx.git('commit', '-q', '-m', 'Link cards');
  srv = await startServer(fx, { overrides: { collections: [], verify: { public: 'dist' } }, core: await loadCore() });
});
after(() => srv.close());

test('the link-card data from the last build, at its own path; none before a build; nothing else is served there', async () => {
  const c = client(srv.base);
  assert.equal((await c.get(`${srv.base}/link-cards.json`)).status, 404, 'no build yet');
  fs.mkdirSync(path.join(fx.site, 'dist'), { recursive: true });
  const cards = { '/blog/hello-world/': { t: 'Hello World', d: 'The first post.' } };
  fs.writeFileSync(path.join(fx.site, 'dist/link-cards.json'), JSON.stringify(cards));
  fs.writeFileSync(path.join(fx.site, 'dist/other.json'), '{}');
  const r = await c.get(`${srv.base}/link-cards.json`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(r.json, cards);
  assert.equal((await c.post(`${srv.base}/link-cards.json`, {})).status, 405);
  assert.equal((await c.get(`${srv.base}/other.json`)).status, 404, 'only the configured path');
  assert.equal(srv.config.linkCards.url, '/link-cards.json');
});
