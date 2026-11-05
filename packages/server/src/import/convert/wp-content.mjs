// A WordPress post's content as plain HTML, ready for the one HTML-to-Markdown step (convert/html.mjs):
//   - Gutenberg blocks: their comments read with indexOf (never a regular expression over the whole text); static
//     blocks keep their HTML, an embed becomes a link, a block WordPress draws on the fly (latest posts, a search
//     box) or one we do not know without HTML becomes an "Import note:" paragraph, and each is noted;
//   - the classic editor's text: paragraphs from its blank lines, as WordPress's wpautop makes them;
//   - shortcodes: [caption] a figure with its caption, [gallery] its pictures, [embed], [video], [audio] a link;
//     any other a placeholder, noted with what it said.
// Pure.
import { escHtml, placeholder } from './bundle.mjs';

// blocks whose saved HTML is the content
const STATIC = new Set(['paragraph', 'heading', 'list', 'list-item', 'image', 'quote', 'pullquote', 'code', 'preformatted', 'verse', 'table', 'separator', 'gallery', 'columns', 'column', 'group', 'row', 'stack', 'buttons', 'button', 'spacer', 'html', 'shortcode', 'cover', 'media-text', 'video', 'audio', 'file', 'details', 'freeform', 'missing', 'footnotes', 'text-columns', 'more', 'nextpage', 'subhead']);
// blocks WordPress draws when the page is asked for: nothing of them is in the saved text
const DYNAMIC = new Set(['latest-posts', 'archives', 'categories', 'calendar', 'tag-cloud', 'search', 'rss', 'latest-comments', 'page-list', 'social-links', 'social-link', 'navigation', 'query', 'post-template', 'loginout', 'comments', 'site-title', 'site-logo', 'site-tagline', 'post-title', 'post-content', 'post-date', 'post-excerpt', 'post-featured-image', 'post-author', 'template-part', 'pattern', 'avatar', 'home-link', 'read-more']);
const SHORTCODES = new Set(['caption', 'wp_caption', 'gallery', 'embed', 'video', 'audio', 'playlist']);
const MAX_SHORTCODES = 2000;
const CLOSE_WINDOW = 200_000;

const parseAttrs = (json) => {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
const coreName = (name) => (name.startsWith('core/') ? name.slice(5) : name.includes('/') ? null : name);
const link = (url, words) => `<p><a href="${escHtml(url)}">${escHtml(words)}</a></p>`;
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'another site';
  }
};

