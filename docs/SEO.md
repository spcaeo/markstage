# SEO in Markstage: schema, social, technical checks

Owner, 2026-10-28: "think once again in deep for missing things" about schema, social images and technical SEO, with
SEO Pro Extension (MarketingSyrup, Chrome, v2.5; a third-party product: we take its checklist, never its code or its
embedded API key) as one reference. Its tabs: Overview (title/description length, canonical, meta robots, HTTP status,
CrUX field LCP/INP/CLS, word count), Headings (outline, H1 count), Links (internal/external/unique, nofollow
highlight, CSV export), Images (alt, size), Schema (JSON-LD + microdata parsed, required/recommended properties per
type), Social (og/twitter preview), Resources (links to outside testers).

Rule: the writer sees what search engines and social sites will see **while writing**, and publish blocks on real
errors. Every check runs on the built HTML (what Google gets), not on guesses from the source.

## 1. Schema is generated from the fields, never stored by hand

Finding (the pilot site, 2026-10-28): article JSON-LD is a frozen Rank Math blob in frontmatter (`seo.jsonLd`). The
build already syncs its description and FAQ, but not the headline: **97 of 145 built articles publish a BlogPosting
headline that differs from the visible H1** (some entirely, e.g. "Why Choose Tool A Over Tool B?" vs schema
"Tool A vs Tool B for Non-Profits: What to Choose?"). Any title edit in the editor would widen this.

- Generic: a collection's config maps fields to a schema type (`schema: {type: 'BlogPosting', headline: 'title',
  datePublished: 'date', dateModified: 'modified', image: 'cover', author: 'author', section: 'categories[0]'}`).
  The site builds the node from the entry at build time; stored JSON-LD keeps only extras the fields can't say.
- Blocks emit their own schema: FAQ → FAQPage (done on the pilot site), video embed → VideoObject, steps → none
  (Google retired HowTo rich results), breadcrumbs → BreadcrumbList (done).
- Editor "What Google sees" panel: the page's JSON-LD as readable cards (type, the fields it fills, its source
  field), errors and warnings per Google's required/recommended properties, a link to Google's Rich Results Test for
  the live URL. No raw JSON editing for writers; Owner/Admin see a read-only raw view.
- Honest scope: FAQ rich results now show only for well-known government and health sites; we keep FAQPage for
  meaning and AI answers but never promise stars or FAQ snippets. No fake Review/AggregateRating, ever.

## 2. Social images and cards

Findings: every one of the 145 covers is wider than 1.91:1 (e.g. 1200x509 = 2.36:1) and is used as og:image, so
Facebook/LinkedIn crop or letterbox it; `twitter:image:alt`, `article:author` and `article:tag` are not emitted.

- Generated share image per entry (1200x630) when none is set: the cover on a branded frame, or a title card from
  the site's tokens; built at build time, cached by content hash. Site design approved by the owner before use.
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
| Images: alt (done), file size and dimensions vs display size, descriptive file name, lazy/priority on the first image | missing alt blocks (unless decorative) |
| Canonical and robots: noindex/canonical-elsewhere explained in plain words (done for hreflang) | none |
| Word count and reading time on rendered text | none |
| Schema errors (section 1) | errors block |

## 4. Site-wide technical (dashboard "Site health", Owner/Admin)

- HTTP status of every built URL, redirect chains (A→B→C), 404s from old links (a status probe on the pilot site).
- Core Web Vitals: lab (Lighthouse at build, per template) and field data from the CrUX API with **the site's own
  key** in server config (phone and desktop, LCP/INP/CLS, p75), shown per page and per template.
- Sitemaps: lastmod equals the entry's modified; excluded pages listed with the reason; optional image entries.
- robots.txt and llms.txt viewable, editable by Owner/Admin through Design & Code with checks.
- IndexNow ping on publish/unpublish/move (Bing, Yandex; key file served by the site), as a generic publish hook.
- Exports: page copy, headings, links and images as CSV (the extension's export buttons), per entry and site-wide.

## Owners

- site-content (the pilot site): section 1 build fix (fields → BlogPosting, stored blob reduced to extras), share
  image generator + missing meta, the new verifiers (schema_check, heading/duplicate checks) in the suite.
- studio-ui (editor): "What Google sees" panel, social crop preview, focus keyphrase, link rel controls, headings
  outline, the checks list wiring.
  **Done (2026-10-28)**: the header's **SEO** button (`?side=seo`, packages/editor/src/seo/) opens the SEO check in
  the right column. Live from the text (unsaved too): the search result cut at Google's pixel widths (600 / 920 px)
  with meters; the focus keyphrase (config `seo.keyphrase`) in the search title, H1, first paragraph, address,
  description, a subheading, and its density; the headings outline (click to go) with a second H1, a skipped level
  and empty headings; links (to no page, to a draft, http://, none to the site) with "Mark nofollow links"
  (`nf=1`); images (no alt, vague file name, far larger than shown, over 300 KB); words and reading time. From the
  built page (re-read after each save): title, description, canonical, robots, each rich-result JSON-LD item as a
  card with Google's required/recommended properties (BlogPosting headline vs the H1 included), the other items by
  name with their JSON to copy, Rich Results Test and Schema validator links; the share image cut 1.91:1, 2:1 and
  square, with its shape measured. Link options (new tab, nofollow, sponsored, ugc) in the link field. Still open:
  the focal-point crop (waits for the cover's focal key), duplicates and orphan pages here (the server's preflight
  and links-in have them; the publish sheet shows them now).
  Fixed the same day: the result shows the live address as Google writes it (`example.com › guides › setup`, from
  `siteUrl`, with copy and open), not the editor's own host; whether the title is the H1 comes from the built page
  (seo/h1.ts: the layout's H1), so "no main heading" is said only when the page has none (unit test, and
  packages/editor/test/seo-h1.browser.mjs passed on four real articles); a keyphrase whose words are in the text but
  never together says "The full phrase isn't in the text; its words are", not "Not in the text at all".
- markstage-server: publish-sheet blocking rules, outside-tester links, IndexNow hook, CrUX fetch (server key), Site
  health screen, CSV exports.
