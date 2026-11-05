// The comparison pages of site/: /compare/ (the verdict, product cards and the lead table, drawn from
// docs/COMPARISON.md, plus the prose of the README's "How Markstage compares" section), /compare/full/
// (docs/COMPARISON.md with its sources, its tables grouped and filterable), /alternatives/ and one page per
// site-content/alternatives/<slug>.md, each topped by a "Markstage vs X" card pair. Every fact in a card or a table
// is read from docs/COMPARISON.md (comparison-data.mjs), never typed here.
import { NAME, REPO_URL, SITE_URL, UPDATED, repoFile } from './config.mjs';
import { ICONS, ORGANIZATION, absolute, breadcrumbData, breadcrumbs, faqData, page } from './layout.mjs';
import { escapeHtml as e } from './markdown.mjs';
import { button } from './pages.mjs';
import { KINDS, MARKSTAGE, allProducts, productInfo } from './comparison-data.mjs';
import { cardPair, comparisonTable, filterBar, leadSections, legend, productCard, sourceRef, verdictTiles } from './compare-render.mjs';
import { comingSection, soonFinder } from './roadmap.mjs';

export const COMPARE_HEADING = '## How Markstage compares';

/** The products people weigh most often: their alternative pages come first, in this order, then the rest by slug. */
export const LEAD_ALTERNATIVES = ['wordpress', 'ghost', 'prismic'];

