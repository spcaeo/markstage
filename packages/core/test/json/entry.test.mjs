import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonEntry, parseTree, JsonSyntaxError, toPath } from '../../src/json/index.mjs';

const pretty = (v, indent = 2) => JSON.stringify(v, null, indent) + '\n';

// Files written by different tools: open + save must give each one back byte for byte.
const LOOKS = {
  'two spaces': pretty({ a: 1, b: [1, 2], c: { d: 'x' } }),
  'four spaces': pretty({ a: 1, b: [1, 2], c: { d: 'x' } }, 4),
  tabs: pretty({ a: 1, b: [1, 2], c: { d: 'x' } }, '\t'),
  crlf: pretty({ a: 1, b: [{ c: 2 }] }).replace(/\n/g, '\r\n'),
  'one line': JSON.stringify({ a: 1, b: [1, 2], c: { d: 'x' } }),
  'no final newline': JSON.stringify({ a: 1 }, null, 2),
  'escapes kept': '{\n  "a": "caf\\u00e9 \\/ \\"q\\"",\n  "b": "café"\n}\n',
  'odd spacing': '{ "a" :1 ,"b":[ 1,2 ]\n, "c" : { } }',
  'numbers as written': '{"a": 1.50, "b": 1e3, "c": -0}',
  'top-level array': '[\n  1,\n  "two"\n]\n',
};

for (const [name, text] of Object.entries(LOOKS)) {
  test(`identity: ${name}`, () => {
    const e = JsonEntry.parse(text);
    assert.equal(e.text, text);
    assert.deepEqual(e.value, JSON.parse(text));
    assert.equal(e.changed, false);
  });
}

test('parse: positions cover each value exactly', () => {
  const text = '{"a": [10, "x"], "b": {"c": null}}';
  const { root } = parseTree(text);
  const [a, b] = root.members;
  assert.equal(text.slice(a.value.start, a.value.end), '[10, "x"]');
  assert.equal(text.slice(a.value.items[1].start, a.value.items[1].end), '"x"');
  assert.equal(text.slice(b.keyStart, b.keyEnd), '"b"');
  assert.equal(text.slice(b.value.members[0].value.start, b.value.members[0].value.end), 'null');
});

test('parse: syntax errors say where', () => {
  for (const bad of ['{"a": 1,}', '[1 2]', '{"a"}', '"open', '{"a": tru}', '01', '{} x', '"\\x"', '"a\nb"']) {
    assert.throws(() => parseTree(bad), JsonSyntaxError, bad);
  }
  try {
    parseTree('{\n  "a": ]\n}');
  } catch (err) {
    assert.equal(err.line, 2);
    assert.equal(err.column, 8);
  }
});

test('get by path', () => {
  const e = JsonEntry.parse(pretty({ sections: [{ value: { heading: 'Hi', items: ['a', 'b'] } }] }));
  assert.equal(e.get('sections.0.value.heading'), 'Hi');
  assert.equal(e.get(['sections', 0, 'value', 'items', 1]), 'b');
  assert.deepEqual(e.get('sections.0.value.items'), ['a', 'b']);
  assert.equal(e.get('sections.3.value'), undefined);
  assert.equal(e.has('sections.0.value.items.1'), true);
  assert.equal(e.has('sections.0.value.nope'), false);
});

test('paths: dotted and array forms, no prototype keys', () => {
  assert.deepEqual(toPath('sections.3.value.heading'), ['sections', 3, 'value', 'heading']);
  assert.deepEqual(toPath(['a.b', 0]), ['a.b', 0]);
  assert.deepEqual(toPath('a.03'), ['a', '03']);
  assert.throws(() => toPath('a..b'));
  assert.throws(() => toPath('__proto__.x'));
  assert.throws(() => toPath(['constructor']));
  assert.throws(() => toPath([-1]));
});

test('set: replaces only the value, every other byte stays', () => {
  const text = '{\n  "title": "Old",\n  "x": "caf\\u00e9",\n  "n": 1.50\n}\n';
  const e = JsonEntry.parse(text);
  e.set('title', 'New "quoted" ✓');
  assert.equal(e.text, '{\n  "title": "New \\"quoted\\" ✓",\n  "x": "caf\\u00e9",\n  "n": 1.50\n}\n');
  assert.deepEqual(e.changes, [{ op: 'set', path: 'title' }]);
});

test('set: the same value changes nothing (escapes and number spelling kept)', () => {
  const text = '{"x": "caf\\u00e9", "n": 1.50, "o": {"a": [1]}}';
  const e = JsonEntry.parse(text);
  e.set('x', 'café').set('n', 1.5).set('o', { a: [1] });
  assert.equal(e.text, text);
  assert.equal(e.changed, false);
});

test('set: an object value is written in the file style at its depth', () => {
  const e = JsonEntry.parse(pretty({ a: { b: 1 }, z: 0 }, 4));
  e.set('a.b', { c: [1, { d: 'e' }] });
  assert.equal(e.text, pretty({ a: { b: { c: [1, { d: 'e' }] } }, z: 0 }, 4));
});

test('set: one-line files stay on one line', () => {
  const e = JsonEntry.parse('{"a":1,"b":{"c":2}}');
  e.set('b.c', { d: [1, 2] }).set('e', true);
  assert.equal(e.text, '{"a":1,"b":{"c":{"d":[1,2]}},"e":true}');
});

