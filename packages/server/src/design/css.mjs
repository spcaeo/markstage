// CSS without a CSS engine: one scanner that knows comments, strings and blocks, enough to
//   - refuse a stylesheet that would break the ones after it (an unclosed block, comment or string, `</style`);
//   - list the design tokens (custom properties) with where they sit, and
//   - change token values surgically: only the value text of the named declarations, every other byte kept.

const NAMED_COLORS = new Set(
  'black white red green blue yellow orange purple pink gray grey silver maroon olive lime aqua teal navy fuchsia transparent currentcolor'.split(' '),
);

/** Sizes the server takes for a code file (bytes of UTF-8). */
export const LIMITS = { css: 1024 * 1024, inject: 64 * 1024, js: 256 * 1024 };

function lines(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const squash = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
const heading = (comment) => {
  const first = comment.replace(/^[\s*=-]+|[\s*=-]+$/g, '').split('\n')[0].trim();
  return first && first.length <= 80 ? first : null;
};

/**
 * Scan a stylesheet: { issues: [{line, message}], tokens: [{name, value, selector, context, group, line, start, end}] }.
 * `start`/`end` are the value's offsets (without `!important`). `selector` is the rule's own selector, `context` the
 * at-rules around it ("@media (prefers-color-scheme: dark)"), or ''.
 */
export function scanCss(text) {
  const lineOf = lines(text);
  const issues = [];
  const tokens = [];
  const top = { prelude: '', group: null, line: 1 };
  const stack = [];
  const level = () => stack.at(-1) ?? top;
  let segStart = 0;

  const declaration = (start, end) => {
    if (!stack.length) return;
    let i = start;
    // skip leading space and comments
    for (;;) {
      while (i < end && /\s/.test(text[i])) i++;
      if (text.startsWith('/*', i)) {
        const close = text.indexOf('*/', i + 2);
        if (close < 0 || close >= end) return;
        i = close + 2;
      } else break;
    }
    const m = /^--[A-Za-z0-9_-]+/.exec(text.slice(i, end));
    if (!m) return;
    let j = i + m[0].length;
    while (j < end && /\s/.test(text[j])) j++;
    if (text[j] !== ':') return;
    let vs = j + 1;
    let ve = end;
    while (vs < ve && /\s/.test(text[vs])) vs++;
    // a trailing comment and `!important` are not part of the value
    for (;;) {
      while (ve > vs && /\s/.test(text[ve - 1])) ve--;
      if (text.slice(vs, ve).endsWith('*/')) {
        const open = text.lastIndexOf('/*', ve - 2);
        if (open < vs) break;
        ve = open;
        continue;
      }
      const imp = /\s*!\s*important$/i.exec(text.slice(vs, ve));
      if (imp) {
        ve -= imp[0].length;
        continue;
      }
      break;
    }
    const preludes = stack.map((s) => s.prelude);
    tokens.push({
      name: m[0],
      value: text.slice(vs, ve),
      selector: preludes.at(-1),
      context: preludes.slice(0, -1).join(' '),
      group: level().group,
      line: lineOf(i),
      start: vs,
      end: ve,
    });
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) {
        issues.push({ line: lineOf(i), message: 'This comment is never closed (a */ is missing).' });
        break;
      }
      // a comment on its own line names the tokens below it; one after a declaration only explains that one
      const own = !text.slice(text.lastIndexOf('\n', i - 1) + 1, i).trim();
      const h = own ? heading(text.slice(i + 2, close)) : null;
      if (h) level().group = h;
      i = close + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (text[j] !== ch) issues.push({ line: lineOf(i), message: 'This string is never closed (a quote is missing).' });
      i = j + 1;
      continue;
    }
    if (ch === '{') {
      stack.push({ prelude: squash(text.slice(segStart, i)), group: level().group, line: lineOf(i) });
      segStart = i + 1;
    } else if (ch === '}') {
      if (!stack.length) issues.push({ line: lineOf(i), message: 'This } closes nothing (a { is missing before it).' });
      else {
        declaration(segStart, i);
        stack.pop();
      }
      segStart = i + 1;
    } else if (ch === ';') {
      declaration(segStart, i);
      segStart = i + 1;
    }
    i++;
  }
  for (const open of stack) issues.push({ line: open.line, message: `The block “${open.prelude.slice(0, 60)}” is never closed (a } is missing).` });
  return { issues, tokens };
}

