// What ⌘K finds besides pages and posts (QA F25): the editor's screens and the parts of Site settings, by their plain
// words and a few synonyms ("trash", "people", "backups", "go live"), for the roles that may open them. A static
// list, so it costs nothing and reads the same on every site; the screens' own labels come from the registry.
/** What the registry (host.ts screens()) says about a screen: the part this list reads. */
export interface ScreenLike {
  name: string;
  label: string;
  menuLabel?: string;
  group?: string | null;
  roles?: string[] | null;
  public?: boolean;
}

export interface ScreenHit {
  label: string;
  href: string;
  /** a word or two under the name: the group, or what it holds */
  hint: string;
}

/** Synonyms a person might type for a screen, by its registry name. */
const WORDS: Record<string, string> = {
  entries: 'list pages posts articles blog content',
  media: 'images files pictures photos uploads library media',
  menus: 'navigation nav site menus links header footer',
  inbox: 'messages inbox visitors forms contact leads',
  releases: 'go live release publish together launch',
  jobs: 'scheduled history jobs publishing builds log queue',
  settings: 'site settings locks alerts tokens rules roles options preferences',
  translations: 'languages regions locales translate',
  users: 'people access users team invite roles accounts',
  health: 'site check-up health checks alt text links headings deploy backups',
  trash: 'trash deleted bin recycle restore',
  redirects: 'moved addresses redirects urls old address',
  replace: 'change many at once find and replace search replace',
  library: 'reusable sections snippets templates library',
  order: 'page tree order move pages hierarchy',
  audit: 'activity audit log who did what history',
  environments: 'staging live environments promote sync rollback',
  taxonomy: 'categories tags topics labels',
  authors: 'authors writers bylines people',
  links: 'links between pages suggestions link inbox internal links',
  'topic-map': 'topic map clusters topics',
  gallery: 'section gallery samples components',
  groups: 'topics groups clusters',
  account: 'your account my account password two-step 2fa sessions sign out',
  'my-alerts': 'my alerts notifications email digest',
  new: 'new draft create post page write',
};

/** The parts of Site settings, each its own hit (their words are above under `settings` too). */
const PARTS: ScreenHit[] = [
  { label: 'Site settings · Locks', href: '#/settings/locks', hint: 'what writers may not change' },
  { label: 'Site settings · Alerts', href: '#/settings/alerts', hint: 'who hears about failures' },
  { label: 'Site settings · Tokens', href: '#/settings/tokens', hint: 'personal tokens for the command line and AI agents' },
  { label: 'Site settings · Roles', href: '#/settings/roles', hint: 'custom roles' },
  { label: 'Site settings · Promotion rules', href: '#/settings/environments/rules', hint: 'what may go from staging to live, and when' },
  { label: 'Backups', href: '#/health?part=backups', hint: 'the last backup, Back up now' },
];

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s&-]/gu, ' ');

/** Every screen this role may open, with its words. */
export function screenIndex(role: string, defs: ScreenLike[]): (ScreenHit & { words: string })[] {
  const out: (ScreenHit & { words: string })[] = [];
  for (const d of defs) {
    if (d.public || (d.roles && !d.roles.includes(role))) continue;
    if (['sign-in', 'setup', 'accept-invite', 'publish', 'revisions', 'bulk', 'share'].includes(d.name)) continue;
    const label = d.menuLabel ?? d.label;
    out.push({ label, href: `#/${d.name}`, hint: d.group ? d.group === 'tools' ? 'More tools' : d.group : 'screen', words: norm(`${label} ${d.label} ${d.name} ${WORDS[d.name] ?? ''}`) });
  }
  const manager = role === 'owner' || role === 'administrator';
  for (const p of PARTS) if (manager || p.href === '#/settings/tokens') out.push({ ...p, words: norm(`${p.label} ${p.hint} ${WORDS.settings} ${p.label.includes('Backups') ? WORDS.health : ''}`) });
  return out;
}

/** The screens whose words have every word of `q`, best first (a label that starts with the words wins). */
export function searchScreens(q: string, role: string, index: (ScreenHit & { words: string })[]): ScreenHit[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index
    .filter((s) => words.every((w) => s.words.includes(w)))
    .sort((a, b) => Number(norm(b.label).startsWith(words[0]!)) - Number(norm(a.label).startsWith(words[0]!)) || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map(({ label, href, hint }) => ({ label, href, hint }));
}