test('set: CRLF files get CRLF in new lines', () => {
  const e = JsonEntry.parse(pretty({ a: 1 }).replace(/\n/g, '\r\n'));
  e.set('b', { c: 2 });
  assert.equal(e.text, pretty({ a: 1, b: { c: 2 } }).replace(/\n/g, '\r\n'));
});

test('set: a new key is appended (no schema) and missing objects are created', () => {
  const e = JsonEntry.parse(pretty({ a: 1, seo: {} }));
  e.set('b', 'x').set('seo.title', 'T').set('deep.er.key', 3);
  assert.equal(e.text, pretty({ a: 1, seo: { title: 'T' }, b: 'x', deep: { er: { key: 3 } } }));
});

test('set: appending to an array by index = length; other indexes refuse', () => {
  const e = JsonEntry.parse(pretty({ list: ['a'] }));
  e.set('list.1', 'b');
  assert.deepEqual(e.value, { list: ['a', 'b'] });
  assert.throws(() => e.set('list.5', 'x'), /no item 5/);
  assert.throws(() => e.set('list.0.name', 'x'), /not a container/);
  assert.throws(() => e.set('missing.0', 'x'), /no item 0/);
});

test('set undefined removes the key', () => {
  const e = JsonEntry.parse(pretty({ a: 1, b: 2, c: 3 }));
  e.set('b', undefined);
  assert.equal(e.text, pretty({ a: 1, c: 3 }));
});

test('remove: first, middle, last and only entries', () => {
  const base = { a: 1, b: 2, c: 3 };
  for (const k of ['a', 'b', 'c']) {
    const e = JsonEntry.parse(pretty(base));
    e.remove(k);
    const want = { ...base };
    delete want[k];
    assert.equal(e.text, pretty(want), k);
  }
  const e = JsonEntry.parse(pretty({ list: [1], o: { only: true } }));
  e.remove('list.0').remove('o.only');
  assert.equal(e.text, pretty({ list: [], o: {} }));
  assert.throws(() => e.remove('nope'), /nothing at nope/);
});

test('insert, push: items at the start, middle and end, and into an empty array', () => {
  const e = JsonEntry.parse(pretty({ list: [{ n: 1 }, { n: 3 }], empty: [] }));
  e.insert('list', 1, { n: 2 }).insert('list', 0, { n: 0 }).push('list', { n: 4 }).push('empty', 'x');
  assert.equal(e.text, pretty({ list: [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], empty: ['x'] }));
  assert.throws(() => e.insert('list', 9, {}), /out of range/);
  assert.throws(() => e.push('list.0', 1), /not an array/);
});

test('move: the item text moves unchanged (its own escapes too)', () => {
  const text = '[\n  "caf\\u00e9",\n  "b",\n  "c"\n]\n';
  const e = JsonEntry.parse(text);
  e.move('', 0, 2);
  assert.equal(e.text, '[\n  "b",\n  "c",\n  "caf\\u00e9"\n]\n');
  e.move('', 2, 0);
  assert.equal(e.text, text);
  assert.throws(() => e.move('', 0, 3), /out of range/);
});

test('duplicate: a copy of the exact text right after it', () => {
  const e = JsonEntry.parse(pretty({ s: [{ h: 'A' }, { h: 'B' }] }));
  const at = e.duplicate('s', 0);
  assert.equal(at, 1);
  assert.equal(e.text, pretty({ s: [{ h: 'A' }, { h: 'A' }, { h: 'B' }] }));
  e.set('s.1.h', 'A2');
  assert.deepEqual(e.get('s'), [{ h: 'A' }, { h: 'A2' }, { h: 'B' }]);
});

test('changes are listed in order', () => {
  const e = JsonEntry.parse(pretty({ s: ['a', 'b'] }));
  e.set('s.0', 'x').move('s', 0, 1);
  e.duplicate('s', 0);
  e.remove('s.2');
  assert.deepEqual(e.changes, [
    { op: 'set', path: 's.0' },
    { op: 'move', path: 's.0', to: 1 },
    { op: 'duplicate', path: 's.0' },
    { op: 'remove', path: 's.2' },
  ]);
});

test('many edits in a row keep the file valid and the value right', () => {
  const value = { sections: Array.from({ length: 6 }, (_, i) => ({ discriminant: 'k', value: { heading: `H${i}`, items: [i] } })) };
  const e = JsonEntry.parse(pretty(value));
  const want = structuredClone(value);
  for (let i = 0; i < 40; i++) {
    const n = want.sections.length;
    const k = (i * 7) % n;
    if (i % 4 === 0) {
      e.set(`sections.${k}.value.heading`, `E${i}`);
      want.sections[k].value.heading = `E${i}`;
    } else if (i % 4 === 1) {
      e.move('sections', k, n - 1 - k);
      want.sections.splice(n - 1 - k, 0, want.sections.splice(k, 1)[0]);
    } else if (i % 4 === 2) {
      e.duplicate('sections', k);
      want.sections.splice(k + 1, 0, structuredClone(want.sections[k]));
    } else {
      e.remove(`sections.${k}`);
      want.sections.splice(k, 1);
    }
    assert.deepEqual(JSON.parse(e.text), want, `step ${i}`);
  }
  assert.equal(e.text, pretty(want));
});
