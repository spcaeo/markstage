// The dev API's JSON routes (api-json.mjs) on a throwaway project with a Keystatic schema: GET schema, saves as
// `changes` that move only the changed characters, inserts in the schema's key order, 409, refused paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createConverter, readFrontmatter, setFrontmatter } from '@markstage/core';
import { devApi } from '../src/api.mjs';
import { normalizeConfig } from '../src/config.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-json-')));
const PAGE = `{
  "title": "Home",
  "uri": "/",
  "modified": "2026-10-01T00:00:00+00:00",
  "sections": [
    {
      "discriminant": "hero",
      "value": {
        "heading": "Hello",
        "lead": "<p>Lead</p>"
      }
    }
  ]
}
`;
// Field objects shaped like @keystatic/core's (as in core's keystatic adapter tests)
const KEYSTATIC = `
const text = (label) => ({ kind: 'form', formKind: 'slug', label, defaultValue: () => '', validate: (v) => v });
const select = (label, values, d) => ({ kind: 'form', label, options: values.map((v) => ({ label: v, value: v })), defaultValue: () => d });
const object = (fields, label) => ({ kind: 'object', fields, label });
const array = (element, label) => ({ kind: 'array', element, label });
const conditional = (discriminant, values) => ({ kind: 'conditional', discriminant, values });
export default {
  collections: {
    pages: {
      label: 'Pages',
      path: 'src/content/pages/*',
      format: { data: 'json' },
      schema: {
        title: text('Title'),
        uri: text('URL path'),
        modified: text('Modified'),
        sections: array(
          conditional(select('Kind', ['hero', 'cta'], 'hero'), {
            hero: object({ heading: text('Heading'), lead: text('Lead (HTML)') }),
            cta: object({ heading: text('Heading'), button: text('Button') }),
          }),
          'Sections',
        ),
      },
    },
  },
};
`;
let server;
let base;
let origin;
const file = path.join(root, 'src/content/pages/home.json');
const other = path.join(root, 'src/content/notes/a.json');

