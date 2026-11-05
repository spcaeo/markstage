// Every URL a CommonMark (+GFM) renderer builds from a Markdown text: links (autolinks included), images and
// reference definitions. Read with the same parser the site's renderer uses (remark-parse + remark-gfm on
// micromark), so a link-scheme check on these can never disagree with what the site builds. The editor's own
// document keeps an autolink as text (`<javascript:x>` reads as the words), which is why a check on the document
// alone is not enough (security review 3 Nov 2026, S1).
import { bodyOf } from '../frontmatter.mjs';
import { mdxParser } from './mdx.mjs';
import { parser } from './parse.mjs';

const URL_NODES = new Set(['link', 'image', 'definition']);
// in MDX, a literal href, src or url of any JSX element is a URL the page gets too
const URL_ATTR = /^(href|src|url)$/i;

/**
 * The URLs (as the renderer decodes them: entities and escapes resolved) of a Markdown text, frontmatter skipped.
 * `mdx`: the text is MDX (read with the MDX reader; an MDX file it cannot read has no URLs to give: it is refused
 * by the save itself).
 */
export function markdownUrls(text, { mdx = false } = {}) {
  const out = [];
  const walk = (node, depth) => {
    if (!node || depth > 400) return;
    if (URL_NODES.has(node.type) && typeof node.url === 'string') out.push(node.url);
    for (const a of node.attributes ?? []) if (a.type === 'mdxJsxAttribute' && URL_ATTR.test(a.name ?? '') && typeof a.value === 'string') out.push(a.value);
    for (const kid of node.children ?? []) walk(kid, depth + 1);
  };
  const body = bodyOf(String(text ?? ''));
  let tree;
  try {
    tree = (mdx ? mdxParser : parser).parse(body);
  } catch {
    return out;
  }
  walk(tree, 0);
  return out;
}
