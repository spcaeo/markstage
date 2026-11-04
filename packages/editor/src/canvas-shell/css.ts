// The site's own CSS, made to draw its page inside the editor (docs/CANVAS-FIDELITY.md). The page shell is the real
// page drawn in the canvas, so its stylesheets must (1) style only the shell, never the editor around it, and
// (2) see the canvas as the page's window: the canvas is often narrower than the browser (a panel open beside it),
// and the page's breakpoints must follow the canvas, not the browser.
//
//   html, :root      -> the shell's stand-in for <html> (`.ms-pg`), with the same specificity
//   body             -> the shell's stand-in for <body> (`.ms-pg-body`)
//   anything else    -> only inside the shell (`:where(.ms-pg) …`, no extra specificity)
//   @media (width)   -> @container ms-vp (width): the canvas is the container `ms-vp`; other media features
//                       (hover, prefers-*, height) stay media queries; print rules are dropped
//   100vw            -> calc(100 * var(--ms-vw)): the shell sets --ms-vw to a hundredth of the canvas's width
//
// Pure string work: the sheet's blocks are read from its text (parseRules, at the end: not the browser's CSSOM, which
// loses declarations), so it is tested without a browser.

export const ROOT = 'ms-pg';
export const BODY = 'ms-pg-body';
export const CONTAINER = 'ms-vp';

/** Splits at `sep` outside brackets, parentheses and strings. */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '\\') i++;
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** The compounds of one complex selector and the combinators between them: ['html', ' ', '.a', '>', '.b']. */
function compounds(sel: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  let comb = '';
  const flush = () => {
    if (!cur) return;
    if (parts.length) parts.push(comb || ' ');
    parts.push(cur);
    cur = '';
    comb = '';
  };
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += sel[++i] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '\\') {
      cur += c + (sel[++i] ?? '');
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth === 0 && (c === ' ' || c === '\n' || c === '\t' || c === '>' || c === '+' || c === '~')) {
      flush();
      if (c !== ' ' && c !== '\n' && c !== '\t') comb = c;
      continue;
    }
    cur += c;
  }
  flush();
  return parts;
}

const typeOf = (compound: string) => /^(?:[a-zA-Z][\w-]*|\*)/.exec(compound)?.[0] ?? '';

/** One compound with html / :root / body put on the shell's stand-ins (same specificity as the original). */
function standIn(compound: string): string {
  const t = typeOf(compound).toLowerCase();
  if (t === 'html') return `:where(.${ROOT}):is(div)${compound.slice(4)}`;
  if (t === 'body') return `:where(.${BODY}):is(div)${compound.slice(4)}`;
  if (compound.startsWith(':root')) return `.${ROOT}${compound.slice(5)}`;
  return compound;
}

