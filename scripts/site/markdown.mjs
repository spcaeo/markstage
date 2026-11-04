// Markdown to HTML for the public site: the repo's docs/*.md and site-content/*.md. Parsed by remark (remark-parse
// and remark-gfm, which @markstage/core already depends on), rendered here so the output is small and predictable:
// headings get ids, tables keep their alignment (numbers right-aligned), code keeps its language, and raw HTML is
// kept only for a short allow-list of tags (anchors with an id, kbd, sub, sup, br, details, summary).
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { parse as parseYaml } from 'yaml';

const parser = unified().use(remarkParse).use(remarkGfm);

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `{ meta, body }` from a file that may start with a `---` YAML front matter block. */
export function parseFrontMatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta = parseYaml(match[1]) ?? {};
  for (const [k, v] of Object.entries(meta)) if (v instanceof Date) meta[k] = v.toISOString().slice(0, 10);
  return { meta, body: source.slice(match[0].length) };
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The plain text of an mdast node. */
export function textOf(node) {
  if (!node) return '';
  if (node.type === 'html') return '';
  if ('value' in node && typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(textOf).join('');
}

const ALLOWED = /^<\/?(kbd|sub|sup|br|details|summary|code|em|strong|b|i)\s*\/?>$/i;
const ANCHOR = /^<a\s+id="([A-Za-z0-9_-]+)"\s*>(?:\s*<\/a>)?$/i;
// a number, an amount or a measure (not an address like 127.0.0.1, not a range)
const NUMBER = /^[-+]?[$€£]?\d[\d,]*(\.\d+)?\s?(%|ms|s|KB|MB|GB|px|h|min|days?)?$/;
const EMPTY = /^(|—|-|n\/a)$/i;

/**
 * Markdown to `{ html, title, headings, faq, sections }`.
 * - `title`: the first `#` heading (the page draws its own H1, so it is not rendered).
 * - `shift`: added to each heading level (## is h2 with 0); levels never jump by more than one, and never go below 2.
 * - `link(href)`: rewrites link targets (relative repo paths to site pages or GitHub).
 * - `faq`: the `###` questions under a `## Common questions` / `## FAQ` heading, with their answers as plain text.
 * - `sections`: every `##` heading with its `###` items, each with its text and HTML (the glossary and FAQ files);
 *   a `##` with no `###` under it keeps its own text and HTML, for files with one `##` per entry.
 */
export function renderMarkdown(body, { shift = 0, link = (href) => href } = {}) {
  const tree = parser.parse(body);
  const ids = new Set();
  const headings = [];
  const sections = [];
  let title = null;
  let lastLevel = 1;
  let inFaq = false;
  let current = null;
  const faq = [];

  const uniqueId = (text) => {
    const base = slugify(text) || 'section';
    let id = base;
    for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
    ids.add(id);
    return id;
  };
  // ids the Markdown sets itself (<a id="x"></a>) are taken first, so a heading never clashes with them
  for (const m of body.matchAll(/<a\s+id="([A-Za-z0-9_-]+)"/gi)) ids.add(m[1]);
  // footnotes ([^x]) are numbered in the order they are defined; each reference links to its numbered source
  const notes = new Map();
  for (const n of tree.children) {
    if (n.type !== 'footnoteDefinition' || notes.has(n.identifier)) continue;
    const id = `fn-${slugify(n.identifier) || notes.size + 1}`;
    ids.add(id);
    notes.set(n.identifier, { id, number: notes.size + 1 });
  }

  const inline = (nodes) => nodes.map(inlineNode).join('');
  function inlineNode(n) {
    switch (n.type) {
      case 'text':
        return escapeHtml(n.value);
      case 'emphasis':
        return `<em>${inline(n.children)}</em>`;
      case 'strong':
        return `<strong>${inline(n.children)}</strong>`;
      case 'delete':
        return `<del>${inline(n.children)}</del>`;
      case 'inlineCode':
        return `<code>${escapeHtml(n.value)}</code>`;
      case 'break':
        return '<br />';
      case 'link': {
        const href = link(n.url);
        const outside = /^https?:/.test(href);
        return `<a href="${escapeHtml(href)}"${outside ? ' rel="noopener"' : ''}>${inline(n.children)}</a>`;
      }
      case 'image':
        return `<img src="${escapeHtml(link(n.url))}" alt="${escapeHtml(n.alt ?? '')}" loading="lazy" decoding="async" />`;
      case 'html': {
        const v = n.value.trim();
        const a = ANCHOR.exec(v);
        if (a) return `<a id="${a[1]}"></a>`;
        if (v === '</a>') return '';
        return ALLOWED.test(v) ? v.toLowerCase() : '';
      }
      case 'footnoteReference': {
        const note = notes.get(n.identifier);
        return note ? `<sup class="fn"><a href="#${note.id}" aria-label="Source ${note.number}">${note.number}</a></sup>` : '';
      }
      default:
        return n.children ? inline(n.children) : escapeHtml(n.value ?? '');
    }
  }

  function heading(n) {
    const text = textOf(n).trim();
    if (n.depth === 1 && title === null) {
      title = text;
      return '';
    }
    let level = Math.max(2, n.depth + shift);
    level = Math.min(level, lastLevel + 1, 6);
    lastLevel = level;
    const id = uniqueId(text);
    headings.push({ level, text, id });
    if (n.depth <= 2) {
      inFaq = /common questions|^faq|frequently asked/i.test(text);
      current = { title: text, id, items: [], text: [], html: [] };
      sections.push(current);
    } else if (n.depth === 3) {
      const item = { title: text, id, text: [], html: [] };
      current ??= (sections.push({ title: '', id: '', items: [], text: [], html: [] }), sections.at(-1));
      current.items.push(item);
      if (inFaq) faq.push(item);
    }
    return `<h${level} id="${id}">${inline(n.children)}</h${level}>`;
  }

  function table(n) {
    const align = n.align ?? [];
    const [head, ...rows] = n.children;
    // a column is numeric (right-aligned, tabular digits) when every filled cell under its heading is a number
    const numeric = head.children.map((_, i) => {
      const texts = rows.map((r) => textOf(r.children[i] ?? { value: '' }).trim()).filter((t) => !EMPTY.test(t));
      return texts.length > 0 && texts.every((t) => NUMBER.test(t));
    });
    const cell = (c, i, tag) => {
      const cls = numeric[i] || align[i] === 'right' ? ' class="num"' : align[i] === 'center' ? ' class="center"' : '';
      const scope = tag === 'th' ? ' scope="col"' : '';
      return `<${tag}${scope}${cls}>${inline(c.children)}</${tag}>`;
    };
    const thead = `<thead><tr>${head.children.map((c, i) => cell(c, i, 'th')).join('')}</tr></thead>`;
    const tbody = `<tbody>${rows.map((r) => `<tr>${r.children.map((c, i) => cell(c, i, 'td')).join('')}</tr>`).join('')}</tbody>`;
    return `<div class="table-wrap"><table>${thead}${tbody}</table></div>`;
  }

  function block(n) {
    switch (n.type) {
      case 'heading':
        return heading(n);
      case 'paragraph': {
        const html = inline(n.children);
        return html.trim() ? `<p>${html}</p>` : '';
      }
      case 'list': {
        const tag = n.ordered ? 'ol' : 'ul';
        const start = n.ordered && n.start && n.start !== 1 ? ` start="${n.start}"` : '';
        const items = n.children.map((li) => {
          const parts = li.children.map((c) => (c.type === 'paragraph' && !n.spread ? inline(c.children) : block(c)));
          return `<li>${parts.join('\n')}</li>`;
        });
        return `<${tag}${start}>${items.join('')}</${tag}>`;
      }
      case 'blockquote':
        return `<blockquote>${n.children.map(block).join('\n')}</blockquote>`;
      case 'code': {
        const lang = n.lang ? ` class="language-${escapeHtml(n.lang)}"` : '';
        return `<pre${n.lang ? ` data-lang="${escapeHtml(n.lang)}"` : ''}><code${lang}>${escapeHtml(n.value)}</code></pre>`;
      }
      case 'table':
        return table(n);
      case 'thematicBreak':
        return '<hr />';
      case 'html': {
        const v = n.value.trim();
        if (v.startsWith('<!--')) return '';
        const a = ANCHOR.exec(v);
        return a ? `<a id="${a[1]}"></a>` : '';
      }
      case 'definition':
      case 'footnoteDefinition':
        return '';
      default:
        return n.children ? n.children.map(block).join('\n') : '';
    }
  }

  const out = [];
  let sources = [];
  const flushSources = () => {
    if (sources.length) out.push(`<ol class="sources">${sources.join('')}</ol>`);
    sources = [];
  };
  for (const n of tree.children) {
    if (n.type === 'footnoteDefinition') {
      const note = notes.get(n.identifier);
      const parts = n.children.map((c) => (c.type === 'paragraph' ? inline(c.children) : block(c)));
      sources.push(`<li id="${note.id}" value="${note.number}">${parts.join(' ')}</li>`);
      continue;
    }
    flushSources();
    const html = block(n);
    if (html) out.push(html);
    // the text under the latest ### item, or under the ## when it has none yet (glossary definitions, FAQ answers)
    const into = current?.items.length ? current.items.at(-1) : current;
    if (n.type !== 'heading' && into) {
      const text = textOf(n).trim();
      if (text) into.text.push(text);
      if (html) into.html.push(html);
    }
  }
  flushSources();
  const join = (item) => ({ ...item, text: item.text.join(' ').replace(/\s+/g, ' ').trim(), html: item.html.join('\n') });
  return {
    html: out.join('\n'),
    title,
    headings,
    faq: faq.map((q) => ({ question: q.title, answer: join(q).text, id: q.id })),
    sections: sections.map((s) => ({ ...join(s), items: s.items.map(join) })),
  };
}

/** Markdown inline text without its marks, for titles and descriptions. */
export function plain(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}
