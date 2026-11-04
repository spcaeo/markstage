# Markstage API: the Library

Paths are under `<basePath>/api/`, signed in, like docs/API.md.

One store of parts to use again: page **templates** (a new entry starts from one), **sections** (a page section, or a
piece of an article) and **snippets** (a piece of an article). Shared items are files in the site repo,
`<library.dir>/<kind>/<id>.json` (server config `library: {dir}`, default `markstage/library`), with the item's picture
beside it as `<id>.png`; every change is one commit by the person who made it, so items have a history, show in
Environments plans as content and are promoted like it. A personal snippet (not shared) stays in the server's
database and its picture in the data dir. Ids are opaque (`lib_…`; `sn_…` and `t_…` from before).

Item: `{id, kind: 'template'|'section'|'snippet', synced, name, description, folder, tags, order, collection,
sectionType, locks: {move?, remove?, edit?} | null, body, thumb: url | null, usedOn, shared, createdBy, createdByName,
createdAt, updatedAt, version, syncVersion?, imported?}` (`syncVersion`: on a synced item, the version its uses' markers carry). `body` is `{frontmatter?, doc?, data?, _fill?}` for a template (`_fill`:
the field paths the writer fills in, never written into the entry; a template never keeps `slug`, `id`, `order`, its
collection's address field (`fields.url`, or a url that is just `{field}`), `seo.canonical`, dates or
`author`/`authors`, the server takes them out), `{value}` for a page section (one item of a page's sections; its
`discriminant` is the `sectionType`) or `{doc}` for a piece of an article. Links go through the unsafe-link rule
(`422`); an item is at most 1 MB.

| Method + path | Body | Answer |
|---|---|---|
| `GET library?kind=&synced=1&shared=0\|1&folder=&tag=&collection=&q=&sort=place\|name\|-name\|updated\|-updated&page=&perPage=` | | `{items, total, page, perPage (50, at most 200), facets: {kinds: {template, section, snippet}, synced, folders: [{name, count}], tags: [{name, count}]}}`: the shared items and your own. `synced`: how many synced items the kind filter leaves (the other filters aside). `q` searches the name, description, folder and tags. `place` (default): folders A–Z (none last), then `order`, then the name |
| `GET library/:id` | | the item with `history: [{sha, author, date, message}]` (the commits of its file), `usedOn` (how many entries use a synced item) and `uses` (those entries, as in `impact`); someone else's personal snippet is `404` |
| `GET library/:id/impact` | | `{pages: [{collection, id, title, url, status, uses, state: 'synced'\|'changed'}]}`: the entries a change of a synced item reaches ("This changes N pages"); `changed` is a copy changed in place, which a change leaves alone |
| `POST library` | `{kind, name, body, description?, folder?, tags?, order?, synced?, shared? (default true), collection? (template), sectionType?, locks?}` | `201` item. Templates, sections and synced items: editors and up; a snippet: anyone (`shared: false` keeps it to yourself; only a snippet can be) |
| `PATCH library/:id` | any of the fields, and the `version` you opened | the item; `400` without a version, `409 {current}` when it changed, `400` for another kind. Sharing a personal snippet moves it into the repo with its id; only its maker takes it back. For a synced item whose body or locks change (or that stops being synced) the answer also has `{changed, skipped, job}`, as below |
| `PUT library/:id` | `{body, version, locks?}` | "Edit everywhere" of a synced item: `{changed (entries rewritten), skipped: [{collection, id, title, url}] (copies changed in place, left alone), job: {id} \| null, item}` |
| `DELETE library/:id[?detach=1]` | | `{ok, commit}`; a synced item still used is `409 in-use {pages}` unless `detach=1`, which turns every copy into plain content in the same commit |
| `POST library/:id/reset` | `{collection, entry}` | `{commit, copies, job: {id} \| null}`: a page's copies of a synced section changed there become the item again, in one commit `Library: reset the section “X” on “page”`, built and deployed when the page is live; `409` when the page already shows it; editors; audited as `library.reset` |
| `POST library/:id/duplicate` | `{name?, kind?, shared?, collection?}` | `201` the copy (`"<name> (copy)"`) |
| `GET library/export?ids=<id>,<id>` | | the pack of these shared items, a `.json` download (`markstage-pack-<date>.json`), audited as `library.export` |
| `POST library/import[?dry=1]` | `multipart/form-data`: `file` (and `onClash: skip\|copy`; `mediaMap` for WordPress) | a WordPress export or dump: see "From WordPress"; a pack: dry `{items: [{path, kind, name, exists?}], media, problems}`; otherwise `{created, skipped, media, problems, commit}`. Editors and up. `415` for a file it does not read. At most `library.importMaxBytes` (64 MB by default; `413`), streamed to `<dataDir>/tmp` first; `409 busy` while another import runs |
| `POST library/import/url` | `{url}` | the parts of a web page to choose from ("From a web page", below) |
| `POST library/import/url/parts` | `{url, parts, kind?, folder?, dry?}` | the chosen parts as items in `Imported`, with their pictures, in one commit |
| `GET library/:id/thumb` | | the PNG, or `404` |
| `PUT library/:id/thumb` | a PNG (`Content-Type: image/png`, at most 200 KB) | the item; `415` not a PNG, `413` too big |
| `DELETE library/:id/thumb` | | the item |

