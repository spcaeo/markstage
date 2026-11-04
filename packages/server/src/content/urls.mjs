// URL-scheme rule for every role: a link, image or box URL must be http(s), mailto, tel or relative. Checked
// generically on the saved document (every attr named href, src or url, link marks included, at any depth), on
// frontmatter and on JSON entries, so `javascript:`, `data:`, `vbscript:` and friends never reach the site. Markdown
// is also read the way the site's renderer reads it (converter `markdownUrls`, a CommonMark parse): an autolink such
// as `<javascript:x>` is text in the editor's document but a live link on the site (security review 3 Nov, S1).

const SAFE = new Set(['http', 'https', 'mailto', 'tel']);
const URL_KEY = /^(href|src|url)$/i;
// the named references that can hide a scheme's colon or split it with whitespace (the rest cannot form a scheme)
const NAMED = { colon: ':', tab: '\t', newline: '\n' };

/** Character references decoded as an HTML attribute value would be (numeric, and the few named ones that matter). */
const decodeRefs = (s) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (all, hex, dec, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? all;
    const n = hex ? parseInt(hex, 16) : Number(dec);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  });

/**
 * The scheme of a URL as a browser would read it, or null: character references are decoded first (a renderer or
 * the HTML attribute does that), then whitespace and control characters inside are ignored, and case does not count.
 */
export function schemeOf(value) {
  const s = decodeRefs(String(value)).replace(/[\u0000- \u007f-\u009f]/g, '');
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

export const isSafeUrl = (value) => {
  const scheme = schemeOf(value);
  return scheme === null || SAFE.has(scheme);
};

/** The unsafe ones of a list of URLs (as `markdownUrls` gives them), shortened for a message. */
export const unsafeOf = (urls) => urls.filter((u) => typeof u === 'string' && !isSafeUrl(u)).map((u) => u.slice(0, 200));

/** Every unsafe URL value under `node` (documents, frontmatter, JSON data). */
export function unsafeUrls(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 200) return out;
  if (Array.isArray(node)) {
    for (const item of node) unsafeUrls(item, out, depth + 1);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && URL_KEY.test(key) && !isSafeUrl(value)) out.push(value.slice(0, 200));
    else if (value && typeof value === 'object') unsafeUrls(value, out, depth + 1);
  }
  return out;
}
