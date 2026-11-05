// /why/ ("Why we built Markstage") and /showcase/ (the first site built with it), from site-content/why.md and
// site-content/showcase.md (home.mjs shows the showcase's numbers on the home page). All the words, names and numbers are in those
// files; this module only lays them out, so no site's name lives in the code (scripts/check-generic.mjs).
import { CONTACT_EMAIL, NAME, PUBLISHER, REPO_URL, SITE_URL } from './config.mjs';
import { ICONS, ORGANIZATION, absolute, breadcrumbData, breadcrumbs, copyable, page } from './layout.mjs';
import { escapeHtml as e } from './markdown.mjs';
import { button, figure } from './pages.mjs';

const list = (v) => (Array.isArray(v) ? v : []);

/** A before-to-after number, read aloud as "from 71 to 99". */
function delta(stat) {
  return `<div class="delta"><dt>${e(stat.what)}</dt><dd><span class="sr">from </span><span class="was">${e(stat.before)}</span><span class="to" aria-hidden="true"></span><span class="sr"> to </span><span class="now">${e(stat.after)}</span></dd></div>`;
}

/** Labelled screenshots side by side (two on the home page and the showcase, three in the gallery). */
function shots(media, items, root, cls) {
  const figs = list(items).map((s) => figure(media, s.media, s.alt, root, { caption: s.label })).filter(Boolean);
  return figs.length ? `<div class="${cls}">${figs.join('')}</div>` : '';
}

/** The site's address with the shared copy and open icons. */
const siteLink = (meta) => (meta.site ? copyable(meta.site, { href: meta.site, label: meta.siteName ?? meta.site, code: false, what: 'site address' }) : '');

function articleData({ meta, path, headline }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description: meta.description,
    url: absolute(path),
    inLanguage: 'en',
    ...(meta.updated ? { dateModified: meta.updated } : {}),
    ...(meta.author ? { author: { '@type': 'Person', name: meta.author, jobTitle: meta.role, worksFor: ORGANIZATION } } : { author: ORGANIZATION }),
    publisher: ORGANIZATION,
    isPartOf: { '@type': 'WebSite', name: NAME, url: SITE_URL },
  };
}

/** /why/: the story, in a reading column, signed by its author. */
export function whyPage({ why }) {
  const root = '../';
  const path = 'why/';
  const { meta, rendered } = why;
  const trail = [
    { name: 'Home', path: '' },
    { name: meta.h1, path },
  ];
  const body = `    <main id="main" class="wrap doc story">
      ${breadcrumbs(trail, root)}
      <h1>${e(meta.h1)}</h1>
      <p class="byline">${meta.author ? `By ${e(meta.author)}${meta.role ? `, ${e(meta.role)}` : ''}. ` : ''}Contact: ${copyable(CONTACT_EMAIL, { href: `mailto:${CONTACT_EMAIL}`, code: false, what: 'email address' })}</p>
      <div class="prose">
${rendered.html}
      </div>
      <p class="cta-row left">${button(REPO_URL, 'Get it on GitHub', 'primary', ICONS.github)}${button('../showcase/', 'See the showcase', 'secondary')}${button('../compare/', 'See the comparison', 'text')}</p>
    </main>`;
  return {
    path,
    file: 'why/index.html',
    html: page({
      path,
      root,
      title: meta.title,
      description: meta.description,
      body,
      data: [breadcrumbData(trail), articleData({ meta, path, headline: meta.h1 })],
      og: 'story',
      type: 'article',
      current: 'why',
      modified: meta.updated ?? null,
      styles: ['home.css'],
    }),
  };
}

/** /showcase/: the first site built with Markstage, before and after. */
export function showcasePage({ showcase, media }) {
  const root = '../';
  const path = 'showcase/';
  const { meta, rendered } = showcase;
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Showcase', path },
  ];
  const body = `    <main id="main" class="showcase">
      <div class="wrap doc wide">
        ${breadcrumbs(trail, root)}
        <h1>${e(meta.h1)}</h1>
        <p class="lead left">${e(meta.lead ?? meta.description)}</p>
        <p class="visit">Visit ${siteLink(meta)}</p>
      </div>
      <div class="wrap wide">${shots(media, meta.shots, root, 'before-after big')}</div>
      <div class="wrap doc wide">
        <dl class="deltas">${list(meta.stats).map(delta).join('')}</dl>
        <div class="prose">
${rendered.html}
        </div>
        ${shots(media, meta.phones, root, 'gallery')}
        <p class="cta-row left">${button(REPO_URL, 'Get it on GitHub', 'primary', ICONS.github)}${button('../why/', 'Why we built Markstage', 'secondary')}</p>
        <p class="small muted">${e(PUBLISHER.name)} made ${NAME}. Built a site with it? Tell us at ${copyable(CONTACT_EMAIL, { href: `mailto:${CONTACT_EMAIL}`, code: false, what: 'email address' })}</p>
      </div>
    </main>`;
  return {
    path,
    file: 'showcase/index.html',
    html: page({
      path,
      root,
      title: meta.title,
      description: meta.description,
      body,
      data: [breadcrumbData(trail), articleData({ meta, path, headline: meta.h1 })],
      og: 'showcase',
      type: 'article',
      current: 'showcase',
      modified: meta.updated ?? null,
      styles: ['home.css'],
    }),
  };
}
