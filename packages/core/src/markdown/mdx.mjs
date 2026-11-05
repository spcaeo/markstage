// MDX (docs/MDX.md): the reader with the MDX extensions, and the code parts of an MDX file as editor nodes.
//
//   mdxCode       {kind: 'esm'|'expression'|'block', source}   an import/export, a {expression} on its own, or a
//                 Markdown block holding code that spans lines (kept whole): read-only, saved as written
//   mdxComponent  {name, props, source, fixed}                   a JSX block whose children are not edited here
//   mdxContainer  {name, props, open, close, fixed} + content    a JSX block whose Markdown children are edited as
//                 prose; `open` and `close` are the exact text around the children
//   mdxInline     {name, source}                                 JSX or an {expression} inside a line
//
// props: [{name, kind, value}] in the order written; kind 'string' | 'number' | 'boolean' are literals the writer may
// change (value decoded), 'expression' | 'spread' are code (value is its source) and stay as written. `fixed`: the
// props could not be placed in the source again (code in a list or a quotation): all of them read-only.
// A changed literal rewrites that attribute's value only, in its own quote style; every other byte stays.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';

export const mdxParser = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);

/** The MDX node types the converter makes (block packs may not use these names). */
export const MDX_TYPES = ['mdxCode', 'mdxComponent', 'mdxContainer', 'mdxInline'];

/** A file the MDX reader cannot read, or cannot write back as it was: `line`/`column` where, when known. */
export class MdxError extends Error {
  constructor(message, { line = null, column = null } = {}) {
    super(message);
    this.name = 'MdxError';
    this.mdx = { message, line, column };
  }
}

/** The reader's error, in plain words with its place. */
export function mdxErrorOf(e, lineOffset = 0) {
  let reason = String(e?.reason ?? e?.message ?? e).replace(/\s+/g, ' ').trim();
  // some errors carry their place only in the words: "… (2:1-2:21)"
  const at = /\s*\((\d+):(\d+)(?:-\d+:\d+)?\)$/.exec(reason);
  if (at) reason = reason.slice(0, at.index);
  const l = Number.isInteger(e?.line) ? e.line : at ? Number(at[1]) : null;
  const line = l === null ? null : l + lineOffset;
  const column = Number.isInteger(e?.column) ? e.column : at ? Number(at[2]) : null;
  return new MdxError(`${line ? `Line ${line}: ` : ''}${reason}`, { line, column });
}

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export const LITERAL_KINDS = new Set(['string', 'number', 'boolean']);

/** One mdast JSX attribute -> {name, kind, value}. */
function propOf(a) {
  if (a.type === 'mdxJsxExpressionAttribute') return { name: null, kind: 'spread', value: a.value };
  if (a.value === null || a.value === undefined) return { name: a.name, kind: 'boolean', value: true };
  if (typeof a.value === 'string') return { name: a.name, kind: 'string', value: a.value };
  const v = String(a.value.value ?? '').trim();
  if (NUMBER.test(v)) return { name: a.name, kind: 'number', value: Number(v) };
  if (v === 'true' || v === 'false') return { name: a.name, kind: 'boolean', value: v === 'true' };
  return { name: a.name, kind: 'expression', value: String(a.value.value ?? '') };
}

export const propsOf = (el) => (el.attributes ?? []).map(propOf);

// Where each attribute's value sits in an element's own text: [{prop, start, end, raw, flag}] (offsets in `source`).
const placed = new Map();
function placeProps(source) {
  if (placed.has(source)) return placed.get(source);
  let out = null;
  try {
    const tree = mdxParser.parse(source);
    let el = tree.children[0];
    if (el?.type === 'paragraph' && el.children.length === 1) el = el.children[0];
    if (tree.children.length === 1 && el && /^mdxJsx(Flow|Text)Element$/.test(el.type) && el.position.start.offset === 0) {
      out = (el.attributes ?? []).map((a) => {
        const prop = propOf(a);
        const s = a.position.start.offset;
        const e = a.position.end.offset;
        if (a.type !== 'mdxJsxAttribute' || a.value === null || a.value === undefined) return { prop, start: e, end: e, raw: '', flag: true };
        const eq = source.indexOf('=', s + a.name.length);
        let vs = eq + 1;
        while (/\s/.test(source[vs])) vs++;
        return { prop, start: vs, end: e, raw: source.slice(vs, e), flag: false };
      });
    }
  } catch {
    out = null;
  }
  if (placed.size > 500) placed.clear();
  placed.set(source, out);
  return out;
}

