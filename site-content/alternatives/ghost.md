---
title: "Ghost alternative for Astro sites: Markstage"
description: "Markstage vs Ghost for Astro: writers edit on the site's real design, content stays as files in git, self-hosted with no MySQL. Facts checked 4 Nov 2026."
h1: "A Ghost alternative for Astro sites"
competitor: "Ghost"
checked: "2026-11-04"
---

Ghost is a mature publishing platform with its own editor, themes, newsletters and paid memberships. Many Astro
sites use it headless: writers work in Ghost's admin, and Astro reads the posts through Ghost's Content API.
Markstage takes the other road: writers edit on the Astro site itself, and the content stays as Markdown and JSON
files in your git repository.

## Who each one is for

**Ghost** suits publications: a blog or a magazine that wants newsletters, memberships and paid subscriptions built
in, with its own themes, run on your own server or on Ghost(Pro). It has many years of production use and a large
community (55.7k stars on GitHub on 4 November 2026).

**Markstage** suits Astro sites whose writers should edit on the site's real design, where content belongs in git
next to the code, and where staging, roles and single sign-on should come included. Markstage is pre-release.

## Side by side

| | Markstage | Ghost (headless, with Astro) |
| --- | --- | --- |
| Editing | On the Astro site's real design | In Ghost's own editor; Astro draws the pages |
| Where content lives | Markdown and JSON in git | A MySQL database, read through the Content API |
| What you run | A Node server next to your static site | A Ghost server (Node.js and MySQL 8), or Ghost(Pro) |
| Astro | `@markstage/astro` integration | A guide in Astro's docs, with the `@tryghost/content-api` client |
| Roles | Owner, Administrator, Editor, Author, Contributor, plus custom roles | Owner, Administrator, Editor, Author, Contributor |
| Single sign-on | OpenID Connect, included | On the Ghost(Pro) Custom plan |
| Staging and production | Included | ? (not confirmed on the pages we checked) |
| Newsletters and paid memberships | No | Built in |
| Hosted plan | No: self-host only | Ghost(Pro), from $18 a month ($15 a month billed yearly) |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where Ghost is stronger

- **Newsletters, memberships and paid subscriptions** in the same tool as the posts.
- **A hosted service.** Ghost(Pro) runs it for you; Markstage needs a server you look after.
- **Years of use and a large community,** with a theme marketplace and many integrations.
- **A permissive licence.** Ghost's code is under the MIT licence.

## Moving from Ghost to Markstage

Ghost exports posts, pages, tags, tiers and settings as one JSON file (Settings, then Advanced, then
Import/Export), and members as a CSV file. Markstage imports that JSON file, or reads the
Content API, new after 0.3.0: posts and pages written in Lexical or Mobiledoc become Markdown with their cards,
feature images, tags, authors and meta titles come along, and the old addresses are sent on to the new pages. A dry
run shows the whole plan first, everything arrives as a draft, and running it again only updates what changed (it
remembers each Ghost post id). Cards it cannot convert, such as a signup form, are marked in the text for review.
Members, tiers and newsletters stay with Ghost. It is tested on sample exports, not yet on many real sites.

Writers then find familiar ideas: author profiles with co-authors, drafts, scheduled publishing, a check before a
post goes live, roles with the same names, a media library and revisions. Newsletters and paid memberships have no
Markstage equivalent; keep Ghost or another tool for those.

## Frequently asked questions

### Can I use Ghost with Astro?

Yes, as a headless CMS. Astro's docs have a "Ghost & Astro" guide that reads posts through Ghost's Content API with
the `@tryghost/content-api` client. Writers keep using Ghost's own editor.

### What is the best Ghost alternative for an Astro site?

It depends on what you use Ghost for. If it is newsletters and paid memberships, Ghost does them well and Markstage
does not. If it is the writing and editing, Markstage gives writers an editor on the Astro site itself, with content
in git. The two other products people weigh most often have pages too: [WordPress](/alternatives/wordpress/) and
[Prismic](/alternatives/prismic/), and the [comparison](/compare/) puts all four side by side.

### Does Markstage need MySQL like Ghost?

No. Content stays as files in git. One SQLite file, built into Node.js, holds people, sessions, the inbox, drafts in
progress and the audit log, so there is no database server to run.

### Is Markstage free like Ghost?

Both are free to self-host. Markstage is source-available under the Elastic License 2.0: you may not offer it to
others as a hosted service without a commercial licence.

## Sources

Checked on 2026-11-04: [Ghost(Pro) pricing](https://ghost.org/pricing/) ·
[Ghost features](https://ghost.org/features/) ·
[Ghost on GitHub](https://github.com/TryGhost/Ghost) ·
[Ghost staff roles](https://ghost.org/help/managing-your-team/) ·
[Ghost on Ubuntu](https://docs.ghost.org/install/ubuntu/) ·
[Ghost Content API](https://docs.ghost.org/content-api/) ·
[Ghost exports](https://ghost.org/help/exports/) ·
[Astro: Ghost guide](https://docs.astro.build/en/guides/cms/ghost/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md),
[authors](https://github.com/spcaeo/markstage/blob/main/docs/API-AUTHORS.md),
[import API](https://github.com/spcaeo/markstage/blob/main/docs/API-IMPORT.md) and
[single sign-on](https://github.com/spcaeo/markstage/blob/main/docs/API-SSO.md).
