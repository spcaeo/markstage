# Importing a site from WordPress, Ghost or Prismic

Markstage brings a whole site over in one step: its posts and pages, images and files, authors, categories and tags,
search titles and descriptions, and every old address, sent on to the new page. You see the full plan first, with
nothing written; then the import runs in the background, in changes you can read one by one in the site's history.

Where: the editor's **More tools › Import a site** (`#/import`, editors and up), or `markstage-server import` on the
server. The routes are in docs/API-IMPORT.md ("A whole site"). Server code: `packages/server/src/import/`
(`convert/` reads each format, `site/` plans and runs).

Markstage is pre-release. The importers are tested on export files and API answers made from each product's public
documentation (`packages/server/test/fixtures/import/`), and the WordPress importer on two real sites, one from its export and one through its
REST API ("Proof on a real site" below). Ghost and Prismic have not yet been tried on a real site. Check the review list after
an import, and tell us what did not come over well.

## The steps

1. **Choose where it comes from**: WordPress, Ghost or Prismic.
2. **Give the source**: upload its export file, or give its API's details.
   - WordPress: the export file (Tools › Export › All content, an `.xml` file), or the site's REST API
     (`/wp-json/wp/v2`). Drafts and private posts need a user name and an **application password** (Users ›
     Profile › Application Passwords).
   - Ghost: the export file (Settings › Labs › Export your content, a `.json` file) with the old site's address
     (an export does not say where the site was), or the Content API with a custom integration's key.
   - Prismic: the repository's name, an access token if it is private, and, if you want the old addresses sent on,
     each custom type's old address pattern (`blog_post=/blog/{uid}/, page=/{uid}/`).
3. **Read the plan.** One line says it all, for example "142 posts, 18 pages, 1,204 images; 6 slugs already exist
   (kept both); 31 images need alt text; 4 blocks we could not convert". Below it: what would be created, updated or
   left alone, the new authors, the old addresses, and tabs for each list (Pages and posts, Images and files, To
   review, Old addresses). Change where things go and plan again as often as you like. Nothing is written.
4. **Run the import.** It runs as a background job (Scheduled & history follows it), in four steps, each its own
   change in the site's history, by you:
   - images and files, 50 to a change ("Import 50 media files from WordPress (batch 1 of 3)");
   - the new authors, in one change;
   - the posts and pages, 25 new ones to a change; an update (a second run) one change each;
   - the moved addresses, in one change.
5. **Read the report and the review list**: each note links to the page or picture to look at.

Everything comes in as a **draft** in a collection with drafts. A page that was published on the old site is listed
as such; publish it when it is checked. The moved addresses go live with the next publish.

## What comes over

| | WordPress | Ghost | Prismic |
|---|---|---|---|
| Posts and pages | posts, pages and every public custom post type (a portfolio, case studies), each to the collection you choose; a child keeps its parent's path | posts and pages | documents of every custom type; each type goes to the collection you choose |
| The text | Gutenberg blocks and classic HTML, as clean Markdown | Lexical and Mobiledoc, as clean Markdown | rich text as Markdown; slices as sections where you map them |
| Pictures and files | the pictures the pages use, at their original size (not the `-300x200` copies), and PDFs they link to | the pictures, at their original size (not `/size/w600/`) | the pictures, from the Prismic CDN, keeping their crop |
| Alt text | the attachment's alt text, else the image's own | the card's alt, the feature image's alt | the image's alt |
| Authors | each post's author, made an author of the site when it has none by that slug | the post's authors (the first is its author) | an `author` text field |
| Categories and tags | both (not "Uncategorized") | tags (not internal `#` tags) | tags |
| Search title and description | Yoast or Rank Math, their variables filled in; through the REST API, Rank Math's own head for each page (title, description, robots, share picture, canonical) | meta title and description | `meta_title` and `meta_description` |
| Cover picture | the featured image | the feature image | `featured_image` (or `image`, `cover`, `hero_image`) |
| Dates | published and updated | published and updated | first and last publication |
| Old addresses | the permalink, `?p=`, `?page_id=`, attachment pages, `?attachment_id=`, the uploads paths | the address pattern you give (default `/{slug}/`), `/author/<slug>/` | the pattern you give per type |

What becomes a note instead (in the text as "Import note: …", and in the review list):

