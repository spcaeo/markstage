// The shell's words, with no DOM (docs/EDITOR-UX.md sections 2 and 3, binding): the drawer's groups and what each
// registered screen is called in it, the "More tools" list, the place chip, the greeting. test/shell-words.test.ts
// checks that nothing internal (Entries, Jobs, Inbox, Media, Audit log, Environments…) reaches the drawer.

export type MenuGroup = 'content' | 'visitors' | 'publishing' | 'site' | 'tools';

/** The drawer's groups, in order, with the heading people see. */
export const GROUPS: { id: Exclude<MenuGroup, 'tools'>; label: string; folded: boolean }[] = [
  { id: 'content', label: 'Content', folded: false },
  { id: 'visitors', label: 'Visitors', folded: false },
  { id: 'publishing', label: 'Publishing', folded: true },
  { id: 'site', label: 'Site & team', folded: true },
];

/** A screen as the drawer needs it (the registry's ScreenDef, or a test's stand-in). */
export interface MenuScreen {
  name: string;
  label: string;
  icon: string;
  nav?: 'main' | 'admin' | null;
  roles?: string[];
  group?: MenuGroup;
  menuLabel?: string;
}

export interface MenuItem {
  href: string;
  label: string;
  icon: string;
  /** the key its count is set under (a collection's entries, the unread messages) */
  count?: string;
  /** the screen it marks as current */
  screen: string | null;
}

/** A collection, as the drawer lists it (one item per kind of content). */
export interface MenuCollection {
  id: string;
  label: string;
  format: 'md' | 'json';
}

/** Internal words that must never be a drawer label. */
export const FORBIDDEN = ['Entries', 'Jobs', 'Inbox', 'Media', 'Audit log', 'Environments', 'Users', 'Site health', 'Redirects', 'Find and replace', 'Library', 'Translations', 'Publishing jobs', 'Promotion'];

/** Every word the drawer may show for a screen (the word list, plus the site's own collection names). */
export const WORDS = new Set([
  'Home', 'Create', 'Pages', 'Blog posts', 'Images & files', 'Site menus', 'Messages', 'Go live', 'Scheduled & history',
  'Site settings', 'Languages', 'People & access', 'Site check-up', 'Backups', 'Trash', 'More tools',
  'Moved addresses', 'Change many at once', 'Reusable sections', 'Page tree', 'Activity', 'Staging & live', 'Categories and tags',
  'Authors', 'Links between pages', 'Topic map', 'Section gallery', 'Topics', 'Import a site',
]);

/** What a collection is called in the drawer: the pages "Pages", the one kind of writing "Blog posts", the rest its own label. */
export function collectionWord(c: MenuCollection): string {
  if (c.id === 'pages' || /^pages?$/i.test(c.label)) return 'Pages';
  if (/post|article|blog|news/i.test(`${c.id} ${c.label}`)) return 'Blog posts';
  return c.label;
}

const order = (c: MenuCollection) => (collectionWord(c) === 'Pages' ? 0 : collectionWord(c) === 'Blog posts' ? 1 : 2);

/** The drawer's plan for one person: Home, then each group's items; More tools apart. */
export function drawerPlan(screens: MenuScreen[], collections: MenuCollection[], role: string): { groups: { id: string; label: string; folded: boolean; items: MenuItem[] }[]; tools: MenuItem[] } {
  const visible = screens.filter((d) => !d.roles || d.roles.includes(role));
  const by = (name: string) => visible.find((d) => d.name === name) ?? null;
  const item = (d: MenuScreen, href = `#/${d.name}`): MenuItem => ({ href, label: d.menuLabel ?? d.label, icon: d.icon, screen: d.name });
  const groups = GROUPS.map((g) => ({ ...g, items: [] as MenuItem[] }));
  const into = (id: MenuGroup, it: MenuItem) => groups.find((g) => g.id === id)?.items.push(it);
  // the content lists: one item per kind, from the Entries screen
  const entries = by('entries');
  if (entries) for (const c of [...collections].sort((a, b) => order(a) - order(b))) into('content', { href: `#/entries?c=${encodeURIComponent(c.id)}`, label: collectionWord(c), icon: c.format === 'md' ? 'article' : 'file', count: `entries:${c.id}`, screen: 'entries' });
  for (const d of visible) {
    if (!d.group || d.group === 'tools' || d.name === 'entries') continue;
    const it = item(d);
    if (d.name === 'inbox') it.count = 'inbox';
    into(d.group, it);
    // Backups live on the check-up screen: their own line in the drawer
    if (d.name === 'health') into('site', { href: '#/health?part=backups', label: 'Backups', icon: 'history', screen: null });
  }
  // each group in the rulebook's order; a screen it does not name comes after, as registered
  const ORDER = ['media', 'menus', 'inbox', 'releases', 'jobs', 'settings', 'translations', 'users', 'health', 'backups', 'trash'];
  const rank = (it: MenuItem) => (it.label === 'Backups' ? ORDER.indexOf('backups') : it.screen === 'entries' ? -1 : ORDER.includes(it.screen ?? '') ? ORDER.indexOf(it.screen!) : ORDER.length);
  for (const g of groups) g.items.sort((a, b) => rank(a) - rank(b));
  const tools = visible
    .filter((d) => (d.nav && !d.group) || d.group === 'tools')
    .map((d) => item(d))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { groups, tools };
}

/** "Good morning, Sam": by the hour (0–23), with the first name. */
export function greeting(hour: number, name: string): string {
  const first = name.trim().split(/\s+/)[0] || '';
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return first ? `${part}, ${first}` : part;
}

/** A status as a pill: live, draft, or scheduled. */
export function statusWord(status: string | undefined): { word: string; kind: 'live' | 'draft' | 'scheduled' } {
  if (status === 'draft') return { word: 'Draft', kind: 'draft' };
  if (status === 'scheduled') return { word: 'Scheduled', kind: 'scheduled' };
  return { word: 'Live', kind: 'live' };
}

/**
 * Whether the drawer starts folded (an icon rail): what the person chose in this session wins; with no choice, a
 * narrow window (under 1100px) folds it, and a wide one goes back to what this browser remembers.
 */
export function drawerFolded(narrow: boolean, session: boolean | null, remembered: boolean | null): boolean {
  if (session !== null) return session;
  if (narrow) return true;
  return !!remembered;
}
