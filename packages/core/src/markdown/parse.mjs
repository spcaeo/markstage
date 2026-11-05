// Markdown -> the editor document (ProseMirror JSON). Each converted block keeps its source range, which the
// surgical save uses to write unchanged blocks back byte for byte: { node, start, end, kids?, inner?, closeStart? }.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { parseTag } from '../html.mjs';
import { linkFromTag, normalizeInline } from '../inline.mjs';
import { FIGURE_CLOSE, FIGURE_OPEN, unescapeCaption } from './figure.mjs';
import { mdxBlockAt, mdxInlineAt } from './mdx-parse.mjs';

export const parser = unified().use(remarkParse).use(remarkGfm);

/** The frontmatter block (`---` lines, `\n` or Windows `\r\n` line ends) and the body after it. */
export function splitFrontmatter(text) {
  const nl = text.startsWith('---\n') ? '\n' : text.startsWith('---\r\n') ? '\r\n' : null;
  if (!nl) return { frontmatter: '', body: text };
  const close = `${nl}---${nl}`;
  const end = text.indexOf(close, 3);
  if (end < 0) return { frontmatter: '', body: text };
  return { frontmatter: text.slice(0, end + close.length), body: text.slice(end + close.length) };
}

const span = (n) => [n.position.start.offset, n.position.end.offset];
const source = (n, body) => (n.position ? body.slice(...span(n)) : (n.value ?? ''));
const rawEntry = (body, start, end) => ({ node: { type: 'rawHtml', attrs: { html: body.slice(start, end) } }, start, end });

const MD_MARK = { strong: 'bold', emphasis: 'italic', delete: 'strike' };
const HTML_MARK = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', del: 'strike', s: 'strike' };

/** A link whose text is its own address. GFM reads a bare URL in text as such a link; it stays text in the
 *  document (and prints back as written), and a real link of that shape is printed as an <a> tag. */
export const looksAutolink = (href, text) => href === text || href === `mailto:${text}` || href === `http://${text}` || href === `https://${text}`;

/** The mark an inline html tag opens, or null. */
function htmlMark(tag) {
  if (!tag || tag.close || tag.self) return null;
  if (tag.name === 'a') return linkFromTag(tag);
  return HTML_MARK[tag.name] && !tag.attrs.length ? { type: HTML_MARK[tag.name] } : null;
}

