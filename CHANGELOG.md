# Changelog

What changed in each Markstage release, in plain words. The newest is first. Versions follow
[semantic versioning](https://semver.org); while Markstage is 0.x, a minor version may change how things work.
docs/RELEASES.md says how a release is made.

## Unreleased

### Added

- The real page on the server, too: with `canvas.shell` on, the built editor on a Markstage server draws each
  article inside its real page, as `astro dev` does (the site's header, columns and footer, its widths and
  breakpoints, "What readers see"). The page is the entry's last build: the site's own (`verify.public`, or
  `verify.private` for a protected page) or a share link's build of the draft, whichever is newer. A draft never
  built yet opens on the sheet of paper with a quiet note, "The page around the text shows here after the site's
  next build." API: `GET preview/:c/:id/shell` (signed in) answers the page's HTML and its own stylesheets of the
  same build as JSON, with an ETag; `GET /markstage/shell-frame` is the sandboxed frame the page's first `<head>`
  scripts run in (docs/CANVAS-FIDELITY.md "On a server").
- Safety: no script of the page runs on the CMS origin (the same sanitising as in dev; head scripts only in a frame
  with no origin), no file is read outside the build folder, nothing is fetched by address (a stylesheet or
  `@import` on another host is left out), and the page (4 MB) and its stylesheets (2 MB each, 8 MB and 64 in all)
  are capped. The built site's fonts and images (`/_astro/…`) are answered on the CMS origin to signed-in people.
- `markstage build-editor` fences the editor's own copy of the site's CSS out of the page around the canvas, as
  `astro dev` does at run time. The fidelity guard takes `--page-base` and `--storage-state` (`pageBase`,
  `storageState`) to measure a server's canvas against the built site.
- The fidelity guard checks contrast too, in every theme: every run of text on the canvas and in the article around
  it at least 4.5:1 against what is really behind it (`canvas-contrast.mjs`). Markstage runs it at 1440 and 390,
  light and dark, on the example blog in `astro dev` and on a server, on the starter, and on the live demo.

- AI link suggestions (Post settings › Topic and links › Suggest links with AI, on a site that keeps topics): up to
  five pages of the site's own link index to link from the open article, each with the words to link and one line on
  why. The server checks every suggestion before a writer sees it: the page is there, live or a draft the writer may
  see, not linked from this page yet, and the words are in the text; anything else is left out and counted. Add link
  links the words on the canvas as one change (⌘Z takes it back, ⌘S saves only that link); Dismiss drops it.
- Suggest a fix in the SEO check: for a search title or description that is too long or too short, a missing
  description, a heading out of order or empty, vague link words such as "click here", or an image with no alt text.
  The fix shows under the problem as a diff with Accept, Edit then accept and Reject, and the server drops an answer
  that would not fix the problem (a "shorter" title that is not shorter, a heading level still out of order).
- The SEO check now names vague link words ("click here", "read more"), with the same list as the link map's Health.
- Each new state has its URL (`?s=1&suggest=links`, `?side=seo&suggest=fix&fix=<id>`); Back and Forward walk them.
  With AI off the buttons are not there, and a link that asks anyway says why. API: the `links` and `fix` kinds, and
  `problem` on the `seo` kind (docs/API-AI.md).
- Translate the site with AI (Languages › Translate the site with AI, `#/translate`): an AI draft of every entry's
  title and description in one region, in one run. The plan comes first and writes nothing: how many entries, about
  how many characters and tokens, how long under the person's AI limits, and which are skipped and why (translated
  already, a draft waiting, the role cannot write that region's words). The run goes on on the server (leave the page
  and it carries on), waits for the minute's limit, pauses at the day's, and can be paused, resumed and cancelled.
  The report lists what was drafted, skipped and failed, in plain words, with a To review list.
- The drafts are kept beside the site in `markstage/translations/<code>.json`, 25 to a commit in the name of the
  person who ran it, never in a page: nothing is published and nobody's words are replaced. Post settings shows a
  waiting draft first ("Review the AI draft"): Accept puts it in the fields and ⌘S saves it as any change; Discard
  drops it. A draft whose field someone has written since is done with.
