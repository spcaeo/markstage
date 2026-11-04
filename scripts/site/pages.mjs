// The home page, the docs and the 404 page of site/. Each returns `{ path, file, html }`.
import { CLONE_URL, LICENSE_URL, NAME, PUBLISHER, REPO_URL, SITE_URL, TAGLINE, UPDATED, repoFile } from './config.mjs';
import { AUDIENCES, DOC_GROUPS, DOCS, FAQ, FEATURES, HOW, INSTALL, MORE_FEATURES } from './content.mjs';
import { ICONS, ORGANIZATION, absolute, breadcrumbData, breadcrumbs, command, copyable, faqData, organizationData, page } from './layout.mjs';
import { escapeHtml as e } from './markdown.mjs';

/** A screenshot from site/media, or nothing when it has not been made yet. */
export function figure(media, name, alt, root, { eager = false, caption = '', cls = '' } = {}) {
  const info = media[name];
  if (!info) return '';
  const [w, h] = info.width > 2000 ? [info.width / 2, info.height / 2] : [info.width, info.height];
  const img = `<img src="${root}media/${info.file}" alt="${e(alt)}" width="${w}" height="${h}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" />`;
  return `<figure class="shot${cls ? ` ${cls}` : ''}"><a href="${root}media/${info.file}" class="shot-link" aria-label="Open the full-size screenshot: ${e(alt)}">${img}</a>${caption ? `<figcaption>${e(caption)}</figcaption>` : ''}</figure>`;
}

export const button = (href, label, kind = 'primary', icon = '') =>
  `<a class="btn btn-${kind}" href="${href}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${icon}<span>${label}</span></a>`;

/** SoftwareApplication JSON-LD for the home page. */
/** A doc's <title>: its search title plus " | Markstage", unless the name is in it already or the suffix would pass 60. */
export function docTitle(seo) {
  const withName = `${seo} | ${NAME}`;
  return new RegExp(NAME, 'i').test(seo) || withName.length > 60 ? seo : withName;
}

function softwareData(media, version) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: NAME,
    alternateName: 'Markstage visual editor for Astro',
    description:
      'A self-hosted visual editor for Astro sites: writers edit Markdown and JSON content on the real page design, and every save is a clean git diff (with the Markstage server, a commit by the person who saved). Source-available, free to self-host.',
    url: SITE_URL,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Content management system',
    operatingSystem: 'Linux, macOS (Node.js 22.13 or newer)',
    softwareVersion: version,
    softwareRequirements: 'Node.js 22.13 or newer, git, an Astro site',
    image: absolute('og/home.png'),
    screenshot: media.hero ? absolute(`media/${media.hero.file}`) : undefined,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    license: LICENSE_URL,
    codeRepository: REPO_URL,
    publisher: ORGANIZATION,
    author: ORGANIZATION,
    keywords: 'Astro CMS, visual editor for Astro, git-based CMS, Markdown editor, headless CMS alternative, self-hosted CMS',
  };
}

