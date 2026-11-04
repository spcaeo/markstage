// What a field-limited custom role may change in the editor (src/field-access.ts, the entry's can.fields): the same
// answer as the server's check of a save (packages/server/src/custom-roles/rules.mjs), path for path; a key it may not
// change never becomes a pending change (settings/state.ts, and the pages editor's model: pages/model.ts), so a save
// carries only what the server takes; a page's sections can't be added, moved or deleted without "sections".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldMatches, imageKeys, limitNote, mayChange, mayChangeAll } from '../src/field-access.ts';
import { changedPaths as editorPaths, countedPath, PageModel } from '../src/pages/model.ts';
import { layoutLock } from '../src/pages/places.ts';
import { FrontmatterEdits } from '../src/settings/state.ts';
// @ts-expect-error: the server is plain JavaScript
import { changedPaths, compileRole } from '../../server/src/custom-roles/rules.mjs';

const GLOBS = ['locales.fr-CA.**', 'locales.*.title', 'title', 'seo.*', 'body', '**', 'tag?', 'locales.**.description', 'a.b'];
const PATHS = ['title', 'body', 'excerpt', 'seo.title', 'seo.og.image', 'locales.fr-CA.title', 'locales.fr-CA.description', 'locales.en-US.title', 'locales.fr-ca.title', 'tags', 'tag1', 'a.b', 'a.b.c', 'axb'];

test('the same answer as the server, for every glob and path', () => {
  for (const glob of GLOBS) {
    const role = compileRole({ id: 'r', name: 'R', base: 'contributor', rules: [] });
    const outside: string[] = role.outside({ effect: 'allow', fields: [glob] }, PATHS);
    for (const p of PATHS) assert.equal(fieldMatches(glob, p), !outside.includes(p), `${glob} on ${p}`);
  }
});

test('mayChange: no can, read-only, a field-limited role', () => {
  assert.equal(mayChange(undefined, 'title'), true, 'a new entry, a site without sign-in');
  assert.equal(mayChange({ edit: true }, 'body'), true);
  assert.equal(mayChange({ edit: false }, 'locales.fr-CA.title'), false);
  const tr = { edit: true, fields: ['locales.fr-CA.**'] };
  assert.equal(mayChange(tr, 'locales.fr-CA.title'), true);
  assert.equal(mayChange(tr, 'locales.fr-CA.slug'), true);
  assert.equal(mayChange(tr, 'locales.en-US.title'), false);
  assert.equal(mayChange(tr, 'title'), false);
  assert.equal(mayChange(tr, 'body'), false, 'the text is a field like the others');
  assert.equal(mayChange({ edit: true, fields: ['body', 'title'] }, 'body'), true);
  assert.equal(mayChangeAll(undefined), true);
  assert.equal(mayChangeAll({ edit: true }), true);
  assert.equal(mayChangeAll({ edit: false }), false);
  assert.equal(mayChangeAll(tr), false, 'the source is the whole file');
});

test('the banner says what the role changes', () => {
  assert.equal(limitNote({ edit: true }), null);
  assert.equal(limitNote({ edit: false, fields: ['title'] }), null, 'read-only has its own words');
  assert.equal(limitNote({ edit: true, fields: ['locales.fr-CA.**'] }), 'Your role changes only locales.fr-CA.** here. The rest is greyed out.');
  assert.equal(limitNote({ edit: true, fields: ['title', 'body'] }), 'Your role changes only title and the text here. The rest is greyed out.');
  assert.equal(limitNote({ edit: true, fields: ['body'] }), 'Your role changes only the text here. The rest is greyed out.');
});

test('an image setting is the person’s only when every key it writes is', () => {
  assert.deepEqual(imageKeys({ key: 'cover', alt: 'coverAlt', focal: 'coverFocal', clears: ['coverWidth'] }), ['cover', 'coverAlt', 'coverFocal', 'coverWidth']);
  assert.deepEqual(imageKeys({ key: 'cover' }), ['cover']);
});

test('a key the role may not change never becomes a pending change; the save is one the server takes', () => {
  const can = { edit: true, fields: ['locales.fr-CA.**'] };
  const e = new FrontmatterEdits();
  e.setAccess((p) => mayChange(can, p));
  const saved = { title: 'Hello', excerpt: 'Old', locales: { 'en-US': { title: 'Howdy' } } };
  e.reset(saved);
  e.set('title', 'Changed');
  e.set('locales.en-US.title', 'Hi');
  e.group(() => {
    e.set('locales.fr-CA.title', 'Bonjour');
    e.set('excerpt', 'New');
  });
  assert.equal(e.get('title'), 'Hello');
  assert.equal(e.get('excerpt'), 'Old');
  assert.deepEqual(e.changedPaths(), ['locales.fr-CA.title']);
  assert.deepEqual(e.changes(), { locales: { 'fr-CA': { title: 'Bonjour' } } });
  // what the server reads from it: only paths the role covers
  const paths: string[] = changedPaths(saved, e.merged());
  assert.deepEqual(paths, ['locales.fr-CA.title']);
  assert.ok(paths.every((p) => mayChange(can, p)));
  // undo and redo keep to the same keys
  assert.equal(e.undo(), true);
  assert.equal(e.isDirty, false);
  assert.equal(e.redo(), true);
  assert.deepEqual(e.changedPaths(), ['locales.fr-CA.title']);
  // no limit again (another entry): every key
  e.setAccess(null);
  e.set('title', 'Changed');
  assert.equal(e.get('title'), 'Changed');
});

