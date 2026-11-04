import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JsonEntry } from '../../src/json/index.mjs';
import { describe, keystaticSchema, keystaticPolicy, loadKeystaticSchema } from '../../src/json/adapters/keystatic.mjs';

// Field objects shaped like the ones @keystatic/core's `fields.*` return (checked against @keystatic/core 0.5).
const validateInteger = () => undefined;
const validateNumber = () => undefined;
const assertRequired = () => undefined;
const ks = {
  text: (label) => ({ kind: 'form', formKind: 'slug', label, defaultValue: () => '', validate: (v) => v }),
  integer: (label) => ({ kind: 'form', label, defaultValue: () => null, validate(value) { validateInteger(value); assertRequired(value); return value; } }),
  number: (label) => ({ kind: 'form', label, defaultValue: () => null, validate(value) { validateNumber(value); return value; } }),
  relationship: (label) => ({ kind: 'form', label, defaultValue: () => null, validate(value) { assertRequired(value); return value; } }),
  multiRelationship: (label) => ({ kind: 'form', label, defaultValue: () => [], parse(value) { if (!Array.isArray(value)) throw new Error('Must be an array of strings'); return value; } }),
  checkbox: (label, d = false) => ({ kind: 'form', label, defaultValue: () => d }),
  select: (label, values, d) => ({ kind: 'form', label, options: values.map((v) => ({ label: v, value: v })), defaultValue: () => d }),
  image: (label) => ({ kind: 'form', formKind: 'asset', label, directory: 'public/img', defaultValue: () => null }),
  ignored: () => ({ kind: 'form', label: 'Ignored', defaultValue: () => ({ value: undefined }) }),
  slug: (label) => ({ kind: 'form', formKind: 'slug', label, defaultValue: () => ({ name: '', slug: '' }), serialize: (v) => ({ value: undefined, slug: v.slug }) }),
  content: (label) => ({ kind: 'form', formKind: 'content', label, contentExtension: '.md', defaultValue: () => '' }),
  custom: (label) => ({ kind: 'form', label, defaultValue: () => ({ text: '', on: false }) }),
  object: (fields, label) => ({ kind: 'object', fields, label }),
  array: (element, label) => ({ kind: 'array', element, label }),
  conditional: (discriminant, values) => ({ kind: 'conditional', discriminant, values }),
};
const imagePath = ks.object({ src: ks.text('Path'), alt: ks.text('Alt'), width: ks.integer('W'), height: ks.integer('H') }, 'Image');
const CONFIG = {
  collections: {
    pages: {
      label: 'Pages',
      path: 'content/pages/*',
      format: { data: 'json' },
      slugField: 'file',
      schema: {
        file: ks.slug('File'),
        wpId: ks.ignored(),
        title: ks.text('Title'),
        order: ks.integer('Order'),
        rating: ks.number('Rating'),
        author: ks.relationship('Author'),
        tags: ks.multiRelationship('Tags'),
        exitPopup: ks.checkbox('Exit popup', true),
        cover: ks.image('Cover'),
        sticky: ks.custom('Sticky bar'),
        sections: ks.array(
          ks.conditional(ks.select('Kind', ['hero', 'prose'], 'prose'), {
            hero: ks.object({ heading: ks.text('Heading'), lead: ks.text('Lead (HTML)'), image: imagePath, link: ks.object({ href: ks.text('Link'), text: ks.text('Text') }), button: ks.object({ text: ks.text('Text'), href: ks.text('Link'), external: ks.checkbox('External') }), site: ks.text('Site') }),
            prose: ks.object({ html: ks.text('HTML') }),
          }),
          'Sections',
        ),
      },
    },
    posts: { label: 'Posts', path: 'content/posts/*', format: { data: 'yaml', contentField: 'body' }, slugField: 'slug', schema: { slug: ks.text('Slug'), body: ks.content('Body') } },
  },
  singletons: { settings: { label: 'Settings', path: 'content/settings', schema: { name: ks.text('Name') } } },
};
const OPTIONS = {
  rich: (f) => /\(HTML\)|^HTML$/.test(f.label),
  url: (f, p) => p.endsWith('.site'),
  collections: (f, p) => ({ 'pages.author': 'authors', 'pages.tags': 'tags' })[p],
};