/** Gutenberg's block comments out of the text, each block handled as above. */
function blocks(content, notes) {
  let out = '';
  let at = 0;
  const open = [];
  for (;;) {
    const c = content.indexOf('<!--', at);
    if (c < 0) {
      out += content.slice(at);
      break;
    }
    const e = content.indexOf('-->', c + 4);
    if (e < 0) {
      out += content.slice(at);
      break;
    }
    out += content.slice(at, c);
    at = e + 3;
    const inside = content.slice(c + 4, e).trim();
    const m = /^(\/)?wp:([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)(?:\s+(\{[\s\S]*\}))?\s*(\/)?$/.exec(inside);
    if (!m) continue; // a plain comment (<!--more--> too) is dropped
    const [, closing, name, json, self] = m;
    const core = coreName(name);
    if (closing) {
      const i = open.map((b) => b.name).lastIndexOf(name);
      if (i < 0) continue;
      const b = open[i];
      open.length = i;
      if (core === 'embed' || name.startsWith('core-embed/')) {
        const url = b.attrs.url || /https?:\/\/[^\s"<>]+/.exec(out.slice(b.start))?.[0];
        out = out.slice(0, b.start);
        if (url) {
          notes.push({ kind: 'embed', text: `An embed from ${hostOf(url)} is a link now: ${String(url).slice(0, 200)}` });
          out += link(url, `Embedded content: ${hostOf(url)}`);
        } else out += placeholder(notes, 'embed', 'An embed with no address was left out.');
      } else if (core === 'html') {
        if (/<(script|iframe|form|style|object|embed)\b/i.test(out.slice(b.start))) notes.push({ kind: 'html', text: 'A Custom HTML block had a script, a form or an embed; only its text and links came in. Check it.' });
      } else if (core === 'spacer') out = out.slice(0, b.start);
      else if (!core || (!STATIC.has(core) && !DYNAMIC.has(core))) notes.push({ kind: 'block', text: `The block “${name}” came in from its HTML. Check how it reads.` });
      continue;
    }
    const attrs = parseAttrs(json);
    if (self) {
      if (core === 'block') out += placeholder(notes, 'block', `A reusable block (WordPress ${attrs.ref ?? '?'}) is not part of this text: import the reusable blocks into the Library and insert it here.`, `a reusable block (WordPress ${attrs.ref ?? '?'}) was here.`);
      else if (core && DYNAMIC.has(core)) out += placeholder(notes, 'block', `The block “${name}” is drawn by WordPress when the page is shown, so there is nothing to bring over.`, `the WordPress block “${name}” was here.`);
      else if (core && STATIC.has(core)) continue;
      else out += placeholder(notes, 'block', `The block “${name}” could not be converted (it has no HTML of its own).`, `the block “${name}” was here and could not be converted.`);
      continue;
    }
    open.push({ name, attrs, start: out.length });
  }
  return out;
}

/**
 * Text kept out of a step (a <pre> out of the paragraphs, <code> and <pre> out of the shortcodes), found with
 * indexOf: [text with markers, pieces]. `mark` is the marker's character; restore() puts the pieces back.
 */
function protect(t, tag, mark = '\u0000') {
  const pieces = [];
  let out = '';
  let at = 0;
  const lower = t.toLowerCase();
  for (;;) {
    const s = lower.indexOf(`<${tag}`, at);
    if (s < 0) break;
    // <code> but not <codex>: the name ends at a space, > or /
    if (!/[\s>/]/.test(lower[s + tag.length + 1] ?? '')) {
      out += t.slice(at, s + 1);
      at = s + 1;
      continue;
    }
    const e = lower.indexOf(`</${tag}>`, s);
    if (e < 0) break;
    out += `${t.slice(at, s)}${mark}${pieces.length}${mark}`;
    pieces.push(t.slice(s, e + tag.length + 3));
    at = e + tag.length + 3;
  }
  return [out + t.slice(at), pieces];
}
const restore = (t, pieces, mark = '\u0000') => t.replace(new RegExp(`${mark}(\\d+)${mark}`, 'g'), (m, i) => pieces[Number(i)] ?? '');

const BLOCK_START = /^<\/?(?:table|thead|tfoot|caption|col|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|form|blockquote|address|p|h[1-6]|hr|section|article|aside|header|footer|nav|figure|figcaption|details|summary|iframe|video|audio|script|style)\b/i;

/** The classic editor's text with its paragraphs made: a blank line ends one, a line break inside is a <br>. */
export function autop(text) {
  const [t, pres] = protect(String(text ?? '').replace(/\r\n?/g, '\n'), 'pre');
  const out = t
    .split(/\n[ \t]*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (BLOCK_START.test(chunk) || /^\u0000\d+\u0000$/.test(chunk) || /^\[(?:caption|wp_caption|gallery|embed|video|audio|playlist)\b/i.test(chunk) ? chunk : `<p>${chunk.replace(/[ \t]*\n[ \t]*/g, '<br>')}</p>`))
    .join('\n\n');
  return restore(out, pres);
}

/** A shortcode's attributes: {name: value}, and the bare values in order under `_`. */
export function shortAttrs(raw) {
  const out = { _: [] };
  for (const m of String(raw ?? '').matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))|"([^"]*)"|(\S+)/g)) {
    if (m[1]) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    else out._.push(m[5] ?? m[6]);
  }
  return out;
}

/**
 * Shortcodes as HTML (see the top). `attachment(id)`: {url, alt, caption} of an attachment, or null;
 * `children()`: the post's own attached pictures, for a gallery with no ids.
 */
export function shortcodes(html, opts) {
  // code is shown as written: a [name] in it (a pattern, a URL template) is words, never a shortcode
  const [noPre, pres] = protect(String(html ?? ''), 'pre', '\u0001');
  const [bare, codes] = protect(noPre, 'code', '\u0002');
  return restore(restore(shortcodesIn(bare, opts), codes, '\u0002'), pres, '\u0001');
}

