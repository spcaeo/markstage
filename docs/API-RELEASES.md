# Markstage API: releases and share links

Paths are under `<basePath>/api/`, signed in, like docs/API.md. Ids are opaque (`rl_…` a release, `ri_…` an item,
`sl_…` a share link).

A **release** is a named set of changes that go live together: entries (a draft, or new words for a live page), shared
Library items and pictures. They wait in the release, outside the site repo, until it is published. Then they go live
in one commit, by hand or at a time you choose. Publishing asks the promotion rules first (docs/ENVIRONMENTS.md), with
the action `publish-release`. A release's **preview** is the site built as if the release were published. A **share
link** shows that preview, or one draft as it would go live, to people who have no account.

## Releases and environments

A release belongs to the environment it is made on (docs/ENVIRONMENTS.md). Its items wait in that server's data
dir, never in the repo, so a promotion or a sync does not carry them. Its share links are that server's too. A
release published on staging is a commit on staging's branch: that commit is promoted to production like any other
content, and the release itself stays on staging. To publish the same changes on production as one release, make the
release on production.

## Releases

Release: `{id, name, description, status, version, publishAt, key, counts: {items, entries, library, media}, items,
approvals: [{userId, name, role, sha, at}], checks, createdBy: {id, name}, createdAt, updatedAt, scheduledBy,
publishedAt, publishedBy, buildTime, commit, revert, job, error, blocked, preview, decision, links}`.

- **`status`** is one of:
  - `open`;
  - `scheduled`;
  - `publishing` (its job is running);
  - `published`;
  - `rolled-back`;
  - `cancelled`.

  A failed publish puts the release back to `open`. `error` then says why in plain words.
- **`version`** (`r<n>`) changes with every change to the release. Schedule, publish, approve, cancel and
  rename send the version they saw, or get `409`.
- **`key`** names exactly what the release would write: each file, its bytes, and its publish time. Approvals and
  checks count only for that key, so adding, changing or removing an item cancels them.
- **`blocked`** is set on a scheduled release whose time came and that the rules or a check stopped:
  `{words, rule, code, at}` (`rule` is `{id, name}` when a rule said no, else `null`). It stays `scheduled`; see
  "Scheduled" below. Schedule, unschedule and publish clear it.
- **`preview`** is `{status: none|building|ready|failed, fresh, builtAt, buildTime, job, error, key, head, content,
  stale, words}`. `fresh` means it was built from the site as it is now and the release as it is now. `head` is the
  site's commit it was built on. When it is not fresh, `stale` says why (`site`, `release` or `both`) and `words`
  says it for people, for example "The site changed since this preview was built (another change went live). It is
  not what would go live now: build it again."

- **`decision`** is the rules' answer for you: `{effect: allow|needs|deny, rule, words, missing}`. It is checked now,
  or at `publishAt` when the release is scheduled.
- **`links`** is the number of share links still working.

Item: `{id, kind, title, collection, entryId, libraryId, path, url, bytes, isNew, changedSince, alsoIn: [{id, name}],
addedBy, addedAt}`.

- **`kind`** is `entry`, `library` or `media`.
- A picture also has `{type, width, height, alt}`. A Library item also has `libraryKind`.
- **`path`** is the repo file the item writes. **`url`** is the page address for an entry, or the picture's address.
- **`changedSince`** is true when that file changed on the site after the item was added. Such a release cannot be
  published until the item is added again.
- **`alsoIn`** lists other open releases that write the same file.

