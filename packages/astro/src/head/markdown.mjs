// One built page as clean Markdown for AI tools (head/index.mjs), through the tolerant reader and writer in
// @markstage/core/html-tree (scripts, styles, forms, nav and SVG are dropped there).
//   pageMarkdown(page, {main, siteUrl}) -> string
//   "# <title>\n\nCanonical: <canonical>\n\n> <description>\n\n<body>\n"; the body is the page's `main` element (a
//   simple selector: tag, #id, .class, [attr], [attr="v"], or a tag with those) or, when there is none, <body>
//   without header, footer, nav and aside; links and images absolute on siteUrl; an image without alt left out.
// What the page's components leave behind (details, iframes, link cards, custom elements, tables) is prepared in
// md-tree.mjs. The page's first <h1> is not repeated when it only says the title.
import { parseHtml, toMarkdown } from '@markstage/core/html-tree';
import { contentOf, dropTitleHeading } from './md-tree.mjs';
import { pageUrl as urlOf } from './urls.mjs';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function pageMarkdown(page, { main = 'main', siteUrl = '' } = {}) {
  const origin = String(siteUrl).replace(/\/+$/, '');
  const pageUrl = urlOf(origin, page.path ?? '/');
  const tree = contentOf(parseHtml(page.html ?? ''), { main, base: pageUrl, pageUrl });
  // with no <title>, the page's h1 is the title; otherwise an h1 that repeats the title is not said twice
  const title = one(page.title) || one(dropTitleHeading(tree, ''));
  if (one(page.title)) dropTitleHeading(tree, page.title);
  const body = toMarkdown(tree, { base: pageUrl }).replace(/\n{3,}/g, '\n\n').trim();
  const head = [`# ${title || one(page.canonical) || pageUrl}`, `Canonical: ${one(page.canonical) || pageUrl}`];
  if (one(page.description)) head.push(`> ${one(page.description)}`);
  return `${head.join('\n\n')}${body ? `\n\n${body}` : ''}\n`;
}
