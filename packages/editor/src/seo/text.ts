// What the SEO check reads from the text as it is being written (unsaved changes too): the headings, the focus
// keyphrase, the links (vague link words too), the images and the words. A problem an AI fix can help with names it
// (`fix`: ai/fixes.ts). Pure functions of the canvas document and a few fields; the panel
// (seo/index.ts) draws them. The publish sheet's rules (server publish-rules.mjs) judge the saved text the same way.
import type { Node as PMNode } from '@tiptap/pm/model';
import { targetOf } from '../link-preview';

/** error: stops a publish or breaks something; warn: worth a look; ok: done right */
export type Level = 'error' | 'warn' | 'ok';

export interface Finding {
  level: Level;
  text: string;
  /** the top-level block to go to */
  block?: number;
  /** the AI fix for it (router.ts FIX): title, description, heading-<block>, link-<block>-<n>, alt-<n> */
  fix?: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface Heading {
  level: number;
  text: string;
  /** null: the title, the page's H1 */
  block: number | null;
}

/** The page's headings in order (the title first when the page shows it as its H1), and what is wrong with them:
 *  a second H1, a level skipped (H2 then H4), an empty heading, no H1 (only when `title.h1` is known: seo/h1.ts). */
export function headings(doc: PMNode, title: { text: string; h1: boolean | null }): { list: Heading[]; findings: Finding[] } {
  const list: Heading[] = title.h1 ? [{ level: 1, text: squash(title.text), block: null }] : [];
  doc.forEach((n, _, i) => {
    if (n.type.name === 'heading') list.push({ level: Number(n.attrs.level) || 1, text: squash(n.textContent), block: i });
  });
  const findings: Finding[] = [];
  let last = 0;
  let h1 = 0;
  for (const h of list) {
    const name = h.text ? `“${cut(h.text)}”` : 'An empty heading';
    const fix = h.block === null ? undefined : `heading-${h.block}`;
    if (!h.text && h.block !== null) findings.push({ level: 'warn', text: 'An empty heading: write it or remove it.', block: h.block, fix });
    if (h.level === 1 && ++h1 > 1) findings.push({ level: 'warn', text: `${name} is a second main heading (H1). A page has one: make it an H2.`, block: h.block ?? undefined, fix });
    if (last && h.level > last + 1) findings.push({ level: 'warn', text: `${name} is an H${h.level} right after an H${last}: an H${last + 1} is skipped.`, block: h.block ?? undefined, fix });
    last = h.level;
  }
  if (!h1 && title.h1 === false) findings.push({ level: 'warn', text: 'The page has no main heading (H1).' });
  return { list, findings };
}

/** Text as the keyphrase check compares it: lower case, words only, single spaces. */
export const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const has = (hay: string, kp: string) => !!kp && ` ${words(hay)} `.includes(` ${kp} `);
/** Every word of the keyphrase is there, in any order (not as one phrase). */
const scattered = (hay: string, kp: string) => {
  const all = new Set(words(hay).split(' '));
  return !!kp && kp.split(' ').every((w) => all.has(w));
};
const countOf = (hay: string, kp: string) => (kp ? ` ${words(hay)} `.split(` ${kp} `).length - 1 : 0);

export interface KeyphraseInput {
  phrase: string;
  searchTitle: string;
  title: string;
  description: string;
  /** the page's address (its slug's words count) */
  url: string;
  doc: PMNode;
}

/** The focus keyphrase checks (Yoast / Rank Math parity): where it appears, and how often. */
export function keyphrase(k: KeyphraseInput): Finding[] {
  const kp = words(k.phrase);
  if (!kp) return [];
  const out: Finding[] = [];
  // the phrase as written passes; its words apart say so (search engines match them less surely)
  const at = (hay: string | null, yes: string, no: string, block?: number) => {
    if (hay !== null && has(hay, kp)) out.push({ level: 'ok', text: yes });
    else if (hay !== null && kp.includes(' ') && scattered(hay, kp)) out.push({ level: 'warn', text: `${no.replace(/^Not in/, 'Its words are in').replace(/[.:].*$/, '')}, not as one phrase.`, block });
    else out.push({ level: 'warn', text: no, block });
  };
  at(k.searchTitle, 'In the search title.', 'Not in the search title (Post settings, Search engines).');
  if (k.title !== k.searchTitle) at(k.title, 'In the title (the H1).', 'Not in the title (the H1).');
  let first = -1;
  k.doc.forEach((n, _, i) => {
    if (first < 0 && n.type.name === 'paragraph' && n.textContent.trim()) first = i;
  });
  at(first >= 0 ? k.doc.child(first).textContent : null, 'In the first paragraph.', 'Not in the first paragraph: say early what the page is about.', first >= 0 ? first : undefined);
  at(k.url.replace(/[-_/]+/g, ' '), 'In the page address.', 'Not in the page address (the URL slug).');
  at(k.description, 'In the meta description.', 'Not in the meta description.');
  const subs: string[] = [];
  k.doc.forEach((n) => void (n.type.name === 'heading' && n.attrs.level >= 2 && subs.push(n.textContent)));
  const sub = subs.find((x) => has(x, kp)) ?? subs.find((x) => scattered(x, kp)) ?? '';
  at(subs.length ? sub : null, 'In a subheading.', 'Not in any subheading (H2, H3).');
  const text = k.doc.textBetween(0, k.doc.content.size, ' ', ' ');
  const total = wordCount(text);
  const times = countOf(text, kp);
  const density = total ? (times * kp.split(' ').length * 100) / total : 0;
  const pct = `${density.toFixed(1)}%`;
  // a phrase of several words: its words may be there, apart
  if (!times && kp.includes(' ') && scattered(text, kp)) out.push({ level: 'warn', text: 'The full phrase isn’t in the text; its words are. Use it as one phrase where it reads naturally.' });
  else if (!times) out.push({ level: 'warn', text: 'Not in the text at all.' });
  else if (density > 3) out.push({ level: 'warn', text: `${times} times in ${total} words (${pct}): too often, it reads as stuffed. Use other words for it.` });
  else if (Number(density.toFixed(1)) < 0.5) out.push({ level: 'warn', text: `${times} time${times === 1 ? '' : 's'} in ${total} words (${pct}): use it a few more times where it reads naturally.` });
  else out.push({ level: 'ok', text: `${times} time${times === 1 ? '' : 's'} in ${total} words (${pct}).` });
  return out;
}

export const wordCount = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export interface LinkFound {
  href: string;
  text: string;
  rel: string;
  target: string;
  block: number;
  kind: 'site' | 'away' | 'other';
  /** the site page's path (kind 'site') */
  path?: string;
  /** where its words are in the document */
  from: number;
  to: number;
  /** which link of its block it is (from 1) */
  n: number;
}

/** Every link of the text, one per run of linked words (a link split by bold counts once). */
export function linksOf(doc: PMNode): LinkFound[] {
  const out: LinkFound[] = [];
  doc.forEach((block, offset, i) => {
    let prev: LinkFound | null = null;
    let k = 0;
    block.descendants((n, pos) => {
      if (!n.isText) {
        if (n.isBlock) prev = null;
        return true;
      }
      const m = n.marks.find((x) => x.type.name === 'link');
      if (!m) {
        prev = null;
        return false;
      }
      const href = String(m.attrs.href ?? '');
      const from = offset + 1 + pos;
      if (prev && prev.href === href) {
        prev.text += n.text ?? '';
        prev.to = from + n.nodeSize;
        return false;
      }
      const t = targetOf(href);
      prev = { href, text: n.text ?? '', rel: String(m.attrs.rel ?? ''), target: String(m.attrs.target ?? ''), block: i, kind: t.kind, path: t.kind === 'site' ? t.path : undefined, from, to: from + n.nodeSize, n: ++k };
      out.push(prev);
      return false;
    });
  });
  return out;
}

/** What the link check says: pages that do not exist or are drafts, insecure addresses, empty links. `page(path)`
 *  is the site's page there (null: none; undefined: the list of pages is not known). */
export function linkFindings(links: LinkFound[], page: (path: string) => { draft: boolean } | null | undefined): Finding[] {
  const out: Finding[] = [];
  for (const l of links) {
    const words = `“${cut(squash(l.text), 40)}”`;
    if (!l.href.trim()) out.push({ level: 'error', text: `${words} links to nothing.`, block: l.block });
    else if (l.kind === 'site' && l.path) {
      const p = page(l.path);
      if (p === null) out.push({ level: 'error', text: `${words} links to ${l.path}, where the site has no page.`, block: l.block });
      else if (p?.draft) out.push({ level: 'error', text: `${words} links to ${l.path}, a draft: the link leads nowhere until it is published.`, block: l.block });
    } else if (l.kind === 'away' && /^http:/i.test(l.href)) out.push({ level: 'warn', text: `${words} uses http://, not https://.`, block: l.block });
    if (l.href.trim() && vagueLink(l.text)) out.push({ level: 'warn', text: `${words} does not say where the link goes: link words that name the page.`, block: l.block, fix: `link-${l.block}-${l.n}` });
  }
  if (!links.some((l) => l.kind === 'site')) out.push({ level: 'warn', text: 'No links to other pages of the site: link two or three related ones.' });
  return out;
}

/** Link words that do not say where a link goes: the same list as core's link map (link-map.mjs GENERIC_ANCHORS). */
export const VAGUE_LINK_WORDS = new Set(['click here', 'click', 'here', 'read more', 'read', 'learn more', 'more', 'more info', 'more information', 'find out more', 'continue reading', 'see more', 'view more', 'details', 'this', 'this page', 'link', 'this link', 'go', 'download', 'website', 'page', 'article', 'post', 'source', 'sources', 'view', 'open', 'here.', 'see here', 'this article', 'this post', '(no text)']);

/** Link words as the link map compares them (core's normAnchor), and whether they are vague. */
export function vagueLink(text: string): boolean {
  const a = text
    .replace(/[“”"‘’']/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/^[\s»→>\-–—]+|[\s»→>.!…:,;]+$/g, '');
  return !a || VAGUE_LINK_WORDS.has(a) || /^(page )?\d+$/.test(a);
}

export interface ImageFound {
  src: string;
  alt: string;
  decorative: boolean;
  block: number;
  /** which image of the text it is (from 1, in order) */
  n: number;
}

export function imagesOf(doc: PMNode, decorativeClass: string): ImageFound[] {
  const out: ImageFound[] = [];
  doc.forEach((block, _, i) => {
    const visit = (n: PMNode) => {
      if (n.type.name === 'image') {
        const decorative = String(n.attrs.figure ?? '').split(/\s+/).includes(decorativeClass);
        out.push({ src: String(n.attrs.src ?? ''), alt: String(n.attrs.alt ?? '').trim(), decorative, block: i, n: out.length + 1 });
      }
    };
    visit(block);
    block.descendants((n) => void visit(n));
  });
  return out;
}

/** Generic words a file name can be made of without saying what the image shows. */
const GENERIC = new Set(['img', 'image', 'images', 'dsc', 'dscn', 'pic', 'picture', 'photo', 'screenshot', 'screen', 'shot', 'untitled', 'banner', 'web', 'copy', 'final', 'scaled', 'edited', 'new', 'file', 'download', 'large', 'small', 'thumb', 'cover', 'hero', 'whatsapp', 'pxl', 'at', 'am', 'pm']);

/** True when the file name says nothing about the image (IMG_2041.jpg, banner-web-226.jpg, a hash). */
export function vagueName(src: string): boolean {
  const base = decodeURIComponent(src.split(/[?#]/)[0]!.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
  if (/^[0-9a-f]{12,}$/i.test(base.replace(/-/g, ''))) return true;
  const parts = base.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1);
  return !parts.some((w) => !GENERIC.has(w));
}

export function imageFindings(images: ImageFound[]): Finding[] {
  const out: Finding[] = [];
  for (const im of images) {
    const name = im.src.split('/').pop() || 'An image';
    if (!im.alt && !im.decorative) out.push({ level: 'error', text: `${name} has no description (alt text): add one, or mark the image decorative.`, block: im.block, fix: `alt-${im.n}` });
    if (vagueName(im.src)) out.push({ level: 'warn', text: `${name}: the file name says nothing about the image. A name like crm-pipeline-board.webp helps image search.`, block: im.block });
  }
  return out;
}