- Editors and up may run it, or a custom role that writes that region's words; a token or an agent may not. Each ask
  is audited as `ai.suggest`, the run as `translate.*`. On the server: `markstage-server translate --to <locale>
  [--only <collections>] [--include-translated] [--dry] --as <email>` (docs/API-TRANSLATIONS.md).
- More than one server process on one data dir (docs/SCALING.md, docs/DEPLOY.md "Several server processes"). Run
  several `markstage-server serve` processes on one machine, each on its own port, behind one address. They behave
  as one server:
  - the limits count across all of them: sign-in misses per address, share-link tries, wrong tokens, AI asks a
    minute and a day, MCP calls and publishes, and live redirect tests;
  - edit locks and who has an entry open are shared;
  - one job runs at a time, whichever process started it, and its log is live on every process;
  - saves to the site repo take turns through a lock file in the data dir (`repo.lock`), so two saves at once are two
    clean commits.
- One process holds the "primary" role and runs what must run once: the scheduler, backups, the digests, webhook
  sends, the preview and share-link listeners. When it stops, another takes the role within a few seconds. A
  process that stops mid-job leaves its job failed, with "The server process running this job stopped.", and a site
  translation it ran paused, to resume on any process.
- New config: `processes.leaseSeconds` (30 by default), how long the heartbeat of a process in another container
  may stand still before its locks free themselves. On the same machine a crashed process's locks free at the next
  heartbeat, and a live one (paused, or after a clock jump) keeps them: a process is never taken for stopped by the
  wall clock alone, and work under a lock checks it still holds it before each step (docs/SCALING.md, "Clock jumps
  and pauses").
- A flood of share-link tries no longer fills the database: a refused try is not stored, an IPv6 address counts as
  its /64 (for sign-in misses and wrong tokens too), and passed tries are deleted within a minute.

- The packages are ready for npm (not published yet): each of `@markstage/core`, `editor`, `astro` and `server` has a
  `files` allow-list, so a tarball holds only what runs, its README, the LICENSE (Elastic License 2.0) and the NOTICE;
  no tests, e2e tests or fixtures. Before and after, files and size unpacked: core 73 and 553 KB to 47 and 323 KB,
  astro 35 and 197 KB to 28 and 138 KB, editor 389 and 2.7 MB to 345 and 2.6 MB, server 354 and 3.7 MB to 184 and
  1.7 MB. Each has npm metadata (repository and directory, homepage, bugs, keywords, `engines.node >=22.13`,
  `publishConfig` with provenance) and names the others at exactly its own version.
- A package guard in `npm run test:scripts` packs each package for real and fails on a test or fixture file, anything
  secret-like, a missing entry point, a package over its size budget, a site's name or wrong metadata. A new CI job,
  "npm install test" (`npm run test:npm-install`, on Node 24 and 22.13), installs the four tarballs in a new site
  from the starter and runs `astro build`, `markstage build-editor`, `astro dev`, the server, and a post saved in the
  editor in Chromium as a git commit. Astro 7.4 itself needs Node 22.23.4 or newer on the 22 line, so on 22.13 its
  build runs on Node 24 and `astro dev` is left out; the install, the editor build, the server and the save run on
  22.13.
- `.github/workflows/npm.yml` publishes the packages on a `v*` tag in the public repo, with provenance, by npm trusted
  publishing (or a token); it does nothing until the owner turns it on. The first publish, from a laptop, and the
  one-time setup: docs/PUBLISHING.md "npm".
- `create-site.mjs --npm`: a new site from the starter that takes `@markstage/astro` from npm instead of `vendor/`
  (docs/STARTER.md).

### Fixed

- Installed from npm, two things broke that a linked checkout never shows: the editor in `astro dev` did not open
  (core's CommonJS, `extend` through unified, reached the browser as it is; the integration now has Vite pre-bundle
  core when the editor sits in `node_modules`), and the editor's footer said `v0.0.0` (the release line looked for
  Markstage's package.json beside `node_modules`; it now falls back to the package's own version).

