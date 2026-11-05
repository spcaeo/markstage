// The words of the public site that are not in a Markdown file: the docs list (which docs/*.md become
// /docs/<id>/, with their search titles), the install steps and the built-in FAQ. The home page's cards are in
// home-content.mjs and the feature list in features-content.mjs. Every claim here is in the
// README or in docs/*.md; keep it that way.

/**
 * The user-facing docs, in the order of the docs index. `file` is in docs/; `title` is the page's H1 and `seo` its
 * <title> (at most 60 characters; " | Markstage" is added when it fits and the name is not in it already); `summary` is the meta description (110 to 160 characters);
 * `toc: false` leaves out the page's "On this page" list.
 * Left out on purpose (internal plans and checklists): EDITOR-SCENARIOS, EDITOR-UX, UX-BENCHMARK, FROM-PRISMIC,
 * PUBLISHING, RELEASES, OPERATIONS, SEO, CANVAS-FIDELITY and ARCHITECTURE (it still reads as a build plan).
 */
export const DOC_GROUPS = [
  {
    title: 'Guides',
    docs: [
      {
        id: 'writing',
        file: 'WRITING.md',
        title: 'Writing with Markstage',
        seo: 'How to Write and Edit Posts in Markstage',
        // the guide starts with its own list of topics
        toc: false,
        summary: 'How writers use Markstage: open and start articles, add blocks, save and go live, use the Library, fix links, check SEO and bring back an older version.',
      },
      {
        id: 'config',
        file: 'CONFIG.md',
        title: 'markstage.config: every key',
        seo: 'markstage.config Reference: Set Up a Site',
        summary: 'Set up an Astro site for Markstage in one file: collections, page URLs, settings fields, frames, page types, topics, forms, media and the editor canvas.',
      },
      {
        id: 'deploy',
        file: 'DEPLOY.md',
        title: 'Deploying Markstage',
        seo: 'Deploy Markstage with Docker or systemd and nginx',
        summary: 'Run the Markstage server next to your static site with Docker compose, or with systemd and nginx: data dir, config, the built editor, previews and backups.',
      },
      {
        id: 'docker',
        file: 'DOCKER.md',
        title: 'Markstage with Docker',
        seo: 'Run Markstage with Docker: One docker run',
        summary: 'Run the Markstage server image next to your site with one docker run or compose: what happens at start, folders, settings, secrets, updates and tests.',
      },
      {
        id: 'starter',
        file: 'STARTER.md',
        title: 'The starter site',
        seo: 'Start a New Astro Blog with Markstage',
        summary: 'Start a new site from the Markstage starter: a small Astro blog with Markdown posts, an MDX guide and the editor set up, made with one script from a clone.',
      },
      {
        id: 'environments',
        file: 'ENVIRONMENTS.md',
        title: 'Environments: local, staging, production',
        seo: 'Staging and Production Environments in Markstage',
        summary: 'How Markstage moves content and code between local, staging and production: branches, promotions with checks and screenshots, rules and a shared git remote.',
      },
      {
        id: 'security',
        file: 'SECURITY.md',
        title: 'Markstage server: security',
        seo: 'Markstage Security: Threat Model and Controls',
        summary: 'How the self-hosted Markstage server protects a content site: sign-in, sessions, two-factor, roles, previews on their own origin, and the test behind each.',
      },
    ],
  },
  {
    title: 'API and integrations',
    docs: [
      { id: 'api', file: 'API.md', title: 'Markstage API (contract)', seo: 'Markstage API Reference: Content, Media and Users', summary: 'The HTTP API the Markstage editor and server share: sign-in, collections and entries, saves, publishing, media, users, revisions and the error shapes.' },
      { id: 'mdx', file: 'MDX.md', title: 'Editing MDX', seo: 'Edit MDX in Markstage: Words on the Page, Code Kept', summary: 'How Markstage edits MDX: words typed on the page, components as cards with simple settings, and imports, exports and code kept as written.' },
      { id: 'api-mcp', file: 'API-MCP.md', title: 'The MCP server: AI agents', seo: 'Markstage MCP Server: Let AI Agents Draft Content', summary: 'Connect an AI agent to Markstage over the Model Context Protocol: it reads the site and drafts changes as the person whose token it holds, and never publishes.' },
      { id: 'api-ai', file: 'API-AI.md', title: 'AI suggestions', seo: 'AI Suggestions in Markstage: Alt Text and SEO Titles', summary: 'Ask a model for words you then read, change and save: image alt text, search titles and descriptions, summaries, and drafts for other locales.' },
      { id: 'api-library', file: 'API-LIBRARY.md', title: 'The Library', seo: 'Markstage Library: Templates, Sections and Snippets', summary: 'One store of parts to use again: page templates, sections and snippets, synced or copied, kept as files in the repo, imported from WordPress or a web page.' },
      { id: 'api-releases', file: 'API-RELEASES.md', title: 'Releases and share links', seo: 'Markstage Releases: Go Live Together, Share Previews', summary: 'Put several changes live together, now or at a set time, with approvals and rules, and share a preview of a release or a draft with people who have no account.' },
      { id: 'api-env', file: 'API-ENV.md', title: 'Environments API', seo: 'Markstage Environments API: Promote and Sync', summary: 'The server routes and command line behind environments: status, branches on the remote, plans that promote or sync content, and the checks that guard them.' },
      { id: 'api-links', file: 'API-LINKS.md', title: 'Topics and internal links', seo: 'Internal Links in Markstage: Topics and Link Suggestions', summary: 'Markstage keeps a map of every link in the site and suggests fixes both ways, so old pages link to new ones and new pages link to the right older ones.' },
      { id: 'api-page-types', file: 'API-PAGE-TYPES.md', title: 'Page frames and page types', seo: 'Page Frames and Page Types in Markstage', summary: 'Two settings a page keeps in its own file: the frame the site lays it out in (full width, reading or plain) and its page type, with the checks each type needs.' },
      { id: 'api-authors', file: 'API-AUTHORS.md', title: 'Authors', seo: 'Author Profiles in Markstage: Posts and Co-authors', summary: 'Ghost-style author profiles kept as JSON files in the site content: one per person, linked from posts by slug, with co-authors and an author page each.' },
      { id: 'api-roles', file: 'API-ROLES.md', title: 'Custom roles', seo: 'Custom Roles in Markstage: Translators, Reviewers', summary: 'Beyond the five built-in roles: a custom role for a translator, a reviewer or an editor who may not upload, limited to collections, locales and fields.' },
      { id: 'api-permissions', file: 'API-PERMISSIONS.md', title: 'Permissions', seo: 'Markstage Permissions: What Each Role May Do', summary: 'Who may do what in Markstage, by role: owner, administrator, editor, author and contributor, the WordPress names, decided in one place on the server.' },
      { id: 'api-sso', file: 'API-SSO.md', title: 'Single sign-on (OpenID Connect)', seo: 'Single Sign-On for Markstage with OpenID Connect', summary: 'Let people sign in to Markstage with Google Workspace, Microsoft Entra ID, Okta, Auth0, Keycloak or any OpenID Connect provider, with passwords kept or limited.' },
      { id: 'api-webhooks', file: 'API-WEBHOOKS.md', title: 'Webhooks', seo: 'Markstage Webhooks: Tell Other Systems What Changed', summary: 'Tell another system when something happens on the site: an entry saved or published, a media file added, the site gone live. Each webhook lists its events.' },
      { id: 'api-import', file: 'API-IMPORT.md', title: 'Importing entries and media', seo: 'Import Content and Media into Markstage', summary: 'Bring entries and media files from another system as JSON: a dry-run plan first, nothing written or fetched, then the run of that plan as one job.' },
      { id: 'api-inbox', file: 'API-INBOX.md', title: 'Forms, messages and alerts', seo: 'Markstage Forms Inbox, Messages and Alerts', summary: 'The site forms post to Markstage on your own host: spam checks, limits, team mail and thank-you mail, the Inbox for messages and who hears about which alerts.' },
      { id: 'api-translations', file: 'API-TRANSLATIONS.md', title: 'Translation status', seo: 'Translation Status for Multilingual Sites in Markstage', summary: 'For a site with several locales: whether each entry’s words are missing, outdated or done in each language, and the list of what still needs translating.' },
      { id: 'api-integrations', file: 'API-INTEGRATIONS.md', title: 'Integration fields', seo: 'Markstage Integration Fields: Choices from Other Systems', summary: 'A Post settings choice whose options come from another system, such as a product catalogue or a CRM’s plans, fetched from a JSON address on a schedule.' },
      { id: 'api-preview', file: 'API-PREVIEW.md', title: 'Preview render', seo: 'Markstage Preview: Unsaved Changes on the Real Page', summary: 'How Markstage shows a page with unsaved changes on the site’s own dev server, on an origin of its own, so author HTML never runs with the editor’s session.' },
      { id: 'api-edit', file: 'API-EDIT.md', title: 'Section gallery and “Edit this page”', seo: 'Section Gallery and Edit This Page Links in Markstage', summary: 'Every section type the site’s pages use, drawn by the site’s own components, and an “Edit this page” link on the live site for people signed in to Markstage.' },
    ],
  },
];

