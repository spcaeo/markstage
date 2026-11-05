// /features/ (every feature, grouped, from features-content.mjs) and /ai/ (what ships today for AI and MCP, and
// what is coming, from site-content/roadmap.md). Each returns `{ path, file, html }`.
import { NAME, REPO_URL, SITE_URL, UPDATED } from './config.mjs';
import { DOCS } from './content.mjs';
import { ALL_FEATURES, FEATURE_GROUPS } from './features-content.mjs';
import { isAiItem } from './home-content.mjs';
import { ICONS, ORGANIZATION, absolute, breadcrumbData, breadcrumbs, command, page } from './layout.mjs';
import { escapeHtml as e } from './markdown.mjs';
import { button, figure } from './pages.mjs';
import { soonBadge, STATUS } from './roadmap.mjs';

/** The doc a feature links to, by its site path (`docs/<id>/#anchor`), with the doc's title for the link. */
function docLink(doc, root) {
  const id = /^docs\/([a-z0-9-]+)\//.exec(doc)?.[1];
  const d = DOCS.find((x) => x.id === id);
  return d ? `<a class="more" href="${root}${doc}">${e(d.title)}</a>` : '';
}

function webPage(path, name, description) {
  return { '@context': 'https://schema.org', '@type': 'WebPage', name, description, url: absolute(path), dateModified: UPDATED, isPartOf: { '@type': 'WebSite', name: NAME, url: SITE_URL }, about: { '@type': 'SoftwareApplication', name: NAME, url: SITE_URL }, publisher: ORGANIZATION };
}

/** One feature: the main ones with their screenshot beside them, the rest as cards. */
function featureHtml(f, media, root) {
  const shot = f.top && f.shot ? figure(media, f.shot, `${f.title}: ${f.text}`, root) : '';
  const text = `<h3>${e(f.title)}</h3><p>${e(f.text)}</p>${docLink(f.doc, root)}`;
  return shot ? `<article class="feat-top" id="${f.id}"><div class="feat-text">${text}</div>${shot}</article>` : `<article class="f" id="${f.id}">${text}</article>`;
}