- The canvas in a dark editor drew the page in colours its readers never see: the site's dark colours turned on for
  a page that nothing turns dark for readers (the example blog), and its code blocks as a light box with light text
  (1.2:1). The canvas now shows the page as a reader in the editor's colour scheme gets it: the site's dark colours
  only when the page follows the system's scheme itself, the browser's own text colour, scheme and window background
  where the page sets none (never the editor's), and code blocks in the colours the site's highlighter gives the
  page's (docs/CANVAS-FIDELITY.md "Colours: the page as readers see it"). The example blog's own dark colours now
  cover its code blocks, rules and "More on this topic" too.
- The canvas on the starter drew the title twice: a title inside a header of the page's (`header > time + h1`) is
  now the editor's title, in its place.
- Security review of the canvas's page route (5 Nov 2026): a page with tens of thousands of stylesheet links no
  longer stalls the server (one pass, stopped at 64 `.css` files); a page over 4 MB is never read, and a redirect-stub
  check reads a file's head only (also in Redirects and Environments, and the page-type checks read at most 4 MB of a
  built page; a protected page is streamed); the answers kept in memory have a 64 MB budget; the answer is
  `no-store` (the editor keeps it in memory); and the page around the canvas keeps only the web's addresses, read as
  a browser reads them (`java&#9;script:` and the like are dropped), drops SVG `set`/`animate*`, and holds every
  link, image-map area, form button and form. The same one-scan-per-item pattern was fixed in an imported page's
  images, an import's review and plan, and moving many pages.
- An import's report now says what its plan left out before any item was made: a kind with no collection chosen
  ("4 products left out") and things not brought over (menus and the like), in the Import screen and on the command
  line, as the plan did (`counts.left` and `counts.other` in the result).

## 0.4.0 (4 November 2026)

