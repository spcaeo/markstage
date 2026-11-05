// docs/COMPARISON.md as data, so /compare/, /compare/full/ and the alternatives pages draw their cards and tables
// from the one file and never retype a fact. parseComparison() reads the lead table ("Markstage vs WordPress, Ghost
// and Prismic"), Group A and Group B (one table per ### section) and the numbered sources; PRODUCTS adds what the
// file does not say in a table: each product's page slug, its kind and a one-line "what it is" (compare.test.mjs
// checks every product of the tables is here, and every kind against the tables).
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { escapeHtml as e, slugify, textOf } from './markdown.mjs';

const parser = unified().use(remarkParse).use(remarkGfm);

/** The marks of COMPARISON.md, with the word each badge shows beside its glyph. */
export const MARKS = {
  '✓': { key: 'yes', label: 'Yes' },
  '◐': { key: 'part', label: 'Partly' },
  '✗': { key: 'no', label: 'No' },
  '?': { key: 'unk', label: 'Not confirmed' },
  '–': { key: 'na', label: 'Does not apply' },
};
export const GLYPH = Object.fromEntries(Object.entries(MARKS).map(([g, m]) => [m.key, g]));

/**
 * The kinds the cards are grouped by, read off the tables: Group A (content as files in git) is "git"; in Group B,
 * a product whose Self-host cell is ✗ is "hosted"; WordPress and Ghost, which the file calls "mature publishing
 * platforms", are "publishing"; the rest of Group B, which you run yourself as an app, is "app".
 */
export const KINDS = [
  { id: 'publishing', title: 'Publishing platforms', one: 'Publishing platform', text: 'Mature platforms with their own admin and large communities. With Astro they are used headless: writers work in their admin, Astro reads the content by API.' },
  { id: 'git', title: 'Git-based editors', one: 'Git-based editor', text: 'Content stays as files in a git repository, like Markstage. They differ in where writers edit and what you have to run.' },
  { id: 'hosted', title: 'Hosted visual CMSs', one: 'Hosted CMS', text: 'Content lives in the vendor’s hosted database and Astro reads it by API. Nothing to run, and you pay as the team grows.' },
  { id: 'app', title: 'Self-hosted CMS apps', one: 'Self-hosted CMS app', text: 'A CMS you run yourself as its own app, most with a database next to it.' },
];

/** Every product of the tables: its name as the tables write it, its alternatives page and what it is, in a line. */
export const PRODUCTS = [
  { name: 'WordPress', slug: 'wordpress', kind: 'publishing', what: 'A publishing platform with a very large ecosystem of themes and plugins; headless with Astro.' },
  { name: 'Ghost', slug: 'ghost', kind: 'publishing', what: 'A publishing platform with newsletters, memberships and paid subscriptions built in; headless with Astro.' },
  { name: 'Prismic', slug: 'prismic', kind: 'hosted', what: 'A hosted page builder: nothing to run, and your developers build the sections (slices).' },
  { name: 'TinaCMS', slug: 'tinacms', kind: 'git', what: 'A git-based CMS with click-to-edit on Astro pages, hosted (TinaCloud) or self-hosted.' },
  { name: 'CloudCannon', slug: 'cloudcannon', kind: 'git', what: 'A hosted git-based CMS that edits regions on a preview of your built site.' },
  { name: 'Decap CMS', slug: 'decap-cms', kind: 'git', what: 'A single admin page that talks to your git host; no server of its own.' },
  { name: 'Sveltia CMS', slug: 'sveltia-cms', kind: 'git', what: 'A single-page admin over your git host, with a live preview beside the form.' },
  { name: 'Keystatic', slug: 'keystatic', kind: 'git', what: 'A typed admin for Markdown, Markdoc or MDX inside your Astro project.' },
  { name: 'Pages CMS', slug: 'pages-cms', kind: 'git', what: 'Forms with a rich-text editor over a GitHub repository, with email invites.' },
  { name: 'Front Matter CMS', slug: 'front-matter-cms', kind: 'git', what: 'A CMS inside VS Code, over the files on your own computer.' },
  { name: 'Outstatic', slug: 'outstatic', kind: 'git', what: 'A dashboard editor for Markdown and MDX that commits to GitHub.' },
  { name: 'Sitepins', slug: 'sitepins', kind: 'git', what: 'A WYSIWYG editor over your git files, with live cursors.' },
  { name: 'EmDash', slug: 'emdash', kind: 'app', what: 'A content database built on Astro, WordPress-style, with an admin.' },
  { name: 'StudioCMS', slug: 'studiocms', kind: 'app', what: 'A CMS built for Astro, with a dashboard and its own database.' },
  { name: 'Storyblok', slug: 'storyblok', kind: 'hosted', what: 'A hosted visual CMS: click a component on your site and its block opens.' },
  { name: 'Sanity', slug: 'sanity', kind: 'hosted', what: 'A customisable Studio on a hosted, real-time content database.' },
  { name: 'Contentful', slug: 'contentful', kind: 'hosted', what: 'A hosted content platform that Astro reads through its SDK.' },
  { name: 'Builder.io', slug: 'builder-io', kind: 'hosted', what: 'A hosted drag-and-drop visual editor on a preview page of your site.' },
  { name: 'Payload', slug: 'payload', kind: 'app', what: 'A Next.js app that is a CMS and an application backend, with its own database.' },
  { name: 'Strapi', slug: 'strapi', kind: 'app', what: 'A headless CMS server with an API, self-hosted or on Strapi Cloud.' },
  { name: 'Statamic', slug: 'statamic', kind: 'app', what: 'A Laravel (PHP) CMS that keeps its content in flat files.' },
];
export const MARKSTAGE = 'Markstage';
export const MARKSTAGE_WHAT = 'A visual editor for Astro: writers edit on the site’s real design; content stays Markdown and JSON in git.';

