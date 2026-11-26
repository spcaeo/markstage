# The head kit: Markdown for AI tools, feeds and tracking

What Markstage puts into every page's head and next to the pages, set by the site's owner in the editor (Site
settings → Search & AI, Tracking). Design and reasons: [plans/2026-11-26-head-kit-design.md](plans/2026-11-26-head-kit-design.md).

## Turning it on

1. Add `head` to `markstage.config` (all keys optional, docs/CONFIG.md):

   ```js
   export default defineConfig({
     siteName: 'Example Co',
     siteUrl: 'https://www.example.com',
     head: { file: 'src/site/head.json', main: 'main' },
     // …collections
   });
   ```

2. Build as usual (`astro build`). The kit runs at the end of the build, over the pages in the output folder, so
   it covers every page: Markdown and MDX entries, pages built from JSON sections and the site's own pages. In
   `astro dev` and the Markstage preview it adds nothing.
3. The owner sets what it puts out in the editor: **Site settings → Search & AI** and **Site settings → Tracking**.
   Until the settings file exists, the Markdown copies, the OKF bundle and llms.txt are on, with no feeds and no
   tracking. A settings file with a mistake stops the build and lists each problem in plain words.

A file the site already builds itself (its own `llms.txt` or `rss.xml`) is kept, and the build log says so, so a site
can move to the kit one part at a time. Pages marked `noindex`, the 404 page, redirect pages and paths listed under
"Pages to leave out" get no Markdown copy and are in no list. The page of an entry that is not live (protected by a password, a draft, or
scheduled for later) is left out altogether, even when it is still in the output folder when the kit runs (a site
that moves its protected pages to `dist-private/` after the build): it gets no copy, is in no list, and the kit does
not touch it.

Page addresses with letters outside ASCII work as a server expects: the page `/café/` gets the file `café.md`, and
every link to it is written encoded (`/caf%C3%A9.md`).

**Previews never track.** The Markstage server builds release previews, branch previews and the checks' work trees
with `MARKSTAGE_NO_TRACKING=1`, and the kit then writes no tracking loader, so a visit to a share link or to staging
never counts in the owner's analytics. Set the same variable in any other build that is not the live site. A page
that already loads one of the tools itself (a site moving over one part at a time) is named in the build log, since
each visit there would count twice.


## Markdown copies of every page

Every page the site builds gets a Markdown copy next to it, so an AI tool can read the page without the menus,
scripts and styles around it.

| Page | Its Markdown copy |
|---|---|
| `https://example.com/` | `https://example.com/index.md` |
| `https://example.com/posts/hello/` | `https://example.com/posts/hello.md` |
| `https://example.com/fr/a-propos/` | `https://example.com/fr/a-propos.md` |

A page under a language prefix such as `/fr/` is its own page, with its own copy.

Each copy starts the same way: the title, the page's address, then the description.

```markdown
# Hello, Example Co | Example Co blog

Canonical: https://example.com/posts/hello/

> How we write posts in Markdown.

## Why

We keep posts as plain files. **Nothing** is hidden.
```

Every page's `<head>` points to its copy, so a tool that knows the page finds it:

```html
<link rel="alternate" type="text/markdown" title="Markdown version of this page" href="https://example.com/posts/hello.md">
```

Turn it off with `"markdown": {"pages": false}` in the settings file.

### How a copy is made

The copy is made from the built page, not from the source file. A post written in Markdown, an MDX page with
components and a page built from JSON sections are all read the same way, with no code per site, and what an AI tool
reads is what a visitor sees.

- **The content** is the page's `<main>`. If the site's pages use another box, set `head.main` in
  `markstage.config` to one simple selector: a tag, `#id`, `.class`, `[attr]` or `[attr="value"]`, or a tag with
  those, such as `div#content` or `[data-content]`. With no match the copy uses `<body>` without its own header,
  footer, `<nav>` and `<aside>` (a header inside an `<article>` or `<section>` stays).
- **Left out always:** scripts, styles, forms and buttons, menus (`<nav>` and `role="navigation"`, `banner`,
  `contentinfo`, `search`), video, audio, SVG and dialogs.
- **Links and images are absolute** on the site's address, so a copy works wherever it is read. A link to a place on
  the same page (`#why`) becomes plain text, because a Markdown copy has no ids. Links that are not web, mail or phone
  addresses (such as `javascript:`) keep their words and lose the link.
- **An image without alt text is left out.** It is decoration, and a tool cannot use it.
- **`<details>` and `<summary>`** (a FAQ) become the question in bold, then the answer. A `<dl>` does the same with
  its terms.
- **An `<iframe>`** becomes a link to its address, named by its title (`[Product tour](https://video.example.org/...)`).
- **A card that is one big link** (a link around a heading and a paragraph) keeps the link on its heading, so the
  words are not run together.
