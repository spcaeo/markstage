// The site's menus as the Menus screen (index.ts) sees them: every list of links in a `navigation` entry (an array of
// objects with a `label`, nested by `children`), turned into the order component's items and back. An item links to
// an entry (`entry: "pages/about-us"`, which the site turns into that entry's address, so a move never breaks it; or
// the site's own key for it, config linkKeys: `page: "about-us"`) or to an address (`href`); with neither it is a
// heading that opens its list. Items get their ids here, in memory only, so the file keeps its shape; a list written
// back keeps every other key and its place (`children: []` too, and `_` keys such as `_lock` last), so moving an item
// back gives the file byte for byte.
import { flatten } from '@markstage/core';
import type { OrderItem } from '../order';

export type Raw = Record<string, unknown>;

export interface MenuItem extends OrderItem {
  /** the object as it is in the file (its `children` are the item's children, not these) */
  raw: Raw;
  children?: MenuItem[];
}

export interface MenuDef {
  /** the dotted path of the list in the entry: "primary", "footer.columns.0.links" */
  path: string;
  title: string;
  /** items may hold others (the list has an item with `children`); how deep the site shows them */
  tree: boolean;
  maxDepth: number;
}

// the site's keys that name an entry by its id ({page: 'pages'}), set by the screen from the collection's config
let linkKeys: Record<string, string> = {};
export function useLinkKeys(keys: Record<string, string> | undefined): void {
  linkKeys = { ...(keys ?? {}) };
}
const isLinkKey = (k: string) => k === 'entry' || k === 'href' || k in linkKeys;

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const isLink = (v: unknown): v is Raw => isObj(v) && typeof v.label === 'string';
const words = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());

function depthOf(list: Raw[]): number {
  return Math.max(0, ...list.map((x) => (Array.isArray(x.children) && x.children.length ? 1 + depthOf(x.children as Raw[]) : 0)));
}

/** Every menu in the entry, in the file's order. */
export function findMenus(data: Raw): MenuDef[] {
  const out: MenuDef[] = [];
  const walk = (v: unknown, path: string[], names: string[]) => {
    if (Array.isArray(v)) {
      if (v.length && v.every(isLink)) {
        const depth = depthOf(v);
        out.push({ path: path.join('.'), title: names.join(': '), tree: depth > 0, maxDepth: depth });
        return;
      }
      v.forEach((x, i) => walk(x, [...path, String(i)], isObj(x) && typeof (x.title ?? x.label) === 'string' ? [...names.slice(0, 1), String(x.title ?? x.label)] : names));
    } else if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) walk(x, [...path, k], names.length > 1 ? names : [...names, words(k)]);
  };
  walk(data, [], []);
  // a list of its own name ("Primary"), or the group it is in and its title ("Footer: Company")
  return out.map((m) => ({ ...m, title: m.title || words(m.path) }));
}

export function listAt(data: Raw, path: string): Raw[] {
  let v: unknown = data;
  for (const k of path.split('.')) v = Array.isArray(v) ? v[Number(k)] : isObj(v) ? v[k] : undefined;
  return Array.isArray(v) ? (v as Raw[]) : [];
}

/** The list as items; ids are the item's place in reading order ("m3"), the same each time the file is read. */
export function toItems(list: Raw[]): MenuItem[] {
  let n = 0;
  const conv = (x: Raw): MenuItem => {
    const lock = isObj(x._lock) ? (x._lock as MenuItem['lock']) : undefined;
    const item: MenuItem = { id: `m${++n}`, label: String(x.label), raw: x, ...(lock ? { lock } : {}) };
    if (Array.isArray(x.children)) item.children = (x.children as Raw[]).map(conv);
    return item;
  };
  return list.map(conv);
}

/** The items as the file holds them: each object's keys in their place, `children` where it was (an empty one kept
 *  as `[]`), and an item moved into a list takes that list's shape: `children: []` where every other item has the
 *  key, none where no other item has it (so a Keystatic save would write the file the same). A new `children` goes
 *  before the `_` keys, which stay last. A changed label or link is in `raw`. */
