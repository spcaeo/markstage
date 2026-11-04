// Which table columns are numbers (src/numeric.ts): those are right-aligned with tabular figures, text stays left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNumeric, numericColumns } from '../src/numeric.ts';

test('counts, money, percentages, sizes, durations and fractions read as numbers', () => {
  for (const t of ['12', '1,234', '$45.00', '-3', '12%', '1.2 MB', '340 KB', '3 / 12', '3 of 12', '2 min 30 s', '450ms', '2026', '0', '€1,200', '1.5x', '1\u202f200'])
    assert.ok(isNumeric(t), t);
});

test('phones, addresses, dates, times, versions and words do not', () => {
  for (const t of ['+1 416 555 0100', '127.0.0.1', '2026-10-28', 'Oct 28, 2026', '17:50', 'v1.2.3', 'u_Drx', 'Hello 2', '3 days ago', '#12', '/blog/2026', '', '—'])
    assert.ok(!isNumeric(t), t);
});

test('a column is numeric when every filled cell is a number; blanks and dashes do not count against it', () => {
  const rows = [
    ['Home', '/', '12', '1.2 MB', 'Oct 28'],
    ['About', '/about/', '—', '340 KB', 'Oct 27'],
    ['Blog', '/blog/', '3', '', 'Oct 26'],
  ];
  assert.deepEqual([...numericColumns(rows)], [2, 3]);
  assert.deepEqual([...numericColumns([['—'], ['']])], []);
  assert.deepEqual([...numericColumns([['3'], ['three']])], []);
});
