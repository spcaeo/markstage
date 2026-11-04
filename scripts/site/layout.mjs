// The shared page shell of site/: <head> with search and share tags, the top bar, breadcrumbs and the footer, plus
// the one copy/open helper every shown value goes through. Plain HTML pages, no framework; site/enhance.js only adds
// the copy action and the menu toggle.
import { AUTHOR, CONTACT_EMAIL, LICENSE_URL, NAME, OG_IMAGES, OG_SIZE, PUBLISHER, REPO_URL, SITE_URL, repoFile } from './config.mjs';
import { escapeHtml as e } from './markdown.mjs';

/** The absolute address of a site path such as `docs/deploy/`. */
export const absolute = (path = '') => `${SITE_URL}${path}`;

/** JSON for a <script type="application/ld+json"> block, safe inside HTML. */
export function jsonLd(data) {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

export const ORGANIZATION = {
  '@type': 'Organization',
  name: PUBLISHER.name,
  url: PUBLISHER.url,
  email: CONTACT_EMAIL,
  founder: { '@type': 'Person', name: AUTHOR },
};

export function organizationData() {
  return { '@context': 'https://schema.org', ...ORGANIZATION, '@id': `${PUBLISHER.url}/#organization` };
}

export function breadcrumbData(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({ '@type': 'ListItem', position: i + 1, name: crumb.name, item: absolute(crumb.path) })),
  };
}

export function faqData(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ question, answer }) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })),
  };
}

const line = (d) => `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;
const svg = (body) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
export const ICONS = {
  copy: svg(line('M9 9h10v10H9zM5 15V5h10')),
  open: svg(line('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5')),
  github: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.2-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.5.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>',
  arrow: svg(line('M5 12h14M13 6l6 6-6 6')),
  menu: svg(line('M4 7h16M4 12h16M4 17h16')),
};

/** The Markstage mark: a stage (rounded square) with an M on its floor line. */
export const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="#4f46e5"/><path d="M8 22V10l8 8 8-8v12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 26h20" stroke="#c7d2fe" stroke-width="2" stroke-linecap="round"/></svg>`;

/**
 * A value someone may want to paste elsewhere (a command, an address, an email), with the shared copy icon and, for
 * an address, the open-in-a-new-tab icon. The one place copy buttons are made (build-site.test.mjs checks).
 */
export function copyable(value, { href = null, label = value, code = true, what = 'value' } = {}) {
  const shown = code ? `<code class="copyable-value">${e(label)}</code>` : `<span class="copyable-value">${e(label)}</span>`;
  const copy = `<button type="button" class="icon-btn copy-btn" data-copy="${e(value)}" aria-label="Copy ${e(what)}" title="Copy">${ICONS.copy}</button>`;
  const open = href ? `<a class="icon-btn" href="${e(href)}" target="_blank" rel="noopener" aria-label="Open ${e(what)} in a new tab" title="Open in a new tab">${ICONS.open}</a>` : '';
  return `<span class="copyable">${shown}${copy}${open}</span>`;
}

/** A shell command block with the shared copy icon. */
export function command(text, what = 'command') {
  return `<div class="cmd">${copyable(text, { what })}</div>`;
}

/** Home › Docs › Topic, as links (the last one is the current page). */
export function breadcrumbs(trail, root) {
  const items = trail.map((crumb, i) => (i === trail.length - 1 ? `<li aria-current="page">${e(crumb.name)}</li>` : `<li><a href="${root}${crumb.path}">${e(crumb.name)}</a></li>`));
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.join('')}</ol></nav>`;
}

const NAV = [
  ['', '#features', 'Features', 'features'],
  ['', 'docs/', 'Docs', 'docs'],
  ['', 'compare/', 'Compare', 'compare'],
  ['', 'alternatives/', 'Alternatives', 'alternatives'],
  ['', 'faq/', 'FAQ', 'faq'],
];

/**
 * One full page. `path` is the page's site path ('' for home, 'docs/deploy/'). `root` is how links reach the site
 * root from this page ('../../'), or the absolute address for the 404 page, which GitHub Pages serves at any depth.
 */
export function page({ path, root, title, description, body, data = [], og = 'home', type = 'website', noindex = false, current = '', modified = null }) {
  const r = root;
  const image = OG_IMAGES[og];
  const link = ([, target, label, key]) => `<a href="${target.startsWith('#') ? `${r}${target}` : `${r}${target}`}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${e(title)}</title>
    <meta name="description" content="${e(description)}" />
