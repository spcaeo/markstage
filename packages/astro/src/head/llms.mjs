// llms.txt (llmstxt.org: "# <siteName>", a "> " summary line, then "## Pages" with
// "- [Title](<Markdown copy URL>): description") and llms-full.txt (every page's Markdown, one after another,
// separated by "\n\n---\n\n"), from the same docs as the Markdown copies (head/index.mjs).
//   llmsFiles(docs, {siteName, siteUrl}) -> [{path: '/llms.txt', text}, {path: '/llms-full.txt', text}]
// The summary line is the home page's description (else a plain sentence). A short "## Optional" section points at
// llms-full.txt. `copies: false` (the site makes no Markdown copies) links each page's own address instead of a
// copy that is not there.
import { markdownPath } from '@markstage/core/head';
import { pageUrl } from './urls.mjs';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// link text: a backslash or bracket in a title is escaped, so it cannot close the link early
const label = (s) => s.replace(/([\\[\]])/g, '\\$1');

export function llmsFiles(docs, { siteName = '', siteUrl = '', copies = true } = {}) {
  const origin = String(siteUrl).replace(/\/+$/, '');
  const host = origin.replace(/^https?:\/\//, '');
  const name = one(siteName) || host || 'Site';
  const home = docs.find((d) => d.page.path === '/');
  const summary = one(home?.page.description) || `The pages of ${name} as Markdown, for AI tools.`;
  const rows = docs.map(({ page }) => {
    const title = one(page.title) || page.path;
    const url = copies ? pageUrl(origin, markdownPath(page.path)) : page.canonical;
    return `- [${label(title)}](${url})${one(page.description) ? `: ${one(page.description)}` : ''}`;
  });
  const txt = [`# ${name}`, `> ${summary}`, `## Pages\n\n${rows.join('\n')}`, `## Optional\n\n- [All pages in one file](${origin}/llms-full.txt)`].join('\n\n');
  const full = docs.map((d) => d.markdown.trim()).join('\n\n---\n\n');
  return [
    { path: '/llms.txt', text: `${txt}\n` },
    { path: '/llms-full.txt', text: `${full}\n` },
  ];
}
