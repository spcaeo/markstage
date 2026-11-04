---
title: "Pages CMS alternative for Astro: Markstage"
description: "Markstage vs Pages CMS: both edit files in git. Markstage edits on your Astro site's real design and adds roles, staging and forms. Checked 3 Nov 2026."
h1: "A Pages CMS alternative for Astro sites"
competitor: "Pages CMS"
checked: "2026-11-03"
---

Pages CMS calls itself "the simplest CMS you'll ever need": it edits the content and media in your GitHub
repository, with no database, no API and no extra backend for the content. Markstage does more, and needs more:
writers edit on the page, and its server adds roles, staging and a forms inbox.

## Who each one is for

**Pages CMS** suits small sites on GitHub that want a free, simple editor, used online at app.pagescms.org or
self-hosted.

**Markstage** suits teams whose writers should edit on the real design and who need roles, review, single sign-on
and site tools in one place. Markstage is pre-release.

## Side by side

| | Markstage | Pages CMS |
| --- | --- | --- |
| Editing | On the real page | Forms with a rich-text editor |
| Git hosts | A git repository on your own server | GitHub only |
| Self-hosting | A Node server; its working data (people, sessions, inbox, drafts, releases) in one SQLite file | Needs PostgreSQL and a GitHub App |
| Hosted | None | app.pagescms.org, free |
| Roles | Five built in, plus custom roles | "Soon" on its site |
| Scheduling | Yes | "Soon" on its site |
| Staging, forms inbox, SEO checks | Included | Not listed |
| Price | Free to self-host | Free |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where Pages CMS is stronger

- **Simplicity.** Sign in with GitHub and start editing; there is a free hosted version.
- **Any generator.** It works with Jekyll, Hugo, Next.js, Astro and others.
- **Mobile.** Its site lists a full responsive design.

## Moving from Pages CMS to Markstage

Your files stay in place. Your Pages CMS configuration names a folder for each kind of content; add the same folders as
collections in `markstage.config.mjs` and add the `@markstage/astro` integration. Invite your editors to Markstage
by email; they no longer need a GitHub account.

## Frequently asked questions

### Is Pages CMS free?

Yes. Its site says it is free whether you use the online version, deploy it on Vercel or self-host it.

### Does Pages CMS work with Astro?

Yes. Astro's docs have a Pages CMS guide.

### Does Pages CMS support GitLab?

Its FAQ says GitHub only, for now.

### What does Markstage add over Pages CMS?

Editing on the site's real design, roles and custom roles, single sign-on, staging and production, releases,
scheduled publishing, a forms inbox, SEO checks and translation status.

## Sources

Checked on 2026-11-03: [Pages CMS](https://pagescms.org/) ·
[Pages CMS on GitHub](https://github.com/hunvreus/pagescms) ·
[Astro: Pages CMS guide](https://docs.astro.build/en/guides/cms/pages-cms/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
