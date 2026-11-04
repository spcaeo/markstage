---
title: "Sveltia CMS alternative for Astro: Markstage"
description: "Markstage vs Sveltia CMS: both keep content in git. Markstage edits on your Astro site's real design and adds staging and roles. Checked 3 Nov 2026."
h1: "A Sveltia CMS alternative for Astro sites"
competitor: "Sveltia CMS"
checked: "2026-11-03"
---

Sveltia CMS is a modern rewrite of Netlify/Decap CMS: a fast single-page app with no server and no database,
strong translation support and a two-pane editor with live preview. Markstage takes a different path: writers
edit on the page, and a server adds staging, roles and a forms inbox.

## Who each one is for

**Sveltia CMS** suits sites that want a free, light editor with nothing to host, first-class multilingual
content, and a smooth move from Decap CMS.

**Markstage** suits teams whose writers should work on the real design, and who need sign-in without a git
account, roles, staging and single sign-on. It needs a server. Markstage is pre-release.

## Side by side

| | Markstage | Sveltia CMS |
| --- | --- | --- |
| Editing | On the real page | Two panes: form and live preview, with scroll sync and click-to-highlight |
| What you run | A Node server next to your static site | Nothing: a single-page app served from a CDN |
| Sign-in | Email and password, two-step, single sign-on | OAuth with your git host |
| Review before going live | Staging and production with rules | Editorial workflow (GitHub, GitLab, Gitea/Forgejo) |
| Translations | Per-language status: missing, outdated, done | First-class i18n, locales in one file, separate files or folders |
| Formats | Markdown and JSON | Markdown with front matter, YAML, JSON, TOML |
| Forms inbox, SEO checks | Yes | Not listed |
| Price | Free to self-host | Free |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where Sveltia CMS is stronger

- **Nothing to host.** No server, no database, no upgrades to install.
- **Translations.** Many ways to lay out locales, localized slugs, and per-locale required fields.
- **Mobile.** Its docs list mobile support.
- **Formats.** YAML and TOML as well as Markdown and JSON.

## Moving from Sveltia CMS to Markstage

Sveltia reads Decap-style configuration, so your collections already name their folders. Add the same folders as
collections in `markstage.config.mjs` and add the `@markstage/astro` integration. Markstage edits Markdown and
JSON; keep TOML or YAML data files in Sveltia or convert them. Writers then sign in to Markstage with an email
address instead of a git host account.

## Frequently asked questions

### Is Sveltia CMS free?

Yes. Its site says it is free, with no server and no database.

### Does Sveltia CMS work with Astro?

Its README says it works well with Astro and has a showcase of Astro sites. It is not in Astro's own list of CMS
guides.

### Does Sveltia CMS have visual editing?

It has a live preview beside the form, with click-to-highlight. Editing happens in the form. Markstage edits on
the page itself.

### Can my writers use Markstage without a GitHub account?

Yes. People sign in to Markstage with an email and password (and two-step sign-in), or through your single sign-on
provider. Each save is still a git commit in their name.

## Sources

Checked on 2026-11-03: [Sveltia CMS on GitHub](https://github.com/sveltia/sveltia-cms) ·
[Sveltia features](https://sveltiacms.app/en/features) ·
[Sveltia editorial workflow](https://sveltiacms.app/en/docs/workflows/editorial) ·
[Sveltia entry collections](https://sveltiacms.app/en/docs/collections/entries) ·
[Sveltia getting started](https://sveltiacms.app/en/docs/start). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
