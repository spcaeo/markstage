---
title: "Markstage FAQ: the visual editor for Astro sites"
description: "Answers about Markstage: what a visual editor for Astro is, price, licence, self-hosting, databases, MDX and how it differs from a headless CMS."
h1: "Frequently asked questions"
checked: "2026-11-03"
---

## What is a visual editor for Astro?

An editor where writers change an Astro site's content while looking at the site itself: its own components,
fonts and layout, not grey form fields. Markstage shows the real page, lets people type text where it appears, and
puts other settings (an image's alt text, a link, a section's options) in a side panel.

## Does Astro have a built-in CMS or editor?

No. Astro's docs describe a CMS as a separate tool that "lets you write content and manage assets outside of your
Astro project", and list many to choose from. Astro's content collections give your Markdown, MDX, YAML and JSON
files a schema and type safety, but not an editing screen.

## Is Markstage free?

Yes, to self-host. You may use, copy, change and run it for free, in your business and for your clients' sites.
There are no per-user, per-site or per-language fees. The one thing you may not do without a commercial licence is
offer Markstage to others as a hosted or managed service.

## Is Markstage free software under an OSI licence?

It is not open source in the OSI sense. Markstage is source-available under the Elastic License 2.0: the code is
public, and you may run and change it for free, with the one limit above.

## How does Markstage compare with WordPress, Ghost and Prismic?

WordPress and Ghost are mature publishing platforms with large communities; with Astro, both are used headless, so
writers work in their own admin and Astro reads the content by API. Ghost also has newsletters and paid memberships
built in. Prismic is a hosted page builder. Markstage lets writers edit on the Astro site's own design, keeps
content as files in git and runs on your own server. The [comparison](/compare/) puts the four side by side, with
sources.

## How is Markstage different from a headless CMS?

A headless CMS keeps your content in its own database, usually hosted, and your site reads it through an API.
Markstage keeps content as Markdown and JSON files in your git repository, and the Astro site reads them like any
other files. There is no content database and no content API to depend on.

## How is it different from other git-based editors?

Most git-based editors (Decap CMS, Sveltia CMS, Keystatic, Pages CMS) show a form, sometimes beside a preview.
Markstage edits on the page. CloudCannon and TinaCMS also edit on the page: CloudCannon is a hosted service, and
TinaCMS can be hosted or self-hosted. Markstage also includes staging, roles, single sign-on and a forms inbox at no
cost. The [full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md) has the details and
sources.

## Do I need a database?

Not for content: that stays as files in git. One SQLite file on the server (the SQLite built into Node) holds
people, sessions, the inbox, drafts in progress, trash, releases, the media index and the audit log. There is no
database server to install.

## What do I need to self-host it?

Node.js 22.13 or newer and git, on a server next to your site, or Docker: the server image runs it with one
`docker run` next to your site's git folder (docs/DOCKER.md). The deploy guide covers Docker Compose, or systemd
and nginx without Docker.

## Does my Astro site have to use server rendering?

No. Markstage's editing markup appears only in editor mode, so your production build stays exactly as it is and
can stay fully static.

## Does Markstage support MDX?

Yes, new after 0.3.0. MDX too: code stays locked, prose is editable. Writers type the words on the page and change
a component's simple settings (text, numbers, on/off) in a side panel. Imports, exports, `{expressions}` and code
settings are kept exactly as written, and components show as cards on the canvas rather than as the site renders
them. A save changes only what the writer changed. A file Markstage cannot read opens read-only in Source mode,
with a plain message. TinaCMS, Keystatic and Outstatic have edited MDX for longer.

## Can I move a WordPress, Ghost or Prismic site to Markstage?

Yes, new after 0.3.0. Import a site (More tools in the editor) reads a WordPress export or REST API, a Ghost export
or Content API, or a Prismic repository, and brings over posts, pages, images, authors, categories and tags, search
titles and descriptions, and the old addresses as redirects. You see the whole plan before anything is written, and
everything arrives as drafts. Blocks, cards or slices it cannot convert are marked in the text and listed for review.
The WordPress importer is proven on a real 148-post site's export; Ghost and Prismic are tested on sample exports so far.

## Can people without a GitHub account edit?

Yes. People sign in to Markstage with an email and password, with optional two-step sign-in, or through your
single sign-on provider (OpenID Connect). Each save is still a git commit in their own name.

## Is Markstage ready for production?

Markstage is pre-release and in active development. It is built and tested against a real 460-page Astro site, but
most other products in this space have years of production use. Check the changelog and try it on a copy of your
site first.

## Who makes Markstage?

Space-O Technologies ([www.spaceo.ca](https://www.spaceo.ca)). The author is Rakesh Patel.
