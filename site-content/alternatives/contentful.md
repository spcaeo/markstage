---
title: "Contentful alternative for Astro: Markstage"
description: "Markstage vs Contentful for Astro sites: content as files in your own git repository, edited on the real design, self-hosted for free. Checked 3 Nov 2026."
h1: "A Contentful alternative for Astro sites"
competitor: "Contentful"
checked: "2026-11-03"
---

Contentful is a hosted headless CMS used by large companies to publish content to many platforms. Astro reads it
through the Contentful SDK. Markstage is the opposite shape: content as files in your git repository, edited on the
site's real design, on your own server.

## Who each one is for

**Contentful** suits organisations that publish the same content to many sites and apps, with a large integration
marketplace and enterprise contracts.

**Markstage** suits a team running an Astro site who wants writers on the real design, every change as a git
commit, and no hosted database or seat fees. Markstage is pre-release.

## Side by side

| | Markstage | Contentful |
| --- | --- | --- |
| Editing | On the real page | ? (not checked on Contentful's own pages) |
| Where content lives | Markdown and JSON in your git repository | Contentful's hosted service, read by its SDK |
| Astro | `@markstage/astro`; the live site stays static | A guide in Astro's docs using the Contentful SDK, with zero client-side JavaScript |
| Price | Free to self-host | ? Its pricing page answered every check with "too many requests" (HTTP 429) |
| Licence | Elastic License 2.0 (source-available) | Closed, hosted service |

We could not load Contentful's pricing page on 3 November 2026, so we do not quote its prices or plan limits here.
Please check [contentful.com/pricing](https://www.contentful.com/pricing/) directly.

## Where Contentful is stronger

- **Many channels** from one content API.
- **Hosted** at scale, with nothing to run.
- **An ecosystem** of apps, integrations and partners.

## Moving from Contentful to Markstage

Contentful entries have to become Markdown or JSON files. Read them through Contentful's API, convert rich text to
Markdown, and run Markstage's import API: a dry run first, then the import as drafts, idempotent on each source id,
with media fetched through the same safety checks as uploads.

## Frequently asked questions

### Does Contentful work with Astro?

Yes. Astro's docs have a Contentful guide that uses the Contentful SDK.

### Is there a Contentful alternative that keeps content in git?

Yes. Markstage keeps every page and post as a Markdown or JSON file in your git repository, and each save is a
commit by the person who made it.

### When should I stay on Contentful?

When the same content feeds many sites and apps, or when you need a hosted service with enterprise support.

## Sources

Checked on 2026-11-03: [Astro: Contentful guide](https://docs.astro.build/en/guides/cms/contentful/) ·
[Contentful pricing](https://www.contentful.com/pricing/) (would not load for us). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
