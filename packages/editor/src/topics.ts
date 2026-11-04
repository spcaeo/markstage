// Topics and internal links (docs/API-LINKS.md), for the Topics and Links screens and the topic part of a page's
// settings: the routes, typed, one shared topic list (fetched once, again after a change), and the site path of a
// page made into an address on the site. Off when the site keeps no topics (config().topics is null).
import { request } from './api';
import { config } from './runtime';

export interface TopicGroup {
  id: string;
  name: string;
  lead: string | null;
  members: string[];
}

export interface Topic {
  id: string;
  version: string;
  title: string;
  description: string;
  /** the main page ("<collection>/<id>") */
  pillar: string | null;
  /** the service page the topic sells */
  money: string | null;
  /** words for links up to the main page */
  anchors: string[];
  /** words that name the topic, for finding sentences about it */
  keywords: string[];
  /** pages in no group */
  members: string[];
  groups: TopicGroup[];
  counts: { pages: number; live: number; weak: number };
}

export interface PageRow {
  ref: string;
  collection: string;
  id: string;
  title: string;
  url: string | null;
  status: string;
  live: boolean;
  noindex: boolean;
  format: 'md' | 'json';
  topic: string | null;
  group: string | null;
  role: 'pillar' | 'lead' | 'member' | null;
  money: boolean;
  /** pages that link to it in their text */
  in: number;
  out: number;
  external: number;
  /** the page's own last-changed date (its modified field, else its date) */
  updated: string | null;
  /** when it first went out, as the entry says (its date field); null: it has none */
  published: string | null;
  /** when it last changed, as the entry says (its modified field); null: it has none */
  modified: string | null;
  /** the editor's address of the page */
  edit: string;
}

export interface Suggestion {
  id: string;
  dir: 'in' | 'out';
  from: string;
  to: string;
  fromTitle: string;
  fromUrl: string | null;
  toTitle: string;
  toUrl: string | null;
  reason: string;
  /** the words to link */
  anchor: string;
  /** link: the words are in the sentence; add: a sentence with them is still to be written */
  how: 'link' | 'add';
  sentence: string | null;
  /** where the words start in the sentence */
  at: number | null;
  section: string | null;
  path: number[] | null;
  start: number | null;
  end: number | null;
  /** the editor's address of the page to change, at the sentence */
  open: string;
}

export interface Finding {
  id: string;
  kind: string;
  level: 'high' | 'medium' | 'low';
  ref: string;
  topic: string | null;
  target?: string | null;
  href?: string;
  anchor?: string;
  sentence?: string;
  section?: string;
  message: string;
  fix: { kind: 'suggest-in' | 'suggest-out' | 'retarget' | 'rel' | 'drop-page' | 'place'; to?: string; href?: string; rel?: string; topic?: string } | null;
  page: { title: string; url: string | null; edit: string | null };
  targetPage?: { title: string; url: string | null; edit: string | null };
  /** the editor at the sentence */
  open: string | null;
}

export type Change = { ok: true; commit: string | null; job: string | null };

/** A page on a topic's journey (GET /links/map): where it sits, and what Health says is wrong with its links. */
export interface JourneyPage extends PageRow {
  /** outside: a page of another topic (or none) that links to or from this topic's pages */
  place: 'member' | 'lead' | 'pillar' | 'money' | 'outside';
  /** no-links-in, weak, no-pillar-link, no-lead-link */
  problems: string[];
  /** the site's form messages whose visit began here (only when the site has form messages at all) */
  leads?: number;
}

/** One link in a page's text. `pair`: the same for every link from one page to another. */
export interface JourneyEdge {
  id: string;
  pair: string;
  from: string;
  /** null: the address is no page of the site (broken, or a redirect off it) */
  to: string | null;
  anchor: string;
  sentence: string;
  /** where the words start in the sentence */
  at: number | null;
  /** the heading above it */
  section: string | null;
  status: 'ok' | 'redirect' | 'noindex' | 'missing';
  href: string;
  /** the site path it points to */
  address: string;
  /** what Health says about it: generic-anchor, anchor-clash, to-redirect, to-noindex, to-missing */
  warn: { kind: string; message: string }[];
  /** the editor at the sentence */
  open: string;
}

/** A link the topic expects that is not there: up to the group lead or the main page, or on to the service page. */
export interface JourneyMissing {
  id: string;
  kind: 'no-pillar-link' | 'no-lead-link' | 'no-money-link';
  from: string;
  to: string;
  message: string;
  /** the suggestion that adds it; null when it was skipped */
  suggestion: Suggestion | null;
  /** the editor at the page */
  open: string;
}