- **Components** that leave custom elements (such as `<astro-island>`) or spans around blocks come out as separate
  paragraphs. Spans side by side are separate words.
- **Tables** keep their first row as the header, also when it uses `<td>` and no `<th>`. A line break or list in a
  cell becomes a space, so a row stays on one line.
- **The title is not said twice:** the page's first `<h1>` is dropped when it only repeats the `<title>`. With no
  `<title>`, the `<h1>` is the title.

### Pages left out

A page is not copied, listed in the OKF bundle or in `llms.txt` when it is:

- marked `noindex` (a `robots` or `googlebot` meta that says `noindex` or `none`),
- the 404 page,
- a redirect page (a `<meta http-equiv="refresh">`),
- a file that is not a page (no `<html>`, `<head>` or `<body>`, such as a search engine's verification file),
- or in `markdown.skip`: an exact path, or a prefix when it ends in `/*`.

```json
{ "markdown": { "skip": ["/press/", "/internal/*"] } }
```

`/press/` leaves out that page. `/internal/*` leaves out `/internal/` and everything under it. A private page is not
built into the output folder, so it is never seen here.

### Your own words

A site that wants other words in the copies (its own spelling, say) gives `head.transform` in `markstage.config`: a
module whose default export is run on every copy, and the OKF and `llms` files use its result too.

```js
// src/site/spelling.mjs
export default async (markdown, { path, lang }) => markdown.replace(/\bcolor\b/g, 'colour');
```

### A file the site already has

A copy is never written over a file that is already in the output folder. The build log lists those files, so a site
can move over one part at a time.


## The OKF bundle

The OKF bundle is the same pages in one folder an AI tool can walk without any HTML. Turn it off with
`"markdown": {"okf": false}`.

- `/okf/index.md` lists every page, under `# Concepts`, one line each: title, link and description.
- `/okf/<file>.md` holds one page: YAML front matter, then the page's Markdown.

```markdown
# Open Knowledge graph Example Co

An OKF v0.1 bundle generated from example.com

# Concepts

* [About](https://example.com/okf/about.md) - Who we are.
* [Hello, Example Co | Example Co blog](https://example.com/okf/posts-hello.md) - How we write posts in Markdown.
```

```markdown
---
title: "Hello, Example Co | Example Co blog"
url: "https://example.com/posts/hello/"
description: "How we write posts in Markdown."
lang: "en"
modified: "2026-11-03T10:00:00Z"
---

# Hello, Example Co | Example Co blog

Canonical: https://example.com/posts/hello/

## Why
...
```

`description`, `lang` and `modified` are written only when the page has them (`modified` comes from the page's
`article:modified_time` or the `dateModified` in its structured data). Strings are quoted, so a colon or a quote in a
title is safe.

### File names

The name is the page's path joined with `-`. The home page is `homepage`. The names are stable: the same site gives the
same names on every build.

| Page | File |
|---|---|
| `/` | `/okf/homepage.md` |
| `/about/` | `/okf/about.md` |
| `/posts/hello/` | `/okf/posts-hello.md` |
| `/fr/a-propos/` | `/okf/fr-a-propos.md` |

Two pages that would get the same name are numbered in path order: `/a-b/` is `a-b`, then `/a/b/` is `a-b-2`.
`index` is kept for the bundle's own index, so a page at `/index/` is `index-2`. Names are compared without regard to
case, because a Mac or Windows disk keeps `About.md` and `about.md` as one file.

### Links between pages

A link in a page to another page of the site is written to that page's OKF file, so a tool follows links from file to
file and never leaves the bundle. A fragment is dropped (the file is the whole page).

```markdown
[the guide](https://example.com/posts/hello/#why)   becomes   [the guide](https://example.com/okf/posts-hello.md)
```

A link to something that is not a page in the bundle (a PDF, an image, another site) stays as it is.


## llms.txt and llms-full.txt

`/llms.txt` follows [llmstxt.org](https://llmstxt.org): the site's name, one line about it, and a link to every page's
Markdown copy. `/llms-full.txt` has the Markdown of every page in one file. Turn them off with
`"markdown": {"llms": false}`.

```markdown
# Example Co

> Plan, track and ship work together.

## Pages

- [Example Co - Project tracking for small teams](https://example.com/index.md): Plan, track and ship work together.
- [About](https://example.com/about.md): Who we are.
- [Hello, Example Co | Example Co blog](https://example.com/posts/hello.md): How we write posts in Markdown.

## Optional

- [All pages in one file](https://example.com/llms-full.txt)
```

- The name is `siteName` in `markstage.config`. The line under it is the home page's description (or, with none,
  "The pages of Example Co as Markdown, for AI tools.").
- Pages are listed in path order, the home page first, with the same pages as the Markdown copies (see "Pages left
  out" above).
- A page with no description has no `: ...` after its link.
- When the site makes no Markdown copies (`"pages": false`), each link goes to the page's own address instead, so
  nothing in the file points at a copy that is not there.

`/llms-full.txt` is each page's Markdown, one after another, with a line `---` between them. Each starts with its
title and `Canonical:` address, so a tool can tell where a page begins.


## Feeds

Set `feeds` in the settings file (Site settings → Search & AI). Each feed has an `id`, a `title`, a `path` ending in
`.xml`, the `collections` it lists, an optional `description` and a `limit` (1 to 500, default 50).

```json
{
  "feeds": [
    { "id": "blog", "title": "Example Co blog", "description": "News from Example Co", "path": "/rss.xml", "collections": ["posts"], "limit": 20 }
  ]
}
```

The build writes `/rss.xml` (RSS 2.0) from the entry files, not from the built pages, and puts
`<link rel="alternate" type="application/rss+xml">` in the head of every page.

What goes in:

- **Live entries only.** The same rule the site uses: not a draft, not protected, not scheduled for later. A preview
  build (`MARKSTAGE_PREVIEW=1`) lists every entry, as the site does.
- **Newest first** by the collection's date field, at most `limit`. An entry with no readable date goes last.
- **An entry with no page is left out.** The link comes from the collection's `url`.
- **Many collections in one feed** are merged and sorted together.

What an item has:

| Tag | From |
|---|---|
| `title` | the title field (the file name when it is empty) |
| `link` and `guid` | the collection's `url` on `siteUrl` |
| `pubDate` | the date field, as an RFC 822 date in GMT |
| `description` | the excerpt field (left out when empty) |
| `category` | each tag, once |
| `dc:creator` | the author, then the co-authors, by name from their author files (left out when the site keeps no author files or the author is not one of them) |

The channel has the feed's title, the home page, the description (the feed's own, else the site name), an
`atom:link rel="self"` to the feed, and `lastBuildDate` from the newest item. Text is escaped, and characters XML does
not allow are dropped. The same entries give the same file: nothing depends on the clock.

If the site builds a file at the feed's path itself, the kit keeps it and says so in the build log.


## Tracking

The owner types an ID per tool in Site settings → Tracking. Markstage writes one small inline script from the IDs
(`<script data-markstage-head>`, last in `<head>`). No pasted code runs. Each ID is checked against its tool's pattern
when it is saved and again when the page is written, so a value that does not fit never reaches a page.

| Tool | Setting | Example | What it loads |
|---|---|---|---|
| Google Tag Manager | `gtm` | `GTM-ABC1234` | `gtm.js` from googletagmanager.com, plus a `<noscript>` frame right after `<body>` |
| Google Analytics 4 | `ga4` | `G-ABC123DEF4` | the gtag snippet and `gtag/js` from googletagmanager.com |
| Ahrefs Web Analytics | `ahrefs` | the `data-key` from Ahrefs | `analytics.js` from analytics.ahrefs.com |
| Skald Analytics | `skald` | `www.example.com` | `skald.js` from app.skaldanalytics.com |
| Plausible Analytics | `plausible` | `example.com` | `script.js` from plausible.io |

When it starts:

- **Only on a page the visitor sees.** A page the browser prerenders (on a hover, say) waits for `prerenderingchange`.
  A page nobody opened is never counted.
- **Ahrefs, Skald, Plausible and GA4 start at once**, as async scripts. Each script reads its ID from its own tag, so
  the loader sets the attribute before it adds the script.
- **Tag Manager waits for the first interaction by default** (`gtmLoad: "first-interaction"`): the first pointer
  press, key press, scroll or touch, or 3.5 s after the page has loaded when the browser is idle, whichever comes
  first. Set `gtmLoad: "at-once"` to start it with the others.
- **Leave `ga4` empty when Google Analytics already runs inside your Tag Manager container**, or each visit counts
  twice.
- **Nothing runs in `astro dev`.** The loader is written by the build only.

The `<noscript>` frame (for visitors without JavaScript) has no `style` attribute: it uses `hidden` and a width and
height of 0, so a strict policy has nothing to object to. The loader and the frame pass the CSP check
(`cspHashes`) with no problems.


## The settings screens and API

<!-- head-kit: settings (settings-ui) -->

The owner sets everything above in **Site settings**, two parts that show only on a site with `head` in
`markstage.config` and only to an owner or an administrator (an editor opening their address is told "Not available
to you"):

- **Search & AI** (`#/settings/search-ai`): three switches (a Markdown copy of every page, the OKF bundle, llms.txt),
  each with one sentence of why and, while it is on, the addresses it makes in full (`https://<siteUrl>/index.md`,
  `/okf/index.md`, `/llms.txt`, `/llms-full.txt`) with the shared copy and open icons; a list of page paths to leave
  out; the feeds. A feed is a row (title, its address with copy and open); the open one is in the URL
  (`#/settings/search-ai?feed=<id>`) and shows its form: title, address (ends in `.xml`), short description, the kinds
  of page it lists (the site's collections, by their labels) and how many items. A feed's `id` is made from its
  address and never shown.
- **Tracking** (`#/settings/tracking`): one field per tool (Tag Manager, Analytics 4, Ahrefs, Skald, Plausible) with
  its hint under it and the tool's own example as the placeholder. An ID is checked as it is typed with the
  pattern the build uses (the server sends it as the source of a regular expression), the message sits under the
  field and Save waits while any ID is wrong. Then the Tag Manager load choice ("On the first click, key or scroll
  (faster pages)", the default, or "At once"), and a note that consent banners belong inside the tag manager.

Each part has one Save and a Discard. A save writes the whole settings file with only that part's keys changed (every
other key is kept as it was, so the two parts never undo each other), commits it as the person and builds the site;
the toast has **Undo**, which puts the file back as it was. A server refusal (`422`) shows under the field it is
about, and the first feed with a problem opens. If the file changed since the page loaded (`409`) Save is replaced by
"Someone else changed these settings; reload to see theirs" and a Reload button. Every state is in the URL: the part,
and the open feed.

**API.** `GET head` and `PUT head` (docs/API.md "Head settings"). The file is `head.file` (default
`src/site/head.json`), written pretty-printed (two spaces, a newline), inside the content repo and never through a
link. Everyone who may look at the design reads it; `head.write` (owner, administrator) changes it, audited as
`head.write`. A save is checked by core's `readHead` (the same checks as the build and the editor), committed
("Site settings: search and AI", "…: tracking", or both), and followed by the build and deploy job a design save
starts; if that job fails the file is put back.


## The page's Content-Security-Policy

When the page has its own `<meta http-equiv="Content-Security-Policy">`, the build adds to it exactly what the
tracking tags need, and nothing else:

- the `'sha256-…'` hash of the loader script in `script-src` (and the origins of the tools' scripts);
- each tool's origins in `connect-src`, `img-src` and `frame-src`.

A directive the policy does not have is made from `default-src`, as browsers do. A policy with a bare
`'unsafe-inline'` in `script-src` gets no hash (it would switch `'unsafe-inline'` off). A page with no CSP `<meta>` is
left as it is. Running the build step again changes nothing. This is proven in Chromium under `default-src 'self'`:
no violation, the tools' scripts load, and the same loader under a policy that was not widened is blocked.

**A server that sets the policy in an HTTP header** (not a meta tag) must add these itself. The kit cannot change a
header.

| Tool | script-src | connect-src | img-src | frame-src |
|---|---|---|---|---|
| Google Tag Manager | `https://www.googletagmanager.com` | `https://www.googletagmanager.com` `https://*.google-analytics.com` `https://*.google.com` | `https://www.googletagmanager.com` `https://*.google-analytics.com` | `https://www.googletagmanager.com` |
| Google Analytics 4 | `https://www.googletagmanager.com` | `https://www.googletagmanager.com` `https://*.google-analytics.com` `https://*.google.com` | `https://www.googletagmanager.com` `https://*.google-analytics.com` | `https://www.googletagmanager.com` |
| Ahrefs | `https://analytics.ahrefs.com` | `https://analytics.ahrefs.com` | none | none |
| Skald | `https://app.skaldanalytics.com` | `https://app.skaldanalytics.com` | none | none |
| Plausible | `https://plausible.io` | `https://plausible.io` | none | none |

Also add the loader's hash to `script-src`. It is the hash of the text of the script marked `data-markstage-head`, so
it changes whenever an ID or `gtmLoad` changes. Read it from a built page:

```
node -e "import('@markstage/core/csp').then(({cspHashes})=>console.log(cspHashes(require('fs').readFileSync('dist/index.html','utf8')).script))"
```

(That prints the hash of every inline script on the page; the loader's is one of them.) Tag Manager's frame needs
`frame-src` for its `<noscript>` frame as well.

Where these come from (read on 26 Nov 2026):

- Google Tag Manager and Google Analytics: Google's guide "Use Tag Manager with a Content Security Policy",
  developers.google.com/tag-platform/security/guides/csp (Analytics without Ads features).
- Ahrefs, Skald, Plausible: their help pages name no policy. The origins come from reading each script as it is served:
  Ahrefs posts to `/api/event` on its own origin, Skald sends to `/traffic-beacon` on its own origin, Plausible posts
  to `https://plausible.io/api/event`.

**Tags the owner adds inside Tag Manager are not covered.** Google Ads, Floodlight, custom HTML and other vendors need
their own origins (Google's guide lists Google's), and a Custom JavaScript variable needs `'unsafe-eval'`. On a site
with a strict policy, add what the container's tags need to the policy by hand.
