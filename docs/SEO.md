# SEO in Markstage: schema, social, technical checks

What Markstage checks for search engines and social sites: schema, share images, the writer's checks and the
site-wide technical checks. The checklist follows what common SEO browser extensions and plugins show (overview,
headings, links, images, schema, social previews), built into the editor.

Rule: the writer sees what search engines and social sites will see **while writing**, and publish blocks on real
errors. Every check runs on the built HTML (what Google gets), not on guesses from the source.

## 1. Schema is generated from the fields, never stored by hand

Why: on a real site we measured, article JSON-LD is a frozen Rank Math blob in frontmatter (`seo.jsonLd`). The
build already syncs its description and FAQ, but not the headline: **97 of 145 built articles publish a BlogPosting
headline that differs from the visible H1** (some entirely, e.g. "Why Choose Tool A Over Tool B?" vs schema
"Tool A vs Tool B for Non-Profits: What to Choose?"). Any title edit in the editor would widen this.

- Generic: a collection's config maps fields to a schema type (`schema: {type: 'BlogPosting', headline: 'title',
  datePublished: 'date', dateModified: 'modified', image: 'cover', author: 'author', section: 'categories[0]'}`).
  The site builds the node from the entry at build time; stored JSON-LD keeps only extras the fields can't say.
- Blocks emit their own schema: FAQ → FAQPage, video embed → VideoObject, steps → none
  (Google retired HowTo rich results), breadcrumbs → BreadcrumbList.
- Editor "What Google sees" panel: the page's JSON-LD as readable cards (type, the fields it fills, its source
  field), errors and warnings per Google's required/recommended properties, a link to Google's Rich Results Test for
  the live URL. No raw JSON editing for writers; Owner/Admin see a read-only raw view.
- Honest scope: FAQ rich results now show only for well-known government and health sites; we keep FAQPage for
  meaning and AI answers but never promise stars or FAQ snippets. No fake Review/AggregateRating, ever.

## 2. Social images and cards

Findings: every one of the 145 covers is wider than 1.91:1 (e.g. 1200x509 = 2.36:1) and is used as og:image, so
Facebook/LinkedIn crop or letterbox it; `twitter:image:alt`, `article:author` and `article:tag` are not emitted.

- Generated share image per entry (1200x630) when none is set: the cover on a branded frame, or a title card from
  the site's tokens; built at build time, cached by content hash. The site's own design decides its look.
- Share image alt (og:image:alt + twitter:image:alt) from the cover's alt.
- Editor social preview with the real crop for Facebook/LinkedIn (1.91:1), X (2:1) and a phone chat preview,
  plus "Choose crop" (focal point, shared with the cover editor) and per-network overrides if the schema has them.
- Publish sheet: "Refresh on LinkedIn / Facebook" links (Post Inspector, Sharing Debugger) for the live URL.

## 3. Writer-side checks (live in the checks panel, and blocking/non-blocking at publish)

| Check | Blocks publish? |
|---|---|
| Title and description: pixel width (Google's ~600 px title / ~920 px description), not only characters; duplicate titles/descriptions across the site (pages only: an entry with no URL, or at another entry's own address, such as a topic at its main page's, is not compared) | duplicates block |
| One H1; heading levels not skipped; heading outline view (click to jump) | skipped level warns |
| Focus keyphrase (Rank Math/Yoast parity, from the existing `focusKeywords` field): in title, H1, first paragraph, slug, description, one subheading; density shown, never stuffed | warns |
| Links: internal / external / broken / to a draft or private page / redirect hops; rel controls per link (nofollow, sponsored, ugc, new tab) in the link popover; nofollow highlight toggle | broken or draft link blocks |
| Orphan check: no other page links here; suggest 3 related articles to link from/to | warns |
| Images: alt, file size and dimensions vs display size, descriptive file name, lazy/priority on the first image | missing alt blocks (unless decorative) |
| Canonical and robots: noindex/canonical-elsewhere explained in plain words | none |
| Word count and reading time on rendered text | none |
| Schema errors (section 1) | errors block |

## 4. Site-wide technical (dashboard "Site health", Owner/Admin)

- HTTP status of every built URL, redirect chains (A→B→C), 404s from old links (a status probe).
- Core Web Vitals: lab (Lighthouse at build, per template) and field data from the CrUX API with **the site's own
  key** in server config (phone and desktop, LCP/INP/CLS, p75), shown per page and per template.
- Sitemaps: lastmod equals the entry's modified; excluded pages listed with the reason; optional image entries.
- robots.txt and llms.txt viewable, editable by Owner/Admin through Design & Code with checks.
- IndexNow ping on publish/unpublish/move (Bing, Yandex; key file served by the site), as a generic publish hook.
- Exports: page copy, headings, links and images as CSV (the extension's export buttons), per entry and site-wide.

## In the editor

The header's **SEO** button (`?side=seo`) opens the SEO check in the right column.

- **Live from the text** (unsaved changes too): the search result cut at Google's pixel widths (600 / 920 px) with
  meters, and the live address as Google writes it (`example.com › guides › setup`, from `siteUrl`, with copy and
  open); the focus keyphrase (config `seo.keyphrase`) in the search title, H1, first paragraph, address,
  description and a subheading, with its density (a keyphrase whose words are in the text but never together says
  "The full phrase isn't in the text; its words are"); the headings outline (click to go) with a second H1, a
  skipped level and empty headings; links (to no page, to a draft, `http://`, none to the site) with "Mark nofollow
  links" (`nf=1`); images (no alt, a vague file name, far larger than shown, over 300 KB); words and reading time.
- **From the built page** (read again after each save): title, description, canonical, robots; each rich-result
  JSON-LD item as a card with Google's required and recommended properties (the BlogPosting headline against the
  H1 included), the other items by name with their JSON to copy, and links to the Rich Results Test and the Schema
  validator; the share image cut at 1.91:1, 2:1 and square, with its shape measured. Whether the title is the H1
  comes from the built page, so "no main heading" is said only when the page has none.
- **Link options** (new tab, nofollow, sponsored, ugc) are in the link field.
- **At publish**: duplicates, orphan pages and broken links come from the server's checks and show in the publish
  sheet.

Not built yet: the focal-point crop for share images, and the duplicate and orphan checks inside the SEO panel
itself (the publish sheet has them).