test('the paths a save changes: the same as the server reads them', () => {
  const a = { title: 'T', seo: { title: 'S' }, sections: [{ value: { heading: 'A' } }], locales: { 'en-US': { title: 'X' } } };
  const pairs: [unknown, unknown][] = [
    [a, { ...a, title: 'U' }],
    [a, { ...a, seo: { title: 'S2', description: 'D' } }],
    [a, { ...a, sections: [{ value: { heading: 'B' } }] }],
    [a, { ...a, locales: { 'en-US': { title: 'X' }, 'fr-CA': { title: 'Y' } } }],
    [a, { title: 'T' }],
    [{}, a],
  ];
  for (const [x, y] of pairs) assert.deepEqual(editorPaths(x, y), changedPaths(x, y));
  assert.equal(countedPath(a, 'sections.0.value.heading'), 'sections', 'inside a list, the list counts');
  assert.equal(countedPath(a, 'seo.title'), 'seo.title');
  assert.equal(countedPath(a, 'locales.fr-CA.title'), 'locales.fr-CA.title', 'a key not there yet');
});

const pageData = () => ({ title: 'About', seo: { title: 'About us' }, sections: [{ discriminant: 'hero', value: { heading: 'Hello' } }, { discriminant: 'cta', value: { heading: 'Call' } }] });
const access = (can: { edit: boolean; fields?: string[] }) => ({ may: (p: string) => mayChange(can, p), why: (p: string) => (p === 'sections' ? 'Your role can’t change this page’s sections.' : 'Your role can’t change this.') });

test('a page, for a role that changes the search title only: the sections and the title stay, the save sends that key alone', () => {
  const m = new PageModel(pageData(), 'v1');
  m.setAccess(access({ edit: true, fields: ['seo.title'] }));
  m.change({ op: 'set', path: 'sections.0.value.heading', value: 'Bonjour' });
  m.change({ op: 'move', path: 'sections', from: 0, to: 1 });
  m.change({ op: 'insert', path: 'sections', index: 0, value: { discriminant: 'faq', value: {} } });
  m.change({ op: 'remove', path: 'sections.1' });
  m.change({ op: 'set', path: 'title', value: 'Changed' });
  assert.equal(m.dirty, false, 'nothing it may not change was made');
  m.changeMany([
    { op: 'set', path: 'seo.title', value: 'À propos' },
    { op: 'duplicate', path: 'sections', index: 0 },
  ]);
  assert.deepEqual(m.changes, [{ op: 'set', path: 'seo.title', value: 'À propos' }]);
  assert.deepEqual(changedPaths(pageData(), m.data), ['seo.title'], 'what the server reads from the save');
  assert.equal(m.may('seo.title'), true);
  assert.equal(m.may('sections.1.value.heading'), false);
  assert.equal(m.refuse('sections.0.value.heading'), 'Your role can’t change this page’s sections.');
  assert.equal(layoutLock(m), 'Your role can’t change this page’s sections.', 'no section is added, moved or deleted');
  // undo and redo keep to the same keys
  m.undo();
  assert.equal(m.dirty, false);
  m.redo();
  assert.deepEqual(m.changes, [{ op: 'set', path: 'seo.title', value: 'À propos' }]);
});

test('a page, for a role that changes the sections: they change and move; the title does not', () => {
  const m = new PageModel(pageData(), 'v1');
  m.setAccess(access({ edit: true, fields: ['sections'] }));
  m.change({ op: 'set', path: 'sections.0.value.heading', value: 'Hi' });
  m.change({ op: 'move', path: 'sections', from: 0, to: 1 });
  m.change({ op: 'set', path: 'title', value: 'Changed' });
  assert.deepEqual(m.changes.map((c) => c.op), ['set', 'move']);
  assert.equal(layoutLock(m), null);
});

test('a read-only page: nothing changes', () => {
  const m = new PageModel(pageData(), 'v1');
  m.setAccess({ may: () => false, why: () => 'You can read this page but not change it.' });
  m.change({ op: 'set', path: 'seo.title', value: 'X' });
  m.changeMany([{ op: 'set', path: 'title', value: 'Y' }]);
  assert.equal(m.dirty, false);
  assert.equal(layoutLock(m), 'You can read this page but not change it.');
  m.setAccess(null);
  m.change({ op: 'set', path: 'title', value: 'Y' });
  assert.equal(m.dirty, true, 'no limit: every key');
});
