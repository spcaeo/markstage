// The docs and the 404 page of site/, and the figure and button helpers every page uses. Each page returns
// `{ path, file, html }`. The home page is home.mjs.
import { NAME, REPO_URL, SITE_URL, UPDATED, repoFile } from './config.mjs';
import { DOC_GROUPS, DOCS } from './content.mjs';
import { ORGANIZATION, absolute, breadcrumbData, breadcrumbs, faqData, page } from './layout.mjs';
import { escapeHtml as e } from './markdown.mjs';

/** A screenshot from site/media, or nothing when it has not been made yet. */
export function figure(media, name, alt, root, { eager = false, caption = '', cls = '' } = {}) {
  const info = media[name];
  if (!info) return '';
  const [w, h] = info.width > 2000 ? [info.width / 2, info.height / 2] : [info.width, info.height];
  const img = `<img src="${root}media/${info.file}" alt="${e(alt)}" width="${w}" height="${h}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" />`;
  return `<figure class="shot${cls ? ` ${cls}` : ''}"><a href="${root}media/${info.file}" class="shot-link" aria-label="Open the full-size screenshot: ${e(alt)}">${img}</a>${caption ? `<figcaption>${e(caption)}</figcaption>` : ''}</figure>`;
}

/** The demo video (site/media/demo.mp4) with its poster, or nothing when it has not been made yet. */
export function demoVideo(media, root, { video = false } = {}) {
  const poster = media['demo-poster'];
  if (!video || !poster) return '';
  const [w, h] = poster.width > 2000 ? [poster.width / 2, poster.height / 2] : [poster.width, poster.height];
  return `<figure class="shot demo-video"><video controls muted playsinline preload="none" width="${w}" height="${h}" poster="${root}media/${poster.file}" aria-label="A short video of the live demo: a blog post opens on its page, a heading is edited, Save shows the git diff of that one line"><source src="${root}media/demo.mp4" type="video/mp4" /><source src="${root}media/demo.webm" type="video/webm" /></video><figcaption>Open a post, change a heading, press Save: the diff shows exactly that line.</figcaption></figure>`;
}

/** A pill button: `primary` lime, `ink` ink, `secondary` outlined, `text` a plain link. */
export const button = (href, label, kind = 'primary', icon = '') =>
  `<a class="btn btn-${kind}" href="${href}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${icon}<span>${label}</span></a>`;

/** A doc's <title>: its search title plus " | Markstage", unless the name is in it already or the suffix would pass 60. */
export function docTitle(seo) {
  const withName = `${seo} | ${NAME}`;
  return new RegExp(NAME, 'i').test(seo) || withName.length > 60 ? seo : withName;
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
