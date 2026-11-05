# Markstage API: importing entries and media

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). Entries and media files from
another system, sent as JSON: first a plan (a dry run, nothing written or fetched), then the run of that plan, as a
job. Server code: `packages/server/src/import/`.

- **Idempotent on the source's ids.** Each entry and media file carries the id it has in the source (`sourceId`).
  What an import made is remembered by `source` + `sourceId`: the same payload again changes nothing; a changed one
  updates what the first made; a new id makes a new entry.
- **Never over a person's work.** An entry changed in Markstage since it was imported (or deleted) is left alone and
  the plan says so, unless the payload says `overwrite: true`.
- **The editor's own rules.** Each entry is created or saved through the editor's create and save: rights, links,
  raw HTML, locks, synced Library copies, the page's address (no move by a save), the site's own `validate`. In a
  collection with drafts, an import makes drafts and keeps an entry's status when it updates it: publishing stays a
  person's step, and the publish rules' findings are listed in the plan so they are known before then.
- **Media through the guard.** Files are fetched by the server through the same SSRF guard as the Library's import
  (public addresses only, checked after DNS and on every redirect, ports 80 and 443, size and time limits;
  docs/SECURITY.md "Fetching from the web"), then go through the upload's pipeline (sniffed, never SVG, re-encoded),
  all in one commit.
- Editors and up.

## The payload

```json
{
  "source": "wordpress",
  "overwrite": false,
  "mediaAs": "url",
  "media": [{ "sourceId": "att-41", "url": "https://old.example.com/wp-content/uploads/truck.jpg", "alt": "Our truck" }],
  "entries": [
    { "sourceId": "post-12", "collection": "posts", "title": "Moving day", "id": "moving-day",
      "frontmatter": { "author": "alice", "tags": ["news"], "image": "media:att-41" },
      "body": "# Moving day\n\nWe moved. ![Truck](media:att-41)\n" },
    { "sourceId": "page-3", "collection": "pages", "title": "About", "data": { "uri": "/about-us/", "sections": [] } }
  ]
}
```

| Key | What |
|---|---|
| `source` | Where it comes from: lowercase letters, digits and hyphens. Ids are remembered per source. |
| `entries[]` | At most 500. `sourceId` (text, at most 200, once per payload), `collection`, `title` (or the collection's title field in `frontmatter` / `data`), and `id` (optional: else made from the title, as a new entry's is). A Markdown collection takes `frontmatter` and `body` (Markdown, at most 1 MB); a JSON one `data`. `draft`, `publishAt` and `protected` are refused: an import brings drafts. |
| `media[]` | At most 200. `sourceId`, `url` (http or https), `alt`. |
| `mediaAs` | How an entry names a stored file: `url` (default: its address on the site from the media URL template, `/uploads/2026/10/truck.jpg`) or `relative` (a path from the entry's file, `../../assets/uploads/2026/10/truck.jpg`, as an Astro `image()` field takes it). |
| `overwrite` | `true`: replace entries a person changed or deleted since they were imported. |

In every text of an entry (the body, and every string in `frontmatter` or `data`), `media:<sourceId>` and each media
file's own `url` become where that file is on the site. An entry naming `media:<id>` that the import does not bring
in is a problem for that entry. The payload is a request body, so at most the server's `maxBodyBytes` (4 MB by
default): split a larger import into several.

## Routes

| Method + path | Answer |
|---|---|
| `POST import` | the payload → `201 {run, entries, media, counts}`: the plan, kept for an hour |
| `POST import/:rid/run` | `{}` → `202 {run, job}`. The person who made the plan, once, within the hour (`403`, `409`, `410 expired`) |
| `GET import/:rid` | `{run, plan, result}` (`result` once the job is done) |
| `GET import` | `{items: [run]}`, the newest 50 |

`run`: `{id, source, status: planned|running|done|failed|expired, createdAt, expiresAt, by: {id, name}, job,
finishedAt}`. The job (`GET jobs/:id`) logs each item; its steps are `media` and `entries`.

### The plan

Each entry: `{sourceId, collection, id, action, problem?, rules?}`.

