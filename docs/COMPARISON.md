# Markstage compared

> **A note on the names in this document.** WordPress, Ghost, Prismic, TinaCMS, CloudCannon, Decap CMS, Sveltia CMS,
> Keystatic, Pages CMS, Front Matter CMS, Outstatic, Sitepins, EmDash, StudioCMS, Storyblok, Sanity, Contentful,
> Builder.io, Payload, Strapi, Statamic and Astro are trademarks of their owners. We name them only to compare.
> Markstage is not associated with, affiliated with or endorsed by any of them. Many of them are excellent, and this
> page says where each one fits better than Markstage. If a fact is out of date, please open an issue.

How Markstage, a visual editor for Astro sites whose content is Markdown and JSON files in git, stands beside the
editors and content systems people use with Astro. A short version is in the
[README](../README.md#how-markstage-compares).

Facts about other products come from each vendor's own website, pricing page, docs or code repository, and from
Astro's own docs, all checked on **2026-11-03** (Ghost's on 2026-11-04). No review sites or third-party lists were used as a source.
Markstage's column claims only what is in this repository's code and docs on that date. Every cell links its source
in the footnotes. Prices are the list prices shown on that date, monthly unless the cell says otherwise; they change
often, so check the vendor's page before you buy.

| Mark | Means |
| --- | --- |
| ✓ | Yes |
| ◐ | Partly, or only on some plans or as an add-on (see the note in the cell) |
| ✗ | No, or not found where the vendor lists its features |
| ? | Not confirmed on the vendor's own pages |
| – | Does not apply |

**Status.** Markstage is pre-release and in active development ([README](../README.md)). Most products below have
years of production use and much larger communities. Weigh that as well as the features.

## The short answer

- **Astro has no editor of its own.** Its docs describe a CMS as a separate tool that "lets you write content and
  manage assets outside of your Astro project", and list 45 of them [^as-cms]. Content collections give Markdown,
  MDX, YAML and JSON files a schema and type safety, but no screen for a writer [^as-coll].
- **Markstage is for a team that wants all of these at once:** writers edit on the site's own design; a save
  changes only what was edited (a clean git diff) and, with the Markstage server, is committed as the person who
  saved; no database server holds the content; staging and release rules are
  included; and it all runs on your own server for free.
- **WordPress, Ghost and Prismic are the three people weigh most often.** WordPress and Ghost are mature
  publishing platforms with large communities; with Astro, both are used headless (Astro reads their content by
  API, and writers work in their own admin). Prismic is a hosted page builder. The next section puts the three
  side by side with Markstage.
- **The closest products** are CloudCannon (git-based, edits on a preview of your built site, hosted only, from $55
  a month), TinaCMS (git-based, click-to-edit on Astro pages, hosted or self-hosted), and Storyblok, Sanity and
  Prismic (visual editing on a hosted content database).

## Markstage vs WordPress, Ghost and Prismic

The rows a team usually decides on. Each cell is the same, with the same source, as in the full tables below.

| Feature | **Markstage** | WordPress | Ghost | Prismic |
| --- | :---: | :---: | :---: | :---: |
| Edits on the site's own design | ✓ <sub>The site's own components and CSS</sub> [^ms-arch] | ✗ <sub>Headless: written in WordPress's admin</sub> [^wp-astro] | ✗ <sub>Headless: written in Ghost's own editor</sub> [^go-feat] [^go-astro] | ◐ <sub>Page Builder: drag sections, live preview</sub> [^pr-pb] |
| Content as files in git | ✓ [^ms-readme] | ✗ <sub>Read by REST API</sub> [^wp-astro] | ✗ <sub>MySQL database, read by the Content API</sub> [^go-ubuntu] [^go-content] | ✗ <sub>Hosted, read by API</sub> [^pr-price] |
| What you run | One Node server next to your static site [^ms-deploy] | A WordPress site (PHP with MySQL or MariaDB) [^wp-astro] [^wp-req] | A Ghost server (Node.js and MySQL 8), or Ghost(Pro) [^go-ubuntu] [^go-price] | Nothing; hosted [^pr-price] |
| Guide in Astro's own CMS docs | ✗ <sub>Not listed yet</sub> [^as-cms] | ✓ [^wp-astro] | ✓ [^go-astro] | ◐ <sub>Community resources only</sub> [^pr-astro] |
| Roles | ✓ <sub>Five built in, plus custom roles</sub> [^ms-roles] | ✓ <sub>Six roles</sub> [^wp-roles] | ✓ <sub>Contributor, Author, Editor, Administrator, Owner</sub> [^go-roles] [^go-price] | ◐ <sub>From Medium ($150); custom on Enterprise</sub> [^pr-price] |
| Single sign-on | ✓ <sub>OpenID Connect, included</sub> [^ms-sso] | ? [^wp-lic] | ◐ <sub>Custom plan on Ghost(Pro)</sub> [^go-price] | ◐ <sub>Enterprise</sub> [^pr-price] |
| Environments or staging | ✓ <sub>Local, staging, production; free</sub> [^ms-env] | ? [^wp-lic] | ? [^go-price] | ◐ <sub>Paid option on Platinum ($675); 2 on Enterprise</sub> [^pr-price] |
| Releases (publish many changes at once) | ✓ <sub>With a preview and share links</sub> [^ms-releases] | ? [^wp-lic] | ? [^go-feat] | ✓ [^pr-pb] |
| Forms inbox | ✓ [^ms-inbox] | ? [^wp-lic] | ? [^go-feat] | ✗ [^pr-price] |
| WordPress import | ◐ <sub>Reusable blocks and old contact messages from a WordPress export or dump; posts and media through the JSON import</sub> [^ms-library] [^ms-import] | – | ✓ <sub>Built-in importer for a WordPress XML export</sub> [^go-wp] | ◐ <sub>A general Migration API</sub> [^pr-price] |
| Self-host | ✓ [^ms-deploy] | ✓ [^wp-astro] | ✓ <sub>Ubuntu with Ghost-CLI, or Docker (preview)</sub> [^go-install] | ✗ [^pr-price] |
| Price to start | Free [^ms-readme] | Free software; you pay for hosting [^wp-lic] | Free software; Ghost(Pro) Starter $18/mo ($15 yearly) [^go-price] | Free; Starter $10/mo per repository, yearly [^pr-price] |
| Licence | Elastic License 2.0 <sub>Source-available, free to self-host</sub> [^ms-licence] | GPLv2 or later [^wp-lic] | MIT [^go-gh] | Closed, hosted service [^pr-price] |

How to choose among these four:

