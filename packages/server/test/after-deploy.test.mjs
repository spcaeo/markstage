// After a deploy: the CDN purge command gets the changed addresses, IndexNow gets one POST with them (a test double
// on loopback here), and neither can fail the job: the site is live already, so a failure is a warned step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { as, freePort, makeFixture } from './helpers.mjs';
import { localeServer } from './locale-site.mjs';

const KEY = 'test-indexnow-key-0001';

// the CDN purge: writes what it got to a file the test reads; "fail" in the file name makes it exit 1
const PURGE = `import fs from 'node:fs';
let t = '';
process.stdin.on('data', (d) => (t += d));
process.stdin.on('end', () => {
  fs.appendFileSync(process.argv[2], t + '\\n');
  process.exit(fs.existsSync('.purge-fails') ? 1 : 0);
});
`;

describe('after a deploy: CDN purge and IndexNow', () => {
  let fx;
  let srv;
  let ed;
  let fake;
  let status = 202;
  const got = [];
  let purgeOut;
  const purged = () => (fs.existsSync(purgeOut) ? fs.readFileSync(purgeOut, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const job = async (r) => {
    await srv.app.jobs.idle();
    return (await ed.get(`/jobs/${r.json.job}`)).json;
  };

  before(async () => {
    const port = await freePort();
    fake = http.createServer((req, res) => {
      let t = '';
      req.on('data', (d) => (t += d));
      req.on('end', () => {
        got.push({ method: req.method, path: req.url, type: req.headers['content-type'], body: JSON.parse(t) });
        res.writeHead(status).end();
      });
    });
    await new Promise((r) => fake.listen(port, '127.0.0.1', r));
    // the purge script lives with the operator: here, in a data dir outside the repo
    const ops = makeFixture({ checks: false }).data;
    const purgeScript = path.join(ops, 'purge.mjs');
    fs.writeFileSync(purgeScript, PURGE);
    purgeOut = path.join(ops, 'purged.jsonl');
    ({ fx, srv } = await localeServer({
      purge: { command: [process.execPath, purgeScript, purgeOut] },
      indexNow: { key: KEY, endpoint: `http://127.0.0.1:${port}/indexnow` },
    }));
    ed = await as(srv, 'editor', { authorSlug: 'ed' });
  });
  after(async () => {
    await srv.close();
    await new Promise((r) => fake.close(r));
  });

  test('a publish purges and pings the page in every locale; the key file address goes with it', async () => {
    const e = await ed.get('/collections/posts/entries/hello-world');
    const r = await ed.post('/collections/posts/entries/hello-world/publish', { version: e.json.version });
    assert.equal(r.status, 202, r.text);
    const j = await job(r);
    assert.equal(j.status, 'succeeded', j.error);
    assert.deepEqual(j.steps.map((s) => [s.name, s.status]).slice(-2), [['purge', 'succeeded'], ['indexnow', 'succeeded']]);
    const urls = ['https://example.com/blog/hello-world/', 'https://example.com/en-us/blog/hello-world/'];
    assert.deepEqual(purged().at(-1), { urls });
    const ping = got.at(-1);
    assert.equal(ping.method, 'POST');
    assert.equal(ping.path, '/indexnow');
    assert.match(ping.type, /^application\/json/);
    assert.deepEqual(ping.body, { host: 'example.com', key: KEY, keyLocation: `https://example.com/${KEY}.txt`, urlList: urls });
    // the key is the site's to publish, not the log's to show
    assert.doesNotMatch(j.log, new RegExp(KEY));
  });

  test('a move names the new address, the old one and the pages whose links changed', async () => {
    const e = await ed.get('/collections/posts/entries/hello-world');
    const r = await ed.post('/collections/posts/entries/hello-world/move', { version: e.json.version, newId: 'hello-moved' });
    assert.equal(r.status, 202, r.text);
    assert.equal((await job(r)).status, 'succeeded');
    const urls = got.at(-1).body.urlList;
    for (const u of ['/blog/hello-moved/', '/en-us/blog/hello-moved/', '/blog/hello-world/', '/en-us/blog/hello-world/', '/blog/linker/']) assert.ok(urls.includes(`https://example.com${u}`), u);
  });

  test('a whole-site rebuild purges everything and pings nobody', async () => {
    const before = got.length;
    const admin = await as(srv, 'administrator');
    const r = await admin.post('/site/publish', {});
    assert.equal(r.status, 202, r.text);
    await srv.app.jobs.idle();
    assert.deepEqual(purged().at(-1), { all: true });
    assert.equal(got.length, before);
  });

  test('a failed purge or a refused ping is a warning: the job still succeeds', async () => {
    fs.writeFileSync(path.join(fx.site, '.purge-fails'), '');
    status = 403; // the key file is not on the site
    try {
      const e = await ed.get('/collections/posts/entries/linker');
      const r = await ed.post('/collections/posts/entries/linker/publish', { version: e.json.version });
      const j = await job(r);
      assert.equal(j.status, 'succeeded', j.error);
      assert.deepEqual(j.steps.slice(-2).map((s) => [s.name, s.status]), [['purge', 'warned'], ['indexnow', 'warned']]);
      assert.match(j.log, /visitors may see the old page/);
      assert.match(j.log, /403/);
    } finally {
      fs.rmSync(path.join(fx.site, '.purge-fails'));
      status = 202;
    }
  });
});

test('config: the IndexNow key and endpoint, and the purge command, are checked at start', () => {
  const fx = makeFixture({ checks: false });
  const env = { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
  assert.throws(() => loadConfig({ env, overrides: { indexNow: { key: 'short' } } }), /8 to 128/);
  assert.throws(() => loadConfig({ env, overrides: { indexNow: { key: KEY, endpoint: 'http://indexnow.example/x' } } }), /must be https/);
  assert.equal(loadConfig({ env, overrides: { indexNow: { key: KEY } } }).indexNow.endpoint, 'https://api.indexnow.org/indexnow');
  assert.throws(() => loadConfig({ env, overrides: { purge: { command: 'curl -X POST' } } }), /argv, no shell/);
});