export function home({ media, version, faq = FAQ }) {
  const root = './';
  const features = FEATURES.map(
    (f, i) => `        <article class="feature${i % 2 ? ' flip' : ''}" id="${f.id}">
          <div class="feature-text"><h3>${e(f.title)}</h3><p>${e(f.text)}</p></div>
          ${figure(media, f.image, f.alt, root)}
        </article>`,
  ).join('\n');
  const install = INSTALL.map(
    (s) =>
      `          <li class="step"><div class="step-text"><h3>${e(s.title)}</h3><p>${e(s.text)}</p>${s.url ? `<p>Then open ${copyable(s.url, { href: s.url, what: 'editor address' })}</p>` : ''}${s.doc ? `<p><a href="docs/${s.doc}/">Read: ${e(DOCS.find((d) => d.id === s.doc).title)}</a></p>` : ''}</div><div class="step-cmds">${(s.cmd ?? []).map((c) => command(c)).join('')}</div></li>`,
  ).join('\n');
  const body = `    <main id="main">
      <section class="hero">
        <div class="wrap">
          <p class="eyebrow">Source-available · Self-hosted · For Astro</p>
          <h1>A visual editor for Astro: edit Markdown on the real page</h1>
          <p class="lead">Markstage lets writers change your Astro site’s Markdown and JSON content on its own design, not in grey form fields. Every save is a clean git diff of exactly what changed, committed in the writer’s name on a Markstage server. No content database, no MDX, no cloud.</p>
          <p class="cta-row">${button(REPO_URL, 'Get it on GitHub', 'primary', ICONS.github)}${button('#install', 'Install in 3 steps', 'secondary')}${button('docs/', 'Read the docs', 'text', '')}</p>
          <ul class="pills" aria-label="In short">
            <li>Free to self-host</li>
            <li>Content stays in git</li>
            <li>Surgical, byte-safe saves</li>
            <li>Roles, releases and staging</li>
          </ul>
        </div>
        <div class="wrap wide">${figure(media, 'hero', 'The Markstage editor open on a blog post, drawn with the blog’s own design: title, cover image and text, ready to edit', root, { eager: true, cls: 'hero-shot' })}</div>
      </section>

      <section class="band" id="features" aria-labelledby="features-title">
        <div class="wrap">
          <h2 id="features-title">What Markstage does</h2>
          <p class="section-lead">${e(TAGLINE)} Everything a content team needs from a CMS, on top of the files you already have.</p>
${features}
          <h3 class="sub">Also in the editor</h3>
          <ul class="ticks two">
${MORE_FEATURES.map((t) => `            <li>${e(t)}</li>`).join('\n')}
          </ul>
        </div>
      </section>

      <section class="wrap" id="how" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol class="cards four">
${HOW.map((s) => `          <li class="card"><h3>${e(s.title)}</h3><p>${e(s.text)}</p></li>`).join('\n')}
        </ol>
      </section>

      <section class="wrap" id="who" aria-labelledby="who-title">
        <h2 id="who-title">Who it is for</h2>
        <ul class="cards three">
${AUDIENCES.map((a) => `          <li class="card"><h3>${e(a.title)}</h3><p>${e(a.text)}</p></li>`).join('\n')}
        </ul>
        ${figure(media, 'home', 'The Markstage home screen: edit a page, write a new post, read messages, go live, and the recent posts with their status', root)}
      </section>

      <section class="band" id="install" aria-labelledby="install-title">
        <div class="wrap">
          <h2 id="install-title">Install in three steps</h2>
          <ol class="steps">
${install}
          </ol>
          <p class="small muted">Markstage is in pre-release and in active development. The clone address: ${copyable(CLONE_URL, { href: REPO_URL, what: 'clone address' })}</p>
        </div>
      </section>

      <section class="wrap" id="compare" aria-labelledby="compare-title">
        <h2 id="compare-title">How Markstage compares</h2>
        <p>Markstage is for teams who want a visual editor without giving up Markdown files, git history and their own servers. See where it fits next to hosted and git-based CMSs, and where they lead.</p>
        <p class="cta-row left">${button('compare/', 'See the comparison', 'secondary', ICONS.arrow)}${button('alternatives/', 'Alternatives, one by one', 'text')}</p>
      </section>

      <section class="band" id="faq" aria-labelledby="faq-title">
        <div class="wrap">
          <h2 id="faq-title">Frequently asked questions</h2>
          <div class="faq">
${faq.map((x) => `            <div class="qa"><h3>${e(x.q)}</h3><p>${e(x.a)}</p></div>`).join('\n')}
          </div>
          <p><a href="faq/">More questions and answers</a></p>
        </div>
      </section>

      <section class="wrap cta-end" aria-labelledby="start-title">
        <h2 id="start-title">Give your writers the real page</h2>
        <p>Made by <a href="${PUBLISHER.url}" target="_blank" rel="noopener">${PUBLISHER.name}</a>. Free to self-host under the Elastic License 2.0.</p>
        <p class="cta-row">${button(REPO_URL, 'Star Markstage on GitHub', 'primary', ICONS.github)}${button('docs/writing/', 'See how writing works', 'secondary')}</p>
      </section>
    </main>`;
  return {
    path: '',
    file: 'index.html',
    html: page({
      path: '',
      root,
      title: 'Markstage: Visual Editor for Astro, Edit on the Real Page',
      description:
        'Markstage is a self-hosted visual editor for Astro: edit Markdown and JSON on your real page design and save clean git diffs. Source-available, free to use.',
      body,
      data: [softwareData(media, version), faqData(faq.map(({ q, a }) => ({ question: q, answer: a }))), organizationData()],
    }),
  };
}

function docsNav(root, currentId) {
  return DOC_GROUPS.map(
    (g) =>
      `<div class="docs-group"><p class="docs-group-title">${e(g.title)}</p><ul>${g.docs
        .map((d) => `<li><a href="${root}docs/${d.id}/"${d.id === currentId ? ' aria-current="page"' : ''}>${e(d.title)}</a></li>`)
        .join('')}</ul></div>`,
  ).join('');
}

export function docsIndex() {
  const root = '../';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Docs', path: 'docs/' },
  ];
  const body = `    <main id="main" class="wrap doc">
      ${breadcrumbs(trail, root)}
      <h1>Markstage documentation</h1>
      <p class="lead left">How to set up an Astro site for Markstage, write and publish with it, run the server for a team, and connect other systems through its API.</p>
${DOC_GROUPS.map(
  (g, i) => `      <section aria-labelledby="g-${i}">
        <h2 id="g-${i}">${e(g.title)}</h2>
        <ul class="cards two">