- **WordPress**: dynamic blocks drawn by WordPress when the page is shown (latest posts, a search box, a calendar);
  a plugin's block with no HTML of its own; a reusable block (`wp:block`); shortcodes other than `[caption]`,
  `[gallery]`, `[embed]`, `[video]`, `[audio]` and `[playlist]` (their inner text is kept).
- **Ghost**: cards other than image, gallery, bookmark, callout, embed, code, HTML, Markdown, divider, button, toggle,
  header, video, audio and file (a signup or product card, for example); a members-only post is noted, since here it
  becomes a normal page once published; a post that was only sent as an email comes in as a draft.
- **Prismic**: a slice with no words and no section mapped for it.
- **Everywhere**: an embed (a video, a map, a tweet) becomes a link to it; a script, a form, a style or an iframe is
  left out and noted; a picture from another site stays a link to that site; a link to an old page that was not
  imported keeps its old address.

## WordPress in depth: custom types, ACF, Rank Math, the public address

**Custom post types.** Through the REST API every public type that `/wp-json/wp/v2/types` lists is read (not media,
not WordPress's own machinery such as patterns, templates and menus, not a type that is not viewable). An export file
gives every `post_type` it holds. The plan lists each type with its name, its count and where it goes ("types"), and
`types` in the mapping sends each one to a collection, or leaves it out with `null`. A type nobody maps is counted
and left out, as before.

**Real addresses.** Each entry keeps the path its page has on the old site: its permalink when published (so
`/portal-development/work/clinic-portal/` for a case study under a page), else the type's permalink template with its
slug, else its parent's path and its slug. A collection with a url field (`fields: {url: 'permalink'}`, for example)
writes that path into it, and the new page answers at the same address. `"ids": "path"` makes each id from the whole
path (`portal-development-work-clinic-portal`), so two children with the same slug under different parents do not
collide. A collection whose address is made from the id (`url: '/blog/{id}/'`) keeps using the slug.

**The block markup itself.** With an application password every list is read with `context=edit` and every status
(published, scheduled, drafts, pending, private), so the import gets the blocks as they were written (`content.raw`),
not the theme's HTML. A list WordPress will not give for editing (a host may refuse it) is read as the public sees it,
and a review note says so. Only GET requests are ever sent.

**ACF fields.** An entry's `acf` object (REST) or its ACF post meta (an export: the meta whose `_name` holds a
`field_…` key) is offered in the mapping as `acf.<name>`. Map it to a front matter key, for example
`"acf.contentLayout": "layout"`. An ACF field nobody maps is left out.

**Rank Math's head.** When the site has the `rankmath/v1` REST namespace, the import asks Rank Math for each published
page's head (`/wp-json/rankmath/v1/getHead?url=<permalink>`, two at a time) and takes the title (`og:title` when there
is no `<title>`), the description, robots, the share picture (`og:image`, brought in like any picture) and the
canonical address. Map them with `seoTitle`, `seoDescription`, `seoRobots`, `seoImage` and `canonical`. The head's
JSON-LD is left out. A page whose head cannot be read keeps its meta fields, with a note.

**The public address.** Many sites run WordPress on one host (`cms.example.com`) and show it on another
(`www.example.com`). Give the public one as `publicUrl` (or `--public-url`). Every link, canonical and old address on
the WordPress host is then read as the public one. A link to a page that is imported goes to its new path; a link to
a page that is not goes to the public address, never to the WordPress host. Pictures written on the public host are
still fetched from WordPress.

**One part at a time.** `"only": ["/portal-development/"]` (or `--only`) plans just the entries whose path starts with
one of the paths given. The rest are counted as "outside". Links to them go to the public address now, and to their
new path once a later part brings them in. Run the parts one after the other with the same mapping.

## Converter rules: a site's own blocks as MDX components

A site built with a page builder or its own CSS classes has patterns Markdown cannot hold: a call-to-action box, an
FAQ with numbered questions, a row of cards, a list of steps. A rules file says, for one site, which old pattern
becomes which MDX component and where each of its props comes from. It applies to MDX collections only; in a Markdown
collection the usual conversion is kept, with a note. A pattern with no rule keeps today's behaviour. Inline
`<style>`, `<script>` and JSON-LD are always left out and noted.

