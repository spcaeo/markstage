# Design: the head kit (Markdown for AI tools, feeds, tracking), 26 Nov 2026

## Why

The first site built on Markstage wrote about 640 lines of its own code to put three things into every page and
next to it: a Markdown copy of each page with the OKF bundle and llms.txt for AI tools, an RSS feed, and its
tracking tags. Every new site would have to write the same again. The owner asked for all three to be native: set in
the editor, built by Markstage, for any site.

## What a site gets

With `head` in `markstage.config` (opt-in, as everything a build adds), `astro build` writes:

- **A Markdown copy of every indexed page**, next to it: `/posts/hello/` → `/posts/hello.md`, the home page
  `/index.md`. Each starts with the title, `Canonical: <url>` and the description.
- **The OKF bundle**: `/okf/index.md` lists every page, and `/okf/<file>.md` holds one page with YAML front matter;
  links between pages point at each other's OKF files, so a tool walks the site without HTML.
- **llms.txt and llms-full.txt** (llmstxt.org).
- **RSS feeds** of the collections the settings name, such as `/rss.xml` of the posts.
- **In every page's head**: the `<link rel="alternate">`s to its Markdown copy, the OKF bundle and each feed, and one
  tracking loader with the IDs the owner set (Google Tag Manager, Google Analytics 4, Ahrefs, Skald, Plausible).

The owner sets it in **Site settings → Search & AI** (Markdown copies, OKF, llms.txt, pages to leave out, feeds) and
**Site settings → Tracking** (one field per tool, its ID checked as typed). Both write one JSON file in the content
repo (`head.file`, default `src/site/head.json`), committed like any other change, so it moves through staging and
live with the content and design.

## Decisions

1. **Markdown is made from the built page, not from the source.** Entries are `.md`, `.mdx` or `.json` (a page of
   typed sections). Reading the built HTML covers all three, MDX components and the site's own pages alike, with no
   code per site, and what an AI tool reads is what a person sees. The page's `main` element is used (`head.main`,
   a simple selector); menus, header, footer, scripts, forms and SVG are left out. A site that wants other words
   (its own spelling) gives `head.transform`, a module run on every Markdown output. Writing per-section text from
   the source was rejected: every site would need code for every section kind.
2. **One HTML reader.** The server's tolerant HTML reader and Markdown writer (the Library and the imports use it)
   moves to `@markstage/core/html-tree`, so the build and the imports turn HTML into Markdown the same way and the
   Astro package gains no dependency.
3. **Tracking by ID, never pasted code.** The owner types an ID; Markstage writes the loader. So the IDs are checked,
   the code is known, it is allowed in the page's CSP by hash, and no stranger's script can be pasted through this
   screen (pasting code stays in Design & Code, owners and administrators only). The loader starts the tools only on
   a page the visitor sees: a page prerendered on hover is not counted. Tag Manager loads on the first interaction
   by default (3.5 s idle fallback), as it is the heavy one; "at once" is a setting.
4. **Feeds come from the entries,** not the HTML: dates, excerpts and authors are fields there. Only live entries.
5. **What the site already builds is kept.** If the site writes its own `llms.txt` or `rss.xml`, the kit keeps that
   file and says so in the build log, so a site can move over one part at a time.
6. **Left out: noindex pages, the 404 page, redirect pages, paths in `markdown.skip`, and private pages** (they are
   not in the output folder). They still get the tracking loader.
7. **Not in this version:** a cookie-consent banner (consent belongs inside the tag manager), per-locale feeds, other
   analytics tools. Each can follow as its own small item.

## Pieces

| Piece | Where |
|---|---|
| Settings: shape, checks, plain-word errors, the tools' ID patterns | `@markstage/core/head` (`readHead`, `TRACKERS`, `markdownPath`) |
| Config `head: {file, main, transform}` | `@markstage/core/site-config` (`headOf`) |
| Build step, files, page rewrite, CSP meta | `@markstage/astro` `src/head/` (`index`, `pages`, `markdown`, `okf`, `llms`, `feeds`, `tracking`, `rewrite`) |
| CSP origins for connect, img and frame | `@markstage/core/csp` `withCspSources` |
| Settings API `GET/PUT head` (owner, administrator; versioned, audited, committed, a build after) | `@markstage/server` |
| Site settings → Search & AI, Tracking (`#/settings/search-ai`, `#/settings/tracking`) | `@markstage/editor` |
| Docs | `docs/HEAD-KIT.md`, CONFIG.md, API.md, CHANGELOG |

## Tests

- Unit: settings checks (every field, every error), Markdown of md/mdx/json-built pages (headings, lists, tables,
  details, images, links absolute, nav and scripts gone), OKF names and links, llms files, feeds (live only, order,
  limit, valid XML), loader per tool, CSP meta gains exactly the hashes and origins, rewrite is idempotent.
- Build: the example blog built with `head` on gives a copy for every indexed page, none for noindex/404, the links
  in every head, the feed, and no tracking in `astro dev`.
- Browser: the loader runs under the page's CSP with no violation; a prerendered page sends nothing until shown.
- Editor: both screens save, refuse a bad ID in words, and keep every state in the URL.
- An independent review of the loader and the CSP change before release.