test('keystaticSchema: every field kind becomes a Markstage field', () => {
  const s = keystaticSchema(CONFIG, OPTIONS);
  assert.equal(s.version, 1);
  assert.equal(s.source, 'keystatic');
  const p = s.collections.pages;
  assert.deepEqual({ path: p.path, format: p.format, slugField: p.slugField }, { path: 'content/pages/*', format: { data: 'json' }, slugField: 'file' });
  const f = p.entry.fields;
  assert.deepEqual(f.file, { type: 'slug', label: 'File', stored: false });
  assert.deepEqual(f.wpId, { type: 'ignored' });
  assert.deepEqual(f.title, { type: 'text', label: 'Title' });
  assert.deepEqual(f.order, { type: 'number', label: 'Order', integer: true });
  assert.deepEqual(f.rating, { type: 'number', label: 'Rating' });
  assert.deepEqual(f.author, { type: 'relationship', label: 'Author', collection: 'authors' });
  assert.deepEqual(f.tags, { type: 'relationship', label: 'Tags', multiple: true, collection: 'tags' });
  assert.deepEqual(f.exitPopup, { type: 'checkbox', label: 'Exit popup', default: true });
  assert.deepEqual(f.cover, { type: 'image', label: 'Cover', directory: 'public/img' });
  assert.deepEqual(f.sticky, { type: 'custom', label: 'Sticky bar', default: { text: '', on: false } });
  const sec = f.sections.item;
  assert.equal(sec.type, 'conditional');
  assert.deepEqual(sec.discriminant.options.map((o) => o.value), ['hero', 'prose']);
  assert.equal(sec.discriminant.default, 'prose');
  assert.deepEqual(sec.values.hero.fields.lead, { type: 'text', label: 'Lead (HTML)', multiline: true, rich: true });
  assert.equal(sec.values.hero.fields.image.role, 'image');
  assert.equal(sec.values.hero.fields.link.role, 'link');
  assert.equal(sec.values.hero.fields.button.role, 'link'); // other keys beside href and text
  assert.deepEqual(sec.values.hero.fields.site, { type: 'url', label: 'Site' });
  assert.equal(sec.values.prose.fields.html.rich, true);
  assert.deepEqual(s.collections.posts.entry.fields.body, { type: 'content', label: 'Body', extension: '.md' });
  assert.deepEqual(s.singletons.settings.format, { data: 'yaml' });
  // plain JSON: what the editor receives
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('describe: the dotted path the hints see', () => {
  const seen = [];
  describe(CONFIG.collections.pages.schema.sections, 'pages.sections', { rich: (f, p) => (seen.push(p), false) });
  assert.ok(seen.includes('pages.sections.*.value.heading'));
  assert.ok(seen.includes('pages.sections.*.value.image.alt'));
});

test('keystaticPolicy: what Keystatic leaves out of the file', () => {
  const s = keystaticSchema(CONFIG, OPTIONS).collections.pages.entry;
  const e = JsonEntry.parse('{\n  "title": "T",\n  "exitPopup": true,\n  "sections": []\n}\n', { schema: s, policy: keystaticPolicy });
  e.set('order', null).set('author', null).set('sticky', {}).set('file', 'x').set('cover', '');
  assert.equal(e.changed, false);
  e.set('order', 2).set('tags', []).set('sticky', { text: 'Hi' });
  assert.equal(e.text, '{\n  "title": "T",\n  "order": 2,\n  "tags": [],\n  "exitPopup": true,\n  "sticky": {\n    "text": "Hi"\n  },\n  "sections": []\n}\n');
  e.push('sections', { discriminant: 'hero', value: { lead: '', heading: 'H', image: { src: '', alt: '', width: null, height: null } } });
  assert.deepEqual(e.get('sections.0'), { discriminant: 'hero', value: { heading: 'H', image: {} } });
});

// A real Keystatic site, when one is given: MARKSTAGE_SITE_DIR=/path/to/site node --test
const SITE = process.env.MARKSTAGE_SITE_DIR;
test('real site: schema loads and every JSON entry opens and saves byte for byte', { skip: !SITE && 'set MARKSTAGE_SITE_DIR' }, async () => {
  const schema = await loadKeystaticSchema(path.join(SITE, 'keystatic.config.ts'), { rich: (f) => /\(HTML\)/.test(f.label ?? '') });
  let files = 0;
  for (const [name, c] of Object.entries(schema.collections)) {
    if (c.format.data !== 'json') continue;
    const dir = path.join(SITE, c.path.replace(/\/\*$/, ''));
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const e = JsonEntry.parse(text, { schema: c.entry, policy: keystaticPolicy });
      assert.equal(e.text, text, `${name}/${f}`);
      assert.deepEqual(e.value, JSON.parse(text), `${name}/${f}`);
      files++;
    }
  }
  assert.ok(files > 0);
});
