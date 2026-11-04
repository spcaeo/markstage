// The comparison pages of site/: /compare/ (from the README's "How Markstage compares" section, so the two never
// disagree), /compare/full/ (docs/COMPARISON.md with its sources), /alternatives/ and one page per
// site-content/alternatives/<slug>.md.
import { NAME, REPO_URL, SITE_URL, UPDATED, repoFile } from './config.mjs';
import { ICONS, ORGANIZATION, absolute, breadcrumbData, breadcrumbs, faqData, page } from './layout.mjs';
import { escapeHtml as e } from './markdown.mjs';
import { button } from './pages.mjs';

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

/** What Markstage is and is not, for the compare page (README and docs facts only). */
const MARKSTAGE_FACTS = [
  ['Where content lives', 'Markdown and JSON files in your git repo'],
  ['How writers edit', 'On the site’s real page design, in the browser'],
  ['What a save is', 'A clean git diff of only the blocks that changed; with the Markstage server, a commit by the person who saved'],
  ['Hosting', 'Self-hosted: your computer (astro dev) or your server'],
  ['Framework', 'Astro today; a framework-free core'],
  ['Price', 'Free to self-host (Elastic License 2.0)'],
  ['Team features', 'Sign-in, roles, 2FA, single sign-on, releases, staging'],
];

const related = (alternatives, root, except = null) =>
  alternatives
    .filter((a) => a.slug !== except)
    .map((a) => `<li><a href="${root}alternatives/${a.slug}/">${e(a.meta.h1 ?? a.meta.title)}</a></li>`)
    .join('');

export function comparePage({ readme, alternatives, renderSection, hasComparison = false }) {
  // hasComparison: docs/COMPARISON.md exists, so /compare/full/ is built
  const root = '../';
  const path = 'compare/';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Compare', path },
  ];
  const section = compareSection(readme);
  const rendered = section ? renderSection(section) : null;
  const body = `    <main id="main" class="wrap doc wide">
      ${breadcrumbs(trail, root)}
      <h1>Which is the best CMS for Astro? Markstage compared</h1>
      <p class="lead left">The best CMS for Astro depends on your team: who edits, where content lives and what you want to run. Here is where Markstage, a visual editor that keeps content in git, fits next to WordPress, Ghost, Prismic and other hosted and git-based CMSs, and where each one leads. Markstage is not affiliated with any of them.</p>
      <section aria-labelledby="facts-title">
        <h2 id="facts-title">Markstage in one table</h2>
        <div class="table-wrap"><table><thead><tr><th scope="col">Question</th><th scope="col">Markstage</th></tr></thead><tbody>
${MARKSTAGE_FACTS.map(([q, a]) => `          <tr><th scope="row">${e(q)}</th><td>${e(a)}</td></tr>`).join('\n')}
        </tbody></table></div>
      </section>
${rendered ? `      <section aria-labelledby="side-title">\n        <h2 id="side-title">Side by side</h2>\n${rendered.html}\n      </section>\n` : ''}${
    alternatives.length
      ? `      <section aria-labelledby="alt-title">
        <h2 id="alt-title">Markstage as an alternative to</h2>
        <ul class="link-list">${related(alternatives, root)}</ul>
      </section>\n`
      : ''
  }      <p class="cta-row left">${hasComparison ? button('full/', 'Full comparison with sources', 'secondary', ICONS.arrow) : ''}${button('../docs/', 'Read the docs', 'text')}</p>
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

/** One /alternatives/<slug>/ page from its Markdown file, rendered. */
export function alternativePage({ alt, alternatives }) {
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
  const body = `    <main id="main" class="wrap doc wide">
      ${breadcrumbs(trail, root)}
      <h1>${e(h1)}</h1>
      <p class="lead left">${e(meta.description)}</p>
      ${meta.checked ? `<p class="small muted">Facts about ${e(meta.competitor ?? 'other tools')} checked on <time datetime="${e(meta.checked)}">${e(meta.checked)}</time>, from its own website. Markstage is not affiliated with it.</p>` : ''}
      <div class="prose">
${rendered.html}
      </div>
      <p class="cta-row left">${button(REPO_URL, 'Get Markstage on GitHub', 'primary', ICONS.github)}${button('../../compare/', 'All comparisons', 'secondary')}${button('../../docs/', 'Read the docs', 'text')}</p>
${others ? `      <section aria-labelledby="more-alt">\n        <h2 id="more-alt">More comparisons</h2>\n        <ul class="link-list">${others}</ul>\n      </section>\n` : ''}    </main>`;
  return {
    path,
    file: `alternatives/${alt.slug}/index.html`,
    html: page({ path, root, title: meta.title, description: meta.description, body, data, og: 'compare', type: 'article', current: 'alternatives', modified: meta.checked ?? null }),
  };
}

/** The date docs/COMPARISON.md says its facts were checked ("checked on **2026-11-03**"), or the site's date. */
export const checkedOn = (markdown) => /checked on \*\*(\d{4}-\d{2}-\d{2})\*\*/i.exec(markdown)?.[1] ?? UPDATED;

/** /compare/full/: docs/COMPARISON.md, every table and its numbered sources. */
export function comparisonPage({ rendered, checked, alternatives }) {
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
  const body = `    <main id="main" class="wrap doc wide">
      ${breadcrumbs(trail, root)}
      <h1>${e(h1)}</h1>
      <p class="lead left">An Astro CMS comparison with a source for every cell: editing, content and git, Astro output, team workflow, hosting, price and licence, checked on <time datetime="${e(checked)}">${e(checked)}</time>.</p>
      <div class="prose comparison">
${rendered.html}
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
    }),
  };
}