Who changes what: a shared snippet its maker or an editor; everything else editors and up. Audited as
`library.create|update|delete|duplicate|thumb` (and `library.move`, below).

A page type (config `pageTypes`, docs/API-PAGE-TYPES.md) names a shared template by its id (`template:
'lib_money-page'`): a site can ship its types' templates as files in `<library.dir>/template/`, and a new page of
the type starts from it (`POST collections/:c/entries` with `pageType`, the New sheet's type cards).

## Synced items

A synced section or snippet (not a template) is used as an ordinary copy with a marker, so the site's build reads plain
content and its HTML is the same as an inline copy's:

- **pages**: `_synced: {id, version}` on the section. The site's schema keeps only a section's `discriminant` and
  `value` (the pilot site's `src/content.config.ts` `flattenSection`), so the marker never reaches the HTML. The item's
  `locks` are written where the site keeps a section's lock, in the copy's value as `value._lock` (as on the pilot site's
  legal pages and as the editor's padlock writes it; a section with no value object gets `_lock` on itself), so
  deleting, moving or changing it is refused (423) like any locked section; a copy the item brings with its own locks
  is not a lock change of the person inserting it. The lock rules read a lock in either place.
- **articles**: frontmatter `synced: [{id, version}]`; the copy is the item's blocks as Markdown, found by exact text
  as whole blocks, so nothing is added to the body.

`version` (the hash of the item's body the copy was made from) is written by the server on save. Rules on every save,
whatever the route:

- a synced copy changed without detaching it: `409 synced {id, name}` ("“X” is synced from the Library: change it
  there (every page that uses it follows), or detach it here first"); a copy already changed before the save (by hand
  in git) does not block other changes;
- detaching is dropping the marker; a locked item is detached by editors and up only (`403`);
- an article copy of an item locked against removal can't be deleted (`423`), whoever saves.

A copy changed outside Markstage (in Source by hand, or in git) is never overwritten: a change of the item skips it
and names it (`skipped`, and `state: 'changed'` in `impact`), and the page's content check (preflight `synced`, a
`synced` warning) says "This copy of “X” was changed here, so it no longer follows the Library. Keep it as its own copy
(detach it) or reset it to the Library version." Reset (`POST library/:id/reset`) is for page copies; an article's
changed copy can no longer be found by its text, so it is detached or made like the item again by hand.

Changing a synced item (`PUT`, or `PATCH` with a body or locks) writes the item and every copy that still matches it
in one commit by the person who changed it (`Library: change the section “X” on N pages`), audited as
`library.update` with the entries and the skipped ones. When a live entry changed, the site is built and deployed in
one job (`library-sync`); if it fails, the pages and the item go back (unless changed since), like any publish.
Making an item plain, or deleting it with `detach=1`, drops the markers in the same commit and builds nothing (no
page changes).

## Packs

A pack carries shared items between sites (or keeps them): one JSON file,

```json
{"format": "markstage-pack", "version": 1,
 "items": [{"path": "section/<id>.json", "text": "<the item's file, as it is>"},
           {"path": "section/<id>.png", "sha256": "…", "base64": "…"}],
 "media": [{"path": "2026/10/team.png", "sha256": "…", "type": "image/png", "alt": "…", "base64": "…"}]}
```

with each item's picture and the media files its text names (a library file whose path inside the media folder
appears in it). Items keep their file text as it is, so exporting, importing elsewhere and exporting again gives the
same bytes (their folders too: a pack is the site's own content, not something found elsewhere). An import is a dry
run first: what would come in, which ids are here already (`exists`), and every problem in words; nothing is
written. Then every item, picture and media file goes in one commit `Library: import N items from <file>`, audited as
`library.import`. An id already here is skipped (`onClash: skip`, the default) or copied under a new id (`copy`).
Each item passes the same checks as one made here (kind, fields, the unsafe-link rule); a picture must be a PNG of at
most 200 KB with its checksum, a media file an image or document this site takes (never SVG) with its checksum;
whatever fails is left out and named in `problems`. A media file already at that path with other bytes is kept, and
said. Media files get their library row (alt text from the pack).

## From WordPress

The reusable blocks (patterns, post type `wp_block`) of a WordPress site come in from its export (Tools › Export, an
`.xml` file) or a database dump (`.sql` or `.sql.gz` from mysqldump, any table prefix), read only: `POST
library/import` with the file (multipart `file`, and optionally `mediaMap`), or `markstage-server library import
<file> [--media-map <file>]`. A dry run first: `{items: [{wpId, kind, name, images, exists?}], media (pictures to
fetch), found (pictures already here), problems}`. Then each published block becomes a shared section in `Imported`
named after its title, with `imported: {from: "wordpress", source, wpId}`; its Gutenberg HTML is read into Markdown
and the site's blocks like a web page's (block comments dropped, their inner HTML kept). One commit `Library: import
N items from <file>`, audited as `library.import`. Drafts and other statuses are left out and named; a block imported
before (same WordPress id) is skipped.

Pictures: the media map (JSON `{urls: {old address or upload path: file}}`, the shape a migration writes; the file a
repo path or a path in the media folder) or the old `/wp-content/uploads/<path>` already in the media folder makes the
item point at the file that is here; any other picture is fetched through the guard (SECURITY.md "Fetching from the
web") and stored like an upload, at most 50 per import. One that cannot be fetched is named and left out.

## From a web page

Parts of a page somewhere on the web become Library items. The server fetches the page itself (never the browser),
through the guard in [SECURITY.md](SECURITY.md#fetching-from-the-web): public addresses only, its robots.txt
respected, at most 5 MB of HTML in 10 s. Editors only.

| Method + path | Body | Answer |
|---|---|---|
| `POST library/import/url` | `{url}` | `{url, title, parts: [{id, label, html, images}]}`: the page's parts to choose from (its `<section>`s and `<article>`s, a header or footer without a menu too, or else its content cut at each second-level heading); `url` is where it ended after redirects; `html` a clean copy to show (no script, style, frame, form, SVG or event attribute; links and pictures made absolute, http(s), mailto and tel only); `images` how many pictures the part shows. Nothing is written |
| `POST library/import/url/parts` | `{url, parts: ["p1", …], kind?: section\|snippet, folder?, dry?}` | dry: `{url, items: [{id, name, kind, images}], media, problems}`, nothing written; else `{created: [id], items: [{id, kind, name, folder}], media, problems, commit}` |

The page is read again for the import (`409` when the chosen parts are no longer there: read it again). Each part
becomes a shared section (or snippet) named after its first heading, in the folder `Imported` unless said, with
`imported: {from: "url", source}` in its file. Its text goes through Markdown into the site's own blocks (headings,
paragraphs, bold and italic, links, lists, quotes, code, tables, pictures); everything else is left behind. Its
pictures (at most 20, within a minute in all) are fetched through the same guard and stored like uploads (sniffed,
never SVG, HEIC read, re-encoded); the items point at the stored copies. A picture that fails (gone, too large, not
an image) is named in `problems` and left out of its item. The items and the pictures go in one commit `Library:
import N items from <host>`, audited as `library.import` (`from: "url"`, the address, the commit, the items, the
files). A part with nothing left once cleaned is left out and named.

Refused, in words: an address that is not public (`400 unsafe-url`), a page robots.txt asks robots not to fetch, or a
robots.txt that cannot be read (`422 robots`), something other than a web page (`415`), a site that does not answer
(`502`), too slowly (`504`) or with too much (`413`), an author or below (`403`).

## Command line

On the server, as an account named by `--as`, with that account's rights:

```
markstage-server library export <id,id,…> [--out <file>] --as <email>
markstage-server library import <file> [--dry] [--on-clash skip|copy] [--media-map <file>] --as <email>
markstage-server media import <folder | file.zip | addresses.txt> [--dry] --as <email>
```

`media import` brings many files into the media library in one commit (docs/API.md "Importing media"): a folder (its
sub-folders too, hidden files left out), a zip, or a text file with one picture address per line.

**From a template**: `POST collections/:c/entries {title, id?, template: <id>}` starts the entry from the template's
frontmatter and blocks (`templateId` still works); a template of another collection is `404`.

## From before the Library

On its first start the server moves the shared snippets and the templates it kept in its
database into files, in one commit `Move N Library items into the repo` (a snippet's `doc.attrs.folder` and `order`
become its fields), audited as `library.move`; personal snippets get their fields the same way. The old routes still
answer from the Library, with the folder and place back in `doc.attrs` as the editor read them:

| Method + path | Body | Answer |
|---|---|---|
| `GET snippets` | | `[{id, name, doc, createdBy, updatedAt, shared}]` own + shared |
| `POST snippets` | `{name, doc, shared?}` | `201 Snippet` |
| `PATCH snippets/:sid` | `{name?, doc?, shared?}` | `Snippet` (own, or editor+) |
| `DELETE snippets/:sid` | | `{ok}` |
| `GET templates?collection=` | | `[{id, collection, name, frontmatter, doc, data}]` |
| `POST templates` / `PATCH templates/:tid` / `DELETE templates/:tid` | `{collection, name, frontmatter?, doc?, data?}` | editor+ |

A snippet's `doc` is an editor document fragment (`{type:'doc', content:[...]}`). Contributors' snippets go through
the same raw-HTML rule when inserted and saved.

## Proof

packages/server/test/library-synced.test.mjs, on core's site-shaped page and article fixtures with the real converter: a page
copy is the inline section plus the marker; impact and usedOn; a copy changed in place refused (409) and other
changes on that page saved; edit everywhere rewrites the item and the page in one commit and skips a copy changed by
hand, then builds and deploys; the hand-changed copy is a preflight warning in words and is reset in one commit (an
author refused, nothing to reset 409); a failed publish puts the page and the item back; a locked item's copy gets
`value._lock` (never `_lock` on the section) and can't be deleted (423); an article piece found by its Markdown, refused when changed in place, replaced where it
stands, not deletable when locked and not detachable by an author; delete refused while in use, then with detach in
one commit; a template is never synced.
The real site, built (2026-10-28): a scratch clone of the pilot site at 29a9413, built once as it is, then with
`_synced: {id, version}` and `_lock` added to a section of about-us.json and `synced: [{id, version}]` added to the
frontmatter of a blog post, built again: `diff -r` of the two outputs is empty (231 pages, 4,920 files), so a synced
copy's HTML is byte for byte an inline copy's and no marker reaches a page. Again (2026-10-28) with the lock where it
is written now: the same clone (its origin removed, so nothing can be pushed from it), `_synced` on the cta section of
about-us.json and `_lock: {remove, move}` inside its value, plus the post's frontmatter marker: `astro build`, then
`diff -r` against the build without markers is empty (231 pages, 4,920 files).
packages/server/test/library-packs.test.mjs: export from one site, a dry run and an import into another, byte for
byte (items, picture, media file with its alt text), the pack exported again is the same text; clashes skipped or
copied; a damaged picture and an unsafe link named and left out; a foreign file refused; editors only; the command
line export and import.
packages/server/test/library-url-import.test.mjs, against a small site on loopback reached through the test seam
only: a page's parts to choose from, with no script, event attribute or javascript: link left in what is shown; a dry
run writes nothing; the chosen parts become sections in `Imported` with their picture stored in Media and pointed at
(a heading, a paragraph, an image node), the items and the picture in one commit, audited; a missing picture named;
robots.txt, private addresses (169.254.169.254, 10.0.0.1, localhost, the server's own port), a JSON answer and a
changed page refused; authors refused. test/library-fetch.test.mjs: the guard itself (see SECURITY.md).
packages/server/test/library-wp.test.mjs: reusable blocks read from an export and from a dump (drafts and posts left
out); a dry run, then sections in `Imported` (heading, paragraph, image, a button as a link) with the picture the
media map names pointing at the file here and another fetched into Media, one commit; a second import skips them; a
`.sql.gz` on the command line; authors refused. With `MARKSTAGE_WP_DUMP` (the real site's `wp_block` rows, copied
into a scratch dir) and `MARKSTAGE_WP_SITE` (its repo, read only, for the media map and pictures), the real blocks
import with nothing fetched. Run on 2026-10-28: 3 blocks, 8 pictures found through the map, 0 to fetch, 3 imported,
0 problems (10 headings, 14 paragraphs, 1 numbered list, 8 images).

packages/server/test/library.test.mjs: the move out of the database (once, one commit, folders and places kept, the
old routes answering); add, change, delete with rights, versions and one commit each; sharing and taking back a
personal snippet; the list's facets, filters, words, sorting and pages; pictures (PNG only, 200 KB, repo or data
dir); a new entry from a template; a page template keeps no address, place or canonical (one kept by hand
before also starts clean). test/env-rules.test.mjs: Library files are content in Environments plans.
