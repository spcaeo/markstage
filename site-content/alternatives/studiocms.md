---
title: "StudioCMS vs Markstage for Astro sites"
description: "StudioCMS is a server-rendered Astro CMS with a database; Markstage keeps content in git and edits on the real page. Facts checked 3 Nov 2026."
h1: "StudioCMS vs Markstage: which fits your Astro site?"
competitor: "StudioCMS"
checked: "2026-11-03"
---

StudioCMS is a headless CMS built for Astro, with its own dashboard, plugins and renderers. It runs with your
Astro site in server mode and keeps content in a database. Markstage keeps content as files in git and leaves the
live site static.

## Who each one is for

**StudioCMS** suits Astro sites that already render on a server and want a dashboard CMS inside the project, with a
libSQL, MySQL or PostgreSQL database.

**Markstage** suits sites that want content in git, a static live site, and writers editing on the real design.
Markstage is pre-release.

## Side by side

| | Markstage | StudioCMS |
| --- | --- | --- |
| Where content lives | Markdown and JSON in git | A database: libSQL, MySQL or PostgreSQL |
| Astro output | The live site stays static | Needs an Astro adapter with server routes |
| Editing | On the real page | A dashboard |
| Renderers | Markdown and the site's own components | Plugins for Markdown, MDX, Markdoc, HTML and WYSIWYG |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where StudioCMS is stronger

- **Built only for Astro,** with a dashboard and plugins in the project itself.
- **Several renderers,** including MDX and Markdoc.
- **No separate server** beyond your server-rendered Astro site.

## Frequently asked questions

### Does StudioCMS need a database?

Yes. Its getting-started guide asks for a libSQL, MySQL or PostgreSQL connection and an Astro adapter.

### Can Markstage work with a static Astro site?

Yes. Markstage runs next to the site as its own server and adds editing markup only in editor mode, so the
production build is unchanged.

## Sources

Checked on 2026-11-03: [StudioCMS on GitHub](https://github.com/withstudiocms/studiocms) ·
[StudioCMS getting started](https://docs.studiocms.dev/en/start-here/getting-started/) ·
[Astro: StudioCMS guide](https://docs.astro.build/en/guides/cms/studiocms/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
