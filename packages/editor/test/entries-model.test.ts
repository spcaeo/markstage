// The lists screen's pure parts (src/admin/entries-model.ts): the chips and choices, the date filter's cut-off, the
// page range words and maths, the language chips, the kind's words and the row's tooltip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// the editor's sources import each other without the extension (Vite resolves them): so does this test
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { ATTENTION_CHOICES, DATE_CHOICES, FILTER_KEYS, hasFilters, kindWords, langChip, pageCount, pageRange, rowTip, selectedWords, sinceOf, STATUS_CHIPS } = await import('../src/admin/entries-model.ts');

test('the chips are All, Drafts, Scheduled, Live; the attention and date choices start with "any"', () => {
  assert.deepEqual(STATUS_CHIPS.map(([, l]) => l), ['All', 'Drafts', 'Scheduled', 'Live']);
  assert.deepEqual(STATUS_CHIPS.map(([v]) => v), ['', 'draft', 'scheduled', 'published']);
  assert.equal(DATE_CHOICES[0][0], '');
  assert.deepEqual(DATE_CHOICES.slice(1).map(([v]) => v), ['7d', '30d', 'year']);
  assert.equal(ATTENTION_CHOICES[0][0], '');
  // the server's five filters, in their words
  assert.deepEqual(ATTENTION_CHOICES.slice(1), [
    ['no-description', 'No description'],
    ['no-title', 'No title'],
    ['alt-text', 'Images without alt text'],
    ['links', 'Broken links'],
    ['not-translated', 'Not translated'],
  ]);
});

test('the date filter cuts off 7 or 30 days back, or at the start of this year; anything else is no cut-off', () => {
  const now = Date.parse('2026-11-02T15:00:00.000Z');
  assert.equal(sinceOf('7d', now), '2026-10-26T15:00:00.000Z');
  assert.equal(sinceOf('30d', now), '2026-10-03T15:00:00.000Z');
  assert.equal(new Date(sinceOf('year', now)!).getFullYear(), 2026);
  assert.ok(Date.parse(sinceOf('year', now)!) <= Date.parse('2026-01-01T23:59:59Z'));
  assert.equal(sinceOf('', now), null);
  assert.equal(sinceOf('last-week', now), null);
});

test('the page range reads "1–50 of 121", the last page stops at the total, nothing reads as nothing', () => {
  assert.equal(pageRange(121, 1, 50), '1–50 of 121');
  assert.equal(pageRange(121, 2, 50), '51–100 of 121');
  assert.equal(pageRange(121, 3, 50), '101–121 of 121');
  assert.equal(pageRange(1234, 1, 50), '1–50 of 1,234');
  assert.equal(pageRange(0, 1, 50), '');
  assert.equal(pageCount(121, 50), 3);
  assert.equal(pageCount(50, 50), 1);
  assert.equal(pageCount(0, 50), 1);
});

test('a language chip is the language in capitals with a tick or a dash', () => {
  assert.deepEqual(langChip({ code: 'fr-CA', done: true }), { text: 'FR ✓', title: 'fr-CA: has its own words', done: true });
  assert.deepEqual(langChip({ code: 'en-US', done: false }), { text: 'EN –', title: 'en-US: not translated yet', done: false });
  assert.equal(langChip({ code: 'de', done: false }).text, 'DE –');
});

test('the kind’s words: page or post, the New button and the empty state; other kinds keep their own label', () => {
  assert.deepEqual(kindWords('Pages'), { one: 'page', many: 'pages', newLabel: 'New page', first: 'Write your first page' });
  assert.deepEqual(kindWords('Blog posts'), { one: 'post', many: 'posts', newLabel: 'New post', first: 'Write your first post' });
  assert.deepEqual(kindWords('Authors'), { one: 'author', many: 'authors', newLabel: 'New author', first: 'Write your first author' });
});

test('filters are the seven keys; any one set narrows the view', () => {
  assert.deepEqual([...FILTER_KEYS], ['status', 'author', 'tag', 'group', 'date', 'attention', 'q']);
  assert.equal(hasFilters({}), false);
  assert.equal(hasFilters({ status: '' }), false);
  assert.equal(hasFilters({ attention: 'links' }), true);
  assert.equal(hasFilters({ q: 'x' }), true);
});

test('the row’s tooltip: the whole title, the author by name, the address and the date, only the ones there', () => {
  const tip = rowTip({ title: 'A long title', url: '/blog/a-long-title/', date: '2026-02-26T08:01:00.000Z', author: 'sam' }, 'Sam Writer');
  const lines = tip.split('\n');
  assert.equal(lines[0], 'A long title');
  assert.equal(lines[1], 'By Sam Writer');
  assert.equal(lines[2], '/blog/a-long-title/');
  assert.match(lines[3]!, /2026/);
  assert.equal(rowTip({ title: 'Bare', url: null, date: null, author: null }, null), 'Bare');
  assert.equal(rowTip({ title: 'Odd date', url: null, date: 'soon', author: null }, null), 'Odd date');
  assert.equal(selectedWords(3), '3 selected');
});