- **WordPress** if you want its very large ecosystem of themes, plugins, hosts and people who know it, or a
  familiar admin for content that Astro reads by API.
- **Ghost** if the site is a publication: newsletters, memberships and paid subscriptions are built in
  [^go-feat], with its own editor and themes, self-hosted or on Ghost(Pro). Its code is under the MIT licence
  [^go-gh].
- **Prismic** if you want a hosted page builder with nothing to run, and your developers build the sections
  ("slices") [^pr-pb].
- **Markstage** if writers should edit on the Astro site's own design, content should stay as files in git, and
  staging, roles and single sign-on should come included on your own server. Markstage is pre-release; WordPress
  and Ghost have many years of production use and much larger communities.

## Group A: git-based editors

These keep content as files in a git repository, like Markstage.

### Editing

| Feature | **Markstage** | TinaCMS | CloudCannon | Decap CMS | Sveltia CMS | Keystatic | Pages CMS | Front Matter CMS | Outstatic | Sitepins |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Edits on the site's own design <br><sub>The writer sees the real page while editing</sub> | ✓ <sub>The site's own components and CSS; text and rich text typed on the page, other fields in a side panel. Components mark their fields with a helper</sub> [^ms-arch] | ✓ <sub>Click a region of the Astro page; its field opens in a sidebar form and the page updates live. Each page is set up with a data loader and an island or server route</sub> [^ti-astro] | ✓ <sub>Editable regions on a preview of your built site; Astro components re-render live</sub> [^cc-visual] [^cc-astro] | ◐ <sub>Form with a real-time preview pane; custom preview templates and styles</sub> [^de-home] [^de-preview] | ◐ <sub>Two-pane editor with live preview, scroll sync and click-to-highlight</sub> [^sv-feat] | ✗ <sub>Admin UI with fields and a WYSIWYG editor</sub> [^ks-home] | ✗ <sub>Forms with a rich-text editor</sub> [^pc-home] | ◐ <sub>Site preview inside VS Code</sub> [^fm-home] | ✗ <sub>Dashboard editor</sub> [^os-home] | ✗ <sub>WYSIWYG over your files; "not a page builder"</sub> [^sp-gh] |
| Media library | ✓ <sub>Upload, paste or drop; alt text required; images re-encoded</sub> [^ms-arch] | ✓ <sub>Repo-based media</sub> [^ti-flow] | ◐ <sub>Connect outside asset stores (DAM) on paid plans</sub> [^cc-price] | ✓ <sub>Drag-and-drop uploads</sub> [^de-home] | ✓ <sub>Asset library, stock photos</sub> [^sv-feat] | ◐ <sub>Cloud Images on Keystatic Cloud Pro</sub> [^ks-cloud] | ✓ <sub>Media manager</sub> [^pc-home] | ✓ <sub>Media dashboard</sub> [^fm-home] | ? [^os-home] | ? [^sp-home] |
| SEO checks while writing | ✓ <sub>Counters, search preview, checks run on the built HTML; publishing stops on real errors</sub> [^ms-seo] | ? [^ti-price] | ? [^cc-price] | ✗ [^de-home] | ✗ [^sv-feat] | ✗ [^ks-home] | ✗ [^pc-home] | ✓ [^fm-home] | ? [^os-home] | ✓ <sub>Search preview and tips</sub> [^sp-home] |

### Content and git

| Feature | **Markstage** | TinaCMS | CloudCannon | Decap CMS | Sveltia CMS | Keystatic | Pages CMS | Front Matter CMS | Outstatic | Sitepins |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Content as files in git | ✓ [^ms-readme] | ✓ [^ti-gh] | ✓ <sub>GitHub, GitLab, Bitbucket</sub> [^cc-price] | ✓ <sub>GitHub, GitLab, Bitbucket and more</sub> [^de-intro] | ✓ [^sv-gh] | ✓ <sub>Local or GitHub</sub> [^ks-home] | ✓ <sub>GitHub only</sub> [^pc-home] | ✓ <sub>Your local files</sub> [^fm-home] | ✓ <sub>GitHub</sub> [^os-price] | ✓ <sub>GitHub, GitLab</sub> [^sp-gh] |
| A save is a commit by the person who saved | ✓ <sub>Only the changed blocks are rewritten; open and save with no edit changes nothing</sub> [^ms-api] | ✓ <sub>To GitHub, through TinaCloud or a self-hosted backend</sub> [^ti-astro-guide] | ✓ [^cc-price] | ✓ [^de-intro] | ✓ [^sv-gh] | ◐ <sub>In GitHub mode</sub> [^ks-install] | ✓ [^pc-home] | – <sub>You commit yourself</sub> [^fm-home] | ◐ <sub>Email or Google sign-ins commit as the Outstatic Bot</sub> [^os-price] | ✓ <sub>Through your connected git account</sub> [^sp-gh] |
| Markdown with front matter | ✓ [^ms-arch] | ✓ [^ti-gh] | ✓ [^cc-astro] | ✓ [^de-astro] | ✓ [^sv-entries] | ✓ [^ks-home] | ✓ [^pc-home] | ✓ [^fm-home] | ✓ [^os-home] | ✓ [^sp-gh] |
| MDX | ◐ <sub>Words and simple component settings edited; code kept as written; components shown as cards, not rendered, on the canvas</sub> [^ms-mdx] | ✓ [^ti-gh] | ? <sub>Its docs have an article on MDX component snippets</sub> [^cc-visual] | ? [^de-intro] | ? <sub>Formats listed: Markdown, YAML, JSON, TOML</sub> [^sv-entries] | ✓ <sub>MDX and Markdoc fields</sub> [^ks-install] | ? [^pc-home] | ? [^fm-home] | ✓ [^os-price] | ? [^sp-gh] |
| JSON and YAML data files | ✓ <sub>JSON pages edited on the page; reads and writes Keystatic's JSON with zero diff</sub> [^ms-api] | ✓ [^ti-gh] | ✓ <sub>Data editor</sub> [^cc-astro] | ? [^de-intro] | ✓ [^sv-entries] | ✓ [^ks-home] | ? [^pc-home] | ✓ <sub>Data dashboard</sub> [^fm-home] | ? [^os-home] | ? [^sp-gh] |
| Database to run | No database server <sub>Content in git; one SQLite file holds people, sessions, the inbox, drafts in progress, trash, releases, the media index and the audit log</sub> [^ms-readme] | ◐ <sub>Self-hosting needs a database adapter (e.g. MongoDB, Postgres) as a cache</sub> [^ti-self] | – <sub>Hosted for you</sub> [^cc-price] | None <sub>Decap Turbo adds a hosted store</sub> [^de-turbo] | None [^sv-feat] | None [^ks-home] | ◐ <sub>Self-hosting needs PostgreSQL</sub> [^pc-gh] | None [^fm-home] | None [^os-home] | None for content [^sp-gh] |