| `action` | What the run would do |
|---|---|
| `create` | make a new entry (a draft where there are drafts) |
| `update` | save the new text over what this import made before |
| `unchanged` | nothing: the payload and the entry are as before |
| `skip` | nothing: `problem` says why (no such collection, no title, a status key, the address taken, an unsafe link, raw HTML, a locked block, the site's `validate`, changed or deleted in Markstage since) |

`rules`: the publish rules' findings for the new text (`[{rule, level: block|warn, message}]`): what will stop or
warn when a person publishes it.

Each media file: `{sourceId, url, action: fetch|reuse|skip, path?, problem?}`. `reuse`: the file this source id
brought in before is still in the media library at the same address; nothing is fetched. `path` for a fetch is where
it would go; the run's result has where it went. Nothing is fetched for a plan.

### The run

The run makes the plan again at its time, from the same payload, and does what it says: first the media (one commit:
"Import 3 media files from wordpress"), then each entry (a commit each, by the person, audited as `entry.import`). A
problem with one item is that item's (`result.entries[i].problem`); the rest go on. `result.counts`:
`{create, update, unchanged, skip, problem}`. Audit: `import.plan` and `import.run` with the counts.

Tests: `import.test.mjs`.

## A whole site

docs/IMPORT.md says what this brings over and how; these are its routes. A source is read once, by the plan, and
kept with the run as a bundle (never a credential); the run is `POST import/:rid/run` and `GET import/:rid` as above.
Editors and up.

| Route | What |
|---|---|
| `POST import/site` (multipart) | An export: `file`, `source` (`wordpress` or `ghost`), `siteUrl` (Ghost: the old site's address), `mapping` (JSON, optional) -> `201 {run, plan}` |
| `POST import/site` (JSON) | An API: `{source: 'wordpress', url, user?, password?}`, `{source: 'ghost', url, key}` or `{source: 'prismic', repo, token?, siteUrl?, routes?, fields?, endpoint?}`, each with `mapping?` -> `201 {run, plan}` |
| `POST import/:rid/replan` | `{mapping}`: the same source planned again (by its maker, while it is planned) -> `201 {run, plan}`; the old run becomes `replaced` |

`run.kind` is `site` and `run.product` the source. The plan (`plan`, also in `GET import/:rid`):

| Key | What |
|---|---|
| `product`, `from`, `name`, `site` | the source (`wordpress`, `ghost`, `prismic`), `file` or `api`, the file's or API's name, the old site's address and title |
| `mapping` | the mapping in full, defaults filled in (docs/IMPORT.md "The mapping") |
| `collections` | the site's collections with each one's default keys, for a screen to offer |
| `counts` | `{types, entries, media, authors, redirects, ids, collisions, needsAlt, notConverted, embeds, published, left, unusedMedia, other}` |
| `items` | each post or page: `{sourceId, type, title, sourceStatus, collection, id, url, action, problem?, collision?, rules?, notes}` |
| `media` | each picture or file: `{sourceId, url, action: fetch|reuse|skip, path?, problem?, alt}` (the first 2,000) |
| `authors` | `{sourceId, slug, name, action: create|existing|none}` |
| `redirects` | `[{from, to}]`, the paths for the site's redirects hook (the first 1,000) |
| `review` | `[{kind, text, entry?, media?}]`: `alt`, `block`, `shortcode`, `card`, `slice`, `embed`, `html`, `image`, `link`, `file`, `collision`, `cover`, `seo`, `status`, `author` |
| `hook`, `idsFile` | whether the site has a redirects hook; where the `?p=` / `?page_id=` / `?attachment_id=` links (and the paths, without a hook) are written |

The run's job has the steps `media`, `authors`, `entries` and `redirects`. Its `result`: `{commits, entries, media,
authors, redirects: {paths, ids, hook, file, commit}, review, counts}`; in `review` each `entry` is
`{sourceId, collection, id, title}` and each `media` `{sourceId, id}` (the media library's id), to link to. The report
accounts for everything the plan did: `entries` and `media` list every item of the plan (one it left out as `skip`,
with its `problem`), and `counts.left` and `counts.other` repeat the kinds the plan left out before any item was made.

Errors: `422` with `field` for a wrong source, address, key or mapping key (`types.post`, `fields.posts.excerpt`,
`onCollision`…); `422 source-refused` when the source did not let us in (the credential is never repeated);
`400 unsafe-url` for an address the guard refuses; `413 too-large` over 5,000 entries or files; `409 busy` while
another upload is read.

Tests: `import-wordpress.test.mjs`, `import-sources.test.mjs`, `import-cli.test.mjs`, `import-convert.test.mjs`.