/** What kind of picker a token gets, from its value and its name. */
export function tokenType(name, value) {
  const n = name.toLowerCase();
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(v) || /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/.test(v) || NAMED_COLORS.has(v)) return 'color';
  if (/^var\(/.test(v) && /colou?r|bg|background|ink|paper|accent|border|text-c|fg/.test(n)) return 'color';
  if (/weight|leading|line-height|tracking|letter/.test(n)) return 'other';
  if (/font|family|typeface|serif|sans|mono/.test(n) && !/size/.test(n)) return 'font';
  if (/space|spacing|gap|gutter|pad|margin|inset|stack/.test(n)) return 'space';
  if (/^-?[\d.]+(px|rem|em|%|vw|vh|vmin|vmax|ch|ex|pt)$/.test(v) || /^(clamp|min|max|calc)\(/.test(v)) return 'size';
  return 'other';
}

/** The design tokens of a stylesheet, for the pickers. */
export function listTokens(text) {
  return scanCss(text).tokens.map(({ name, value, selector, context, group, line }) => ({ name, value, type: tokenType(name, value), selector, context, group, line }));
}

/** Why a new token value cannot go into the file as it is, or null. */
export function badTokenValue(value) {
  if (typeof value !== 'string') return 'must be text';
  const v = value.trim();
  if (!v) return 'is empty';
  if (v.length > 500) return 'is longer than 500 characters';
  if (/[\u0000-\u001f\u007f;{}\\]/.test(v)) return 'may not contain ; { } \\ or line breaks';
  if (/<\/|\/\*|\*\//.test(v)) return 'may not contain </, /* or */';
  let depth = 0;
  let quote = null;
  for (const ch of v) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return 'has a ) without its (';
  }
  if (quote) return 'has a quote that is never closed';
  if (depth) return 'has a ( that is never closed';
  for (const m of v.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (!/^\/(?!\/)|^https:\/\//i.test(m[2])) return 'may only use url() with a site path (/…) or an https address';
  }
  if (/url\(/i.test(v) && !/url\(\s*(['"]?)[^'")]*\1\s*\)/i.test(v)) return 'has a url() that cannot be read';
  return null;
}

/**
 * Set token values in place: `values` = [{name, selector, context?, value}]. Only those values change. Returns
 * { text } or { errors: [{name, selector, message}] } (nothing is changed when any value is refused).
 */
export function setTokens(text, values) {
  const { tokens, issues } = scanCss(text);
  const errors = [];
  if (issues.length) return { errors: [{ name: null, selector: null, message: `The tokens file has a problem on line ${issues[0].line}: ${issues[0].message}` }] };
  const edits = new Map();
  for (const v of values) {
    const context = v.context ?? '';
    // the last declaration of a name in a rule is the one that applies
    const hit = tokens.findLast((t) => t.name === v.name && t.selector === v.selector && t.context === context);
    const why = badTokenValue(v.value);
    if (!hit) errors.push({ name: v.name, selector: v.selector, message: `There is no ${v.name} in “${v.selector}”${context ? ` inside ${context}` : ''}.` });
    else if (why) errors.push({ name: v.name, selector: v.selector, message: `The value of ${v.name} ${why}.` });
    else edits.set(hit.start, { ...hit, value: v.value.trim() });
  }
  if (errors.length) return { errors };
  let out = text;
  for (const e of [...edits.values()].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.value + out.slice(e.end);
  return { text: out };
}

/**
 * The checks every code save passes before anything is written: [{line, message}] (empty = fine). Stylesheets must
 * not break the ones after them; injected code and scripts are size-checked only (they are the owner's own code).
 */
export function checkCode(file, text) {
  if (typeof text !== 'string') return [{ line: 1, message: 'The file must be text.' }];
  const bytes = Buffer.byteLength(text);
  const limit = file.kind.startsWith('inject') ? LIMITS.inject : file.lang === 'css' ? LIMITS.css : LIMITS.js;
  if (bytes > limit) return [{ line: 1, message: `The file is ${Math.ceil(bytes / 1024)} KB; at most ${limit / 1024} KB.` }];
  if (text.includes('\u0000')) return [{ line: 1, message: 'The file contains a NUL character.' }];
  if (file.lang !== 'css') return [];
  const issues = scanCss(text).issues;
  const lineOf = lines(text);
  for (const m of text.matchAll(/<\/style/gi)) issues.push({ line: lineOf(m.index), message: '“</style” cannot be in a stylesheet (it would end the page’s style tag).' });
  return issues.sort((a, b) => a.line - b.line);
}
