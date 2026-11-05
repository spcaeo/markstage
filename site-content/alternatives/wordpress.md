---
title: "WordPress alternative for Astro sites: Markstage"
description: "Moving from WordPress to Astro? Markstage gives writers a WordPress-style editor on your Astro site's real design, with content in git. Checked 3 Nov 2026."
h1: "A WordPress alternative for Astro sites"
competitor: "WordPress"
checked: "2026-11-03"
---

Many teams leave WordPress for Astro to get a fast, static site, then miss the editor. You can run WordPress
headless and read it from Astro, or you can give writers an editor that works on the Astro site itself. Markstage
is the second kind.

## Who each one is for

**WordPress** suits sites that want its huge plugin and theme ecosystem, or that use it headless as a familiar
admin for content Astro reads by API.

**Markstage** suits teams who moved to Astro and want a WordPress-style editing journey (drafts, scheduling,
roles, media, revisions, trash) on the Astro site's real design, with content as files in git. Markstage is
pre-release.

## Side by side

| | Markstage | WordPress (headless, with Astro) |
| --- | --- | --- |
| Editing | On the Astro site's real design | In WordPress's admin; Astro draws the pages |
| Where content lives | Markdown and JSON in git | WordPress's database, read through its REST API |
| What you run | A Node server next to your static site | A WordPress site, plus your Astro site |
| Roles | Owner, Administrator, Editor, Author, Contributor, plus custom roles | Super Admin, Administrator, Editor, Author, Contributor, Subscriber |
| Revisions | Every save is a git commit; restore any version | Built in |
| Plugins | Block packs and site config | A very large plugin ecosystem |
| Licence | Elastic License 2.0 (source-available) | GPLv2 or later |

## Where WordPress is stronger

- **The ecosystem:** themes, plugins, hosts and people who know it.
- **Everything in one place** when WordPress also draws the site.
- **Memberships, comments and e-commerce** through plugins.

## Moving from WordPress to Markstage

Markstage has importers for the parts of a WordPress site that are hardest to move (a fuller WordPress import of
posts, pages, media, authors and redirects is coming in 0.4.0, [roadmap](/roadmap/#import)):

- **Reusable blocks** (patterns) come in from a WordPress export (`.xml`) or a database dump (`.sql` or `.sql.gz`)
  as shared sections in the Library, with their Gutenberg HTML read into Markdown and the site's blocks.
- **Old contact form messages** come into the Inbox with `markstage-server forms import-wordpress`.
- **Posts, pages and media** come in through the import API from JSON: a dry run first, imported as drafts, and
  idempotent on each source id (such as the WordPress post id).

Writers then find familiar ideas: drafts, scheduled publishing, roles with WordPress's names, a media library,
trash, revisions, password-protected pages and "Additional CSS".

## Frequently asked questions

### Can I use WordPress with Astro?

Yes, as a headless CMS. Astro's docs show how to read posts through the WordPress REST API, which every WordPress
site has.

### What is the best WordPress alternative for an Astro site?

It depends on what you miss most. If it is the editor, Markstage gives writers a WordPress-style journey on the
Astro site itself, with content in git. If it is plugins, headless WordPress keeps them. If you are also weighing
Ghost or Prismic, see [Markstage vs Ghost](/alternatives/ghost/), [Markstage vs Prismic](/alternatives/prismic/)
and the [comparison of all four](/compare/).

### Is Markstage free like WordPress?

Markstage is free to self-host under the Elastic License 2.0. It is source-available, not a GPL licence: you may
not offer it to others as a hosted service without a commercial licence.

## Sources

Checked on 2026-11-03: [WordPress licence](https://wordpress.org/about/license/) ·
[WordPress roles](https://wordpress.org/documentation/article/roles-and-capabilities/) ·
[Astro: headless WordPress guide](https://docs.astro.build/en/guides/cms/wordpress/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md),
[Library import](https://github.com/spcaeo/markstage/blob/main/docs/API-LIBRARY.md) and
[import API](https://github.com/spcaeo/markstage/blob/main/docs/API-IMPORT.md).
