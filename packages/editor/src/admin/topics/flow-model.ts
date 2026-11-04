// The Flow view's model (flow.ts), with no page drawing in it, so the unit tests read it as it is: each page of a topic
// as a card with a short code (each group a letter and a colour, each page in it a number: A1 is the group's lead, A2
// on its articles; M the main page, S the service page), each pair of pages that link as one connection of a kind
// (on to the next level, skipping a level up, back one level, down from a top page to a deep one, between pages at
// one level, or missing), how old each page is by the dates its entry gives (never guessed), which groups open
// folded, the pages round one page (comes from, goes to, both ways), and the shortest way from a page to the service
// page.
import type { JourneyEdge, JourneyMap, JourneyMissing, JourneyPage } from '../../topics';

export type Role = 'member' | 'lead' | 'pillar' | 'money';
export type Kind = 'on' | 'skip' | 'back' | 'down' | 'side' | 'missing';
/** new: first out in the last 90 days; updated: older, changed in the last 90 days; stale: no change for a year */
export type Age = 'new' | 'updated' | 'stale' | 'steady' | 'nodate';

export const ROLES: Role[] = ['member', 'lead', 'pillar', 'money'];
export const DAY_MS = 86_400_000;
export const RECENT_DAYS = 90;
export const STALE_DAYS = 365;
/** the main page's and the service page's codes; groups never take these letters */
export const MAIN = 'M';
export const SERVICE = 'S';

/**
 * The group colours, light theme (white text on them) then dark theme (dark text on them), clear hues far apart; no
 * magenta (the lines down to deep pages have it) and no olive (it reads as switched off); past eleven groups they come
 * round again, and the letter tells them apart.
 */
export const GROUP_COLOURS: { light: string; dark: string }[] = [
  { light: '#1d5fc4', dark: '#7fb0ff' },
  { light: '#b34700', dark: '#ffa266' },
  { light: '#1a7a3a', dark: '#6fd28f' },
  { light: '#7a3db8', dark: '#c9a2ff' },
  { light: '#00727a', dark: '#5fd3db' },
  { light: '#c0263d', dark: '#ff8a9a' },
  { light: '#0b6c99', dark: '#6cc8f5' },
  { light: '#8a5a2b', dark: '#e0b183' },
  { light: '#4a4fc4', dark: '#a9adff' },
  { light: '#3d5a80', dark: '#a9c3e8' },
  { light: '#b02a5b', dark: '#ff9cc0' },
];
/** a topic with more pages than this is big: it opens with its groups folded but the largest OPEN_LARGEST */
export const FOLD_OVER = 40;
export const OPEN_LARGEST = 3;
export const MAIN_COLOUR = { light: '#2b2f36', dark: '#e8e9ec' };
export const SERVICE_COLOUR = { light: '#8c5b00', dark: '#f2c35e' };
/** the text on a code circle, light theme then dark */
export const CODE_TEXT = { light: '#ffffff', dark: '#111317' };

export interface FlowGroup {
  /** the URL's group key: its id, or '-' for the pages in no group */
  key: string;
  name: string;
  letter: string;
  colour: { light: string; dark: string };
  lead: string | null;
  members: string[];
}

export interface FlowNode {
  ref: string;
  page: JourneyPage;
  role: Role;
  code: string;
  /** its group's key (the main and service pages have none) */
  group: string | null;
  colour: { light: string; dark: string };
  age: Age;
}

export interface FlowConn {
  /** the pair id of its links, or the missing link's id: the URL's `link` */
  key: string;
  from: string;
  to: string;
  kind: Kind;
  links: JourneyEdge[];
  missing: JourneyMissing | null;
}

export interface FlowModel {
  groups: FlowGroup[];
  /** every page of the topic, by ref (codes are the same whatever is shown) */
  all: Map<string, FlowNode>;
  /** the pages shown: one group's, or all; none published after `asOf` */
  nodes: FlowNode[];
  /** the connections between the pages shown */
  conns: FlowConn[];
  /** the levels shown, deepest first */
  roles: Role[];
}

/** Group letters in order, A to Z without M and S, then AA, AB… */
export function letters(n: number): string[] {
  const one = [...'ABCDEFGHIJKLNOPQRTUVWXYZ'];
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) out.push(i < one.length ? one[i] : `${one[Math.floor(i / one.length) - 1]}${one[i % one.length]}`);
  return out;
}

const time = (v: string | null | undefined) => (v ? Date.parse(v) : Number.NaN);