export function fromItems(items: MenuItem[]): Raw[] {
  return items.map((it) => {
    const kids = it.children?.length ? fromItems(it.children) : null;
    const others = items.filter((x) => x !== it);
    const had = 'children' in it.raw;
    const keep = kids !== null || (others.length ? (others.every((x) => 'children' in x.raw) ? true : others.some((x) => 'children' in x.raw) ? had : false) : had);
    const value = kids ?? [];
    const out: Raw = {};
    for (const [k, v] of Object.entries(it.raw)) {
      if (k === 'children') {
        if (keep) out.children = kids ?? (Array.isArray(v) ? [] : v);
        continue;
      }
      if (keep && k.startsWith('_') && !('children' in out)) out.children = value;
      out[k] = v;
    }
    if (keep && !('children' in out)) out.children = value;
    return out;
  });
}

/** Where an item links: an entry ("pages/about-us"), an address, or nothing (a heading). */
export type Link = { entry: string } | { href: string } | null;

export function linkOf(raw: Raw): Link {
  if (typeof raw.entry === 'string' && raw.entry) return { entry: raw.entry };
  for (const [k, col] of Object.entries(linkKeys)) if (typeof raw[k] === 'string' && raw[k]) return { entry: `${col}/${raw[k]}` };
  if (typeof raw.href === 'string' && raw.href) return { href: raw.href };
  return null;
}

/** Whether a link to this entry can be written by id (`entry`, or a linkKeys key for its collection). */
export function byId(ref: string): boolean {
  const col = ref.split('/')[0];
  return !Object.keys(linkKeys).length || Object.values(linkKeys).includes(col!);
}

/** A link as the file writes it: `entry`, the site's key for that collection ({page: "about-us"}), or `href`. */
function written(to: Link): Raw | null {
  if (!to || 'href' in to) return to;
  const [col, ...rest] = to.entry.split('/');
  const key = Object.keys(linkKeys).find((k) => linkKeys[k] === col);
  return key ? { [key]: rest.join('/') } : to;
}

/** `raw` linking to `to` instead: the new key takes the old one's place (the file changes on that line only), else
 *  before `children` and the `_` keys. */
export function withLink(raw: Raw, to: Link): Raw {
  const out: Raw = {};
  const w = written(to);
  let put = false;
  const add = () => {
    if (!put && w) Object.assign(out, w);
    put = true;
  };
  for (const [k, v] of Object.entries(raw)) {
    if (isLinkKey(k)) add();
    else {
      if (k === 'children' || k.startsWith('_')) add();
      out[k] = v;
    }
  }
  add();
  return out;
}

let made = 0;
/** A new item (added from the screen); its id cannot meet one from toItems. */
export const newItem = (label: string, to: Link): MenuItem => ({ id: `new${++made}`, label, raw: withLink({ label }, to) });

/** A copy of an item and its children, with new ids; a lock stays with the original. */
export function copyItem(it: MenuItem): MenuItem {
  const { _lock, ...raw } = it.raw;
  const { lock, ...rest } = it;
  return { ...rest, id: `new${++made}`, raw, children: it.children?.map(copyItem) };
}

/** A short hash of the text (FNV-1a, base 36). */
function hash(s: string): string {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return x.toString(36);
}

/** Each item's key for the address (?item=): a hash of its link (or label), with "-2" for a second one the same, so
 *  it holds across reloads and moves, unlike the ids. */
function keys(items: MenuItem[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const r of flatten(items)) {
    const to = linkOf(r.item.raw);
    const base = hash((to ? ('entry' in to ? to.entry : to.href) : '') || r.item.label);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(r.item.id, n > 1 ? `${base}-${n}` : base);
  }
  return out;
}

export const keyOf = (items: MenuItem[], id: string) => keys(items).get(id) ?? null;
export const idOfKey = (items: MenuItem[], key: string | null) => (key ? ([...keys(items)].find(([, k]) => k === key)?.[0] ?? null) : null);
