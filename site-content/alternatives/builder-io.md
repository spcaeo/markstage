---
title: "Builder.io alternative for Astro: Markstage"
description: "Markstage vs Builder.io for Astro: page editing on your site's real design with content in git, self-hosted, no per-user fees. Facts checked 3 Nov 2026."
h1: "A Builder.io alternative for Astro sites"
competitor: "Builder.io"
checked: "2026-11-03"
---

Builder.io is a hosted visual platform. In Astro, you add a preview page and Builder's drag-and-drop editor works
on it; content lives in your Builder space. Markstage edits on the site's own pages, keeps content as files in git,
and runs on your own server.

## Who each one is for

**Builder.io** suits teams who want drag-and-drop page building with their own components, AI features and a
hosted service, often across several frameworks.

**Markstage** suits Astro sites that want writers on the real design, every change as a git commit, and no
per-user fees. Markstage is pre-release.

## Side by side

| | Markstage | Builder.io |
| --- | --- | --- |
| Visual editing | On the site's own pages | Drag-and-drop editor on a preview page you add |
| Where content lives | Markdown and JSON in your git repository | Your Builder space (hosted) |
| Astro | `@markstage/astro` integration | A guide in Astro's docs: a `builder-preview` page and a preview URL |
| Price | Free to self-host | Free (1 user, up to 5); Pro $24 per user a month; Team $40 per user a month |
| Pricing model | No limits or credits | Monthly AI credits per plan |
| Roles and sign-on | Five roles plus custom roles; OpenID Connect single sign-on, included | Admin only on Free and Pro; four roles on Team; custom roles, RBAC and single sign-on on Enterprise |
| AI agents (MCP) | MCP server, included | Built-in MCP servers from Pro; custom MCP servers on Team |
| Licence | Elastic License 2.0 (source-available) | SDKs: MIT; the service is closed |

## Where Builder.io is stronger

- **Drag-and-drop layout** with your own components and a Figma plugin.
- **AI features** across design and code, on credits.
- **Many frameworks,** not only Astro.
- **Hosted,** with nothing to run.

## Moving from Builder.io to Markstage

Builder content has to become Markdown or JSON files and sections. Read your entries through Builder's API, map
each Builder component to a section in your Astro components and Markstage block pack, and run Markstage's import
API (dry run first, imported as drafts, idempotent on each source id).

## Frequently asked questions

### Does Builder.io work with Astro?

Yes. Astro's docs have a Builder.io guide: you create a preview page and set it as the preview URL in your Builder
space.

### Is there a free Builder.io alternative?

Markstage is free to self-host and has no per-user or credit fees. Builder.io also has a free plan for one user.

### Can Markstage drag sections onto a page?

Yes. Writers drag a section or a synced item from the Library onto the live page, and a line between two sections
shows where it will land.

## Sources

Checked on 2026-11-03: [Builder.io pricing](https://www.builder.io/pricing) ·
[Builder.io developer docs](https://www.builder.io/c/docs/developers) ·
[Builder.io on GitHub](https://github.com/BuilderIO/builder) ·
[Astro: Builder.io guide](https://docs.astro.build/en/guides/cms/builderio/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