| Method + path | Body | Answer |
|---|---|---|
| `GET releases?status=` | | `{releases}`, newest first, without their items (`counts` only) |
| `POST releases` | `{name, description?}` | `201` the release. Editors and above |
| `GET releases/:rid` | | the release with its items, preview, decision and links |
| `PATCH releases/:rid` | `{version, name?, description?}` | the release. Editors and above |
| `POST releases/:rid/cancel` | `{version}` | the release, `cancelled`. Its preview folder is removed and its links answer `410` |
| `POST releases/:rid/items` | `{kind: 'entry', collection, id, version, doc?\|frontmatter?\|source?\|data?\|changes?, releaseVersion?}` | `201 {item, release}`. See "Items" below |
| `POST releases/:rid/items` | `{kind: 'library', libraryId?, version?, item: {kind, name, body, …}, releaseVersion?}` | `201 {item, release}` |
| `POST releases/:rid/media?filename=&alt=&releaseVersion=` | the picture's bytes | `201 {item, release}` |
| `GET releases/:rid/items/:iid` | | `{path, text, current, version}`: the text the item writes, and the file's text on the site now (`null` for a new file) |
| `GET releases/:rid/items/:iid/file` | | the bytes the item writes (for a picture, its image type) |
| `DELETE releases/:rid/items/:iid?releaseVersion=` | | `{release}`. Who added the item, or an editor and above |
| `POST releases/:rid/preview` | | `202 {job, preview}`: build the preview (nothing is done when a fresh one exists or is building) |
| `POST releases/:rid/check` | `{at?, reason?}` | the rules' answer for you, with its `trace` (the dry run) |
| `POST releases/:rid/approve` | `{version}` | the release. The approval is for this exact `key`. The release's maker cannot approve it (`422`), and only someone whose approval a `publish-release` rule would count may (`403` otherwise; a release says `canApprove`) |
| `POST releases/:rid/schedule` | `{version, publishAt}` | the release, `scheduled`. Its preview starts building, as of `publishAt` |
| `POST releases/:rid/unschedule` | `{version}` | the release, `open` |
| `POST releases/:rid/publish` | `{version, reason?}` | `202 {job, release}` |
| `POST releases/:rid/rollback` | `{reason?}` | `202 {job, release}` |

### Items

What goes into a release is checked when it is added, the way a save, a Library change or an upload would be. Nothing
is written to the repo then. The item's bytes are kept in `<dataDir>/releases/<rid>/<iid>` (mode 0600).

- **Entry.** The item is the entry's saved text, or the sent changes applied over it, with `draft` and `publishAt`
  cleared. So a draft goes live with the release, and a live page's new words wait in the release instead of going on
  the site.
  - It needs the right to edit and to publish that entry (`403`).
  - It goes through the same checks as a save: the unsafe-link rule, raw HTML, page code, locks (`423`), synced
    Library copies, the address (`422 moves`: use Move), and the site's `validate`.
  - Lock changes are stamped with who changed them and when, as a save does.
  - `protected` is changed only through Protect (`422`).
  - A live page sent as it already is gives `422 nothing`.
  - `version` is the entry's version. A stale one gives `409`.
- **Library item.** The file the Library would write for the item, new or changed. Editors and above only.
  - A synced item is refused (`422 synced`). Changing it rewrites every page that uses it, so it goes live on its
    own, from the Library.
  - A personal snippet is refused: a release holds the site's shared items only.
- **Picture.** Prepared exactly as an upload is: sniffed (never an SVG, `415`), an iPhone photo turned into a JPEG,
  then re-encoded.
  - Its name in the media folder (`<media.dir>/<year>/<month>/<name>.<ext>`) is reserved for it. An upload in the
    meantime takes the next free name.
  - It enters the media library, with its alt text, when the release goes live.

- **Added by an AI agent** (docs/API-MCP.md, `add_to_release`). Entries only, as above, as the token's person. A
  scheduled release refuses it: `409 scheduled`, "“Name” is scheduled: it goes live by itself at its time, so an AI
  agent cannot add to it. Add to a release that is not scheduled; a person schedules it." This is checked when the
  add starts and again after the entry's checks. The item keeps `meta {via: 'mcp', tokenId, tokenName}`.

Adding an item for a file the release already writes replaces that item. `releaseVersion` is optional on these
routes, so several people can add items at once. When sent, it is checked.

### Publishing

`POST releases/:rid/publish` does these steps, in order:

1. **The promotion rules** decide: `{action: 'publish-release', from: 'release', to: <this environment>, files: the
   items' paths}`. The answer must be `allow`. Approvals and checks count only for the release's current `key`. A
   refusal is `403 {error: 'rule', rule, words, missing}` and is audited as `release.publish` with `ok: false`.
2. **The publish rules** run on each entry. A blocking finding gives `422 blocked {rules}`.
3. **Inside the repo lock**, every file is compared with the site.
   - A file that changed since its item was added gives `409 changed {items}`, naming each one: "“Carol Draft” changed
     on the site since it was added. Add it again to take the latest, then publish."
   - A file that already matches the release is fine.
   - Then what each file held before is saved (for a put-back and a rollback), every file is written, and pictures are
     added to the media library.
   - Everything goes in **one commit**, `Release “<name>”`, by the person who published it.
