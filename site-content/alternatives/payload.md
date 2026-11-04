---
title: "Payload alternative for Astro sites: Markstage"
description: "Markstage vs Payload for an Astro site: editing on the real page with content in git, instead of a Next.js backend and database. Checked 3 Nov 2026."
h1: "A Payload alternative for Astro content sites"
competitor: "Payload"
checked: "2026-11-03"
---

Payload is a Next.js-native headless CMS and application framework, with a database (MongoDB, Postgres or
SQLite), very granular access control and Live Preview. With Astro, it is a separate backend that your site reads.
Markstage is narrower: an editor for an Astro site's Markdown and JSON files in git.

## Who each one is for

**Payload** suits developers building an application, a shop or a content backend that needs custom code, a
database and fine access control, often with Next.js.

**Markstage** suits an Astro content site whose writers should edit on the real design, with no application
backend to build. Markstage is pre-release.

## Side by side

| | Markstage | Payload |
| --- | --- | --- |
| What it is | An editor for an Astro site's content files | A Next.js-native CMS and app framework |
| Where content lives | Markdown and JSON in git | MongoDB, Postgres or SQLite |
| Editing | On the real page | Admin panel; Live Preview of your front end in an iframe |
| On-page visual editor | Included | Listed as "coming soon" among Enterprise features |
| Publishing workflows, SSO | Included | Listed among Enterprise features |
| Astro | `@markstage/astro` integration | A guide and an example project in Astro's docs |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where Payload is stronger

- **A full backend:** your own collections, hooks, APIs and access control, in code.
- **Apps and shops,** not only content sites.
- **A very large community** (about 45.6k GitHub stars on 3 November 2026).

## Moving from Payload to Markstage

For a content site, export your documents through Payload's API, convert rich text to Markdown, and run
Markstage's import API (dry run first, imported as drafts, idempotent on each source id). Keep Payload if the same
backend also runs an app.

## Frequently asked questions

### Does Payload work with Astro?

Yes, as a headless source: Astro's docs have a Payload guide and link an official example project.

### Is Payload free?

Its repository is under the MIT licence. Some features (a visual editor, publishing workflows,
SSO) are listed as Enterprise features.

### When is Markstage the better fit?

When the site is an Astro content site, the team wants content as files in git, and nobody wants to run an
application backend and database for it.

## Sources

Checked on 2026-11-03: [Payload on GitHub](https://github.com/payloadcms/payload) ·
[Payload database adapters](https://payloadcms.com/docs/database/overview) ·
[Payload Live Preview](https://payloadcms.com/docs/live-preview/overview) ·
[Payload Visual Editor](https://payloadcms.com/enterprise/visual-editor) ·
[Astro: Payload guide](https://docs.astro.build/en/guides/cms/payload/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
