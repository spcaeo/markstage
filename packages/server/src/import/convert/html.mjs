// HTML from any source (WordPress blocks and the classic editor, Ghost cards, Prismic rich text, each turned into
// HTML first) as clean Markdown, through the Library's tolerant reader and writer (library/html.mjs), so one set of
// rules decides what passes: scripts, styles, forms and SVG are dropped, links keep http(s), mailto, tel or a path.
// Before writing, the tree is tidied: a lazy-loaded image gets its real address, an iframe or a video player becomes a
// link to what it showed (noted), and a source's own cards can be swapped by `transform`. For an MDX collection
// (`mdx`), text is escaped as MDX needs and a site's converter rules (convert/rules.mjs) turn old patterns into
// components. Pure.
import { parseHtml, safeUrl, textOf, toMarkdown } from '../../library/html.mjs';
import { mdMarker } from './bundle.mjs';
import { importsOf, rulesTransform } from './rules.mjs';

const PLAYERS = new Set(['iframe', 'video', 'audio', 'embed', 'object']);
const LEFT_OUT = /<(script|style|form|svg|canvas|object|noscript)\b/gi;
const LEFT_WORDS = { script: 'a script', style: 'a style block', form: 'a form', svg: 'an SVG drawing', canvas: 'a canvas', object: 'an embedded object', noscript: 'a noscript block' };

// what a chat assistant leaves in text copied from it: ":contentReference[oaicite:0]{index=0}"
const CITE_LEFTOVER = /\s?:contentReference\[oaicite:\d{1,4}\]\{index=\d{1,4}\}/g;
const ruleMarker = (n) => `MSMDXRULE${n}X`;

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'another site';
  }
};

/** The address an image really shows: a lazy-loading plugin keeps it in data-src (and a placeholder in src). */
function realSrc(attrs) {
  const src = attrs.src ?? '';
  const lazy = attrs['data-src'] || attrs['data-lazy-src'] || attrs['data-original'] || attrs['data-orig-file'];
  if (lazy && (!src || src.startsWith('data:') || /placeholder|blank\.gif|lazy/i.test(src))) return lazy;
  return src;
}

/** The address a player shows: its src, or its first <source>. */
function playerSrc(n) {
  if (n.attrs.src || n.attrs.data) return n.attrs.src || n.attrs.data;
  const s = (n.children ?? []).find((c) => c.tag === 'source' && c.attrs.src);
  return s ? s.attrs.src : '';
}

const linkPara = (href, words) => ({ tag: 'p', attrs: {}, children: [{ tag: 'a', attrs: { href }, children: [{ text: words }] }] });

/** Walk the tree, tidying it in place: lazy images, players as links, a source's cards (transform). */
function tidy(node, { base, note, transform }) {
  const kids = node.children ?? [];
  for (let i = 0; i < kids.length; i++) {
    let c = kids[i];
    if (!c.tag) continue;
    const swapped = transform?.(c, { note });
    if (swapped !== undefined) {
      if (swapped === null) {
        kids.splice(i--, 1);
        continue;
      }
      kids[i] = c = swapped;
    }
    if (c.tag === 'img') {
      c.attrs.src = realSrc(c.attrs);
      continue;
    }
    // a toggle's question (<details><summary>, an FAQ) stays a question: a bold line above its answer
    if (c.tag === 'summary') {
      kids[i] = { tag: 'p', attrs: {}, children: [{ tag: 'strong', attrs: {}, children: c.children ?? [] }] };
      continue;
    }
    if (c.tag === 'details') c.tag = 'div';
    if (PLAYERS.has(c.tag)) {
      const src = safeUrl(playerSrc(c), base);
      const what = c.tag === 'iframe' || c.tag === 'embed' || c.tag === 'object' ? 'embed' : c.tag;
      if (src && /^https?:/.test(src)) {
        note('embed', `An embedded ${what === 'embed' ? 'player' : what} from ${host(src)} is a link now: ${src.slice(0, 200)}`);
        kids[i] = linkPara(src, `${what === 'video' ? 'Video' : what === 'audio' ? 'Audio' : 'Embedded content'}: ${host(src)}`);
      } else {
        note('embed', `An embedded ${what === 'embed' ? 'player' : what} with no address was left out.`);
        kids.splice(i--, 1);
      }
      continue;
    }
    tidy(c, { base, note, transform });
  }
}

