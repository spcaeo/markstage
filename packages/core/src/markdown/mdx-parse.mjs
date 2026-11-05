// The MDX parts of the reader (parse.mjs, when the converter reads MDX): mdast's MDX nodes -> the editor's nodes
// (mdx.mjs says which). Every node keeps its exact source, so an unchanged one is written back byte for byte.
import { propsOf, propsPlaceable } from './mdx.mjs';

const span = (n) => [n.position.start.offset, n.position.end.offset];
const CODE = new Set(['mdxjsEsm', 'mdxFlowExpression', 'mdxJsxFlowElement', 'mdxJsxTextElement', 'mdxTextExpression']);

/** True when `n` holds MDX code whose text spans lines (a list or quotation then cannot be written again safely). */
function spansLines(n, body) {
  if (CODE.has(n.type) && body.slice(...span(n)).includes('\n')) return true;
  return (n.children ?? []).some((c) => spansLines(c, body));
}

/**
 * The entry for an MDX block at `n`, or null when `n` is plain Markdown. ctx: the reader's `blockEntries` (for a
 * container's children) and `inMd.depth` (> 0 inside a list or a quotation).
 */
export function mdxBlockAt(n, body, { blockEntries, inMd }) {
  const [start, end] = span(n);
  const source = body.slice(start, end);
  const code = (kind) => ({ node: { type: 'mdxCode', attrs: { kind, source } }, start, end });
  if (n.type === 'mdxjsEsm') return code('esm');
  if (n.type === 'mdxFlowExpression') return code('expression');
  // a list or quotation with code over several lines: its markers sit inside the code's text, so it stays whole
  if ((n.type === 'list' || n.type === 'blockquote') && spansLines(n, body)) return code('block');
  if (n.type !== 'mdxJsxFlowElement') return null;
  const props = propsOf(n);
  const name = n.name ?? null;
  const kids = n.children ?? [];
  if (kids.length && inMd.depth === 0) {
    const open = body.slice(start, span(kids[0])[0]);
    const close = body.slice(span(kids[kids.length - 1])[1], end);
    // the children are edited as prose when the tags sit on lines of their own
    if (/\n[ \t]*$/.test(open) && /^[ \t]*\r?\n/.test(close)) {
      const entries = blockEntries(kids, body, null);
      const node = { type: 'mdxContainer', attrs: { name, props, open, close, fixed: !propsPlaceable(open + close, props) }, content: entries.map((e) => e.node) };
      return { node, start, end, kids: entries, inner: [entries[0].start, entries[entries.length - 1].end], closeStart: entries[entries.length - 1].end };
    }
  }
  return { node: { type: 'mdxComponent', attrs: { name, props, source, fixed: !propsPlaceable(source, props) } }, start, end };
}

const MARK = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', del: 'strike', s: 'strike' };
const LINK_ORDERS = { href: null, 'href,target': null, 'href,rel': null, 'href,target,rel': null, 'href,rel,target': 'rel-first' };

/** A JSX `<a>` with only literal href / target / rel: a link mark (printed back as the same tag), else null. */
function linkOf(el) {
  const attrs = el.attributes ?? [];
  if (!attrs.every((a) => a.type === 'mdxJsxAttribute' && typeof a.value === 'string')) return null;
  const keys = attrs.map((a) => a.name).join(',');
  if (!(keys in LINK_ORDERS)) return null;
  const get = (k) => attrs.find((a) => a.name === k)?.value ?? null;
  const out = { href: get('href'), target: get('target'), rel: get('rel') };
  if (LINK_ORDERS[keys]) out.order = LINK_ORDERS[keys];
  return { type: 'link', attrs: out };
}

/**
 * JSX or an expression inside a line: `<br />` is a line break; `<strong>`, `<em>`, `<del>` (no attributes) and a
 * plain `<a>` are marks over their children ({marks}); anything else is an atom with its exact source ({node}).
 */
export function mdxInlineAt(c, body, cur, add) {
  const source = body.slice(...span(c));
  const atom = { node: { type: 'mdxInline', attrs: { name: c.type === 'mdxJsxTextElement' ? (c.name ?? null) : null, source } } };
  if (c.type !== 'mdxJsxTextElement') return atom;
  const plain = !(c.attributes ?? []).length;
  if (c.name === 'br' && plain && !c.children.length) return { node: { type: 'hardBreak' } };
  if (MARK[c.name] && plain && c.children.length && !cur.some((m) => m.type === MARK[c.name])) return { marks: add({ type: MARK[c.name] }, cur) };
  if (c.name === 'a' && c.children.length && !cur.some((m) => m.type === 'link')) {
    const link = linkOf(c);
    if (link) return { marks: [...cur, link] };
  }
  return atom;
}