Everything the 0.3.0 roadmap listed for 0.4.0: MDX editing; imports from WordPress, Ghost and Prismic (the WordPress
one proven on a real 148-post site's export); a ready server image and a starter site; a live demo in the browser;
AI writing help, OpenAI-compatible and Ollama providers, and an MCP publish tool behind the publish rules. The site and
the editor have a new look, and every label is in sentence case.

### Added

- Import a site from WordPress, Ghost or Prismic in one step (More tools › Import a site, or
  `markstage-server import`): posts and pages, images and files, authors, categories and tags, search titles and
  descriptions, and every old address sent on to the new page. WordPress from its export file or REST API (with an
  application password), Ghost from its export or Content API, Prismic from its API. Gutenberg, classic HTML,
  Lexical, Mobiledoc and Prismic rich text become clean Markdown; a block, shortcode, card or slice that cannot be
  converted is marked "Import note:" in the text and listed for review. A dry run shows the whole plan first ("142
  posts, 18 pages, 1,204 images; 6 slugs already exist; 31 images need alt text; 4 blocks we could not convert");
  the run is a background job, committed in batches by the person who ran it, and everything arrives as a draft.
  Running it again changes nothing. Every request goes through the SSRF guard, and a password, key or token is
  used for the one read and kept nowhere (docs/IMPORT.md).

- A live demo at https://spcaeo.github.io/markstage/demo/: the real editor on the example blog, in the browser
  with no sign-up. A save runs the same Markdown writer as a server and shows the git diff it would commit; edits
  stay in the browser tab, and Reset demo clears them. Publishing, users, settings and the other changes answer
  "Not in the demo" with a link to the install steps. docs/DEMO.md says how it is built and recorded.

### A ready server image and a starter site

- A ready server image: `ghcr.io/spcaeo/markstage`, for amd64 and arm64, published by GitHub Actions when a
  release is tagged in the public repo, with an SBOM and build provenance. Until the first such release, build it
  from a clone (`docker build -f deploy/Dockerfile -t markstage-server .`). docs/DOCKER.md.
- One `docker run` next to a site's git folder runs Markstage: on its first start the image writes a config, installs
  the site's packages for Linux and builds the site's editor; it rebuilds the editor at every start. Secrets come from
  the environment or from files, never from the image. The Dockerfile now has two stages, runs as `node` with tini,
  and carries ssh for pushes to a shared remote.
- CI builds the image on every push and pull request and smoke-tests it on a new site: health, the site's editor, the
  sign-in setup, the API, and a publish that builds and deploys inside the container.
- A starter site (`examples/starter`): a small Astro blog with Markstage set up, Markdown posts, an MDX guide with a
  component, light and dark, and the "Edit this page" button. `node scripts/create-site.mjs my-blog` copies it to a
  folder of its own with Markstage's packages in `vendor/` (they are not on npm yet), installs it and makes the first
  commit; `--update` brings a site's packages up to the clone's. docs/STARTER.md.
- The server takes the built editor's folder from `MARKSTAGE_EDITOR_DIR` too.
- `deploy/compose.yaml` runs a published image with `MARKSTAGE_IMAGE`, keeps the site's Linux packages in a volume,
  and takes the address from `MARKSTAGE_PUBLIC_ORIGIN` when it is set.

### AI writing help, more AI providers and an MCP publish tool

- Writing help on the page: select words in one paragraph, heading or list item, then "Improve with AI" in the
  format bar (Alt+F10 reaches it from the keyboard). Rewrite, Shorten, Fix spelling and grammar, or Change tone
  (friendly, formal, confident). The suggestion shows beside the words as a diff; Accept, Edit then accept, or
  Reject. Accepting is one change you can undo with ⌘Z, and nothing saves by itself. Each step has its URL. The
  server's new suggestion kind is `rewrite`, with the same rights, sizes, limits and audit as the others.
  docs/API-AI.md.
- More AI providers: `ai.provider` may be `openai`, for any OpenAI-compatible endpoint (OpenAI, Azure OpenAI with
  `keyHeader: "api-key"`, OpenRouter, Together, LM Studio) at `ai.baseUrl`, or `ollama` (http://127.0.0.1:11434 by
  default, no key). Https or a loopback address only. They have no default model: until the owner names one in
  `ai.model`, AI is off and the editor says so. Anthropic stays the default.
- `GET ai?check=1`, for owners and administrators: asks the provider for its models and says whether the named one
  is there, audited as `ai.health`. `GET ai` now gives `reason` (`key` or `model`) when AI is off.
- An MCP publish tool, `publish_release`, for a token with the new `mcp:publish` scope. Only an owner or
  administrator can make such a token, and the Tokens screen warns plainly beside the box and on the made token. The
  site's checks run first and a failed one refuses it; then the person's own publish route decides (their role now,
  the promotion rules, the publish rules, the version). Each publish is one commit named "published by an AI agent
  for <person>, via MCP: <token>", audited with `via: 'mcp'`, at most 5 an hour per token. docs/API-MCP.md.

### Changed

- The editor writes every label in sentence case, never in capitals: the drawer's groups ("Content", "Site & team"),
  card headings like "New AI assistant token", list and palette headings, tags and chips. They keep their place with
  size, weight and colour instead. A test (scripts/sentence-case.test.mjs) keeps capitals-only styling out of the
  editor, the Astro package and the server.

### Fixed

- With the drawer folded to its rail, the top bar at 1280 to 1440 pixels wide with unsaved changes no longer
  pushes Publish, Save and the account button off the screen: its buttons give up their words first, as they do
  with the drawer open.
- Saving a page in the page view after its first save no longer writes "null" into the page or stops with an
  error.

### MDX

- Markstage now edits MDX files. MDX too: code stays locked, prose is editable. A collection with
  `format: 'mdx'` lists its `.mdx` files, and they open on the canvas like Markdown (docs/MDX.md).
- The two promises hold for MDX: open and save with no edit leaves the file byte for byte the same, and an edit
  changes only what was edited.
- Imports, exports and `{expressions}` are kept exactly as written and shown as quiet locked lines ("Uses 2
  components: Callout, Chart"). The editor will not delete or move them.
- A component is a card with its name and settings. Text, number and on/off settings change in the side panel; the
  save rewrites only that value and keeps its quote style. Settings that are code are shown read-only. The text
  inside a component (a Callout's words) is typed in like any other text.
- What the writer types never becomes code: `<`, `{` and a line starting with `import` or `export` are escaped.
- A file the MDX reader cannot read opens read-only in Source mode with a plain message and its line, and the server
  refuses a save over it.
- A contributor may change words and simple settings in an MDX file, never the code.
- The example blog has an MDX guide with a Callout and a Chart.
- New dependency: `remark-mdx` 3.1.1 in `@markstage/core` (its licence is listed in NOTICE).

## 0.3.0 (3 November 2026)

The first public release: the source is on GitHub under the Elastic License 2.0 (source-available, free to
self-host), with a website, docs and a sourced comparison at https://spcaeo.github.io/markstage/.

### Security

- A security review: its findings are fixed or, where a trade-off stays, written down in docs/SECURITY.md. Among
  them: a link to `javascript:` (or a trick that hides it) is refused for every role, the preview page can no
  longer press Save or pick what the pages editor edits, a file outside the build is never served, a signed-out
  visitor cannot tell which files the repo has, and only people who can promote or sync can make the server
  fetch, at most once every 30 seconds.
- Sign-in lockouts now hold the account and the address together, so one person's wrong passwords cannot lock
  someone else out.
- The public release address (`/markstage/api/release`) answers with the release line only.

### Fixed

- The findings of two quality passes, for example: a title longer than 300 characters is refused with a plain
  message instead of being cut, a title with no Latin letters (Arabic, emoji) gets a dated address, a scheduled
  post can be un-scheduled, a bad entry can no longer stop every build, and on a phone Save and Publish stay on
  screen.
- The release line in the footer uses plain spaces on every machine.

### New

- Images & files can list the pictures the site already has.
- The site's preview starts warm with Markstage, so the first preview opens quickly.
- Dependabot keeps the dependencies and GitHub Actions up to date, and CI runs every check, every package's tests,
  the browser tests, a dependency audit and a secrets scan on each push and pull request.
- `SUPPORT.md`, issue forms, a pull request template and this changelog; a pre-commit secret scan.

## 0.2.0 (2 November 2026)

The first numbered release. Everything below is in it.

### Writing on the real page

- The editor draws each entry inside the site's own page shell, with the site's components and CSS, so a writer
  sees what a reader will see. Alt text, captions and links are edited where they appear.
- Saves are surgical: opening and saving changes nothing, and moving a block and moving it back gives the same
  bytes. Every save is a clean git diff of exactly what changed.
- Never lose typing: local recovery copies, retry when offline, a three-way merge when two people edit, and
  "Sign in again" that keeps the text.
- Blocks move by keyboard, by the grip or in the Outline; find and replace; images edited on the page; Light, Dark
  and System themes for the editor; plain words everywhere.

### Pages and the Library

- JSON pages are edited on the page itself, with their sections and fields in a panel.
- One Library of templates, sections and snippets, with synced copies (Apply, Undo, Detach), packs to export and
  import, and sections dragged from the Library onto the live page.
- A section gallery that draws every section type and variation alone.

### Running the site

- A secure server: sign-in with two-factor codes and single sign-on, roles and custom roles, invitations, and
  every rule the screens show also enforced on the server.
- Publishing as background jobs, scheduled publishing, releases that publish several changes together, share
  links for previews, and rollback of a bad release.
- Environments: staging next to production, with plans, promotion rules, sync and rollback.
- Media library, menus, redirects, categories and tags, authors, a page tree, bulk changes, trash, locks, backups
  and translations.
- Forms with an inbox, spam handling, alerts and a daily digest; optional sending to a CRM and an analytics tool.
- Site check-up: SEO checks while writing, publish rules, links and a topic map, broken links, speed from field
  data, and what the host serves for every address.

### Packages and deploy

- `@markstage/core` (the Markdown and JSON converter and its checks), `@markstage/editor`, `@markstage/astro` (the
  Astro integration and the `markstage` command) and `@markstage/server` (the server, `markstage-server` and
  `markstage-deploy`).
- A Docker image and compose file, nginx recipes and a publish gate (docs/DEPLOY.md), with every secret as a
  placeholder.
- An example blog (`examples/blog`) to try the editor on.
- The release line `v0.2.0 · build N · <date and time>` in the editor's footer and from the server.
