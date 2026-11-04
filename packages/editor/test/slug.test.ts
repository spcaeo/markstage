// A title's address name (src/slug.ts): Latin letters and digits survive, accents fold, anything else gives no slug
// and the entry is named by the day, as the server does (QA pass 2, N4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datedSlug, slugOf } from '../src/slug.ts';

test('a title gives a slug of letters a-z, digits and hyphens; accents fold', () => {
  assert.equal(slugOf('Héllo, Wörld!  2026'), 'hello-world-2026');
  assert.equal(slugOf('  Café “naïve” — 🚀 rocket & ampersand '), 'cafe-naive-rocket-ampersand');
});

test('Arabic or emoji alone give no slug; the day names the entry', () => {
  assert.equal(slugOf('مرحبا بالعالم'), '');
  assert.equal(slugOf('🚀🚀🚀'), '');
  assert.equal(datedSlug('post', new Date('2026-11-02T23:50:00Z')), 'post-2026-11-02');
  assert.equal(datedSlug('page', new Date('2026-11-02T23:50:00Z')), 'page-2026-11-02');
});