/** How old a page is, from the dates its entry gives (`nodate` when it gives none). */
export function ageOf(p: { published: string | null; modified: string | null }, now: number): Age {
  const pub = time(p.published);
  const mod = time(p.modified);
  if (!Number.isFinite(pub) && !Number.isFinite(mod)) return 'nodate';
  if (Number.isFinite(pub) && now - pub <= RECENT_DAYS * DAY_MS) return 'new';
  if (Number.isFinite(mod) && now - mod <= RECENT_DAYS * DAY_MS) return 'updated';
  // no modified date: the last change on record is when it went out
  const last = Number.isFinite(mod) ? mod : pub;
  return now - last >= STALE_DAYS * DAY_MS ? 'stale' : 'steady';
}

/** A page is on the map on `asOf` (YYYY-MM-DD) when it went out by the end of that day, or has no date to say. */
export function outBy(p: { published: string | null }, asOf: string | null): boolean {
  if (!asOf) return true;
  const pub = time(p.published);
  return !Number.isFinite(pub) || pub < Date.parse(`${asOf}T00:00:00Z`) + DAY_MS;
}

/** The kind of a link from one level to another (ROLES: article, group lead, main page, service page). */
export function kindOf(from: number, to: number): Kind {
  const step = to - from;
  if (step === 0) return 'side';
  if (step === 1) return 'on';
  if (step > 1) return 'skip';
  return step === -1 ? 'back' : 'down';
}

/** The model of what is shown: `group` one group's pages (with the main and service pages), else every page. */
export function buildFlow(d: JourneyMap, o: { group: string | null; asOf: string | null; now: number }): FlowModel {
  const byRef = new Map(d.pages.map((p) => [p.ref, p]));
  const members = d.pages.filter((p) => p.place === 'member');
  // the topic's groups in its order, then the pages in no group (so a group keeps its letter when those come and go)
  const raw = [...d.topic.groups.map((g) => ({ key: g.id, name: g.name, lead: g.lead && byRef.has(g.lead) ? g.lead : null })), { key: '-', name: 'Pages without a group', lead: null as string | null }]
    .map((g) => ({ ...g, members: members.filter((p) => (p.group || '-') === g.key).map((p) => p.ref) }))
    .filter((g) => g.members.length || g.lead);
  const abc = letters(raw.length);
  const groups: FlowGroup[] = raw.map((g, i) => ({ ...g, letter: abc[i], colour: GROUP_COLOURS[i % GROUP_COLOURS.length] }));

  const all = new Map<string, FlowNode>();
  const add = (p: JourneyPage, role: Role, code: string, group: string | null, colour: FlowNode['colour']) => all.set(p.ref, { ref: p.ref, page: p, role, code, group, colour, age: ageOf(p, o.now) });
  for (const g of groups) {
    let n = 1;
    if (g.lead) add(byRef.get(g.lead)!, 'lead', `${g.letter}${n++}`, g.key, g.colour);
    for (const r of g.members) add(byRef.get(r)!, 'member', `${g.letter}${n++}`, g.key, g.colour);
  }
  const pillar = d.pages.find((p) => p.place === 'pillar');
  const money = d.pages.find((p) => p.place === 'money');
  if (pillar) add(pillar, 'pillar', MAIN, null, MAIN_COLOUR);
  if (money) add(money, 'money', SERVICE, null, SERVICE_COLOUR);

  const only = o.group && groups.some((g) => g.key === o.group) ? o.group : null;
  const nodes = [...all.values()].filter((n) => (!only || n.group === null || n.group === only) && outBy(n.page, o.asOf));
  const shown = new Set(nodes.map((n) => n.ref));
  const level = (ref: string) => ROLES.indexOf(all.get(ref)!.role);
  const pairs = new Map<string, FlowConn>();
  for (const e of d.edges) {
    if (!e.to || e.to === e.from || !shown.has(e.from) || !shown.has(e.to)) continue;
    let c = pairs.get(e.pair);
    if (!c) pairs.set(e.pair, (c = { key: e.pair, from: e.from, to: e.to, kind: kindOf(level(e.from), level(e.to)), links: [], missing: null }));
    c.links.push(e);
  }
  const conns = [...pairs.values()];
  for (const m of d.missing) if (shown.has(m.from) && shown.has(m.to)) conns.push({ key: m.id, from: m.from, to: m.to, kind: 'missing', links: [], missing: m });
  return { groups, all, nodes, conns, roles: ROLES.filter((r) => nodes.some((n) => n.role === r)) };
}

/** The links from one page to another, by "from>to". */
export function countLinks(conns: FlowConn[]): (from: string, to: string) => number {
  const n = new Map<string, number>();
  for (const c of conns) if (c.kind !== 'missing') n.set(`${c.from}>${c.to}`, (n.get(`${c.from}>${c.to}`) ?? 0) + c.links.length);
  return (from, to) => n.get(`${from}>${to}`) ?? 0;
}

/**
 * The groups open at first: every one, but on a big topic (more than FOLD_OVER pages) only the OPEN_LARGEST with the
 * most articles (the first of them on a tie).
 */
