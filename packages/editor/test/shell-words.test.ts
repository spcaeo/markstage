// The drawer's words (src/shell-words.ts, docs/EDITOR-UX.md sections 2 and 3): every registered screen with a place in
// the navigation has a group or sits under More tools, every label the drawer shows is on the word list, and none of
// the internal words (Entries, Jobs, Inbox, Media, Audit log, Environments…) reaches it. The registrations are read
// from the source files, so a new screen without a group fails here, not in front of a person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collectionWord, drawerFolded, drawerPlan, FORBIDDEN, greeting, GROUPS, statusWord, WORDS, type MenuScreen } from '../src/shell-words.ts';

const SRC = new URL('../src/', import.meta.url).pathname;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

/** Every registerScreen({...}) in the source, as the fields its literal sets (getters count as set). */
function registrations(): (MenuScreen & { file: string; navSet: boolean })[] {
  const out: (MenuScreen & { file: string; navSet: boolean })[] = [];
  for (const f of files(SRC)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/registerScreen\(\{([\s\S]*?)\n\}\)|registerScreen\(\{([^\n]*)\}\)/g)) {
      const body = m[1] ?? m[2] ?? '';
      const name = /name: '([a-z0-9-]+)'/.exec(body)?.[1];
      if (!name) continue;
      const nav = /nav: '(main|admin)'/.exec(body)?.[1] as 'main' | 'admin' | undefined;
      const navGetter = /get nav\(\)/.test(body);
      // a label getter is the site's own word for its groups (Topics)
      const label = /\blabel: '([^']+)'/.exec(body)?.[1] ?? (/get label\(\)/.test(body) ? 'Topics' : name);
      const group = /group: '([a-z]+)'/.exec(body)?.[1] as MenuScreen['group'];
      const menuLabel = /menuLabel: '([^']+)'/.exec(body)?.[1];
      const roles = /roles: (MANAGERS|EDITORS|\[[^\]]*\])/.exec(body)?.[1];
      out.push({ name, label, icon: 'x', nav: nav ?? (navGetter ? 'main' : null), group, menuLabel, roles: roles ? ['owner'] : undefined, file: f.slice(SRC.length), navSet: !!nav || navGetter });
    }
  }
  return out;
}

const COLLECTIONS = [
  { id: 'posts', label: 'Articles', format: 'md' as const },
  { id: 'pages', label: 'Pages', format: 'json' as const },
];

test('every screen with a place in the navigation has a group, or sits under More tools with a plain name', () => {
  const regs = registrations();
  assert.ok(regs.length > 20, `found ${regs.length} registrations`);
  const plan = drawerPlan(regs, COLLECTIONS, 'owner');
  const inGroups = new Set(plan.groups.flatMap((g) => g.items.map((i) => i.screen)));
  const inTools = new Set(plan.tools.map((i) => i.screen));
  for (const r of regs) {
    if (!r.navSet) continue;
    assert.ok(inGroups.has(r.name) || inTools.has(r.name), `${r.name} (${r.file}) is in no group and not under More tools`);
  }
  // the screens the spec names, where it puts them
  const where = (name: string) => plan.groups.find((g) => g.items.some((i) => i.screen === name))?.id ?? (inTools.has(name) ? 'tools' : null);
  assert.deepEqual(['media', 'menus'].map(where), ['content', 'content']);
  assert.equal(where('inbox'), 'visitors');
  assert.deepEqual(['releases', 'jobs'].map(where), ['publishing', 'publishing']);
  assert.deepEqual(['settings', 'translations', 'users', 'health', 'trash'].map(where), ['site', 'site', 'site', 'site', 'site']);
  assert.deepEqual(['redirects', 'replace', 'library', 'tree', 'audit', 'environments', 'taxonomy', 'authors', 'topic-map', 'links', 'gallery'].map(where), Array(11).fill('tools'));
});

