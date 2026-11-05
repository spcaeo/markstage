---
title: "Sitepins alternative for Astro: Markstage"
description: "Markstage vs Sitepins: both commit every save to git. Markstage edits on your Astro site's real design and runs on your server free. Checked 3 Nov 2026."
h1: "A Sitepins alternative for Astro sites"
competitor: "Sitepins"
checked: "2026-11-03"
---

Sitepins puts a clean editor on top of your repository: it reads your Markdown and front matter, builds the editing
screens for you, and commits every save. It says plainly that it is "not a page builder": it edits content inside
your layouts. Markstage edits on the rendered page itself.

## Who each one is for

**Sitepins** suits agencies and freelancers handing Astro, Hugo or Next.js sites (including ones made with AI
builders) to clients, with a hosted cloud or self-hosting.

**Markstage** suits teams whose writers should work on an Astro site's real design, with staging, custom roles,
single sign-on and a forms inbox. Markstage is pre-release.

## Side by side

| | Markstage | Sitepins |
| --- | --- | --- |
| Editing | On the real page | A WYSIWYG editor over your files; "not a page builder" |
| Setup | `markstage.config` lists your collections | Detects your schema from your files |
| Git hosts | A git repository on your own server | GitHub; GitLab on Team and Agency |
| Live co-editing | No: locks and a three-way merge (live co-editing is [planned](/roadmap/#co-editing)) | Yes: live cursors and avatars |
| Roles | Five built in, plus custom roles | Roles and permissions |
| Single sign-on, forms inbox | Included | Not listed |
| Price | Free to self-host | Free self-hosted; Cloud Pro $12/mo ($10 yearly), $249 lifetime |
| Licence | Elastic License 2.0 (source-available) | AGPL-3.0 |

## Where Sitepins is stronger

- **No schema to write.** It reads your files and builds the editor.
- **Live collaboration.** Cursors and avatars show who is working where.
- **Agencies.** A workspace per client, and a hosted cloud with lifetime pricing.
- **Mobile.** Its editor works on phones and tablets.

## Moving from Sitepins to Markstage

Your content is already plain files in your repo. List the folders as collections in `markstage.config.mjs`, add
the `@markstage/astro` integration, and invite your editors to Markstage.

## Frequently asked questions

### Can I self-host Sitepins?

Yes. Its GitHub repository is under AGPL-3.0 and has self-hosting steps; a hosted cloud is also offered.

### Does Sitepins work with Astro?

Yes. Astro's docs have a Sitepins guide.

### Does Sitepins edit on the page?

It describes itself as a WYSIWYG editor over your files that does not change design or page structure. Markstage
shows the site's own components and CSS while you edit.

## Sources

Checked on 2026-11-03: [Sitepins](https://sitepins.com/) · [Sitepins pricing](https://sitepins.com/pricing) ·
[Sitepins on GitHub](https://github.com/sitepins/sitepins) ·
[Astro: Sitepins guide](https://docs.astro.build/en/guides/cms/sitepins/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md).
