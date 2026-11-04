// A JSON collection with a Keystatic schema (site config `schema: {keystatic, options}`): saves write the file the
// way Keystatic's own Save does (schema key order, empty values left out), so an inserted section is byte-identical
// to Keystatic's output; GET collections/:c/schema gives the editor the fields.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { keystaticPolicy } from '@markstage/core/json/keystatic';
import { loadCore } from '../src/content/converter.mjs';
import { as, makeFixture, readFile, startServer } from './helpers.mjs';

// field objects shaped like @keystatic/core's `fields.*` (as in core's own keystatic test)
const KEYSTATIC = `const text = (label) => ({ kind: 'form', label, defaultValue: () => '', validate: (v) => v });
const integer = (label) => ({ kind: 'form', label, defaultValue: () => null, validate(value) { validateInteger(value); return value; } });
const validateInteger = () => undefined;
const checkbox = (label, d = false) => ({ kind: 'form', label, defaultValue: () => d });
const select = (label, values, d) => ({ kind: 'form', label, options: values.map((v) => ({ label: v, value: v })), defaultValue: () => d });
const object = (fields, label) => ({ kind: 'object', fields, label });
export default {
  collections: {
    pages: {
      label: 'Pages',
      path: 'src/content/pages/*',
      format: { data: 'json' },
      schema: {
        title: text('Title'),
        uri: text('URI'),
        sections: {
          kind: 'array',
          label: 'Sections',
          element: {
            kind: 'conditional',
            discriminant: select('Kind', ['hero', 'prose'], 'prose'),
            values: {
              hero: object({
                heading: text('Heading'),
                lead: text('Lead (HTML)'),
                image: object({ src: text('Path'), alt: text('Alt'), width: integer('W'), height: integer('H') }, 'Image'),
                button: object({ text: text('Text'), href: text('Link'), external: checkbox('External') }, 'Button'),
              }),
              prose: object({ html: text('HTML') }),
            },
          },
        },
      },
    },
  },
};
`;

const SITE_CONFIG = `export default {
  collections: [
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', fields: { url: 'uri' } },
  ],
  schema: { keystatic: './keystatic.config.mjs', options: { rich: (f) => /\\(HTML\\)|^HTML$/.test(f.label) } },
};
`;

/** What Keystatic's Save writes for `value`: keys in schema order, empty values left out, 2-space JSON + newline. */
function keystaticSave(field, value) {
  const ser = (f, v) => {
    if (f?.type === 'object' && v && typeof v === 'object') {
      const out = {};
      for (const [k, sub] of Object.entries(f.fields)) {
        if (!(k in v)) continue;
        const s = ser(sub, v[k]);
        if (s === undefined || keystaticPolicy.omit(s, sub)) continue;
        out[k] = s;
      }
      return out;
    }
    if (f?.type === 'array' && Array.isArray(v)) return v.map((x) => ser(f.item, x));
    if (f?.type === 'conditional' && v && typeof v === 'object') return { discriminant: v.discriminant, value: ser(f.values[v.discriminant], v.value) };
    return v;
  };
  return `${JSON.stringify(ser(field, value), null, 2)}\n`;
}

// a new hero as an editor inserts it: every field present, most of them empty
const NEW_HERO = { discriminant: 'hero', value: { heading: 'Fresh', lead: '', image: { src: '', alt: '', width: null, height: null }, button: { text: 'Go', href: '/go/', external: false } } };

