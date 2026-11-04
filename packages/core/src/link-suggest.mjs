// Link suggestions, both ways (docs/API-LINKS.md), from the link map (link-map.mjs) and the topics (topics.mjs):
//   outgoingSuggestions   writing page D: the pages D should link to (its topic's main page, its group's lead, the
//                         topic's service page, two or three pages next to it), each with the words to link and the
//                         sentence of D they fit in (or "add a sentence" when D has none yet)
//   incomingSuggestions   publishing D: sentences on other pages that talk about D, with the words to link
//   linkInbox             every open suggestion of the site that one click can apply, with counts
//   linkWords / setLinkAt the document edits that apply one (a link mark on those words; a link's address or rel)
// Words are matched as phrases first (the page's keywords, its topic's words, its title made short); a site can add
// its own finder (an embeddings index, an AI model) through its `topics.related` hook: the words it answers for a
// page are on the page as `related` and count as words people wrote.
import { hashId, inlineLen, isGeneric, moneyFor, normAnchor } from './link-map.mjs';

const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsIn = (s) => String(s ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** A title made short enough to link: no subtitle, no year, no "How to"/"What is"/"Best 10". */
export function shortTitle(title) {
  let h = String(title ?? '').split(/[:?—([]| – | - | \| /)[0].trim();
  h = h.replace(/\b(19|20)\d\d\b/g, '').trim();
  h = h.replace(/^(how to|what is|what are|why|does|can|is)\s+/i, '');
  h = h.replace(/^(top|best|the)\s+(\d+\s+)?(best\s+)?/i, '').replace(/^\d+\s+(best\s+)?/i, '');
  return h.split(/\s+/).filter(Boolean).join(' ');
}

/**
 * The phrases that name a page, longest first: [{text, norm, strong}]. Strong ones were written by people (the
 * page's keywords, its topic's words when it is the main page, its group's name when it leads one) or come from the
 * site's own finder (`related`), and may be one word; the others come from its title and address and need two words
 * or more.
 */
export function phrasesOf(map, ref) {
  const p = map.pages.get(ref);
  if (!p) return [];
  const t = p.topic ? map.topics.get(p.topic) : null;
  const out = new Map();
  const add = (text, strong) => {
    const s = String(text ?? '').split(/\s+/).filter(Boolean).join(' ');
    const norm = normAnchor(s);
    const n = wordsIn(s).length;
    if (!norm || isGeneric(norm, map.cfg?.generic) || n > 8 || (!strong && n < 2) || norm.length < 3) return;
    if (!out.has(norm)) out.set(norm, { text: s, norm, strong, words: n });
  };
  for (const k of p.keywords ?? []) add(k, true);
  for (const k of p.related ?? []) add(k, true);
  if (t && p.role === 'pillar') [...t.anchors, ...t.keywords, t.title].forEach((x) => add(x, true));
  const g = t && p.group ? t.groups.find((x) => x.id === p.group) : null;
  if (g && p.role === 'lead') add(g.name, true);
  add(shortTitle(p.title), false);
  if (wordsIn(p.title).length <= 6) add(p.title, false);
  const slug = String(p.url ?? '').replace(/\/+$/, '').split('/').pop() ?? '';
  add(slug.replace(/[-_]+/g, ' '), false);
  return [...out.values()].sort((a, b) => b.words - a.words || b.text.length - a.text.length);
}

/** Do these words already link to another page (so linking them here would name two pages)? */
const takenByOther = (map, norm, ref) => [...(map.anchors.get(norm)?.keys() ?? [])].some((r) => r !== ref);

/** Every page's words, for finding the pages a phrase could be on without reading them all (kept on the map). */
function wordIndex(map) {
  if (map._words) return map._words;
  const idx = new Map();
  for (const p of map.pages.values()) {
    for (const b of p.blocks ?? []) {
      for (const w of wordsIn(b.text)) {
        if (!idx.has(w)) idx.set(w, new Set());
        idx.get(w).add(p.ref);
      }
    }
  }
  Object.defineProperty(map, '_words', { value: idx, enumerable: false });
  return idx;
}

/** The pages whose text has every word of the phrase. */
function pagesWith(map, phrase) {
  const idx = wordIndex(map);
  let set = null;
  for (const w of new Set(wordsIn(phrase.text))) {
    const has = idx.get(w);
    if (!has) return new Set();
    set = set ? new Set([...set].filter((r) => has.has(r))) : new Set(has);
  }
  return set ?? new Set();
}

/** The sentence around [start, end) of a block's text, with where the words start in it: {sentence, at}. */
function around(text, start, end) {
  const re = /[.!?…](?=\s+["“(]?[A-Z0-9])/g;
  let from = 0;
  let to = text.length;
  for (const m of text.matchAll(re)) {
    const cut = m.index + 1;
    if (cut <= start) from = cut;
    else if (cut >= end) {
      to = cut;
      break;
    }
  }
  if (to - from > 300) {
    from = Math.max(from, start - 140);
    to = Math.min(to, end + 140);
  }
  const raw = text.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  return { sentence: raw.trim(), at: start - from - lead };
}

/** The first place in a page's text where one of the phrases stands unlinked: {block, start, end, anchor, phrase}. */
function findIn(page, phrases, map, ref) {
  for (const ph of phrases) {
    if (takenByOther(map, ph.norm, ref)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escRe(ph.text).replace(/\\? +/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
    for (const b of page.blocks ?? []) {
      if (b.kind !== 'paragraph' || b.html || b.text.length < 30) continue;
      for (const m of b.text.matchAll(re)) {
        const start = m.index;
        const end = start + m[0].length;
        if (b.links.some((l) => l.start !== null && l.start < end && l.end > start)) continue;
        return { block: b, start, end, anchor: m[0], phrase: ph };
      }
    }
  }
  return null;
}

const REASONS = {
  pillar: (map, p, t) => `The main page of the topic “${t.title}”.`,
  lead: (map, p, t, g) => `The lead page of “${g?.name ?? 'its group'}”.`,
  money: () => 'The service page for this topic.',
  sibling: (map, p, t, g) => `Another page in “${g?.name ?? t.title}”.`,
  down: (map, p, t) => `A page in the topic “${t.title}”.`,
};

/** One suggestion's shape: {id, dir, from, to, fromTitle, toTitle, toUrl, reason, anchor, how, sentence, at, section, path, start, end}. */
function suggestion(map, dir, from, to, reason, hit, pool) {
  const f = map.pages.get(from);
  const t = map.pages.get(to);
  if (hit) {
    const { sentence, at } = around(hit.block.text, hit.start, hit.end);
    return { id: hashId('sg', dir, from, to, normAnchor(hit.anchor), sentence), dir, from, to, fromTitle: f.title, fromUrl: f.url ?? null, toTitle: t.title, toUrl: t.url ?? null, reason, anchor: hit.anchor, how: 'link', sentence, at, section: hit.block.section, path: hit.block.path, start: hit.start, end: hit.end };
  }
  const anchor = pool.find((ph) => !takenByOther(map, ph.norm, to))?.text ?? shortTitle(t.title) ?? t.title;
  return { id: hashId('sg', dir, from, to, normAnchor(anchor), ''), dir, from, to, fromTitle: f.title, fromUrl: f.url ?? null, toTitle: t.title, toUrl: t.url ?? null, reason, anchor, how: 'add', sentence: null, at: null, section: null, path: null, start: null, end: null };
}

/**
 * Writing page `ref`: the pages it should link to and does not yet, most needed first: its topic's main page, its
 * group's lead, the topic's service page, the pages a main page or lead should list, two or three pages next to it.
 */
export function outgoingSuggestions(map, ref, { limit = 8, skipped = new Set() } = {}) {
  const p = map.pages.get(ref);
  if (!p) return [];
  const t = p.topic ? map.topics.get(p.topic) : null;
  const g = t && p.group ? t.groups.find((x) => x.id === p.group) : null;
  const wants = [];
  const add = (to, why) => {
    if (to && to !== ref && map.pages.has(to) && !p.to.has(to) && !wants.some((w) => w.to === to)) wants.push({ to, why });
  };
  if (t) {
    if (p.role !== 'pillar') add(t.pillar, 'pillar');
    if (g && p.role === 'member') add(g.lead, 'lead');
  }
  add(moneyFor(map, ref), 'money');
  if (t && p.role === 'pillar') {
    for (const x of t.groups) (x.lead ? [x.lead] : x.members).forEach((r) => add(r, 'down'));
    t.members.forEach((r) => add(r, 'down'));
  }
  if (g && p.role === 'lead') g.members.forEach((r) => add(r, 'down'));
  if (t && p.role === 'member') {
    const next = (g ? g.members : t.members).filter((r) => r !== ref && map.pages.has(r));
    const have = next.filter((r) => p.to.has(r)).length;
    next
      .filter((r) => !p.to.has(r))
      .sort((a, b) => map.pages.get(a).in - map.pages.get(b).in || String(map.pages.get(a).title).localeCompare(String(map.pages.get(b).title)))
      .slice(0, Math.max(0, 3 - have))
      .forEach((r) => add(r, 'sibling'));
  }
  return wants
    .map((w) => {
      const phrases = phrasesOf(map, w.to);
      return suggestion(map, 'out', ref, w.to, REASONS[w.why](map, p, t, g), findIn(p, phrases, map, w.to), phrases);
    })
    .filter((s) => !skipped.has(s.id))
    .slice(0, limit);
}

/**
 * Publishing page `ref`: sentences on other pages (Markdown ones, which a click can change) that talk about it and
 * do not link to it yet, closest first: its topic's main page and its group, then its topic, then the rest of the
 * site (only for a phrase of three words or more, or one people wrote). One per page. `extra`: suggestions a site's
 * own finder made ({from, block path, start, end}), checked the same way.
 */
export function incomingSuggestions(map, ref, { limit = 10, skipped = new Set() } = {}) {
  const target = map.pages.get(ref);
  if (!target?.url) return [];
  const phrases = phrasesOf(map, ref);
  if (!phrases.length) return [];
  const t = target.topic ? map.topics.get(target.topic) : null;
  const g = t && target.group ? t.groups.find((x) => x.id === target.group) : null;
  const candidates = new Set(phrases.flatMap((ph) => [...pagesWith(map, ph)]));
  const out = [];
  for (const from of candidates) {
    const s = map.pages.get(from);
    if (!s || from === ref || s.to.has(ref) || s.format !== 'md') continue;
    const near = (t && from === t.pillar) || (g && (from === g.lead || g.members.includes(from))) ? 3 : t && s.topic === t.id ? 2 : 1;
    const usable = near > 1 ? phrases : phrases.filter((ph) => ph.strong || ph.words >= 3);
    const hit = findIn(s, usable, map, ref);
    if (!hit) continue;
    const reason = near === 3 ? (from === t?.pillar ? 'The main page of its topic.' : `A page in the same group, “${g.name}”.`) : near === 2 ? `A page in the same topic, “${t.title}”.` : 'This page talks about it.';
    const sg = suggestion(map, 'in', from, ref, reason, hit, phrases);
    out.push({ ...sg, score: near * 3 + hit.phrase.words + Math.log2(1 + s.in) + (s.live ? 1 : 0) + (hit.phrase.strong ? 1 : 0) });
  }
  return out
    .filter((s) => !skipped.has(s.id))
    .sort((a, b) => b.score - a.score || a.from.localeCompare(b.from))
    .slice(0, limit)
    .map(({ score: _s, ...s }) => s);
}

/**
 * Every open suggestion one click can apply, for the Link inbox: links into the live pages with fewer than
 * `enough` links in, and links up to the main page where they are missing. {items, counts: {total, in, out, topics}}.
 */
export function linkInbox(map, { skipped = new Set(), enough = map.cfg?.enough ?? 3, perPage = 5, topic = null } = {}) {
  const items = new Map();
  const counted = (p) => p.live && p.url && (map.cfg?.collections ?? []).includes(p.ref.slice(0, p.ref.indexOf('/'))) && (!topic || p.topic === topic);
  for (const p of map.pages.values()) {
    if (!counted(p)) continue;
    if (p.in < enough) for (const s of incomingSuggestions(map, p.ref, { limit: perPage, skipped })) items.set(s.id, s);
    for (const s of outgoingSuggestions(map, p.ref, { skipped })) if (s.how === 'link' && (s.reason.startsWith('The main page') || s.reason.startsWith('The lead page'))) items.set(s.id, s);
  }
  const list = [...items.values()];
  const topics = {};
  for (const s of list) {
    const tp = map.pages.get(s.to)?.topic ?? '';
    topics[tp] = (topics[tp] ?? 0) + 1;
  }
  return { items: list, counts: { total: list.length, in: list.filter((s) => s.dir === 'in').length, out: list.filter((s) => s.dir === 'out').length, topics } };
}

/** The node at `path` in a copy of the document (the copy is made by the caller). */
const nodeAt = (doc, path) => path.reduce((n, i) => (n && Array.isArray(n.content) ? n.content[i] : null), doc);

/**
 * The document with the words [start, end) of the text block at `path` linked to `href`; null when those words are
 * not `expect` any more or are linked already (the page changed since the suggestion was made).
 */
export function linkWords(doc, { path, start, end, expect, href, rel = null }) {
  const copy = structuredClone(doc);
  const block = nodeAt(copy, path);
  if (!block || !Array.isArray(block.content)) return null;
  let pos = 0;
  let text = '';
  const out = [];
  for (const ch of block.content) {
    const len = inlineLen(ch);
    const a = pos;
    const b = pos + len;
    pos = b;
    if (ch.type === 'text') text += ch.text;
    else if (ch.type === 'hardBreak') text += ' ';
    if (b <= start || a >= end || len === 0) {
      out.push(ch);
      continue;
    }
    if (ch.type !== 'text' || (ch.marks ?? []).some((m) => m.type === 'link' || m.type === 'code')) return null;
    const cut = (x, y, marks) => (y > x ? [{ ...ch, text: ch.text.slice(x - a, y - a), ...(marks.length ? { marks } : { marks: undefined }) }] : []);
    const marks = ch.marks ?? [];
    const linked = [...marks, { type: 'link', attrs: { href, target: null, rel } }];
    out.push(...cut(a, Math.max(a, start), marks), ...cut(Math.max(a, start), Math.min(b, end), linked), ...cut(Math.min(b, end), b, marks));
  }
  if (text.slice(start, end) !== expect) return null;
  block.content = out.map((n) => {
    if (n.type === 'text' && n.marks === undefined) {
      const { marks: _m, ...rest } = n;
      return rest;
    }
    return n;
  });
  return copy;
}

/** The document with the link over [start, end) of the block at `path` given a new `href` and/or `rel`; null when no link is there. */
export function setLinkAt(doc, { path, start, end, href, rel }) {
  const copy = structuredClone(doc);
  const block = nodeAt(copy, path);
  if (!block || !Array.isArray(block.content)) return null;
  let pos = 0;
  let hit = false;
  for (const ch of block.content) {
    const a = pos;
    pos += inlineLen(ch);
    if (ch.type !== 'text' || pos <= start || a >= end) continue;
    for (const m of ch.marks ?? []) {
      if (m.type !== 'link') continue;
      m.attrs = { ...m.attrs, ...(href !== undefined ? { href } : {}), ...(rel !== undefined ? { rel: rel || null } : {}) };
      hit = true;
    }
  }
  return hit ? copy : null;
}

/** Is this a plain object (a suggestion or finding from JSON)? */
export const isSuggestion = (s) => plain(s) && typeof s.id === 'string' && (s.dir === 'in' || s.dir === 'out');
