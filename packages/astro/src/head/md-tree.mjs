// A built page's tree made ready for the Markdown writer (markdown.mjs): the page's main content picked, and the HTML
// a site's components leave behind turned into shapes the writer knows. Pure: a tree in, a new tree out.
//   - details/summary become the summary in bold, then the body (a FAQ stays readable); dl/dt/dd the same
//   - an iframe becomes a link to its src
//   - an image without alt is left out (it is decoration), a lazy image reads its data-src
//   - a link to a place on the same page (#id) becomes plain text: Markdown has no ids
//   - a card that is one big link around a heading and text keeps the link on the heading
//   - custom elements (islands, web components) and spans around blocks become divs, so their text is not glued
//   - two spans side by side get a space between them (their gap is CSS)
//   - in a table cell, line breaks and list items become spaces (a table row is one line)
//   - menus, banners, search and footers by role are left out, and, with no <main>, the page's own header,
//     footer and aside (outside an article or section)
import { safeUrl, textOf } from '@markstage/core/html-tree';

const INLINE = new Set(['a', 'strong', 'b', 'em', 'i', 'code', 'span', 'small', 'sup', 'sub', 'abbr', 'cite', 'q', 'kbd', 'mark', 'time', 'u', 's', 'del', 'ins', 'bdi', 'bdo', 'data', 'dfn', 'samp', 'var', 'wbr', 'label', 'br', 'img', 'picture', 'font', 'big', 'tt', 'strike', 'nobr', 'source']);
const BLOCKY = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'figure', 'hr', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside']);
const KNOWN = new Set([...BLOCKY, 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'figcaption', 'body', 'html']);
// what the reader drops whatever it holds (html-tree DROP), left alone here
const DROPPED = new Set(['script', 'style', 'noscript', 'object', 'embed', 'template', 'svg', 'canvas', 'form', 'input', 'button', 'select', 'textarea', 'head', 'title', 'link', 'meta', 'nav', 'dialog', 'video', 'audio']);
const CHROME = new Set(['header', 'footer', 'aside']);
const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'search']);
const SECTIONING = new Set(['article', 'section', 'main']);
const HEADING = /^h[1-6]$/;

const el = (tag, children, attrs = {}) => ({ tag, attrs, children });
const els = (n) => (n.children ?? []).filter((c) => c.tag);

/** Depth-first, in document order: the first node `pred` accepts, or null. */
export function findFirst(node, pred) {
  if (node.tag && pred(node)) return node;
  for (const c of els(node)) {
    const f = findFirst(c, pred);
    if (f) return f;
  }
  return null;
}

