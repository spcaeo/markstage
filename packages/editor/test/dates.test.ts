// Dates in the editor's words are Canadian English (src/dates.ts), never "11/2/2026, 6:51:00 PM" (QA F38).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALE, dateWords, fmtDate, fmtDateTime, fmtTime, localTimes } from '../src/dates.ts';

test('en-CA: "Nov 2, 2026, 6:51 p.m.", never month/day/year', () => {
  assert.equal(LOCALE, 'en-CA');
  const at = '2026-11-02T18:51:00.000Z';
  assert.match(fmtDateTime(at), /^[A-Z][a-z]{2}\.? \d{1,2}, \d{4}, \d{1,2}:\d\d [ap]\.m\.$/);
  assert.match(fmtDate(at), /^[A-Z][a-z]{2}\.? \d{1,2}, \d{4}$/);
  assert.match(fmtTime(at), /^\d{1,2}:\d\d [ap]\.m\.$/);
  assert.doesNotMatch(fmtDateTime(at), /\d+\/\d+\/\d+/);
  assert.equal(fmtDateTime('not a date'), 'not a date');
});

test('an alert\'s ISO times are shown in the reader\'s own zone and words; other text is left alone (QA N13)', () => {
  const text = 'Olive signed in from a new device: Chrome at 127.0.0.1, 2026-11-03T00:48:54Z. (3 new devices since 2026-11-02T23:50:15Z; Seen clears them all.)';
  const out = localTimes(text);
  assert.doesNotMatch(out, /T\d\d:\d\d|UTC|Z\.|\.\./);
  assert.match(out, /^Olive signed in from a new device: Chrome at 127\.0\.0\.1, [A-Z][a-z]{2}\.? \d{1,2}, \d{4}, \d{1,2}:\d\d [ap]\.m\. \(3 new devices since [A-Z][a-z]{2}\.? \d{1,2}, \d{4}, \d{1,2}:\d\d [ap]\.m\.; Seen clears them all\.\)$/);
  assert.equal(localTimes('The build failed on “Post 2026-11-02”'), 'The build failed on “Post 2026-11-02”');
});

test('the words beside a native date input: a day, a day and time in this browser\'s time, or a UTC time said so (QA F38)', () => {
  assert.match(dateWords('2026-11-02'), /^[A-Z][a-z]{2}\.? 2, 2026$/);
  assert.match(dateWords('2026-11-02T20:48'), /^[A-Z][a-z]{2}\.? 2, 2026, 8:48 p\.m\.$/);
  assert.match(dateWords('2026-11-02T20:48', true), /^[A-Z][a-z]{2}\.? 2, 2026, 8:48 p\.m\. UTC$/);
  assert.equal(dateWords(''), '');
  assert.equal(dateWords('11/02/2026'), '');
});