/** Sort order for alternatives `{slug}`: LEAD_ALTERNATIVES first, then by slug. */
export function leadFirst(a, b) {
  const rank = (slug) => {
    const i = LEAD_ALTERNATIVES.indexOf(slug);
    return i < 0 ? LEAD_ALTERNATIVES.length : i;
  };
  return rank(a.slug) - rank(b.slug) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

/** The README section's Markdown, without its own heading; null when the README has none yet. */
export function compareSection(readme) {
  const start = readme.indexOf(`${COMPARE_HEADING}\n`);
  if (start < 0) return null;
  const rest = readme.slice(start + COMPARE_HEADING.length + 1);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * The README section's prose for /compare/: its short table, the legend above it and the numbered notes under it
 * are left out, because the page draws the same comparison from docs/COMPARISON.md, with sources.
 */
export function compareProse(section) {
  return section
    .split(/\n\s*\n/)
    .filter((b) => !/^\s*\|/.test(b) && !/^\s*✓ yes ·/.test(b) && !/^\s*¹/.test(b))
    .join('\n\n');
}

/** What Markstage is and is not, for the compare page (README and docs facts only). */
const MARKSTAGE_FACTS = [
  ['Where content lives', 'Markdown and JSON files in your git repo'],
  ['How writers edit', 'On the site’s real page design, in the browser'],
  ['What a save is', 'A clean git diff of only the blocks that changed; with the Markstage server, a commit by the person who saved'],
  ['Hosting', 'Self-hosted: your computer (astro dev) or your server'],
  ['Framework', 'Astro today; a framework-free core'],
  ['Price', 'Free to self-host (Elastic License 2.0)'],
  ['Team features', 'Sign-in, roles, 2FA, single sign-on, releases, staging'],
  ['AI today', 'An MCP server: AI agents draft as the person whose token they hold, and never publish. AI suggestions for alt text, search titles and descriptions, translation drafts and the promotion summary, which a person reads, changes and saves'],
];

const related = (alternatives, root, except = null) =>
  alternatives
    .filter((a) => a.slug !== except)
    .map((a) => `<li><a href="${root}alternatives/${a.slug}/">${e(a.meta.h1 ?? a.meta.title)}</a></li>`)
    .join('');

/** The products of `kind` that are not in the lead table, in the order of the tables. */
const ofKind = (data, kind) => allProducts(data).filter((n) => !data.lead.products.includes(n) && productInfo(n).kind === kind);

/** The context every card and table needs: the data, source links, the alternatives that have pages, badges. */
function context({ comparison, alternatives, roadmap, root, sourcesBase }) {
  const data = comparison.data;
  return { data, ref: sourceRef(data.notes, sourcesBase), root, pages: new Set(alternatives.map((a) => a.slug)), soonFor: soonFinder(roadmap, root) };
}

export function comparePage({ readme, alternatives, renderSection, comparison = null, roadmap = null }) {
  const root = '../';
  const path = 'compare/';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Compare', path },
  ];
  const section = compareSection(readme);
  const rendered = section ? renderSection(compareProse(section)) : null;
  const cx = comparison ? context({ comparison, alternatives, roadmap, root, sourcesBase: 'full/' }) : null;
  const card = (name, tag) => productCard({ name, ...cx, tag });
  const lead = cx
    ? `      <section aria-labelledby="verdict-title" class="verdict">
        <h2 id="verdict-title">The short verdict</h2>
        <ul class="vtiles">
${verdictTiles(cx.data, cx.ref, root, cx.pages)}
        </ul>
      </section>
`
    : '';
  const facts = `      <section aria-labelledby="facts-title">
        <h2 id="facts-title">Markstage in one table</h2>
        <div class="table-wrap"><table class="facts-table"><thead><tr><th scope="col">Question</th><th scope="col">Markstage</th></tr></thead><tbody>
${MARKSTAGE_FACTS.map(([q, a]) => `          <tr><th scope="row">${e(q)}</th><td>${e(a)}</td></tr>`).join('\n')}
        </tbody></table></div>
      </section>\n`;
  const vs = cx
    ? `      <section aria-labelledby="vs-title">
        <h2 id="vs-title">Markstage vs WordPress, Ghost and Prismic</h2>
        <p>The three people weigh most often, beside Markstage. Each fact is the same, with the same source, as in <a href="full/">the full comparison</a>.</p>
        <ul class="pcards four">
${[MARKSTAGE, ...cx.data.lead.products.filter((p) => p !== MARKSTAGE)].map((n) => card(n, 'h3')).join('\n')}
        </ul>
        ${legend()}
        ${comparisonTable({ caption: 'Markstage vs WordPress, Ghost and Prismic: the rows a team usually decides on', captionId: 'cap-lead', products: cx.data.lead.products, sections: leadSections(cx.data), ...cx })}
      </section>
`
    : '';
  const kinds = cx
    ? KINDS.map((k) => ({ ...k, names: ofKind(cx.data, k.id) }))
        .filter((k) => k.names.length)
        .map(
          (k) => `        <div class="kind-group" id="kind-${k.id}">
          <h3>${e(k.title)} <span class="kind-count">${k.names.length}</span></h3>
          <p class="muted">${e(k.text)}</p>
          <ul class="pcards three">
${k.names.map((n) => card(n, 'h4')).join('\n')}
          </ul>
        </div>`,
        )
        .join('\n')
    : '';
  const every = cx
    ? `      <section aria-labelledby="every-title" data-filter-scope>
        <h2 id="every-title">Every other product, grouped</h2>
        <p>The other ${allProducts(cx.data).length - cx.data.lead.products.filter((p) => p !== MARKSTAGE).length} products of the comparison, by what they are. WordPress and Ghost are publishing platforms and Prismic a hosted CMS; they are above.</p>
        ${filterBar({ segments: ['all', 'git', 'hosted', 'app'] })}
${kinds}
      </section>
`
    : '';
  const body = `    <main id="main" class="wrap doc wide compare">
      ${breadcrumbs(trail, root)}
      <h1>Which is the best CMS for Astro? Markstage compared</h1>
      <p class="lead left">The best CMS for Astro depends on your team: who edits, where content lives and what you want to run. Here is where Markstage, a visual editor that keeps content in git, fits next to WordPress, Ghost, Prismic and other hosted and git-based CMSs, and where each one leads. Markstage is not affiliated with any of them.</p>
${lead}${facts}${vs}${every}${comingSection(roadmap, root, { today: 'Shipping today: an MCP server, so an AI agent drafts as the person whose token it holds and never publishes, and AI suggestions for alt text, search titles and descriptions, translation drafts and the promotion summary.' })}${
    rendered ? `      <section aria-labelledby="side-title">\n        <h2 id="side-title">How it fits</h2>\n${rendered.html}\n      </section>\n` : ''
  }${
    alternatives.length
      ? `      <section aria-labelledby="alt-title">
        <h2 id="alt-title">Markstage as an alternative to</h2>
        <ul class="link-list">${related(alternatives, root)}</ul>
      </section>\n`
      : ''
  }      <p class="cta-row left">${comparison ? button('full/', 'Full comparison with sources', 'secondary', ICONS.arrow) : ''}${button('../docs/', 'Read the docs', 'text')}</p>
    </main>`;
  const data = [
    breadcrumbData(trail),
    { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Markstage compared with other CMSs', url: absolute(path), dateModified: UPDATED, about: { '@type': 'SoftwareApplication', name: NAME, url: SITE_URL }, publisher: ORGANIZATION },
  ];
  if (rendered?.faq.length) data.push(faqData(rendered.faq));
  return {
    path,
    file: 'compare/index.html',
    html: page({
      path,
      root,
      title: alternatives.length > 1 ? `Best CMS for Astro? Markstage Compared With ${alternatives.length} Others` : 'Best CMS for Astro? How Markstage Compares',
      description: `Choosing the best CMS for Astro: Markstage, a self-hosted visual editor that keeps content in git, beside ${alternatives.length > 1 ? alternatives.length : 'other'} hosted and git-based CMSs, with sources.`,
      body,
      data,
      og: 'compare',
      current: 'compare',
      styles: ['compare.css'],
      scripts: ['compare.js'],
    }),
  };
}

export function alternativesIndex({ alternatives }) {
  const root = '../';
  const path = 'alternatives/';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Alternatives', path },
  ];
  const cards = alternatives
    .map((a) => `          <li class="card"><h2><a href="${a.slug}/">${e(a.meta.h1 ?? a.meta.title)}</a></h2><p>${e(a.meta.description)}</p></li>`)
    .join('\n');
  const body = `    <main id="main" class="wrap doc wide">
      ${breadcrumbs(trail, root)}
      <h1>Markstage as an alternative to other content editors</h1>
      <p class="lead left">One page per tool, starting with the three people weigh most often: WordPress, Ghost and Prismic. Each says what the tool does well, where Markstage differs, and which one fits your team. Every fact about another product comes from its own website and is dated.</p>
${alternatives.length ? `        <ul class="cards two">\n${cards}\n        </ul>` : '      <p>The tool-by-tool pages are on their way. Until then, <a href="../compare/">the comparison page</a> has the overview.</p>'}
      <p class="cta-row left">${button('../compare/', 'The comparison in one page', 'secondary', ICONS.arrow)}</p>
    </main>`;
  const list = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Markstage alternatives',
    itemListElement: alternatives.map((a, i) => ({ '@type': 'ListItem', position: i + 1, name: a.meta.h1 ?? a.meta.title, url: absolute(`${path}${a.slug}/`) })),
  };
  return {
    path,
    file: 'alternatives/index.html',
    html: page({
      path,
      root,
      title: 'Markstage Alternatives: CMS and Editor Comparisons',
      description: 'Markstage compared tool by tool with other CMSs and content editors for Astro and static sites: what each does well, what it costs and which one fits.',
      body,
      data: [breadcrumbData(trail), list],
      og: 'compare',
      current: 'alternatives',
    }),
  };
}

