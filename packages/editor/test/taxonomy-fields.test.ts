// Categories and tags offers only the fields the site declares as a taxonomy (src/admin/taxonomy-fields.ts): tags
// fields and plain selects, under their own labels; never dates, orders, sections, a topic or an author select; a
// site with no settings at all falls back to the server's list fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taxonomyFields } from '../src/admin/taxonomy-fields.ts';

const settings = [
  { type: 'slug', key: 'slug', label: 'URL slug' },
  { type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' },
  { type: 'tags', key: 'categories', label: 'Categories' },
  { type: 'tags', key: 'tags', label: 'Tags' },
  { type: 'select', key: 'author', label: 'Author', from: 'authors' },
  { type: 'select', key: 'kind', label: 'Kind', options: [['guide', 'Guide'], ['review', 'Review']] },
  { type: 'date', key: 'date', label: 'Publish date' },
  { type: 'switch', key: 'toc', label: 'Show contents' },
] as const;
const server = [
  { name: 'modified', kind: 'text' as const },
  { name: 'order', kind: 'number' as const },
  { name: 'sections', kind: 'list' as const },
  { name: 'tags', kind: 'list' as const },
  { name: 'categories', kind: 'list' as const },
];

test('declared settings: tags fields and plain selects with their labels, nothing else', () => {
  assert.deepEqual(taxonomyFields([{ settings: [...settings] as never }, { settings: [] }], server), [
    { name: 'categories', label: 'Categories' },
    { name: 'tags', label: 'Tags' },
    { name: 'kind', label: 'Kind' },
  ]);
});

test('a key declared by two collections is offered once', () => {
  const both = [{ settings: [{ type: 'tags', key: 'tags', label: 'Tags' }] as never }, { settings: [{ type: 'tags', key: 'tags', label: 'Keywords' }] as never }];
  assert.deepEqual(taxonomyFields(both, server), [{ name: 'tags', label: 'Tags' }]);
});

test('no settings anywhere: the server’s list fields, timestamps and numbers never', () => {
  assert.deepEqual(taxonomyFields([{ settings: undefined }, {}], server), [
    { name: 'sections', label: 'sections' },
    { name: 'tags', label: 'tags' },
    { name: 'categories', label: 'categories' },
  ]);
  assert.deepEqual(taxonomyFields([], []), []);
});
