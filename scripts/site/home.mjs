// The home page of site/, in the order of the approved look ("bold and fresh"): the hero with the "/" block menu,
// writing like Notion, what we took from Ghost and from Prismic, AI and MCP, the showcase's numbers, a compare strip
// generated from docs/COMPARISON.md's lead table, then install and the questions. The cards' words are in
// home-content.mjs, the showcase's in site-content/showcase.md, the coming AI items in site-content/roadmap.md.
import { CLONE_URL, DEMO_PATH, LICENSE_URL, NAME, PUBLISHER, REPO_URL, SITE_URL } from './config.mjs';
import { findCell, MARKS } from './comparison-data.mjs';
import { DOCS, FAQ, INSTALL } from './content.mjs';
import { AI_CARDS, GHOST_CARDS, HERO_CHIPS, isAiItem, PRISMIC_CARDS, STRIP_ROWS, WRITING_CARDS } from './home-content.mjs';
import { ICONS, ORGANIZATION, absolute, command, copyable, faqData, organizationData, page } from './layout.mjs';
import { escapeHtml as e } from './markdown.mjs';
import { button, figure } from './pages.mjs';
import { soonBadge } from './roadmap.mjs';

const GLYPHS = Object.fromEntries(Object.entries(MARKS).map(([glyph, m]) => [m.key, glyph]));

/** SoftwareApplication JSON-LD for the home page. */
function softwareData(media, version) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: NAME,
    alternateName: 'Markstage visual editor for Astro',
    description:
      'A self-hosted visual editor for Astro sites: writers edit Markdown, MDX and JSON content on the real page design with Notion-style blocks, and every save is a clean git diff (with the Markstage server, a commit by the person who saved). Source-available, free to self-host.',
    url: SITE_URL,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Content management system',
    operatingSystem: 'Linux, macOS (Node.js 22.13 or newer)',
    softwareVersion: version,
    softwareRequirements: 'Node.js 22.13 or newer, git, an Astro site',
    image: absolute('og/home.png'),
    screenshot: media.blocks ? absolute(`media/${media.blocks.file}`) : media.hero ? absolute(`media/${media.hero.file}`) : undefined,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    license: LICENSE_URL,
    codeRepository: REPO_URL,
    publisher: ORGANIZATION,
    author: ORGANIZATION,
    keywords: 'visual editor for Astro, Astro CMS, Notion-style editor, git-based CMS, Markdown editor, MCP server, self-hosted CMS',
  };
}

const card = (c, extra = '') => `<article class="f">${c.k ? `<span class="k">${e(c.k)}</span>` : ''}<h3>${e(c.title)}</h3><p>${e(c.text)}</p>${extra}</article>`;

function sectionHead(kick, id, title, lede) {
  return `<div class="sec-head"><p class="kick">${kick}</p><h2 id="${id}">${title}</h2>${lede ? `<p class="lede">${lede}</p>` : ''}</div>`;
}

/** A Prismic card's chip: the Prismic cell of its row in COMPARISON.md (its note, or its mark's word), or a name. */
function prismicChip(c, comparison) {
  if (c.chip) return `<p class="vs"><span>${e(c.chip)}</span></p>`;
  const cell = c.prismic && comparison ? findCell(comparison, 'Prismic', c.prismic) : null;
  if (!cell) return '';
  const words = cell.note || cell.value || MARKS[GLYPHS[cell.mark]]?.label || '';
  return words ? `<p class="vs"><span>Prismic: ${words}</span></p>` : '';
}

/** The compare strip: STRIP_ROWS of the lead table, each cell's mark, words and note, as COMPARISON.md has them. */
export function compareStrip(comparison) {
  const lead = comparison?.lead;
  if (!lead) return '';
  const rows = STRIP_ROWS.map((f) => lead.rows.find((r) => r.feature === f)).filter(Boolean);
  const head = lead.products.map((p, i) => `<th scope="col"${i === 0 ? ' class="us"' : ''}>${e(p)}</th>`).join('');
  const cell = (c, i) => {
    const mark = c.mark ? `<span class="m m-${c.mark}" aria-hidden="true">${GLYPHS[c.mark]}</span><span class="sr">${e(MARKS[GLYPHS[c.mark]].label)}</span> ` : '';
    const note = c.note ? `<span class="note">${c.note}</span>` : '';
    return `<td${i === 0 ? ' class="us"' : ''}>${mark}${c.value}${c.value && note ? ' ' : ''}${note}</td>`;
  };
  const body = rows.map((r) => `<tr><th scope="row">${e(r.feature.replace(/'/g, '’'))}</th>${lead.products.map((p, i) => cell(r.cells[p], i)).join('')}</tr>`).join('\n');
  return `<div class="tbl"><table class="strip"><thead><tr><th scope="col">What you get</th>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div>`;
}