4. **A job** (`release`) runs:
   - the site's checks on every entry;
   - the build, built as of the release's time (below);
   - the build check (verify);
   - the deploy, and the after-deploy hooks.

   On success the release is `published`, editors get the `release.published` alert, and its preview folder is
   removed. On failure, every file the release wrote and nobody has changed since is put back in one more commit,
   `Put back the release “<name>”: the publish failed`. The live site is unchanged. The release is `open` again with
   `error`, and whoever published it hears why.

**Built as of.** The build runs with `MARKSTAGE_BUILD_TIME` set to:

- `publishAt`, for a scheduled release, even when the scheduler runs late;
- the preview's own build time, for a release published by hand while its preview is fresh;
- now, otherwise.

So the published build is the preview's build, byte for byte.

**Scheduled.** `schedule` asks the rules as of `publishAt`. A freeze at that time, or hours a rule does not allow,
refuses it now (`403`). A rule needing an approval or checks may still be scheduled; it needs them by its time. The
scheduler (every `scheduler.intervalSeconds`) publishes each release that is due. It acts as the person who scheduled
it, with that person's role as it is then, and asks the rules again. When it is refused (a freeze that began
since, a right that person lost, a rule removed, a file changed, a publish rule), nothing is written and the release
**stays `scheduled`**, with `blocked` naming why and the rule. The person who scheduled it gets the `release.blocked`
alert ("The release “Name” was due at … and is blocked: … It stays scheduled and goes out as soon as nothing stops
it; or unschedule it."), and it is audited as `release.blocked` with the rule's id. `release.blocked` and
`release.publish` list the items an AI agent added as `detail.mcpItems: [{rel, title, token}]`. The next ticks try again; the
same reason is not said twice, a new reason is. Once nothing stops it, the next tick publishes it, still built as of
`publishAt`, and audits `release.unblocked`.

**Rollback.** `rollback` asks the rules with the action `rollback`; the starter rules allow owners and
administrators. It puts back every file the release wrote that nobody has changed since. Files changed since are
listed in the job log and left alone. Pictures the release added leave the media library. All of it is one commit,
`Roll back the release “<name>”` with the reason, followed by a build and a deploy. On success the release is
`rolled-back`. If the build or deploy fails, the release's files go back into the repo, so the repo matches the live
site again.

**A restart during a publish.** The job is marked failed when the server starts again (jobs.mjs). The release says
so in `error` and is `open`. Check the site, then publish it again.

### The preview

A preview is built in `<dataDir>/releases/builds/r_<rid>/`, like a branch preview: a detached worktree of the commit
the site is at, the release's files written over it, `node_modules` linked, then the site's build command run with
`MARKSTAGE_BUILD_TIME`. That time is `publishAt` when scheduled, else the time of the build. After the build, the
site's checks run on each entry; their result is the release's `checks`, which the rules read. The repo and the live
site are never touched.

A preview goes stale when the site's commit or the release changes; `preview.stale` and `preview.words` say which,
so the editor can show it. A stale preview is not what would go live. A new one is built when it is asked for:
`POST …/preview`, a schedule, or a share link's next view. Folders nothing shows any more are removed by the
scheduler's sweep: a release no longer open, or a draft whose links have all ended.

## Share links

Link: `{id, release, collection, entryId, label, state: active|expired|revoked, createdBy, createdAt, expiresAt,
revokedAt, revokedBy, views, lastViewAt}`.

| Method + path | Body | Answer |
|---|---|---|
| `POST share-links` | `{release}` or `{collection, id}`, `days?` (default `share.days`, 7; at most `share.maxDays`, 30), `label?` | `201 {link, url}`. `url` (`<share.origin>/share/<token>`) is shown this once: only the token's hash is kept |
| `GET share-links?release=` \| `?collection=&id=` | | `{links, on}` (`on`: share links are set up on this server) |
| `DELETE share-links/:lid` | | `{link}`, `revoked`. Who made it, or an editor and above. Audited as `share.revoke` |

- **Who shares what:**
  - a release, while it is `open` or `scheduled`: editors and above;
  - a draft: anyone who can edit it. A live entry gives `422`: share its address on the site instead.
- **The token** is 32 random bytes (base64url). Only its SHA-256 hash is stored.
- **Set up:** without `share.origin` in config.json, a link cannot be made (`409 not-set-up`, in words), and
  without `verify.public` there is no build to show.

### On the share origin

Share links are served by their own listener (`share.port`, 18251) at their own origin (`share.origin`). That origin
is never the CMS's, the preview's or the site's, because the site's own scripts run there.

| Request | Answer |
|---|---|
| `GET /share/<token>` | `303` to the link's page (a release's first entry, or the draft's address), with a cookie for that link alone. `404` no such link; `410` expired, turned off, or nothing to show any more (the release went live or was cancelled; the draft is live or gone) |
| `GET <site path>` with the cookie | the file from that link's build; the build's `404.html` (`404`) for a missing page. `503` "Preparing this preview" while it is built; that page reloads itself (`Refresh: 3`) |
| `GET <site path>` without the cookie, or with a forged one | `403` "Not available to you" |
| `GET /robots.txt` | `User-agent: * / Disallow: /`, whatever the build has |
| Any other method | `405` |
| Another `Host` | `421` |
| More than 30 requests to `/share/…` in a minute from one address | `429` "Too many tries", `Retry-After: 60`; audited once as `share.limited`. Pages under a link's cookie are not counted |

**The cookie:**

- `ms_share=<link id>.<expiry>.<HMAC>`, signed with a key kept in the database;
- `HttpOnly; SameSite=Lax; Path=/`, and `Secure` on https;
- it lasts as long as the link.

The token is in the address only for the first request: after the `303` the address bar, history and any `Referer`
show the page's own path. A browser holds one link's cookie at a time; opening another link replaces it.

**Every answer** has these headers:

- `X-Robots-Tag: noindex, nofollow, noarchive`;
- `Cache-Control: no-store`;
- `Referrer-Policy: no-referrer`;
- `X-Content-Type-Options: nosniff`;
- `Content-Security-Policy: frame-ancestors 'none'`;
- `Cross-Origin-Opener-Policy: same-origin`.

Only the files of that link's build are served. A path out of it (`..`, encoded or not, or a symlink) is `404`.
Nothing else is served: no API, no editor, no other link.

**Audit:**

- `share.create`;
- `share.open` (the token was used);
- `share.view`, once per page (every HTML answer, with its path), which also counts the link's `views`;
- `share.refused` (a `410`, with why);
- `share.revoke`;
- `share.limited` (an address went over 30 tries a minute; once per minute it stays over).

The viewer is recorded as "share link", with the address and browser.

**The token is never written down.** The audit names a link by its id, never its address. The share listener's own
error log writes `/share/[link]` in place of a token. The nginx example (`deploy/nginx/production.conf`) logs the
share host and the http redirect with a format that writes `/share/[link]` in the request line and the referrer,
and keeps only critical errors for that host (nginx puts the request line into its error entries and cannot rewrite
them). The only trace of a token in the data folder is its SHA-256 hash.

## Server config

```json
"share": { "origin": "https://share.example.com", "port": 18251, "days": 7, "maxDays": 30 }
```

- **`origin`** is an origin only, and must be https unless it is a loopback address in development. It must differ
  from `publicOrigin`, `preview.origin` and the site hosts. It is off (`null`) by default.
- **`port`** must differ from the server's and the preview's.
- **`days`** is how long a new link lasts. It runs from 1 to `maxDays`, and `maxDays` from 1 to 365.

The nginx host is in `deploy/nginx/production.conf` ("share links"). It is GET and HEAD only, with no access log,
because a link's first address holds its token.

## The rules

The rules gain the action `publish-release` and the place `release` (docs/API-ENV.md "Rules"). The starter rules add:

- `releases` "Editors and above publish releases": `{who: {roles: [owner, administrator, editor]}, action:
  [publish-release], from: [release], effect: allow}`.
- The freeze rule now covers releases too. It is `owner-freeze`, "Nobody puts changes live on production during a
  freeze the owner set", with `action: [promote, publish-release]`.

A site whose rules file was saved before this change has neither. A release there is refused, in words ("No rule lets
… publish-release from release to production"), until an owner or administrator adds a rule, in Settings →
Promotion rules or `PUT env/rules`. The `starter` in `GET env/rules` shows the new rule to copy. `what` filters work
on a release's paths like a plan's: for example, "releases may only change content".

## Alerts

- `release.published`: a release went live or was rolled back. Owner, administrators and editors.
- `release.blocked`: a scheduled release's time came and something stops it; it stays scheduled. Sent to the
  person who scheduled it, once for each new reason.

A failed publish or preview build is `publish.failed`, sent to whoever started it.

## Proof

Server tests in `packages/server/test/releases.test.mjs` and `share.test.mjs` run against a real server, a real git
repo, and the fixture site's real build and deploy commands (`test/release-site.mjs`: a page per live entry carrying
the time it was built as, the Library, the pictures). These are the five proofs asked for:

| Proof | Test |
|---|---|
| A scheduled release publishes on time | "a scheduled release goes live at its time, not before…". One second before its time, the tick does nothing and the live site does not have the page. A minute after, it publishes: one commit, and the live page built as of `publishAt`, not as of the late tick |
| The release preview is the published build, byte for byte | The same test keeps a copy of the preview's build, made when the release was scheduled. The site's commit is pinned: the preview's `head` is the commit then, and after the publish the release's commit sits directly on it (`HEAD^`). Every file under the site's `dist` (the pages, the picture, the Library list, the site's script) has the same SHA-256 as in that copy, with no file more or less |
| A preview goes stale when main moves | "a preview goes stale, in words…". Another commit on the site: `fresh: false`, `stale: 'site'`, and the words above. A change to the release as well: `both`. Built again: fresh on the new commit. Then only the release changed: `release` |
| A rule deny blocks a release | "the rules: a deny stops a publish and a schedule…". `403 rule`, with the rule's name in words. Audited with `ok: false`. The repo is unchanged. A freeze at the scheduled time refuses the schedule |
| Checked again at its time, as who scheduled it | "at its time, as who scheduled it…". Allowed when scheduled; then the owner sets a freeze from now. At its time: still `scheduled`, `blocked.rule` is `owner-freeze`, the repo unchanged, one `release.blocked` alert and audit. Two more ticks: no more alerts. The freeze lifted but the scheduler made an author: blocked again, "No rule lets …", a second alert. The right back: the next tick publishes it, built as of `publishAt` |
| A revoked link gives 410 | "a link turned off answers 410…": both at `/share/<token>` and on every page, with noindex. Audited as `share.refused` and `share.revoke` |
| An expired link gives 410 | "an expired link answers 410…" (the server clock moved two days; links last 1 to 30 days) |
| `/share/` is rate limited | "tries at /share/ are limited…": 30 wrong tokens answer `404`, the 31st `429` with `Retry-After: 60`, a real link too while it holds; `share.limited` audited once; a minute later the link opens |
| A token is nowhere but as its hash | "a token is nowhere in the data folder…": one more link is made, opened, two pages seen and turned off; then every file under the data folder (the database with the audit and the job logs, its WAL, the preview builds) is read as bytes and holds none of the tokens made in the file; each token's SHA-256 is in `share_links`. "an error while a link is opened…": the lookup made to fail with the address in its message; the listener's error log says `/share/[link]` and never the token |
| A link follows the site | "the site moves under a link…": a link's page is built and seen; another commit goes live on the site; the next page answers "Preparing this preview" (the old build is not served), then the new page is there with the release on top |

They also cover:

- four kinds of change in one commit, with none of it in the repo before;
- an upload taking another name than the one a release reserved;
- a file changed on the site being named and stopping the publish;
- an approval (never the author's own, cancelled by a change);
- a failed build putting every file back in one commit;
- a rollback taking a release off the site and out of the repo;
- the checks on what goes in;
- the share origin: no API, no writes, no path out of the build, no forged cookie, no other host;
- a draft's link following its edits, then answering `410` once the draft is live;
- the sweep removing a preview folder nothing shows.

What an AI agent adds (`packages/server/test/mcp-roles.test.mjs`): into an open release with `meta.via`; a scheduled
release refused in words, also when it is scheduled during the add; `mcpItems` in `release.blocked` and
`release.publish`.

In a browser, `packages/server/e2e/share.e2e.mjs` (Playwright, Chromium) opens a link with no account. While the
preview builds, it gets the "Preparing" page, which reloads itself. Then it sees the draft: the token has left the
address bar, the site's own script has run, the cookie is not visible to scripts, and each view is audited. After the
link is turned off, the next load answers `410` "This link was turned off". The browser is closed in `after`.