/** The facts a product card shows, by the row of the tables they come from. */
export const CARD_FACTS = [
  { label: 'Edits on the real page', feature: "Edits on the site's own design" },
  { label: 'Content in git', feature: 'Content as files in git' },
  { label: 'Self-host', feature: 'Self-host' },
  { label: 'Price to start', feature: 'Price to start' },
  { label: 'Licence', feature: 'Licence' },
];

/** Inline mdast to HTML, for the few kinds a table cell or list item holds; `ref(id)` draws a footnote reference. */
export function inline(nodes, ref = () => '') {
  return nodes
    .map((n) => {
      if (n.type === 'text') return e(n.value);
      if (n.type === 'footnoteReference') return ref(n.identifier);
      if (n.type === 'inlineCode') return `<code>${e(n.value)}</code>`;
      if (n.type === 'strong') return `<strong>${inline(n.children, ref)}</strong>`;
      if (n.type === 'emphasis') return `<em>${inline(n.children, ref)}</em>`;
      return n.children ? inline(n.children, ref) : '';
    })
    .join('');
}

/**
 * One cell: `{ mark, value, note, refs, text }`. `mark` is a MARKS key or null (a value such as "Free" or a
 * licence name); `value` the HTML after the mark, `note` the HTML of its <sub>, `refs` its footnote ids.
 */
export function parseCell(cell) {
  const main = [];
  const note = [];
  const refs = [];
  let into = main;
  for (const n of cell.children) {
    if (n.type === 'html') {
      const v = n.value.trim().toLowerCase();
      if (v === '<sub>') into = note;
      else if (v === '</sub>') into = main;
      continue;
    }
    if (n.type === 'footnoteReference') refs.push(n.identifier);
    else into.push(n);
  }
  let value = inline(main).trim();
  let mark = null;
  const first = value.charAt(0);
  if (MARKS[first] && (value.length === 1 || value.charAt(1) === ' ')) {
    mark = MARKS[first].key;
    value = value.slice(1).trim();
  }
  const plain = main.map(textOf).join('').trim();
  return { mark, value, note: inline(note).trim(), refs, plain, text: textOf(cell).replace(/\s+/g, ' ').trim() };
}

function parseTable(table) {
  const [head, ...rows] = table.children;
  const products = head.children.slice(1).map((c) => textOf(c).trim());
  return {
    products,
    rows: rows.map((r) => {
      const feature = parseCell(r.children[0]);
      const cells = {};
      products.forEach((p, i) => (cells[p] = parseCell(r.children[i + 1] ?? { children: [] })));
      return { feature: feature.plain, featureNote: feature.note, cells };
    }),
  };
}