export const DOCS = DOC_GROUPS.flatMap((g) => g.docs);

/** Install in three steps. `cmd` lines get the shared copy icon. */
export const INSTALL = [
  {
    title: 'Try the example blog',
    text: 'Markstage is not on npm yet: install it from a clone. Clone the repo, install, and open the editor on the example blog. Needs Node.js 22.13 or newer and git.',
    url: 'http://127.0.0.1:18233/markstage/',
    cmd: ['git clone https://github.com/spcaeo/markstage.git', 'cd markstage && npm install', 'npm run dev -w examples/blog'],
  },
  {
    title: 'Add it to your Astro site',
    text: 'Your site needs Astro 7.4 or newer. In your site’s folder next to the clone, link the packages (they are not on npm yet), add markstage() to the integrations in astro.config.mjs and describe your collections in markstage.config.mjs.',
    cmd: ['npm install ../markstage/packages/core ../markstage/packages/editor ../markstage/packages/astro'],
    doc: 'config',
  },
  {
    title: 'Run the server for your team',
    text: 'Self-host the Markstage server next to your static site: one docker run with the server image, Docker compose, or systemd and nginx. Sign-in, roles, releases and backups come with it.',
    doc: 'docker',
  },
];

/** The home page FAQ (also on /faq/). Plain text answers; every fact is in the README or docs. */
export const FAQ = [
  {
    q: 'What is Markstage?',
    a: 'Markstage is a visual editor for Markdown, MDX and JSON content sites. Writers edit on the site’s own design instead of in form fields, and every save is a clean git diff of exactly what they changed (with the Markstage server, a commit in their name). Its first adapter is Astro.',
  },
  {
    q: 'Is Markstage free?',
    a: 'Yes. Markstage is source-available under the Elastic License 2.0: you may use, copy, change and self-host it for free, including in your business and for your clients’ sites. You may not offer it to others as a hosted or managed service without a commercial licence from Space-O Technologies.',
  },
  {
    q: 'Is the Markstage source code public?',
    a: 'Yes. The code is public on GitHub, free to read, change, use and self-host. Markstage is source-available, not open source in the OSI sense: it may not be resold as a hosted service without a commercial licence.',
  },
  {
    q: 'Does Markstage need a database for content?',
    a: 'No. Content stays as Markdown and JSON files in your git repo. One SQLite file on the server (node:sqlite, built into Node.js 22.13 and newer) holds people, sessions, the inbox, drafts in progress, trash, releases, the media index and the audit log. There is no database server to install.',
  },
  {
    q: 'Which frameworks does Markstage support?',
    a: 'Astro today, through the @markstage/astro integration. The core (the document model and the Markdown converter) has no framework in it, so other adapters can follow.',
  },
  {
    q: 'Will Markstage rewrite my Markdown files?',
    a: 'Only the blocks you change. Opening and saving a file with no edit leaves it byte for byte the same, and moving a block and moving it back gives an identical file, so a review shows exactly what moved.',
  },
  {
    q: 'Where does Markstage run?',
    a: 'On your own computer in astro dev, with no sign-in and on 127.0.0.1 only, and on your own server for a team: Docker compose, or systemd and nginx. There is no Markstage cloud.',
  },
  {
    q: 'Can an AI agent edit my site through Markstage?',
    a: 'An agent that speaks the Model Context Protocol can read the site and draft changes as the person whose token it holds. It never publishes, deletes or promotes anything on its own: a person reviews its release and puts it live.',
  },
];
