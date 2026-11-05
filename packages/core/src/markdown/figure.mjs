// The figure form of an image (a caption, a width class, the decorative mark), shared by parse.mjs and print.mjs:
//   <figure class="wide">
//
//   ![alt](src)
//
//   <figcaption>Caption</figcaption>
//   </figure>
// The image stays Markdown (sites process and optimise it as usual); the caption is plain text, HTML-escaped.

/** `<figure>` or `<figure class="…">` alone on its line: [1] is the class attribute. */
export const FIGURE_OPEN = /^<figure(?: class="([a-z0-9][a-z0-9 _-]*)")?>$/;
/** `</figure>`, after an optional `<figcaption>…</figcaption>` line: [1] is the caption as written. */
export const FIGURE_CLOSE = /^(?:<figcaption>([^<\n]*)<\/figcaption>\n)?<\/figure>$/;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const UNESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

export const escapeCaption = (text) => text.replace(/[&<>]/g, (c) => ESC[c]);
/** The caption's text, or undefined when it holds an entity the converter does not model (kept as raw HTML). */
export function unescapeCaption(html) {
  if (/&(?!amp;|lt;|gt;|quot;|#39;)/.test(html)) return undefined;
  return html.replace(/&(amp|lt|gt|quot|#39);/g, (e) => UNESC[e]);
}

/** The figure around an image's Markdown (`md`), from its attrs; `esc`: how the caption is written (MDX's own). */
export function printFigure(attrs, md, esc = escapeCaption) {
  const cls = attrs.figure ? ` class="${attrs.figure}"` : '';
  const cap = attrs.caption ? `<figcaption>${esc(attrs.caption)}</figcaption>\n` : '';
  return `<figure${cls}>\n\n${md}\n\n${cap}</figure>`;
}

/** An image written as a figure: it has a caption, or a figure class ('' keeps a plain figure). */
export const isFigure = (attrs) => attrs.figure != null || !!attrs.caption;