function shortcodesIn(html, { notes, attachment = () => null, children = () => [] }) {
  let out = '';
  let at = 0;
  let count = 0;
  for (;;) {
    const i = html.indexOf('[', at);
    if (i < 0 || count >= MAX_SHORTCODES) {
      out += html.slice(at);
      break;
    }
    out += html.slice(at, i);
    const re = /\[(\[?)([A-Za-z][\w-]*)((?:\s[^[\]]{0,2000})?)(\/?)\](\]?)/y;
    re.lastIndex = i;
    const m = re.exec(html);
    if (!m) {
      out += '[';
      at = i + 1;
      continue;
    }
    const [all, esc, name, rawAttrs, selfClosed, escEnd] = m;
    // a bracket with an HTML tag in it (outside quoted values) is words across a link, never a shortcode
    if (/[<>]/.test(rawAttrs.replace(/"[^"]*"|'[^']*'/g, ''))) {
      out += '[';
      at = i + 1;
      continue;
    }
    at = i + all.length;
    if (esc && escEnd) {
      out += all.slice(1, -1); // [[name]] is the words "[name]"
      continue;
    }
    const lname = name.toLowerCase();
    const attrs = shortAttrs(rawAttrs);
    let inner = null;
    if (!selfClosed) {
      const close = html.indexOf(`[/${name}]`, at);
      if (close >= 0 && close - at <= CLOSE_WINDOW) {
        inner = html.slice(at, close);
        at = close + name.length + 3;
      }
    }
    const looks = SHORTCODES.has(lname) || inner !== null || /=/.test(rawAttrs) || /[_-]/.test(name);
    if (!looks) {
      out += all;
      continue;
    }
    count++;
    out += one(lname, name, attrs, inner, all);
  }
  return out;

  function one(lname, name, attrs, inner, raw) {
    if (lname === 'caption' || lname === 'wp_caption') {
      const body = inner ?? '';
      const img = /<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>|<img\b[^>]*>/i.exec(body)?.[0] ?? '';
      const words = (attrs.caption ?? body.replace(img, '')).trim();
      return `<figure>${img}${words ? `<figcaption>${words}</figcaption>` : ''}</figure>`;
    }
    if (lname === 'gallery') {
      const ids = String(attrs.ids ?? attrs.include ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const list = ids.length ? ids.map((id) => attachment(id)).filter(Boolean) : children();
      if (!list.length) return placeholder(notes, 'shortcode', 'A [gallery] with no pictures we could find was left out.', 'a gallery was here; its pictures were not found.');
      if (ids.length && list.length < ids.length) notes.push({ kind: 'shortcode', text: `A [gallery] names ${ids.length} pictures; ${list.length} were found in the export.` });
      return `<figure>${list.map((a) => `<img src="${escHtml(a.url)}" alt="${escHtml(a.alt ?? '')}">`).join('')}</figure>`;
    }
    if (lname === 'embed') {
      const url = (attrs.src ?? attrs.url ?? inner ?? '').trim();
      if (!/^https?:\/\//i.test(url)) return placeholder(notes, 'shortcode', 'An [embed] with no address was left out.', 'an embed was here.');
      notes.push({ kind: 'embed', text: `An [embed] of ${hostOf(url)} is a link now: ${url.slice(0, 200)}` });
      return link(url, `Embedded content: ${hostOf(url)}`);
    }
    if (lname === 'video' || lname === 'audio' || lname === 'playlist') {
      const url = ['src', 'mp4', 'm4v', 'webm', 'ogv', 'mp3', 'ogg', 'wav', 'm4a'].map((k) => attrs[k]).find((v) => v && /^https?:\/\//i.test(v));
      if (!url) return placeholder(notes, 'shortcode', `A [${lname}] was left out (no file address).`, `a ${lname} was here.`);
      notes.push({ kind: 'shortcode', text: `A [${lname}] is a link to its file now (sound and video files are not brought into the media library): ${url.slice(0, 200)}` });
      return link(url, `${lname === 'audio' ? 'Audio' : 'Video'}: ${url.split('/').pop()}`);
    }
    const said = raw.length > 200 ? `${raw.slice(0, 197)}…` : raw;
    const ph = placeholder(notes, 'shortcode', `The shortcode ${said} could not be converted.`, `the WordPress shortcode “${name}” was here and could not be converted.`);
    // an enclosing shortcode's words are content: kept after the note, their own shortcodes read too
    return inner ? `${ph}${shortcodes(inner, { notes, attachment, children })}` : ph;
  }
}

/** A post's content (Gutenberg or classic) as HTML, with the notes of what could not be converted. */
export function wpContentToHtml(content, { attachment, children } = {}) {
  const notes = [];
  const text = String(content ?? '');
  const html = text.includes('<!-- wp:') ? blocks(text, notes) : autop(text);
  return { html: shortcodes(html, { notes, attachment, children }), notes };
}