/**
 * HTML as Markdown: {markdown, notes, components}. `image(url, node)` gives the address an image is written with (a
 * media:<id> token, its URL, or null to leave it out) and may set node.attrs.alt; `link(url)` the address a link is
 * written with. `transform(node, {note})` may return a replacement node, null to drop it, or undefined to leave it.
 * `markdown` are the Markdown pieces the html's MSMDCARD<n>X markers stand for (a Ghost Markdown card), put in place as
 * they are. `mdx`: the text goes into an .mdx file; `rules` (checked by convert/rules.mjs) then turn the wrappers they
 * match into components, with the import lines they need at the top; `components` counts them by name.
 */
export function htmlToMarkdown(html, { base, image = (u) => u, link = (u) => u, transform, markdown = [], mdx = false, rules = null } = {}) {
  const notes = [];
  const note = (kind, text) => notes.push({ kind, text });
  const seen = {};
  let source = String(html);
  const cites = source.match(CITE_LEFTOVER)?.length ?? 0;
  if (cites) {
    source = source.replace(CITE_LEFTOVER, '');
    note('text', `${cites === 1 ? 'A citation marker' : `${cites} citation markers`} left by a chat assistant (“:contentReference[oaicite:…]”) ${cites === 1 ? 'was' : 'were'} taken out of the text.`);
  }
  for (const m of source.matchAll(LEFT_OUT)) seen[m[1].toLowerCase()] = (seen[m[1].toLowerCase()] ?? 0) + 1;
  // structured data for search engines (an SEO plugin's FAQ or article schema) is not code that runs on the page
  const ld = [...source.matchAll(/<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json/gi)].length;
  if (ld) {
    note('html', `Structured data for search engines (${ld === 1 ? 'a JSON-LD block' : `${ld} JSON-LD blocks`}) was left out. Add it in the site's templates if the page needs it.`);
    seen.script -= ld;
    if (!seen.script) delete seen.script;
  }
  for (const [tag, n] of Object.entries(seen)) note('html', `${n === 1 ? LEFT_WORDS[tag][0].toUpperCase() + LEFT_WORDS[tag].slice(1) : `${n} × ${LEFT_WORDS[tag]}`} in the old text ${n === 1 ? 'was' : 'were'} left out (nothing that runs comes in).`);
  const root = parseHtml(source);
  const write = (n) => toMarkdown(n, { base, src: image, link, mdx });
  const pieces = [];
  const used = new Map();
  let steps = transform;
  if (mdx && rules?.rules?.length) {
    const href = (h) => {
      const own = String(h ?? '').trim();
      if (/^#[^\s<>"'`]+$/.test(own)) return own;
      const safe = safeUrl(h, base);
      return safe ? link(safe) ?? null : null;
    };
    // a prop's Markdown is the part tidied as the rest is (lazy pictures, players, toggles), then written
    const mdWith = (t) => (n) => {
      const box = structuredClone({ tag: 'div', attrs: {}, children: [n] });
      tidy(box, { base, note, transform: t });
      return write(box);
    };
    // a component's children may hold other rules' components (their markers are put in place last to first)
    const byRule = rulesTransform(rules, { md: mdWith(transform), mdNested: (n) => mdWith(steps)(n), image, link, href, src: (img) => safeUrl(realSrc(img.attrs), base), note, pieces, used, marker: ruleMarker });
    steps = (n, ctx) => {
      const r = byRule(n);
      return r !== undefined ? r : transform?.(n, ctx);
    };
  }
  tidy(root, { base, note, transform: steps });
  let md = write(root);
  markdown.forEach((piece, i) => {
    md = md.split(mdMarker(i)).join(String(piece).trim());
  });
  for (let i = pieces.length - 1; i >= 0; i--) md = md.split(ruleMarker(i)).join(pieces[i]);
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  const imports = used.size ? importsOf(rules, used) : [];
  if (imports.length && md) md = `${imports.join('\n')}\n\n${md}`;
  return { markdown: md, notes, components: Object.fromEntries(used) };
}

/** The plain text of a little HTML (a title), through the same reader. */
export const htmlText = (html) => textOf(parseHtml(String(html ?? ''))).trim();