/** True when the props of `source` can be found again in it (so literal edits can be written back). */
export const propsPlaceable = (source, props) => {
  const at = placeProps(source);
  return !!at && at.length === props.length && at.every((p, i) => p.prop.name === props[i].name && p.prop.kind === props[i].kind);
};

const sameValue = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));

/** A JSX string value in quote `q`: the quote and anything that reads as a character reference become references. */
function jsxString(value, q) {
  const s = String(value)
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;')
    .replace(q === '"' ? /"/g : /'/g, q === '"' ? '&quot;' : '&#39;');
  return q + s + q;
}

/** A literal's new text, in the style of the one it replaces (`raw`: the old value text, '' for a bare flag). */
function literalText(prop, at) {
  const { raw } = at;
  if (prop.kind === 'string') {
    const q = raw[0] === "'" ? "'" : '"';
    return jsxString(prop.value ?? '', q);
  }
  const lit = prop.kind === 'number' ? String(Number.isFinite(Number(prop.value)) ? Number(prop.value) : 0) : String(prop.value === true);
  if (at.flag) return `={${lit}}`;
  // keep the spaces inside the braces: {3} -> {4}, { 3 } -> { 4 }
  const m = /^\{(\s*)[\s\S]*?(\s*)\}$/.exec(raw);
  return m ? `{${m[1]}${lit}${m[2]}}` : `{${lit}}`;
}

/**
 * `source` (one element's text, or the text around a container's children) with the literal props that differ from
 * it written in. Props whose name or kind no longer match their place are left as written; so is everything else.
 */
export function applyProps(source, props) {
  if (!Array.isArray(props) || !props.length) return source;
  const at = placeProps(source);
  if (!at || at.length !== props.length) return source;
  let out = '';
  let from = 0;
  at.forEach((a, i) => {
    const p = props[i];
    if (!p || p.name !== a.prop.name || p.kind !== a.prop.kind || !LITERAL_KINDS.has(p.kind) || sameValue(p.value, a.prop.value)) return;
    // a bare flag set to true again stays bare
    if (a.flag && p.kind === 'boolean' && p.value === true) return;
    out += source.slice(from, a.start) + literalText(p, a);
    from = a.end;
  });
  return out + source.slice(from);
}

/** A container's opening text with its props applied (its children are left out and put back). */
export function containerHead(attrs) {
  const open = attrs?.open ?? '';
  const close = attrs?.close ?? '';
  if (attrs?.fixed) return open;
  const whole = applyProps(open + close, attrs?.props);
  return whole.slice(0, whole.length - close.length);
}

/** What a component node prints: its source with the changed literal props written in. */
export const componentText = (attrs) => (attrs?.fixed ? (attrs?.source ?? '') : applyProps(attrs?.source ?? '', attrs?.props));

/**
 * The code of an MDX node with its literal values left out: what the "may add code" rule compares (a writer who
 * changes a literal prop changes no code). Null for a node that is not MDX code.
 */
export function mdxCodeOf(node) {
  const a = node?.attrs ?? {};
  switch (node?.type) {
    case 'mdxCode':
    case 'mdxInline':
      return String(a.source ?? '');
    case 'mdxComponent':
    case 'mdxContainer': {
      const props = (a.props ?? []).map((p) => (LITERAL_KINDS.has(p.kind) ? `${p.name}=${p.kind}` : p.kind === 'spread' ? `{${p.value}}` : `${p.name}={${p.value}}`));
      return `<${a.name ?? ''} ${props.join(' ')}>`;
    }
    default:
      return null;
  }
}

/** The names of the components an import line brings in (for "uses N components"). */
export function importedNames(source) {
  const names = [];
  for (const m of String(source).matchAll(/^\s*import\s+([^'"]*?)\s+from\s+['"]/gm)) {
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^\*\s*/, '').trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

/** Text that MDX would read as code or a tag: `{`, `<`, and import/export at the start of a paragraph. */
export function escMdxLineStart(line) {
  const m = /^(import|export)(?=\s|$)/.exec(line);
  return m ? `&#${m[1].charCodeAt(0)};${line.slice(1)}` : line;
}
