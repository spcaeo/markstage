// Uploads check who may send them before taking a lock or reading the body (security review 3 Nov 2026, S7). A
// contributor's Library import used to take the one import lock and read up to 64 MB before the role check: slow
// uploads kept editors' imports out ("Another import is running") and cost disk and memory. Here a contributor
// starts an upload that never finishes; the refusal comes at once, while the body is still being sent, and an
// editor's import meanwhile is not told to wait. The same for a Library item's picture.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { as, makeFixture, startServer } from './helpers.mjs';

/** Start a request whose body is announced at `size` bytes but only `sent` are written; resolves with the answer. */
function slowUpload(srv, who, method, p, { size = 20 * 1024 * 1024, sent = 1024, type = 'application/json' } = {}) {
  const headers = {
    Origin: srv.base,
    Cookie: [...who.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    'X-CSRF-Token': who.csrf,
    'Content-Type': type,
    'Content-Length': String(size),
  };
  let req;
  const answer = new Promise((resolve, reject) => {
    req = http.request({ host: '127.0.0.1', port: srv.port, method, path: `/markstage/api${p}`, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE' ? resolve({ status: 0, text: '' }) : reject(e)));
  });
  req.write(Buffer.alloc(sent, 0x20));
  return { answer, abort: () => req.destroy() };
}

const within = (p, ms, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms (the body was being read first)`)), ms))]);

describe('uploads: the role is checked before the lock and the body (S7)', () => {
  let srv, ed, co;
  before(async () => {
    srv = await startServer(makeFixture({ checks: false }));
    ed = await as(srv, 'editor');
    co = await as(srv, 'contributor');
  });
  after(() => srv.close());

  test('a contributor’s Library import is refused at once, mid-upload, and holds no lock', async () => {
    const up = slowUpload(srv, co, 'POST', '/library/import');
    try {
      const r = await within(up.answer, 3000, 'library import');
      assert.equal(r.status, 403, r.text);
      // while that upload is still open, an editor's import is not told another one is running
      const pack = JSON.stringify({ markstage: 'library-pack', version: 1, items: [] });
      const mine = await ed.request('POST', '/library/import?filename=pack.json&dry=1', { body: pack, headers: { 'Content-Type': 'application/json' } });
      assert.notEqual(mine.status, 409, mine.text);
    } finally {
      up.abort();
    }
  });

  test('a contributor’s new picture for a Library item they cannot change is refused before it is read', async () => {
    const hero = { kind: 'section', name: 'Hero', body: { value: { discriminant: 'hero', value: { heading: 'Hi' } } } };
    const made = await ed.post('/library', hero);
    assert.equal(made.status, 201, made.text);
    const up = slowUpload(srv, co, 'PUT', `/library/${made.json.id}/thumb`, { size: 150 * 1024, type: 'image/png' });
    try {
      const r = await within(up.answer, 3000, 'library thumb');
      assert.equal(r.status, 403, r.text);
    } finally {
      up.abort();
    }
  });
});
