// HTML text and tags, as the converter and block packs read and write them. Plain ESM, no dependencies but the
// named character reference table.
import { decodeNamedCharacterReference } from 'decode-named-character-reference';

/** `&amp;`, `&#39;`, `&nbsp;`… -> the characters (unknown references stay as written). */
export function decodeHtml(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (all, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    const ch = decodeNamedCharacterReference(ref);
    return ch === false ? all : ch;
  });
}

/** Text inside an HTML block is not Markdown: only &, <, > and the no-break space need entities. */
export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}

export function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** One tag's text -> { name, close, attrs: [[name, value|null]], self } or null when it is not a simple tag. */
export function parseTag(tag) {
  const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'=<>`/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>$/.exec(tag);
  if (!m) return null;
  const attrs = [];
  const re = /\s+([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let a;
  while ((a = re.exec(m[3]))) attrs.push([a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? null]);
  return { name: m[2].toLowerCase(), close: m[1] === '/', attrs, self: m[4] === '/' };
}

/** The value of attribute `name` on a parsed tag (null when absent or valueless). */
export const attrOf = (tag, name) => tag.attrs.find(([k]) => k === name)?.[1] ?? null;

/** True when the text holds an HTML tag. */
export const hasTags = (s) => /<[A-Za-z/]/.test(s);
