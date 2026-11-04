// Where a find-and-replace match sits in an entry, so a replace never changes an address or code by accident:
// plain text (in a field's value or the body) is one kind; a link address, an image file name, the inside of an
// HTML tag, code and a field's name are the others, each its own group on the screen, left out unless ticked.
// Each match also gets the field it is in ("Title", "Body under heading “Pricing”", "Hero › Heading" in JSON) and
// about eight words either side. Pure functions over the entry's text, as the file is written.
//   placesOf(text, {format})   {kindAt(start, end), fieldAt(pos), contextAt(start, end)}

/** The groups, safest first. Only `text` is replaced unless another is asked for. */
export const KINDS = ['text', 'link', 'image', 'html', 'code', 'key'];
export const DEFAULT_KINDS = ['text'];
/** When two regions overlap, the stricter one names the match. */
const RANK = { key: 5, code: 4, image: 3, link: 2, html: 1, text: 0 };
const WORDS = 8;

const IMAGE = /\.(?:png|jpe?g|gif|webp|avif|svg|heic|heif|bmp|ico|tiff?)(?:[?#][^\s]*)?$/i;
const URLISH = /^(?:[a-z][a-z0-9+.-]*:|\/|\.\.?\/|#)/i;
const IMAGE_ATTRS = new Set(['src', 'srcset', 'poster', 'data-src', 'data-srcset']);
const LINK_ATTRS = new Set(['href', 'action', 'cite', 'formaction', 'xlink:href', 'data-href']);

/** A link address that is really an image file. */
const addressKind = (v) => (IMAGE.test(v.trim()) ? 'image' : 'link');
const humanize = (k) => {
  const s = String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : String(k);
};
const plainHeading = (h) => h.replace(/<[^>]*>/g, '').replace(/[*_`~[\]]|\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

/**
 * The regions of Markdown or HTML text that are not plain words: [[start, end, kind]], offsets from `base`. Used for
 * a Markdown body, and for a JSON string that holds Markdown or HTML (escaped quotes count as quotes).
 */
export function markupRegions(text, base = 0) {
  const out = [];
  const add = (s, e, kind) => e > s && out.push([base + s, base + e, kind]);
  const all = (re, f) => {
    for (const m of text.matchAll(re)) f(m);
  };
  // fenced code, then inline code
  all(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, (m) => add(m.index, m.index + m[0].length, 'code'));
  all(/(`+)(?!`)[^\n]*?[^`]\1(?!`)/g, (m) => add(m.index, m.index + m[0].length, 'code'));
  all(/<!--[\s\S]*?-->/g, (m) => add(m.index, m.index + m[0].length, 'html'));
  // Markdown images and links: the address in the brackets after; reference definitions
  all(/(!?)\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/dg, (m) => add(...m.indices[2], m[1] ? 'image' : addressKind(m[2])));
  all(/^ {0,3}\[[^\]\n]+\]:[ \t]*(\S+)/dgm, (m) => add(...m.indices[1], addressKind(m[1])));
  // addresses written out: <https://…> and bare ones
  all(/\b(?:https?|mailto|ftp):[^\s<>()"'\\]*[^\s<>()"'\\.,;:!?]/gi, (m) => add(m.index, m.index + m[0].length, addressKind(m[0])));
  // HTML tags: the whole tag is HTML; an address attribute's value is a link or an image
  all(/<\/?[A-Za-z][^<>]*>/g, (m) => {
    add(m.index, m.index + m[0].length, 'html');
    for (const a of m[0].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:(\\?["'])([\s\S]*?)\2|([^\s"'>\\]+))/dg)) {
      const name = a[1].toLowerCase();
      const g = a[3] === undefined ? 4 : 3;
      const kind = IMAGE_ATTRS.has(name) ? 'image' : LINK_ATTRS.has(name) ? addressKind(a[g]) : null;
      if (kind) add(m.index + a.indices[g][0], m.index + a.indices[g][1], kind);
    }
  });
  return out;
}

/** Headings in Markdown or HTML, outside code: [[pos, text]] in order. */
function headingsOf(text, base, regions) {
  const inCode = (p) => regions.some(([s, e, k]) => k === 'code' && p >= s && p < e);
  const out = [];
  for (const m of text.matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) if (!inCode(base + m.index)) out.push([base + m.index, plainHeading(m[1])]);
  for (const m of text.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) if (!inCode(base + m.index)) out.push([base + m.index, plainHeading(m[1])]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** Front matter (YAML): each key's name is a `key`; a value that is an address is a link or an image. */
function frontmatter(text, fmEnd, regions, fields) {
  const open = /^---\r?\n/.exec(text)?.[0].length ?? 0;
  regions.push([0, open, 'key'], [text.lastIndexOf('---', fmEnd), fmEnd, 'key']);
  let top = null;
  let pos = open;
  const closeAt = text.lastIndexOf('---', fmEnd);
  while (pos < closeAt) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 || nl > closeAt ? closeAt : nl;
    const line = text.slice(pos, end);
    const k = /^(\s*)(-\s+)?(["']?)([^:#\n"']+?)\3:(?=\s|$)/.exec(line);
    let valueAt = pos;
    if (k) {
      if (!k[1] && !k[2]) top = k[4];
      regions.push([pos + k[1].length + (k[2]?.length ?? 0), pos + k[0].length, 'key']);
      valueAt = pos + k[0].length;
    } else if (/^\s*-\s/.test(line)) valueAt = pos + line.indexOf('-') + 1;
    else if (/^\s*#/.test(line)) regions.push([pos, end, 'key']);
    const raw = text.slice(valueAt, end);
    const v = raw.trim().replace(/^(["'])(.*)\1$/, '$2');
    if (v && URLISH.test(v) && !/\s/.test(v)) regions.push([valueAt, end, addressKind(v)]);
    else if (/[<`]|\]\(/.test(raw)) regions.push(...markupRegions(raw, valueAt));
    fields.push([pos, end + 1, top ? humanize(top) : 'Fields']);
    pos = end + 1;
  }
}

/** JSON: walk the tokens; a key's name is a `key`; a string value is plain text, an address, or Markdown/HTML. */
function jsonPlaces(text, regions, fields) {
  const path = [];
  const re = /"(?:[^"\\]|\\.)*"|[{}[\],:]/g;
  const stack = [];
  let lastKey = null;
  for (const m of text.matchAll(re)) {
    const t = m[0];
    if (t === '{' || t === '[') {
      stack.push(t);
      path.push(t === '{' ? lastKey : null);
      lastKey = null;
      continue;
    }
    if (t === '}' || t === ']') {
      stack.pop();
      path.pop();
      continue;
    }
    if (t[0] !== '"') continue;
    const after = /^\s*:/.test(text.slice(m.index + t.length));
    if (after && stack.at(-1) === '{') {
      lastKey = JSON.parse(t);
      regions.push([m.index, m.index + t.length, 'key']);
      fields.push([m.index + 1, m.index + t.length - 1, 'Field name']);
      continue;
    }
    const s = m.index + 1;
    const e = m.index + t.length - 1;
    const label = [...path, lastKey].filter((k) => k !== null && k !== undefined).map(humanize).join(' › ') || 'Value';
    fields.push([s, e, label]);
    let v = '';
    try {
      v = JSON.parse(t);
    } catch {
      /* left as text */
    }
    if (v && URLISH.test(v.trim()) && !/\s/.test(v.trim())) regions.push([s, e, addressKind(v)]);
    else if (/[<`]|\]\(|https?:/.test(v)) regions.push(...markupRegions(text.slice(s, e), s));
    lastKey = stack.at(-1) === '{' ? null : lastKey;
  }
}

export function placesOf(text, { format = 'md' } = {}) {
  const regions = [];
  const fields = [];
  let headings = [];
  let bodyAt = 0;
  if (format === 'json') jsonPlaces(text, regions, fields);
  else {
    const fm = format === 'md' ? /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text) : null;
    bodyAt = fm ? fm[0].length : 0;
    if (fm) frontmatter(text, bodyAt, regions, fields);
    const body = markupRegions(text.slice(bodyAt), bodyAt);
    regions.push(...body);
    headings = headingsOf(text.slice(bodyAt), bodyAt, body);
  }

  const kindAt = (start, end) => {
    let best = 'text';
    for (const [s, e, k] of regions) if (s < Math.max(end, start + 1) && e > start && RANK[k] > RANK[best]) best = k;
    return best;
  };
  const fieldAt = (pos) => {
    const f = fields.find(([s, e]) => pos >= s && pos < e);
    if (f) return f[2];
    if (format === 'json') return 'Value';
    const h = headings.filter(([p]) => p <= pos).at(-1);
    return h ? `Body under heading “${h[1]}”` : 'Body';
  };
  /** The stretch a match's context may come from: its JSON string, front matter line, or paragraph. */
  const spanOf = (pos) => {
    const f = fields.find(([s, e]) => pos >= s && pos < e);
    if (f) return [f[0], Math.min(f[1], text.length)];
    const from = text.lastIndexOf('\n\n', pos);
    const to = text.indexOf('\n\n', pos);
    return [Math.max(from === -1 ? 0 : from + 2, bodyAt), to === -1 ? text.length : to];
  };
  const tidy = (s) => (format === 'json' ? s.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : s).replace(/\s+/g, ' ');
  const contextAt = (start, end) => {
    const [s, e] = spanOf(start);
    const before = tidy(text.slice(s, start)).split(' ');
    const after = tidy(text.slice(end, Math.max(e, end))).split(' ');
    // the first piece before (or last after) may be the rest of the matched word: it does not count as a word
    return {
      before: (before.length > WORDS + 1 ? '…' : '') + before.slice(-(WORDS + 1)).join(' ').trimStart(),
      after: after.slice(0, WORDS + 1).join(' ').trimEnd() + (after.length > WORDS + 1 ? '…' : ''),
    };
  };
  return { kindAt, fieldAt, contextAt };
}