/** A selector list that matches inside the shell only (docs at the top of this file). */
export function scopeSelector(list: string): string {
  const out: string[] = [];
  for (const raw of splitTop(list, ',')) {
    const sel = raw.trim();
    if (!sel) continue;
    const parts = compounds(sel);
    const first = parts[0] ?? '';
    const anchored = /^(html|body)\b/i.test(typeOf(first)) || first.startsWith(':root');
    const mapped = parts.map((p, i) => (i % 2 === 0 ? standIn(p) : p === ' ' ? ' ' : ` ${p} `)).join('');
    if (anchored) {
      out.push(mapped);
      continue;
    }
    out.push(`:where(.${ROOT}) ${mapped}`);
    // a selector that starts with a class or an attribute may be about <html> itself ([data-theme='dark'] .x)
    if (/^[.[#]|^:(?!:)/.test(first)) out.push(`:where(.${ROOT})${mapped}`);
  }
  return out.join(', ');
}

/** Lengths in a media condition, as a media query reads them (1em = 16px), for a container query. */
const px = (cond: string) => cond.replace(/(\d*\.?\d+)r?em\b/g, (_, n) => `${Number(n) * 16}px`);
const WIDTH = /^\(\s*(?:(?:min|max)-)?(?:width|inline-size|aspect-ratio|orientation)\b|^\(\s*[\d.]+[a-z%]*\s*[<>]=?\s*(?:width|inline-size)\b|^\(\s*(?:width|inline-size)\s*[<>=]/i;

export interface Query {
  /** what stays a media query (hover, prefers-*, height), or '' */
  media: string;
  /** the width part, as a container query on the canvas, or '' */
  container: string;
}

/**
 * A media query list -> the queries it becomes (one per comma), or null when it never applies in the editor
 * (print). `screen`, `all` and `only` go: the canvas is a screen.
 */
export function mediaToQueries(mediaText: string): Query[] | null {
  const out: Query[] = [];
  for (const q of splitTop(mediaText, ',')) {
    let s = q.trim().replace(/^only\s+/i, '');
    if (/^not\s/i.test(s)) {
      // `not print`, `not all and (…)`: rare; kept as the browser reads it
      out.push({ media: s, container: '' });
      continue;
    }
    if (/^print\b/i.test(s)) continue;
    s = s.replace(/^(screen|all)\s*(and\s+)?/i, '');
    const media: string[] = [];
    const container: string[] = [];
    for (const f of splitTop(s, ' and ')) {
      const t = f.trim();
      if (!t) continue;
      (WIDTH.test(t) ? container : media).push(t);
    }
    out.push({ media: media.join(' and '), container: px(container.join(' and ')) });
  }
  return out.length ? out : null;
}

/** 100vw (dvw, svw, lvw) -> the canvas's width. */
export function rewriteVw(text: string): string {
  return text.replace(/(^|[^\w.-])(-?(?:\d+\.?\d*|\.\d+))[dsl]?vw\b/g, (_, pre, n) => `${pre}calc(${n} * var(--ms-vw, 1vw))`);
}

/** The parts of a CSSOM rule this needs (the browser's CSSRule; plain objects in the tests). */
export interface RuleLike {
  cssText: string;
  selectorText?: string;
  style?: { cssText: string };
  cssRules?: ArrayLike<RuleLike>;
  media?: { mediaText: string };
  conditionText?: string;
  name?: string;
}

/** The rules, rewritten for the shell. `nested`: inside a style rule (CSS nesting), where selectors are relative. */
export function scopeRules(rules: ArrayLike<RuleLike>, nested = false): string {
  let out = '';
  for (let i = 0; i < rules.length; i++) out += scopeRule(rules[i], nested);
  return out;
}

function scopeRule(r: RuleLike, nested: boolean): string {
  const text = r.cssText.trimStart();
  const inner = () => scopeRules(r.cssRules ?? [], nested);
  if (r.selectorText !== undefined && r.style) {
    const sel = nested ? r.selectorText : scopeSelector(r.selectorText);
    if (!sel) return '';
    return `${sel}{${rewriteVw(r.style.cssText)}${scopeRules(r.cssRules ?? [], true)}}\n`;
  }
  if (text.startsWith('@media')) {
    const qs = mediaToQueries(r.media?.mediaText ?? '');
    if (!qs) return '';
    const body = inner();
    return qs
      .map(({ media, container }) => {
        const c = container ? `@container ${CONTAINER} ${container}{${body}}` : body;
        return media ? `@media ${media}{${c}}\n` : `${c}\n`;
      })
      .join('');
  }
  if (text.startsWith('@supports')) return `@supports ${r.conditionText}{${inner()}}\n`;
  if (text.startsWith('@container')) return `@container ${r.conditionText}{${inner()}}\n`;
  if (text.startsWith('@layer') && r.cssRules) return `@layer ${r.name ?? ''}{${inner()}}\n`;
  if (text.startsWith('@starting-style')) return `@starting-style{${inner()}}\n`;
  if (text.startsWith('@import') || text.startsWith('@page') || text.startsWith('@charset') || text.startsWith('@namespace')) return '';
  // @font-face, @keyframes, @property, @counter-style, a @layer statement: global by nature, kept as they are
  return `${text}\n`;
}

/** A stylesheet's text, rewritten for the shell (a rule the browser cannot read is dropped by it, as on the page). */
export function scopeSheet(cssText: string): string {
  return scopeRules(parseRules(cssText));
}

// ---------- the fence: the editor's own copy of the site's CSS kept out of the shell (fence.ts) ----------
//
//   .a > .b::before   ->   .a > .b:where(:not(.ms-pg, .ms-pg *))::before
//
// No weight (`:where`), so outside the shell nothing changes.

export const FENCE = `:where(:not(.${ROOT}, .${ROOT} *))`;

/** Where the fence goes in one complex selector: before its pseudo-element (::before, ::part(x), :after…), or last. */
function fenceAt(sel: string): number {
  let depth = 0;
  let quote = '';
  let at = -1;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) at = -1;
    else if (depth === 0 && c === ':' && at < 0 && (sel[i + 1] === ':' || /^:(before|after|first-line|first-letter)\b/i.test(sel.slice(i)))) at = i;
  }
  return at < 0 ? sel.length : at;
}

/** A selector list that matches outside the shell only. */
export function fenceSelector(list: string): string {
  return splitTop(list, ',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((sel) => {
      const at = fenceAt(sel);
      return `${sel.slice(0, at)}${FENCE}${sel.slice(at)}`;
    })
    .join(', ');
}

/** The rules, fenced (every style rule, nested ones too); at-rules keep their prelude. */
export function fenceRules(rules: ArrayLike<RuleLike>): string {
  let out = '';
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const text = r.cssText.trimStart();
    if (r.selectorText !== undefined && r.style) {
      out += `${fenceSelector(r.selectorText)}{${r.style.cssText}${fenceRules(r.cssRules ?? [])}}\n`;
      continue;
    }
    if (r.cssRules && /^@(media|supports|container|layer|starting-style|scope)\b/.test(text)) {
      out += `${text.slice(0, text.indexOf('{'))}{${fenceRules(r.cssRules)}}\n`;
      continue;
    }
    if (text.startsWith('@import')) continue;
    out += `${text}\n`;
  }
  return out;
}

/** A stylesheet's text, fenced. */
export function fenceSheet(cssText: string): string {
  return fenceRules(parseRules(cssText));
}

// ---------- the sheet's rules, read from its text ----------
//
// Not the browser's CSSOM: it loses declarations. A shorthand written with var() is kept as one "pending" value, and
// when a later declaration of the rule sets one of its longhands, the others come back empty: a real site's
// `.card { border: 1px solid var(--line); border-left: 2px solid var(--accent) }` read back with no top, right or
// bottom border, so the page's card had them and the canvas's did not. Here every declaration is kept as
// written; only the blocks are found (strings, comments, brackets and nesting respected).

/** Where the text from `i` stops at depth 0: at one of `stops` (`;`, `{`, `}`), or at the end. A custom property's
 *  value (`--x: { … }`) may hold braces. */
function scanTo(src: string, i: number, stops: string): number {
  let depth = 0;
  let quote = '';
  const custom = /^\s*--[\w-]*\s*:/.test(src.slice(i, i + 200));
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '\\') i++;
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || (custom && c === '{')) depth++;
    else if (c === ')' || c === ']' || (custom && c === '}' && depth > 0)) depth--;
    else if (depth === 0 && stops.includes(c)) return i;
  }
  return i;
}

