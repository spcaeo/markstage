// The field-binding helper of packages/astro (kept with the JSON engine's tests: its paths are this engine's paths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bind, binder, bindSection, sectionBinder, fieldPath, editing } from '../../../astro/src/bind.mjs';
import { JsonEntry, fieldAt, bindingKind } from '../../src/json/index.mjs';

const withEditor = (on, fn) => {
  const before = process.env.MARKSTAGE_EDITOR;
  if (on) process.env.MARKSTAGE_EDITOR = '1';
  else delete process.env.MARKSTAGE_EDITOR;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.MARKSTAGE_EDITOR;
    else process.env.MARKSTAGE_EDITOR = before;
  }
};

test('a normal build gets no attributes at all', () =>
  withEditor(false, () => {
    assert.equal(editing(), false);
    assert.deepEqual(bind('sections.0.value.heading'), {});
    const b = sectionBinder(2);
    assert.equal(b.on, false);
    assert.deepEqual(b('heading'), {});
    assert.equal(b.field('heading'), undefined);
    assert.equal(b.kind('rich'), undefined);
    assert.equal(b.format('date'), undefined);
    assert.deepEqual(bindSection(2), {});
    assert.equal(b.path('items', 1, 'title'), 'sections.2.value.items.1.title'); // paths still work
  }));

test('editor mode: field path and kind', () =>
  withEditor(true, () => {
    const b = sectionBinder(3);
    assert.equal(b.on, true);
    assert.deepEqual(b('heading'), { 'data-ms-field': 'sections.3.value.heading', 'data-ms-kind': 'text' });
    assert.deepEqual(b('items.0.body', 'rich'), { 'data-ms-field': 'sections.3.value.items.0.body', 'data-ms-kind': 'rich' });
    assert.equal(b.field('rows'), 'sections.3.value.rows');
    assert.equal(b.kind('list'), 'list');
    assert.equal(b.format('date'), 'date');
    assert.deepEqual(bindSection(3), { 'data-ms-section': '3' });
    assert.deepEqual(bind(undefined), {});
    assert.throws(() => bind('x', 'html'), /unknown kind/);
    // a new object every time (Astro may add to the attributes it is given)
    assert.notEqual(b('heading'), b('heading'));
    assert.equal(binder('').path('a', 0), 'a.0');
    assert.equal(fieldPath('a', undefined, '', null, 2), 'a.2');
  }));

test('a binding path reaches the field in the entry, with the schema kind', () =>
  withEditor(true, () => {
    const schema = {
      type: 'object',
      fields: { sections: { type: 'array', item: { type: 'object', fields: { value: { type: 'object', fields: { heading: { type: 'text' }, lead: { type: 'text', rich: true } } } } } } },
    };
    const e = JsonEntry.parse('{"sections": [{"value": {"heading": "H", "lead": "<p>L</p>"}}]}', { schema });
    const b = sectionBinder(0);
    for (const [sub, kind] of [['heading', 'text'], ['lead', 'rich']]) {
      const attrs = b(sub, kind);
      assert.equal(e.has(attrs['data-ms-field']), true);
      assert.equal(bindingKind(fieldAt(schema, attrs['data-ms-field'], e.value)), attrs['data-ms-kind']);
    }
  }));