${noindex ? '    <meta name="robots" content="noindex" />\n' : `    <link rel="canonical" href="${absolute(path)}" />\n`}    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0e1020" media="(prefers-color-scheme: dark)" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="${NAME}" />
    <meta property="og:title" content="${e(title)}" />
    <meta property="og:description" content="${e(description)}" />
    <meta property="og:url" content="${absolute(path)}" />
    <meta property="og:image" content="${absolute(image.path)}" />
    <meta property="og:image:width" content="${OG_SIZE.width}" />
    <meta property="og:image:height" content="${OG_SIZE.height}" />
    <meta property="og:image:alt" content="${e(image.alt)}" />
    <meta property="og:locale" content="en_US" />
${modified ? `    <meta property="article:modified_time" content="${modified}" />\n` : ''}    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${e(title)}" />
    <meta name="twitter:description" content="${e(description)}" />
    <meta name="twitter:image" content="${absolute(image.path)}" />
    <meta name="twitter:image:alt" content="${e(image.alt)}" />
    <link rel="icon" href="${r}icon.svg" type="image/svg+xml" />
    <link rel="alternate" type="text/plain" title="${NAME} for AI assistants" href="${r}llms.txt" />
    <link rel="stylesheet" href="${r}styles.css" />
    <script src="${r}enhance.js" defer></script>
${data.map((d) => indent(jsonLd(d), 4)).join('\n')}
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="topbar">
      <div class="wrap topbar-row">
        <a class="brand" href="${r}">${LOGO}<span>${NAME}</span></a>
        <button type="button" class="menu-btn" aria-expanded="false" aria-controls="main-nav" aria-label="Menu">${ICONS.menu}</button>
        <nav id="main-nav" class="main-nav" aria-label="Main">
          ${NAV.map(link).join('\n          ')}
          <a class="nav-gh" href="${REPO_URL}" target="_blank" rel="noopener">${ICONS.github}<span>GitHub</span></a>
        </nav>
      </div>
    </header>

${body}

    <footer class="footer">
      <div class="wrap footer-grid">
        <div>
          <p class="footer-brand"><a class="brand" href="${r}">${LOGO}<span>${NAME}</span></a></p>
          <p class="muted">A visual editor for Astro: edit Markdown and JSON content on the real page, save clean git diffs, host it yourself.</p>
          <p class="muted small">Contact: ${copyable(CONTACT_EMAIL, { href: `mailto:${CONTACT_EMAIL}`, code: false, what: 'email address' })}</p>
        </div>
        <nav aria-label="Footer" class="footer-cols">
          <div>
            <p class="footer-head">Product</p>
            <a href="${r}#features">Features</a>
            <a href="${r}#install">Install</a>
            <a href="${r}compare/">Compare</a>
            <a href="${r}alternatives/">Alternatives</a>
            <a href="${r}faq/">FAQ</a>
            <a href="${r}glossary/">Glossary</a>
          </div>
          <div>
            <p class="footer-head">Docs</p>
            <a href="${r}docs/">All docs</a>
            <a href="${r}docs/writing/">Writing with Markstage</a>
            <a href="${r}docs/config/">Site config</a>
            <a href="${r}docs/deploy/">Deploy the server</a>
            <a href="${r}docs/security/">Security</a>
          </div>
          <div>
            <p class="footer-head">Project</p>
            <a href="${REPO_URL}" target="_blank" rel="noopener">Source code</a>
            <a href="${repoFile('CHANGELOG.md')}" target="_blank" rel="noopener">Changelog</a>
            <a href="${repoFile('CONTRIBUTING.md')}" target="_blank" rel="noopener">Contributing</a>
            <a href="${repoFile('SECURITY.md')}" target="_blank" rel="noopener">Report a security problem</a>
            <a href="${REPO_URL}/issues" target="_blank" rel="noopener">Issues</a>
          </div>
        </nav>
      </div>
      <div class="wrap footer-row small muted">
        <span><a href="${LICENSE_URL}" target="_blank" rel="noopener">Source-available under the Elastic License 2.0</a>, free to self-host.</span>
        <span>© 2026 <a href="${PUBLISHER.url}" target="_blank" rel="noopener">${PUBLISHER.name}</a></span>
      </div>
    </footer>
  </body>
</html>
`;
}

export function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}
