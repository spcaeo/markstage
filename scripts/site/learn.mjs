// /faq/ and /glossary/: the built-in FAQ (content.mjs) plus site-content/faq.md, and site-content/glossary.md
// (or the short built-in glossary below until that file exists).
import { NAME, REPO_URL } from './config.mjs';
import { ICONS, absolute, breadcrumbData, breadcrumbs, faqData, page } from './layout.mjs';
import { escapeHtml as e, slugify } from './markdown.mjs';
import { button } from './pages.mjs';

/** Words used on the site and in the editor, in plain English. Used when site-content/glossary.md is missing. */
export const GLOSSARY = [
  { term: 'Visual editor', text: 'An editor that shows content the way readers will see it, so writers change the page itself instead of filling in form fields.' },
  { term: 'Git-based CMS', text: 'A content management system that keeps content as files in a git repository, so every change is a commit with an author, a date and a history.' },
  { term: 'Headless CMS', text: 'A CMS that stores content and serves it to a separate front end through an API. Markstage is not headless: it edits the files your site is built from.' },
  { term: 'Markdown', text: 'A plain-text format for writing: # for headings, - for lists, ** for bold. Posts in Markstage stay Markdown files with YAML front matter.' },
  { term: 'Front matter', text: 'The block of YAML at the top of a Markdown file that holds its title, description, date, author and other settings.' },
  { term: 'Canvas', text: 'The part of the Markstage editor where a writer edits an entry, drawn with the site’s own CSS and, in astro dev, inside the entry’s real page.' },
  { term: 'Block', text: 'One piece of a page: a paragraph, heading, list, table, image, quote or a box the site defines. Blocks can be moved, locked and saved to the Library.' },
  { term: 'Surgical save', text: 'A save that rewrites only the blocks that changed and leaves the rest of the file byte for byte as it was, so a git diff shows exactly the edit.' },
  { term: 'Release', text: 'A set of changes that go live together, now or at a chosen time, after a preview and, when the rules ask for it, an approval.' },
  { term: 'Environment', text: 'A branch plus a server, such as staging or production. Content and code move between them by promotion, with checks.' },
  { term: 'Library', text: 'Markstage’s store of parts to use again: page templates, sections and snippets, kept as files in the site repo.' },
  { term: 'Self-hosted', text: 'Run on a computer or server you control, rather than as a service run by the vendor. Markstage has no cloud of its own.' },
  { term: 'Source-available', text: 'The source code is public and may be read, changed and run, under a licence with some limits. Markstage uses the Elastic License 2.0.' },
];

/** Built-in questions that site-content/faq.md answers in its own words; left out when the file is there. */
const FAQ_FILE_COVERS = new Set(['Is Markstage free?', 'Is the Markstage source code public?', 'Does Markstage need a database for content?', 'Where does Markstage run?']);
/** Built-in terms that site-content/glossary.md defines under another name. */
const GLOSSARY_FILE_COVERS = new Set(['Visual editor']);

const paragraph = (text) => `<p>${e(text)}</p>`;
const known = (items) => new Set(items.map((i) => i.title.toLowerCase()));

/** Unique ids for a page's groups and entries. */
function idMaker() {
  const ids = new Set();
  return (t) => {
    let id = slugify(t);
    while (ids.has(id)) id += '-2';
    ids.add(id);
    return id;
  };
}

/**
 * The FAQ page: site-content/faq.md's questions (its `## Group` + `### Question` or one `## Question` each), then the
 * built-in questions it does not answer. Without the file, the built-in questions alone.
 */
export function faqPage({ builtIn, file = null }) {
  const root = '../';
  const path = 'faq/';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'FAQ', path },
  ];
  const own = builtIn.map((x) => ({ title: x.q, text: x.a, html: paragraph(x.a) }));
  const groups = (file?.groups ?? []).map((g) => ({ title: g.title || 'Common questions', items: g.items }));
  const seen = known(groups.flatMap((g) => g.items));
  const rest = own.filter((q) => !seen.has(q.title.toLowerCase()) && !(file && FAQ_FILE_COVERS.has(q.title)));
  if (rest.length) groups.push({ title: file ? 'How Markstage works' : 'About Markstage', items: rest });
  const all = groups.flatMap((g) => g.items);
  const idOf = idMaker();
  const meta = file?.meta ?? {};
  const body = `    <main id="main" class="wrap doc">
      ${breadcrumbs(trail, root)}
      <h1>${e(meta.h1 ?? 'Markstage questions and answers')}</h1>
      <p class="lead left">What Markstage is, what it costs, where it runs and how it treats your files, answered in plain words.</p>
${groups
  .map((g) => {
    const gid = idOf(`g-${g.title}`);
    return `      <section aria-labelledby="${gid}">
        <h2 id="${gid}">${e(g.title)}</h2>
