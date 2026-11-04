// Every URL a CommonMark (+GFM) renderer builds from a Markdown text: links (autolinks included), images and
// reference definitions. Read with the same parser the site's renderer uses (remark-parse + remark-gfm on
// micromark), so a link-scheme check on these can never disagree with what the site builds. The editor's own
// document keeps an autolink as text (`<javascript:x>` reads as the words), which is why a check on the document
// alone is not enough (security review 3 Nov 2026, S1).
import { bodyOf } from '../frontmatter.mjs';
import { parser } from './parse.mjs';

const URL_NODES = new Set(['link', 'image', 'definition']);

/** The URLs (as the renderer decodes them: entities and escapes resolved) of a Markdown text, frontmatter skipped. */
export function markdownUrls(text) {
  const out = [];
  const walk = (node, depth) => {
    if (!node || depth > 400) return;
    if (URL_NODES.has(node.type) && typeof node.url === 'string') out.push(node.url);
    for (const kid of node.children ?? []) walk(kid, depth + 1);
  };
  walk(parser.parse(bodyOf(String(text ?? ''))), 0);
  return out;
}
