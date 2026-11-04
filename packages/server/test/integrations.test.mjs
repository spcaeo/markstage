// Integration fields (docs/API-INTEGRATIONS.md): a Post settings select fed by a JSON address, fetched on a schedule
// through the SSRF guard, kept (the last good list survives a failure), searched by editors, and checked on save.
// Against JSON sources on loopback reached through the test seam only; the sign-in is a generated value.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ConfigError } from '../src/config.mjs';
import { loadCore } from '../src/content/converter.mjs';
import { integrationsOf } from '../src/integrations/config.mjs';
import { as, makeFixture, startServer } from './helpers.mjs';
import { startWebSite } from './web-site.mjs';

const PRODUCTS = {
  data: {
    items: [
      { sku: 'SKU-1', name: 'Pallet jack', price: '$120' },
      { sku: 'SKU-2', name: 'Moving blanket', price: '$9' },
      { sku: 'SKU-3', name: 'Dolly\u0007 with straps', price: 40 },
      { name: 'No sku, skipped' },
      { sku: 'SKU-2', name: 'Same sku again, skipped' },
    ],
  },
};

const siteConfig = (src) => `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/',
      settings: [
        { type: 'select', key: 'product', label: 'Product', integration: 'products' },
        { type: 'textarea', key: 'excerpt', label: 'Excerpt' },
      ] },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  integrations: {
    products: { label: 'Products', url: '${src.base}/products.json', every: 60, list: 'data.items', value: 'sku', text: 'name', detail: 'price',
      auth: { header: 'Authorization', scheme: 'Bearer', env: 'MARKSTAGE_INTEGRATION_SHOP' }, maxKB: 4 },
    colors: { url: '${src.base}/colors.json', value: 'id', text: 'name', every: 5 },
    huge: { label: 'Huge', url: '${src.base}/huge.json', value: 'id', text: 'id', maxKB: 1 },
    moved: { url: '${src.base}/moved.json', value: 'id', text: 'id', auth: { env: 'MARKSTAGE_INTEGRATION_SHOP' } },
    away: { url: '${src.base}/away.json', value: 'id', text: 'id', auth: { env: 'MARKSTAGE_INTEGRATION_SHOP' } },
  },
};
`;

