// Find and replace, the words as a reader sees them (find.mjs): the context of a match in plain text is shown without
// its markup, with each link as a chip (its words, and its address for copy and open), so "[Acme docs](/acme/)"
// reads "Acme docs". The raw form is kept for the groups that are about markup (a link address, an image file name,
// HTML, code, a field's name). And "Keep the case of each match": the new text takes the case of the text it replaces.
//   readable(before, match, after, {json})  [string | {match} | {link, label: [string | {match}]}] or null
//   keepCase(match, w)                      w in the case of match (ACME -> INITECH, Acme -> Initech, acme -> initech)

const A = ''; // the match starts
const B = ''; // the match ends
const L = ''; // a link: L<n>L
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** The JSON string escapes as the words read (the context of a match in a JSON value is still escaped). */
const unjson = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n|\\r|\\t/g, ' ').replace(/\\(["\\/])/g, '$1');

/** Markup that is not words: emphasis, inline code, line marks, escapes, tags and entities. */
function words(s) {
  return s
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]+?)(?<=\S)\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, '$1')
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)([^_]+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(^|\n)[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e) => ENTITIES[e])
    .replace(/\\([!-/:-@[-`{-~])/g, '$1'); // CommonMark: any ASCII punctuation may be escaped
}

/** A run of text with the match marks in it, as parts; null when a mark is missing or doubled. */
function parts(s, links) {
  const out = [];
  const re = new RegExp(`${A}([^${A}${B}]*)${B}|${L}(\\d+)${L}`, 'g');
  let at = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > at) out.push(s.slice(at, m.index));
    out.push(m[2] === undefined ? { match: m[1] } : links[Number(m[2])]);
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push(s.slice(at));
  // a mark left over: the match runs across the edge of a link, so it is shown as written
  if (out.some((p) => typeof p === 'string' && (p.includes(A) || p.includes(B)))) return null;
  return out;
}

/** The context of a plain-text match as it reads, or null to show it as written. */
export function readable(before, match, after, { json = false } = {}) {
  let s = `${before}${A}${match}${B}${after}`;
  if (json) s = unjson(s);
  const links = [];
  const chip = (label, href) => {
    const inner = parts(words(label).replace(/\s+/g, ' '), []);
    if (!inner) return `${label}`;
    links.push({ link: href, label: inner });
    return `${L}${links.length - 1}${L}`;
  };
  const IMG = /!\[([^\]\n]*)\]\([^)\n]*\)/g;
  const MDLINK = /\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
  const HTMLLINK = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  // the match runs into a link's markup ("Acme](…"): the marks break the link, so it is shown as written
  const count = (t) => [IMG, MDLINK, HTMLLINK].map((re) => (t.match(re) ?? []).length).join();
  if (count(s) !== count(s.replace(/[\uE000\uE001]/g, ''))) return null;
  s = s
    // an image reads as its alt text
    .replace(IMG, '$1')
    .replace(MDLINK, (_, label, href) => chip(label, href))
    .replace(HTMLLINK, (_, q, href, label) => chip(label, href));
  const out = parts(words(s).replace(/\s+/g, ' '), links);
  if (!out || !out.some((p) => typeof p === 'object' && ('match' in p || p.label?.some((x) => typeof x === 'object')))) return null;
  return out;
}

/** The new text in the case of the match: all capitals, all small, or a capital first; mixed case as typed. */
export function keepCase(match, w) {
  const letters = [...match].filter((ch) => /\p{L}/u.test(ch)).join('');
  if (!letters || !w) return w;
  const upper = letters.toUpperCase();
  const lower = letters.toLowerCase();
  if (upper === lower) return w;
  if (letters === upper && letters.length > 1) return w.toUpperCase();
  if (letters === lower) return w.toLowerCase();
  if (letters[0] === upper[0] && letters.slice(1) === lower.slice(1)) return w[0].toUpperCase() + w.slice(1);
  return w;
}