### Astro

| Feature | **Markstage** | TinaCMS | CloudCannon | Decap CMS | Sveltia CMS | Keystatic | Pages CMS | Front Matter CMS | Outstatic | Sitepins |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Guide in Astro's own CMS docs | ✗ <sub>Not listed yet</sub> [^as-cms] | ✓ [^ti-astro-guide] | ✓ <sub>A featured CMS partner</sub> [^cc-astro] | ✓ [^de-astro] | ✗ <sub>Says it works with Astro</sub> [^sv-gh] | ✓ [^ks-astro] | ✓ [^pc-astro] | ✓ [^fm-astro] | ✗ <sub>Names Astro on its site</sub> [^os-home] | ✓ [^sp-astro] |
| Astro integration package | ✓ <sub>`@markstage/astro`: the editor inside `astro dev`</sub> [^ms-arch] | ✓ <sub>`@tinacms/astro`</sub> [^ti-astro] | ✓ <sub>`@cloudcannon/editable-regions`</sub> [^cc-astro] | ✗ <sub>An admin page you add</sub> [^de-astro] | ✗ [^sv-gh] | ✓ [^ks-astro] | ✗ [^pc-astro] | ✗ <sub>A VS Code extension</sub> [^fm-astro] | ✗ [^os-home] | ✗ [^sp-astro] |
| The live site can stay fully static | ✓ <sub>Editor markup only in editor mode; the production build is byte-identical</sub> [^ms-arch] | ◐ <sub>Visual editing wants `output: 'server'` and an adapter, or every region wrapped in `<TinaIsland>`</sub> [^ti-astro] | ✓ <sub>Builds and serves the static output</sub> [^cc-price] | ◐ <sub>Off Netlify, sign-in needs your own OAuth routes on an adapter</sub> [^de-astro] | ✓ <sub>No server</sub> [^sv-feat] | ◐ <sub>Pages stay static; its admin routes are rendered on demand, which needs an adapter</sub> [^ks-astro] [^ks-code] | ✓ [^pc-home] | ✓ [^fm-home] | ? [^os-home] | ✓ [^sp-gh] |

### Team and workflow

| Feature | **Markstage** | TinaCMS | CloudCannon | Decap CMS | Sveltia CMS | Keystatic | Pages CMS | Front Matter CMS | Outstatic | Sitepins |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Sign-in for people without a git account | ✓ <sub>Email and password, two-step sign-in</sub> [^ms-arch] | ✓ <sub>TinaCloud, or Auth.js when self-hosted</sub> [^ti-self] | ✓ [^cc-price] | ◐ <sub>Your own auth, or Decap Turbo</sub> [^de-turbo] | ✗ <sub>OAuth with the git host</sub> [^sv-start] | ◐ <sub>Keystatic Cloud</sub> [^ks-cloud] | ✓ <sub>Email invites</sub> [^pc-home] | – [^fm-home] | ◐ <sub>Pro: email and Google</sub> [^os-price] | ✓ <sub>Invite by email</sub> [^sp-home] |
| Roles | ✓ <sub>Five built in, plus custom roles</sub> [^ms-roles] | ◐ <sub>3 roles; custom roles on Enterprise (beta)</sub> [^ti-price] | ◐ <sub>Default roles; custom permissions from Team</sub> [^cc-price] | ◐ <sub>Turbo: owner, member, full access; custom roles €19 add-on</sub> [^de-turbo] | ? [^sv-feat] | ✗ <sub>Access is per team</sub> [^ks-cloud] | ✗ <sub>"Soon"</sub> [^pc-home] | – [^fm-home] | ◐ <sub>Pro</sub> [^os-price] | ✓ [^sp-home] |
| Single sign-on | ✓ <sub>OpenID Connect, included</sub> [^ms-sso] | ◐ <sub>Enterprise</sub> [^ti-price] | ◐ <sub>SSO/SAML on Enterprise</sub> [^cc-price] | ✗ [^de-turbo] | ✗ [^sv-feat] | ✗ [^ks-cloud] | ✗ [^pc-home] | – [^fm-home] | ◐ <sub>Google sign-in on Pro</sub> [^os-price] | ? [^sp-home] |
| Review before going live | ✓ <sub>Send to staging for review; approve; promotion rules</sub> [^ms-env] | ◐ <sub>Editorial workflow: protected branches and pull requests, on TinaCloud Team and up</sub> [^ti-flow] [^ti-price] | ◐ <sub>Branching workflows on Team</sub> [^cc-price] | ✓ <sub>Editorial workflow: a branch and pull request per entry</sub> [^de-flow] | ✓ <sub>Editorial workflow (GitHub, GitLab, Gitea/Forgejo)</sub> [^sv-flow] | ? [^ks-home] | ✗ [^pc-home] | – [^fm-home] | ◐ <sub>"Team workflows" on Pro</sub> [^os-price] | ✓ <sub>Branch previews, review and revert</sub> [^sp-home] |
| Staging and production as separate places | ✓ <sub>Local, staging and production, each a branch plus a server; content and code promoted together; sync down by merge</sub> [^ms-env] | ◐ <sub>Branches with preview links</sub> [^ti-flow] | ◐ <sub>Branch sites on Team</sub> [^cc-price] | ◐ <sub>Deploy preview links</sub> [^de-flow] | ? [^sv-start] | ? [^ks-home] | ✗ [^pc-home] | – [^fm-home] | ? [^os-price] | ◐ <sub>Branch previews</sub> [^sp-home] |
| Live co-editing (cursors) | ✗ <sub>Locks and a three-way merge instead</sub> [^ms-readme] | ? [^ti-price] | ? [^cc-price] | ✗ [^de-home] | ✗ [^sv-feat] | ✗ [^ks-home] | ✗ <sub>Comments "soon"</sub> [^pc-home] | – [^fm-home] | ✗ [^os-home] | ✓ <sub>Live cursors and avatars</sub> [^sp-home] |
| Forms inbox for site visitors | ✓ <sub>Forms post to Markstage; Inbox, alerts, thank-you mail</sub> [^ms-inbox] | ✗ [^ti-price] | ✓ <sub>Form inboxes</sub> [^cc-price] | ✗ [^de-home] | ✗ [^sv-feat] | ✗ [^ks-home] | ✗ [^pc-home] | ✗ [^fm-home] | ✗ [^os-home] | ✗ [^sp-home] |
| Translations | ✓ <sub>Per-language status: missing, outdated, done</sub> [^ms-trans] | ? [^ti-price] | ? [^cc-price] | ? [^de-home] | ✓ <sub>First-class i18n</sub> [^sv-feat] | ? [^ks-home] | ? [^pc-home] | ? [^fm-home] | ? [^os-home] | ? [^sp-home] |
| AI agents through MCP | ✓ <sub>Agents draft as the person whose token they hold; never publish</sub> [^ms-mcp] | ? [^ti-price] | ? [^cc-price] | ✗ [^de-home] | ◐ <sub>Agent Skill and llms.txt</sub> [^sv-gh] | ✗ [^ks-home] | ✗ [^pc-home] | ✗ [^fm-home] | ◐ <sub>AI completion on Pro</sub> [^os-price] | ◐ <sub>A setup skill</sub> [^sp-home] |

