import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonEntry, fieldAt, bindingKind, defaultValue, normalize } from '../../src/json/index.mjs';

const text = (o = {}) => ({ type: 'text', ...o });
const image = { type: 'object', role: 'image', fields: { src: text(), alt: text(), width: { type: 'number', integer: true }, height: { type: 'number', integer: true } } };
const link = { type: 'object', role: 'link', fields: { href: text(), text: text() } };
const hero = { type: 'object', fields: { eyebrow: text(), heading: text(), lead: text({ rich: true, multiline: true }), image, buttons: { type: 'array', item: link } } };
const faq = { type: 'object', fields: { heading: text(), faqs: { type: 'array', item: { type: 'object', fields: { q: text(), a: text({ rich: true }) } } } } };
const ENTRY = {
  type: 'object',
  fields: {
    title: text(),
    order: { type: 'number', integer: true },
    exitPopup: { type: 'checkbox', default: true },
    sections: {
      type: 'array',
      item: {
        type: 'conditional',
        discriminant: { type: 'select', options: [{ label: 'hero', value: 'hero' }, { label: 'faq', value: 'faq' }], default: 'hero' },
        values: { hero, faq },
        storage: { discriminant: 'discriminant', value: 'value' },
      },
    },
  },
};
// what a Keystatic-like tool leaves out
const policy = { omit: (v, f) => (v === '' && f?.type === 'text') || (v === null && f?.type === 'number') };
const DATA = { title: 'T', sections: [{ discriminant: 'faq', value: { heading: 'Q', faqs: [{ q: 'Why', a: '<p>So</p>' }] } }, { discriminant: 'hero', value: { heading: 'H' } }] };

test('fieldAt follows objects, arrays and the chosen conditional branch', () => {
  assert.equal(fieldAt(ENTRY, 'sections.0.value.faqs.0.a', DATA).rich, true);
  assert.equal(fieldAt(ENTRY, 'sections.1.value.image.src', DATA).type, 'text');
  assert.equal(fieldAt(ENTRY, 'sections.1.discriminant', DATA).type, 'select');
  assert.equal(fieldAt(ENTRY, 'sections.0.value.image', DATA), undefined); // faq has no image
  assert.equal(fieldAt(ENTRY, 'sections.x', DATA), undefined);
  assert.equal(fieldAt(ENTRY, 'nope.deeper', DATA), undefined);
});

test('bindingKind: text and rich inline, image / link / list in the panel', () => {
  assert.equal(bindingKind(text()), 'text');
  assert.equal(bindingKind(text({ rich: true })), 'rich');
  assert.equal(bindingKind(image), 'image');
  assert.equal(bindingKind({ type: 'image' }), 'image');
  assert.equal(bindingKind(link), 'link');
  assert.equal(bindingKind({ type: 'url' }), 'link');
  assert.equal(bindingKind(hero.fields.buttons), 'list');
  assert.equal(bindingKind({ type: 'checkbox' }), undefined);
  assert.equal(bindingKind(undefined), undefined);
});

test('defaultValue: every key, conditional branch by name', () => {
  assert.deepEqual(defaultValue(ENTRY.fields.sections.item, 'faq'), { discriminant: 'faq', value: { heading: '', faqs: [] } });
  assert.deepEqual(defaultValue(ENTRY.fields.sections.item).discriminant, 'hero');
  assert.deepEqual(defaultValue(image), { src: '', alt: '', width: null, height: null });
  assert.equal(defaultValue(ENTRY.fields.exitPopup), true);
  assert.throws(() => defaultValue(ENTRY.fields.sections.item, 'nope'), /no conditional option/);
});

test('normalize: schema key order, unknown keys after, omitted empties dropped', () => {
  const v = normalize({ lead: '', heading: 'H', extra: 1, eyebrow: 'E', image: { alt: '', src: 'a.png', width: null } }, hero, policy);
  assert.deepEqual(Object.keys(v), ['eyebrow', 'heading', 'image', 'extra']);
  assert.deepEqual(v.image, { src: 'a.png' });
});

test('with a schema, a new key goes where the tool writes it', () => {
  const e = JsonEntry.parse(JSON.stringify(DATA, null, 2) + '\n', { schema: ENTRY, policy });
  e.set('sections.1.value.eyebrow', 'E'); // before heading
  e.set('order', 3); // after title, before sections
  const want = structuredClone(DATA);
  want.sections[1].value = { eyebrow: 'E', heading: 'H' };
  assert.equal(e.text, JSON.stringify({ title: 'T', order: 3, sections: want.sections }, null, 2) + '\n');
});

test('with a policy, setting an empty value removes the key', () => {
  const e = JsonEntry.parse(JSON.stringify(DATA, null, 2) + '\n', { schema: ENTRY, policy });
  e.set('sections.1.value.heading', '');
  assert.deepEqual(e.get('sections.1.value'), {});
  e.set('sections.1.value.lead', ''); // absent and empty: nothing to do
  assert.deepEqual(e.changes.length, 1);
});

test('inserted values are normalized (a new section from defaultValue)', () => {
  const e = JsonEntry.parse(JSON.stringify(DATA, null, 2) + '\n', { schema: ENTRY, policy });
  const s = defaultValue(ENTRY.fields.sections.item, 'hero');
  s.value.heading = 'New';
  e.insert('sections', 0, s);
  assert.deepEqual(e.get('sections.0'), { discriminant: 'hero', value: { heading: 'New', image: {}, buttons: [] } });
  assert.equal(e.field('sections.0.value.lead').rich, true);
});
