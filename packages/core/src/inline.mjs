// Inline content of the editor document (ProseMirror JSON: text with marks, hardBreak, rawInline atoms) and its
// HTML form, used inside HTML blocks (a block pack's one-line boxes) and for inline HTML tags in Markdown.
import { attrOf, decodeHtml, escAttr, escHtml, parseTag } from './html.mjs';

export const MARK_RANK = { link: 0, bold: 1, italic: 2, strike: 3, code: 4 };

export const sameMark = (a, b) => a.type === b.type && JSON.stringify(a.attrs ?? null) === JSON.stringify(b.attrs ?? null);

const sameMarks = (a = [], b = []) => a.length === b.length && a.every((m) => b.some((n) => sameMark(m, n)));

/** Merge neighbouring text nodes with the same marks, drop empty text, sort marks: the form ProseMirror keeps. */
export function normalizeInline(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      if (!n.text) continue;
      const marks = (n.marks ?? []).slice().sort((a, b) => MARK_RANK[a.type] - MARK_RANK[b.type]);
      const prev = out[out.length - 1];
      if (prev && prev.type === 'text' && sameMarks(prev.marks, marks)) {
        prev.text += n.text;
        continue;
      }
      out.push(marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text });
    } else out.push(n);
  }
  return out;
}

const HTML_MARK = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', code: 'code', del: 'strike', s: 'strike' };
const TAG_OF = { bold: 'strong', italic: 'em', code: 'code', strike: 'del' };

/** A link mark from an <a> tag: only href/target/rel are modelled; anything else stays raw HTML. */
export function linkFromTag(tag) {
  if (!tag.attrs.length || tag.attrs.some(([k]) => !['href', 'target', 'rel'].includes(k))) return null;
  const href = attrOf(tag, 'href');
  if (href === null) return null;
  const keys = tag.attrs.map(([k]) => k).join(',');
  const attrs = { href: decodeHtml(href), target: attrOf(tag, 'target'), rel: attrOf(tag, 'rel') };
  if (keys === 'href,rel,target') attrs.order = 'rel-first';
  else if (!['href', 'href,target', 'href,rel', 'href,target,rel'].includes(keys)) return null;
  return { type: 'link', attrs };
}

/** `<a href="…" target="…" rel="…">` for a link mark's attrs; `extra` goes right after `<a` (e.g. a class). */
export function linkOpenTag(attrs, extra = '') {
  const t = attrs.target != null ? ` target="${escAttr(attrs.target)}"` : '';
  const r = attrs.rel != null ? ` rel="${escAttr(attrs.rel)}"` : '';
  return `<a${extra} href="${escAttr(attrs.href)}"${attrs.order === 'rel-first' ? r + t : t + r}>`;
}

/** Inline HTML (the text of a one-line box) -> inline nodes. Unknown tags become rawInline atoms. */
export function htmlToInline(html) {
  const tokens = html.match(/<[^>]*>|[^<]+|</g) ?? [];
  // Pair open/close tags first so an unbalanced tag never turns into a mark.
  const pair = new Map();
  const stack = [];
  tokens.forEach((tok, i) => {
    const tag = tok[0] === '<' ? parseTag(tok) : null;
    if (!tag || tag.self) return;
    const kind = tag.name === 'a' ? 'a' : HTML_MARK[tag.name];
    if (!kind) return;
    if (!tag.close) stack.push([tag.name, i]);
    else if (stack.length && stack[stack.length - 1][0] === tag.name) pair.set(stack.pop()[1], i);
  });
  const out = [];
  const marks = [];
  const closers = new Map();
  tokens.forEach((tok, i) => {
    if (closers.has(i)) {
      const m = closers.get(i);
      marks.splice(marks.lastIndexOf(m), 1);
      return;
    }
    if (tok[0] !== '<' || tok === '<') {
      out.push({ type: 'text', text: decodeHtml(tok), marks: marks.slice() });
      return;
    }
    const tag = parseTag(tok);
    if (tag && tag.name === 'br' && !tag.close && !tag.attrs.length) {
      out.push({ type: 'hardBreak' });
      return;
    }
    if (tag && !tag.close && pair.has(i)) {
      const mark = tag.name === 'a' ? linkFromTag(tag) : tag.attrs.length ? null : { type: HTML_MARK[tag.name] };
      if (mark && !marks.some((m) => m.type === mark.type)) {
        marks.push(mark);
        closers.set(pair.get(i), mark);
        return;
      }
    }
    out.push({ type: 'rawInline', attrs: { html: tok } });
  });
  return normalizeInline(out);
}

/** Inline nodes -> HTML, the inverse of htmlToInline. Marks that span further open first (outermost). */
export function inlineToHtml(nodes) {
  let s = '';
  const open = [];
  const closeTag = (m) => (m.type === 'link' ? '</a>' : `</${TAG_OF[m.type]}>`);
  const openTag = (m) => (m.type === 'link' ? linkOpenTag(m.attrs) : `<${TAG_OF[m.type]}>`);
  nodes.forEach((node, i) => {
    const marks = node.type === 'text' ? (node.marks ?? []) : [];
    let keep = 0;
    while (keep < open.length && marks.some((m) => sameMark(m, open[keep]))) keep++;
    while (open.length > keep) s += closeTag(open.pop());
    const fresh = marks.filter((m) => !open.some((o) => sameMark(o, m)));
    fresh.sort((a, b) => markOrder(a, b, nodes, i));
    for (const m of fresh) {
      s += openTag(m);
      open.push(m);
    }
    if (node.type === 'text') s += escHtml(node.text);
    else if (node.type === 'hardBreak') s += '<br>';
    else if (node.type === 'rawInline') s += node.attrs.html;
  });
  while (open.length) s += closeTag(open.pop());
  return s;
}

/** How far a mark runs from node i (in nodes). */
export function markExtent(m, nodes, i) {
  let j = i;
  while (j < nodes.length && nodes[j].type === 'text' && (nodes[j].marks ?? []).some((n) => sameMark(n, m))) j++;
  return j;
}

/** Longer runs open first. Ties: a link with outer=true opens first, otherwise the link goes inside (the common
 *  form **[text](url)**). */
export function markOrder(a, b, nodes, i) {
  const d = markExtent(b, nodes, i) - markExtent(a, nodes, i);
  if (d) return d;
  const rank = (m) => (m.type === 'link' ? (m.attrs.outer ? -1 : 9) : MARK_RANK[m.type]);
  return rank(a) - rank(b);
}

/** A paragraph node holding `inline` (no content key when empty, as ProseMirror writes it). */
export const paragraph = (inline) => ({ type: 'paragraph', ...(inline.length ? { content: inline } : {}) });