/** The Markdown reader for one set of block packs (see blocks.mjs); `mdx`: read MDX (mdx-parse.mjs). */
export function makeParser(reg, { mdx = null } = {}) {
  const reader = mdx ? mdx.parser : parser;
  // how deep inside a list or a quotation the reader is (MDX code there is kept whole when it spans lines)
  const inMd = { depth: 0 };
  function parseEntries(body) {
    const tree = reader.parse(body);
    return blockEntries(tree.children, body);
  }

  function blockEntries(children, body, parent = null) {
    const out = [];
    let i = 0;
    while (i < children.length) {
      const r = blockAt(children, i, body, parent);
      out.push(r.entry);
      i = r.next;
    }
    return out;
  }

  // The block starting at children[i] -> { entry, next } (a box or an HTML region can take several mdast nodes).
  // parent: the wrap block it sits in (null at the top and inside Markdown containers).
  function blockAt(children, i, body, parent) {
    const n = children[i];
    const [start, end] = span(n);
    if (mdx) {
      const entry = mdxBlockAt(n, body, { blockEntries, inMd });
      if (entry) return { entry, next: i + 1 };
    }
    if (n.type === 'html') {
      const fig = figureAt(children, i, body);
      if (fig) return fig;
      const one = reg.parseLine(n.value);
      if (one) return { entry: { node: one, start, end }, next: i + 1 };
      const open = reg.parseOpen(n.value, parent);
      if (open) {
        const box = boxAt(children, i, body, open);
        if (box) return box;
      }
      return htmlRegion(children, i, body);
    }
    return { entry: { node: blockNode(n, body), start, end, ...blockKids(n, body) }, next: i + 1 };
  }

  // An image with a caption, a width or the decorative mark (print.mjs figureMd):
  //   <figure class="wide">⏎⏎![alt](src)⏎⏎<figcaption>Caption</figcaption>⏎</figure>
  // -> one image node with attrs.figure (the class attribute, '' for none) and attrs.caption (plain text, or null).
  // Kept only in exactly that layout (so it prints back byte for byte); anything else stays raw HTML.
  function figureAt(children, i, body) {
    const open = FIGURE_OPEN.exec(children[i].value);
    const p = children[i + 1];
    const close = children[i + 2];
    if (!open || p?.type !== 'paragraph' || p.children.length !== 1 || p.children[0].type !== 'image' || close?.type !== 'html') return null;
    const end = FIGURE_CLOSE.exec(close.value);
    if (!end) return null;
    const caption = end[1] === undefined ? null : unescapeCaption(end[1]);
    if (caption === undefined || caption === '') return null;
    const start = span(children[i])[0];
    const stop = span(close)[1];
    // exactly the printed layout: one blank line on each side of the image
    if (body.slice(start, stop) !== `${children[i].value}\n\n${body.slice(...span(p))}\n\n${close.value}`) return null;
    const im = p.children[0];
    const node = { type: 'image', attrs: { src: im.url, alt: im.alt ?? null, title: im.title ?? null, figure: open[1] ?? '', caption } };
    return { entry: { node, start, end: stop }, next: i + 3 };
  }

  // A wrap block: its opening html node, Markdown blocks, and the closing html node at the same level.
  function boxAt(children, i, body, open) {
    let j = i + 1;
    // a fixed first paragraph (a title, an icon) that the printer writes itself
    if (open.title) {
      const t = children[j];
      if (!t || t.type !== 'paragraph' || body.slice(...span(t)) !== open.title) return null;
      j++;
    }
    const kids = [];
    while (j < children.length) {
      const c = children[j];
      if (c.type === 'html' && c.value === open.close) {
        if (open.children && kids.map((k) => k.node.type).join() !== open.children.join()) return null;
        const node = { type: open.type, ...(open.attrs ? { attrs: open.attrs } : {}) };
        const content = kids.map((k) => k.node);
        if (content.length) node.content = content;
        return {
          entry: {
            node,
            start: span(children[i])[0],
            end: span(c)[1],
            kids,
            inner: kids.length ? [kids[0].start, kids[kids.length - 1].end] : null,
            closeStart: span(c)[0],
          },
          next: j + 1,
        };
      }
      const r = blockAt(children, j, body, open.type);
      kids.push(r.entry);
      j = r.next;
    }
    return null;
  }

  // HTML the converter does not model: from an opening tag to its matching close (counting nested tags of the same
  // name across the following nodes), kept as one rawHtml block with its exact source.
  function htmlRegion(children, i, body) {
    const n = children[i];
    const first = /^<([A-Za-z][A-Za-z0-9-]*)[\s>]/.exec(n.value);
    const depthOf = (v, name) =>
      (v.match(new RegExp(`<${name}[\\s>]`, 'gi')) ?? []).length - (v.match(new RegExp(`</${name}\\s*>`, 'gi')) ?? []).length;
    if (first) {
      const name = first[1];
      let depth = depthOf(n.value, name);
      let j = i;
      while (depth > 0 && j + 1 < children.length) {
        j++;
        if (children[j].type === 'html') depth += depthOf(children[j].value, name);
      }
      if (depth <= 0) return { entry: rawEntry(body, span(n)[0], span(children[j])[1]), next: j + 1 };
    }
    return { entry: rawEntry(body, ...span(n)), next: i + 1 };
  }

  function blockKids(n, body) {
    if (n.type === 'list') return { kids: n.children.map((item) => ({ node: listItemNode(item, body), start: span(item)[0], end: span(item)[1] })) };
    return {};
  }

  const isLoose = (list) => !!list.spread || list.children.some((c) => c.spread);

  function listItemNode(item, body) {
    inMd.depth++;
    const content = blockEntries(item.children, body).map((e) => e.node);
    inMd.depth--;
    return { type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] };
  }

  function blockNode(n, body) {
    switch (n.type) {
      case 'paragraph': {
        if (n.children.length === 1 && n.children[0].type === 'image') {
          const im = n.children[0];
          return { type: 'image', attrs: { src: im.url, alt: im.alt ?? null, title: im.title ?? null } };
        }
        return withInline({ type: 'paragraph' }, inlineNodes(n.children, body));
      }
      case 'heading':
        return withInline({ type: 'heading', attrs: { level: n.depth } }, inlineNodes(n.children, body));
      case 'thematicBreak':
        return { type: 'horizontalRule' };
      case 'code': {
        const language = n.lang ? (n.meta ? `${n.lang} ${n.meta}` : n.lang) : null;
        return withInline({ type: 'codeBlock', attrs: { language } }, n.value ? [{ type: 'text', text: n.value }] : []);
      }
      case 'blockquote': {
        inMd.depth++;
        const content = blockEntries(n.children, body).map((e) => e.node);
        inMd.depth--;
        return { type: 'blockquote', content };
      }
      case 'list': {
        if (n.children.some((c) => c.checked != null)) break;
        const attrs = n.ordered ? { start: n.start ?? 1, tight: !isLoose(n) } : { tight: !isLoose(n) };
        return { type: n.ordered ? 'orderedList' : 'bulletList', attrs, content: n.children.map((c) => listItemNode(c, body)) };
      }
      case 'table':
        return {
          type: 'table',
          attrs: { align: (n.align ?? []).map((a) => a ?? null) },
          content: n.children.map((row, r) => ({
            type: 'tableRow',
            content: row.children.map((cell) => ({
              type: r === 0 ? 'tableHeader' : 'tableCell',
              content: [withInline({ type: 'paragraph' }, inlineNodes(cell.children, body))],
            })),
          })),
        };
      default:
    }
    return { type: 'rawHtml', attrs: { html: body.slice(...span(n)) } };
  }

  const withInline = (node, inline) => (inline.length ? { ...node, content: inline } : node);

  // mdast phrasing content -> inline nodes. Inline HTML tags we model (<strong>, <em>, <a href target rel>, <br>) are
  // paired at their level and become marks; anything else is a rawInline atom with its exact source.
  function inlineNodes(children, body, marks = []) {
    const out = [];
    const tags = children.map((c) => (c.type === 'html' ? parseTag(c.value) : null));
    const pair = new Map();
    const stack = [];
    tags.forEach((t, k) => {
      if (!t || t.self) return;
      if (!t.close && htmlMark(t)) stack.push([t.name, k]);
      else if (t.close && stack.length && stack[stack.length - 1][0] === t.name) pair.set(stack.pop()[1], k);
    });
    const own = [];
    const closers = new Map();
    const add = (mark, list) => (list.some((m) => m.type === mark.type) ? list : [...list, mark]);
    children.forEach((c, k) => {
      if (closers.has(k)) {
        own.splice(own.indexOf(closers.get(k)), 1);
        return;
      }
      const cur = [...marks, ...own];
      switch (c.type) {
        case 'text':
          out.push({ type: 'text', text: c.value, marks: cur });
          return;
        case 'inlineCode':
          out.push({ type: 'text', text: c.value, marks: add({ type: 'code' }, cur) });
          return;
        case 'break':
          out.push({ type: 'hardBreak' });
          return;
        case 'strong':
        case 'emphasis':
        case 'delete':
          out.push(...inlineNodes(c.children, body, add({ type: MD_MARK[c.type] }, cur)));
          return;
        case 'link': {
          if (c.children.length === 1 && c.children[0].type === 'text' && looksAutolink(c.url, c.children[0].value)) {
            out.push({ type: 'text', text: c.children[0].value, marks: cur });
            return;
          }
          if (c.title != null || cur.some((m) => m.type === 'link')) break;
          const attrs = { href: c.url, target: null, rel: null };
          if (wrapsWhole(c.children)) attrs.outer = true;
          out.push(...inlineNodes(c.children, body, [...cur, { type: 'link', attrs }]));
          return;
        }
        case 'mdxJsxTextElement':
        case 'mdxTextExpression': {
          const r = mdxInlineAt(c, body, cur, add);
          if (r.marks) out.push(...inlineNodes(c.children, body, r.marks));
          else if (r.node) out.push(r.node);
          return;
        }
        case 'html': {
          const t = tags[k];
          if (t && t.name === 'br' && !t.close && !t.attrs.length) {
            out.push({ type: 'hardBreak' });
            return;
          }
          const mark = pair.has(k) ? htmlMark(t) : null;
          if (mark && !cur.some((m) => m.type === mark.type) && !touchesSame(mark, out, children[pair.get(k) + 1])) {
            if (mark.type === 'link' && wrapsWhole(children.slice(k + 1, pair.get(k)), tags.slice(k + 1, pair.get(k)))) mark.attrs.outer = true;
            own.push(mark);
            closers.set(pair.get(k), mark);
            return;
          }
          break;
        }
        default:
      }
      out.push({ type: 'rawInline', attrs: { html: source(c, body) } });
    });
    return normalizeInline(out);
  }

  // <em>x</em> right next to text that is already italic (***a***<em>:</em>) would merge into one italic run in the
  // document and print as one element: such a tag pair stays raw HTML so the page keeps its two elements.
  function touchesSame(mark, out, after) {
    if (mark.type === 'link') return false;
    const prev = out[out.length - 1];
    if (prev?.type === 'text' && prev.marks.some((m) => m.type === mark.type)) return true;
    return !!after && MD_MARK[after.type] === mark.type;
  }

  // True when a link's content is one mark wrapping all of it (**x** inside [..](..), or <strong>x</strong> inside
  // <a>): the link is then printed outside that mark.
  function wrapsWhole(kids, tags) {
    if (kids.length === 1 && MD_MARK[kids[0].type]) return true;
    if (!tags || kids.length < 2) return false;
    const a = tags[0];
    const z = tags[tags.length - 1];
    return !!(a && z && htmlMark(a) && z.close && z.name === a.name);
  }

  return { parseEntries, inlineNodes };
}
