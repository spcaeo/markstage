// The editor document -> Markdown (the printer). Block pack nodes print through their pack; everything else is
// CommonMark + GFM, written so that reading it back gives the same document.
import { linkOpenTag, markOrder, normalizeInline, sameMark } from '../inline.mjs';
import { looksAutolink, parser } from './parse.mjs';
import { keepListsApart } from './lists.mjs';
import { isFigure, printFigure } from './figure.mjs';

const MD_DELIM = { bold: '**', italic: '*', strike: '~~' };
const HTML_TAG = { bold: 'strong', italic: 'em', strike: 'del' };

// Escape text so Markdown reads it back as the same text. ctx.lineStart: the text begins a line.
function escText(text, ctx) {
  let s = '';
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    const next = text[k + 1] ?? '';
    if (ch === '\\' || ch === '*' || ch === '`' || ch === '[' || ch === ']' || ch === '~') s += '\\' + ch;
    else if (ch === '_') s += /[A-Za-z0-9]/.test(text[k - 1] ?? '') && /[A-Za-z0-9]/.test(next) ? '_' : '\\_';
    else if (ch === '<') s += /[A-Za-z/!?]/.test(next) || next === '' ? '\\<' : '<';
    else if (ch === '&') s += /^&(#[xX]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/.test(text.slice(k)) ? '\\&' : '&';
    else if (ch === '|' && ctx.table) s += '\\|';
    else s += ch;
  }
  if (ctx.table) return s;
  // Constructs that only count at the start of a line.
  return s
    .split('\n')
    .map((line, idx) => {
      if (idx === 0 && !ctx.lineStart) return line;
      let m;
      if ((m = /^(#{1,6})(?=\s|$)/.exec(line))) return '\\' + line;
      if (/^>/.test(line)) return '\\' + line;
      if (/^[-+](?=\s|$)/.test(line)) return '\\' + line;
      if ((m = /^(\d{1,9})([.)])(?=\s|$)/.exec(line))) return m[1] + '\\' + line.slice(m[1].length);
      if (/^=+\s*$/.test(line) || /^-+\s*$/.test(line)) return '\\' + line;
      return line;
    })
    .join('\n');
}

function codeSpan(text, table) {
  const runs = text.match(/`+/g) ?? [];
  let n = 1;
  while (runs.some((r) => r.length === n)) n++;
  const fence = '`'.repeat(n);
  const pad = /^`|`$/.test(text) || (/^ .* $/s.test(text) && /[^ ]/.test(text)) ? ' ' : '';
  const body = table ? text.replace(/\|/g, '\\|') : text;
  return fence + pad + body + pad + fence;
}

function linkDest(href) {
  if (href === '' || /[\s<>]/.test(href) || !parensBalanced(href)) return `<${href.replace(/([<>\\])/g, '\\$1')}>`;
  return href.replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\');
}

function parensBalanced(s) {
  let d = 0;
  for (const ch of s) {
    if (ch === '(') d++;
    else if (ch === ')' && --d < 0) return false;
  }
  return d === 0;
}

// The visible text a link mark covers, from node i on.
function linkText(nodes, i, mark) {
  let s = '';
  for (let j = i; j < nodes.length && nodes[j].type === 'text' && nodes[j].marks?.some((m) => sameMark(m, mark)); j++) s += nodes[j].text;
  return s;
}

const imageMd = (a) => {
  const alt = (a.alt ?? '').replace(/([\\[\]])/g, '\\$1');
  const title = a.title != null ? ` "${a.title.replace(/(["\\])/g, '\\$1')}"` : '';
  return `![${alt}](${linkDest(a.src ?? '')}${title})`;
};

const indent = (text, pad) =>
  text
    .split('\n')
    .map((l, k) => (k === 0 || l === '' ? l : pad + l))
    .join('\n');

const inlineOf = (node) => node.content ?? [];

const stripHints = (nodes) =>
  nodes.map((n) => (n.marks ? { ...n, marks: n.marks.map((m) => (m.type === 'link' ? { ...m, attrs: { ...m.attrs, outer: undefined } } : m)) } : n));

/** The Markdown printer for one set of block packs; `inlineNodes` is the reader's (for the read-back check). */
export function makePrinter(reg, inlineNodes) {
  // Inline nodes -> Markdown. opts.html: write bold/italic/strike as HTML tags (used when Markdown delimiters would
  // not read back the same, e.g. **x** glued to punctuation). opts.table: a table cell. opts.heading: no newlines.
  function printInline(nodes, opts = {}) {
    let s = '';
    const open = [];
    const htmlLink = new Set();
    const lineStart = () => s === '' || s.endsWith('\n');
    const close = (m) => {
      if (m.type === 'link') s += htmlLink.has(m) ? '</a>' : `](${linkDest(m.attrs.href)})`;
      else s += opts.html ? `</${HTML_TAG[m.type]}>` : MD_DELIM[m.type];
    };
    nodes.forEach((node, i) => {
      const marks = node.type === 'text' ? (node.marks ?? []).filter((m) => m.type !== 'code') : [];
      let keep = 0;
      while (keep < open.length && marks.some((m) => sameMark(m, open[keep]))) keep++;
      while (open.length > keep) close(open.pop());
      const fresh = marks.filter((m) => !open.some((o) => sameMark(o, m)));
      fresh.sort((a, b) => markOrder(a, b, nodes, i));
      for (const m of fresh) {
        if (m.type === 'link') {
          const a = m.attrs ?? {};
          if (a.target != null || a.rel != null || looksAutolink(a.href, linkText(nodes, i, m))) {
            htmlLink.add(m);
            s += linkOpenTag(a);
          } else {
            if (/(^|[^\\])!$/.test(s)) s = s.slice(0, -1) + '\\!';
            s += '[';
          }
        } else s += opts.html ? `<${HTML_TAG[m.type]}>` : MD_DELIM[m.type];
        open.push(m);
      }
      if (node.type === 'text') {
        if (node.marks?.some((m) => m.type === 'code')) s += codeSpan(node.text, opts.table);
        else s += escText(opts.table || opts.heading ? node.text.replace(/\n/g, ' ') : node.text, { lineStart: lineStart(), table: opts.table });
      } else if (node.type === 'hardBreak') s += opts.table || opts.heading ? '<br>' : '\\\n';
      else if (node.type === 'rawInline') s += node.attrs?.html ?? '';
      else if (node.type === 'image') s += imageMd(node.attrs ?? {});
    });
    while (open.length) close(open.pop());
    return s;
  }

  // Print inline content, then read it back: if Markdown delimiters change the meaning, use HTML tags instead.
  function printInlineChecked(nodes, opts = {}) {
    const md = printInline(nodes, opts);
    if (!/[*~]/.test(md.replace(/\\[*~]/g, '')) || sameInline(reparseInline(md, opts), nodes)) return md;
    const html = printInline(nodes, { ...opts, html: true });
    return sameInline(reparseInline(html, opts), nodes) ? html : md;
  }

  function reparseInline(md, opts) {
    const text = opts.table ? `| ${md} |\n| --- |` : md;
    const tree = parser.parse(text);
    const first = tree.children[0];
    if (!first) return [];
    const kids = opts.table ? (first.children?.[0]?.children?.[0]?.children ?? []) : (first.children ?? []);
    if (!opts.table && first.type !== 'paragraph') return null;
    return inlineNodes(kids, text);
  }

  const sameInline = (a, b) => !!a && JSON.stringify(stripHints(a)) === JSON.stringify(stripHints(normalizeInline(b)));

  // One block -> its Markdown (no trailing newline). ctx.prev: the previous sibling (two lists in a row need
  // different markers or Markdown would merge them).
  function printBlock(node, ctx = {}) {
    const a = node.attrs ?? {};
    if (reg.isLine(node.type)) return reg.printLine(node);
    if (reg.isWrap(node.type)) {
      const inner = printBlocks(node.content ?? []);
      return reg.printOpen(node) + '\n\n' + (inner ? inner + '\n\n' : '') + reg.printClose(node);
    }
    switch (node.type) {
      case 'paragraph':
        return printInlineChecked(inlineOf(node));
      case 'heading': {
        let text = printInlineChecked(inlineOf(node), { heading: true });
        if (/#$/.test(text)) text = text.slice(0, -1) + '\\#';
        return '#'.repeat(Math.min(Math.max(a.level ?? 2, 1), 6)) + (text ? ' ' + text : '');
      }
      case 'horizontalRule':
        return '* * *';
      case 'codeBlock': {
        const text = (node.content ?? []).map((t) => t.text ?? '').join('');
        const runs = text.match(/^ {0,3}(`{3,}|~{3,})/gm) ?? [];
        const longest = Math.max(2, ...runs.map((r) => r.trim().length));
        const fence = '`'.repeat(longest + 1);
        return `${fence}${a.language ?? ''}\n${text}${text ? '\n' : ''}${fence}`;
      }
      case 'image':
        return isFigure(a) ? printFigure(a, imageMd(a)) : imageMd(a);
      case 'blockquote':
        return printBlocks(node.content ?? [])
          .split('\n')
          .map((l) => (l ? '> ' + l : '>'))
          .join('\n');
      case 'bulletList':
      case 'orderedList':
        return (node.content ?? [])
          .map((item, k) => printItem(item, listMarker(node, k, ctx.prev), a.tight !== false))
          .join(a.tight !== false ? '\n' : '\n\n');
      case 'table':
        return printTable(node);
      default:
        return a.html ?? '';
    }
  }

  function listMarker(list, k, prev) {
    const twin = prev && prev.type === list.type;
    if (list.type === 'bulletList') return twin ? '*   ' : '-   ';
    const n = (list.attrs?.start ?? 1) + k;
    return `${n}${twin ? ')' : '.'}${n < 10 ? '  ' : ' '}`;
  }

  function printItem(item, marker, tight) {
    // In a tight item the children sit on consecutive lines; an ordered list that does not start at 1 cannot
    // interrupt a paragraph, so it gets a blank line (the only form Markdown allows).
    const kids = item.content ?? [];
    const text = kids
      .map((n, k) => [printBlock(n, { prev: kids[k - 1] }), n, kids[k - 1]])
      .filter(([t]) => t !== '')
      .map(([t, n, prev], k) =>
        (k === 0 ? '' : !tight || (n.type === 'orderedList' && (n.attrs?.start ?? 1) !== 1 && prev?.type === 'paragraph') ? '\n\n' : '\n') + t,
      )
      .join('');
    return text ? marker + indent(text, ' '.repeat(marker.length)) : marker.trimEnd();
  }

  function printTable(node) {
    const rows = node.content ?? [];
    const width = Math.max(1, ...rows.map((r) => (r.content ?? []).length));
    const cells = (row) => {
      const out = (row.content ?? []).map((cell) => printInlineChecked((cell.content ?? []).flatMap(inlineOf), { table: true }));
      while (out.length < width) out.push('');
      return `| ${out.join(' | ')} |`;
    };
    const align = node.attrs?.align ?? [];
    const delim = Array.from({ length: width }, (_, k) => ({ left: ':---', center: ':---:', right: '---:' })[align[k]] ?? '---');
    const [head, ...body] = rows;
    return [head ? cells(head) : `| ${Array(width).fill('').join(' | ')} |`, `| ${delim.join(' | ')} |`, ...body.map(cells)].join('\n');
  }

  function printBlocks(nodes, sep = '\n\n') {
    const pieces = nodes.map((n, k) => ({ type: n.type, text: printBlock(n, { prev: nodes[k - 1] }) })).filter((p) => p.text !== '');
    return keepListsApart(pieces).join(sep);
  }

  return { printBlock, printBlocks, printItem, listMarker };
}
