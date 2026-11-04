---
title: "EmDash vs Markstage: two CMS paths for Astro"
description: "EmDash keeps Astro content in a SQL database; Markstage keeps it as Markdown and JSON in git and edits on the real page. Facts checked 3 Nov 2026."
h1: "EmDash vs Markstage: which fits your Astro site?"
competitor: "EmDash"
checked: "2026-11-03"
---

EmDash and Markstage are both built for Astro and both free to self-host, but they store content in opposite ways.
EmDash is a full-stack CMS inside your Astro site, with content in a SQL database, in the spirit of WordPress.
Markstage keeps every page and post as a file in git.

## Who each one is for

**EmDash** suits sites that want a WordPress-like CMS in Astro: content types made in an admin screen, a plugin
system with sandboxed plugins, and content queried live, on Cloudflare or Node with SQLite.

**Markstage** suits sites that want content as Markdown and JSON in git, every save as a reviewable commit, writers
on the real design, and a static live site. Markstage is pre-release.

## Side by side

| | Markstage | EmDash |
| --- | --- | --- |
| Where content lives | Markdown and JSON in git | A SQL database (SQLite, D1, Turso, PostgreSQL) |
| Content format | Markdown and JSON files | Portable Text (structured JSON) in the database |
| Content types | Defined in `markstage.config` and your files | Defined in the database through the admin |
| Editing | On the real page | An admin panel; its README also lists inline visual editing |
| Live site | Stays static; Markstage runs beside it | The Astro site runs as a server (Workers or Node) |
| Roles | Five built in, plus custom roles | Administrator, Editor, Author, Contributor |
| Sign-in | Password, two-step, OpenID Connect | Passkeys first, with OAuth and magic links; no single sign-on listed |
| Plugins | Block packs and site config | Sandboxed plugins with capability manifests |
| AI agents | MCP server | MCP server and agent skills |
| WordPress import | Reusable blocks and old contact messages; posts through the JSON import | An import wizard |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where EmDash is stronger

- **WordPress-style flexibility:** content types made by non-developers in the admin, and a plugin system.
- **Live content** through Astro's live collections, with no rebuild.
- **A large, fast-growing community** (about 14.1k GitHub stars on 3 November 2026).
- **Runs on Cloudflare** as well as on Node.

## Which one to pick

Pick EmDash if you want a database-backed CMS with plugins and content types that editors create. Pick Markstage if
you want your content in git as plain files, every change reviewable as a diff, a static live site, and editing on
the real design.

## Frequently asked questions

### Is EmDash free?

Its repository is under the MIT licence, and its docs describe running it yourself on Cloudflare
or Node.

### Does EmDash keep content in git?

No. Its README says content types and content are stored in a SQL database.

### Does Markstage need a database?

Not for content: the content itself is files in git. One SQLite file on the server holds people, sessions, the
inbox, drafts in progress, trash, releases, the media index and the audit log.

## Sources

Checked on 2026-11-03: [EmDash on GitHub](https://github.com/emdash-cms/emdash) ·
[EmDash docs](https://docs.emdashcms.com/) ·
[Astro: EmDash guide](https://docs.astro.build/en/guides/cms/emdash/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