/** A simple selector (tag, #id, .class, [attr], [attr="v"], or a tag with those) as a test on a node, or null. */
export function selectorTest(selector) {
  const m = /^([a-z][a-z0-9-]*)?((?:[#.][A-Za-z0-9_-]+|\[[A-Za-z0-9_:-]+(?:="[^"\]]*")?\])*)$/.exec(String(selector ?? '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  const tests = [];
  for (const p of m[2].matchAll(/#([\w-]+)|\.([\w-]+)|\[([\w:-]+)(?:="([^"\]]*)")?\]/g)) {
    if (p[1]) tests.push((n) => n.attrs.id === p[1]);
    else if (p[2]) tests.push((n) => (n.attrs.class ?? '').split(/\s+/).includes(p[2]));
    else tests.push((n) => (p[3].toLowerCase() in n.attrs ? p[4] === undefined || n.attrs[p[3].toLowerCase()] === p[4] : false));
  }
  return (n) => (!m[1] || n.tag === m[1]) && tests.every((t) => t(n));
}

/**
 * The page's content as a ready tree: its `main` (the selector) when it has one, else <body> without its own header,
 * footer and aside. `pageUrl` is the page's address (links to a place on it become text), `base` resolves addresses.
 */
export function contentOf(root, { main = 'main', base, pageUrl = base } = {}) {
  const test = selectorTest(main);
  const found = test ? findFirst(root, (n) => test(n) && !DROPPED.has(n.tag)) : null;
  const body = found ?? findFirst(root, (n) => n.tag === 'body') ?? root;
  const ctx = { base, pageUrl: String(pageUrl ?? '').split('#')[0], chrome: !!found, cell: false };
  return el('div', prepKids(body.children ?? [], ctx));
}

function prepKids(children, ctx) {
  const out = [];
  for (const c of children) {
    const made = prep(c, ctx);
    // two spans side by side (a row of tags, a chart's labels) are separate words: the page spaces them with CSS
    if (c.tag === 'span' && out[out.length - 1]?.tag === 'span' && made[0]?.tag === 'span') out.push({ text: ' ' });
    out.push(...made);
  }
  return out;
}

const blockyKid = (kids) => kids.some((k) => k.tag && (BLOCKY.has(k.tag) || k.wasBlock));
const space = () => ({ text: ' ' });

/** One node as a list of nodes (none: left out; several: replaced by its content). */
function prep(n, ctx) {
  if (n.text !== undefined) return [n];
  const tag = n.tag;
  const a = n.attrs ?? {};
  if (CHROME_ROLES.has((a.role ?? '').toLowerCase())) return [];
  if (!ctx.chrome && CHROME.has(tag)) return [];
  if (DROPPED.has(tag)) return [n];
  const inner = SECTIONING.has(tag) && !ctx.chrome ? { ...ctx, chrome: true } : ctx;

  if (tag === 'br') return ctx.cell ? [space()] : [n];
  if (tag === 'iframe') {
    const u = safeUrl(a.src || a['data-src'], ctx.base);
    if (!u || !/^https?:/.test(u)) return [];
    const label = (a.title ?? '').trim() || 'Embedded content';
    return [el('p', [el('a', [{ text: label }], { href: u })])];
  }
  if (tag === 'img') {
    const alt = (a.alt ?? '').trim();
    if (!alt) return [];
    let src = (a.src ?? '').trim();
    if (!src || src.startsWith('data:')) src = (a['data-src'] ?? '').trim();
    return src ? [el('img', [], { src, alt })] : [];
  }
  if (tag === 'details') {
    const summary = els(n).find((c) => c.tag === 'summary');
    const rest = prepKids((n.children ?? []).filter((c) => c !== summary), inner);
    const head = summary ? textOf(summary).trim() : '';
    const kids = head ? [el('p', [el('strong', [{ text: head }])]), ...rest] : rest;
    return [{ ...el('div', kids), wasBlock: true }];
  }
  if (tag === 'summary') return [{ ...el('p', [el('strong', prepKids(n.children ?? [], inner))]), wasBlock: true }];
  if (tag === 'dt') return [{ ...el('p', [el('strong', prepKids(n.children ?? [], inner))]), wasBlock: true }];
  if (tag === 'a') return anchor(n, inner);

  const cell = ctx.cell || tag === 'td' || tag === 'th';
  const kids = prepKids(n.children ?? [], cell === inner.cell ? inner : { ...inner, cell });
  if (INLINE.has(tag) && !blockyKid(kids)) return [{ ...n, children: kids }];
  if (KNOWN.has(tag)) {
    const k = ctx.cell && BLOCKY.has(tag) && tag !== 'table' ? [...kids, space()] : kids;
    return [{ ...n, children: k }];
  }
  // dl, dd, hgroup, address, custom elements and any other tag the writer does not know: one block when it holds
  // blocks, else plain inline (so a custom element in a sentence stays in it)
  if (blockyKid(kids) || tag === 'dd' || tag === 'dl' || tag === 'hgroup' || tag === 'address' || tag === 'fieldset') return [{ ...el('div', kids), wasBlock: true }];
  return [el('span', kids)];
}

/** A link: plain text for a place on the page itself, and the link moved onto the heading of a card made of blocks. */
function anchor(n, ctx) {
  const href = (n.attrs.href ?? '').trim();
  const kids = prepKids(n.children ?? [], ctx);
  if (!href || href.startsWith('#')) return kids;
  const full = safeUrl(href, ctx.base);
  if (full && full.includes('#') && full.split('#')[0] === ctx.pageUrl) return kids;
  if (!blockyKid(kids)) return [{ ...n, children: kids }];
  // one big link around a card: its heading (else its first paragraph, else a line named by its image) carries the link, the rest stays
  const link = (children) => el('a', children, { href });
  const target = findFirst({ children: kids }, (x) => HEADING.test(x.tag)) ?? findFirst({ children: kids }, (x) => x.tag === 'p');
  if (target) target.children = [link(target.children)];
  else kids.unshift(el('p', [link([{ text: findFirst({ children: kids }, (x) => x.tag === 'img')?.attrs.alt ?? href }])]));
  return [{ ...el('div', kids), wasBlock: true }];
}

/** Removes the first h1 when it only repeats the page's title (the document already starts with it). Returns its text. */
export function dropTitleHeading(tree, title) {
  const first = findFirst(tree, (n) => HEADING.test(n.tag));
  if (!first || first.tag !== 'h1') return '';
  const text = textOf(first).trim();
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const t = norm(title ?? '');
  if (text && (!t || norm(text) === t || t.includes(norm(text)) || norm(text).includes(t))) {
    const strip = (node) => {
      node.children = (node.children ?? []).filter((c) => c !== first);
      els(node).forEach(strip);
    };
    strip(tree);
    return text;
  }
  return '';
}
