---
title: "Decap CMS alternative for Astro: Markstage"
description: "Markstage vs Decap CMS (formerly Netlify CMS): edit on your Astro site's real design, not a form beside a preview. Facts checked 3 Nov 2026."
h1: "A Decap CMS alternative for Astro sites"
competitor: "Decap CMS"
checked: "2026-11-03"
---

Decap CMS, formerly Netlify CMS, is one of the best-known git-based editors. It is a single admin page that talks
to your git host. Writers fill in a form, with a live preview beside it. Markstage lets them edit on the page
itself.

## Who each one is for

**Decap CMS** suits developers who want a free editor with no server at all, on GitHub, GitLab, Bitbucket and
other git hosts, with a large community.

**Markstage** suits teams whose writers should edit on the site's real design, and who want staging, roles, single
sign-on, a forms inbox and SEO checks in the same tool. It needs a server. Markstage is pre-release.

## Side by side

| | Markstage | Decap CMS |
| --- | --- | --- |
| Editing | On the real page | A form with a real-time preview pane; custom preview templates |
| Content | Markdown and JSON in git | Files in your git repository |
| What you run | A Node server next to your static site | No server: an admin page; off Netlify you add your own OAuth routes |
| Sign-in without a git account | Email and password, two-step sign-in, single sign-on | Your own auth, or the hosted Decap Turbo |
| Review before going live | Staging and production with rules | Editorial workflow: a branch and pull request per entry |
| Roles | Five built in, plus custom roles | Decap Turbo: owner, member, full access; custom roles €19/mo add-on |
| SEO checks, forms inbox | Yes | Not listed |
| Price | Free to self-host | Free; Decap Turbo Pro €19/mo |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where Decap CMS is stronger

- **No server to run.** Decap is a page that calls your git host's API. Markstage needs Node and git on a server.
- **Many git hosts.** GitHub, GitLab, Bitbucket, Azure, Gitea/Forgejo and Git Gateway.
- **Community.** About 19.4k GitHub stars and many years of use.
- **Other frameworks.** Decap works with any static site generator.

## Moving from Decap CMS to Markstage

Your Markdown files stay in the same folders. For each collection in Decap's `config.yml`, add a collection with
the same folder to `markstage.config.mjs`, then add the `@markstage/astro` integration. Your media folder can stay
where it is (set `media.dir`). Remove `/admin/` when your team has moved.

## Frequently asked questions

### Is Decap CMS the same as Netlify CMS?

Yes. Decap's own docs call it "formerly Netlify CMS".

### Does Decap CMS have visual editing?

It has a real-time preview beside the form, and you can style the preview with your own templates. Editing happens
in the form, not on the page.

### Does Decap CMS work with Astro?

Yes. Astro's docs have a Decap guide. Off Netlify, the guide says you must create your own OAuth routes, which
need on-demand rendering with an adapter.

### Is there a Decap CMS alternative that edits on the page?

Markstage does, on your own server for free. CloudCannon and TinaCMS also edit on the page; CloudCannon is hosted
only, and TinaCMS can be hosted or self-hosted.

### What is Decap Turbo?

A paid hosted layer on top of Decap: hosted sign-in and roles, a proxy against git host rate limits, a content
store and site variables. Free for 1 site and 1 seat; Pro is €19 a month.

## Sources

Checked on 2026-11-03: [Decap CMS](https://decapcms.org/) ·
[Decap introduction](https://decapcms.org/docs/intro/) ·
[Decap editorial workflows](https://decapcms.org/docs/editorial-workflows/) ·
[Decap custom previews](https://decapcms.org/docs/customization/) ·
[Decap Turbo](https://decapcms.org/turbo/) ·
[Decap CMS on GitHub](https://github.com/decaporg/decap-cms) ·
[Astro: Decap guide](https://docs.astro.build/en/guides/cms/decap-cms/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
