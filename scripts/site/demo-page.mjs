// The live demo's landing page (site/demo/index.html): what the demo is, what works in it and what says "not in
// the demo", the short video, and the button into the editor. The editor and the sample blog under it are built by
// the Pages workflow (npm run demo:build, docs/DEMO.md); this page is the crawlable one, the editor is noindex.
import { DEMO_PATH, DEMO_START, NAME, REPO_URL } from './config.mjs';
import { ICONS, breadcrumbData, breadcrumbs, page } from './layout.mjs';
import { escapeHtml as e } from './markdown.mjs';
import { button, demoVideo } from './pages.mjs';

const WORKS = [
  'Open any post of the sample blog, drawn on its own page with the blog’s design',
  'Type on the page: headings, lists, links, tables, the block menu (/) and the toolbar',
  'Switch to Source mode and edit the Markdown as written',
  'Press Save and see the git diff the save would commit, changing only what you changed',
  'Look around: Home, Blog posts, the publish checks, History, the Library, Site settings',
];
const NOT_HERE = ['Publishing and scheduling', 'Releases and environments', 'Users, roles and sign-in', 'Settings changes', 'Uploads and the media library', 'AI suggestions'];

export function demoPage({ media, video = false }) {
  const root = '../';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Live demo', path: DEMO_PATH },
  ];
  const body = `    <main id="main" class="wrap doc demo-landing">
      ${breadcrumbs(trail, root)}
      <h1>Try ${NAME} in your browser</h1>
      <p class="lead left">The real ${NAME} editor on a sample Astro blog, with no sign-up and nothing to install. Edit a post on its own page, save it, and see the git diff the save would commit. Nothing is sent anywhere: your edits stay in this browser tab.</p>
      <p class="cta-row left">${button(DEMO_START, 'Open the live demo', 'primary', ICONS.arrow)}${button('blog/', 'See the sample blog', 'secondary')}${button(`${root}#install`, 'Install it for real', 'text')}</p>
      ${demoVideo(media, root, { video })}
      <section aria-labelledby="works-title">
        <h2 id="works-title">What you can do in the demo</h2>
        <ul class="ticks">
${WORKS.map((t) => `          <li>${e(t)}</li>`).join('\n')}
        </ul>
      </section>
      <section aria-labelledby="not-title">
        <h2 id="not-title">What needs a running install</h2>
        <p>These open in the demo so you can see them, and each change says “Not in the demo: install ${NAME} to try this”, with a link to the install steps:</p>
        <ul>
${NOT_HERE.map((t) => `          <li>${e(t)}</li>`).join('\n')}
        </ul>
      </section>
      <section aria-labelledby="how-title">
        <h2 id="how-title">How the demo works</h2>
        <p>It is the same editor a ${NAME} server serves, built as static files. What a server would answer when the editor reads (the posts, the lists, the checks) was recorded from a real server running the sample blog. A save runs ${NAME}’s own Markdown writer in your browser, so the file text and the diff are what a server would commit. The strip at the top of the editor has <strong>Your changes</strong> and <strong>Reset demo</strong>.</p>
        <p><a href="${REPO_URL}/blob/main/docs/DEMO.md" target="_blank" rel="noopener">How the demo is built</a> · <a href="${root}docs/">Read the docs</a></p>
      </section>
    </main>`;
  return {
    path: DEMO_PATH,
    file: `${DEMO_PATH}index.html`,
    html: page({
      path: DEMO_PATH,
      root,
      title: 'Live demo: try the Markstage editor, no sign-up',
      description: 'Try Markstage in your browser: open a sample Astro blog post, edit it on its real page, save, and see the git diff the save would commit. No sign-up.',
      body,
      data: [breadcrumbData(trail)],
      current: 'demo',
      styles: ['home.css'],
    }),
  };
}