### Hosting and price

| Feature | **Markstage** | TinaCMS | CloudCannon | Decap CMS | Sveltia CMS | Keystatic | Pages CMS | Front Matter CMS | Outstatic | Sitepins |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Self-host | ✓ <sub>One docker run with the server image, Docker Compose, or systemd and nginx</sub> [^ms-docker] [^ms-deploy] | ✓ <sub>"Some features are not available"</sub> [^ti-self] | ✗ <sub>No self-hosted version listed</sub> [^cc-price] | ✓ [^de-turbo] | ✓ <sub>A single-page app; no server</sub> [^sv-feat] | ✓ [^ks-home] | ✓ [^pc-gh] | – <sub>Runs in your editor</sub> [^fm-home] | ✓ [^os-price] | ✓ [^sp-gh] |
| Hosted plan | ✗ <sub>Self-host only</sub> [^ms-readme] | ✓ <sub>TinaCloud</sub> [^ti-price] | ✓ <sub>Hosted only</sub> [^cc-price] | ◐ <sub>Decap Turbo hosts auth and a proxy</sub> [^de-turbo] | – [^sv-feat] | ◐ <sub>Keystatic Cloud for sign-in and images</sub> [^ks-cloud] | ✓ <sub>app.pagescms.org</sub> [^pc-gh] | – [^fm-home] | ✓ <sub>Pro</sub> [^os-price] | ✓ <sub>Sitepins Cloud</sub> [^sp-price] |
| Price to start | Free to self-host [^ms-readme] | Free (2 users); Team $29/mo [^ti-price] | Standard $55/mo ($49 yearly), 3 users [^cc-price] | Free; Turbo Pro €19/mo [^de-turbo] | Free [^sv-gh] | Free; Cloud Pro from $10/mo [^ks-cloud] | Free [^pc-home] | Free [^fm-home] | Free self-hosted; Pro $9.99/user/mo [^os-price] | Free self-hosted; Cloud $12/mo [^sp-price] |
| Per-seat or per-user fees | None [^ms-readme] | $9 to $18 per extra user [^ti-price] | $10 per extra user [^cc-price] | Turbo €6 per extra seat [^de-turbo] | None [^sv-gh] | Cloud: $5 per user beyond 3 [^ks-cloud] | None [^pc-home] | None [^fm-home] | Pro is per user [^os-price] | Users per plan [^sp-price] |

### Licence

| Feature | **Markstage** | TinaCMS | CloudCannon | Decap CMS | Sveltia CMS | Keystatic | Pages CMS | Front Matter CMS | Outstatic | Sitepins |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Licence | Elastic License 2.0 <sub>Source-available, free to self-host</sub> [^ms-licence] | Apache 2.0 [^ti-gh] | Closed, hosted service [^cc-price] | MIT [^de-gh] | MIT [^sv-gh] | MIT [^ks-gh] | MIT [^pc-gh] | MIT [^fm-gh] | FSL-1.1-ALv2 <sub>Source-available; becomes Apache 2.0 two years after each release</sub> [^os-lic] | AGPL-3.0 [^sp-gh] |

## Group B: content databases and APIs

These keep content in a database, their own or a hosted one, and Astro reads it through an API or an
integration.

### Editing and content

| Feature | **Markstage** | WordPress | Ghost | Prismic | EmDash | StudioCMS | Storyblok | Sanity | Contentful | Builder.io | Payload | Strapi | Statamic |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Edits on the site's own design | ✓ [^ms-arch] | ✗ <sub>Headless: written in WordPress's admin</sub> [^wp-astro] | ✗ <sub>Headless: written in Ghost's own editor</sub> [^go-feat] [^go-astro] | ◐ <sub>Page Builder: drag sections, live preview</sub> [^pr-pb] | ◐ <sub>"Inline visual editing" in its README; the docs we read edit in the admin</sub> [^em-gh] [^em-docs] | ✗ <sub>Dashboard</sub> [^sc-docs] | ✓ <sub>Visual Editor: click a component on your site, its block opens</sub> [^sb-astro] | ✓ <sub>Presentation tool with overlays, on a server-rendered Astro site</sub> [^sa-astro] | ? [^cf-price] | ✓ <sub>Drag-and-drop visual editor on a preview page of your site</sub> [^bu-astro] | ◐ <sub>Live Preview in an iframe; a Visual Editor is "coming soon" for Enterprise</sub> [^pa-preview] [^pa-visual] | ◐ <sub>Live Preview on Growth and up</sub> [^st-preview] | ◐ <sub>Live Preview</sub> [^sm-feat] |
| Content as files in git | ✓ [^ms-readme] | ✗ <sub>Read by REST API</sub> [^wp-astro] | ✗ <sub>MySQL database, read by the Content API</sub> [^go-ubuntu] [^go-content] | ✗ <sub>Hosted, read by API</sub> [^pr-price] | ✗ <sub>SQL database</sub> [^em-gh] | ✗ <sub>libSQL, MySQL or PostgreSQL</sub> [^sc-docs] | ✗ <sub>Hosted, read by API</sub> [^sb-price] | ✗ <sub>Hosted Content Lake</sub> [^sa-price] | ✗ <sub>Hosted, read by SDK</sub> [^cf-astro] | ✗ <sub>Your Builder space</sub> [^bu-astro] | ✗ <sub>MongoDB, Postgres or SQLite</sub> [^pa-db] | ✗ <sub>Read by API</sub> [^st-astro] | ✓ <sub>Flat files; git automation on Pro</sub> [^sm-feat] [^sm-price] |
| What you run | One Node server next to your static site [^ms-deploy] | A WordPress site (PHP with MySQL or MariaDB) [^wp-astro] [^wp-req] | A Ghost server (Node.js and MySQL 8), or Ghost(Pro) [^go-ubuntu] [^go-price] | Nothing; hosted [^pr-price] | The Astro site on Cloudflare Workers, or Node with SQLite [^em-gh] | Astro in server mode, plus a database [^sc-docs] | Nothing; hosted [^sb-price] | Nothing for content; hosted [^sa-price] | Nothing; hosted [^cf-astro] | Nothing; hosted [^bu-price] | A Next.js app and its database [^pa-gh] [^pa-db] | A Strapi server, or Strapi Cloud [^st-price] | A Laravel (PHP) app [^sm-feat] |