export function featuresPage({ media }) {
  const root = '../';
  const path = 'features/';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Features', path },
  ];
  const description = `Every Markstage feature in plain words: Notion-style writing on the real page, sections and media, releases and roles, SEO, history, AI and MCP.`;
  const groups = FEATURE_GROUPS.map((g) => {
    const tops = g.items.filter((f) => f.top && f.shot && media[f.shot]);
    const rest = g.items.filter((f) => !tops.includes(f));
    return `      <section class="sec feat-group" id="${g.id}" aria-labelledby="${g.id}-title">
        <div class="wrap">
          <div class="sec-head"><p class="kick">${g.items.length} features</p><h2 id="${g.id}-title">${e(g.title)}</h2><p class="lede">${e(g.lead)}</p></div>
${tops.map((f) => `          ${featureHtml(f, media, root)}`).join('\n')}
          <div class="grid3">${rest.map((f) => featureHtml({ ...f, top: false }, media, root)).join('')}</div>
        </div>
      </section>`;
  }).join('\n');
  const body = `    <main id="main" class="features">
      <div class="wrap page-head">
        ${breadcrumbs(trail, root)}
        <p class="kick">${ALL_FEATURES.length} features, all in the free self-hosted editor</p>
        <h1>Markstage features, <span class="mark">in plain words</span>.</h1>
        <p class="lead left">Each feature below works today in the example blog that comes with the code, and links to the page of the docs that explains it. Planned work is on the <a href="${root}roadmap/">roadmap</a>, never here.</p>
        <nav class="jump" aria-label="Feature groups"><ul class="chips">${FEATURE_GROUPS.map((g) => `<li><a href="#${g.id}">${e(g.title)}</a></li>`).join('')}</ul></nav>
      </div>
${groups}
      <section class="wrap cta-end" aria-labelledby="try-title">
        <h2 id="try-title">Try it on the example blog</h2>
        <p>Clone the repository, install, and open the editor on the example blog: every feature above is there.</p>
        <p class="cta-row">${button(`${root}#install`, 'Install in three steps', 'primary')}${button(REPO_URL, 'Get it on GitHub', 'ink', ICONS.github)}</p>
      </section>
    </main>`;
  return {
    path,
    file: 'features/index.html',
    html: page({
      path,
      root,
      title: 'Markstage Features: Notion-Style Editing for Astro Sites',
      description,
      body,
      data: [breadcrumbData(trail), webPage(path, 'Markstage features', description)],
      og: 'features',
      current: 'features',
      modified: UPDATED,
      styles: ['home.css'],
    }),
  };
}

/** Where each AI suggestion is, in the editor's own words (docs/WRITING.md "Get a suggestion from the AI"). */
const SUGGESTIONS = [
  ['Alt text', 'Suggest on an image’s Alt line, in an image’s settings, under a cover’s alt text, or under a picture’s alt text on a page.'],
  ['Search title and description', 'Suggest title and description in the SEO check, next to the search result as Google shows it.'],
  ['A translation draft', 'Draft translation under a region in Post settings, for a page in another of the site’s languages.'],
  ['A promotion summary', 'Summarize changes beside a promotion’s reason: what moving staging to production changes, in plain words.'],
  ['Better words for a selection', 'Select words on the page, then Improve with AI in the format bar: rewrite, shorten, fix the spelling and grammar, or change the tone. The change shows beside the words; accept, edit or reject it.'],
];

const MCP_FACTS = [
  ['As a person, never more', 'An agent acts as the person whose token it holds: the same role, the same locks, the same checks and the site’s own rules. A token reads, or reads and drafts; it lasts 1 to 90 days.'],
  ['Drafts, unless you allow more', 'It creates and changes drafts, and puts changes to live pages into a release that is not scheduled. It never deletes, moves or promotes anything, and by default a person reviews the release and puts it live.'],
  ['Publishing only if you allow it', 'An owner or administrator may give an agent a publish token, with a plain warning. The site’s checks run first and a failed one stops it; then the publish rules and roles decide as they would for that person. Every such publish names the agent, and a token publishes at most 5 times an hour.'],
  ['Lossless', 'It reads and writes an entry as its file’s text, so a change touches only what the agent changed. Locked and synced blocks are refused, naming the block.'],
  ['Every write is a commit', 'A draft the agent saves is a git commit that names the agent and its token, so the history shows who did what.'],
];

export function aiPage({ media, roadmap }) {
  const root = '../';
  const path = 'ai/';
  const trail = [
    { name: 'Home', path: '' },
    { name: 'AI and MCP', path },
  ];
  const description = 'AI in Markstage: an MCP server where agents draft as a person and publish only if you allow it, and AI suggestions you read before anything is saved.';
  const coming = (roadmap?.items ?? []).filter((i) => isAiItem(i) && i.status !== 'shipped');
  const comingHtml = coming.length
    ? `      <section class="sec" id="coming" aria-labelledby="coming-title">
        <div class="wrap">
          <div class="sec-head"><p class="kick">Coming</p><h2 id="coming-title">What’s next for AI</h2><p class="lede">From the roadmap. Nothing here ships today; the badge says when it is planned.</p></div>
          <div class="grid3">${coming.map((i) => `<article class="f"><p>${soonBadge(i, root)}</p><h3>${e(i.title)}</h3><p>${e(i.what)}</p></article>`).join('')}</div>
          <p><a href="${root}roadmap/">The whole roadmap</a> · ${e(Object.values(STATUS).filter((s) => s.label).map((s) => s.label).join(' and '))} mark what is being built and what comes later.</p>
        </div>
      </section>\n`
    : '';
  const body = `    <main id="main" class="ai">
      <div class="wrap page-head">
        ${breadcrumbs(trail, root)}
        <h1><span class="kick">AI and MCP in Markstage</span> <span class="h1-line">AI that drafts. <span class="mark">People who publish.</span></span></h1>
        <p class="lead left">Markstage works with AI in two ways today: an MCP server, so an agent such as Claude can read your site and draft changes, and suggestions in the editor for the words people find slow to write. You bring your own key, and nothing reaches the site until a person has read it.</p>
      </div>

      <section class="sec band-dark" id="mcp" aria-labelledby="mcp-title">
        <div class="wrap">
          <div class="sec-head"><p class="kick">Ships today</p><h2 id="mcp-title">The MCP server</h2><p class="lede">Claude, or any client of the Model Context Protocol, connects to your Markstage server with a token a person made for it.</p></div>
          <div class="grid2">${MCP_FACTS.map(([t, x]) => `<article class="f"><h3>${e(t)}</h3><p>${e(x)}</p></article>`).join('')}</div>
          <div class="ai-how">
            <div>
              <h3>Connect a local client</h3>
              <p>Make a token in Settings → Tokens (“New AI assistant token”), then keep it with the <code>markstage mcp</code> relay, which passes each message from a client that starts a command on to your server:</p>
              ${command('npx markstage mcp login https://cms.example.com', 'command')}
              <p>A client that speaks HTTP itself uses the MCP address the token screen shows, with the token as a bearer header.</p>
              <p><a href="${root}docs/api-mcp/">The MCP server, in full</a></p>
            </div>
            ${figure(media, 'tokens', 'Settings, Tokens: the form for a new AI assistant token, with reading always on and writing drafts ticked only when asked for', root)}
          </div>
        </div>
      </section>

      <section class="sec" id="suggestions" aria-labelledby="suggest-title">
        <div class="wrap">
          <div class="sec-head"><p class="kick">Ships today</p><h2 id="suggest-title">AI suggestions in the editor</h2><p class="lede">Each suggestion sits next to the value it is for. Accept, edit then accept, or dismiss: nothing changes until you accept, and ⌘S saves it like any change.</p></div>
          <div class="grid2">${SUGGESTIONS.map(([t, x]) => `<article class="f"><h3>${e(t)}</h3><p>${e(x)}</p></article>`).join('')}</div>
          <ul class="ticks">
            <li>Bring your own key: the person who runs the server sets <code>MARKSTAGE_AI_KEY</code> or a key file. Without one, everything else works and the editor says why suggestions are off.</li>
            <li>Anthropic’s models answer today; the model and the limits per minute and per day are set on the server.</li>
            <li>A suggestion writes no file and no commit. Accepting it goes through the editor’s normal save, with the same rights, locks and checks.</li>
          </ul>
          <p><a href="${root}docs/api-ai/">AI suggestions, in full</a></p>
        </div>
      </section>
${comingHtml}
      <section class="wrap cta-end" aria-labelledby="ai-start-title">
        <h2 id="ai-start-title">Free to self-host, AI included</h2>
        <p>The MCP server and the suggestions come with the Markstage server. There is no Markstage cloud and no AI plan to buy.</p>
        <p class="cta-row">${button(REPO_URL, 'Get it on GitHub', 'ink', ICONS.github)}${button(`${root}features/`, 'See every feature', 'secondary')}</p>
      </section>
    </main>`;
  return {
    path,
    file: 'ai/index.html',
    html: page({
      path,
      root,
      title: 'Markstage AI and MCP: Agents Draft, People Publish',
      description,
      body,
      data: [breadcrumbData(trail), webPage(path, 'AI and MCP in Markstage', description)],
      og: 'ai',
      current: 'ai',
      modified: UPDATED,
      styles: ['home.css'],
    }),
  };
}
