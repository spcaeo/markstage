// An approximate place for a form message (src/geo): a MaxMind DB reader checked on files written here in both
// schemas (MaxMind's GeoLite2 City and DB-IP's City Lite), every record size, IPv4 and IPv6 trees, pointers and
// every data type; putting a file in place; and a lead that gets its place from the address a trusted proxy saw.
// Made-up places on documentation addresses only.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { as, makeFixture, startServer } from './helpers.mjs';
import { loadConfig } from '../src/app.mjs';
import { CONTACT_CONFIG, SITE, sitePost } from './forms-support.mjs';
import { writeMmdb } from './mmdb-writer.mjs';
import { MmdbError, openMmdb } from '../src/geo/mmdb.mjs';
import { createGeo, installGeo, placeOf } from '../src/geo/index.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/markstage-server.mjs');
const MAXMIND = {
  city: { geoname_id: { uint32: 6167865 }, names: { en: 'Toronto', fr: 'Toronto' } },
  continent: { code: 'NA', names: { en: 'North America' } },
  country: { iso_code: 'CA', names: { en: 'Canada', fr: 'Canada' } },
  location: { accuracy_radius: { uint16: 50 }, latitude: 43.7, longitude: -79.4, time_zone: 'America/Toronto' },
  subdivisions: [{ iso_code: 'ON', names: { en: 'Ontario' } }],
};
const DBIP = { city: { names: { en: 'Pune' } }, continent: { code: 'AS', names: { en: 'Asia' } }, country: { iso_code: 'IN', names: { en: 'India' } }, location: { latitude: 18.52, longitude: 73.86 }, subdivisions: [{ names: { en: 'Maharashtra' } }] };
const ODD = { filler: 'x'.repeat(3000), city: { names: { en: 'Kitchener' } }, n: { int32: -42 }, f: { float: 1.5 }, big: { uint64: 2n ** 60n }, yes: true, list: ['a', 'b', { uint16: 7 }], long: 'y'.repeat(300) };
const NETWORKS = [
  { cidr: '203.0.113.0/24', data: MAXMIND },
  { cidr: '198.51.100.128/25', data: DBIP },
  { cidr: '192.0.2.0/28', data: ODD },
  // the same place again, after the filler: its strings are pointers past 2048 bytes
  { cidr: '192.0.2.16/28', data: { city: { names: { en: 'Kitchener' } }, country: { names: { en: 'Canada' } } } },
];

