// ⌘K finds the editor's screens and the parts of Site settings by their plain words (src/palette-screens.ts): "trash",
// "people", "backups", "go live" (QA F25), for the roles that may open them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { screenIndex, searchScreens } = await import('../src/palette-screens.ts');

const index = [
  { label: 'Trash', href: '#/trash', hint: 'site', words: 'trash deleted bin recycle restore' },
  { label: 'People & access', href: '#/users', hint: 'site', words: 'people & access users team invite roles accounts' },
  { label: 'Go live', href: '#/releases', hint: 'publishing', words: 'go live release publish together launch' },
  { label: 'Backups', href: '#/health?part=backups', hint: 'the last backup, Back up now', words: 'backups the last backup back up now site check-up health' },
  { label: 'Site settings · Locks', href: '#/settings/locks', hint: 'what writers may not change', words: 'site settings locks what writers may not change settings' },
];

test('plain words and synonyms find the screen; every word must match; the label that starts with the words comes first', () => {
  assert.deepEqual(searchScreens('trash', 'owner', index).map((s) => s.href), ['#/trash']);
  assert.deepEqual(searchScreens('people', 'owner', index).map((s) => s.label), ['People & access']);
  assert.deepEqual(searchScreens('users', 'owner', index).map((s) => s.label), ['People & access']);
  assert.deepEqual(searchScreens('go live', 'owner', index).map((s) => s.label), ['Go live']);
  assert.deepEqual(searchScreens('backups', 'owner', index).map((s) => s.href), ['#/health?part=backups']);
  assert.deepEqual(searchScreens('settings', 'owner', index).map((s) => s.label), ['Site settings · Locks']);
  assert.deepEqual(searchScreens('settings trash', 'owner', index), []);
  assert.deepEqual(searchScreens('   ', 'owner', index), []);
});

test('the index: a role sees only its screens; the public and entry-bound ones are left out; an administrator gets the settings parts', () => {
  const defs = [
    { name: 'trash', label: 'Trash', group: 'site' },
    { name: 'users', label: 'People & access', menuLabel: 'People & access', group: 'site', roles: ['owner', 'administrator'] },
    { name: 'sign-in', label: 'Sign in', public: true },
    { name: 'publish', label: 'Publish' },
  ];
  const author = screenIndex('author', defs);
  assert.deepEqual(author.map((s) => s.label), ['Trash', 'Site settings · Tokens']);
  const admin = screenIndex('administrator', defs);
  assert.ok(admin.some((s) => s.href === '#/users') && admin.some((s) => s.href === '#/settings/locks') && admin.some((s) => s.label === 'Backups'));
  assert.deepEqual(searchScreens('people', 'administrator', admin).map((s) => s.href), ['#/users']);
});