/** One /alternatives/<slug>/ page from its Markdown file, rendered, topped by the "Markstage vs X" card pair. */
export function alternativePage({ alt, alternatives, comparison = null, roadmap = null }) {
  const root = '../../';
  const path = `alternatives/${alt.slug}/`;
  const { meta, rendered } = alt;
  const h1 = meta.h1 ?? meta.title;
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Alternatives', path: 'alternatives/' },
    { name: meta.competitor ?? h1, path },
  ];
  const data = [
    breadcrumbData(trail),
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: h1,
      description: meta.description,
      url: absolute(path),
      dateModified: meta.checked ?? UPDATED,
      about: [{ '@type': 'SoftwareApplication', name: NAME, url: SITE_URL }, ...(meta.competitor ? [{ '@type': 'Thing', name: meta.competitor }] : [])],
      publisher: ORGANIZATION,
    },
  ];
  if (rendered.faq.length) data.push(faqData(rendered.faq));
  const others = related(alternatives, root, alt.slug);
  const pair = comparison ? cardPair({ name: meta.competitor, ...context({ comparison, alternatives, roadmap, root, sourcesBase: `${root}compare/full/` }) }) : '';
  const body = `    <main id="main" class="wrap doc wide">
      ${breadcrumbs(trail, root)}
      <h1>${e(h1)}</h1>
      <p class="lead left">${e(meta.description)}</p>
      ${meta.checked ? `<p class="small muted">Facts about ${e(meta.competitor ?? 'other tools')} checked on <time datetime="${e(meta.checked)}">${e(meta.checked)}</time>, from its own website. Markstage is not affiliated with it.</p>` : ''}
${pair ? `${pair}\n      <p class="small muted pair-note">From <a href="${root}compare/full/">the full comparison</a>; each number links to its source.</p>\n` : ''}      <div class="prose">
${rendered.html}
      </div>
      <p class="cta-row left">${button(REPO_URL, 'Get Markstage on GitHub', 'primary', ICONS.github)}${button('../../compare/', 'All comparisons', 'secondary')}${button('../../docs/', 'Read the docs', 'text')}</p>
${others ? `      <section aria-labelledby="more-alt">\n        <h2 id="more-alt">More comparisons</h2>\n        <ul class="link-list">${others}</ul>\n      </section>\n` : ''}    </main>`;
  return {
    path,
    file: `alternatives/${alt.slug}/index.html`,
    html: page({ path, root, title: meta.title, description: meta.description, body, data, og: 'compare', type: 'article', current: 'alternatives', modified: meta.checked ?? null, styles: pair ? ['compare.css'] : [] }),
  };
}

