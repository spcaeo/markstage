// The look of a JSON file (newline, indent unit, "key": value spacing, pretty or one-line) and a serializer that
// writes new values in that look, so an inserted or replaced value reads as if the file's own tool had written it.

/** @typedef {{ newline: string, indent: string, colon: string, pretty: boolean, finalNewline: boolean }} JsonStyle */

/** The style used when a file gives no clue (JSON.stringify(value, null, 2) plus a final newline). */
export const DEFAULT_STYLE = Object.freeze({ newline: '\n', indent: '  ', colon: ': ', pretty: true, finalNewline: true });

/**
 * Reads the style of `text` from its first container that holds something.
 * @param {string} text
 * @param {import('./parse.mjs').Node} root
 * @returns {JsonStyle}
 */
export function detectStyle(text, root) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = /\r?\n$/.test(text);
  /** @type {import('./parse.mjs').Node | undefined} */
  let box;
  const find = (n) => {
    if (box || !n) return;
    if ((n.type === 'object' && n.members.length) || (n.type === 'array' && n.items.length)) box = n;
  };
  find(root);
  if (!box) return { ...DEFAULT_STYLE, newline, finalNewline };
  const first = box.type === 'object' ? box.members[0].keyStart : box.items[0].start;
  const gap = text.slice(box.start + 1, first);
  const pretty = gap.includes('\n');
  const indent = pretty ? (gap.split('\n').pop() ?? '').slice(lineIndent(text, box.start).length) || DEFAULT_STYLE.indent : '';
  let colon = DEFAULT_STYLE.colon;
  const withMember = findObject(root);
  if (withMember) {
    const m = withMember.members[0];
    colon = text.slice(m.keyEnd, m.value.start);
  }
  return { newline, indent, colon, pretty, finalNewline };
}

function findObject(n) {
  if (!n) return undefined;
  if (n.type === 'object' && n.members.length) return n;
  const kids = n.type === 'object' ? n.members.map((m) => m.value) : n.type === 'array' ? n.items : [];
  for (const k of kids) {
    const f = findObject(k);
    if (f) return f;
  }
  return undefined;
}

/** The whitespace that starts the line holding offset `at`. */
export function lineIndent(text, at) {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start, at))?.[0] ?? '';
}

/**
 * `value` as JSON text in `style`; lines after the first are prefixed with `base` (the indent of the line the value
 * starts on). Keys whose value is undefined are left out, as JSON.stringify does.
 * @param {unknown} value
 * @param {JsonStyle} style
 * @param {string} [base]
 * @returns {string}
 */
export function serialize(value, style, base = '') {
  if (value === undefined) throw new Error('cannot write undefined');
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    if (s === undefined) throw new Error(`cannot write a ${typeof value}`);
    return s;
  }
  const inner = base + style.indent;
  const nl = style.pretty ? style.newline : '';
  const sep = style.pretty ? ',' + nl + inner : ',';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const parts = value.map((v) => serialize(v === undefined ? null : v, style, inner));
    return style.pretty ? `[${nl}${inner}${parts.join(sep)}${nl}${base}]` : `[${parts.join(sep)}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (!entries.length) return '{}';
  const parts = entries.map(([k, v]) => `${JSON.stringify(k)}${style.pretty ? style.colon : style.colon.trim() || ':'}${serialize(v, style, inner)}`);
  return style.pretty ? `{${nl}${inner}${parts.join(sep)}${nl}${base}}` : `{${parts.join(sep)}}`;
}

/** Plain-data equality (what a save would write), used to skip edits that change nothing. */
export function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameValue(a[k], b[k]));
}