/** The showcase's numbers, from site-content/showcase.md (`stats` and `home`). */
function showcaseBand(showcase, why) {
  const s = showcase?.meta.home;
  if (!s) return '';
  const nums = (showcase.meta.stats ?? [])
    .map((st) => `<div class="num"><dt>${e(st.what)}</dt><dd><span class="sr">from </span>${e(st.before)} <span aria-hidden="true">→</span> <span class="sr">to </span>${e(st.after)}</dd></div>`)
    .join('');
  const site = showcase.meta.site ? copyable(showcase.meta.site, { href: showcase.meta.site, label: showcase.meta.siteName ?? showcase.meta.site, code: false, what: 'site address' }) : '';
  return `      <section class="sec" id="built-with" aria-labelledby="built-title">
        <div class="wrap">
          ${sectionHead(`Showcase${showcase.meta.siteName ? ` · ${e(showcase.meta.siteName)}` : ''}`, 'built-title', e(s.title), e(s.text))}
          <dl class="nums">${nums}</dl>
${s.note ? `          <p class="small muted">${e(s.note)}</p>\n` : ''}          <p class="cta-row left">${button('showcase/', e(s.link ?? 'See the showcase'), 'secondary', ICONS.arrow)}${why ? button('why/', e(why.meta.home?.link ?? 'Why we built it'), 'text') : ''}<span class="visit">Visit ${site}</span></p>
        </div>
      </section>
`;
}

/** The AI band's third card: the roadmap's AI and MCP items being built now (site-content/roadmap.md). */
function comingCard(roadmap) {
  const items = (roadmap?.items ?? []).filter((i) => isAiItem(i) && i.status === 'in-progress');
  if (!items.length) return '';
  return `<article class="f"><p>${soonBadge(items[0], './')}</p><h3>Being built now</h3><ul>${items.map((i) => `<li>${e(i.title)}</li>`).join('')}</ul></article>`;
}

/**
 * The home page. `compared` is the number of other products in docs/COMPARISON.md (the hero's claim is scoped to
 * them; no claim without it), `comparison` its parsed tables, `demo` whether the live demo's page is built.
 */