### Astro

| Feature | **Markstage** | WordPress | Ghost | Prismic | EmDash | StudioCMS | Storyblok | Sanity | Contentful | Builder.io | Payload | Strapi | Statamic |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Guide in Astro's own CMS docs | ✗ <sub>Not listed yet</sub> [^as-cms] | ✓ [^wp-astro] | ✓ [^go-astro] | ◐ <sub>Community resources only</sub> [^pr-astro] | ✓ [^em-astro] | ✓ [^sc-astro] | ✓ [^as-storyblok] | ✓ [^as-sanity] | ✓ [^cf-astro] | ✓ [^bu-astro] | ✓ [^pa-astro] | ✓ [^st-astro] | ✓ [^sm-astro] |
| Official Astro integration | ✓ [^ms-arch] | ✗ <sub>REST API</sub> [^wp-astro] | ✗ <sub>Content API client, `@tryghost/content-api`</sub> [^go-astro] | ✗ [^pr-astro] | ✓ <sub>Built on Astro</sub> [^em-gh] | ✓ <sub>Built for Astro</sub> [^sc-gh] | ✓ <sub>`@storyblok/astro`</sub> [^as-storyblok] | ✓ <sub>`@sanity/astro`</sub> [^as-sanity] | ✗ <sub>Contentful SDK</sub> [^cf-astro] | ✗ <sub>A preview page you add</sub> [^bu-astro] | ✗ <sub>An example project</sub> [^pa-astro] | ✗ <sub>A wrapper you write</sub> [^st-astro] | ✗ <sub>REST or GraphQL API, on Pro</sub> [^sm-astro] [^sm-price] |

### Team and workflow

| Feature | **Markstage** | WordPress | Ghost | Prismic | EmDash | StudioCMS | Storyblok | Sanity | Contentful | Builder.io | Payload | Strapi | Statamic |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Roles | ✓ <sub>Five built in, plus custom roles</sub> [^ms-roles] | ✓ <sub>Six roles</sub> [^wp-roles] | ✓ <sub>Contributor, Author, Editor, Administrator, Owner</sub> [^go-roles] [^go-price] | ◐ <sub>From Medium ($150); custom on Enterprise</sub> [^pr-price] | ✓ <sub>Administrator, Editor, Author, Contributor</sub> [^em-gh] | ? [^sc-docs] | ◐ <sub>Custom roles on Premium and Elite</sub> [^sb-price] | ✓ <sub>2 roles free, 5 on Growth, custom on Enterprise</sub> [^sa-price] | ? [^cf-price] | ◐ <sub>Admin only on Free and Pro; four roles on Team; custom roles and RBAC on Enterprise</sub> [^bu-price] | ✓ <sub>Granular access control</sub> [^pa-gh] | ✓ <sub>Role-based access in the free edition</sub> [^st-price] | ◐ <sub>Core: one admin; Pro: unlimited users and roles</sub> [^sm-price] |
| Single sign-on | ✓ <sub>OpenID Connect, included</sub> [^ms-sso] | ? [^wp-lic] | ◐ <sub>Custom plan on Ghost(Pro)</sub> [^go-price] | ◐ <sub>Enterprise</sub> [^pr-price] | ✗ <sub>Passkeys, OAuth and magic links; no single sign-on listed</sub> [^em-gh] | ? [^sc-docs] | ◐ <sub>Premium and Elite</sub> [^sb-price] | ◐ <sub>SAML on Enterprise</sub> [^sa-price] | ? [^cf-price] | ◐ <sub>Enterprise</sub> [^bu-price] | ◐ <sub>Enterprise feature</sub> [^pa-visual] | ◐ <sub>$150/mo add-on</sub> [^st-price] | ? [^sm-price] |
| Environments or staging | ✓ <sub>Local, staging, production; free</sub> [^ms-env] | ? [^wp-lic] | ? [^go-price] | ◐ <sub>Paid option on Platinum ($675); 2 on Enterprise</sub> [^pr-price] | ? [^em-gh] | ? [^sc-docs] | ◐ <sub>Premium and Elite</sub> [^sb-price] | ◐ <sub>2 datasets; more at $999 each a month</sub> [^sa-price] | ? [^cf-price] | ? [^bu-price] | ? [^pa-visual] | ? [^st-price] | ? [^sm-price] |
| Releases (publish many changes at once) | ✓ <sub>With a preview and share links</sub> [^ms-releases] | ? [^wp-lic] | ? [^go-feat] | ✓ [^pr-pb] | ? [^em-gh] | ? [^sc-docs] | ◐ <sub>Premium and Elite</sub> [^sb-price] | ◐ <sub>Content Releases on Enterprise</sub> [^sa-price] | ? [^cf-price] | ? [^bu-price] | ? [^pa-visual] | ◐ <sub>Growth and up</sub> [^st-preview] | ? [^sm-price] |
| Real-time collaboration | ✗ <sub>Locks and a three-way merge</sub> [^ms-readme] | ? [^wp-lic] | ? [^go-feat] | ? [^pr-price] | ? [^em-gh] | ? [^sc-docs] | ? [^sb-price] | ✓ <sub>Real-time content database; comments and tasks on Growth</sub> [^sa-price] | ? [^cf-price] | ? [^bu-price] | ? [^pa-gh] | ? [^st-price] | ? [^sm-price] |
| MCP server for AI agents | ✓ [^ms-mcp] | ? [^wp-lic] | ? [^go-feat] | ✓ <sub>Claude and ChatGPT plugins</sub> [^pr-price] | ✓ [^em-gh] | ? [^sc-docs] | ? [^sb-price] | ✓ [^sa-price] | ? [^cf-price] | ◐ <sub>Built-in MCP servers from Pro; custom ones on Team</sub> [^bu-price] | ? [^pa-gh] | ? [^st-price] | ? [^sm-price] |
| Forms inbox | ✓ [^ms-inbox] | ? [^wp-lic] | ? [^go-feat] | ✗ [^pr-price] | ✗ [^em-gh] | ? [^sc-docs] | ✗ [^sb-price] | ✗ [^sa-price] | ? [^cf-price] | ? [^bu-price] | ? [^pa-gh] | ✗ [^st-price] | ✓ <sub>Core: one form</sub> [^sm-price] |
| WordPress import | ◐ <sub>Reusable blocks and old contact messages from a WordPress export or dump; posts and media through the JSON import</sub> [^ms-library] [^ms-deploy] [^ms-import] | – | ✓ <sub>Built-in importer for a WordPress XML export</sub> [^go-wp] | ◐ <sub>A general Migration API</sub> [^pr-price] | ✓ <sub>Import wizard</sub> [^em-gh] | ? [^sc-docs] | ? [^sb-price] | ? [^sa-price] | ? [^cf-price] | ? [^bu-price] | ? [^pa-gh] | ◐ <sub>General data import</sub> [^st-price] | ? [^sm-price] |