```json
{
  "components": { "CtaBand": { "import": "../../components/blocks/CtaBand.astro" } },
  "report": ["soa-", "t3-"],
  "rules": [
    { "match": "breadcrumb-wrapper", "drop": true },
    { "match": "t3-head", "keep": true },
    { "match": "callout_box", "component": "CtaBand", "props": {
        "heading": { "from": "text", "select": ".call_heading", "required": true },
        "text": { "from": "markdown", "exclude": ".call_heading, .wp-block-buttons" },
        "action": { "from": "link", "select": ".wp-block-buttons" } } },
    { "match": "callout_box", "component": "Callout", "children": { "from": "markdown", "required": true } },
    { "match": "faq_blog", "component": "Faq", "props": {
        "heading": { "from": "heading", "select": "h2" },
        "items": { "from": "qa", "question": "h3", "trimNumber": true, "required": true } } }
  ]
}
```

- **match**: a class (`"callout_box"`), several that must all be there (`["t3-cta", "light"]`), or
  `{"class": …, "tag": "section"}`. A `*` matches any letters (`"t3-*-awards"`). The first rule that matches and finds
  every `required` prop wins; when one does not, the next is tried and a note says why.
- **drop** leaves the wrapper out (a note quotes it when it had words). **keep** says the plain Markdown is right, and
  hushes notes inside it.
- **props**: each prop's source, `{"from": …, "select": …, "exclude": …, "required": …}`. `value` (a fixed value),
  `heading`, `text`, `markdown`, `list`, `link` / `links` (`{href, text}`), `image` / `images` (`{src, alt}`, brought
  in like any picture), `attr` (`name`), `hasClass` (`name`, true or false), `qa` (question and answer pairs, from
  `<details>` toggles, or from a `question` selector and what follows each; `trimNumber` takes "1." off), and `items`
  (each match of `select` with its own `fields`, up to three deep). A selector is a tag, a `.class`, `tag.class`, or
  several with commas.
- **children**: the component's inner Markdown; other rules apply inside it.
- **wordsFrom**: the component draws its words from the site's data (a file named here), so the old words are not
  checked.
- **report**: class prefixes of the site's own blocks. A block with one of them and no rule is noted once, with its
  heading, so you see which patterns still need a rule.

