// Rewrite the links to a page that moved, in every entry, surgically: frontmatter through core's setFrontmatter
// (only the changed keys), a Markdown body through core's doc (docToMd rewrites only the changed blocks), JSON
// through the JSON engine (only the changed values). A link is a string value that is the old address (site path or
// absolute URL, in any locale, with or without the trailing slash, keeping any #hash or ?query), or an href inside
// HTML. Visible text is never changed.
// Shared by the Markstage server's move and the astro dev API's move, so both rename the same way. `rewriteEntry`
// takes the caller's converter: {parseFrontmatter(text), setFrontmatter(text, changes), mdToDoc(text) -> doc or
// {doc}, docToMd(doc, original), applyJsonChanges(text, [{path, value}], collection)}; a collection is {format}.

/** The address pairs of a move: every locale's copy, as a site path and as an absolute URL. */
export function movePairs(oldUrl, newUrl, { locales = null, siteUrl = '' } = {}) {
  const prefixes = locales?.list?.length ? locales.list.map((l) => l.prefix ?? '') : [''];
  const site = String(siteUrl ?? '').replace(/\/+$/, '');
  const pairs = [];
  for (const p of prefixes) {
    const from = `${p}${oldUrl}`;
    const to = `${p}${newUrl}`;
    pairs.push({ from, to });
    if (site) pairs.push({ from: `${site}${from}`, to: `${site}${to}` });
  }
  return pairs;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A rewriter for these pairs: `value(s)` for a whole string value, `html(s)` for hrefs inside HTML, `hit(text)`. */
export function linkRewriter(pairs) {
  // longest first, so an absolute URL is not taken for its path part; "/a/b/" also matches "/a/b"
  const forms = pairs
    .flatMap(({ from, to }) => (from.endsWith('/') && from.length > 1 ? [{ from, to }, { from: from.slice(0, -1), to: to.replace(/\/$/, '') }] : [{ from, to }]))
    .sort((a, b) => b.from.length - a.from.length);
  const value = (s) => {
    if (typeof s !== 'string') return s;
    for (const { from, to } of forms) {
      if (s === from) return to;
      if (s.startsWith(from) && (s[from.length] === '#' || s[from.length] === '?')) return to + s.slice(from.length);
    }
    return s;
  };
  const attr = new RegExp(`(\\bhref\\s*=\\s*)(["'])(${forms.map((f) => escRe(f.from)).join('|')})([#?][^"']*)?\\2`, 'gi');
  const html = (s) => (typeof s === 'string' && /href/i.test(s) ? s.replace(attr, (_m, pre, q, url, rest = '') => `${pre}${q}${value(url + rest)}${q}`) : s);
  const hit = (text) => forms.some((f) => text.includes(f.from));
  return { value, html, hit };
}

/** A value with every link rewritten: { value, changed }. `keyOf` names the property (text nodes keep their text). */
function walk(v, rw, key = null) {
  if (typeof v === 'string') {
    if (key === 'text') return { value: v, changed: false };
    const out = rw.html(rw.value(v));
    return { value: out, changed: out !== v };
  }
  if (Array.isArray(v)) {
    let changed = false;
    const value = v.map((x) => {
      const r = walk(x, rw);
      changed ||= r.changed;
      return r.value;
    });
    return { value, changed };
  }
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    let changed = false;
    const value = {};
    for (const [k, x] of Object.entries(v)) {
      const r = walk(x, rw, k);
      changed ||= r.changed;
      value[k] = r.value;
    }
    return { value, changed };
  }
  return { value: v, changed: false };
}

/** Frontmatter changes for setFrontmatter: changed mappings merged per key, changed lists and scalars whole. */
function fmChanges(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[k] = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b) ? fmChanges(a, b) : b;
  }
  return out;
}

/** JSON engine changes: the paths of the strings that changed. */
function jsonChanges(before, after, path = '', out = []) {
  if (typeof before === 'string') {
    if (before !== after) out.push({ path, value: after });
    return out;
  }
  if (before && typeof before === 'object') for (const k of Object.keys(before)) jsonChanges(before[k], after[k], path ? `${path}.${k}` : k, out);
  return out;
}

/** `text` with the links rewritten (the same string when nothing pointed at the old address). */
export function rewriteEntry(converter, c, text, rw) {
  if (!rw.hit(text)) return text;
  if (c.format === 'json') {
    const data = JSON.parse(text);
    const r = walk(data, rw);
    return r.changed ? converter.applyJsonChanges(text, jsonChanges(data, r.value), c) : text;
  }
  let out = text;
  const fm = converter.parseFrontmatter(text);
  const f = walk(fm, rw);
  if (f.changed) out = converter.setFrontmatter(out, fmChanges(fm, f.value));
  // core gives { frontmatter, doc }
  const parsed = converter.mdToDoc(text);
  const d = walk(parsed?.type === 'doc' ? parsed : parsed.doc, rw);
  if (d.changed) out = converter.docToMd(d.value, out);
  return out;
}