### Hosting, price and licence

| Feature | **Markstage** | WordPress | Ghost | Prismic | EmDash | StudioCMS | Storyblok | Sanity | Contentful | Builder.io | Payload | Strapi | Statamic |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Self-host | ✓ [^ms-deploy] | ✓ [^wp-astro] | ✓ <sub>Ubuntu with Ghost-CLI, or Docker (preview)</sub> [^go-install] | ✗ [^pr-price] | ✓ [^em-gh] | ✓ [^sc-docs] | ✗ [^sb-price] | ✗ <sub>Content is hosted</sub> [^sa-price] | ✗ [^cf-astro] | ✗ [^bu-price] | ✓ [^pa-gh] | ✓ [^st-price] | ✓ [^sm-price] |
| Price to start | Free [^ms-readme] | Free software; you pay for hosting [^wp-lic] | Free software; Ghost(Pro) Starter $18/mo ($15 yearly) [^go-price] | Free; Starter $10/mo per repository, yearly [^pr-price] | Free [^em-gh] | Free [^sc-gh] | Free Starter; Growth $99/mo [^sb-price] | Free; Growth $15 per seat/mo [^sa-price] | ? <sub>Its pricing page refused our checks (HTTP 429)</sub> [^cf-price] | Free; Pro $24 per user/mo [^bu-price] | Free [^pa-gh] | Free; Growth $45/mo [^st-price] | Core free; Pro $349 per site, then $99 a year [^sm-price] |
| Licence | Elastic License 2.0 <sub>Source-available</sub> [^ms-licence] | GPLv2 or later [^wp-lic] | MIT [^go-gh] | Closed, hosted service [^pr-price] | MIT [^em-gh] | MIT [^sc-gh] | Closed, hosted service [^sb-price] | Studio: MIT; Content Lake hosted [^sa-gh] | Closed, hosted service [^cf-astro] | SDKs: MIT; service closed [^bu-gh] | MIT [^pa-gh] | Community Edition: MIT; Enterprise paid [^st-lic] | Commercial licence; Core free [^sm-price] |

Licences are as each project's GitHub repository states them; the licence of Markstage itself is the Elastic
License 2.0 (source-available).

## Where Markstage leads

Each line names the capability and which of the 21 products above have it, as checked on 2026-11-03 (Ghost on
2026-11-04).

1. **Editing on the site's own design, from your own server, with no database server.** Of the 21 products, those
   that edit on the real page are TinaCMS, CloudCannon, Storyblok, Sanity and Builder.io; Decap CMS, Sveltia CMS,
   Front Matter, Prismic, Payload, Strapi, Statamic and EmDash do it partly (a preview beside a form, or on some
   plans). Of those, CloudCannon, Storyblok, Sanity and Builder.io are hosted
   services, and self-hosted TinaCMS needs a database adapter as a cache. Markstage keeps content in git and
   its own working data (people, sessions, the inbox, drafts in progress, releases) in one SQLite file.
2. **The live site stays static.** Markstage's editor markup appears only in editor mode, so the production build
   is byte-identical [^ms-arch]. TinaCMS visual editing wants server output or `<TinaIsland>` wrappers, Keystatic
   keeps pages static but needs an adapter for its admin routes, and EmDash and StudioCMS run the site as a server.
3. **Staging and production for content and code together, free.** A promotion is a git merge, so templates,
   models and chosen pages move together, and content syncs back down by merge, not by overwrite [^ms-env].
   Storyblok and Prismic sell environments on their top plans, Sanity charges $999 a month per extra dataset, and
   CloudCannon has branch sites on its Team plan ($350 a month).
4. **Surgical saves.** Opening and saving changes nothing; a save rewrites only the changed blocks (a clean git
   diff) and, with the Markstage server, is committed as the person who saved [^ms-api]. JSON written by Keystatic stays byte-identical when Markstage saves it.
5. **A site's back office in one tool.** Forms inbox, media, menus, moved addresses, translations status, SEO
   checks, releases with share links, backups and rollback, single sign-on and custom roles, all included
   [^ms-readme] [^ms-inbox] [^ms-sso] [^ms-roles]. Among the git-based editors only CloudCannon also has a forms
   inbox.

## Where others go further

- **Hosted, nothing to run.** CloudCannon, TinaCloud, Storyblok, Prismic, Sanity, Contentful and Builder.io run
  everything for you, and Ghost(Pro) hosts Ghost [^go-price]. Markstage needs a server you look after.
- **Newsletters and paid memberships.** Ghost has newsletters, memberships and paid subscriptions built in
  [^go-feat]. Markstage has none of these.
- **No server at all.** Decap CMS and Sveltia CMS are a single page that talks to your git host; Front Matter
  runs inside VS Code. Markstage needs Node and git on a server.
- **MDX.** TinaCMS, Keystatic and Outstatic edit MDX and have done so for longer. Markstage's MDX support is new:
  it edits the words and a component's simple settings, keeps the code as written, and shows components as cards
  on the canvas rather than as the site renders them [^ms-mdx].
- **Live co-editing.** Sanity's real-time content database and Sitepins' live cursors let people edit together.
  Markstage uses locks and a three-way merge.
- **Size and age.** WordPress and Ghost are mature publishing platforms used by very many sites. Strapi (73.4k
  GitHub stars), Ghost (55.7k), Payload (45.6k), Decap CMS (19.4k), EmDash (14.1k) and TinaCMS (13.9k) have large
  communities [^gh-api]. WordPress, Contentful and Sanity have big partner and plugin ecosystems, and Ghost has a
  theme marketplace [^go-price]. Markstage is pre-release.
