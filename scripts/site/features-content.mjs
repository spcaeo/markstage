// Every user-facing feature of Markstage, for /features/ (features.mjs), the README's feature list and llms.txt.
// Each line was checked against the editor's code (packages/editor/src, packages/server/src) and the docs on
// 2026-11-04: the writer's guide (docs/WRITING.md, made from help-topics.ts) and docs/API-*.md, and the code for
// each line that came from our studies of Ghost's and Prismic's editors. Nothing that is only planned is here; planned work is on /roadmap/ (site-content/roadmap.md).
//
// `doc` is the site path of the page that explains it (a doc page and its anchor); `shot` a screenshot in site/media
// (scripts/site/capture-shots.mjs); `top` marks the main features shown with their screenshot.

export const FEATURE_GROUPS = [
  {
    id: 'writing',
    title: 'Writing',
    lead: 'The block editor people already know from Notion, drawn on your real design instead of grey form fields.',
    items: [
      { id: 'slash', title: 'Type “/” for any block', text: 'On an empty line, “/” opens the block menu: a small drawing of each block, filtered as you type. Or click the “+” beside a line.', doc: 'docs/writing/#block', shot: 'blocks', top: true },
      { id: 'handle', title: 'Drag blocks by their grip', text: 'Every block has a grip. Drag it, or open its menu: move up, down, to the top, to the bottom or to a place you pick, duplicate or delete, with Undo.', doc: 'docs/writing/#move', shot: 'handle', top: true },
      { id: 'palette', title: 'Find anything with ⌘K', text: 'One search box for pages, posts, the editor’s screens and settings. The ones you opened last come first.', doc: 'docs/writing/#open', shot: 'palette', top: true },
      { id: 'format', title: 'A bar over selected words', text: 'Bold, italic, a link, a heading, a list or code. A link searches the site’s own pages, with new tab, nofollow and sponsored beside it.', doc: 'docs/writing/#format' },
      { id: 'markdown-keys', title: 'Markdown shortcuts as you type', text: 'Start a line with # for a heading, - for a list or > for a quote, and type --- for a divider.', doc: 'docs/writing/#format' },
      { id: 'paste-word', title: 'Paste from Word, cleanly', text: 'Word’s lists and headings arrive as real blocks, and its office markup is left behind.', doc: 'docs/writing/#block' },
      { id: 'tables', title: 'Tables you change in place', text: 'A Table menu adds, moves, sorts and deletes rows and columns; Alt and an arrow moves a row.', doc: 'docs/writing/#table' },
      { id: 'outline', title: 'The outline of the page', text: 'Every block in a list, each section under its heading: fold sections, show headings only, drag rows or move several at once.', doc: 'docs/writing/#move', shot: 'outline', top: true },
      { id: 'find', title: 'Find and replace', text: '⌘F finds in the article, ⌥⌘F replaces as well, and one ⌘Z takes a Replace all back.', doc: 'docs/writing/#find' },
      { id: 'mdx', title: 'MDX too', text: 'Type the words of an .mdx file on the page; components show as cards with simple settings in a side panel, and the code stays exactly as written.', doc: 'docs/mdx/' },
      { id: 'source', title: 'The Markdown file itself', text: 'Source shows the file as it is written; Visual brings the page back with your changes.', doc: 'docs/writing/#source' },
      { id: 'guide', title: 'A guide inside the editor', text: 'Press ? for the keyboard shortcuts and “How do I…” topics, each able to point at the part of the screen it is about.', doc: 'docs/writing/#shortcuts' },
    ],
  },
  {
    id: 'pages',
    title: 'Pages, sections and media',
    lead: 'Pages, posts and pictures, edited where they appear, with parts to use again.',
    items: [
      { id: 'canvas', title: 'Edit on the real page', text: 'Each entry is drawn inside its real page, with the site’s components, CSS and column width. JSON pages too, with each section’s fields in a side panel.', doc: 'docs/writing/', shot: 'canvas', top: true },
      { id: 'boxes', title: 'Your site’s own boxes', text: 'FAQ, tips, steps and the other boxes your site defines are drawn as the page shows them; you type straight into them.', doc: 'docs/writing/#block' },
      { id: 'library', title: 'A Library of parts', text: 'Page templates, sections and snippets in folders. A synced item is edited once and every page that uses it follows.', doc: 'docs/api-library/', shot: 'library', top: true },
      { id: 'drop', title: 'Drag a section onto the live page', text: 'On a page made of sections, drag one from the Library onto the page itself; a line says where it will land, and Undo takes it out again.', doc: 'docs/writing/#snippet' },
      { id: 'gallery', title: 'The section gallery', text: 'Every section type and variation your site has, drawn alone by your site at 1440 and 390 pixels wide, light or dark.', doc: 'docs/api-edit/' },
      { id: 'images', title: 'Alt text right on the image', text: 'Caption and alt text under the picture, a switch for decorative images, and widths, crop, rotate and replace in a bar over it.', doc: 'docs/writing/#image' },
      { id: 'media', title: 'Images and files in one place', text: 'Upload, find and reuse; see which images have no alt text or are not used; replace one everywhere it appears.', doc: 'docs/api/', shot: 'media', top: true },
      { id: 'stock', title: 'Stock photos, with your own key', text: 'With an Unsplash or Pexels key on the server, the media library searches free stock photos and keeps each photographer’s name with the photo.', doc: 'docs/deploy/' },
      { id: 'page-types', title: 'Page frames and page types', text: 'Full width, reading or plain, and a page type with the checks that kind of page needs.', doc: 'docs/api-page-types/' },
      { id: 'authors', title: 'Authors and co-authors', text: 'A profile per person, kept as a JSON file, linked from posts, with an author page each.', doc: 'docs/api-authors/' },
      { id: 'translations', title: 'Translation status', text: 'For each region: which titles and descriptions are missing, outdated or done, newest change first.', doc: 'docs/api-translations/' },
      { id: 'integration-fields', title: 'Choices from other systems', text: 'A setting whose options come from a product catalogue or a CRM, fetched from a JSON address on a schedule.', doc: 'docs/api-integrations/' },
    ],
  },
  {
    id: 'team',
    title: 'Team, releases and publishing',
    lead: 'Prismic-style releases, environments and roles, included and free to self-host.',
    items: [
      { id: 'publish', title: 'A publish sheet that checks', text: 'What changes, the checks (the site’s rules, alt text, links, the page on a phone), then now or at a time. By default, a missing alt text or a broken link stops it.', doc: 'docs/writing/#save', shot: 'publish', top: true },
      { id: 'releases', title: 'Releases', text: 'Put several changes into one release, preview the site as it will be, then publish now or at a time, in one commit. Roll it back if you need to.', doc: 'docs/api-releases/', shot: 'releases', top: true },
      { id: 'share', title: 'Share links', text: 'A preview of a release or a draft for people with no account. It expires, can be turned off, stays out of search engines, and counts its views.', doc: 'docs/api-releases/' },
      { id: 'environments', title: 'Local, staging, production', text: 'Each environment is a branch plus a server. Promote code and content together, with checks, screenshots and rules about who may do it.', doc: 'docs/environments/', shot: 'environments', top: true },
      { id: 'edit-button', title: '“Edit this page” on the live site', text: 'People signed in to Markstage get an edit link on the site’s own pages. Visitors see nothing of it.', doc: 'docs/api-edit/' },
      { id: 'commits', title: 'Every save is a commit in your name', text: 'With the Markstage server, a save is a git commit by the person who saved.', doc: 'docs/api/' },
      { id: 'roles', title: 'Roles, as WordPress names them', text: 'Owner, Administrator, Editor, Author and Contributor, decided in one place on the server.', doc: 'docs/api-permissions/' },
      { id: 'custom-roles', title: 'Custom roles', text: 'A translator, a reviewer or an editor who may not upload: limited to collections, locales and even single fields.', doc: 'docs/api-roles/' },
      { id: 'sso', title: 'Single sign-on and two-factor', text: 'Sign in with Google Workspace, Microsoft Entra ID, Okta or any OpenID Connect provider; two-factor codes with recovery codes.', doc: 'docs/api-sso/' },
      { id: 'locks', title: 'Locks', text: 'Lock a block or a section against moving, deleting or changing; the site can set locks on every page.', doc: 'docs/writing/#lock' },
      { id: 'presence', title: 'See who else is editing', text: 'A line under the header says when someone else has the page open, and saves still check the version.', doc: 'docs/api/' },
      { id: 'inbox', title: 'Forms in your own inbox', text: 'The site’s forms post to Markstage on your own host: spam checks, limits, team mail and a daily digest.', doc: 'docs/api-inbox/', shot: 'inbox', top: true },
      { id: 'webhooks', title: 'Webhooks and imports', text: 'Signed webhooks for saves, publishes and new media; entries and media imported from JSON, with a dry run first.', doc: 'docs/api-webhooks/' },
    ],
  },
  {
    id: 'seo',
    title: 'SEO and site health',
    lead: 'Search checks while you write, and links that keep old pages and new ones together.',
    items: [
      { id: 'seo-check', title: 'Search checks while you write', text: 'The search result as Google shows it, measured in pixels; headings in order (a skipped level is flagged); weak links and images without alt text.', doc: 'docs/writing/#seo', shot: 'seo', top: true },
      { id: 'social', title: 'Search and social previews', text: 'Post settings shows the search result and the social card as you type the title, description and cover.', doc: 'docs/writing/#settings' },
      { id: 'phone', title: 'See it on a phone or a tablet', text: 'Pick a screen, and a list says what does not fit: too wide, too small to tap, text too small.', doc: 'docs/writing/#phone' },
      { id: 'link-suggestions', title: 'Link suggestions both ways', text: 'Old pages learn about a new one, and the new one gets the right older pages, each with the sentence to link in.', doc: 'docs/api-links/' },
      { id: 'link-health', title: 'Link health', text: 'Pages no page links to, vague link words, links to old addresses: worst first, each with a one-click fix.', doc: 'docs/writing/#link-health' },
      { id: 'topics', title: 'Topics and a topic map', text: 'Put a page in a topic and its group, so pages in a topic list each other on the site.', doc: 'docs/writing/#topics' },
      { id: 'redirects', title: 'Redirects that follow a move', text: 'When an address changes, the old one goes on working; moved addresses are listed in one place.', doc: 'docs/writing/#settings' },
      { id: 'health', title: 'Site check-up', text: 'Broken links, redirect chains, missing alt text and what the host serves for every address, for the whole site.', doc: 'docs/api/' },
    ],
  },
  {
    id: 'safety',
    title: 'Safety and history',
    lead: 'A save changes only what you changed, and nothing you typed is lost.',
    items: [
      { id: 'surgical', title: 'A save is a clean diff', text: 'Only the changed blocks are rewritten. Open and save with no edit, or move a block and move it back, and the file is byte for byte the same.', doc: 'docs/api/' },
      { id: 'recovery', title: 'Never lose typing', text: 'Your unsaved text is kept in this browser, so a closed tab or a crash loses nothing; the editor offers it again when you come back.', doc: 'docs/writing/#undo' },
      { id: 'merge', title: 'A three-way merge', text: 'When two people change one page, what only one side changed comes in by itself; where both changed a block, you pick yours, theirs or both.', doc: 'docs/api/' },
      { id: 'history', title: 'History of every save', text: 'Compare any two saved versions side by side, and restore one block or the whole page.', doc: 'docs/writing/#undo', shot: 'history', top: true },
      { id: 'trash', title: 'Trash, backups and rollback', text: 'Deleted entries go to the trash first; the server keeps backups, and a release or a promotion can be rolled back.', doc: 'docs/deploy/' },
      { id: 'audit', title: 'An audit log', text: 'Who did what and when, for the owner and administrators.', doc: 'docs/security/' },
      { id: 'preview-origin', title: 'Previews kept apart', text: 'A page with unsaved changes is drawn on an origin of its own, so the page’s code never runs with your session.', doc: 'docs/api-preview/' },
    ],
  },
  {
    id: 'ai',
    title: 'AI and MCP',
    lead: 'AI that drafts, people who publish. Bring your own key; nothing is saved until a person reads it.',
    items: [
      { id: 'mcp', title: 'An MCP server for AI agents', text: 'Claude or any MCP client reads the site and drafts as the person whose token it holds, with the same roles, locks and checks. It never deletes or promotes, and publishes only if you allow it.', doc: 'docs/api-mcp/', shot: 'tokens', top: true },
      { id: 'mcp-relay', title: 'The markstage mcp relay', text: 'For a local client that speaks MCP over stdin and stdout: one command keeps the token and passes each message on.', doc: 'docs/api-mcp/' },
      { id: 'mcp-publish', title: 'Publishing by an agent, only if you allow it', text: 'An owner or administrator may give an agent a publish token, with a plain warning. The site’s checks run first, then its publish rules and roles decide, as for you; each publish names the agent.', doc: 'docs/api-mcp/#publishing' },
      { id: 'ai-rewrite', title: 'Writing help on a selection', text: 'Select words, then Improve with AI: rewrite, shorten, fix the spelling or change the tone. The change shows beside the words; accept, edit or reject it.', doc: 'docs/api-ai/' },
      { id: 'ai-alt', title: 'Alt text suggestions', text: 'Suggest on an image’s Alt line writes a description for you to accept, change or dismiss.', doc: 'docs/api-ai/' },
      { id: 'ai-seo', title: 'Search title and description', text: 'Suggest title and description in the SEO check, next to the result as Google shows it.', doc: 'docs/api-ai/' },
      { id: 'ai-translate', title: 'Translation drafts', text: 'Draft translation under a region in Post settings, for a person to read and save.', doc: 'docs/api-ai/' },
      { id: 'ai-summary', title: 'A promotion summary', text: 'Summarize changes beside a promotion’s reason, in plain words, from what the plan changes.', doc: 'docs/api-ai/' },
      { id: 'ai-providers', title: 'Your choice of AI provider', text: 'Anthropic, any OpenAI-compatible endpoint (OpenAI, Azure, OpenRouter, Together, LM Studio) or Ollama on your own machine with no key.', doc: 'docs/api-ai/#providers' },
    ],
  },
];

export const ALL_FEATURES = FEATURE_GROUPS.flatMap((g) => g.items.map((f) => ({ ...f, group: g.id })));
