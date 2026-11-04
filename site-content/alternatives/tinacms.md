---
title: "TinaCMS alternative for Astro: Markstage"
description: "Markstage vs TinaCMS for Astro: edit on your site's real design, keep content in git, self-host free with no database server. Checked 3 Nov 2026."
h1: "A TinaCMS alternative for Astro sites"
competitor: "TinaCMS"
checked: "2026-11-03"
---

TinaCMS and Markstage both keep your content as files in git and both let people edit on the page. They differ in
what you run, what it costs and what the editor covers beyond the page.

## Who each one is for

**TinaCMS** suits developers who want click-to-edit on their pages, MDX, and a hosted backend (TinaCloud) or a
self-hosted one. It works with Astro, Next.js and other frameworks.

**Markstage** suits teams with an Astro site whose writers should work on the real design, and who want staging,
roles, single sign-on, a forms inbox and releases included, on their own server, for free. Markstage is
pre-release.

## Side by side

| | Markstage | TinaCMS |
| --- | --- | --- |
| Editing on the page | Text typed on the real page; other fields in a side panel | Click a region; its field opens in a sidebar form and the page updates live |
| Setting up a page for editing | Each component marks its fields with a helper (the marks appear in editor mode only) | Each page gets a schema field, a data loader, and an island or a server route |
| Astro output | The live site stays fully static | Visual editing wants `output: 'server'` and an adapter, or every region in `<TinaIsland>` |
| Content | Markdown and JSON in git | Markdown, MDX, JSON, YAML in git |
| MDX | No | Yes |
| Self-hosting | Free; no database server (its working data, such as people, sessions, the inbox and drafts, in one SQLite file) | Free; needs a database adapter such as MongoDB or Postgres as a cache, and "some features are not available" |
| Hosted plan | None | TinaCloud: Free (2 users), Team $29/mo, Business $299/mo |
| Review before going live | Staging and production, promotion rules, included | Editorial workflow on protected branches and pull requests, on Team and up |
| Roles | Five built in, plus custom roles | 3 roles; custom roles on Enterprise (beta) |
| Single sign-on | OpenID Connect, included | Enterprise |
| Forms inbox | Yes | Not listed |
| Licence | Elastic License 2.0 (source-available) | Apache 2.0 |

## Where TinaCMS is stronger

- **MDX.** TinaCMS edits MDX; Markstage edits Markdown and JSON only.
- **A hosted option.** TinaCloud runs the backend for you. Markstage needs a server you look after.
- **Many frameworks.** TinaCMS supports more than Astro. Markstage's only adapter today is Astro.
- **A large community.** TinaCMS has about 13.9k stars on GitHub and years of use.

## Moving from TinaCMS to Markstage

Your Markdown and JSON files stay where they are. List the same folders as collections in `markstage.config.mjs`,
add the `@markstage/astro` integration, and mark the fields your components show so they can be edited on the page.
MDX files are not edited by Markstage, so keep them in TinaCMS or convert them to Markdown first. When you are
ready, remove the `tina()` integration and the island routes. Run the Markstage server with Docker Compose or
systemd and nginx; see the deploy guide.

## Frequently asked questions

### Is there a free TinaCMS alternative for Astro?

Yes. Markstage is free to self-host, with no per-user fees, and edits Astro sites on their real design. TinaCMS
itself is also free to self-host, but it then needs a database adapter, and its hosted plan is free for two users.

### Does TinaCMS work with Astro?

Yes. TinaCMS has an Astro guide and an `@tinacms/astro` integration with visual editing. Its docs say visual
editing needs server output and an adapter, or every editable region wrapped in `<TinaIsland>`.

### Can Markstage edit MDX like TinaCMS?

No. Markstage edits Markdown with front matter and JSON. If your site depends on MDX components, TinaCMS or
Keystatic fits better.

### Do I need a database to self-host?

TinaCMS's self-hosted backend uses a database adapter (its docs name MongoDB and Postgres) as a cache of your
files. Markstage needs no database server: one SQLite file holds people, sessions, the inbox,
drafts in progress, trash, releases, the media index and the audit log; the content stays in git.

### Which one has staging?

Markstage has local, staging and production built in, each a git branch plus a server. TinaCMS has an editorial
workflow on protected branches with pull requests and preview links, on its Team plan and up.

## Sources

Checked on 2026-11-03: [TinaCMS pricing](https://tina.io/pricing) ·
[TinaCMS Astro guide](https://tina.io/docs/frameworks/astro) ·
[TinaCMS self-hosting](https://tina.io/docs/self-hosted/overview) ·
[TinaCMS editorial workflow](https://tina.io/docs/tinacloud/editorial-workflow) ·
[TinaCMS on GitHub](https://github.com/tinacms/tinacms) ·
[Astro: TinaCMS guide](https://docs.astro.build/en/guides/cms/tina-cms/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
