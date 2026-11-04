// The dev API hands the links and topics screens to a Markstage server on this machine (MARKSTAGE_DEV_SERVER):
// reads and writes pass through as they came, other routes stay local, and only a loopback server may be named.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createConverter, readFrontmatter, setFrontmatter } from '@markstage/core';
import { devApi } from '../src/api.mjs';
import { forwardTarget, forwarded } from '../src/api-forward.mjs';
import { normalizeConfig } from '../src/config.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-fwd-')));
const seen = [];
let upstream;
let dev;
let base;
let origin;

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));

before(async () => {
  fs.mkdirSync(path.join(root, 'src/content/posts'), { recursive: true });
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      res.statusCode = req.url.includes('missing') ? 404 : 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ from: 'server', url: req.url }));
    });
  });
  const target = await listen(upstream);
  const cfg = normalizeConfig({ siteName: 'Test', collections: [{ id: 'posts', format: 'md', dir: 'src/content/posts', url: '/posts/{id}/' }] }, root);
  const api = devApi(cfg, async () => ({ md: createConverter(), readFrontmatter, setFrontmatter }), { error() {} }, { forward: target });
  dev = http.createServer((req, res) => api(req, res, () => ((res.statusCode = 404), res.end())));
  origin = await listen(dev);
  base = `${origin}/markstage/api`;
});
after(() => {
  upstream.close();
  dev.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('links and topics go to the server, with the query, the body and its status', async () => {
  const r = await fetch(`${base}/links/health?topic=a`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { from: 'server', url: '/markstage/api/links/health?topic=a' });
  const w = await fetch(`${base}/links/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ id: 'sg_1' }) });
  assert.equal(w.status, 200);
  assert.deepEqual(seen.at(-1), { method: 'POST', url: '/markstage/api/links/accept', body: '{"id":"sg_1"}' });
  assert.equal((await fetch(`${base}/topics/missing`)).status, 404);
  assert.equal((await fetch(`${base}/site/undo`, { method: 'POST', headers: { Origin: origin } })).status, 200);
});

test('everything else stays in the dev API; a write from another origin never reaches the server', async () => {
  const n = seen.length;
  assert.equal((await fetch(`${base}/collections`)).status, 200);
  assert.equal((await fetch(`${base}/users`)).status, 404);
  assert.equal((await fetch(`${base}/links/accept`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal(seen.length, n);
  assert.deepEqual(['links', 'topics', 'site/undo', 'site', 'collections'].map((p) => forwarded(p.split('/'))), [true, true, true, false, false]);
});

test('only a server on this machine may be named', () => {
  assert.equal(forwardTarget(undefined), null);
  assert.equal(forwardTarget('http://127.0.0.1:18323/'), 'http://127.0.0.1:18323');
  assert.throws(() => forwardTarget('https://cms.example.com'), /server on this machine/);
  assert.throws(() => forwardTarget('http://10.0.0.5:18323'), /server on this machine/);
});
