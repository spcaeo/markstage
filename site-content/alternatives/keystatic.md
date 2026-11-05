---
title: "Keystatic alternative for Astro: Markstage"
description: "Markstage vs Keystatic: Markstage reads your Keystatic schema, edits pages on the real design and saves JSON byte-identical. Facts checked 3 Nov 2026."
h1: "A Keystatic alternative for Astro sites"
competitor: "Keystatic"
checked: "2026-11-03"
---

Keystatic gives an Astro project a typed admin for Markdown, Markdoc, MDX, JSON and YAML files, with no database.
Markstage can sit on top of the same files: it reads your Keystatic schema and saves JSON exactly as Keystatic
would, while writers edit on the page.

## Who each one is for

**Keystatic** suits developers who want a schema-first admin inside their Astro project, with MDX and Markdoc
fields, in local mode or GitHub mode, and optional Keystatic Cloud for sign-in and images.

**Markstage** suits teams whose writers should edit on the site's real design, with staging, roles, single
sign-on, a forms inbox and SEO checks. Markstage is pre-release.

## Side by side

| | Markstage | Keystatic |
| --- | --- | --- |
| Editing | On the real page; other fields in a side panel | Admin UI with fields and a WYSIWYG editor |
| Formats | Markdown, MDX and JSON | Markdown, Markdoc, MDX, JSON, YAML |
| Astro output | The live site stays fully static | Pages stay static; the admin routes are rendered on demand, so an adapter is needed |
| Storage | Git on your server | Local files or GitHub |
| Roles | Five built in, plus custom roles | Keystatic Cloud: access per team; no roles described |
| Staging, forms inbox, SEO checks | Included | Not listed |
| Price | Free to self-host | Free; Keystatic Cloud free up to 3 users per team, Pro from $10/mo plus $5 per extra user |
| Licence | Elastic License 2.0 (source-available) | MIT |

## Where Keystatic is stronger

- **MDX and Markdoc** fields. Markstage edits Markdown, MDX (words and simple settings; code kept as written) and
  JSON, and not Markdoc.
- **A typed reader API** for your Astro code, with TypeScript.
- **No extra server.** Keystatic runs inside your Astro project (with an adapter).
- **GitHub mode** with Keystatic Cloud handling sign-in.

## Moving from Keystatic to Markstage

You do not have to move your files or your schema. Point Markstage at it:
`schema: { keystatic: './keystatic.config.ts' }` in `markstage.config.mjs`. Each JSON collection takes the
Keystatic collection with the same folder, and a save writes the same bytes Keystatic's own Save would (proven on a
real site's pages). You can even keep both while your team switches. One thing to know: keys Markstage owns
(`draft`, `publishAt`, `protected`) should be added to your Keystatic schema as `fields.ignored()`, or a Keystatic
save drops them.

## Frequently asked questions

### Can I use Markstage and Keystatic on the same site?

Yes. Markstage reads the Keystatic schema and keeps your JSON files byte-identical to Keystatic's save, so both can
edit the same files.

### Does Keystatic have visual editing?

Keystatic's admin uses fields and a WYSIWYG editor. Its site does not describe editing on the page. Markstage edits
on the page.

### Is Keystatic free?

Yes. Keystatic Cloud is free for up to 3 users per team; Pro starts at $10 a month, plus $5 a month for each user
beyond 3.

### Does Keystatic need a server?

Only for its admin. Astro's Keystatic guide starts from "an existing Astro project with an adapter configured":
Keystatic's admin routes (`/keystatic` and its API) are rendered on demand, while your pages can stay static.
Markstage runs as its own server and leaves your whole site static.

## Sources

Checked on 2026-11-03: [Keystatic](https://keystatic.com/) ·
[Keystatic Cloud](https://keystatic.com/docs/cloud) ·
[Keystatic Astro installation](https://keystatic.com/docs/installation-astro) ·
[Keystatic on GitHub](https://github.com/Thinkmill/keystatic) ·
[Keystatic's Astro integration code](https://github.com/Thinkmill/keystatic/blob/main/packages/astro/src/index.ts) ·
[Astro: Keystatic guide](https://docs.astro.build/en/guides/cms/keystatic/). Markstage facts: the
[full comparison](https://github.com/spcaeo/markstage/blob/main/docs/COMPARISON.md) and the
[API contract](https://github.com/spcaeo/markstage/blob/main/docs/API.md).