describe('integration fields', () => {
  let fx, srv, src, other, clock, ed, author, contributor, admin;
  const token = `tok-${crypto.randomBytes(12).toString('hex')}`;
  const seen = { products: [], list: [] };
  const reply = { products: () => ({ type: 'application/json', body: JSON.stringify(PRODUCTS) }) };
  const status = async (name) => (await ed.get('/integrations')).json.items.find((i) => i.name === name);
  const tick = () => srv.app.integrations.tick();
  // the fake clock moved on past the sessions: everyone signs in again
  const later = async (ms) => {
    clock.now += ms;
    for (const who of [ed, author, contributor, admin]) await who.login(who.user.email, who.user.password);
  };

  before(async () => {
    process.env.MARKSTAGE_INTEGRATION_SHOP = token;
    other = await startWebSite({
      '/list.json': (req) => {
        seen.list.push(req.headers);
        return { type: 'application/json', body: '[{"id":"far"}]' };
      },
    });
    src = await startWebSite({
      '/products.json': (req) => {
        seen.products.push(req.headers);
        return reply.products();
      },
      '/colors.json': { type: 'application/json', body: JSON.stringify(Array.from({ length: 5003 }, (_, i) => ({ id: `c${i}`, name: `Colour ${i}` }))) },
      '/huge.json': { type: 'application/json', body: JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: `item-${i}` }))) },
      '/moved.json': { status: 302, headers: { Location: '/products-moved.json' } },
      '/products-moved.json': (req) => {
        seen.products.push(req.headers);
        return { type: 'application/json', body: '[{"id":"near"}]' };
      },
      '/away.json': { status: 302, headers: { Location: `${other.base}/list.json` } },
    });
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), siteConfig(src));
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'Integrations');
    clock = { now: Date.parse('2026-10-29T09:00:00.000Z') };
    const outbound = { allow: (ip, p) => src.outbound.allow(ip, p) || other.outbound.allow(ip, p) };
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore(), outbound, clock });
    ed = await as(srv, 'editor', { authorSlug: 'alice' });
    author = await as(srv, 'author', { authorSlug: 'alice' });
    contributor = await as(srv, 'contributor', { authorSlug: 'carol' });
    admin = await as(srv, 'administrator');
    await tick();
  });
  after(async () => {
    delete process.env.MARKSTAGE_INTEGRATION_SHOP;
    await srv?.close();
    await src?.close();
    await other?.close();
  });

  test('fetched at start with its sign-in; the list kept with what was skipped; the address and the token never shown', async () => {
    assert.equal(seen.products[0].authorization, `Bearer ${token}`);
    const p = await status('products');
    assert.deepEqual([p.status, p.count, p.skipped, p.label, p.host, p.stale, p.every], ['ok', 3, 2, 'Products', new URL(src.base).host, false, 60]);
    assert.equal(p.fetchedAt, '2026-10-29T09:00:00.000Z');
    assert.equal(p.nextAt, '2026-10-29T10:00:00.000Z');
    const all = (await contributor.get('/integrations')).text;
    assert.ok(!all.includes(token));
    assert.ok(!all.includes('/products.json'));
  });

  test('options: searched by words, value or detail; the current value with its words, a gone one said to be gone', async () => {
    const o = (await contributor.get('/integrations/products/options')).json;
    assert.deepEqual(o.items, [
      { value: 'SKU-1', text: 'Pallet jack', detail: '$120' },
      { value: 'SKU-2', text: 'Moving blanket', detail: '$9' },
      { value: 'SKU-3', text: 'Dolly with straps', detail: '40' },
    ]);
    assert.deepEqual((await ed.get('/integrations/products/options?q=BLANKET')).json.items.map((i) => i.value), ['SKU-2']);
    assert.deepEqual((await ed.get('/integrations/products/options?q=sku-3')).json.items.map((i) => i.value), ['SKU-3']);
    assert.deepEqual((await ed.get('/integrations/products/options?q=%24120')).json.items.map((i) => i.value), ['SKU-1']);
    const c = (await ed.get('/integrations/products/options?value=SKU-2&value=OLD-9&limit=1')).json;
    assert.deepEqual([c.items.length, c.total, c.current.map((i) => i.text), c.missing], [1, 3, ['Moving blanket'], ['OLD-9']]);
    assert.equal((await ed.get('/integrations/nope/options')).status, 404);
    assert.equal((await ed.get('/integrations/__proto__/options')).status, 404);
  });

  test('caps: at most 5000 items kept, and an answer over maxKB is not read', async () => {
    const c = await status('colors');
    assert.deepEqual([c.status, c.count, c.skipped], ['ok', 5000, 3]);
    const h = await status('huge');
    assert.equal(h.status, 'failed');
    assert.match(h.error, /sends more than 1 KB/);
    assert.equal(h.count, 0);
    assert.deepEqual((await ed.get('/integrations/huge/options')).json.items, []);
  });

  test('a redirect: the sign-in goes along on the same site, never to another', async () => {
    assert.equal((await status('moved')).count, 1);
    assert.equal(seen.products.at(-1).authorization, token);
    assert.equal((await status('away')).count, 1);
    assert.equal(seen.list.length, 1);
    assert.equal(seen.list[0].authorization, undefined);
  });

  test('a save keeps to the list: a value from it, an old one kept, cleared; another is 422 naming the field', async () => {
    const put = async (frontmatter) => {
      const e = (await ed.get('/collections/posts/entries/hello-world')).json;
      return ed.put('/collections/posts/entries/hello-world', { version: e.version, frontmatter });
    };
    assert.equal((await put({ product: 'SKU-2' })).status, 200);
    const bad = await put({ product: 'NOPE' });
    assert.deepEqual([bad.status, Object.keys(bad.json.fields)], [422, ['product']]);
    assert.match(bad.json.message, /not one of the Products options/);
    assert.equal((await put({ product: { sku: 'SKU-1' } })).status, 422);
    // the list changes: SKU-2 goes; the entry keeps it through other saves, but cannot be set to it again
    reply.products = () => ({ type: 'application/json', body: JSON.stringify({ data: { items: [PRODUCTS.data.items[0]] } }) });
    await later(61 * 60_000);
    await tick();
    assert.equal((await status('products')).count, 1);
    assert.equal((await put({ excerpt: 'Changed, the product kept.' })).status, 200);
    assert.equal((await put({ product: 'SKU-1' })).status, 200);
    assert.equal((await put({ product: 'SKU-2' })).status, 422);
    assert.equal((await put({ product: null })).status, 200);
  });

  test('a failed fetch keeps the last list, marked stale, tells the administrators once, and is tried again sooner', async () => {
    reply.products = () => ({ status: 500, type: 'text/plain', body: `upstream broke ${token}` });
    await later(61 * 60_000);
    await tick();
    let p = await status('products');
    assert.deepEqual([p.status, p.count, p.stale], ['failed', 1, true]);
    assert.match(p.error, /answered 500/);
    assert.equal(Date.parse(p.nextAt) - clock.now, 15 * 60_000);
    assert.deepEqual((await ed.get('/integrations/products/options')).json.items.map((i) => i.value), ['SKU-1']);
    await later(16 * 60_000);
    await tick();
    p = await status('products');
    assert.equal(p.status, 'failed');
    const told = srv.app.db.prepare("SELECT text FROM notices WHERE kind = 'integration.failed' AND text LIKE '%Products%'").all();
    assert.equal(told.length, 1);
    for (const t of [JSON.stringify(told), (await ed.get('/integrations')).text]) assert.ok(!t.includes(token));
  });

  test('refresh: editors and up, once a minute, audited', async () => {
    reply.products = () => ({ type: 'application/json', body: JSON.stringify(PRODUCTS) });
    assert.equal((await author.post('/integrations/products/refresh', {})).status, 403);
    const r = await ed.post('/integrations/products/refresh', {});
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.integration.status, r.json.integration.count, r.json.integration.stale], ['ok', 3, false]);
    const again = await ed.post('/integrations/products/refresh', {});
    assert.equal(again.status, 429);
    assert.equal(again.headers.get('retry-after'), '60');
    await later(61_000);
    assert.equal((await ed.post('/integrations/products/refresh', {})).status, 200);
    const audit = srv.app.db.prepare("SELECT target, ok FROM audit WHERE action = 'integration.refresh'").all();
    assert.deepEqual(audit.map((a) => a.target), ['products', 'products']);
  });
});

