---
title: "Markstage Roadmap: What Is Being Built Next and Later"
description: "What the Markstage team is building for the next release and what is planned later: npm packages, adapters beyond Astro, live co-editing and more."
h1: "Markstage roadmap"
# One source of truth for every "coming" badge on the site and the README's Roadmap section (compare.test.mjs
# checks both). status: in-progress (being built for the next minor release; the badge names it from package.json),
# planned (later) or shipped (no badge any more).
# rows: the rows of docs/COMPARISON.md whose Markstage cell the item changes; never a row Markstage already has as ✓.
items:
  - id: mdx
    title: MDX editing
    what: Edit the prose of MDX files on the page; code and components stay locked, shown as cards.
    status: shipped
    rows: [MDX]
  - id: import
    title: Import from WordPress, Ghost and Prismic
    what: Bring posts, pages, media, authors and redirects across from WordPress, Ghost or Prismic.
    status: shipped
    rows: []
  - id: server-image
    title: A ready server image
    what: A Docker image of the Markstage server, built and tested by CI.
    status: shipped
    rows: []
  - id: starter-site
    title: A starter site
    what: An Astro blog with Markstage already set up, to start a new site from.
    status: shipped
    rows: []
  - id: live-demo
    title: A live demo
    what: Try the editor on a sample blog in your browser, with no sign-up.
    status: shipped
    rows: []
  - id: ai-writing
    title: AI writing help on the page
    what: Rewrite, shorten or fix the grammar of a selection; the writer accepts or rejects each change, and nothing saves by itself.
    status: shipped
    rows: []
  - id: ai-providers
    title: More AI providers
    what: Any OpenAI-compatible endpoint, and local models such as Ollama, beside Anthropic.
    status: shipped
    rows: []
  - id: mcp-publish
    title: An MCP publish tool
    what: An AI agent may ask to publish, and the site's publish rules decide, as they do for a person.
    status: shipped
    rows: []
  - id: npm
    title: Packages on npm
    what: Install @markstage/astro and @markstage/server from npm, without a clone of the repository.
    status: in-progress
    rows: []
  - id: server-canvas
    title: The real page on the server, too
    what: The built editor on a server draws each article inside its real page, as astro dev does today.
    status: shipped
    rows: []
  - id: adapters
    title: Adapters beyond Astro
    what: The core has no framework in it; more site generators after Astro.
    status: planned
    rows: []
  - id: co-editing
    title: Live co-editing
    what: Several people in one page at once, with live cursors, beside today's locks and three-way merge.
    status: planned
    rows: [Live co-editing (cursors), Real-time collaboration]
  - id: ai-translate
    title: AI translation of a whole site
    what: Draft every page of a site in another language in one run, for people to review.
    status: shipped
    rows: []
  - id: ai-seo
    title: AI link and SEO suggestions
    what: Suggested internal links and fixes for search problems, for a person to accept.
    status: shipped
    rows: []
  - id: multi-process
    title: More than one server process
    what: Several server processes on one data dir, on one machine, sharing the sign-in and share-link limits, the locks and the jobs.
    status: shipped
    rows: []
  - id: stable
    title: A stable 1.0
    what: After deeper quality, security and performance work.
    status: planned
    rows: []
---

Markstage is pre-release (0.x): a minor version may still change how things work. This page lists what is being
built now for the next release and what is planned after it. We promise no dates beyond that.

Every "Coming in" or "Planned" badge on the comparison pages links here. The mark beside it is always what
Markstage does today.

Have a need that is not here? [Open a feature request](https://github.com/spcaeo/markstage/issues/new/choose).
