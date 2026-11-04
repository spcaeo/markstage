// The lists screen's language chips (content/attention.mjs localesOf): a tracked locale is done when it has its
// own words for every tracked field, when the source has none, or when it shares the source's language.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ATTENTION, localesOf } from '../src/content/attention.mjs';

const c = { fields: { title: 'title', excerpt: 'excerpt' }, seo: { title: 'seo.title', description: 'seo.description' } };
const fr = { code: 'fr-CA', label: 'Français', fields: ['title', 'description'], sameLanguage: false };
const us = { code: 'en-US', label: 'US', fields: ['title', 'description'], sameLanguage: true };

test('a locale with its own title and description is done; one without is not', () => {
  const fields = { title: 'Hello', excerpt: 'The first post.', locales: { 'fr-CA': { title: 'Bonjour', description: 'Le premier billet.' } } };
  assert.deepEqual(localesOf([fr, us], 'locales', c, fields), [{ code: 'fr-CA', done: true }, { code: 'en-US', done: true }]);
  assert.deepEqual(localesOf([fr], 'locales', c, { title: 'Hello', excerpt: 'x', locales: { 'fr-CA': { title: 'Bonjour' } } }), [{ code: 'fr-CA', done: false }]);
  assert.deepEqual(localesOf([fr], 'locales', c, { title: 'Hello' }), [{ code: 'fr-CA', done: false }]);
});

test('a source with no description needs no translated one; blank words do not count; the overrides key is the site’s', () => {
  assert.deepEqual(localesOf([fr], 'locales', c, { title: 'Hello', locales: { 'fr-CA': { title: 'Bonjour' } } }), [{ code: 'fr-CA', done: true }]);
  assert.deepEqual(localesOf([fr], 'locales', c, { title: 'Hello', locales: { 'fr-CA': { title: '   ' } } }), [{ code: 'fr-CA', done: false }]);
  assert.deepEqual(localesOf([fr], 'i18n', c, { title: 'Hello', i18n: { 'fr-CA': { title: 'Bonjour' } } }), [{ code: 'fr-CA', done: true }]);
});

test('the attention filters are the five the server has cheaply', () => {
  assert.deepEqual(ATTENTION, ['no-description', 'no-title', 'alt-text', 'links', 'not-translated']);
});