After converting, the old words are compared with the props: words no prop kept are noted ("did not keep some of the
old words"). Simple text props are written as `heading="…"`, which the editor can change; lists and objects as
`{…}`, which it shows read-only. Each component's import line is put at the top of the file, from `components`. The
plan says how many of each component it made ("Converter rules made …").

Give the file as `rules` (the routes, as JSON) or `--rules <file.json>`. It is kept with the run, and planning again
uses it until another is given. A file that is not right is refused with the place named (422, field `rules`). Keep a
site's rules file in that site's own repository, next to its migration notes: it names the site's old classes.

## Proof on a real site

On 2026-11-04 the WordPress importer ran on the export of a real business site: 148 posts and 17 pages written in
the block editor, with 1,513 tables, 1,264 FAQ toggles, 438 call-to-action boxes, code, quotes and a Rank Math SEO
plugin. The export was turned into the file Tools › Export writes and imported into a copy of examples/blog, with the
old site's uploads served from a local folder. The site itself is not named here, and nothing of it is in the
repository.

| | |
|---|---|
| Entries | 165 created, 0 failed (148 posts, 17 pages) |
| Images and files | 223 brought in, 0 missing |
| Old addresses | 594 paths sent to the new pages, 388 `?p=` / `?page_id=` / `?attachment_id=` links kept |
| Blocks we could not convert | 0 |
| Notes to review | 243 SVG pictures still on the old site, 149 JSON-LD blocks left out, 153 pictures without alt text, 4 links to pages that were not imported, 7 other things left out (3 Custom HTML blocks with a script or form, 2 styles, a form, an SVG drawing), 2 pictures on another site |
| Time | 7 s for the plan, 31 s for the run; the same import again: under 2 s, nothing changed, nothing fetched |

Five posts were checked by hand against their HTML: headings, lists, tables, links (to other posts and to places on
the same page), pictures, code, quotes, FAQ toggles, and the front matter (title, dates, author, categories, tags,
the search title and description). What it found was fixed, each with a test (`import-real-cases.test.mjs`): links to
a place on the same page, bold inside bold, FAQ questions, `[patterns]` in code taken as shortcodes, an author the
export does not list, and a plan that promised what the run then refused.

### A second site, through the REST API (2026-11-08)

A real healthcare software company's WordPress (WordPress on a CMS host, shown on a public one), read through its
REST API with an application password: posts, pages and seven custom post types, Rank Math, ACF fields, and a theme
whose sections are CSS classes. Only GET requests were sent, at most two at a time. The plan for the whole site, with
the sample rules and `publicUrl`:

| | |
|---|---|
| Kinds of content | 5 posts, 21 pages, 112 entries of 7 custom types (19, 36, 7, 25, 8, 11, 6); one more type with none |
| Entries | 134 to create, 4 left out by the target site's own check (an excerpt over 500 characters) |
| Images and files | 443 to bring in (711 in the library are not used) |
| Old addresses | 854 paths, 490 `?p=` / `?page_id=` links |
| Components | 869 made from the old patterns, of 20 kinds (Callout 260, CtaBand 120, CardGrid 100, CompanyProfile 92, Faq 77 …) |
| Notes | 2,208: 1,526 SVG pictures still on the old site; 416 from the rules (304 blocks with no rule yet, most of them in four section kinds; about 95 components that did not keep some old words); 216 left out of the HTML (119 JSON-LD, 51 style blocks, 25 SVG drawings, 10 forms, 10 Custom HTML blocks with a form or player); 15 links to blog posts outside the import; 12 shortcodes not converted; 19 pictures without alt text; 3 lists WordPress would not give for editing; 1 set of chat-assistant citation markers |
| Time | about 40 s for the plan |

One part (the 7 entries of one section, a page and its 6 case studies, under `only`) was then imported into a copy
of examples/blog in 54 s: 7 entries and 53 pictures in 5 changes. Each file keeps its real path, parses as MDX, and
has the Rank Math title, description, robots, share picture and canonical (on the public host) and its ACF layout.
Links to the part's own pages go to their new paths; links to other parts go to the public address. Planning it again
found all 7 unchanged and the 53 pictures already here.

What it does not show yet: the first export had no embeds (videos, maps), and its posts were the HTML WordPress shows, not
the block markup Tools › Export writes, which the fixtures cover. SVG pictures are never brought in (they can carry
scripts): save them as PNG or WebP before the old site goes away.

## The mapping

Each field goes to the key your collection uses, read from the site's own config: its title, date, author, tags and
excerpt roles (`fields`), its first image setting (the cover and its alt), a `categories` tags setting, and its
`seo` setting. A JSON collection takes the text as `body`, the old address in its `url` field, and mapped slices as
`sections`. The plan's "Where it goes" shows every key, and any can be changed (or left out) before planning again.

```json
{
  "types": { "post": "posts", "page": "pages", "product": null },
  "fields": { "posts": { "excerpt": "summary", "seoTitle": "seo.title", "categories": null } },
  "onCollision": "both",
  "drafts": "skip",
  "media": "used",
  "slices": { "hero": { "section": "hero", "fields": { "heading": "primary.heading", "image": "primary.image" } } },
  "permalink": { "post": "/blog/{slug}/" }
}
```

| Key | What |
|---|---|
| `types` | each kind of item to a collection id, or `null` to leave it out. Default: posts to `posts` (or the first Markdown collection with drafts), pages to `pages`, a Prismic type to the collection of its own name. |
| `fields` | per collection, each of `title`, `date`, `updated`, `author`, `tags`, `categories`, `excerpt`, `cover`, `coverAlt`, `seoTitle`, `seoDescription`, `seoRobots`, `seoImage`, `canonical`, `body`, `url`, `sections` and any `acf.<name>` to a key (dotted for nested), or `null` |
| `publicUrl` | the address readers use, when WordPress runs on another host: links, canonicals and old addresses on the WordPress host are read as this one |
| `only` | paths (starting with `/`, at most 200): only the entries under them are planned; the rest are counted as outside |
| `ids` | `slug` (the default) or `path`: each id made from the whole old path, in a collection that keeps the path |
| `onCollision` | an address already taken: `both` (the new one gets `-2`), `skip` (the new one is left out) or `replace` (it is saved over what is there, through the editor's save: locks and checks hold) |
| `drafts` | drafts and private posts, for a collection without drafts: `skip` or `include` |
| `media` | `used` (the pictures the pages show and link to) or `all` (every file in the export) |
| `slices` | Prismic slice types to sections of a JSON collection: `{section, fields: {key: 'primary.x' or 'items'}}`; a heading alone becomes its words, other rich text Markdown, a picture `{src, alt}` |
| `permalink` | Ghost's old address pattern per kind: `{slug}`, `{year}`, `{month}`, `{day}` |

## Running it again

An import remembers what it made by the source's own ids (a WordPress post id, a Ghost id, a Prismic document id),
for that site. Running the same source again changes nothing and fetches nothing. A post changed at the source is
updated; a new one is added. A page someone changed in Markstage since is left alone and listed, never overwritten.

## The moved addresses

Every old address of a page, a picture and an author is sent on to its new one. Paths go to the site's redirects
hook (docs/API.md, "The redirects hook"), so they appear in Moved addresses and go live with the next publish. A
static host cannot match an address by its query, so WordPress's `?p=12`, `?page_id=3` and `?attachment_id=41` links
are kept in `markstage/import/<source>.json` in the site's repository, for the site (or its host's rules) to use; a
site with no redirects hook finds its paths there too. An address a page of the site already answers is never
redirected.

## Safety

- **Only public addresses are read.** Every request (the API, each picture) goes through the server's SSRF guard:
  http and https only, ports 80 and 443, the address checked after DNS and again at every redirect, so loopback,
  private, link-local (169.254.169.254) and other reserved addresses are refused, never contacted (docs/SECURITY.md
  "Fetching from the web").
- **Limits.** An API answer at most 20 MB and 20 seconds, a whole read at most 64 MB and 5 minutes, 50 pages of 100
  per list; at most 5,000 entries and 5,000 files an import; an upload as big as the media import allows (64 MB by
  default, `library.importMaxBytes`); a picture as big as an upload (`media.maxBytes`), 15 seconds each.
- **Content types are checked.** An API answer must be JSON; a picture must say it is an image or a PDF, and then the
  upload's pipeline sniffs it (never SVG) and re-encodes it.
- **Nothing that runs comes in.** HTML is read into Markdown: scripts, styles, forms, frames and event attributes
  are dropped (and noted), links keep http(s), mailto, tel or relative addresses only.
- **A credential is used once.** An application password, a Content API key or a Prismic token is used for the one
  read the plan makes, sent only to the source's own address (a redirect elsewhere is asked without it), taken out
  of any error, and kept nowhere: not in the database, a log, the audit or the plan. On the command line it is read
  from a file or `MARKSTAGE_IMPORT_SECRET`, never an argument. Delete the application password at the source when
  the import is done.
- **The editor's rules.** Each entry is created or saved as the editor does it: your rights, links, raw HTML, locks,
  the site's own checks. Editors and up; each step is audited (`import.plan`, `import.run`, `entry.import`,
  `author.create`).