before(async () => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(file, PAGE);
  fs.writeFileSync(other, '{\n  "text": "a"\n}\n');
  fs.writeFileSync(path.join(root, 'keystatic.config.mjs'), KEYSTATIC);
  const raw = {
    siteName: 'Test',
    schema: { keystatic: './keystatic.config.mjs' },
    collections: [
      { id: 'pages', format: 'json', dir: 'src/content/pages', url: ({ data }) => data.uri },
      { id: 'notes', format: 'json', dir: 'src/content/notes' },
    ],
  };
  fs.writeFileSync(path.join(root, 'markstage.config.mjs'), `export default ${JSON.stringify(raw).replace('"url":{}', 'url: ({ data }) => data.uri')};\n`);
  const api = devApi(normalizeConfig(raw, root), async () => ({ md: createConverter(), readFrontmatter, setFrontmatter }), { error() {} });
  server = http.createServer((req, res) => api(req, res, () => ((res.statusCode = 404), res.end())));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  base = `${origin}/markstage/api`;
});
after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const get = (p) => fetch(`${base}/${p}`);
const put = (p, body) => fetch(`${base}/${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
const version = async (c, id) => (await (await get(`collections/${c}/entries/${id}`)).json()).version;

test('GET schema: the Keystatic collection with the same folder; 404 for a collection without one', async () => {
  const r = await get('collections/pages/schema');
  assert.equal(r.status, 200);
  const { entry } = await r.json();
  assert.equal(entry.type, 'object');
  assert.equal(entry.fields.sections.item.type, 'conditional');
  assert.deepEqual(Object.keys(entry.fields.sections.item.values), ['hero', 'cta']);
  const none = await get('collections/notes/schema');
  assert.equal(none.status, 404);
  assert.equal((await none.json()).error, 'no-schema');
});

test('PUT changes: only the changed value moves', async () => {
  const r = await put('collections/pages/entries/home', { version: await version('pages', 'home'), changes: [{ op: 'set', path: 'sections.0.value.heading', value: 'Hello there' }] });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.ok, true);
  const saved = fs.readFileSync(file, 'utf8');
  const stamp = JSON.parse(saved).modified;
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/, 'modified set to now, in the file\'s own format');
  assert.ok(Date.now() - Date.parse(stamp) < 60000);
  assert.equal(saved, PAGE.replace('"heading": "Hello"', '"heading": "Hello there"').replace('2026-10-01T00:00:00+00:00', stamp));
  fs.writeFileSync(file, PAGE);
});

test('modified: kept when nothing changed or the save sets it; the format follows the file', async () => {
  const same = await put('collections/pages/entries/home', { version: await version('pages', 'home'), changes: [{ path: 'title', value: 'Home' }] });
  assert.equal(same.status, 200);
  assert.equal(fs.readFileSync(file, 'utf8'), PAGE);
  await put('collections/pages/entries/home', { version: await version('pages', 'home'), changes: [{ path: 'title', value: 'X' }, { path: 'modified', value: '2020-01-01T00:00:00+00:00' }] });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).modified, '2020-01-01T00:00:00+00:00');
  fs.writeFileSync(file, PAGE);
  const { stampLike } = await import('../src/api-json.mjs');
  const now = new Date('2026-10-28T12:34:56.789Z');
  assert.equal(stampLike('2026-01-01', now), '2026-10-28');
  assert.equal(stampLike('2026-01-01T00:00:00Z', now), '2026-10-28T12:34:56Z');
  assert.equal(stampLike('2026-01-01T00:00:00-05:00', now), '2026-10-28T12:34:56+00:00');
  assert.equal(stampLike('last week', now), null);
});

test('PUT insert: a new section in the schema key order; move and remove bring the file back', async () => {
  const v = await version('pages', 'home');
  const r = await put('collections/pages/entries/home', {
    version: v,
    changes: [{ op: 'insert', path: 'sections', index: 1, value: { discriminant: 'cta', value: { button: 'Go', heading: 'Call' } } }],
  });
  assert.equal(r.status, 200);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.indexOf('"heading": "Call"') < text.indexOf('"button": "Go"'), 'heading before button, as the schema lists them');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/"modified": "[^"]*"/, '"modified": "2026-10-01T00:00:00+00:00"'));
  const r2 = await put('collections/pages/entries/home', {
    version: await version('pages', 'home'),
    changes: [
      { op: 'move', path: 'sections', from: 1, to: 0 },
      { op: 'move', path: 'sections', from: 0, to: 1 },
      { op: 'remove', path: 'sections.1' },
      { path: 'modified', value: '2026-10-01T00:00:00+00:00' },
    ],
  });
  assert.equal(r2.status, 200);
  assert.equal(fs.readFileSync(file, 'utf8'), PAGE);
});

test('PUT: 409 on a stale version, 400 for refused paths and bodies without changes, 422 for one that cannot apply', async () => {
  const stale = await put('collections/pages/entries/home', { version: 'old', changes: [{ path: 'title', value: 'X' }] });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).version, await version('pages', 'home'));
  const v = await version('pages', 'home');
  assert.equal((await put('collections/pages/entries/home', { version: v, changes: [{ path: '__proto__.x', value: 1 }] })).status, 400);
  assert.equal((await put('collections/pages/entries/home', { version: v, changes: [{ op: 'explode', path: 'title' }] })).status, 400);
  assert.equal((await put('collections/pages/entries/home', { version: v, data: { title: 'X' } })).status, 400);
  assert.equal((await put('collections/pages/entries/home', { version: v, changes: [{ op: 'move', path: 'title', from: 0, to: 1 }] })).status, 422);
  assert.equal(fs.readFileSync(file, 'utf8'), PAGE);
});

test('PUT changes without a schema: applied as written', async () => {
  const r = await put('collections/notes/entries/a', { version: await version('notes', 'a'), changes: [{ path: 'text', value: 'b' }] });
  assert.equal(r.status, 200);
  assert.equal(fs.readFileSync(other, 'utf8'), '{\n  "text": "b"\n}\n');
});