export interface JourneyMap {
  topic: { id: string; title: string; pillar: string | null; money: string | null; moneyGuessed: boolean; groups: { id: string; name: string; lead: string | null }[] };
  pages: JourneyPage[];
  edges: JourneyEdge[];
  missing: JourneyMissing[];
  /** visits: Markstage keeps none; leads: the site has form messages, so pages carry `leads` */
  numbers: { visits: boolean; leads: boolean };
}

const enc = encodeURIComponent;
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const qs = (o: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Does the site keep topics (config `topics`), and is this collection's page in them? */
export const topicsOn = (collection?: string) => !!config().topics && (!collection || config().topics!.collections.includes(collection));

export const listTopics = () => request<{ items: Topic[]; pages: PageRow[]; can: { manage: boolean } }>('topics');
export const getTopic = (id: string) => request<{ topic: Topic; pages: PageRow[]; can: { manage: boolean } }>(`topics/${enc(id)}`);
export const createTopic = (body: Partial<Topic>) => request<{ topic: Topic }>('topics', json('POST', body));
export const updateTopic = (id: string, version: string, body: Partial<Topic>) => request<{ topic: Topic }>(`topics/${enc(id)}`, json('PUT', { ...body, version }));
export const deleteTopic = (id: string, version: string) => request<{ ok: true; commit: string }>(`topics/${enc(id)}${qs({ version })}`, json('DELETE'));
/** Put a page in a topic (a group, as its lead or main page), or in none (topic null). */
export const placePage = (ref: string, topic: string | null, opts: { group?: string | null; role?: 'member' | 'lead' | 'pillar'; index?: number } = {}) =>
  request<{ changed: string[]; commit?: string; topic: Topic | null; page: PageRow | null }>('topics/place', json('POST', { ref, topic, group: opts.group ?? null, role: opts.role ?? 'member', ...(opts.index !== undefined ? { index: opts.index } : {}) }));

export const linkPages = (topic?: string | null) => request<{ items: PageRow[]; topics: { id: string; title: string }[] }>(`links/pages${qs({ topic })}`);
export const linkHealth = (o: { topic?: string | null; kind?: string | null; ref?: string | null } = {}) =>
  request<{ items: Finding[]; counts: Record<string, number>; total: number; kinds: Record<string, string>; topics: { id: string; title: string }[] }>(`links/health${qs(o)}`);
export const suggestFor = (ref: string, dir?: 'in' | 'out') => request<{ page: PageRow; in: Suggestion[]; out: Suggestion[] }>(`links/suggest${qs({ ref, dir })}`);
export const topicJourney = (topic: string) => request<JourneyMap>(`links/map${qs({ topic })}`);
export const linkInbox = (topic?: string | null) => request<{ items: Suggestion[]; counts: { total: number; in: number; out: number; topics: Record<string, number> }; skipped: number }>(`links/inbox${qs({ topic })}`);
export const acceptSuggestion = (s: Suggestion) => request<Change & { from: string; to: string; anchor: string }>('links/accept', json('POST', { id: s.id, from: s.from, to: s.to, dir: s.dir }));
export const skipSuggestion = (s: Suggestion) => request<{ ok: true }>('links/skip', json('POST', { id: s.id, from: s.from, to: s.to, anchor: s.anchor }));
export const listSkips = () => request<{ items: { id: string; from: string; to: string; anchor: string | null; at: string; by: string | null }[] }>('links/skips');
export const unskip = (id: string) => request<{ ok: true }>(`links/skips/${enc(id)}`, json('DELETE'));
export const fixFinding = (id: string) => request<Change>('links/fix', json('POST', { id }));

// one topic list for every picker on the page; a change anywhere fetches it again
let shared: Promise<{ items: Topic[]; can: { manage: boolean } }> | null = null;
const listeners = new Set<() => void>();
export function topics(): Promise<{ items: Topic[]; can: { manage: boolean } }> {
  // the topics alone (?pages=0): a picker on an open entry needs no page rows
  shared ??= request<{ items: Topic[]; can: { manage: boolean } }>('topics?pages=0').then(
    (r) => ({ items: r.items, can: r.can }),
    (e) => {
      shared = null;
      throw e;
    },
  );
  return shared;
}
export function topicsChanged(): void {
  shared = null;
  for (const fn of listeners) fn();
}
export function onTopicsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The words of a role, for people. */
export const ROLE_WORDS: Record<string, string> = { pillar: 'Main page', lead: 'Group lead', member: 'Page' };

/** A sentence with the words to link marked: [before, words, after]. */
export function marked(s: Pick<Suggestion, 'sentence' | 'at' | 'anchor'>): [string, string, string] {
  const text = s.sentence ?? '';
  const at = s.at ?? text.toLowerCase().indexOf(s.anchor.toLowerCase());
  if (at < 0 || at > text.length) return [text, '', ''];
  return [text.slice(0, at), text.slice(at, at + s.anchor.length), text.slice(at + s.anchor.length)];
}