/** The end of the block whose `{` is at `open` (the index of its `}`). */
function blockEnd(src: string, open: number): number {
  let i = open + 1;
  for (;;) {
    i = scanTo(src, i, '{}');
    if (i >= src.length || src[i] === '}') return i;
    i = blockEnd(src, i) + 1;
  }
}

const GROUP = /^@(media|supports|container|layer|starting-style)\b/i;

/**
 * The rules in `src` from `start` to `end`. In a style rule's body (`style`) bare text is declarations: the ones
 * before the first nested rule are the rule's own (`decls`), later ones a rule of declarations of their own (as the
 * CSSOM's nested declarations), in order.
 */
function readRules(src: string, start: number, end: number, style: boolean): { decls: string; rules: RuleLike[] } {
  const rules: RuleLike[] = [];
  let decls = '';
  let pending = '';
  const flush = () => {
    if (pending) rules.push({ cssText: pending.trim() });
    pending = '';
  };
  let i = start;
  while (i < end) {
    const at = Math.min(scanTo(src, i, ';{}'), end);
    const prelude = src.slice(i, at).trim();
    if (at >= end || src[at] !== '{') {
      // a declaration (in a style rule), or a statement (@import, @layer a, b;)
      if (prelude && style && !prelude.startsWith('@')) {
        if (rules.length) pending += `${prelude}; `;
        else decls += `${prelude}; `;
      } else if (prelude) rules.push({ cssText: `${prelude};` });
      i = at + 1;
      continue;
    }
    flush();
    const close = Math.min(blockEnd(src, at), end);
    if (prelude.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1] ?? '';
      const cond = prelude.slice(name.length + 1).trim().replace(/\s+/g, ' ');
      if (GROUP.test(prelude)) {
        const inner = readRules(src, at + 1, close, style);
        const cssRules = inner.decls ? [{ cssText: inner.decls.trim() }, ...inner.rules] : inner.rules;
        rules.push({ cssText: `@${name.toLowerCase()} ${cond}{}`, media: { mediaText: cond }, conditionText: cond, name: cond, cssRules });
      } else rules.push({ cssText: `${prelude}{${src.slice(at + 1, close)}}` });
    } else {
      const inner = readRules(src, at + 1, close, true);
      rules.push({ selectorText: prelude, style: { cssText: inner.decls.trim() }, cssText: `${prelude}{${src.slice(at + 1, close)}}`, cssRules: inner.rules });
    }
    i = close + 1;
  }
  flush();
  return { decls, rules };
}

/** A stylesheet's rules, from its text (comments out). */
export function parseRules(css: string): RuleLike[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  return readRules(src, 0, src.length, false).rules;
}
