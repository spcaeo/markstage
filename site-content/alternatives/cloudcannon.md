---
title: "CloudCannon alternative, self-hosted: Markstage"
description: "Markstage vs CloudCannon: both git-based with on-page editing for Astro. Markstage runs on your own server for free. Facts checked 3 Nov 2026."
h1: "A self-hosted CloudCannon alternative for Astro"
competitor: "CloudCannon"
checked: "2026-11-03"
---

CloudCannon is the product closest to Markstage. Both keep content as files in git, and both let writers edit
text where it appears on the site. The big difference: CloudCannon is a hosted service with monthly plans, and
Markstage runs on your own server for free.

## Who each one is for

**CloudCannon** suits teams and agencies who want everything hosted: the editor, the builds, hosting on a CDN,
forms and support. It is a featured CMS partner in Astro's docs.

**Markstage** suits teams who want the same way of working (git files, editing on the page) but on their own
server, with no per-user fees, and with staging, custom roles and single sign-on included. Markstage is
pre-release.

## Side by side

| | Markstage | CloudCannon |
| --- | --- | --- |
| Editing on the page | Text typed on the real page; other fields in a side panel | Editable regions on a preview of your built site; Astro components re-render live |
| Content | Markdown and JSON in git | Files in GitHub, GitLab or Bitbucket |
| Where it runs | Your server (Docker Compose, or systemd and nginx) | CloudCannon's service; no self-hosted version listed |
| Hosting your site | Your own host | Included, on a CDN |
| Price to start | Free | Standard $55/mo ($49 yearly), 3 users |
| Extra users | No fees | $10 per user a month |
| Staging and branches | Local, staging and production included | Branching workflows on Team ($350/mo) |
| Custom roles | Included | Custom permissions from Team |
| Single sign-on | OpenID Connect, included | SSO/SAML on Enterprise |
| Forms inbox | Yes | Yes |
| Licence | Elastic License 2.0 (source-available) | Closed, hosted service |

## Where CloudCannon is stronger

- **Nothing to run.** CloudCannon builds and hosts the site and runs the editor. Markstage needs your own server.
- **Hosting and CDN included,** with automatic HTTPS and DDoS protection on its plans.
- **Support and services.** Priority and dedicated support, onboarding, and a migration service.
- **Many generators.** CloudCannon works with more than Astro; Markstage has one adapter today, Astro; adapters beyond Astro are planned ([roadmap](/roadmap/#adapters)).
- **Maturity.** CloudCannon has years of production use; Markstage is pre-release.

## Moving from CloudCannon to Markstage

Your content is already in your git repository, so nothing has to be exported. List the same folders as
collections in `markstage.config.mjs` and add the `@markstage/astro` integration. CloudCannon's editable regions
are HTML data attributes and web components; Markstage uses its own field bindings, emitted only in editor mode,
so you mark the same fields again. Forms: point the site's forms at Markstage (`/markstage/forms/<id>`). Then host
the built site wherever you like and run the Markstage server next to it.

## Frequently asked questions

### Is there a self-hosted alternative to CloudCannon?

Yes. Markstage is git-based like CloudCannon, edits on the site's design, and runs on your own server. It is free
to self-host. CloudCannon does not list a self-hosted version.

### How much does CloudCannon cost?

On 3 November 2026 its pricing page listed Standard at $55 a month ($49 a month paid yearly) with 3 users, Team at
$350 a month ($300 yearly) with 15 users, and Enterprise at a custom price. Extra users are $10 a month each.

### Does CloudCannon work with Astro?

Yes. Astro's docs have a CloudCannon guide, and CloudCannon has an `@cloudcannon/editable-regions` package for
live editing of Astro components.

### What does Markstage not do that CloudCannon does?

It does not host your site or run your builds as a service, and it has no paid support plans or migration service
today.

## Sources

Checked on 2026-11-03: [CloudCannon pricing](https://cloudcannon.com/pricing/) ·
[CloudCannon: what is visual editing?](https://cloudcannon.com/documentation/articles/what-is-visual-editing/) ·
[Astro: CloudCannon guide](https://docs.astro.build/en/guides/cms/cloudcannon/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