${g.items.map((q) => `        <div class="qa" id="${idOf(q.title)}"><h3>${e(q.title)}</h3>${q.html}</div>`).join('\n')}
      </section>`;
  })
  .join('\n')}
      <p class="cta-row left">${button(REPO_URL, 'Get Markstage on GitHub', 'primary', ICONS.github)}${button('../docs/', 'Read the docs', 'text')}</p>
    </main>`;
  return {
    path,
    file: 'faq/index.html',
    html: page({
      path,
      root,
      title: meta.title ?? 'Markstage FAQ: Price, Licence, Hosting and Files',
      description:
        meta.description ?? 'Answers about Markstage, the visual editor for Astro: is it free, how it is licensed, where it runs, what it does to your Markdown files and how teams use it.',
      body,
      data: [breadcrumbData(trail), faqData(all.map((q) => ({ question: q.title, answer: q.text })))],
      og: 'learn',
      current: 'faq',
      modified: meta.checked,
    }),
  };
}

/**
 * The glossary: site-content/glossary.md's terms, then the built-in Markstage words it does not define. Without the
 * file, the built-in list alone.
 */
export function glossaryPage({ file = null }) {
  const root = '../';
  const path = 'glossary/';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Glossary', path },
  ];
  const own = GLOSSARY.map((t) => ({ title: t.term, text: t.text, html: paragraph(t.text) }));
  let groups;
  if (file) {
    groups = file.groups.map((g) => ({ title: g.title || 'Astro and CMS terms', items: g.items }));
    const seen = known(groups.flatMap((g) => g.items));
    const rest = own.filter((t) => !seen.has(t.title.toLowerCase()) && !GLOSSARY_FILE_COVERS.has(t.title));
    if (rest.length) groups.push({ title: 'Words used in Markstage', items: rest });
  } else {
    groups = [{ title: '', items: own }];
  }
  const idOf = idMaker();
  const gids = groups.map((g) => (g.title ? idOf(`g-${g.title}`) : ''));
  const terms = groups.flatMap((g) => g.items).map((t) => ({ ...t, id: idOf(t.title) }));
  const byTitle = new Map(terms.map((t) => [t.title, t.id]));
  const set = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    name: `${NAME} glossary`,
    url: absolute(path),
    hasDefinedTerm: terms.map((t) => ({ '@type': 'DefinedTerm', name: t.title, description: t.text, url: absolute(`${path}#${t.id}`) })),
  };
  const groupHtml = (g, i) => {
    const h = g.title ? 3 : 2;
    const list = g.items.map((t) => `        <div class="term" id="${byTitle.get(t.title)}"><h${h}>${e(t.title)}</h${h}>${t.html}</div>`).join('\n');
    return g.title ? `      <section aria-labelledby="${gids[i]}">\n        <h2 id="${gids[i]}">${e(g.title)}</h2>\n${list}\n      </section>` : list;
  };
  const meta = file?.meta ?? {};
  const body = `    <main id="main" class="wrap doc">
      ${breadcrumbs(trail, root)}
      <h1>${e(meta.h1 ?? 'Glossary: visual editing, git-based CMS and Astro terms')}</h1>
      <p class="lead left">Plain definitions of the words used around Markstage: visual editors, git-based and headless CMSs, Markdown, releases, environments and more.</p>
      <nav class="toc" aria-label="Terms"><ul class="inline-list">${terms.map((t) => `<li><a href="#${t.id}">${e(t.title)}</a></li>`).join('')}</ul></nav>
      <div class="glossary">
${groups.map(groupHtml).join('\n')}
      </div>
      <p class="cta-row left">${button('../docs/writing/', 'See how writing works', 'secondary', ICONS.arrow)}${button('../faq/', 'Questions and answers', 'text')}</p>
    </main>`;
  return {
    path,
    file: 'glossary/index.html',
    html: page({
      path,
      root,
      title: meta.title ?? 'Glossary: Visual Editor, Git-based CMS, Astro | Markstage',
      description:
        meta.description ?? 'What a visual editor, git-based CMS, headless CMS, front matter, surgical save, release and environment mean, in plain words, from the makers of Markstage.',
      body,
      data: [breadcrumbData(trail), set],
      og: 'learn',
      current: 'glossary',
      modified: meta.checked,
    }),
  };
}