describe('Keystatic schema', () => {
  let fx, srv, ed;
  before(async () => {
    fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'keystatic.config.mjs'), KEYSTATIC);
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    srv = await startServer(fx, { overrides: { collections: [] }, core: await loadCore() });
    ed = await as(srv, 'editor');
  });
  after(() => srv.close());

  test('GET collections/:c/schema: the fields; 404 for a collection without one', async () => {
    const r = await ed.get('/collections/pages/schema');
    assert.equal(r.status, 200);
    assert.equal(r.json.entry.type, 'object');
    assert.deepEqual(Object.keys(r.json.entry.fields), ['title', 'uri', 'sections']);
    assert.equal(r.json.entry.fields.sections.item.type, 'conditional');
    assert.equal(r.json.entry.fields.sections.item.values.hero.fields.lead.rich, true, 'options from the site config reach the schema');
    const none = await ed.get('/collections/posts/schema');
    assert.equal(none.status, 404);
    assert.equal(none.json.error, 'no-schema');
  });

  test('an inserted section is byte-identical to what Keystatic would save', async () => {
    const e = await ed.get('/collections/pages/entries/about');
    const r = await ed.put('/collections/pages/entries/about', { version: e.json.version, changes: [{ op: 'insert', path: 'sections', index: 1, value: NEW_HERO }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const text = readFile(fx, 'src/content/pages/about.json');
    const schema = (await ed.get('/collections/pages/schema')).json.entry;
    assert.equal(text, keystaticSave(schema, JSON.parse(text)), 'Keystatic re-saving it changes nothing');
    const hero = JSON.parse(text).sections[1];
    assert.deepEqual(hero, { discriminant: 'hero', value: { heading: 'Fresh', image: {}, button: { text: 'Go', href: '/go/', external: false } } });
    // the untouched first section kept its bytes
    assert.ok(text.startsWith('{\n  "title": "About",\n  "uri": "/about/",\n  "sections": [\n    {\n      "discriminant": "hero",\n      "value": {\n        "heading": "We are here"\n      }\n    },'));
  });

  test('a set that empties a field drops the key, as Keystatic does', async () => {
    const e = await ed.get('/collections/pages/entries/about');
    const r = await ed.put('/collections/pages/entries/about', { version: e.json.version, changes: [{ path: 'sections.1.value.heading', value: '' }] });
    assert.equal(r.status, 200);
    const text = readFile(fx, 'src/content/pages/about.json');
    assert.equal(JSON.parse(text).sections[1].value.heading, undefined);
    assert.equal(text, keystaticSave((await ed.get('/collections/pages/schema')).json.entry, JSON.parse(text)));
  });
});

describe('without a schema', () => {
  test('the same insert keeps every empty key (why the schema matters)', async () => {
    const fx = makeFixture({ checks: false });
    const srv = await startServer(fx);
    try {
      const ed = await as(srv, 'editor');
      const e = await ed.get('/collections/pages/entries/about');
      assert.equal((await ed.put('/collections/pages/entries/about', { version: e.json.version, changes: [{ op: 'insert', path: 'sections', index: 1, value: NEW_HERO }] })).status, 200);
      assert.equal(JSON.parse(readFile(fx, 'src/content/pages/about.json')).sections[1].value.lead, '');
    } finally {
      await srv.close();
    }
  });

  test("a schema collection without core's JSON engine: 503, not a silent non-Keystatic write", async () => {
    const fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'keystatic.config.mjs'), KEYSTATIC);
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG);
    const srv = await startServer(fx, { overrides: { collections: [] } });
    try {
      const ed = await as(srv, 'editor');
      const e = await ed.get('/collections/pages/entries/about');
      const before = readFile(fx, 'src/content/pages/about.json');
      const r = await ed.put('/collections/pages/entries/about', { version: e.json.version, changes: [{ op: 'insert', path: 'sections', index: 1, value: NEW_HERO }] });
      assert.equal(r.status, 503);
      assert.equal(readFile(fx, 'src/content/pages/about.json'), before, 'nothing written');
    } finally {
      await srv.close();
    }
  });

  test('a schema.keystatic that is not a file in the repo is refused at start', async () => {
    const fx = makeFixture({ checks: false });
    fs.writeFileSync(path.join(fx.site, 'markstage.config.mjs'), SITE_CONFIG.replace('./keystatic.config.mjs', '../outside.mjs'));
    await assert.rejects(startServer(fx, { overrides: { collections: [] } }), /schema\.keystatic: \.\.\/outside\.mjs is not a file in the site repo/);
  });
});