export function home({ media, version, faq = FAQ, compared = 0, comparison = null, roadmap = null, showcase = null, why = null, demo = false }) {
  const root = './';
  const install = INSTALL.map(
    (s) =>
      `          <li class="step"><div class="step-text"><h3>${e(s.title)}</h3><p>${e(s.text)}</p>${s.url ? `<p>Then open ${copyable(s.url, { href: s.url, what: 'editor address' })}</p>` : ''}${s.doc ? `<p><a href="docs/${s.doc}/">Read: ${e(DOCS.find((d) => d.id === s.doc).title)}</a></p>` : ''}</div><div class="step-cmds">${(s.cmd ?? []).map((c) => command(c)).join('')}</div></li>`,
  ).join('\n');
  const main = demo ? button(DEMO_PATH, 'Try the live demo', 'primary') : button('#install', 'Try the example blog', 'primary');
  const shot = figure(media, 'blocks', 'The Markstage editor on a post of the example blog with its block menu open (the “+” beside a line or “/” on an empty line opens it), each block with a small drawing of it', root, { eager: true, cls: 'win' });
  const body = `    <main id="main">
      <section class="hero">
        <div class="wrap hero-grid">
          <div class="copy">
            <h1><span class="kick">The visual editor for Astro sites · free to self-host</span> <span class="h1-line">Edit your site on the <span class="mark">real page</span>.</span></h1>
            <p class="lede">Writers click into your Astro site’s own design and type, like in Notion. Every save is a clean git commit in their name. No content database, no monthly bill.</p>
            <p class="cta-row left">${main}${button(REPO_URL, 'Get it on GitHub', 'ink', ICONS.github)}</p>
            <ul class="chips" aria-label="In short">${HERO_CHIPS.map((c) => `<li>${e(c)}</li>`).join('')}</ul>
${compared ? `            <p class="hero-claim">We compared ${compared} other editors. None of them lets writers edit on the real page from your own server with no database server. <a href="compare/">See the comparison</a></p>\n` : ''}          </div>
          ${shot}
        </div>
      </section>

      <section class="sec" id="writing" aria-labelledby="writing-title">
        <div class="wrap">
          ${sectionHead('Writing', 'writing-title', 'Writes like Notion. Looks like your site.', 'The block editor people already know, drawn on your real design instead of grey form fields.')}
          <div class="grid3">${WRITING_CARDS.map((c) => card(c)).join('')}</div>
          <p><a href="features/#writing">Everything the editor does for writers</a></p>
        </div>
      </section>

      <section class="sec band-lime" id="ghost" aria-labelledby="ghost-title">
        <div class="wrap">
          ${sectionHead('Inspired by Ghost', 'ghost-title', 'Ghost’s calm writing, on your own design.', 'We studied Ghost’s editor row by row, kept what writers love, and put it on the real page.')}
          <div class="grid3">${GHOST_CARDS.map((c) => card(c)).join('')}</div>
        </div>
      </section>

      <section class="sec" id="prismic" aria-labelledby="prismic-title">
        <div class="wrap">
          ${sectionHead('Inspired by Prismic', 'prismic-title', 'Prismic’s page building, without the bill.', 'We used Prismic and left over its price and the missing path from development to live. Markstage includes what we wanted, free to self-host.')}
          <div class="grid3">${PRISMIC_CARDS.map((c) => card(c, prismicChip(c, comparison))).join('')}</div>
        </div>
      </section>

      <section class="sec band-dark" id="ai" aria-labelledby="ai-title">
        <div class="wrap">
          ${sectionHead('AI &amp; MCP', 'ai-title', 'AI that drafts. People who publish.', 'Bring your own AI key. Every suggestion sits next to the value it is for, and nothing is saved until a person reads it.')}
          <div class="grid3">${AI_CARDS.map((c) => card(c)).join('')}${comingCard(roadmap)}</div>
          <p class="cta-row left">${button('ai/', 'AI and MCP in Markstage', 'primary', ICONS.arrow)}</p>
        </div>
      </section>

${showcaseBand(showcase, why)}
      <section class="sec" id="compare" aria-labelledby="compare-title">
        <div class="wrap">
          ${sectionHead('Compare', 'compare-title', 'Markstage, WordPress, Ghost, Prismic.', 'The rows teams decide on most, from our comparison. Each cell has its source there.')}
          ${compareStrip(comparison)}
          <p class="cta-row left">${button('compare/', 'See the whole comparison', 'secondary', ICONS.arrow)}${button('alternatives/', 'Alternatives, one by one', 'text')}</p>
        </div>
      </section>

      <section class="sec band-soft" id="install" aria-labelledby="install-title">
        <div class="wrap">
          ${sectionHead('Get started', 'install-title', 'Install in three steps', demo ? `Just looking? The <a href="${DEMO_PATH}">live demo</a> runs the editor on the example blog in your browser, with nothing to install.` : '')}
          <ol class="steps">
${install}
          </ol>
          <p class="small muted">Markstage is in pre-release and in active development. The clone address: ${copyable(CLONE_URL, { href: REPO_URL, what: 'clone address' })}</p>
        </div>
      </section>

      <section class="sec" id="faq" aria-labelledby="faq-title">
        <div class="wrap">
          ${sectionHead('Questions', 'faq-title', 'Frequently asked questions', '')}
          <div class="faq">
${faq.map((x) => `            <div class="qa"><h3>${e(x.q)}</h3><p>${e(x.a)}</p></div>`).join('\n')}
          </div>
          <p><a href="faq/">More questions and answers</a></p>
        </div>
      </section>

      <section class="wrap cta-end" aria-labelledby="start-title">
        <h2 id="start-title">Type it. Ship it.</h2>
        <p>Made by <a href="${PUBLISHER.url}" target="_blank" rel="noopener">${PUBLISHER.name}</a>. Free to self-host under the Elastic License 2.0.</p>
        <p class="cta-row">${button(REPO_URL, 'Star Markstage on GitHub', 'ink', ICONS.github)}${button('features/', 'See every feature', 'secondary')}</p>
      </section>
    </main>`;
  return {
    path: '',
    file: 'index.html',
    html: page({
      path: '',
      root,
      title: 'Markstage: Visual Editor for Astro, Type It, Ship It',
      description:
        'Markstage is a self-hosted visual editor for Astro: Notion-style blocks on your real page design, clean git commits, AI that drafts. Free to self-host.',
      body,
      data: [softwareData(media, version), faqData(faq.map(({ q, a }) => ({ question: q, answer: a }))), organizationData()],
      styles: ['home.css'],
    }),
  };
}
