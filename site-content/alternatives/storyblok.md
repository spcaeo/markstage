---
title: "Storyblok alternative for Astro: Markstage"
description: "Markstage vs Storyblok: visual editing on your Astro site with content in git, self-hosted, staging and custom roles included. Facts checked 3 Nov 2026."
h1: "A Storyblok alternative for Astro sites"
competitor: "Storyblok"
checked: "2026-11-03"
---

Storyblok is a hosted, component-based headless CMS with a Visual Editor: your site shows in a preview area and
clicking a component opens its block. Markstage also edits on the real page, but keeps the content as files in
your git repository and runs on your own server.

## Who each one is for

**Storyblok** suits marketing teams who want a hosted visual CMS with many locales, AI features, A/B testing on
top plans and enterprise support.

**Markstage** suits Astro sites that want visual editing without a hosted database or seat fees, and with staging,
releases and custom roles included. Markstage is pre-release.

## Side by side

| | Markstage | Storyblok |
| --- | --- | --- |
| Visual editing | On the real page; text typed in place | Visual Editor: click a component, its block opens in the editor |
| Where content lives | Markdown and JSON in your git repository | Storyblok's hosted service, read by API |
| Astro | `@markstage/astro`; the live site stays static | `@storyblok/astro`; live preview needs server or client rendering |
| Price to start | Free to self-host | Starter free (1 seat, up to 2); Growth $99/mo ($90.75 yearly) |
| Seats | No limit, no fee | 5 on Growth (up to 10), 15 on Growth Plus; $15 per extra seat |
| Environments | Local, staging and production, included | Premium and Elite |
| Releases | Included | Premium and Elite |
| Custom roles and workflows | Included | Premium and Elite |
| Single sign-on | OpenID Connect, included | Premium and Elite |
| Licence | Elastic License 2.0 (source-available) | Closed, hosted service |

## Where Storyblok is stronger

- **Hosted,** with traffic and API limits handled for you; nothing to run.
- **Many channels** from one content API.
- **Enterprise features:** A/B testing, AI SEO, SCIM, a 99.9% uptime SLA on top plans.
- **A large ecosystem** of integrations and partners.

## Moving from Storyblok to Markstage

Storyblok content has to become Markdown or JSON files. Read your stories through Storyblok's API, write them as
JSON in the shape Markstage's import API takes, and run it: a dry run first, then the import as drafts, with each
source id remembered so a second run only updates what changed. Each Storyblok component becomes a section in
your Astro components and Markstage block pack.

## Frequently asked questions

### Is there a free Storyblok alternative with visual editing?

Markstage is free to self-host and edits on your Astro site's real design. Storyblok also has a free Starter plan
for one seat (up to two).

### Does Storyblok work with Astro?

Yes. There is an official `@storyblok/astro` integration and a guide in Astro's docs.

### Which Storyblok plans include environments?

On 3 November 2026 its pricing page listed environments, release management and custom roles on Premium and Elite
(custom prices), not on Starter, Growth or Growth Plus.

### Can I keep my content out of a hosted database?

With Markstage, yes: everything is Markdown and JSON in your own git repository. With Storyblok, content lives in
its hosted service.

## Sources

Checked on 2026-11-03: [Storyblok pricing](https://www.storyblok.com/pricing) ·
[Storyblok visual preview in Astro](https://www.storyblok.com/docs/guides/astro/visual-preview) ·
[Astro: Storyblok guide](https://docs.astro.build/en/guides/cms/storyblok/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
