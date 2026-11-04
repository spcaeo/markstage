---
title: "Front Matter CMS alternative for teams: Markstage"
description: "Front Matter CMS runs in VS Code for developers. Markstage gives your whole team a web editor on your Astro site's real design. Checked 3 Nov 2026."
h1: "A Front Matter CMS alternative for Astro teams"
competitor: "Front Matter CMS"
checked: "2026-11-03"
---

Front Matter CMS brings a CMS into Visual Studio Code: content dashboards, a media dashboard, SEO checks and a site
preview, all in your code editor. It is excellent for a developer who writes. Markstage is for a team where most
writers never open a code editor.

## Who each one is for

**Front Matter CMS** suits developers and technical writers who live in VS Code (or a fork of it) and commit
their own changes.

**Markstage** suits teams of writers, translators, SEO managers and reviewers who sign in through a browser and edit
on the site's real design. Markstage is pre-release.

## Side by side

| | Markstage | Front Matter CMS |
| --- | --- | --- |
| Where you edit | A web editor, on the real page | Inside Visual Studio Code |
| Preview | The page itself is the editor | Site preview inside VS Code |
| Who can use it | Anyone you invite, with a role | Whoever has the repository and VS Code |
| Saving | Each save is a commit by the signed-in person | You commit yourself |
| SEO checks | Yes | Yes |
| Roles, staging, forms inbox | Included | – (one person's editor) |
| Price | Free to self-host | Free |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where Front Matter CMS is stronger

- **Nothing to host.** It is an editor extension; it works offline.
- **For developers,** it keeps you in the tool you already use, with custom scripts and hooks.
- **Any static site generator.**

## Using both

They work on the same files. A developer can keep Front Matter CMS in VS Code while writers use Markstage in the
browser: add the content folders as collections in `markstage.config.mjs`. Markstage's surgical saves rewrite only
what changed, so diffs stay small for both.

## Frequently asked questions

### Is Front Matter CMS free?

Yes. Its site says it is free, supported by sponsors.

### Does Front Matter CMS work with Astro?

Yes. Astro's docs have a Front Matter CMS guide.

### Can non-technical people use Front Matter CMS?

It runs inside Visual Studio Code, so each person needs VS Code and the repository. Markstage runs in a browser
with a sign-in, so writers need neither.

## Sources

Checked on 2026-11-03: [Front Matter CMS](https://frontmatter.codes/) ·
[Front Matter on GitHub](https://github.com/estruyf/vscode-front-matter) ·
[Astro: Front Matter CMS guide](https://docs.astro.build/en/guides/cms/frontmatter-cms/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
