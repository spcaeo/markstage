// The fields the pages editor takes from a page's `page:ready` (src/pages/frame-fields.ts; security review 3 Nov,
// S2): the page's word is a hint; only fields the editor's own schema has inside a section, of a matching kind, are
// taken, and never code injection, status, SEO, author or a site's hidden fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameFieldOk, frameFields } from '../src/pages/frame-fields.ts';
import { inferField } from '../src/pages/schema.ts';
import type { BoundField } from '../src/pages/types.ts';

const data = {
  title: 'About',
  uri: '/about/',
  seo: { title: 'About us' },
  codeInjection: { head: '', foot: '' },
  draft: false,
  author: 'ann',
  sections: [
    {
      discriminant: 'hero',
      value: {
        id: 'top',
        heading: 'We are here',
        headingLevel: 1,
        lead: '<p>Hi <b>there</b></p>',
        image: { src: '/a.png', alt: 'A' },
        buttons: [{ text: 'Go', href: '/go/' }],
        secret: 'x',
        seo: { title: 'nested' },
      },
    },
  ],
};
const root = inferField(data);
const none = () => false;
const ok = (path: string, kind: BoundField['kind'], hidden = none) => frameFieldOk({ path, kind }, root, data, hidden);

test('a section’s words, its picture, its button and its list are taken, as the site binds them', () => {
  assert.equal(ok('sections.0.value.heading', 'text'), true);
  assert.equal(ok('sections.0.value.lead', 'rich'), true);
  assert.equal(ok('sections.0.value.buttons.0.text', 'text'), true);
  assert.equal(ok('sections.0.value.image', 'image'), true);
  assert.equal(ok('sections.0.value.buttons.0', 'link'), true);
  assert.equal(ok('sections.0.value.buttons', 'list'), true);
});

test('page-level keys, code injection, status, SEO and author are never taken, whatever kind the page says', () => {
  for (const path of ['title', 'uri', 'seo.title', 'codeInjection', 'codeInjection.head', 'draft', 'author', 'sections.0.value.seo.title']) {
    for (const kind of ['text', 'rich', 'image', 'link', 'list'] as const) assert.equal(ok(path, kind), false, `${path} as ${kind}`);
  }
});

test('a field the schema does not have, or of another kind, or an address, is not taken', () => {
  assert.equal(ok('sections.0.value.nope', 'text'), false, 'not in the schema');
  assert.equal(ok('sections.1.value.heading', 'text'), false, 'no such section');
  assert.equal(ok('sections.0.value.headingLevel', 'text'), false, 'a number is not typed in place');
  assert.equal(ok('sections.0.value.image.src', 'text'), false, 'a picture’s file is set in the panel');
  assert.equal(ok('sections.0.value.buttons.0.href', 'text'), false, 'an address is set in the panel');
  assert.equal(ok('sections.0.discriminant', 'text'), false, 'the section’s kind');
  assert.equal(ok('sections.0.value.id', 'text'), false, 'the section’s anchor');
  assert.equal(ok('sections.0.value.heading', 'image'), false, 'a kind that does not match');
  assert.equal(ok('sections.0.value.__proto__', 'text'), false);
});

test('a site’s hidden fields are not taken; the list filter keeps only what passes', () => {
  assert.equal(ok('sections.0.value.secret', 'text', (p) => p.endsWith('.secret')), false);
  const kept = frameFields(
    [
      { path: 'sections.0.value.heading', kind: 'text' },
      { path: 'codeInjection.head', kind: 'text' },
      { path: 'seo.title', kind: 'text' },
    ],
    root,
    data,
    none,
  );
  assert.deepEqual(kept.map((f) => f.path), ['sections.0.value.heading']);
});