## From the command line

On the server itself, as an account named by `--as`, with the same plan and run (no upload limit):

```sh
markstage-server import wordpress ./example.WordPress.2024-05-10.xml --dry --as editor@example.com
markstage-server import wordpress ./example.WordPress.2024-05-10.xml --as editor@example.com
markstage-server import wordpress --url https://www.example.com --user editor --password-file ./app-password.txt --as editor@example.com
markstage-server import ghost ./example.ghost.2024-05-10.json --site-url https://blog.example.com --as editor@example.com
markstage-server import ghost --url https://blog.example.com --key-file ./content-key.txt --as editor@example.com
markstage-server import prismic --repo example-repo --token-file ./token.txt --routes ./routes.json --as editor@example.com
```

Options: `--mapping <file.json>`, `--on-collision both|skip|replace`, `--drafts skip|include`, `--rules <file.json>`
(converter rules), `--public-url <address>`, `--only /a/,/b/` (one part of the site), `--dry` (the plan in words,
nothing written; the plan also opens in the Import screen at `#/import/<id>`).

## Tests

`packages/server/test/import-convert.test.mjs` (each converter), `import-wordpress.test.mjs` (the WXR plan, run,
second run, collisions, mapping), `import-sources.test.mjs` (Ghost's export and Content API, Prismic's recorded
answers, WordPress's REST API, the SSRF and credential checks), `import-cli.test.mjs`, `import-wp-types.test.mjs` (custom types, real paths, `context=edit` and its fallback,
ACF, Rank Math's head two at a time and GET only, `publicUrl`, `only`, path ids, an export's custom types and ACF
meta), `import-rules.test.mjs` (the converter rules, each output parsed as MDX), and
`e2e/import.e2e.mjs` (the Import screen on a copy of examples/blog with the WXR fixture).