/** The date docs/COMPARISON.md says its facts were checked ("checked on **2026-11-03**"), or the site's date. */
export const checkedOn = (markdown) => /checked on \*\*(\d{4}-\d{2}-\d{2})\*\*/i.exec(markdown)?.[1] ?? UPDATED;

// a run of "### Section" headings, each followed by its table: one group of COMPARISON.md
const RUN = /(?:<h3 id="[^"]+">[^<]*<\/h3>\n<div class="table-wrap"><table>[\s\S]*?<\/table><\/div>(?:\n|$))+/g;
const LEAD_TABLE = /<div class="table-wrap"><table><thead><tr><th scope="col">Feature<\/th>[\s\S]*?<\/table><\/div>/;

/**
 * The rendered COMPARISON.md with its comparison tables drawn again from the data: Group A and Group B each one
 * table whose row groups are the ### sections (the headings' ids stay, on the group rows), the lead table grouped
 * the same way, the filter above them. The legend and "Who should use what" tables stay as they are.
 */
export function groupedComparison(html, cx) {
  let i = 0;
  const { data } = cx;
  let out = html.replace(RUN, (run) => {
    const group = data.groups[i++];
    if (!group) throw new Error('docs/COMPARISON.md: more groups of tables than Group A and Group B');
    const ids = [...run.matchAll(/<h3 id="([^"]+)">/g)].map((m) => m[1]);
    if (ids.length !== group.sections.length) throw new Error(`docs/COMPARISON.md: ${group.title} has ${group.sections.length} tables, the page ${ids.length}`);
    const sections = group.sections.map((s, j) => ({ ...s, id: ids[j] }));
    return `${comparisonTable({ caption: group.title, captionId: `cap-${group.id}`, products: group.products, sections, ...cx })}\n`;
  });
  if (i !== data.groups.length) throw new Error(`docs/COMPARISON.md: ${data.groups.length} groups, ${i} drawn`);
  out = out.replace(LEAD_TABLE, () => `${filterBar({ segments: ['all', 'lead', 'git', 'hosted', 'app', 'publishing'], diff: true })}\n${legend()}\n${comparisonTable({ caption: 'Markstage vs WordPress, Ghost and Prismic', captionId: 'cap-lead', products: data.lead.products, sections: leadSections(data), ...cx })}`);
  return out;
}

/** /compare/full/: docs/COMPARISON.md, every table and its numbered sources. */
export function comparisonPage({ comparison, alternatives, roadmap = null }) {
  const { rendered, checked } = comparison;
  const root = '../../';
  const path = 'compare/full/';
  const count = alternatives.length > 1 ? `${alternatives.length} ` : '';
  const h1 = `Astro CMS comparison: Markstage beside ${count}editors and CMSs`;
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Compare', path: 'compare/' },
    { name: 'Full comparison', path },
  ];
  const data = [
    breadcrumbData(trail),
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: h1,
      url: absolute(path),
      dateModified: checked,
      about: { '@type': 'SoftwareApplication', name: NAME, url: SITE_URL },
      author: ORGANIZATION,
      publisher: ORGANIZATION,
    },
  ];
  const html = groupedComparison(rendered.html, context({ comparison, alternatives, roadmap, root, sourcesBase: '' }));
  const body = `    <main id="main" class="wrap doc wide compare full">
      ${breadcrumbs(trail, root)}
      <h1>${e(h1)}</h1>
      <p class="lead left">An Astro CMS comparison with a source for every cell: editing, content and git, Astro output, team workflow, hosting, price and licence, checked on <time datetime="${e(checked)}">${e(checked)}</time>.</p>
      <div class="prose comparison" data-filter-scope>
${html}
      </div>
      <p class="cta-row left">${button(REPO_URL, 'Get Markstage on GitHub', 'primary', ICONS.github)}${button('../', 'The short comparison', 'secondary')}${button(repoFile('docs/COMPARISON.md'), 'This page on GitHub', 'text')}</p>
    </main>`;
  return {
    path,
    file: 'compare/full/index.html',
    html: page({
      path,
      root,
      title: `Astro CMS Comparison: Markstage and ${count || 'Other '}CMSs, Sourced`,
      description: `Markstage beside ${count || 'other '}editors and CMSs used with Astro: editing, git, Astro output, workflow, hosting, price and licence, with a source for every cell.`,
      body,
      data,
      og: 'compare',
      type: 'article',
      current: 'compare',
      modified: checked,
      styles: ['compare.css'],
      scripts: ['compare.js'],
    }),
  };
}