- **Other frameworks.** Most products here also serve Next.js, Hugo, Eleventy and others. Markstage has one
  adapter today, Astro; adapters beyond Astro are on its roadmap.

## Who should use what

| If you want | Look at |
| --- | --- |
| Writers editing on your Astro site's real design, content in git, run on your own server for free | Markstage |
| A familiar admin with a very large plugin and theme ecosystem, read by Astro as a headless CMS | WordPress |
| A publication with newsletters, memberships and paid subscriptions built in | Ghost |
| A hosted page builder with sections your developers make, nothing to run | Prismic |
| The same idea, fully hosted, with hosting and a CDN included | CloudCannon |
| Click-to-edit on Astro pages with MDX, hosted or self-hosted | TinaCMS |
| No server at all: a single admin page over your git host | Sveltia CMS, Decap CMS |
| A typed admin for Markdown, Markdoc or MDX inside your Astro project | Keystatic |
| A content database built into Astro, WordPress-style | EmDash, StudioCMS |
| A hosted visual CMS with a large team and many locales | Storyblok, Prismic, Sanity, Contentful |
| A full application backend as well as a CMS | Payload, Strapi |

## Also checked, not in the tables

Astro's CMS list names 45 products [^as-cms]. Most of the rest (ButterCMS, Caisy, Cosmic, DatoCMS, Directus,
Hygraph, Kontent.ai and others) are hosted or database CMSs that compare to Markstage as Contentful does. Crafter CMS is git-based but is not in Astro's list.

## Sources

