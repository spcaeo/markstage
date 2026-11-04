// What a menu item can link to (menus/index.ts): every entry that has a page (as `entry: "pages/about-us"`, so the
// link follows the page when it moves; by its address when the site's linkKeys name no key for its collection) and
// the site's special links (config editor.links, as addresses).
import { listEntries } from '../api';
import { specialLinks } from '../links';
import { config } from '../runtime';
import { byId, type Link } from './model';

export interface Target {
  label: string;
  link: Link;
  /** the address it has now */
  url: string;
  /** "Pages", "Articles", "Link" */
  kind: string;
}

let all: Promise<Target[]> | null = null;

/** Loaded once per editor session. */
export function loadTargets(): Promise<Target[]> {
  all ??= (async () => {
    const cols = config().collections.filter((c) => c.hasUrl);
    const lists = await Promise.all(cols.map((c) => listEntries(c.id).catch(() => [])));
    return [
      ...specialLinks().map((l) => ({ label: l.label, link: { href: l.href }, url: l.href, kind: 'Link' })),
      ...lists.flatMap((list, i) => list.flatMap((e) => (e.url ? [{ label: e.title || e.id, link: byId(`${e.collection}/${e.id}`) ? { entry: `${e.collection}/${e.id}` } : { href: e.url }, url: e.url, kind: cols[i]!.label }] : []))),
    ];
  })();
  return all;
}

/** The entry a ref names ("pages/about-us"), or undefined when there is none (deleted, or a typo). */
export const targetOf = (list: Target[], ref: string) => list.find((t) => t.link && 'entry' in t.link && t.link.entry === ref);

/** The ones matching `q` (title or address). */
export function search(list: Target[], q: string): Target[] {
  const n = q.trim().toLowerCase();
  const hit = n ? list.filter((t) => t.label.toLowerCase().includes(n) || t.url.toLowerCase().includes(n)) : list;
  return hit.slice(0, 30);
}