${g.docs.map((d) => `          <li class="card"><h3><a href="${d.id}/">${e(d.title)}</a></h3><p>${e(d.summary)}</p></li>`).join('\n')}
        </ul>
      </section>`,
).join('\n')}
      <section aria-labelledby="more-title">
        <h2 id="more-title">More</h2>
        <ul>
          <li><a href="../faq/">Frequently asked questions</a></li>
          <li><a href="../glossary/">Glossary of the words Markstage uses</a></li>
          <li><a href="${repoFile('README.md')}" target="_blank" rel="noopener">The README on GitHub</a></li>
          <li><a href="${REPO_URL}/issues" target="_blank" rel="noopener">Ask a question or report a problem</a></li>
        </ul>
      </section>
    </main>`;
  return {
    path: 'docs/',
    file: 'docs/index.html',
    html: page({
      path: 'docs/',
      root,
      title: 'Markstage Docs: Set Up, Write, Deploy and Integrate',
      description: 'Guides and reference for Markstage, the visual editor for Astro: site config, writing, deploying the server, environments, security and the HTTP API.',
      body,
      data: [breadcrumbData(trail)],
      og: 'docs',
      current: 'docs',
    }),
  };
}

/** One doc page; `rendered` is renderMarkdown's result for its file. */
export function docPage({ doc, rendered }) {
  const root = '../../';
  const at = DOCS.indexOf(doc);
  const prev = DOCS[at - 1];
  const next = DOCS[at + 1];
  const path = `docs/${doc.id}/`;
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Docs', path: 'docs/' },
    { name: doc.title, path },
  ];
  const toc = rendered.headings.filter((h) => h.level === 2);
  const data = [breadcrumbData(trail)];
  if (rendered.faq.length) data.push(faqData(rendered.faq));
  data.push({
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: doc.seo,
    description: doc.summary,
    url: absolute(path),
    inLanguage: 'en',
    dateModified: UPDATED,
    isPartOf: { '@type': 'WebSite', name: NAME, url: SITE_URL },
    about: { '@type': 'SoftwareApplication', name: NAME, url: SITE_URL },
    publisher: ORGANIZATION,
  });
  const body = `    <main id="main" class="wrap doc-layout">
      <aside class="docs-nav" aria-label="Docs topics">${docsNav(root, doc.id)}</aside>
      <article class="doc">
        ${breadcrumbs(trail, root)}
        <h1>${e(doc.title)}</h1>
        <p class="lead left">${e(doc.summary)}</p>
${toc.length > 2 && doc.toc !== false ? `        <nav class="toc" aria-label="On this page"><p class="docs-group-title">On this page</p><ul>${toc.map((h) => `<li><a href="#${h.id}">${e(h.text)}</a></li>`).join('')}</ul></nav>\n` : ''}        <div class="prose">
${rendered.html}
        </div>
        <p class="small muted">Source: <a href="${repoFile(`docs/${doc.file}`)}" target="_blank" rel="noopener">docs/${doc.file}</a> on GitHub. Something unclear? <a href="${REPO_URL}/issues" target="_blank" rel="noopener">Open an issue</a>.</p>
        <nav class="pager" aria-label="More docs">
          ${prev ? `<a class="prev" href="../${prev.id}/"><span class="small muted">Previous</span>${e(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a class="next" href="../${next.id}/"><span class="small muted">Next</span>${e(next.title)}</a>` : '<span></span>'}
        </nav>
      </article>
    </main>`;
  return {
    path,
    file: `docs/${doc.id}/index.html`,
    html: page({ path, root, title: docTitle(doc.seo), description: doc.summary, body, data, og: 'docs', type: 'article', current: 'docs', modified: UPDATED }),
  };
}

export function notFound() {
  const root = SITE_URL;
  const body = `    <main id="main" class="wrap doc">
      <h1>Page not found</h1>
      <p class="lead left">This page does not exist, or it has moved.</p>
      <ul>
        <li><a href="${root}">The Markstage home page</a></li>
        <li><a href="${root}docs/">Read the docs</a></li>
        <li><a href="${root}faq/">Frequently asked questions</a></li>
      </ul>
    </main>`;
  return {
    path: '404.html',
    file: '404.html',
    html: page({ path: '404.html', root, title: 'Page not found | Markstage', description: 'This page of the Markstage site does not exist. Go to the home page, the docs or the questions and answers about the editor.', body, noindex: true }),
  };
}