export function defaultOpen(groups: FlowGroup[], pages: number): Set<string> {
  if (pages <= FOLD_OVER) return new Set(groups.map((g) => g.key));
  return new Set([...groups].sort((a, b) => b.members.length - a.members.length).slice(0, OPEN_LARGEST).map((g) => g.key));
}

/** The URL's `open` (group keys with commas; `none`; `all`) as the groups open, else the ones open at first. */
export function openFrom(v: string | null, groups: FlowGroup[], pages: number): Set<string> {
  if (v === null) return defaultOpen(groups, pages);
  if (v === 'all') return new Set(groups.map((g) => g.key));
  if (v === 'none' || v === '') return new Set();
  const keys = new Set(groups.map((g) => g.key));
  return new Set(v.split(',').filter((k) => keys.has(k)));
}

/** The groups open as the URL's `open`: null when they are the ones open at first. */
export function openParam(open: Set<string>, groups: FlowGroup[], pages: number): string | null {
  const first = defaultOpen(groups, pages);
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));
  if (same(open, first)) return null;
  if (!open.size) return 'none';
  if (open.size === groups.length) return 'all';
  return groups.filter((g) => open.has(g.key)).map((g) => g.key).join(',');
}

/** Round one page: the pages that only link to it, that it only links to, and that link both ways, in code order. */
export function stepSides(m: FlowModel, focus: string): { from: string[]; to: string[]; both: string[] } {
  const ins = new Set<string>();
  const outs = new Set<string>();
  for (const c of m.conns) {
    if (c.kind === 'missing') continue;
    if (c.to === focus) ins.add(c.from);
    if (c.from === focus) outs.add(c.to);
  }
  const order = (a: string, b: string) => codeOrder(m.all.get(a)!.code, m.all.get(b)!.code);
  return { from: [...ins].filter((r) => !outs.has(r)).sort(order), to: [...outs].filter((r) => !ins.has(r)).sort(order), both: [...ins].filter((r) => outs.has(r)).sort(order) };
}

/** The trail (`trail`, refs with commas) after walking from the page shown to `next`: back to it when it is on it. */
export function walk(trail: string[], here: string, next: string): string[] {
  const at = trail.indexOf(next);
  if (at >= 0) return trail.slice(0, at);
  return next === here ? trail : [...trail, here];
}

/** Codes in reading order: A1, A2, A10, B1 … then M, then S. */
export function codeOrder(a: string, b: string): number {
  const rank = (c: string) => (c === MAIN ? 1 : c === SERVICE ? 2 : 0);
  return rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true });
}

/**
 * The shortest way along the topic's links from one page to another, as refs (from first), or null when there is
 * none. Every connection counts, whatever its kind, but a missing one does not.
 */
export function wayTo(conns: FlowConn[], from: string, to: string): string[] | null {
  if (from === to) return [from];
  const next = new Map<string, string[]>();
  for (const c of conns) if (c.kind !== 'missing') next.set(c.from, [...(next.get(c.from) ?? []), c.to]);
  const prev = new Map<string, string>([[from, '']]);
  const queue = [from];
  while (queue.length) {
    const r = queue.shift()!;
    for (const n of next.get(r) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, r);
      if (n === to) {
        const way = [n];
        for (let p = r; p; p = prev.get(p)!) way.unshift(p);
        return way;
      }
      queue.push(n);
    }
  }
  return null;
}

/** The days a "show the site as it was on" slider runs over: the first page's date to today (null: no dates). */
export function dateRange(d: JourneyMap, now: number): { first: string; last: string } | null {
  const times = d.pages.filter((p) => p.place !== 'outside').map((p) => time(p.published)).filter(Number.isFinite);
  if (!times.length) return null;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { first: iso(Math.min(...times)), last: iso(Math.max(now, ...times)) };
}

/** Relative luminance and contrast (WCAG 2), for the colour tests and the guard in the tests. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const v = hex.replace('#', '');
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * A page's title short enough for a node: up to its first colon, dash, bracket or question mark, without the year
 * (the whole title is on the node's hover, in its spoken label and in the side panel).
 */
export function shortTitle(title: string): string {
  let t = title.replace(/\s*\[\d{4}\]/g, '');
  const cut = /\s*(?::|\s[—–-]\s|\(|\[|\|)/.exec(t);
  if (cut && cut.index >= 12) t = t.slice(0, cut.index);
  const ask = t.indexOf('?');
  if (ask >= 12) t = t.slice(0, ask + 1);
  t = t
    .replace(/\s+(?:in|for)\s+\d{4}\b/gi, '')
    .replace(/\s+\d{4}$/, '')
    .replace(/^(\S.*?)\s+\d{4}(?=\s|$)/, '$1')
    .trim();
  return t || title;
}
