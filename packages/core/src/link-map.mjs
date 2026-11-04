// The link map (docs/API-LINKS.md): the links in each page's text (its body, never the menu, footer or cards), what
// they point to, and what that says about the site: pages nobody links to, links that skip the topic's main page,
// words used for two pages, vague words, links to redirects and hidden pages, outside links that pass credit.
// Pure functions over plain data, shared by the server (its Links screens and checks) and the tests.
//   entryText(entry)       the text blocks and body links of one entry (Markdown document or JSON data)
//   buildLinkMap(input)    every page with its links in and out, the anchors and the outside links
//   linkFindings(map)      what to fix, each with its one-click fix or the sentence to open
// Suggestions (both ways) live in link-suggest.mjs.
import { topicMap } from './topics.mjs';

/** Link words that do not say where a link goes. */
export const GENERIC_ANCHORS = new Set(['click here', 'click', 'here', 'read more', 'read', 'learn more', 'more', 'more info', 'more information', 'find out more', 'continue reading', 'see more', 'view more', 'details', 'this', 'this page', 'link', 'this link', 'go', 'download', 'website', 'page', 'article', 'post', 'source', 'sources', 'view', 'open', 'here.', 'see here', 'this article', 'this post', '(no text)']);

/** Link words as compared: lowercase, one space, no arrows or end punctuation. */
export const normAnchor = (t) =>
  String(t ?? '')
    .replace(/[“”"‘’']/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/^[\s»→>\-–—]+|[\s»→>.!…:,;]+$/g, '');

export const isGeneric = (anchor, extra = []) => {
  const a = normAnchor(anchor);
  return !a || GENERIC_ANCHORS.has(a) || extra.includes(a) || /^(page )?\d+$/.test(a);
};

/** A site path as links compare it: no query, hash or trailing slash. */
export const pathKey = (p) => {
  const s = String(p ?? '').replace(/[#?].*$/, '');
  return s.length > 1 ? s.replace(/\/+$/, '') : s || '/';
};

/** What an address is: {kind: 'internal', path} | {kind: 'external', url, domain} | {kind: 'other'}. */
export function hrefKind(href, siteUrl = '') {
  let h = String(href ?? '').trim();
  const site = String(siteUrl ?? '').replace(/\/+$/, '');
  if (site && (h === site || h.startsWith(`${site}/`) || h.startsWith(`${site}?`) || h.startsWith(`${site}#`))) h = h.slice(site.length) || '/';
  if (h.startsWith('/') && !h.startsWith('//')) return { kind: 'internal', path: h };
  if (/^(https?:)?\/\//i.test(h)) {
    try {
      const u = new URL(h.startsWith('//') ? `https:${h}` : h);
      return { kind: 'external', url: u.href, domain: u.hostname.toLowerCase().replace(/^www\./, '') };
    } catch {
      return { kind: 'other' };
    }
  }
  return { kind: 'other' };
}

const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const INLINE = new Set(['text', 'hardBreak', 'image', 'rawInline']);
const HREF_A = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const attrOf = (attrs, name) => new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1`, 'i').exec(attrs)?.[2] ?? null;
const stripTags = (h) =>
  String(h)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');

/** The length a node has in its block's text (as textBlocks counts it). */
export const inlineLen = (n) => (n.type === 'text' ? String(n.text ?? '').length : n.type === 'hardBreak' ? 1 : 0);
const isTextBlock = (n) => Array.isArray(n.content) && n.content.length > 0 && n.content.every((c) => plain(c) && INLINE.has(c.type));
const linkMark = (n) => (Array.isArray(n.marks) ? n.marks.find((m) => m?.type === 'link') : null);
const sameLink = (a, b) => !!a && !!b && a.attrs?.href === b.attrs?.href && (a.attrs?.rel ?? null) === (b.attrs?.rel ?? null);

/** The sentence of `text` that holds [start, end), at most 300 characters. */
export function sentenceAt(text, start, end = start) {
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
  const s = text.slice(from, to).trim();
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}

/**
 * The text blocks of a Markdown document: [{path, kind, text, section, links: [{start, end, href, rel}]}]. `path`:
 * the indexes from the document down to the block; `section`: the heading above it. Raw HTML blocks give their
 * links too (kind 'html', no offsets that a fix could use).
 */
export function textBlocks(doc) {
  const out = [];
  let section = '';
  const visit = (n, path, parent) => {
    if (!plain(n)) return;
    if (n.type === 'rawHtml' || (n.type !== 'doc' && typeof n.attrs?.html === 'string' && !Array.isArray(n.content))) {
      const html = String(n.attrs?.html ?? '');
      const links = [...html.matchAll(HREF_A)].map((m) => ({ start: null, end: null, href: attrOf(m[1], 'href') ?? '', rel: attrOf(m[1], 'rel'), anchor: stripTags(m[2]) })).filter((l) => l.href);
      if (links.length) out.push({ path, kind: 'html', text: stripTags(html), section, links, html: true });
      return;
    }
    if (isTextBlock(n)) {
      let text = '';
      const links = [];
      let open = null;
      for (const c of n.content) {
        const m = c.type === 'text' ? linkMark(c) : null;
        if (open && !(m && sameLink(m, open.mark))) {
          links.push({ start: open.start, end: text.length, href: open.mark.attrs?.href ?? '', rel: open.mark.attrs?.rel ?? null });
          open = null;
        }
        if (m && !open) open = { mark: m, start: text.length };
        if (c.type === 'text') text += String(c.text ?? '');
        else if (c.type === 'hardBreak') text += ' ';
        else if (c.type === 'rawInline') for (const a of String(c.attrs?.html ?? '').matchAll(/<a\b([^>]*)>/gi)) links.push({ start: text.length, end: text.length, href: attrOf(a[1], 'href') ?? '', rel: attrOf(a[1], 'rel'), html: true });
      }
      if (open) links.push({ start: open.start, end: text.length, href: open.mark.attrs?.href ?? '', rel: open.mark.attrs?.rel ?? null });
      const kind = n.type === 'heading' ? 'heading' : parent === 'tableCell' || parent === 'tableHeader' ? 'cell' : 'paragraph';
      if (kind === 'heading') section = text.trim();
      out.push({ path, kind, text, section: kind === 'heading' ? '' : section, links: links.filter((l) => l.href) });
      return;
    }
    (Array.isArray(n.content) ? n.content : []).forEach((c, i) => visit(c, [...path, i], n.type));
  };
  visit(doc, [], null);
  return out;
}

/**
 * The links in a JSON page's text: HTML inside its string values (never a button's or card's href/url field). Each
 * keeps the sentence around its words, and as its section the heading (or title) of the part of the page it is in.
 */
function jsonLinks(data) {
  const out = [];
  const cut = (t) => (t.length > 300 ? `${t.slice(0, 297)}…` : t);
  const walk = (v, key, at, section) => {
    if (typeof v === 'string') {
      if (/^(href|url|link|to|src|image|canonical)$/i.test(key ?? '') || !/<a\b/i.test(v)) return;
      const text = stripTags(v);
      for (const m of v.matchAll(HREF_A)) {
        const href = attrOf(m[1], 'href');
        if (!href) continue;
        const anchor = stripTags(m[2]);
        // where the words are in the text: after the text before the link (a tag there reads as one space)
        const before = stripTags(v.slice(0, m.index));
        let pos = before ? before.length + 1 : 0;
        if (anchor && text.slice(pos, pos + anchor.length) !== anchor) pos = text.indexOf(anchor);
        const sentence = anchor && pos >= 0 ? sentenceAt(text, pos, pos + anchor.length) : cut(text);
        out.push({ href, rel: attrOf(m[1], 'rel'), anchor, sentence, section, path: at, block: null, start: null, end: null });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, key, `${at}[${i}]`, section));
    else if (plain(v)) {
      // a part of the page (not the page itself) with a heading of its own
      const named = at ? (typeof v.heading === 'string' && v.heading.trim() ? v.heading : typeof v.title === 'string' && v.title.trim() ? v.title : null) : null;
      const here = named ? stripTags(named) : section;
      if (v.type === 'doc' && Array.isArray(v.content)) {
        for (const b of textBlocks(v)) for (const l of b.links) out.push({ ...blockLink(b, l, null), section: b.section || here });
        return;
      }
      for (const [k, x] of Object.entries(v)) walk(x, k, at ? `${at}.${k}` : k, here);
    }
  };
  walk(data, null, '', '');
  return out;
}

function blockLink(b, l, top) {
  const anchor = l.anchor ?? (l.start === null ? '' : b.text.slice(l.start, l.end));
  return { href: l.href, rel: l.rel ?? null, anchor: anchor.trim(), sentence: l.start === null || l.html ? (b.text.length > 300 ? `${b.text.slice(0, 297)}…` : b.text) : sentenceAt(b.text, l.start, l.end), section: b.section, path: b.path, block: top, start: b.html || l.html ? null : l.start, end: b.html || l.html ? null : l.end };
}

/**
 * The body text of one entry: {links: [{href, rel, anchor, sentence, section, path, block, start, end}], blocks}.
 * `entry`: {format: 'md' | 'json', doc?, data?}. Blocks (for suggestions and fixes) come from Markdown only.
 */
export function entryText(entry) {
  if (entry.format === 'md' && plain(entry.doc)) {
    const blocks = textBlocks(entry.doc);
    return { blocks, links: blocks.flatMap((b) => b.links.map((l) => blockLink(b, l, b.path[0] ?? null))) };
  }
  return { blocks: [], links: jsonLinks(entry.data ?? {}) };
}

/** Is a robots value one that keeps the page out of search (noindex or none)? */
export const isNoindex = (robots, flag) =>
  flag === true || (Array.isArray(robots) ? robots : typeof robots === 'string' ? robots.split(',') : []).some((r) => /^(noindex|none)$/i.test(String(r).trim()));

/**
 * Every page and its links. `pages`: [{ref, title, url, paths?, live, noindex, type, keywords, format, links, blocks}]
 * (ref "<collection>/<id>"; `paths`: every address it has, one per locale); `topics`: normalized topics;
 * `redirects`: [{from, to}] site paths; `cfg`: the topics config. Only links on live pages count as links in.
 */
export function buildLinkMap({ pages, topics = [], redirects = [], cfg = {}, siteUrl = '' }) {
  const byPath = new Map();
  const rows = new Map();
  const places = topicMap(topics);
  const money = moneyRefs(pages, topics, cfg);
  for (const p of pages) {
    for (const u of p.paths ?? (p.url ? [p.url] : [])) byPath.set(pathKey(u), p.ref);
    const place = places.get(p.ref) ?? null;
    rows.set(p.ref, { ...p, topic: place?.topic ?? null, group: place?.group ?? null, role: place?.role ?? null, money: money.has(p.ref), in: 0, out: 0, from: new Set(), to: new Set(), external: 0 });
  }
  const hops = new Map(redirects.map((r) => [pathKey(r.from), r.to]));
  /** A site path to {status, ref, final}: ok, redirect (to a page or not), missing, noindex. */
  const resolve = (path) => {
    let p = pathKey(path);
    let moved = false;
    for (let i = 0; i < 10 && !byPath.has(p) && hops.has(p); i++) {
      const to = hrefKind(hops.get(p), siteUrl);
      if (to.kind !== 'internal') return { status: 'redirect', ref: null, final: hops.get(p) };
      p = pathKey(to.path);
      moved = true;
    }
    const ref = byPath.get(p) ?? null;
    if (moved) return { status: 'redirect', ref, final: ref ? (rows.get(ref).url ?? p) : p };
    if (!ref) return { status: 'missing', ref: null, final: null };
    return { status: rows.get(ref).noindex ? 'noindex' : 'ok', ref, final: null };
  };
  const edges = [];
  const external = [];
  const anchors = new Map();
  for (const p of rows.values()) {
    for (const l of p.links ?? []) {
      const k = hrefKind(l.href, siteUrl);
      if (k.kind === 'external') {
        external.push({ from: p.ref, ...l, url: k.url, domain: k.domain, rels: relWords(l.rel) });
        p.external++;
        continue;
      }
      if (k.kind !== 'internal' || pathKey(k.path) === pathKey(p.url ?? '\0')) continue;
      const r = resolve(k.path);
      if (r.ref === p.ref) continue;
      const e = { ...l, from: p.ref, to: r.ref, status: r.status, final: r.final, address: k.path, norm: normAnchor(l.anchor) };
      edges.push(e);
      p.out++;
      if (r.ref) p.to.add(r.ref);
      if (r.ref && p.live) {
        const t = rows.get(r.ref);
        if (!t.from.has(p.ref)) t.in++;
        t.from.add(p.ref);
      }
      if (r.ref && e.norm && !isGeneric(e.norm, cfg.generic)) {
        if (!anchors.has(e.norm)) anchors.set(e.norm, new Map());
        const by = anchors.get(e.norm);
        by.set(r.ref, (by.get(r.ref) ?? 0) + 1);
      }
    }
  }
  return { pages: rows, byPath, edges, external, anchors, topics: new Map(topics.map((t) => [t.id, t])), places, cfg, siteUrl };
}

const relWords = (rel) =>
  String(rel ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/** The site's money pages: each topic's own, and the pages of the configured types or under the configured paths. */
function moneyRefs(pages, topics, cfg) {
  const out = new Set(topics.map((t) => t.money).filter(Boolean));
  for (const p of pages) {
    if (p.type && cfg.money?.pageTypes?.includes(p.type)) out.add(p.ref);
    if (p.url && cfg.money?.paths?.some((m) => pathKey(p.url).startsWith(pathKey(m)))) out.add(p.ref);
  }
  return out;
}

/** The money page for a page: its topic's own, else one of the money pages in its topic, else null. */
export function moneyFor(map, ref) {
  const row = map.pages.get(ref);
  const t = row?.topic ? map.topics.get(row.topic) : null;
  if (t?.money && map.pages.has(t.money)) return t.money;
  for (const r of map.pages.values()) if (r.money && r.topic && r.topic === row?.topic && r.ref !== ref) return r.ref;
  return null;
}

/** A short stable id (FNV-1a, 52 bits, base 36): suggestions and findings keep theirs while the page does not change. */
export function hashId(prefix, ...parts) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const ch of parts.join('\u0001')) {
    const c = ch.codePointAt(0);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${prefix}_${(h1 * 2 ** 20 + (h2 & 0xfffff)).toString(36)}`;
}

const titleOf = (map, ref) => map.pages.get(ref)?.title || ref;
const domainIn = (domain, list) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

/**
 * What to fix: [{id, kind, level: 'high' | 'medium' | 'low', ref, topic, target?, href?, anchor?, sentence?, section?,
 * path?, start?, end?, message, fix: {kind, …} | null}]. Fix kinds: 'suggest-in' (pages that should link here),
 * 'suggest-out' (with `to`), 'retarget' (`href` to put in), 'rel' (`rel` to set), 'drop-page' (out of a topic), 'place'
 * (put it in a topic). Without a fix the editor opens the page at the sentence.
 */
export function linkFindings(map) {
  const out = [];
  const cfg = map.cfg ?? {};
  const add = (f) => out.push({ id: hashId('lf', f.kind, f.ref, f.target ?? '', f.href ?? '', [].concat(f.path ?? []).join('.'), f.start ?? '', f.anchor ?? ''), topic: map.pages.get(f.ref)?.topic ?? null, fix: null, ...f });
  const counted = (p) => p.live && (cfg.collections ?? []).includes(p.ref.slice(0, p.ref.indexOf('/'))) && pathKey(p.url ?? '') !== '/';
  for (const p of map.pages.values()) {
    if (!counted(p) || !p.url) continue;
    // a page search engines are told not to show (a thank-you page) needs no links in
    const linksIn = p.noindex ? null : p.in;
    if (linksIn === 0) add({ kind: 'no-links-in', level: 'high', ref: p.ref, message: 'No other page links to this one in its text, so readers and search engines rarely find it.', fix: { kind: 'suggest-in' } });
    else if (linksIn === 1) add({ kind: 'weak', level: 'medium', ref: p.ref, message: 'Only one page links to this one in its text.', fix: { kind: 'suggest-in' } });
    const t = p.topic ? map.topics.get(p.topic) : null;
    if (t && p.role !== 'pillar' && t.pillar && map.pages.has(t.pillar) && !p.to.has(t.pillar)) add({ kind: 'no-pillar-link', level: 'high', ref: p.ref, target: t.pillar, message: `Does not link to its topic’s main page, “${titleOf(map, t.pillar)}”.`, fix: { kind: 'suggest-out', to: t.pillar } });
    const g = t && p.group ? t.groups.find((x) => x.id === p.group) : null;
    if (g?.lead && p.role === 'member' && map.pages.has(g.lead) && !p.to.has(g.lead)) add({ kind: 'no-lead-link', level: 'low', ref: p.ref, target: g.lead, message: `Does not link to the lead page of “${g.name}”, “${titleOf(map, g.lead)}”.`, fix: { kind: 'suggest-out', to: g.lead } });
    if (!t) add({ kind: 'not-in-topic', level: 'low', ref: p.ref, message: 'Not in a topic yet, so no page is suggested to link to it.', fix: { kind: 'place' } });
  }
  // words used for two or more pages: every link with them, so each can be reworded where it is
  for (const [norm, by] of map.anchors) {
    if (by.size < 2) continue;
    const names = [...by.keys()].map((r) => `“${titleOf(map, r)}”`).join(' and ');
    for (const e of map.edges) {
      if (e.norm !== norm || !e.to || !by.has(e.to) || !map.pages.get(e.from)?.live) continue;
      add({ kind: 'anchor-clash', level: 'medium', ref: e.from, target: e.to, anchor: e.anchor, sentence: e.sentence, section: e.section, path: e.path, start: e.start, end: e.end, href: e.href, message: `The words “${e.anchor}” link to ${by.size} pages: ${names}. Use words that name this page only.` });
    }
  }
  for (const e of map.edges) {
    if (!map.pages.get(e.from)?.live) continue;
    const at = { ref: e.from, target: e.to, anchor: e.anchor, sentence: e.sentence, section: e.section, path: e.path, start: e.start, end: e.end, href: e.href };
    const fixable = e.start !== null && e.start !== undefined && Array.isArray(e.path);
    if (isGeneric(e.anchor, cfg.generic)) add({ kind: 'generic-anchor', level: 'medium', ...at, message: `“${e.anchor || '(no words)'}” does not say where the link goes. Link words that name the page${e.to ? `, such as “${titleOf(map, e.to)}”` : ''}.` });
    if (e.status === 'redirect') add({ kind: 'to-redirect', level: 'medium', ...at, message: `Links to ${e.address}, which redirects${e.final ? ` to ${e.final}` : ''}. Link straight to the page.`, fix: fixable && e.final && e.final.startsWith('/') ? { kind: 'retarget', href: keepHash(e.href, e.final) } : null });
    else if (e.status === 'noindex') add({ kind: 'to-noindex', level: 'medium', ...at, message: `Links to “${titleOf(map, e.to)}”, which search engines are told not to show. Link to a page they show instead.` });
    else if (e.status === 'missing') add({ kind: 'to-missing', level: 'high', ...at, message: `Links to ${e.address}, which is not a page of the site.` });
  }
  for (const x of map.external) {
    if (!map.pages.get(x.from)?.live) continue;
    const at = { ref: x.from, href: x.href, anchor: x.anchor, sentence: x.sentence, section: x.section, path: x.path, start: x.start, end: x.end };
    const fixable = x.start !== null && x.start !== undefined && Array.isArray(x.path);
    const passes = !x.rels.some((r) => r === 'nofollow' || r === 'sponsored' || r === 'ugc');
    if (domainIn(x.domain, cfg.sponsored ?? [])) {
      if (!x.rels.includes('sponsored')) add({ kind: 'outside-sponsored', level: 'high', ...at, message: `A link to ${x.domain}, a paid or partner site, should say so (rel="sponsored").`, fix: fixable ? { kind: 'rel', rel: relWith(x.rel, 'sponsored') } : null });
    } else if (passes && !domainIn(x.domain, cfg.follow ?? [])) add({ kind: 'outside-follow', level: 'low', ...at, message: `A link to ${x.domain} passes credit to it. Only the sites on the allowlist should (${(cfg.follow ?? []).join(', ') || 'none yet'}).`, fix: fixable ? { kind: 'rel', rel: relWith(x.rel, 'nofollow') } : null });
  }
  for (const t of map.topics.values()) {
    for (const r of [t.pillar, t.money, ...t.members, ...t.groups.flatMap((g) => [g.lead, ...g.members])]) {
      if (r && !map.pages.has(r)) out.push({ id: hashId('lf', 'missing-page', t.id, r), kind: 'missing-page', level: 'medium', ref: r, topic: t.id, message: `The topic “${t.title}” names ${r}, which is not a page any more.`, fix: { kind: 'drop-page', topic: t.id } });
    }
  }
  // a service-page address that also covers the pages under it (articles at /service/x/): each would count as a
  // service page, and a topic's "service page" could be one of its articles; one note per address
  for (const m of cfg.money?.paths ?? []) {
    const base = pathKey(m);
    const under = [...map.pages.values()].filter((p) => p.url && pathKey(p.url) !== base && pathKey(p.url).startsWith(base === '/' ? '/' : `${base}/`));
    if (!under.length) continue;
    const own = [...map.pages.values()].find((p) => p.url && pathKey(p.url) === base);
    const names = under.slice(0, 2).map((p) => `“${titleOf(map, p.ref)}”`).join(' and ');
    out.push({ id: hashId('lf', 'money-path-wide', m), kind: 'money-path-wide', level: 'low', ref: (own ?? under[0]).ref, topic: (own ?? under[0]).topic ?? null, href: m, message: `The service-page address ${m} (site config topics.money) also covers ${under.length === 1 ? 'the page' : `${under.length} pages`} under it, such as ${names}, so they count as service pages too. List the exact address of each service page, or name it as the topic’s service page.`, fix: null });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref));
}

const keepHash = (href, to) => {
  const m = /#.*$/.exec(String(href ?? ''));
  return m ? `${to}${m[0]}` : to;
};
const relWith = (rel, word) => [...new Set([...relWords(rel), word])].join(' ');

/** Plain words for each finding kind (the Health screen's filters). */
export const FINDING_KINDS = {
  'no-links-in': 'No links in',
  weak: 'Only one link in',
  'no-pillar-link': 'No link up to the main page',
  'no-lead-link': 'No link up to the group lead',
  'anchor-clash': 'Same words, two pages',
  'generic-anchor': 'Vague link words',
  'to-redirect': 'Links to a redirect',
  'to-noindex': 'Links to a hidden page',
  'to-missing': 'Links to no page',
  'outside-follow': 'Outside link passes credit',
  'outside-sponsored': 'Paid link not marked',
  'not-in-topic': 'Not in a topic',
  'missing-page': 'Topic names a gone page',
  'money-path-wide': 'Service address covers other pages',
};
