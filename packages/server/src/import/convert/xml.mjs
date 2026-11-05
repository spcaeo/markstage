// A small reader for WordPress exports (WXR, an RSS file with wp: fields), cut with indexOf only: no regular
// expression runs over the whole file, a closing tag inside a CDATA section is not the end, and an element that is
// never closed costs one scan. Shared by the site import (convert/wordpress.mjs) and the Library's import of
// reusable blocks (library/wp.mjs).

/** Where `close` is, from `from`, not counting one inside a CDATA section; -1 when absent. Linear: indexOf only. */
export function closeOf(xml, close, from) {
  let at = from;
  for (;;) {
    const c = xml.indexOf(close, at);
    const d = xml.indexOf('<![CDATA[', at);
    if (c < 0) return -1;
    if (d < 0 || c < d) return c;
    const e = xml.indexOf(']]>', d + 9);
    if (e < 0) return -1;
    at = e + 3;
  }
}

export const unescapeXml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => (Number(n) > 0 && Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : m)).replace(/&amp;/g, '&');

/** The text of an element's inside: its CDATA sections joined, or its text unescaped. */
function textOf(raw) {
  if (!raw.includes('<![CDATA[')) return unescapeXml(raw.trim());
  let out = '';
  for (let at = raw.indexOf('<![CDATA['); at >= 0; at = raw.indexOf('<![CDATA[', at)) {
    const e = raw.indexOf(']]>', at + 9);
    if (e < 0) break;
    out += raw.slice(at + 9, e);
    at = e + 3;
  }
  return out;
}

/** Where the next `<tag` that is that tag (not a longer name) starts, from `from`; -1 when absent. */
function openOf(xml, tag, from) {
  for (let at = from; ; ) {
    const open = xml.indexOf(`<${tag}`, at);
    if (open < 0) return -1;
    const next = xml[open + tag.length + 1];
    if (next === '>' || next === ' ' || next === '\t' || next === '\n' || next === '\r' || next === '/') return open;
    at = open + 1;
  }
}

/**
 * Each element named `tag` in `xml`, in order: [{attrs, inner, text}]. `inner` is the raw inside (to read more
 * elements from), `text` its text (CDATA joined). A self-closing element has an empty inside. Linear.
 */
export function elements(xml, tag, { max = Infinity } = {}) {
  const out = [];
  for (let at = 0; out.length < max; ) {
    const open = openOf(xml, tag, at);
    if (open < 0) break;
    const head = xml.indexOf('>', open);
    if (head < 0) break;
    const attrs = xml.slice(open + tag.length + 1, head).replace(/\/\s*$/, '');
    if (xml[head - 1] === '/') {
      out.push({ attrs, inner: '', text: '' });
      at = head + 1;
      continue;
    }
    const end = closeOf(xml, `</${tag}>`, head + 1);
    if (end < 0) break;
    const inner = xml.slice(head + 1, end);
    out.push({ attrs, inner, get text() {
      return textOf(inner);
    } });
    at = end + tag.length + 3;
  }
  return out;
}

/** The text inside the first element named `tag` (its CDATA sections joined); null when absent. */
export function field(xml, tag) {
  const [e] = elements(xml, tag, { max: 1 });
  return e ? e.text : null;
}

/** An attribute of an element's attribute text (`domain="category" nicename="news"`), or null. */
export function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? unescapeXml(m[1] ?? m[2]) : null;
}