describe('the MaxMind DB reader', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(makeFixture({ checks: false }).run, 'geo-'));
  });

  for (const recordSize of [24, 28, 32]) {
    for (const ipVersion of [4, 6]) {
      test(`${recordSize}-bit records, an IPv${ipVersion} tree: places in both schemas, misses, and every type`, () => {
        const file = path.join(dir, `city-${recordSize}-${ipVersion}.mmdb`);
        fs.writeFileSync(file, writeMmdb({ networks: NETWORKS, ipVersion, recordSize }));
        const db = openMmdb(file);
        try {
          assert.deepEqual([db.metadata.record_size, db.metadata.ip_version, db.metadata.database_type, db.metadata.build_epoch], [recordSize, ipVersion, 'GeoLite2-City', 1761609600]);
          assert.equal(placeOf(db.get('203.0.113.7')), 'Toronto, Ontario, Canada');
          assert.equal(placeOf(db.get('203.0.113.255')), 'Toronto, Ontario, Canada');
          assert.equal(placeOf(db.get('198.51.100.200')), 'Pune, Maharashtra, India');
          assert.equal(db.get('198.51.100.5'), null, 'the other half of the /24 is not in it');
          assert.equal(placeOf(db.get('192.0.2.20')), 'Kitchener, Canada');
          assert.equal(placeOf(db.get(`::ffff:203.0.113.9`)), 'Toronto, Ontario, Canada', 'an IPv4 address as IPv6 sockets give it');
          for (const miss of ['127.0.0.1', '10.1.2.3', '2001:db8::1', 'not an address', '', null]) assert.equal(db.get(miss), null, String(miss));
          const odd = db.get('192.0.2.3');
          assert.deepEqual([odd.n, odd.f, odd.big, odd.yes, odd.list, odd.long.length, odd.filler.length], [-42, 1.5, 2n ** 60n, true, ['a', 'b', 7], 300, 3000]);
          assert.deepEqual(db.get('203.0.113.1').location, { accuracy_radius: 50, latitude: 43.7, longitude: -79.4, time_zone: 'America/Toronto' });
        } finally {
          db.close();
        }
      });
    }
  }

  test('not a MaxMind DB, or cut short: refused in words', () => {
    const junk = path.join(dir, 'junk.mmdb');
    fs.writeFileSync(junk, Buffer.alloc(5000, 7));
    assert.throws(() => openMmdb(junk), (e) => e instanceof MmdbError && /no MaxMind DB metadata/.test(e.message));
    const whole = writeMmdb({ networks: NETWORKS });
    const cut = path.join(dir, 'cut.mmdb');
    // the metadata kept, the tree and data gone: a lookup runs off the file
    fs.writeFileSync(cut, Buffer.concat([whole.subarray(0, 20), whole.subarray(whole.lastIndexOf(Buffer.from('MaxMind.com')) - 3)]));
    const db = openMmdb(cut);
    assert.throws(() => db.get('203.0.113.7'), MmdbError);
    db.close();
  });

  test('config geoip: a .mmdb file outside the content repo', () => {
    const fx = makeFixture({ checks: false });
    const load = (geoip) => loadConfig({ env: { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' }, overrides: { port: 18999, geoip } });
    assert.throws(() => load({ file: 'city.csv' }), /geoip must be \{ "file": "<path>\.mmdb" \}/);
    assert.throws(() => load({ file: 'city.mmdb', url: 'https://x' }), /geoip must be/);
    assert.throws(() => load({ file: path.join(fx.site, 'city.mmdb') }), /geoip.file must be outside the content repo/);
    assert.deepEqual(load({ file: 'geo/city.mmdb' }).geoip, { file: 'geo/city.mmdb' });
  });

  test('placeOf: either schema; nothing known is null', () => {
    assert.equal(placeOf({ country: { iso_code: 'DE' } }), 'DE');
    assert.equal(placeOf({ city: { names: { de: 'München' } }, country: { names: { en: 'Germany' } } }), 'München, Germany');
    assert.equal(placeOf({ city: { names: { en: 'Singapore' } }, country: { names: { en: 'Singapore' } } }), 'Singapore');
    assert.equal(placeOf({}), null);
    assert.equal(placeOf(null), null);
  });
});

describe('a city file in place, and a lead with its place', () => {
  let fx, srv, hook, admin;
  const config = () => ({ dataDir: fx.data, geoip: null });

  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), CONTACT_CONFIG);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', 'A site with a contact form');
    // the site lists the collections; config.json no longer does
    const cfg = JSON.parse(fs.readFileSync(path.join(fx.data, 'config.json'), 'utf8'));
    fs.writeFileSync(path.join(fx.data, 'config.json'), JSON.stringify({ ...cfg, collections: [] }));
    const files = { '/city.mmdb.gz': zlib.gzipSync(writeMmdb({ networks: NETWORKS, databaseType: 'DBIP-City-Lite', description: { en: 'IP to City Lite by DB-IP' } })), '/asn.mmdb': writeMmdb({ networks: NETWORKS, databaseType: 'GeoLite2-ASN' }) };
    hook = http.createServer((req, res) => (files[req.url] ? res.end(files[req.url]) : ((res.statusCode = 404), res.end())));
    await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  });
  after(async () => {
    await srv?.close();
    await new Promise((r) => hook.close(r));
  });

  test('installed from a URL (gzip) or a file, checked first; a wrong file never replaces a good one', async () => {
    const geo0 = createGeo(config());
    assert.deepEqual([geo0.locate('203.0.113.7'), geo0.status().on], [null, false], 'no file: no place, nothing asked of anyone');
    const base = `http://127.0.0.1:${hook.address().port}`;
    const r = await installGeo(config(), `${base}/city.mmdb.gz`);
    assert.deepEqual([r.file, r.type, r.builtAt, r.attribution], [path.join(fx.data, 'geoip', 'city.mmdb'), 'DBIP-City-Lite', '2025-10-28T00:00:00.000Z', 'IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0']);
    assert.equal(fs.statSync(r.file).mode & 0o777, 0o600);
    await assert.rejects(installGeo(config(), `${base}/asn.mmdb`), /Not a city database: it is a "GeoLite2-ASN" database/);
    await assert.rejects(installGeo(config(), `${base}/missing`), /answered 404/);
    await assert.rejects(installGeo(config(), 'http://geo.example/city.mmdb'), /Use an https:\/\/ address/);
    const junk = path.join(fx.run, 'junk.mmdb');
    fs.writeFileSync(junk, 'not one');
    await assert.rejects(installGeo(config(), junk), /Not a city database: no MaxMind DB metadata/);
    const geo = createGeo(config());
    assert.equal(geo.locate('198.51.100.200'), 'Pune, Maharashtra, India', 'the good file is still there');
    assert.equal(geo.status().attribution, 'IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0');
    geo.close();

    // from the command line, a local file
    const file = path.join(fx.run, 'city.mmdb');
    fs.writeFileSync(file, writeMmdb({ networks: NETWORKS }));
    const out = await promisify(execFile)(process.execPath, [BIN, 'geoip', 'update', file], { env: { ...process.env, MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' } });
    assert.equal(out.stdout.trim(), `The city database is in place: GeoLite2-City, built 2025-10-28, ${path.join(fs.realpathSync(fx.data), 'geoip', 'city.mmdb')}.`);
  });

  test("a lead gets its approximate place from the visitor's address (the hop a trusted proxy appended); the browser has no say", async () => {
    srv = await startServer(fx, { overrides: { collections: [], siteHosts: [SITE], trustProxy: true } });
    admin = await as(srv, 'administrator');
    const lead = { name: 'Ann', email: 'ann@client.example', number: '+1 416 555 0101', comment: 'Forty boards to move, please.', started: String(Date.now() - 20_000), location: 'Paris, France', city: 'Paris' };
    const r = await sitePost(srv.port, '/markstage/forms/contact', lead, { headers: { 'X-Forwarded-For': '9.9.9.9, 203.0.113.7' } });
    assert.equal(r.status, 200, r.text);
    const row = srv.app.db.prepare('SELECT id, ip, meta FROM form_messages').get();
    assert.deepEqual([row.ip, JSON.parse(row.meta).location], ['203.0.113.7', 'Toronto, Ontario, Canada']);
    const one = (await admin.get(`/inbox/${row.id}`)).json;
    assert.equal(one.meta.location, 'Toronto, Ontario, Canada');
    const list = (await admin.get('/inbox')).json;
    assert.equal(list.credits, null, 'a MaxMind file asks for no credit line');
    const h = (await admin.get('/site/health')).json.forms.geoip;
    assert.deepEqual([h.on, h.type], [true, 'GeoLite2-City']);
  });
});
