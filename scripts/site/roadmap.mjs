// The roadmap: site-content/roadmap.md (front matter `items`) is the one list of what is coming. It makes /roadmap/,
// the "What's coming" section of /compare/ and every "Coming in 0.4.0" / "Planned" badge in the comparison cells,
// so a badge can only name an item that is on the list (compare.test.mjs also checks the README's Roadmap).
import fs from 'node:fs';
import path from 'node:path';
import { breadcrumbData, breadcrumbs, ICONS, ORGANIZATION, absolute, page } from './layout.mjs';
import { escapeHtml as e, parseFrontMatter } from './markdown.mjs';
import { NAME, REPO_URL, SITE_URL, UPDATED } from './config.mjs';
import { button } from './pages.mjs';

/** Each status, with the words its badge shows; a shipped item shows no badge. */
export const STATUS = {
  'in-progress': { label: 'Coming in 0.4.0', group: 'Being built now, for 0.4.0' },
  planned: { label: 'Planned', group: 'Planned, later' },
  shipped: { label: null, group: 'Shipped' },
};

/** site-content/roadmap.md as `{ meta, items, body }`, or null when there is none. */
export function readRoadmap(contentDir, render) {
  const file = path.join(contentDir, 'roadmap.md');
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
  for (const key of ['title', 'description', 'h1']) if (!meta[key]) throw new Error(`site-content/roadmap.md: front matter needs "${key}"`);
  const items = (meta.items ?? []).map((it) => {
    for (const key of ['id', 'title', 'what', 'status']) if (!it[key]) throw new Error(`site-content/roadmap.md: an item needs "${key}"`);
    if (!STATUS[it.status]) throw new Error(`site-content/roadmap.md: ${it.id} has status "${it.status}"`);
    return { ...it, rows: it.rows ?? [] };
  });
  return { meta, items, rendered: render(body) };
}

/** The badge an item shows ("Coming in 0.4.0", "Planned") linking to its line on /roadmap/; '' once shipped. */
export function soonBadge(item, root, { link = true } = {}) {
  const label = STATUS[item.status].label;
  if (!label) return '';
  if (!link) return `<span class="soon ${item.status}" data-item="${e(item.id)}">${e(label)}</span>`;
  return `<a class="soon ${item.status}" href="${root}roadmap/#${e(item.id)}" data-item="${e(item.id)}" title="${e(item.title)}">${e(label)}</a>`;
}

/** comparison feature row → the item that changes Markstage's cell there (shipped items left out). */
export function itemsByRow(roadmap) {
  const map = new Map();
  for (const it of roadmap?.items ?? []) if (it.status !== 'shipped') for (const row of it.rows) map.set(row, it);
  return map;
}

/**
 * `soonFor(feature, cell)` for the comparison tables and cards: the badge of the item that changes Markstage's
 * cell in that row, or ''. A badge on a row Markstage already has (✓) stops the build: the mark is never upgraded,
 * and "coming" never sits beside a yes.
 */
export function soonFinder(roadmap, root) {
  const map = itemsByRow(roadmap);
  return (feature, cell) => {
    const it = map.get(feature);
    if (!it) return '';
    if (cell?.mark === 'yes') throw new Error(`site-content/roadmap.md: "${it.id}" is on the row "${feature}", which Markstage already has (✓)`);
    return soonBadge(it, root);
  };
}

const list = (items, root, { link = false } = {}) =>
  items
    .map(
      (it) =>
        `          <li class="rm-item" id="${link ? `soon-${e(it.id)}` : e(it.id)}"><p class="rm-head"><strong>${link ? `<a href="${root}roadmap/#${e(it.id)}">${e(it.title)}</a>` : e(it.title)}</strong> ${soonBadge(it, root, { link: false })}</p><p>${e(it.what)}</p></li>`,
    )
    .join('\n');

/** The groups of the roadmap: being built now, then planned (shipped items are left out). */
const byStatus = (items) => ['in-progress', 'planned'].map((s) => ({ status: s, items: items.filter((i) => i.status === s) })).filter((g) => g.items.length);

/** The "What's coming" section of /compare/: what ships today for AI, then each roadmap group. */
export function comingSection(roadmap, root, { level = 2, today = '' } = {}) {
  if (!roadmap) return '';
  const h = `h${level}`;
  const sub = `h${level + 1}`;
  const groups = byStatus(roadmap.items)
    .map((g) => `        <div class="rm-group"><${sub}>${e(STATUS[g.status].group)}</${sub}>\n        <ul class="rm-list">\n${list(g.items, root, { link: true })}\n        </ul></div>`)
    .join('\n');
  return `      <section aria-labelledby="coming-title" class="coming">
        <${h} id="coming-title">What’s coming</${h}>
        <p>Markstage is pre-release. The marks above are what it does today; a badge beside a mark says a change is on the way. ${today}</p>
        <div class="rm-groups">
${groups}
        </div>
        <p><a href="${root}roadmap/">The whole roadmap</a></p>
      </section>\n`;
}

/** /roadmap/: the items, grouped by status, each with an id the badges link to. */
export function roadmapPage({ roadmap }) {
  const root = '../';
  const path = 'roadmap/';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Roadmap', path },
  ];
  const { meta, items, rendered } = roadmap;
  const groups = byStatus(items)
    .map((g) => `      <section aria-labelledby="rm-${g.status}">\n        <h2 id="rm-${g.status}">${e(STATUS[g.status].group)}</h2>\n        <ul class="rm-list">\n${list(g.items, root)}\n        </ul>\n      </section>`)
    .join('\n');
  const body = `    <main id="main" class="wrap doc wide">
      ${breadcrumbs(trail, root)}
      <h1>${e(meta.h1)}</h1>
      <div class="prose">
${rendered.html}
      </div>
${groups}
      <p class="cta-row left">${button('../compare/', 'How Markstage compares today', 'secondary', ICONS.arrow)}${button(REPO_URL, 'Get Markstage on GitHub', 'text', ICONS.github)}</p>
    </main>`;
  const data = [
    breadcrumbData(trail),
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: meta.h1,
      description: meta.description,
      url: absolute(path),
      dateModified: meta.checked ?? UPDATED,
      about: { '@type': 'SoftwareApplication', name: NAME, url: SITE_URL, codeRepository: REPO_URL },
      publisher: ORGANIZATION,
    },
  ];
  return { path, file: 'roadmap/index.html', html: page({ path, root, title: meta.title, description: meta.description, body, data, og: 'docs', styles: ['compare.css'] }) };
}
