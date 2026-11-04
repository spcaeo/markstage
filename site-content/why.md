---
title: "Why We Built Markstage: The Editor Our Own Site Needed"
description: "Why Space-O Technologies built Markstage: our site moved off WordPress to Astro, and writers still needed to edit on the real page, from our own server."
h1: Why we built Markstage
author: Rakesh Patel
role: CEO, Space-O Technologies
updated: 2026-11-04
home:
  title: We built it for our own site
  text:
    - "In October 2026 we moved our own business site, taskrhino.ca, off WordPress to a fast, static Astro site. The pages got lighter and faster. Our writers lost the place where they used to edit."
    - "They needed to change a page on its real design, not in form fields, without a content database, a subscription or MDX. None of the editors we compared did all of that from our own server, so we built one. Now we give it away to self-host."
  link: Read why we built it
---

## Our own site came first

Space-O Technologies runs taskrhino.ca, a services site with a blog. In October 2026 we decided to move it off
WordPress to a static site built with Astro: every post, page, image and file came across, 158 posts, 20 pages and
2,414 images and files. Every address was kept, and the search titles and descriptions came across with the
pages. The [showcase](/showcase/) has the before and after.

A static site is fast, and there is little on it to attack. But WordPress had one thing the new
site did not: a place where people who do not write code could change a page.

## Writers still needed the real page

The people who change our pages are writers, SEO people and developers. They all said the same thing: they need to
see exactly how the page will look while they change it. A form beside a preview, or a canvas wider than the real
column, makes every edit a guess.

So the editor had to draw each page with the site's own design: its components, its CSS and its column. And a
save had to change only what the writer changed, so a review in git shows exactly that edit.

## What we tried first

- **A git-based editor in local mode.** Its visual editor altered 143 of the 148 posts we tested it on, so we
  turned it off and gave writers a plain Markdown box instead.
- **Editors that show block labels instead of the page.** Writers saw grey boxes, not the design, and a save
  rewrote the whole file.
- **A hosted headless CMS.** The content moves into someone else's database, behind an API and a monthly plan.
  On the one we had used before, a proper path from a developer's laptop to staging to production was sold only
  on its top plans.
- **MDX.** Some of the editors we looked at edit rich text as MDX. Our content is plain Markdown and JSON, and we
  wanted to keep it that way.

## What we wanted, all at once

- Writers edit on the site's own design.
- A save changes only what was edited: a clean git diff, committed in the writer's name.
- No database server holds the content. It stays Markdown and JSON files in our repo.
- Staging and production, with rules for who may move what live, at no extra cost.
- Templates, sections and snippets that writers reuse by drag and drop, with no code.
- All of it on our own server.

We compared Markstage with 21 other editors and content systems. None of them lets writers edit on the real page
from your own server with no database server: the ones that edit on the real page are hosted services, or, for
TinaCMS on your own server, need a database adapter. The [comparison](/compare/) lists each one, with its sources,
and says where the others lead.

## So we built Markstage

Markstage started as the editor for taskrhino.ca. From the first day we kept it apart from that one site, because
we run more than one site and wanted the same editor for all of them. Everything about a site lives in its own
config and block pack; the editor itself knows no site's name.

The name says what it does: edit your Markdown on the real stage. The page is the stage, and the writer works on
it. Today taskrhino.ca is written and published with Markstage, on its own server, with releases, roles and staging.

## Now it is yours to run

Markstage is source-available under the Elastic License 2.0 and free to self-host, for your own sites and your
clients' sites. Offering it to others as a hosted service needs a commercial licence. It is pre-release: we use it
every day, and we fix what we find.

If you have an Astro site and writers who want the real page, [start with the docs](/docs/), or
[try the example blog in three commands](/#install).