describe('integration config', () => {
  const root = '/srv/site';
  const ok = { url: 'https://shop.example.com/p.json', value: 'sku', text: 'name' };
  const refuses = (raw, re, production = true) => assert.throws(() => integrationsOf(raw, { contentRoot: root, production }), (e) => e instanceof ConfigError && re.test(e.message), re.source);

  test('a good one, with its defaults', () => {
    const i = integrationsOf({ products: ok }, { contentRoot: root, production: true }).products;
    assert.deepEqual([i.every, i.maxBytes, i.label, i.list, i.auth], [60, 1024 * 1024, 'products', null, null]);
  });

  test('mistakes are refused in words', () => {
    refuses({ Products: ok }, /short lowercase name/);
    refuses({ p: { ...ok, url: 'http://shop.example.com/p.json' } }, /must be https/);
    refuses({ p: { ...ok, url: 'https://u:pw@shop.example.com/p.json' } }, /must not hold a sign-in/);
    refuses({ p: { ...ok, every: 1 } }, /5 to 1440/);
    refuses({ p: { ...ok, maxKB: 99999 } }, /1 to 5120/);
    refuses({ p: { ...ok, value: '__proto__.x' } }, /dotted path/);
    refuses({ p: { ...ok, text: undefined } }, /text is the key/);
    refuses({ p: { ...ok, token: 'abc' } }, /keys it does not know: token/);
    refuses({ p: { ...ok, auth: { env: 'MARKSTAGE_AI_KEY' } } }, /starts with MARKSTAGE_INTEGRATION_/);
    refuses({ p: { ...ok, auth: { value: 'abc' } } }, /secret itself never goes in the config/);
    refuses({ p: { ...ok, auth: { keyFile: '/srv/site/.secrets/shop' } } }, /outside the site repo/);
    refuses({ p: { ...ok, auth: { keyFile: 'shop.txt' } } }, /absolute path/);
    refuses({ p: { ...ok, auth: { header: 'Cookie', env: 'MARKSTAGE_INTEGRATION_SHOP' } } }, /header name/);
    refuses(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, ok])), /at most 20/);
  });

  test('a setting that picks from an integration the site does not name stops the start', async () => {
    const fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), `export default { collections: [{ id: 'posts', format: 'md', dir: 'src/content/blog', settings: [{ type: 'select', key: 'product', integration: 'shop' }] }] };\n`);
    await assert.rejects(startServer(fx, { overrides: { collections: [] }, core: await loadCore() }), /picks from integration "shop", which integrations does not name/);
  });
});
