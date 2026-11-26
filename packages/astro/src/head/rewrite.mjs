// Putting the head kit into one built page (head/index.mjs): its <link>s and the tracking loader at the end of
// <head>, the tag manager's <noscript> right after <body>, and, when the page carries its own
// <meta http-equiv="Content-Security-Policy"> (one or more), what the loader needs added to each policy
// (@markstage/core/csp), so the loader runs and nothing else does. A Report-Only meta is left alone (browsers ignore
// it in a meta). Every element the kit adds has data-markstage-head; a page whose <head> already holds such an
// element is left as it is, so running the build step twice changes nothing. Text in the body that merely names the
// attribute (a post about Markstage) does not count.
import { attrsOf, decode } from '@markstage/core/html-tree';
import { cspHashes, withCspSources } from '@markstage/core/csp';
import { pageUrl as abs } from './urls.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The <link>s for one page: its Markdown copy (when it has one), the OKF bundle, and every feed. */
export function headLinks({ siteUrl, markdown = null, okf = null, feeds = [] }) {
  const out = [];
  if (markdown) out.push(`<link rel="alternate" type="text/markdown" title="Markdown version of this page" href="${esc(abs(siteUrl, markdown))}" data-markstage-head>`);
  if (okf) out.push(`<link rel="alternate" type="text/markdown" title="OKF bundle" href="${esc(abs(siteUrl, okf))}" data-markstage-head>`);
  for (const f of feeds) out.push(`<link rel="alternate" type="application/rss+xml" title="${esc(f.title)}" href="${esc(abs(siteUrl, f.path))}" data-markstage-head>`);
  return out.join('');
}

const META = /<meta\b[^>]*>/gi;
const isPolicy = (tag) => (attrsOf(tag.slice(5).replace(/\/?>$/, ''))['http-equiv'] ?? '').trim().toLowerCase() === 'content-security-policy';

/** True when the page's head already holds an element the kit added. */
export function alreadyDone(html) {
  const end = html.search(/<\/head\s*>/i);
  const head = end < 0 ? html : html.slice(0, end);
  return /<[a-z][a-z0-9-]*\b[^>]*\sdata-markstage-head(?=[\s>=/])/i.test(head);
}

/** Every CSP meta of the page with the loader's needs added (the page as it is when there is nothing to add). */
function withPolicies(html, tags) {
  if (!tags.head) return html;
  const needs = cspHashes(tags.head + (tags.bodyStart ?? ''));
  const add = {
    ...needs,
    scriptOrigins: [...needs.scriptOrigins, ...(tags.csp?.scriptOrigins ?? [])],
    connectOrigins: tags.csp?.connectOrigins ?? [],
    imgOrigins: tags.csp?.imgOrigins ?? [],
    frameOrigins: tags.csp?.frameOrigins ?? [],
  };
  const end = html.search(/<\/head\s*>/i);
  const head = end < 0 ? html : html.slice(0, end);
  const rewritten = head.replace(META, (tag) => {
    if (!isPolicy(tag)) return tag;
    const content = tag.match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!content) return tag;
    const policy = decode(content[2] ?? content[3]);
    const next = withCspSources(policy, add);
    if (!next || next === policy) return tag;
    return tag.replace(content[0], `content="${esc(next)}"`);
  });
  return rewritten + html.slice(head.length);
}

/** The page with the kit's links and tags in (unchanged when there is nothing to add or they are already there). */
export function rewritePage(html, { links = '', tags = { head: '', bodyStart: '' } }) {
  if (alreadyDone(html)) return html;
  const head = links + (tags.head ?? '');
  if (!head && !tags.bodyStart) return html;
  if (html.search(/<\/head\s*>/i) < 0) return html;
  let out = withPolicies(html, tags);
  const at = out.search(/<\/head\s*>/i);
  out = out.slice(0, at) + head + out.slice(at);
  if (tags.bodyStart) out = out.replace(/<body\b[^>]*>/i, (b) => b + tags.bodyStart);
  return out;
}