[^as-cms]: **Astro**: [Astro docs: Use a CMS with Astro](https://docs.astro.build/en/guides/cms/)
[^as-coll]: **Astro**: [Astro docs: Content collections](https://docs.astro.build/en/guides/content-collections/)
[^ms-readme]: **Markstage**: [README](../README.md)
[^ms-arch]: **Markstage**: [Architecture](ARCHITECTURE.md)
[^ms-mdx]: **Markstage**: [MDX](MDX.md)
[^ms-api]: **Markstage**: [API contract](API.md)
[^ms-env]: **Markstage**: [Environments](ENVIRONMENTS.md)
[^ms-deploy]: **Markstage**: [Deploying](DEPLOY.md)
[^ms-docker]: **Markstage**: [Docker](DOCKER.md)
[^ms-seo]: **Markstage**: [SEO checks](SEO.md)
[^ms-roles]: **Markstage**: [Custom roles](API-ROLES.md)
[^ms-sso]: **Markstage**: [Single sign-on](API-SSO.md)
[^ms-inbox]: **Markstage**: [Messages and forms](API-INBOX.md)
[^ms-releases]: **Markstage**: [Releases](API-RELEASES.md)
[^ms-trans]: **Markstage**: [Translations](API-TRANSLATIONS.md)
[^ms-mcp]: **Markstage**: [MCP server](API-MCP.md)
[^ms-library]: **Markstage**: [Library and WordPress import](API-LIBRARY.md)
[^ms-import]: **Markstage**: [Import API](API-IMPORT.md)
[^ms-licence]: **Markstage**: [Licence](../LICENSE)
[^ti-price]: **TinaCMS**: [pricing](https://tina.io/pricing)
[^ti-astro]: **TinaCMS**: [Astro guide](https://tina.io/docs/frameworks/astro)
[^ti-self]: **TinaCMS**: [self-hosting overview](https://tina.io/docs/self-hosted/overview)
[^ti-flow]: **TinaCMS**: [editorial workflow](https://tina.io/docs/tinacloud/editorial-workflow)
[^ti-gh]: **TinaCMS**: [GitHub repository](https://github.com/tinacms/tinacms)
[^ti-astro-guide]: **Astro**: [TinaCMS and Astro](https://docs.astro.build/en/guides/cms/tina-cms/)
[^cc-price]: **CloudCannon**: [pricing](https://cloudcannon.com/pricing/)
[^cc-visual]: **CloudCannon**: [What is visual editing?](https://cloudcannon.com/documentation/articles/what-is-visual-editing/)
[^cc-astro]: **Astro**: [CloudCannon and Astro](https://docs.astro.build/en/guides/cms/cloudcannon/)
[^de-home]: **Decap CMS**: [home page](https://decapcms.org/)
[^de-gh]: **Decap CMS**: [GitHub repository](https://github.com/decaporg/decap-cms)
[^de-intro]: **Decap CMS**: [introduction](https://decapcms.org/docs/intro/)
[^de-flow]: **Decap CMS**: [editorial workflows](https://decapcms.org/docs/editorial-workflows/)
[^de-preview]: **Decap CMS**: [custom previews](https://decapcms.org/docs/customization/)
[^de-turbo]: **Decap CMS**: [Decap Turbo plans](https://decapcms.org/turbo/)
[^de-astro]: **Astro**: [Decap CMS and Astro](https://docs.astro.build/en/guides/cms/decap-cms/)
[^sv-gh]: **Sveltia CMS**: [GitHub repository](https://github.com/sveltia/sveltia-cms)
[^sv-feat]: **Sveltia CMS**: [features](https://sveltiacms.app/en/features)
[^sv-flow]: **Sveltia CMS**: [editorial workflow](https://sveltiacms.app/en/docs/workflows/editorial)
[^sv-entries]: **Sveltia CMS**: [entry collections](https://sveltiacms.app/en/docs/collections/entries)
[^sv-start]: **Sveltia CMS**: [getting started](https://sveltiacms.app/en/docs/start)
[^ks-home]: **Keystatic**: [home page](https://keystatic.com/)
[^ks-cloud]: **Keystatic**: [Keystatic Cloud](https://keystatic.com/docs/cloud)
[^ks-install]: **Keystatic**: [Astro installation and field list](https://keystatic.com/docs/installation-astro)
[^ks-gh]: **Keystatic**: [GitHub repository](https://github.com/Thinkmill/keystatic)
[^ks-astro]: **Astro**: [Keystatic and Astro](https://docs.astro.build/en/guides/cms/keystatic/)
[^ks-code]: **Keystatic**: [its Astro integration's code](https://github.com/Thinkmill/keystatic/blob/main/packages/astro/src/index.ts) (the `/keystatic` and `/api/keystatic` routes are injected with `prerender: false`)
[^pc-home]: **Pages CMS**: [home page](https://pagescms.org/)
[^pc-gh]: **Pages CMS**: [GitHub repository](https://github.com/hunvreus/pagescms)
[^pc-astro]: **Astro**: [Pages CMS and Astro](https://docs.astro.build/en/guides/cms/pages-cms/)
[^fm-home]: **Front Matter CMS**: [home page](https://frontmatter.codes/)
[^fm-gh]: **Front Matter CMS**: [GitHub repository](https://github.com/estruyf/vscode-front-matter)
[^fm-astro]: **Astro**: [Front Matter CMS and Astro](https://docs.astro.build/en/guides/cms/frontmatter-cms/)
[^os-home]: **Outstatic**: [home page](https://outstatic.com/)
[^os-price]: **Outstatic**: [pricing](https://outstatic.com/pricing)
[^os-lic]: **Outstatic**: [licence](https://github.com/avitorio/outstatic/blob/main/license.md)
[^sp-home]: **Sitepins**: [home page](https://sitepins.com/)
[^sp-price]: **Sitepins**: [pricing](https://sitepins.com/pricing)
[^sp-gh]: **Sitepins**: [GitHub repository](https://github.com/sitepins/sitepins)
[^sp-astro]: **Astro**: [Sitepins and Astro](https://docs.astro.build/en/guides/cms/sitepins/)
[^em-gh]: **EmDash**: [GitHub repository](https://github.com/emdash-cms/emdash)
[^em-docs]: **EmDash**: [docs](https://docs.emdashcms.com/)
[^em-astro]: **Astro**: [EmDash and Astro](https://docs.astro.build/en/guides/cms/emdash/)
[^sc-gh]: **StudioCMS**: [GitHub repository](https://github.com/withstudiocms/studiocms)
[^sc-docs]: **StudioCMS**: [getting started](https://docs.studiocms.dev/en/start-here/getting-started/)
[^sc-astro]: **Astro**: [StudioCMS and Astro](https://docs.astro.build/en/guides/cms/studiocms/)
[^sb-price]: **Storyblok**: [pricing](https://www.storyblok.com/pricing)
[^sb-astro]: **Storyblok**: [visual preview in Astro](https://www.storyblok.com/docs/guides/astro/visual-preview)
[^as-storyblok]: **Astro**: [Storyblok and Astro](https://docs.astro.build/en/guides/cms/storyblok/)
[^pr-price]: **Prismic**: [pricing](https://prismic.io/pricing)
[^pr-pb]: **Prismic**: [Page Builder](https://prismic.io/page-builder)
[^pr-astro]: **Astro**: [Prismic and Astro](https://docs.astro.build/en/guides/cms/prismic/)
[^sa-price]: **Sanity**: [pricing](https://www.sanity.io/pricing)
[^sa-astro]: **Sanity**: [Astro docs](https://www.sanity.io/docs/astro)
[^sa-gh]: **Sanity**: [GitHub repository](https://github.com/sanity-io/sanity)
[^as-sanity]: **Astro**: [Sanity and Astro](https://docs.astro.build/en/guides/cms/sanity/)
[^cf-price]: **Contentful**: [pricing](https://www.contentful.com/pricing/) (answered HTTP 429 to every check on 2026-11-03)
[^cf-astro]: **Astro**: [Contentful and Astro](https://docs.astro.build/en/guides/cms/contentful/)
[^bu-price]: **Builder.io**: [pricing](https://www.builder.io/pricing)
[^bu-gh]: **Builder.io**: [GitHub repository](https://github.com/BuilderIO/builder)
[^bu-astro]: **Astro**: [Builder.io and Astro](https://docs.astro.build/en/guides/cms/builderio/)
[^pa-gh]: **Payload**: [GitHub repository](https://github.com/payloadcms/payload)
[^pa-db]: **Payload**: [database adapters](https://payloadcms.com/docs/database/overview)
[^pa-preview]: **Payload**: [Live Preview](https://payloadcms.com/docs/live-preview/overview)
[^pa-visual]: **Payload**: [Visual Editor (Enterprise)](https://payloadcms.com/enterprise/visual-editor)
[^pa-astro]: **Astro**: [Payload and Astro](https://docs.astro.build/en/guides/cms/payload/)
[^st-price]: **Strapi**: [pricing](https://strapi.io/pricing-cms)
[^st-lic]: **Strapi**: [licence file](https://github.com/strapi/strapi/blob/main/LICENSE)
[^st-preview]: **Strapi**: [Preview feature and plans](https://docs.strapi.io/cms/features/preview)
[^st-astro]: **Astro**: [Strapi and Astro](https://docs.astro.build/en/guides/cms/strapi/)
[^wp-lic]: **WordPress**: [licence](https://wordpress.org/about/license/)
[^wp-roles]: **WordPress**: [roles and capabilities](https://wordpress.org/documentation/article/roles-and-capabilities/)
[^wp-astro]: **Astro**: [Headless WordPress and Astro](https://docs.astro.build/en/guides/cms/wordpress/)
[^wp-req]: **WordPress**: [requirements](https://wordpress.org/about/requirements/) ("MariaDB version 10.11 or greater OR MySQL version 8.0 or greater"), checked 2026-11-04
[^go-gh]: **Ghost**: [GitHub repository](https://github.com/TryGhost/Ghost) ("Released under the MIT license"), checked 2026-11-04
[^go-price]: **Ghost**: [Ghost(Pro) pricing](https://ghost.org/pricing/) (plans, staff roles, single sign-on on Custom), checked 2026-11-04
[^go-feat]: **Ghost**: [features](https://ghost.org/features/), checked 2026-11-04
[^go-roles]: **Ghost**: [managing your team](https://ghost.org/help/managing-your-team/), checked 2026-11-04
[^go-install]: **Ghost**: [install options](https://docs.ghost.org/install/), checked 2026-11-04
[^go-ubuntu]: **Ghost**: [Ubuntu install guide](https://docs.ghost.org/install/ubuntu/) (MySQL 8.0 or 8.4 "as the production database"), checked 2026-11-04
[^go-content]: **Ghost**: [Content API](https://docs.ghost.org/content-api/) (read-only), checked 2026-11-04
[^go-wp]: **Ghost**: [migrating from WordPress](https://docs.ghost.org/migration/wordpress/), checked 2026-11-04
[^go-astro]: **Astro**: [Ghost and Astro](https://docs.astro.build/en/guides/cms/ghost/), checked 2026-11-04
[^sm-price]: **Statamic**: [pricing](https://statamic.com/pricing)
[^sm-feat]: **Statamic**: [features](https://statamic.com/features)
[^sm-astro]: **Astro**: [Statamic and Astro](https://docs.astro.build/en/guides/cms/statamic/)
[^gh-api]: **GitHub**: star counts read from each repository's GitHub page on 2026-11-03 (Ghost's on 2026-11-04)
