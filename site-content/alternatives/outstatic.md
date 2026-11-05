---
title: "Outstatic alternative for Astro: Markstage"
description: "Markstage vs Outstatic: both git-based and free to self-host. Markstage edits on your Astro site's real design and includes roles. Checked 3 Nov 2026."
h1: "An Outstatic alternative for Astro sites"
competitor: "Outstatic"
checked: "2026-11-03"
---

Outstatic gives Markdown and MDX files a real editing dashboard, with content kept in your GitHub repository. Its
Pro plan adds hosted publishing, email and Google sign-in, roles and AI. Markstage is self-hosted only, edits on
the page, and includes roles and single sign-on at no cost.

## Who each one is for

**Outstatic** suits developers who want a quick dashboard for Markdown and MDX on GitHub, self-hosted for free or
hosted on Pro.

**Markstage** suits teams whose writers should edit on an Astro site's real design, with roles, staging and site
tools included. Markstage is pre-release.

## Side by side

| | Markstage | Outstatic |
| --- | --- | --- |
| Editing | On the real page | A dashboard editor with custom fields |
| Formats | Markdown, MDX and JSON | Markdown and MDX |
| Git | A git repository on your own server | GitHub |
| Sign-in without GitHub | Included: email and password, single sign-on | Pro: email magic link and Google |
| Commit author | The person who saved | Edits through email or Google sign-in commit as the Outstatic Bot |
| Roles | Five built in, plus custom roles | Team roles on Pro |
| Price | Free to self-host | Free self-hosted; Pro $9.99 per user a month |
| Licence | Elastic License 2.0 (source-available) | FSL-1.1-ALv2 (source-available; each release becomes Apache 2.0 after two years) |

## Where Outstatic is stronger

- **MDX.** Outstatic has edited MDX for longer. Markstage's MDX support is new: words and simple settings, code
  kept as written.
- **A hosted plan.** Outstatic Pro runs the dashboard for you.
- **Setup speed.** Its site promises a CMS on your repo in about five minutes.

## Moving from Outstatic to Markstage

Your Markdown files are in your repository already. Add their folders as collections in `markstage.config.mjs`
and add the `@markstage/astro` integration; MDX folders become collections with `format: 'mdx'`. Invite your
editors to Markstage; each save is then committed in their own name.

## Frequently asked questions

### Is Outstatic free?

Self-hosted, yes. Hosted projects on outstatic.com need Pro to save and publish.

### Does Outstatic work with Astro?

Its site lists Astro among the generators it works with. It is not in Astro's own list of CMS guides.

### Who appears as the commit author?

With Outstatic, edits made through email or Google sign-in are committed as the Outstatic Bot. With Markstage, the
signed-in person is the git author of each save.

## Sources

Checked on 2026-11-03: [Outstatic](https://outstatic.com/) · [Outstatic pricing](https://outstatic.com/pricing) ·
[Outstatic licence](https://github.com/avitorio/outstatic/blob/main/license.md). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