/**
 * COMPARISON.md as `{ lead, groups, choose, notes }`:
 * - lead: `{ products, rows }`, the "Markstage vs WordPress, Ghost and Prismic" table;
 * - groups: `[{ id, title, intro, products, sections: [{ title, rows }] }]`, Group A and Group B;
 * - choose: `[{ name, html }]`, the "How to choose among these four" list;
 * - notes: Map of footnote id to `{ id, number }`, numbered as /compare/full/ numbers them.
 * A row is `{ feature, featureNote, cells: { [product]: cell } }`.
 */
export function parseComparison(markdown) {
  const tree = parser.parse(markdown);
  const notes = new Map();
  for (const n of tree.children) {
    if (n.type !== 'footnoteDefinition' || notes.has(n.identifier)) continue;
    notes.set(n.identifier, { id: `fn-${slugify(n.identifier) || notes.size + 1}`, number: notes.size + 1 });
  }
  let lead = null;
  const groups = [];
  const choose = [];
  let h2 = '';
  let group = null;
  let h3 = '';
  let afterChoose = false;
  for (const n of tree.children) {
    if (n.type === 'heading' && n.depth === 2) {
      h2 = textOf(n).trim();
      const m = /^Group ([A-Z]): (.+)$/.exec(h2);
      group = m ? { id: m[1].toLowerCase(), title: h2, intro: '', products: [], sections: [] } : null;
      if (group) groups.push(group);
      continue;
    }
    if (n.type === 'heading' && n.depth === 3) {
      h3 = textOf(n).trim();
      continue;
    }
    if (n.type === 'paragraph') {
      if (group && !group.intro && !group.sections.length) group.intro = textOf(n).replace(/\s+/g, ' ').trim();
      afterChoose = /^How to choose among these/.test(textOf(n).trim());
      continue;
    }
    if (n.type === 'list' && afterChoose && !choose.length) {
      for (const li of n.children) {
        const para = li.children[0];
        const name = textOf(para.children[0]).trim();
        choose.push({ name, nodes: para.children.slice(1) });
      }
      afterChoose = false;
      continue;
    }
    if (n.type !== 'table') continue;
    if (h2.startsWith('Markstage vs ') && !lead) lead = parseTable(n);
    else if (group) {
      const t = parseTable(n);
      for (const p of t.products) if (!group.products.includes(p)) group.products.push(p);
      group.sections.push({ title: h3, rows: t.rows });
    }
  }
  return { lead, groups, choose, notes };
}

/** The product's PRODUCTS entry; Markstage gets its own. */
export function productInfo(name) {
  if (name === MARKSTAGE) return { name, slug: null, kind: 'ms', what: MARKSTAGE_WHAT };
  const p = PRODUCTS.find((x) => x.name === name);
  if (!p) throw new Error(`docs/COMPARISON.md names "${name}", which scripts/site/comparison-data.mjs PRODUCTS lacks`);
  return p;
}

/** The first cell of `feature` for `product`, looking through Group A, then Group B, then the lead table. */
export function findCell(data, product, feature) {
  const tables = [...data.groups.flatMap((g) => g.sections), data.lead];
  for (const t of tables) {
    const row = t.rows.find((r) => r.feature === feature);
    if (row?.cells[product]) return row.cells[product];
  }
  return null;
}

/** Every product of the tables (Markstage left out), in the order a reader meets them: lead table, A, B. */
export function allProducts(data) {
  const names = [...data.lead.products, ...data.groups.flatMap((g) => g.products)];
  return [...new Set(names)].filter((n) => n !== MARKSTAGE);
}

/** The filter tags of a product: its kind, `lead` for the lead three, `hosted` when its Self-host cell is ✗. */
export function productTags(data, name) {
  if (name === MARKSTAGE) return ['ms'];
  const tags = [productInfo(name).kind];
  if (data.lead.products.includes(name)) tags.push('lead');
  if (findCell(data, name, 'Self-host')?.mark === 'no' && !tags.includes('hosted')) tags.push('hosted');
  return tags;
}