test('the drawer shows only words from the word list, never an internal one', () => {
  const plan = drawerPlan(registrations(), COLLECTIONS, 'owner');
  const labels = [...plan.groups.flatMap((g) => [g.label, ...g.items.map((i) => i.label)]), ...plan.tools.map((i) => i.label)];
  for (const l of labels) {
    assert.ok(WORDS.has(l) || GROUPS.some((g) => g.label === l), `"${l}" is not on the word list`);
    assert.ok(!FORBIDDEN.includes(l), `"${l}" is an internal word`);
  }
  // the content group: Pages first, then Blog posts, with their counts' keys
  const content = plan.groups.find((g) => g.id === 'content')!;
  assert.deepEqual(content.items.slice(0, 2).map((i) => [i.label, i.href, i.count]), [['Pages', '#/entries?c=pages', 'entries:pages'], ['Blog posts', '#/entries?c=posts', 'entries:posts']]);
  assert.equal(plan.groups.find((g) => g.id === 'visitors')!.items[0]!.count, 'inbox');
  // Backups has its own line, on the check-up
  assert.ok(plan.groups.find((g) => g.id === 'site')!.items.some((i) => i.label === 'Backups' && i.href === '#/health?part=backups'));
  // in the rulebook's order
  assert.deepEqual(plan.groups.find((g) => g.id === 'publishing')!.items.map((i) => i.label), ['Go live', 'Scheduled & history']);
  assert.deepEqual(plan.groups.find((g) => g.id === 'site')!.items.map((i) => i.label), ['Site settings', 'Languages', 'People & access', 'Site check-up', 'Backups', 'Trash']);
  // Publishing and Site & team start folded
  assert.deepEqual(GROUPS.map((g) => g.folded), [false, false, true, true]);
});

test('a role sees only its screens: a writer has no People & access, no Site check-up, no Activity', () => {
  const regs = registrations().map((r) => ({ ...r, roles: r.roles ? ['owner', 'administrator'] : undefined }));
  const plan = drawerPlan(regs, COLLECTIONS, 'author');
  const all = [...plan.groups.flatMap((g) => g.items), ...plan.tools].map((i) => i.label);
  for (const w of ['People & access', 'Site check-up', 'Activity', 'Backups']) assert.ok(!all.includes(w), `${w} shown to a writer`);
  assert.ok(all.includes('Pages') && all.includes('Blog posts'));
});

test('collectionWord, greeting and statusWord', () => {
  assert.equal(collectionWord({ id: 'pages', label: 'Pages', format: 'json' }), 'Pages');
  assert.equal(collectionWord({ id: 'posts', label: 'Articles', format: 'md' }), 'Blog posts');
  assert.equal(collectionWord({ id: 'docs', label: 'Guides', format: 'md' }), 'Guides');
  assert.equal(greeting(9, 'Sam Writer'), 'Good morning, Sam');
  assert.equal(greeting(14, 'Sam'), 'Good afternoon, Sam');
  assert.equal(greeting(21, ''), 'Good evening');
  assert.deepEqual(statusWord('draft'), { word: 'Draft', kind: 'draft' });
  assert.deepEqual(statusWord(undefined), { word: 'Live', kind: 'live' });
});

test('the icon rail shows every group’s items, folded groups too (the drawer folds a group with a class, never `hidden`)', () => {
  const nav = readFileSync(join(SRC, 'nav.ts'), 'utf8');
  const css = readFileSync(join(SRC, 'styles/host.css'), 'utf8');
  assert.ok(!/items\.hidden\s*=/.test(nav), 'a folded group is .is-folded, so the rail can show it');
  assert.ok(nav.includes("classList.toggle('is-folded', !on)"));
  assert.ok(/\.nav-folded \.ms-nav__items\.is-folded \{\s*display: grid;/.test(css), 'the rail shows folded groups as icons');
  assert.ok(/\.nav-folded \.ms-nav__items \{[^}]*border-bottom/.test(css), 'a thin rule between the groups');
});

test('the drawer starts folded in a narrow window unless opened this session; wide, it is what the browser remembers', () => {
  assert.equal(drawerFolded(true, null, null), true);
  assert.equal(drawerFolded(true, null, false), true);
  assert.equal(drawerFolded(true, false, null), false, 'opened this session');
  assert.equal(drawerFolded(false, null, null), false);
  assert.equal(drawerFolded(false, null, true), true, 'folded it once in this browser');
  assert.equal(drawerFolded(false, true, false), true, 'folded it this session');
});
