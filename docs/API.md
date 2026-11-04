# Markstage API (contract)

The editor (`packages/editor`) and the server (`packages/server`) both follow this file. Dev mode
(`packages/astro`, localhost only) implements the same routes without sign-in. Changes go through the lead.

## Conventions

- **Prefix** `/markstage/api/`. All paths below are relative to it. Bodies and answers are JSON
  (`Content-Type: application/json`) unless a route says otherwise. Every answer has `Cache-Control: no-store`.
- **Ids are opaque.** `:c` is a collection id from the site config (`posts`, `pages`, ...). `:id` is an entry id,
  which is the file name without extension and matches `^[a-z0-9][a-z0-9-]{0,99}$`. Users, sessions, jobs, media,
  snippets, templates and trash items have random ids (`u_…`, `s_…`, `j_…`, `m_…`, `sn_…`, `t_…`, `tr_…`). No path,
  email or secret ever goes in a URL; secrets (setup codes) are typed by the person, never put in a link.
- **Session**: an httpOnly cookie `__Host-markstage` (Secure, SameSite=Strict, Path=/). The client never reads it.
- **CSRF**: every request that is not GET/HEAD needs the `Origin` header equal to the server's public origin, and
  (once signed in) `X-CSRF-Token: <csrfToken>` from `GET auth/me` or the login answer. The token changes at
  every sign-in. Routes marked *(pre-auth)* need the Origin check only.
- **Optimistic concurrency**: every entry answer carries `version` = sha1 of the file text (hex). Every write to an
  entry sends the `version` it started from. If the file changed since, the answer is
  `409 {error:'conflict', message, version:<current>}` and nothing is written.
- **Errors**: `{error, message}` with a stable code. `400 bad-request`, `401 unauthorized` (no or expired session),
  `403 forbidden` (signed in, not allowed), `404 not-found`, `409 conflict`, `413 too-large`,
  `415 unsupported-type`, `422 invalid` (with `fields: {name: message}`), `423 locked` (account lockout with
  `retryAfter` seconds, or a save that moves, deletes or changes a locked block, with `blocks`: see "Locks"), `429 rate-limited` (`Retry-After` header), `500 server`, `503 unavailable`.
  A `message` is plain words for the writer; `detail` (optional) is for logs.
- **Times** are ISO 8601 strings in UTC (`2026-10-28T14:05:00.000Z`).
- **Lists** take `page` (1-based) and `perPage` (default 50, max 200) and answer `{items, total, page, perPage}`.
- **Roles** (`owner`, `administrator`, `editor`, `author`, `contributor`) and what each may do: docs/API-PERMISSIONS.md.
  Entries come with a `can` object so the editor greys out what the user may not do; the server checks every
  action again.

## Auth

| Method + path | Body | Answer |
|---|---|---|
| `GET release` | | `{line}` for anyone (the footer's release line); `{version, build, builtAt, commit, line}` once signed in |
| `GET auth/me` | | `{user: User\|null, csrfToken\|null, setupRequired: bool, devMode: bool, server: {version, commit}\|null}`; `server` (what Markstage runs: the server package's version and the install's commit, 12 hex, or null) only when signed in |
| `POST auth/setup` *(pre-auth)* | `{setupCode, email, name, password}` | `201 {user, csrfToken}` + cookie. Only while no owner exists; the code comes from `markstage-server setup-code` |
| `POST auth/login` *(pre-auth)* | `{email, password}` | `{user, csrfToken}` + cookie, or `{twoFactorRequired: true, challenge}` when 2FA is on |
| `POST auth/login/2fa` *(pre-auth)* | `{challenge, code}` or `{challenge, recoveryCode}` | `{user, csrfToken}` + cookie |
| `POST auth/logout` | | `{ok: true}`, session revoked server-side, cookie cleared |
| `POST auth/accept-invite` *(pre-auth)* | `{email, setupCode, password, name?}` | `{user, csrfToken}` + cookie |
| `POST auth/password` | `{currentPassword, newPassword}` | `{ok, csrfToken}`; all other sessions of the user are revoked, this one rotated |
| `GET auth/sessions` | | `[{id, current, createdAt, lastSeenAt, ip, userAgent}]` (own sessions) |
| `DELETE auth/sessions/:sid` | | `{ok}` revoke one of the own sessions |
| `POST auth/2fa/setup` | `{password}` | `{secret, otpauthUri}` (pending until enabled; show as QR + text) |
| `POST auth/2fa/enable` | `{code}` | `{recoveryCodes: [10 strings]}` shown once |
| `POST auth/2fa/disable` | `{password, code}` | `{ok}` |
| `POST auth/2fa/recovery-codes` | `{password, code}` | `{recoveryCodes}` (old ones stop working) |

- Login failures always answer `401 {error:'unauthorized', message:'Wrong email or password.'}` (same words for an
  unknown email). Too many tries: `429` (per IP) or `423` (per account, progressive). The 2FA `challenge` lives 5
  minutes and allows 5 codes. A TOTP code is accepted once (replay refused).
- `User` = `{id, email, name, role, authorSlug, twoFactor: bool, disabled: bool, createdAt, lastLoginAt}`.
  `authorSlug` links the user to the site's author entry (the value in an entry's author field).
- Passwords: 12 to 256 characters, not the email, not a common password (`422` with `fields.password`).
- Single sign-on: `GET auth/sso` (the providers), `GET auth/sso/:id/start` and `…/callback` sign a person in
  through the server's OpenID Connect providers (config.json `sso`); with `passwordLogin: false` only the owner signs
  in with a password (`403`): docs/API-SSO.md.

## Users (owner, administrator)

| Method + path | Body | Answer |
|---|---|---|
| `GET users` | | `[User]` (every signed-in user may call `GET users?brief=1` for `[{id, name, authorSlug}]`) |
| `GET users/:uid` | | `User` |
| `POST users` | `{email, name, role, authorSlug?}` | `201 {user, setupCode}` the invite; the code is valid 72 h, shown once |
| `PATCH users/:uid` | `{name?, role?, customRole?, authorSlug?, disabled?}` | `User`. Disabling revokes the user's sessions. `customRole` (a custom role's id, or null) makes `role` its base; a `role` given alone takes a custom role away (docs/API-ROLES.md) |
| `POST users/:uid/reset` | | `{setupCode}`: password cleared, sessions revoked, user sets a new one via `accept-invite` |
| `POST users/:uid/2fa/reset` | | `{ok}` turns off the user's 2FA (lost phone) |
| `POST users/:uid/revoke-sessions` | | `{ok, revoked: n}` |
| `GET users/:uid/sso`, `DELETE users/:uid/sso/:provider` | | the person's single sign-on links, and one undone (docs/API-SSO.md) |
| `DELETE users/:uid` | | `{ok}`; their entries keep their author |

Only the owner can grant or take away `owner`/`administrator`, or touch the owner's account. There is always
exactly one owner (`PATCH` that would leave none is `409`). Nobody can delete or disable themselves.

## Collections and entries

Collections come from the site's `markstage.config` (`@markstage/core/site-config`; the same file the editor reads in
dev): `url` and `group` there may be functions of `{id, data}`, where `data` is the frontmatter or JSON. An entry's
own URL field (`fields.url`) wins over `url`. A url or group function that throws gives `url: null` / no group for
that entry, logged on the server. A site without a markstage.config lists collections in the server's config.json,
with `url` as a template (`/blog/{slug}/`).

**Field schema.** The site config may say `schema: { keystatic: './keystatic.config.ts', options }` (`options` as
for core's `keystaticSchema`: `rich`, `multiline`, `url`, `collections`, `roles`). Each JSON collection gets the
Keystatic collection with the same folder (else the same name). Its `changes` saves then parse with
`{schema, policy: keystaticPolicy}`: inserted values take the schema's key order, empty values are left out as
Keystatic leaves them out, and the file stays byte-identical to Keystatic's own Save (proven on the real site: 41
of 41 pages after an insert). Without core's JSON engine such a save answers 503 instead of writing a
non-Keystatic file. Keys the server owns (`draft`, `publishAt`, `protected`) are kept even though Keystatic's
schema may not list them; a site that edits these files in Keystatic too should add them to its schema
(`fields.ignored()`), or a Keystatic save drops them.

`GET collections/:c/schema` → `{entry: Field}` (core's schema descriptor: `{type: 'object', fields}`, with
`array`, `conditional`, `text`, `select`, `image`, `relationship`… fields). `404 {error: 'no-schema'}` when the
collection has none.

`GET collections` → `[{id, label, format: 'md'|'json', hasStatus: bool, counts: {all, draft, scheduled, published,
trash}, can: {create}}]`.

`GET collections/:c/entries` → list. Query (all optional, all reflected in the editor's URL):
`status=draft|scheduled|published`, `author=<authorSlug>`, `tag=<tag>`, `q=<search in title, slug, excerpt>`,
`group=<groupId>` (the section or topic, docs/CONFIG.md `groups`), `since=<ISO date>` (changed at or after it),
`attention=no-description|no-title|alt-text|links|not-translated` (the lists screen's "Needs attention": only what
the server already has, the search title and description from the fields, the publish rules' image and link
findings, and the tracked locales' words; an unknown one is `400`),
`sort=<column>` or `-<column>` (newest or Z first) for any column: `title`, `date`, `modified`, `publishAt`, `status`
(draft, scheduled, published), `author`, `url`, `group`, `id`, `words` (default `-modified`; an unknown one is `400`). Text
sorts ignore case and put numbers in order; ties are in id order both ways. `page`, `perPage`.
Item = `{id, title, status, author, tags, date, modified, publishAt, url, version, excerpt, group?, groupId?, words?, parent?}`.
`groupId`: the group the entry is in (its collection's `groups.field`, docs/CONFIG.md `groups`), only for a collection
with groups; null when it names none. `locales: [{code, done}]` is there when the site tracks locales with their own
title or description ("Translation status"): `done` is that locale having its words (or sharing the source's language,
where none means "the same"); outdated words are not told here (that needs git history: the translations list).
`words`: an article's (Markdown) length, the words of its text without the frontmatter, HTML tags or Markdown marks. `group` is
there only when the site's markstage.config gives the collection a `group({id, data})` function and it returns a
value (on the pilot site: the cluster title). The editor's search groups results by it. The answer also has `counts`
(per status, for the filter chips, ignoring the `status` filter) and `facets: {authors: [{name, count}], tags: [{name,
count}]}`: every author and tag in the collection, whatever the filters, for the lists screen's choices.

`GET collections/:c/entries/:id` → `Entry`:

```
{ id, collection, format, version, status, url, title,
  frontmatter,            // md: the YAML frontmatter as an object
  doc,                    // md: the editor document from core mdToDoc(text).doc
  data,                   // json: the parsed JSON
  autosave: {savedAt, baseVersion} | null,   // the caller's own private autosave, if newer than the file
  can: {edit, publish, delete, rawHtml} }
```

| Method + path | Body | Answer |
|---|---|---|
| `POST collections/:c/entries` | `{id?, title, frontmatter?, doc?, source?, data?, templateId?}` | `201 Entry`. `id` defaults to a slug of the title; `409 {error: 'id-taken'}` if taken. The site's `newEntry` defaults apply (docs/CONFIG.md `newEntry`, through core's `newEntryFrontmatter`): the title and slug first, then the asked values (`frontmatter`; `data` for JSON), then the defaults, which never override those, so a new post has what the site's schema requires (a date, a canonical). New entries in a status collection start as `draft`. An article (Markdown) always gets an author and a date; a JSON entry only when its collection has them (the site names the field in `fields`, its schema has it, or the template or `data` holds it), so a page gets neither. The author is the one an editor gives in `frontmatter`, else the creator's author name, else the collection's `defaultAuthor` (site config), else `422 {error: 'no-author'}` (link the account to an author). Authors and contributors always get their own |
| `POST collections/:c/entries/:id/duplicate` | `{id?, title?}` | `201 Entry` (a draft copy, author = caller for authors/contributors) |
| `PUT collections/:c/entries/:id` | md: `{version, doc?, frontmatter?, message?}`; json: `{version, changes? \| data?, message?}` | `{ok, version, changedBlocks, commit}` |
| `PUT collections/:c/entries/:id/autosave` | `{baseVersion, doc?, frontmatter?, source?, data?}` | `{savedAt}` private to the caller, never the live file |
| `GET collections/:c/entries/:id/autosave` | | `{savedAt, baseVersion, doc?, frontmatter?, source?, data?}` or `404` |
| `DELETE collections/:c/entries/:id/autosave` | | `{ok}` |
| `DELETE collections/:c/entries/:id?version=` | | `{ok, trashId, job?}` file removed in a commit; a published entry also gets a rebuild job |
| `GET collections/:c/entries/:id/links-in` | | `{entries: [{collection, id, title, status}]}`: the entries that link here (found like a move finds the links it rewrites: link marks, hrefs in HTML, address fields, any locale, path or absolute URL), to warn before a delete or an unpublish |
| `GET trash?collection=` | | `[{trashId, collection, id, title, url, deletedAt, deletedBy}]`: `url` is the address it had |
| `GET trash/:trashId/links-in` | | `{url, entries: [{collection, id, title, status, url}]}`: the entries that still link to its old address, shown before "Delete for good" (editors and above, or the author of their own) |
| `POST trash/:trashId/restore` | | `201 Entry` restored as a draft (`409` if the id is taken again) |
| `DELETE trash/:trashId` | | `{ok}` purge (administrator+) |

- **Save** (`PUT`): md: the server runs `docToMd(doc, currentText)` (surgical), then applies `frontmatter` key
  changes (`{key: value}`; `null` removes a key) surgically; json: `changes` is a list of operations applied in
  order by the core JSON engine (`JsonEntry`: only the changed characters move, formatting kept): `{path, value}` or
  `{op:'set', path, value}`, `{op:'remove', path}`, `{op:'insert', path:'sections', index, value}`,
  `{op:'move', path:'sections', from, to}`, `{op:'duplicate', path:'sections', index}`. Paths are dotted
  (`sections.3.value.heading`); `__proto__`, `prototype` and `constructor` segments are refused. `data` (a whole
  object) is also accepted but rewrites the file. The file is written and
  committed with the signed-in user as git author. `changedBlocks` = blocks the save rewrote (0 = byte-identical,
  and then nothing is committed). `commit` = the new commit sha or `null`.
- **The address changes only through Move.** A save of any kind (`PUT`, source, publish, revision restore, find and
  replace, bulk actions, Categories and tags) that would change the entry's page address (its slug, or a field the
  address is made of, such as a page's `uri` or `parent`) is `422 {error: 'moves', message, from, to}`, and in a
  change across the site that entry is skipped with the same reason. Use the move routes below, which rewrite the
  links and record the redirects.
- **Links**: for every role, any `href`, `src` or `url` attr in the document (link marks, images, box attrs at any
  depth), in the frontmatter and in JSON entries must be http, https, mailto, tel or relative; anything else
  (`javascript:`, `data:`, `vbscript:`, `file:`, ...) is `422` with `urls: [...]`. Snippets and templates too.
- **Collections without status** (pages, settings): `PUT` saves and commits; the next build ships it. `publish` on
  them is the same "Update" as for posts: save (if a body is given) + checks + build + deploy, one job.
- **Saving a published entry** changes what the next build ships, so it needs the publish right on that entry; the
  editor's "Update" button uses `publish` (below) which saves and deploys in one job.
- `draft`, `publishAt` and `protected` are not set by `PUT` or a source save (`422`): they change only through the
  publish and protection routes. Non-editors cannot change the author field away from themselves (`403`).
- **Locks** (docs/OPERATIONS.md "Locks"; core's `@markstage/core/locks`): every save path (`PUT`, source, publish,
  revision restore, bulk, compat) compares the stored entry with the saved one. A locked block that was moved,
  deleted or changed is `423 {error: 'locked', message, blocks: [{what, path, type, label, by, message}]}`, for
  every role, and nothing is written. `what` is `move`, `remove`, `edit` or `layout`; `by` is `'the site'` (the
  site's rule, markstage.config `locks`) or `'an editor'` (a lock stored in the entry); `message` is the sentence to
  show ("The FAQ box is locked by the site: it can't be deleted."). Other blocks may still be moved past a locked
  one; a move is a change in the order of the move-locked blocks among themselves. Where locks are stored:
  - pages (JSON): `_lock: {move?, remove?, edit?}` on a section or list item, and `_lock: {layout?, edit?}` at the
    top of the entry (`layout`: nothing added, deleted or reordered; `edit`: read-only). The site's rules name
    sections by their `discriminant`.
  - articles (Markdown): frontmatter `locks: [{heading, move?, remove?, edit?}]` for the section under a heading
    (to the next heading of the same or a higher level), and `locks: [{box, move?, remove?, edit?}]` for every run
    of that box (by block name; a run of the same box counts as one). A box's own `lock` attribute
    (`data-lock="move remove"`) is read too, where a block pack keeps it. The site's rules name boxes by block name.
  - `true` locks that action; `false` lifts the site's rule for it on this entry only ("Unlock on this page", e.g.
    `_lock: {move: false, remove: false}` on the home hero, or `locks: [{box: faq, remove: false}]`). A rule binds
    unless a marker on either side of the save lifts it. A page section lifted and deleted in the same save reads
    as a plain delete (its marker leaves with it): lift it first. An article's box lock outlives the box, so there
    it may be lifted in the same save.
  - `by` and `at` on a marker say who set it and when. The server writes them on every marker a save adds or
    changes (the person's name, the time to the second), whatever the editor sent.

  A lock binds when both the stored and the saved entry have it, so an editor may take one off and change the block
  in the same save. Adding, taking off or changing a lock needs editor or above (`403` naming the block); each one
  is audited as `entry.lock` or `entry.unlock` `{commit, change, block, path, from, to, rule?}` (`rule: 'site'` when
  it lifts a site rule or puts it back; a change that both lifts and adds is `entry.lock` with `change: 'change'`). `_lock` and `locks` cannot be set
  by bulk actions. Without `@markstage/core` installed, a save of an entry with locks (or of a collection the site's
  rules cover) is `503 locks-unavailable`, never let through.
- **The site's rules** (Settings → Locks): `GET site/locks` (anyone signed in) →
  `{rules: {pages: {<type>: {move?, remove?, edit?}}, articles: {…}}, kinds: {pages: [{type, label}], articles:
  [{type, label}]}, version, source: 'config'|'file', file}`. `kinds` are the section types the site's pages use
  (`discriminant`) and the boxes its block packs define, so a rule can be added for any of them. These are the rules
  saves are checked against now: the editor reads them here, not from its build. `PUT site/locks {rules, version}`
  (owner, administrator; `rules` in either form, `{hero: ['move']}` or `{hero: {move: true}}`) → `{rules, version,
  source: 'file', commit}`; `409` on a stale `version`, `400` on a wrong shape (in words), `403` below
  administrator, `503` without core. The rules are written to `markstage.locks.json` at the site's root (list
  form, keys sorted), committed as "Lock rules for every page" with the person as author, and audited as
  `site.locks {commit, from, to, was}`. From then on the file wins over markstage.config `locks` (code is never
  rewritten from a screen); the same rules again commit nothing.

### The light index

| Route | Answer |
| --- | --- |
| `GET index` | `{items: [{collection, id, title, url, status, modified, group?, held?}]}`: every entry of every collection, with only what the editor's shell needs (the palette, Home's Recent, the link field's targets). From the server's content index (docs/ARCHITECTURE.md), so it costs no file reads; answered with an `ETag` and `Cache-Control: private, no-cache`, and a repeat with `If-None-Match` is a `304`. |

### Move (rename) an entry

`POST collections/:c/entries/:id/move` `{version, newId, newSlug?}` → `200` (draft) or `202` (live, with a build and
deploy job) `{id, version, url, oldUrl, linksUpdated: [{collection, id}], redirects: [{from, to}], repointed: [{from,
to}], commit, job}`.

- One commit: the file gets its new name. Its slug follows when it was the same as the old name, or is set to
  `newSlug`. Every entry that links to the old address then links to the new one, and the site's redirects hook
  records old → new.
- Links are rewritten surgically, through core:
  - frontmatter through `setFrontmatter` (only the changed keys);
  - the Markdown body through the doc (only the changed blocks);
  - JSON through the JSON engine (only the changed values).
- A link is a string value that is the old address in any locale (`/x/`, `/en-us/x/`), with or without the
  trailing slash, as a site path or an absolute `siteUrl` URL, keeping any `#hash` or `?query`. An `href` inside
  HTML strings counts too. Visible text (`text` values) is never changed.
- Redirects: the site's redirects hook (below, "Redirects") gets `{"redirects": [{from, to}, …]}`: one pair per
  locale, as site paths. The files it changes go into the same commit. When the hook can list, no chain or loop is
  made: redirects that pointed at the old address now point at the new one (`repointed: [{from, to}]` in the
  answer), and a redirect away from the new address is removed (a page is there again). If the hook fails: `502
  {error: 'redirects-failed'}`, nothing is moved, and its own changes are undone. With no hook, no redirects are
  written.
- Rights: as for a save, and a live entry (published, or any entry of a collection without status) needs the
  publish right. `409 {error: 'id-taken'}` if `newId` exists, `409 {error: 'address-taken', url, entry}` if the new
  address is another entry's (in any collection), `409` on a stale `version`, `422` for a bad name, and `validate`
  runs on the renamed entry.
- If the job fails, every file of the move commit goes back to its text before the move (except a file someone
  changed since, which the log names). The live site keeps the old address.
- The mover's autosave follows the entry to its new id.

### Move many entries at once (the Pages tree)

`POST site/move` `{moves: [{collection, id, version, newId?, newSlug?, parent?, set?: {field: value|null}}], dry?}` (1 to 200) →
`200`, or `202` when a live entry changed (one build and deploy job) `{commit, moved: [{collection, id, from, version,
url, oldUrl}], linksUpdated: [{collection, id}], redirects: [{from, to}], job}`.

- Pages dragged in a tree: a new name (`newId`, `newSlug`, as for one move), and fields to set (`order`, the parent
  or group field the address is made of; never a status key, page code, the title, slug or url field). An entry whose
  address changes moves like one move does: every link to the old address follows and the redirects hook records
  old → new in every locale.
- Pages whose address is a field of their own (`fields.url`, such as `uri`) move by `parent`: the id of the page to
  go under, or `""` (or `"/"`) for the top level; `set` (such as `order`) rides along. The server works out the new
  address (the parent's address and the page's last segment; one sent by the browser is never taken), and every
  page of the same collection under the old address follows, keeping its place below it. Each page gets its own
  redirect in each locale (no prefix rule), and the answer's `moved` lists them all, a page before the pages under
  it. Refused: the home page `/` ("The home page stays where it is."), a page under itself or under a page below
  it, a parent that is missing or moves in the same request, a page below listed on its own ("It moves with “X”,
  the page it is under: leave it out."), and a collection whose addresses come from names (move those by name).
- A page that entries of another collection live under is not moved, by `parent` or by a new name, until they are:
  "5 posts live under /blog/; move them first." Its own collection's pages under it follow only with `parent`.
- `dry: true` makes every check and writes nothing: `200 {dry: true, moved: [{collection, id, from, url, oldUrl}],
  linksUpdated: [{collection, id}], links, redirects: [{from, to}]}`, the same lists the move itself would give
  (`links`: how many entries would have a link rewritten). A refusal is the same `422`. A key a move does not know
  (misspelt, or `dry` put on one move) is refused: "“dry” is not part of a move."
- An old address a page comes back to is not taken: the redirect from it goes, and a redirect to an address that
  moves is pointed at the new one, as for one move.
- In such a collection the list (`GET collections/:c/entries`) gives each entry `parent`: the id of the page whose
  address is the longest one the entry's address starts with (never the home page), or `null` at the top level.
- Every move is checked first (the version, the name, the fields, the rights as for a save, the publish right for a
  live entry whose address changes, the site's `validate`). If any one cannot be made, nothing is written:
  `422 {error: "invalid", problems: [{collection, id, message}]}`. A name another entry has, or another move takes
  or leaves, is refused, and so is a new address that another move in the same request leaves (it would make a
  chain): move those one after the other. A new address another entry has (in any collection), or that two moves
  both go to, is refused too.
- One commit (`Move N entries`), audited as `entries.move`. A failed build or deploy puts back every file of it that
  nobody changed since, like one move.

### Raw source, import, download

| Method + path | Body | Answer |
|---|---|---|
| `GET collections/:c/entries/:id/source` | | `{source, version, format}` |
| `PUT collections/:c/entries/:id/source` | `{source, version, message?}` | `{ok, version, changedBlocks, commit}` same rules as `PUT` (md must still parse; json must be valid JSON) |
| `GET collections/:c/entries/:id/download` | | the raw file, `Content-Disposition: attachment` |
| `POST collections/:c/import` | `{filename, source}` | `201 Entry` a new draft; frontmatter validated (`422`), id from `frontmatter.slug` or the file name |

### Publish, schedule, unpublish (status for a static site)

Status lives in the entry itself, so the site's build decides what is live (see "Site-side contract"):

| status | md frontmatter / json top-level keys |
|---|---|
| `draft` | `draft: true` |
| `scheduled` | no `draft`, `publishAt` in the future |
| `published` | no `draft`, no `publishAt` or `publishAt` in the past |

**Held.** When a scheduled entry falls due and the publish rules stop it (it was edited after it was scheduled), the
scheduler holds it: `draft: true` is added and `publishAt` kept, in a commit by "Markstage scheduler", so the site's
build leaves it out; the server records why. The API still says `status: 'scheduled'`, with `held: {dueAt, reasons}`
on the entry and in lists. Every scheduler run checks held entries again: once nothing stops one, that run clears
`draft` and `publishAt` and puts it live (`schedule.released`); a failed deploy holds it again. Publish (with or
without `anyway`), unpublish or a new schedule ends the hold.

| Method + path | Body | Answer |
|---|---|---|
| `POST collections/:c/entries/:id/publish` | `{version, doc?, frontmatter?, source?, data?, changes?, anyway?}` | `202 {job, version}` save (if a body is given) + clear `draft`/`publishAt` + commit, then checks, build, deploy. A blocking publish rule is `422 blocked {rules}`; `anyway: true` (editor and above, else `403`) publishes past the publish rules (not the site's own checks), audited as `entry.publish.anyway` with the rules passed over |
| `POST collections/:c/entries/:id/schedule` | `{version, publishAt}` | `{ok, version, status:'scheduled', commit}`; the scheduler builds and deploys at `publishAt` (no job now) |
| `POST collections/:c/entries/:id/unpublish` | `{version}` | `202 {job, version}` sets `draft: true` + commit, then build, deploy |
| `POST site/publish` | `{}` | `202 {job}` rebuild and deploy the whole site (editor+) |
| `GET jobs?limit=` | | `[Job]` newest first |
| `GET jobs/:jid?since=<offset>` | | `Job` with `log` from byte `since` (poll every 1-2 s while `queued`/`running`) |

`Job` = `{id, kind: 'publish'|'unpublish'|'delete'|'schedule'|'site'|'protect'|'unprotect'|'move', status: 'queued'|'running'|'succeeded'|'failed',
collection, entryId, userId, createdAt, startedAt, finishedAt, steps: [{name: 'commit'|'checks'|'build'|'verify'|'check: <label>'|'deploy'|'purge'|'indexnow'|'revert',
status, startedAt, finishedAt, exitCode}], log, logOffset, error}`.

**After the deploy** (optional, operator config): `purge` runs the CDN purge command with the changed addresses on
stdin (`{"urls": [...]}`, or `{"all": true}` for a whole-site rebuild or a design change), and `indexnow` sends one
IndexNow POST with them (`{host, key, keyLocation, urlList}`; needs the site's `siteUrl`, skipped for whole-site
changes). The changed addresses are the entry's page in every locale; a move adds the old address and the pages
whose links it rewrote; a scheduled run, every due entry. Both steps are **soft**: the site is live already, so a
failure marks the step `warned` and the job still succeeds (the log says why; the IndexNow key never goes in it).

**Failure rule** (also in SECURITY.md): jobs run one at a time. If the checks, the build or the deploy fail, the
deploy step has not completed, so the live site keeps the previous deploy (the site's deploy command must be
atomic, e.g. upload then switch). The server then makes a **revert commit** that puts the file back to its text
before the job, and stores the attempted text as the user's **autosave** for that entry, so nothing they wrote is
lost and the repo again matches what is live. The job ends `failed` with the log.

When a failed build or deploy names entry files in its output (e.g. Astro's `Location: …/src/content/blog/x.md`),
`error` says which: `The build step failed on posts/x (src/content/blog/x.md). The live site was not changed.`
(up to three entries; otherwise just the step).

### Password-protected pages

| Method + path | Body | Answer |
|---|---|---|
| `PUT collections/:c/entries/:id/protection` | `{version, password}` (4-200 chars) | `{ok, version, protected: true, job}` (`202` + rebuild job when the entry is live) |
| `DELETE collections/:c/entries/:id/protection?version=` | | `{ok, version, protected: false, job}` |

Needs the publish right on the entry. The entry gets `protected: true` (frontmatter or top-level JSON key); the
password is stored as a scrypt hash in the server's data dir, never in the repo. A new password ends every visitor
cookie for the old one. The visitor side runs on the site's own host names (`protectedPages.hosts`), which reach
only these routes (never the CMS API or editor):

- `GET <page path>`: the page from the private build output (`protectedPages.dir`) with a valid page cookie, else a
  password form. Both carry `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`.
- `POST /markstage/unlock` (form fields `path`, `password`; Origin must be the site): `303` back to the page with an
  HttpOnly, Secure, SameSite=Lax cookie scoped to that page's path and signed (HMAC) with a key kept in the data
  dir, valid 12 h. Wrong password: `401` and the form again; rate limit per address, progressive lockout per
  (page, address), and the page for everyone only after `login.accountMaxFailures` misses in an hour. A page
  password is 8 to 200 characters.
- `GET /markstage/page-auth` with `X-Original-URI`: `204` (valid cookie) or `401`, for nginx `auth_request`.

### Revisions (git)

| Method + path | Answer |
|---|---|
| `GET collections/:c/entries/:id/revisions` | `[{sha, author: {name, email}, date, message}]` newest first (`git log --follow`) |
| `GET collections/:c/entries/:id/revisions/:sha` | `{sha, source, doc?, data?}` the file at that commit |
| `GET collections/:c/entries/:id/compare?from=<ref>&to=<ref>&docs=1` | `{from: Side, to: Side, diff}`. A ref is a revision sha, `current` (default `to`), `live` or `autosave:<id>`. `Side` = `{sha, source, version?, savedAt?, deployed?}`; with `docs=1` also `doc` and `frontmatter` (md) or `data` (json), null when it no longer parses. `diff` is git's unified diff, or null when a side is not a commit (an autosave) or has no text |
| `POST collections/:c/entries/:id/revisions/:sha/restore` `{version}` | `{ok, version, commit}` writes the old text as a new commit; a published entry needs the publish right |
| `GET collections/:c/entries/:id/autosaves` | the caller's own autosave history, newest first: `[{id, startedAt, savedAt, baseVersion}]` |
| `GET collections/:c/entries/:id/autosaves/:aid` | `{id, startedAt, savedAt, baseVersion, source, doc?, data?}` the whole text that autosave stands for |
| `POST collections/:c/entries/:id/autosaves/:aid/restore` `{version}` | `{ok, version, commit}` as a revision restore (status and protection kept) |

`:sha` is 7 to 40 hex characters and must be a commit that touched this file.

- **`live`** is the entry at the commit the last successful deploy was built from (recorded by the server after each
  deploy). `source: null` when the entry was not on the site then (a draft, a future post, not there yet), with
  `deployed: false` when this server has never deployed.
- **Autosave history.** Every autosave (`PUT …/autosave`) is also kept as a snapshot, one per person, entry and
  5 minutes (a later autosave in the same 5 minutes updates it), the newest 40 per person and entry. Only their
  author can list, read, compare or restore them (anyone else: 404). A move carries them to the new id.
- **One block or one field back.** The editor restores a single block (or a settings field, or a JSON field) by
  saving the current document with that one part taken from the old version (`PUT …/entries/:id` with `version`
  and `doc`/`frontmatter`/`changes`); the server needs nothing more.

### Before publishing (the publish sheet)

`GET collections/:c/entries/:id/preflight` runs on the saved text and answers:

```
{ version, status,
  validate: {ok, issues, unavailable?} | null,          // the site's validate command (null: none set)
  checks: {ok, results: CheckResult[]},                  // the pre-build checks, as POST …/checks
  afterBuild: [{id, label, blocking}], verify: boolean,  // what runs on the fresh build during the publish
  altText: [{src, where}],                               // images with no alt (alt="" marks decoration and passes)
  links: [{href, where, problem: 'not-live'|'unknown', sure?, target?: {collection, id, title, status}}],
  duplicates: {title: [{collection, id, title}], description: [...]},  // other live pages with the same words
  headings: [{where, message}],                          // a second H1, a skipped level (Markdown entries)
  synced: [{id, name, path?, canReset, message}],        // copies of synced Library items changed here (a 'synced' warn rule too)
  page: {type, frame, checks} | null,                    // the page type's checks (docs/API-PAGE-TYPES.md; a 'pageType' rule per failed one)
  publishRules: {altText, links, duplicates, headings},  // each 'block' | 'warn' | 'off' (operator config)
  rules: [{rule, level: 'block'|'warn', count, message}], blocked: boolean,
  addresses: [{locale, path, url}],                      // the page in every locale (url: null without siteUrl)
  alsoLive: {deployed, entries: [{collection, id, title, by, at, deleted}], media, files} }
```

`alsoLive` is what else the build puts live: the published (or deleted) entries saved since the last deploy, newest
first with who saved them last, plus counts of changed images and other files (net: a file added and removed again
since the deploy is not counted). Before the first deploy from this
server it lists the saves made through Markstage. `GET collections/:c/entries/:id/addresses` answers
`{title, status, addresses}` alone, without running any check (the job screen's live card).

`altText` covers Markdown images, `<img>` in raw HTML and `{src, alt}` objects in the fields (covers, JSON images;
`decorative: true` passes). `links` are links inside the site (relative, or under `siteUrl`) from link marks, raw
HTML and `href`/`url`/`link`/`to`/canonical fields: `not-live` points at a draft, scheduled or protected entry,
`unknown` at no entry and no file in the last build (`verify.public`). Media paths are skipped. The phone check is
the editor's (the preview agent, below).

**Publish rules** (docs/SEO.md section 3). Config `publishRules` sets each rule to `block`, `warn` or `off`; the
defaults are below. A blocking finding makes `blocked: true`, and `POST …/publish` and `POST …/schedule` refuse the
text with `422 blocked` (`{rules: [...]}`, the same verdicts), so nothing goes live around the sheet. A publish that
sends the fixed text in its body is judged on that text.

| Rule | Finds | Default |
|---|---|---|
| `altText` | an image without a description; decorative images pass (figure class `editor.images.decorativeClass`, `alt=""` in HTML, `decorative: true`). A cover (an `image` setting) with no alt written passes when its `altFallback` key (e.g. the title) is filled, as the site draws it | block |
| `links` | a link to a draft, scheduled or protected entry; a link to no page (only a warning when the server has no build output in `verify.public` to look in: `sure: false`) | block |
| `duplicates` | the same search title or description (the settings' `seo` field, else the title and excerpt) as another published entry, case and spaces ignored | block |
| `headings` | a second H1 in the body, or a level skipped (H2 then H4) | warn |

### Content checks

`GET checks` → `[{id, label, blocking, after}]` from the site config.
`POST collections/:c/entries/:id/checks` `{doc?, frontmatter?, source?, data?}` (optional unsaved state) →
`{ok: bool, results: [{id, label, blocking, ok, issues: [{severity: 'error'|'warning', message, line?}], output}]}`.
`ok` is false when a blocking check failed. `publish` runs the same checks and stops on a blocking failure.
A check command gets the entry text on stdin and `MARKSTAGE_COLLECTION`, `MARKSTAGE_ENTRY`, `MARKSTAGE_FILE`
(repo-relative path) in its environment; exit 0 = pass. If it prints JSON `{issues: [...]}` on stdout, those are
shown; otherwise the output is.

**Site validation (`validate`, blocking on every write).** The operator config may name one command the site uses to
say whether it can build an entry (its content schema: required fields, types, enums). It gets the same stdin and
environment as a check. The server runs it inside the repo lock on **create, save (doc, frontmatter, data,
changes), source save, import, duplicate, publish, schedule, unpublish, revision restore and trash restore**, after the server's own guards
and before anything is written or committed:
- exit 0: the write goes ahead.
- non-zero: `422 {error: 'invalid-entry', message, issues: [{severity, message, line?}]}`. `issues` are the
  command's JSON issues, or one issue with its plain output. `message` starts with the first error. Nothing is
  written, no job is queued; the editor shows the issues and keeps the writer's text (autosave).
- did not finish (timeout, default 30 s) or could not start: `503 {error: 'validate-unavailable'}`, nothing written.

So one invalid entry (e.g. a draft missing a required field) can no longer break every later build and the preview.
Autosaves are not validated (they are private and never built).

**Checks of the fresh build (`after: 'build'`).** A check with `after: 'build'` (e.g. `{id: 'hreflang', command:
["node", "migration/verify/hreflang_check.mjs"], after: 'build'}`) does not run before the commit like the others.
It runs in every status job (publish, unpublish, protect, delete, move and scheduled publishes) after the build and
before the deploy. Each changed entry that still exists gets the usual stdin and environment, plus:
- `MARKSTAGE_URLS`: the entry's address in every locale, space-separated (`/x/ /en-us/x/`);
- `MARKSTAGE_DIST`: the build's public folder (`verify.public`).
A blocking one that fails fails the job. Its step is `check: <label>` and the job error names the entry. The
change is reverted, and the live site is not touched.

A structured-data check is one of these too: `{id: 'schema', label: 'Structured data', command: ["node",
"migration/verify/schema_check.mjs"], after: 'build'}` reads each of the entry's built pages (`MARKSTAGE_URLS` under
`MARKSTAGE_DIST`) and prints `{issues: [{severity, message}]}`: the article node's headline and dates against what
the page shows, an image that is in the build, the required properties of each type, every `@id` resolving, no
self-made ratings. Run on its own (`node migration/verify/schema_check.mjs dist`) it checks every built page.

**Every locale copy where its status says (`verify`).** With `verify: {public: 'dist', private: 'dist-private'}` in
the operator config, the same status jobs check the fresh build before the deploy, in a `verify` step. A site emits
all locale copies from one source, so the check covers every locale's path (core's `localePath`, `/x/` and
`/en-us/x/`):

| The entry is | The build must have |
|---|---|
| published | a page in `public` for every locale, and none in `private` |
| protected | a page in `private` for every locale (when `private` is set), and none in `public` (a redirect stub is fine) |
| draft, scheduled, unpublished or deleted | no page in either (a redirect stub is fine) |
| moved: the old address | no page (a `<meta http-equiv="refresh">` redirect stub is fine) |

The log has one line per entry, `ok posts/x: public at /blog/x/, /en-us/blog/x/` or `FAIL posts/x: /en-us/blog/x/ is
missing from the build`. A failure fails the job before the deploy, and the change is reverted.

### Find and replace, bulk actions (editor and above)

Both change many entries in **one commit**. Each change is checked like a save of that entry by this user (rights,
status keys, own author, raw HTML, safe links, the site's `validate`); one that fails is left out with the reason,
and so is one that changed since the preview (its `version`). When a live entry changed (or was unpublished or
trashed), one job builds, verifies every locale and deploys; if it fails, the entries nobody touched since are put
back (and trashed ones taken out of the trash) in a revert commit. A JSON entry's `modified` follows the change, as
an editor save does.

| Route | Does |
|---|---|
| `GET /site/find?q=&with=&case=1&whole=1&keep=1&collection=` | Every entry containing `q` (plain text, never a pattern; at most 200 characters): `{total, more, entries: [{collection, id, title, status, url, version, count, kinds: {<kind>: n}, samples: [{line, where: "fields"\|"text", kind, field, before, match, after, read?, to?}]}]}`, up to 50 samples and 500 entries. `kind` is where the match sits: `text` (plain words, in a field's value or the body), `link` (a link address, an `href`, a written-out URL, a front matter value that is an address), `image` (an image file name: `![](…)`, `src`, a value ending in an image extension), `html` (inside a tag or comment), `code` (fenced or inline), `key` (a field's name); `field` names where it is ("Title", "Body under heading “Pricing”", "Hero › Heading" in JSON) and `before`/`after` are about eight words within its paragraph or field, as written. A `text` match also has `read`, its context as a reader sees it: a list of words (`"…"`), the match (`{match}`) and links (`{link: <address>, label: [words or {match}]}`), with emphasis, code marks, tags, entities and escapes gone and an image as its alt text; it is left out when the match runs into a link's markup. The other groups are shown as written only. Case-blind unless `case=1`; `whole=1` matches whole words in any script. `keep=1` (only without `case`) keeps the case of each match: the new text is written in capitals where the match was all capitals, small where it was all small, with a capital first where it was so, and as typed where its case is mixed. With `with` (empty is fine: remove the text), each sample has `to`, its new text, and each entry also says `problem` (null, or why it would be left out when only plain text is replaced) and `problems: {<kind>: reason|null}` for each other group it has, as if that group were ticked too. In a JSON entry the text is matched and written as JSON writes it (quotes and backslashes escaped) |
| `POST /site/replace {q, with, case, whole, keep, entries: [{collection, id, version, kinds?}]}` | Replace in those entries, only in the places of the groups in `kinds` (default `["text"]`: an address, file name, tag, code or field name changes only when its group is named on purpose; an unknown group is a `400`): `{commit, changed: [{collection, id, title, status, count, kinds}], skipped: [{collection, id, title, reason}], job}`. The new text is literal (`$&` stays `$&`). Audited as `site.replace`, with `keepCase` and the groups beyond plain text per entry. Screen: `#/replace?find=&with=&case=1&words=1&keep=0&collection=&flip=` (Keep the case is on unless `keep=0`) |
| `POST /site/undo {commit}` | The Undo on the toast after a find and replace or an image replaced everywhere: each entry of that commit goes back to its text before it, in one new commit `Undo: <subject>`, and a live one is rebuilt and deployed (a failed deploy puts the texts back): `{commit, undone: [{collection, id, title}], skipped: [{collection, id, title, reason}], job}`. An entry changed or deleted since is left as it is and named in `skipped`. Only commits audited as `site.replace`, `media.replace`, `media.delete.many`, or `entries.bulk` for a field change (`set`, `add`, `remove`, `rename`; never an unpublish or the trash) (`404` otherwise). The entries come from the commit itself, so a change to hundreds of entries undoes in full, once each (`409 already-undone`); editors and above, and for a delete of many media files also the person who deleted them. For that delete the answer has `restored: [{id, filename}]`: each file comes back from the commit before with its library row (alt text, uploader, credit), except one whose place has a file again (named in `skipped` with `collection: "media"`); no build. Audited as `site.undo` |
| `GET /site/bulk/fields?collection=` | The top-level fields the entries use, most used first: `{fields: [{name, list, kind: "list"\|"text"\|"number"\|"boolean", entries, values: [{value, entries}]}]}` (up to 100 values each). Never the status keys, page code, title, slug or url field |
| `POST /site/bulk/plan {action, field?, value?, entries: [{collection, id}]}` | The summary, nothing written: per entry `{collection, id, title, status, version, from, to, problem?}` |
| `POST /site/bulk {action, field?, value?, from?, entries: [{collection, id, version}]}` | Apply: `{commit, changed, skipped, job}` (rows as in the plan; a `trash` row also has its `trashId`, so a list's Undo can `POST /trash/:tid/restore` each one). At most 200 entries (1000 for `rename`). Audited as `entries.bulk`. A change to a field (`set`, `add`, `remove`, `rename`) has Undo: `POST /site/undo` |
| `GET /site/taxonomy?field=&collection=` | Categories, tags, authors: every value the field has across the entries (all of them, not the top 100), most used first: `{field, list, values: [{value, entries, live, collections}]}`. Collections where the field is one bulk changes leave alone have none |
| `POST /site/taxonomy/plan {field, from: [value, …], to, collection?}` | The bulk plan of a `rename` for every entry that has one of `from` (`to: null` takes them out). Apply it with `POST /site/bulk {action: "rename", field, from, value: to, entries}` and the versions the plan gave. Screen: `#/taxonomy?field=&q=&item=&action=rename\|delete&to=&out=1` |

Bulk actions: `set` (a field to text, a number, yes/no, a list of those, or `null` to clear it), `add` and `remove`
(a value in a list field such as tags; a field that is not a list is left out), `rename` (`from`: 1 to 20 values;
each becomes `value` wherever it is, in a list or as the field's value, a list keeping each value once, so renaming
to a value already used merges them; `value: null` takes them out: a rename, a merge, a delete with reassignment or
without, commit `<field>: <from> becomes <value> in N entries`), `unpublish` (drafts are left out),
`trash` (each text kept in the trash, restorable). A `400` names a bad action, field or value; authors and
contributors get `403`.

### Redirects (editor and above)

The site's old → new addresses. Moves add them on their own; these routes list them with what is wrong, add, change,
remove and test them. The site keeps them in its own format (a JSON map, `_redirects`, a framework config) and the
server only talks to its hook. Each change is one commit (audited as `redirects.add` or `redirects.remove`), then one
job builds, checks that the old address is not a page in the build, and deploys; if the job fails, the hook's files
go back (those nobody changed since) in a revert commit.

| Route | Does |
|---|---|
| `GET /site/redirects` | `{on, canList, message, more, siteUrl, redirects: [{from, to, status, flags: [{kind, text, trail?, fix?}]}]}`. `on: false`: the site has no hook. `canList: false`: the hook only adds (moves still record); `message` says what it needs. At most 20,000 rows (`more`) |
| `POST /site/redirects {from, to, was?}` | Add one, or change the one from `from` (its new address). `was`: the old address being renamed (removed in the same commit). `{commit, job, redirect}` with the new row's flags (a chain is allowed and flagged). `422` with `fields`: not a path, the same address, a loop (`That makes a loop: /a/ → /b/ → /a/.`), or a page at `from` (a live entry or a page in the last build), since the redirect would never run |
| `POST /site/redirects/remove {from: [...]}` | Remove these (1 to 500): `{commit, job, removed}` |
| `POST /site/redirects/test {from}` | `{from, build: {kind: "page"\|"redirect"\|null, to} \| null, live: {hops: [{url, status, location, via: "http"\|"page"}], verdict: "ok"\|"page"\|"error"\|"loop"\|"away"\|"long", status} \| {error}}`. What the last build has at `from`, then the live site (`siteUrl`) asked hop by hop, up to 10, following HTTP redirects and meta-refresh pages. A hop to another site is named and never asked. 30 tests a minute per person (`429`) |

Flags: `loop` (following them comes back, or one points at itself), `chain` (A → B → C; `fix` is C), `shadowed` (a
page is at the old address, so it never runs), `missing` (the end is on this site but not a page in the last build),
`duplicate` (the same address twice, say `/a` and `/a/`), `bad` (not an address). Addresses compare by path: no query
or fragment, one trailing slash, and a full URL on `siteUrl`'s origin is its path. `from` is a path only (one leading
`/`, no `?`, `#`, spaces, backslashes or `.`/`..` parts); `to` is a path or a full `http(s)` URL without a user name.

**The redirects hook.** The site config's `redirects: { command: ["node", "scripts/redirects.mjs"], timeoutSeconds? }`
(argv, no shell; 60 s by default) runs in the site repo with the build's environment and gets one JSON line on stdin:

| Input | The hook |
|---|---|
| `{"redirects": [{from, to}, …]}` | adds these, or changes the new address of a `from` already there; exits 0 |
| `{"action": "list"}` | prints `{"redirects": [{from, to, status?}]}` on stdout (the last line, or all of it) and changes nothing; exits 0 |
| `{"action": "remove", "from": [...]}` | removes the redirects from these addresses; exits 0 |

A hook written before `list` and `remove` (only the first form) keeps working for moves. The files a hook changes
are found with git and must be inside the repo. A non-zero exit undoes them and answers `502 redirects-failed` with
the end of its output. A hook that writes files when asked to list has them undone and counts as unable to list.

### Presence and the soft lock

Who has an entry open, and who is editing it, so two people see each other before a save runs into a `409`. Each
editor tab sends a heartbeat about every 20 s with its own random `tab` id (6 to 40 of `A-Za-z0-9_-`); a tab not
heard from for 60 s is gone. The first tab in `editing` mode holds the entry's lock. Another tab asking to edit is
answered `mode: "viewing"` with who holds it, until the lock is free or it takes over (`take: true`); the old holder
hears `takenOver: {by, at}` once, on its next heartbeat. Someone who may not edit the entry is always a viewer
(`canEdit: false`). The lock is advice for the editor: saves still go through the version check, so no save is
refused because of it. It lives in memory; after a restart every open tab claims again on its next heartbeat.

| Route | Does |
|---|---|
| `POST /collections/:c/entries/:id/presence {tab, mode: "viewing"\|"editing", take?}` | Heartbeat: `{mode, canEdit, lock: {userId, name, since, you, sameUser} \| null, people: [{userId, name, mode, since}], takenOver}`. `people` is everyone else (one row per person, editing first); `sameUser` is you in another tab. A take-over is audited (`entry.takeover`) |
| `DELETE /collections/:c/entries/:id/presence?tab=` | This tab closed the entry (frees its lock) |
| `GET /presence` | Every entry open now: `{entries: [{collection, id, editing: {userId, name, since, you} \| null, open}]}` (`open` = people), for lists and the publish sheet ("Edna is editing this now") |

## Media

| Method + path | Body | Answer |
|---|---|---|
| `GET media?q=&unused=1&page=` | | list of `Media` (a yes flag in a query is `1`, `true` or `yes`, here and in `users?brief=`, `compare?docs=`) |
| `POST media?filename=<name>[&from=<mid>][&alt=]` | the raw file bytes (`Content-Type: application/octet-stream`) | `201 Media`. With `from`, an edit of that image (crop, rotate, annotate in the editor): a new file named `<original>-edited.<ext>`, the original kept as it is, the original's alt text and credit carried over, audited as `media.edit`; `404` when the original is gone |
| `GET media/:mid` | | `Media` with `usedBy: [{collection, id, title}]` and `derivatives: [{id, filename}]` (its edits). An entry uses a file when its text names the file's path under the media folder as a whole path piece (`/uploads/2026/01/photo.jpg`, `photo.jpg`); kept per entry version in the `media_uses` table, so `usedBy` and `unused=1` are lookups, not a scan of every text |
| `GET media/:mid/file` | | the image bytes (for the library grid) |
| `PATCH media/:mid` | `{alt}` | `Media` |
| `DELETE media/:mid` | | `{ok}`; `409 {usedBy}` if any entry still uses it |
| `POST media/delete` | `{ids: [mid, …]}` (1 to 200) | `{commit, deleted: [{id, filename}], skipped: [{id, filename, reason, usedBy?}]}`: every file nothing uses that this person may delete (editors any, authors their own) goes in one commit `Delete N unused media files`; a file still used (with its `usedBy`), not theirs, or already gone is left and named. `commit` is `null` when nothing went. Audited as `media.delete.many` `{commit, count, skipped}`. Undo: `POST /site/undo` brings the files and their library rows back. The library's "Not used" view: tick files (`sel=<mid,…>` in the URL), Delete N files |
| `GET media/:mid/replace?with=<mid>` | | `{entries: [{collection, id, title, status, count, url}]}`: what a replace would change (editors and above) |
| `POST media/:mid/replace` | `{with}` | `{commit, entries, job}`: every entry naming the file gets the other one, in one commit (whole paths only, never part of a longer file name); the old file stays. When a live entry changed, `job` builds and deploys it, and a failed deploy puts the texts back. Audited as `media.replace`. Server only: the dev API has no such route, so the library hides "Replace everywhere" in dev mode. Undo: `POST /site/undo` |

`Media` = `{id, filename, path, url, type, width, height, bytes, alt, uploadedBy, uploadedAt, derivedFrom, credit}`
(`derivedFrom`: the media id it was edited from; `credit`: a stock photo's `{provider, label, id, author, authorUrl,
sourceUrl}`). `path` is the
repo-relative file (`src/assets/uploads/2026/10/name.webp`), `url` is what to put in content (from the site config).
Uploads: JPEG, PNG, GIF, WebP and AVIF images, and PDF documents, by content sniffing (the extension and
`Content-Type` are ignored). SVG, HTML and everything else is `415`, with what can be uploaded. An iPhone photo
(HEIC) becomes a JPEG when the server's image library can read HEIC (sharp built with libheif and an HEVC decoder;
the prebuilt sharp cannot) or through `media.heicCommand` (e.g. libheif's `heif-dec {in} {out}`, docs/DEPLOY.md),
else `415` with how to send a JPEG instead. A PDF is stored as it is (never
re-encoded), served by `GET media/:mid/file` as an attachment, and has no width, height or alt text;
`media.documents: false` refuses PDFs. Default limit 10 MB: `413` says the file's size and the limit. Raster images are decoded and re-encoded
(metadata stripped, longest side capped at 2560 px). The file is committed. Alt text is required before use in
content (the editor enforces it; the library stores a default alt).

### Importing media

Many files at once, each through the upload pipeline above (sniffed, never SVG, HEIC read, re-encoded, under
`YYYY/MM/`), all of them in one commit by the person importing, audited as `media.import` (each file, and the commit
with its files). Each is a dry run first. Authors and up (`media.import`).

| Method + path | Body | Answer |
|---|---|---|
| `POST media/import/urls` | `{urls: [...], dry?}` (1 to 50 picture addresses) | dry: `{items: [{url, problem?}]}` (each address checked, nothing fetched: not public, not http(s), a repeat); else `{job: {id}, items}`: a `media-import` job fetches each good address through the guard (docs/SECURITY.md "Fetching from the web"; at most the upload size, 15 s each) and commits `Import N media files from the web`. The job's log names each file or why it was left out |
| `POST media/import/zip?filename=&dry=1` | the .zip bytes (at most `media.importMaxBytes`, 64 MB by default, 500 files; streamed to `<dataDir>/tmp` and read in place, never whole in memory; `409 busy` while another media or Library import runs) | dry: `{items: [{name, bytes, problem?}]}` (folders, hidden files and `__MACOSX` left out; encrypted, unusual packing or a file over the upload size named); else `{job: {id}, items}`: commits `Import N media files from <name>` |

A file that is not an image or document the site takes is left out and named in the log; the job fails only when
nothing could be imported. On the server, `markstage-server media import <folder | file.zip | addresses.txt> [--dry]
--as <email>` does the same without a job (a folder's sub-folders too; a .txt file is one address per line).

### Indexing existing files

A site that had its pictures before Markstage has them under the media folder (config `media.dir`) with no row in
the library, so Images & files shows none. `POST media/index` `{dry?}` (owner and administrators, `media.index`)
walks that folder (sub-folders too, hidden files left out) and registers every file the library does not list yet,
in place: nothing is copied, moved or committed. A row gets what the file tells: the type from its bytes (never the
name), its size, an image's width and height from the header, the file's modified time as `uploadedAt`; no uploader,
no alt text. A file already listed, one of a kind the site does not take (SVG, text, unknown bytes) or a link that
leaves the repo is left out and named. Answer: `{found, added: [{path, type, bytes, width, height, used}], known,
skipped: [{path, reason}], dry}` (`used`: how many entries name the file, found as for an upload). Safe to run again.
Audited as `media.index` when it adds. On the server, `markstage-server media index [--dry]` does the same. The empty
Images & files screen offers it to an owner or administrator ("Find the site's existing files").

### Stock photos

When the server config has `stock` (Unsplash or Pexels, with the site's own key), the media library can search it.
The key stays on the server: the browser never talks to the provider.

| Method + path | Answer |
|---|---|
| `GET stock` | `{enabled: false}` or `{enabled: true, provider, label}` |
| `GET stock/search?q=&page=` | `{provider, label, page, perPage, total, items: [{id, width, height, alt, author, authorUrl, sourceUrl, thumb}]}`; `thumb` is an API path (below). `422` empty or long `q`; `404` not set up; `502` the provider failed or refused the key; `429` its hourly limit |
| `GET stock/thumb/:token` | a thumbnail from a recent search, fetched by the server (the editor's CSP shows images from itself only) |
| `POST stock/import` `{id, alt?}` | `201 Media`: the server asks the provider for that photo by id, downloads it from the provider's image host only (never a URL from the browser), and stores it like an upload with its `credit` (alt: the provider's description unless given). Unsplash's download count is sent, as their guidelines ask. Audited as `media.stock` |

Roles: anyone who may upload. Config: `stock: {provider: 'unsplash'|'pexels', keyFile}` (or `MARKSTAGE_STOCK_KEY`, or
`key` in config.json, which is in the data dir, outside the repo). `apiBase` and `imageHosts` exist for a mirror or a
test double; plain http only on loopback in development.

## Design & Code

The site's stylesheets, design tokens, scripts and injected code (ARCHITECTURE.md "Design & Code"), declared in
`markstage.config`:

```js
design: { tokens: 'src/styles/tokens.css', customCss: 'src/styles/custom.css',
          files: [{ path: 'src/styles/global.css', label: 'Site styles', scope: 'site' }],
          scripts: [{ path: 'src/scripts/menu.js', label: 'Menu' }],
          inject: { head: 'src/inject/head.html', foot: 'src/inject/foot.html' } }
```

Paths are checked at start (inside the repo, not `.git`, no symlink, a known kind; `customCss` and `inject` may not
exist yet). Components (`.astro`, `.tsx`, `.jsx`, `.ts`, `.vue`, `.svelte`) are listed read-only. Everyone signed in
may read; writing needs owner or administrator (`design.write`, `code.inject`), checked on the server and audited.

| Method + path | Answer |
|---|---|
| `GET design` | `{enabled, canEdit, order: [fid], files: [{id, path, label, kind, lang, scope, editable, exists}]}`. `kind`: `tokens`, `file`, `custom`, `script`, `inject-head`, `inject-foot`; `lang`: `css`, `js`, `html`, `astro`, …; `order` = the stylesheets in load order (the last wins a tie; custom CSS is last) |
| `GET design/files/:fid` | `{id, path, label, kind, lang, source, version, exists, editable}`; `version` = sha1 of the text, `null` while the file does not exist |
| `PUT design/files/:fid` `{version, source, message?}` | `202 {ok, version, commit, job}` (`200` with `job: null` when nothing changed). `409 {version}` stale; `422 {issues: [{line, message}]}` refused before writing; `403` below administrator or a read-only file |
| `GET` / `PUT` / `DELETE design/files/:fid/draft` `{baseVersion, source}` | `{draft: {baseVersion, text, savedAt} \| null}`: the person's own unsaved text (private; half-typed CSS is fine) |
| `GET design/files/:fid/revisions`, `…/revisions/:sha` | as an entry's revisions |
| `GET design/files/:fid/compare?from=<ref>&to=<ref>` | `{from, to, diff}`; a ref is a sha, `current` (default `to`), `live` (the last deployed commit) or `draft` |
| `POST design/files/:fid/revisions/:sha/restore` `{version}` | as `PUT`, audited `design.restore` |
| `GET design/tokens` | `{id, path, version, editable, issues, tokens: [{name, value, type, selector, context, group, line}]}`. `type`: `color`, `font`, `size`, `space`, `other` (from the value and the name); `selector` the rule (`:root`), `context` the at-rules around it (`@media (prefers-color-scheme: dark)`) or `''`; `group` the comment heading above it |
| `PUT design/tokens` `{version, values: [{name, selector, context?, value}]}` | as `PUT design/files`: only those values change, every other byte of the file is kept. `422 {errors}` for an unknown token or a value with `;`, `{`, `}`, `\`, `</`, a comment, unbalanced brackets or quotes, or a `url()` that is not a site path or https |
| `PUT collections/:c/entries/:id/code-injection` `{version, head, foot}` | `{ok, version, commit, job}` (`202` with a build when the page is live). Sets `codeInjection: {head, foot}` in the frontmatter (or JSON); empty both = removed. At most 64 KB each. Audited `code.inject` |

- **Every code save is a job** (`kind: 'design'`, or `code-injection` for a page): checks before writing (a
  stylesheet must not break the ones after it: unclosed blocks, comments or strings, `</style`; size: 1 MB CSS,
  256 KB scripts, 64 KB injected code), commit, build, the site's post-build checks (`checks` with `after: 'build'`,
  run once for the site with `MARKSTAGE_SCOPE=site` and `MARKSTAGE_FILE=<path>`), deploy. If a step fails, the live
  site keeps its previous deploy, the file is reverted in a new commit, and the attempted text becomes the person's
  draft.
- **A page's code injection** changes only for owner/administrator, on every path: a doc, frontmatter or source save,
  a new entry, a restore and the preview state are refused (`403`) when they change it; saves that leave it as it is
  pass, so editors keep editing those pages. An editor's duplicate leaves it out. A change by another route is
  audited `code.inject` too.
- **Live preview of CSS.** `PUT preview/:c/:id/state` also takes `css: {fid: text}` (owner/administrator, stylesheets
  only, size-checked), alone or with the unsaved entry. The preview clone shows those files with that text, so the
  site's dev server swaps the styles in the frame (Vite CSS HMR). An autosave keeps them; `DELETE …/state` drops them.
  Injected code never runs in the CMS: only on the preview origin and the built site.

## Library (templates, sections, snippets)

Page templates, sections and snippets to use again, shared ones as files in the site repo; the routes from before
(`snippets`, `templates`) still answer: docs/API-LIBRARY.md.

## Authors

`GET/POST authors`, `GET/PUT/DELETE authors/:slug` and `POST authors/:slug/rename`: the site's authors as JSON files
in its content (config `authors`), each change one commit; an entry save may not add an author the site does not
have (`422 unknown-author`); an author with posts is deleted or renamed only with their posts given to another or
moved with the new slug, in the same commit: docs/API-AUTHORS.md.

## Topics and links

`GET/POST topics`, `GET/PUT/DELETE topics/:id`, `POST topics/place`, and `GET links/pages|health|suggest|inbox|skips`, `POST links/accept|skip|fix`, `DELETE links/skips/:id`: the site's topics as files (config `topics`), the link map of every page's text, Health with one-click fixes, and link suggestions both ways, where Accept links the words on the other page as a normal save (one commit, Undo); the preflight has `topicLinks` and a page type may check links (`links: 'pillar'`): docs/API-LINKS.md.

## Page frames and types

A page's frame (full width, reading, plain) and its page type (config `frames`, `pageTypes`): a save that sets one
the site does not have is `422 invalid-page`; an existing page's type changes for editors and above (`403`); a save
is held to the locks of its type before and after it; `POST collections/:c/entries` takes `pageType` (the type's
template, the key set); `GET collections/:c/entries/:id/page-checks` answers the type, the frame and the type's
checks, which the preflight also gives (`page`, and a `pageType` rule per failed check): docs/API-PAGE-TYPES.md.

## Audit log (owner, administrator)

`GET audit?user=<uid>&action=<prefix>&from=&to=&before=<auditId>&limit=` →
`{items: [{id, at, userId, userName, ip, userAgent, action, target, ok, detail}], next}`.
Actions: `auth.login`, `auth.login.fail`, `auth.logout`, `auth.lockout`, `auth.2fa.*`, `auth.password`, `auth.sso`, `auth.sso.fail|link|unlink`,
`auth.setup`, `user.create|update|reset|delete|revoke`, `entry.create|save|source|delete|restore|import|duplicate`,
`entry.publish|schedule|unpublish`, `entry.lock|unlock`, `site.locks`, `revision.restore`, `media.upload|update|delete|import`, `library.*`, `author.create|update|archive|rename|delete`,
`job.succeeded|failed`, `site.publish`, `site.rollback`, `schedule.held|released|late|giveup`, `entry.publish.anyway`, `inbox.change|note|delete|export|import`, `forms.retention`, `forms.reply`, `site.alerts`, `me.alerts`, `security.origin|csrf|host` (refused requests). Append-only; there is no
API to edit or delete it.

### Backups (owner, administrator)

`POST /site/backup` backs up now: `202 {job}` (a job of kind `backup`, steps `backup` and `ship`; audited as
`site.backup`); `409 not-set-up` when the config has no `backup`. `GET /site/health` has `backup`: `{on: false}`, or
`{on: true, everyHours, keep, ships, due, late, last: {at, ok, name, bytes, commit, shipped, failedAt?, error?} |
null}`. A failed backup is told to the administrators (notice `backup.failed`, a safety alert, "The backup did not finish. …"). Setup
and the restore drill: docs/DEPLOY.md, Backups.

### Roll back a release

`POST site/rollback` (owner, administrator) → `202 {job}`: a job of kind `rollback` that runs the site's
`commands.rollback` (e.g. `markstage-deploy rollback --to /srv/site`). The release before goes back live; the
content in the repo is untouched, so the changes saved since go live again with the next publish (the publish
sheet's `alsoLive` lists them: `deploy.head` steps back to the commit live before). Audited (`site.rollback`); editors
get a notice. `400` when the server has no rollback command. `GET site/health` says `deploy.canRollBack`.

## Notices

Something a person must hear about even when they were not watching, kept until they mark it seen.
`GET notices` → `{items: [{id, at, kind, level: 'error'|'warn'|'info', text, link}]}` (mine, not seen, newest first);
`POST notices/:id/seen`; `POST notices/seen` (all of mine). `link` is a hash in the editor.

Who gets each kind, and how, is up to the site's rules and each person ("Alerts" below); the table says who by default.

| kind | When | To (by default) |
|---|---|---|
| `publish.failed` | a publish (or another job) failed, or was cut by a server restart | owner, administrators, and who started it |
| `deploy.failed` | a job failed at its `deploy` step (the build went fine, the host refused it) | owner, administrators, and who started it |
| `backup.failed` | a backup failed (safety) | owner, administrators |
| `schedule.held` | a due entry the publish rules stop (edited after it was scheduled): it is held (still scheduled, see "Held"), in a commit by "Markstage scheduler", and the rest of the run goes live | every editor and above |
| `schedule.released` | a held entry nothing stops any more: the next scheduler run puts it live | every editor and above |
| `schedule.late` | a due entry went live late because the server was not running at its time (missed times run at the next start) | every editor and above |
| `form.message` | a visitor sent one of the site's forms ("Forms and the Inbox"); the link (`#/inbox?open=<id>`) opens it in the Inbox | every editor and above |
| `form.assigned` | someone gave a form message to this person (not when they took it themselves) | the person |
| `site.rollback` | someone rolled the site back to the release before | every editor and above |
| `health.broken` | the health hook finds an address broken that was not at the last good check (never on the first check or a failed one) | owner, administrators |
| `lock.changed` | a lock set or lifted on a page ("Unlock on this page" included), or the rules for every page changed | owner, administrators |
| `user.invited` | someone was invited (safety) | owner, administrators |
| `user.role` | someone's role changed, their account was turned off or on, or the owner changed (safety) | owner, administrators, and the person |
| `signin.new-device` | a sign-in from a browser the person never used before; their first one is not news (safety) | the person |

Config `notify` (docs/DEPLOY.md "Alerts") also sends each notice once: by email (SMTP over STARTTLS or TLS, to the
listed addresses and the users of the listed roles; the subject is `<siteName>: ` and the notice's first sentence, `Markstage: ` when the site sets no `siteName`; the
body its text and the editor link, signed "Sent by the <siteName> editor (Markstage)"), to a Slack incoming webhook (`{text}` with an "Open in Markstage" link) and to a webhook (`{kind,
level, text, url, at}`). A channel that is down never stops the work.

### Alerts: who hears about what

The site's alert rules (Settings → Alerts), each person's choices (My alerts), the sender name and Send a test:
docs/API-INBOX.md "Alerts".

## Forms and the Inbox

The site's forms (`POST <basePath>/forms/<id>` on the site's own host), the Inbox of messages and alerts, and the
thank-you mail: docs/API-INBOX.md "Forms and the Inbox".

## Releases and share links

A named set of changes (entries, shared Library items, pictures) published together in one commit, now or at a time,
through the promotion rules; its preview built as if published; share links that show a release's or a draft's
preview to people without an account: docs/API-RELEASES.md.

## Environments

This environment against the shared remote, promotion and sync plans, rollbacks, the promotion rules, personal
tokens for the laptop CLI, branch previews and the staging site gate: docs/API-ENV.md.

## AI agents (MCP)

`POST mcp`: the Model Context Protocol server, for an AI agent holding an `mcp:` token. It reads the site as that
person, changes drafts, and puts changes to live pages into a release that is not scheduled: docs/API-MCP.md.

## Importing entries and media

`POST import` (a plan: nothing written) then `POST import/:rid/run` (a job): entries and media from another
system's JSON, idempotent on the source's ids, through the editor's own create and save: docs/API-IMPORT.md.

## Translation status

`GET translations` (filters: locale, status, collection, q) and `GET collections/:c/entries/:id/translations`:
whether each entry's words for each locale are missing, outdated or done, read from git: docs/API-TRANSLATIONS.md.

## Webhooks (owner, administrator)

`GET/POST webhooks`, `PATCH/DELETE webhooks/:wid`, its secret, test and deliveries: signed POSTs to another system
when an entry, a media file or the site changes, tried again with backoff and logged: docs/API-WEBHOOKS.md.

## Custom roles (owner, administrator)

`GET/POST roles`, `PUT/DELETE roles/:rid`, `POST roles/check`: named roles built on a base role, with rules in the
promotion rules' shape (actions, collections, own, kinds and paths, hours and freezes, a translator's fields); a
`User` names its `customRole`: docs/API-ROLES.md.

## Integration fields

`GET integrations`, `GET integrations/:name/options?q=&value=`, `POST integrations/:name/refresh`: a Post settings
select whose options come from a JSON address the server fetches on a schedule (markstage.config `integrations`);
a save keeps a bound setting to the list: docs/API-INTEGRATIONS.md.

## AI suggestions

`GET ai`, `POST ai/suggest`: words from a model for a person to read, change and save through the routes above
(alt text, a search title and description, a plan's summary, a draft for another locale). A suggestion never
commits. The key is `MARKSTAGE_AI_KEY` in the server's environment or `ai.keyFile` outside the repo; with none,
`GET ai` says why it is off: docs/API-AI.md.

## Site health and exports (owner, administrator)

`GET site/health` reads every entry once and answers:

```
{ pages: [{collection, id, title, path, url, words, searchTitle, description,   // lengths of the search title/description
           altText, links: [{href, problem, sure?, target?}], headings, speed}], // the publish sheet's findings, live pages only
  counts: {live, drafts, altText, links, headings, longTitles, noDescription},
  duplicates: [{what: 'title'|'description', text, entries: [{collection, id, title}]}],   // used by 2+ live pages
  deploy: {commit, at, job, failedSince: [{id, kind, entry, at, error}]},   // the last good deploy, failures after it
  build: {known}, disk: {free, total, media: {files, bytes}},
  speed: {on, why: 'off'|'no-site-url'|null, site}, backup: null,          // backups: not built yet (OPERATIONS.md)
  addresses: {on: false} | {on: true, running, at, stale, counts: {pages, redirects, chains, broken} | null,
              error: {at, message} | null},                                // the site's health hook, below
  forms: {alertFailed, geoip: {on, type, builtAt, attribution, problem}} }  // docs/API-INBOX.md
```

**Addresses** come from the site's health hook: `health: {command: [argv], timeoutSeconds?}` in markstage.config (or
config.json for a site without one; argv, no shell; default 120 s). It runs in the site repo with `MARKSTAGE_DIST`
set to the build output (`verify.public`) and prints what the host serves for every address the build knows:
`{"pages": [{path, status: 200|301|…, redirectsTo?}], "chains": [[path, …]], "broken": [{path, linkedFrom: [path,
…]}]}` (rows that are not that shape are dropped). The server runs it after each deploy once the job queue is idle
(never during a build), when Site health is first opened, and on "Check again"; the last good answer is kept, and a
failed run says why (`error`) without losing it. `stale`: the last answer is from before the live deploy.
`GET site/health/addresses?show=broken|chains|redirects|pages&q=&page=` → `{…status, show, items, total, page,
perPage: 100}`: broken `{path, linkedFrom: [{path, entry: {collection, id, title, status}|null}]}`, chains `{hops,
from, to}`, redirects and pages `{path, status, redirectsTo?, entry?}`. `POST site/health/addresses` runs it now and
answers the status (audited as `site.health.addresses`). Owner and administrators, like the rest of Site health.

**Speed** is Google's Chrome UX Report field data (p75 of the last 28 days): `{fetchedAt, phone, desktop}`, each
`{lcp, inp, cls}` with `{p75, rating: 'good'|'needs-work'|'poor'}` (Google's thresholds), or `{none: true}` when the
site or page has too few visitors, or `{error}` in plain words. `POST site/health/speed {path?}` asks again for the
whole site (no path) or one page; an answer is kept and reused for an hour. It needs config `crux` with the site's
**own** key (`key`, `keyFile` or `MARKSTAGE_CRUX_KEY`; never a key from anywhere else), sent in the
`X-Goog-API-Key` header, never in a URL or a log, and `siteUrl`.

**Exports:** `GET site/export/pages|links|images|headings?entry=<collection>/<id>` → a UTF-8 CSV (with a byte-order
mark, `Content-Disposition: attachment`), site-wide or one entry. Pages: address, search title and description with
their lengths, words, images, images without alt, links, links to fix, H1s, heading problems. Links: page, link,
text, inside the site, rel, problem, where. Images: page, image, alt text, where. Headings: page, level, heading,
where. A cell starting with `=`, `+`, `-` or `@` gets a leading `'` so a spreadsheet never runs it as a formula.

## Admin screens (editor)

The server's screens in the editor (`packages/editor/src/admin/**`, registered with the shell's `registerScreen`). Every
state is in the URL, so any view can be linked, reloaded and gone back from. Ids are opaque; setup codes, recovery
codes, the 2FA secret and the sign-in challenge are never in a URL.

| Hash | Screen |
|---|---|
| `#/sign-in?next=<hash>&step=code&with=recovery\|password&via=sso&sso=<why>&provider=<id>` | Sign in with a password or a provider, then the 2FA code or a recovery code (public); `sso` says why a provider's sign-in did not work; `with=password` is the owner's password when the site signs in with its providers only |
| `#/setup` | The first owner, with the setup code (public) |
| `#/accept-invite` | An invited or reset user sets a password (public) |
| `#/account?tab=password\|2fa\|sessions&step=scan` | Own account: password, 2FA with a QR drawn on the page, sessions |
| `#/users?q=&role=&status=&user=<uid>&action=invite&as=<role>` | Users (owner, administrator): invite (`as` presets the role), role, author, reset, 2FA reset, sign out, disable, delete, single sign-on links (unlink). While only one person can manage users, a card recommends inviting a second administrator |
| `#/audit?action=<prefix>&user=<uid>&from=&to=&before=<id>&item=<id>` | Audit log (owner, administrator) |
| `#/settings/roles?role=<id>\|new&rule=<id>&as=<uid>&do=<action>&in=<collection>&entry=<id>` | Custom roles (owner, administrator; one on administrator: the owner): each role's rules as sentences, a role made or changed with the promotion rules' form (kept for the tab until Save), and "What may they do?", POST roles/check with each rule's part (docs/API-ROLES.md) |
| `#/media?q=&show=unused\|no-alt\|stock&page=&item=<mid>&replace=<mid>&sel=<mid,…>` | Media library: upload (button or drop), alt text, usage, delete unused (on Not used, tick several and delete them in one go, with Undo); "Edit image" (crop, rotate) saves a new file and keeps the original; `show=stock` searches the stock provider and adds a photo with its credit; "Replace everywhere" uploads the new image, then `replace=` shows the plan (each entry: title, uses, address) before the swap, and the toast after it has Undo |
| `#/revisions/<c>/<id>?sha=<ref>&with=<ref>&view=text&all=1` | History: what is live, your autosaves and the saved revisions. Side by side (default): both versions drawn by the canvas's own blocks in the site's article classes, block by block, changed words marked, the settings field by field (pages: every field); "Restore this block" (or field) puts one change back. `view=text`: the changed sentences. Restore a whole revision or autosave |
| `#/publish/<c>/<id>?when=later&job=<jid>` | Publish sheet: the address in every locale, what changes against live, the checks (site rules and checks, alt text, links, the page on a phone at 390 px through the preview agent, the post-build checks to come), now or later; the job then runs in place (`job=`), ending with the live address (copy, open) |
| `#/replace?find=&with=&case=1&words=1&collection=&flip=<kind:c/id,…>&long=1` | Find and replace (editor and above): every entry with the text, in groups by where it sits: "In the text" (ticked), then inside a link address, in an image file name, inside HTML, in code, in a field name (each unticked, with a note on what ticking changes). Each place shows its field and about eight words either side (old struck through, new beside it); titles copyable, addresses with copy/open; Select all / none per group. `flip` keeps the ticks changed from those defaults; a new text over 300 characters stays out of the address (`long=1`: a reload asks for it again). One replace, with Undo on the toast after it; "Change these entries…" hands them to `#/bulk` |
| `#/bulk?items=<c/id,…>&action=set\|add\|remove\|unpublish\|trash&field=&value=` | Change many entries (editor and above): what to do, the field (with the values in use to pick from), then a summary of each entry, now and after, before Apply. Lists open it with their selection in `items` |
| `#/new/<collection>?template=<id>&type=<page type>` | The New sheet: the title, the settings the site asks for, the page type (a card each; a type picks its template, docs/API-PAGE-TYPES.md) and what it starts from (Blank or a Library template) |
| `#/authors?q=&show=archived&action=new`, `#/authors/<slug>?action=edit\|rename\|delete&to=<slug>&library=1` | Authors (everyone signed in sees them; editors and above change them, anyone their own profile): each author's photo, name and role, slug (copy), posts and live posts, author page (copy, open); one opens on the right with their profile, links and posts; New author, Edit (photo from the media library), Archive / Bring back, Change slug (the posts move with it), Delete (the posts go to another author first). docs/API-AUTHORS.md |
| `#/topic-map?action=new`, `#/topic-map/<id>?q=&page=<ref>&action=edit\|delete`, `#/links?view=inbox\|health\|pages\|page\|skipped&topic=<id>&kind=<kind>&ref=<c/id>&q=&s=<suggestion>&f=<finding>` | Topic map (everyone signed in sees it; editors and above change it): each topic as a board to drag pages between its main page, its groups and their leads; Links: the Link inbox (Accept, Skip, Undo), Health with one-click fixes, every page's links in, out and outside, one page's suggestions both ways, the skipped ones. docs/API-LINKS.md |
| `#/taxonomy?field=&q=&item=<value>&action=rename\|delete&to=<value>&out=1` | Categories and tags (editor and above): every value of a field (the fields entries share: lists such as tags, text such as a category or the author) with its entries and live entries, copyable; a value opens on the right to rename it (a used name merges the two) or delete it (taken out, or its entries given another); the summary of each entry first, then one change with Undo |
| `#/redirects?q=&show=problems&item=<old address>&action=add\|edit\|test&path=<address>` | Redirects (editor and above): old and new addresses (copy, open on the site), problems flagged (Loop, Chain, Never runs, Not a page, Twice); a row opens in the drawer (`item`) to change, remove, test, or point a chain at its end; Add a redirect; Test an address (what the build has, then the live answers hop by hop) |
| `#/trash?collection=&q=&item=<trashId>` | Trash: deleted entries, newest first, each with its title and old address (copy, open); a search box past 10; Restore (back as a draft, then the entry opens); administrators "Delete for good…" (`item=`): the drawer lists the pages that still link to it before the button |
| `#/jobs?status=` and `#/jobs/<jid>` | Jobs, and one job's steps and live log; on the list, your notices (For you) until marked seen |
| `#/health?show=alt\|links\|headings\|all\|broken\|chains\|redirects&q=&page=` | Site health (owner, administrator): the live pages that need a look (or all), the same words on two pages, the last deploy and failures since, disk, speed for real visitors (Ask Google again, per page too), and the four CSV downloads. With a health hook: an Addresses line (pages, redirects, broken, chains, when, Check again) and the lists: broken addresses with the pages that link to them (each opens its entry), redirect chains hop by hop, every redirect |

End-to-end tests: `packages/server/e2e/admin.e2e.mjs` builds the editor with these screens, serves it from a server on
127.0.0.1:18231 with test users it makes, and drives every screen in Chromium. `npm test -w packages/server` runs
the unit tests, then these (`e2e/run.mjs`); Playwright comes from the root devDependencies or `MARKSTAGE_PLAYWRIGHT`.
Without Playwright, a loud `SKIPPED: e2e` line says why (`MARKSTAGE_E2E_REQUIRED=1` makes a skip fail). The ports
come from `MARKSTAGE_E2E_PORT_BASE` (default 18231): the server there, the others at fixed offsets (+4, +6, +8, +10,
and +16 to +68 for the preview's dev servers), so two runs at once take two bases. A port in use fails the run and
names the port; it never skips.

## Permissions

What each role may do, one row per action, and what "own" means: docs/API-PERMISSIONS.md.

## Site-side contract (static sites)

1. Collections with `hasStatus` filter in the site's content queries:
   `entry.data.draft !== true && (!entry.data.publishAt || new Date(entry.data.publishAt) <= buildTime)`.
   For the pilot site: add `draft: z.boolean().default(false)` and `publishAt: z.coerce.date().optional()` to the
   `blog` schema and one `isLive(post)` helper used by every `getCollection('blog', ...)` call (lists, sitemap,
   RSS, related posts, `getStaticPaths`).
2. The build command must exit non-zero on failure; the deploy command must be atomic and exit non-zero on failure.
3. `MARKSTAGE_BUILD_TIME` (ISO) is set for the build so scheduled posts appear at the right build.
4. Entries with `protected: true` are built to a private folder (`protectedPages.dir`), never to the public output,
   and are left out of every derived output: sitemap, RSS, llms.txt, llms-full.txt, the per-page Markdown twins
   (`/<page>.md`, and on the pilot site `/okf/<page>.md`), link-card JSON and site search (the rehearsal found all of
   these leaking for a protected page). The web server sends requests it cannot find in
   the public output to Markstage, or guards the private location with `auth_request /markstage/page-auth`
   (tested files: `deploy/nginx/`; use `try_files $uri $uri/index.html ...`, not `$uri/`). For the pilot site: `protected: z.boolean().default(false)` in the blog and
   pages schemas, and `isLive()` plus the sitemap and feed filters skip protected entries.
5. Preview: the site's dev server runs with `MARKSTAGE_PREVIEW=1`. Then `isLive()` is true for every entry
   (drafts and future posts render), so a writer can preview a draft. The dev server must start with every entry
   valid against the site schema: one invalid entry stops it (the preview page shows the site's message).
6. Link cards: when the site config has `editor.linkCards` (core: a site path such as `/link-cards.json`, or
   `{url, fields}`), the editor fetches that path from its own origin. The server answers exactly that path on the
   CMS origin (`GET`/`HEAD` only, `.json`, at most 5 MB) with the file from the last build in `verify.public`, and
   `404` before there is one (the editor then shows what it knows of the page). Nothing else outside the base path
   is served. Keep protected entries out of that file (point 4).

## Preview render

The preview on its own origin (`preview.origin`), one URL per entry, with the editor's unsaved state, the site's own dev server in dev mode, and the agent script it runs: docs/API-PREVIEW.md.

## Compatibility with today's dev API

The production server also answers the old routes (session + CSRF rules apply to the POST), mapped to the
configured `compat.collection` (on the pilot site: `posts`):

| Old | New |
|---|---|
| `GET /studio-api/articles` → `[{slug, title, url, cluster}]` | `GET collections/posts/entries` |
| `GET /studio-api/article?slug=x` → `{slug, url, title, doc, version}` | `GET collections/posts/entries/x` |
| `POST /studio-api/article?slug=x` `{doc, version}` → `{ok, version, changedBlocks}` / 409 | `PUT collections/posts/entries/x` |

## Server-side converter interface (packages/core)

The server calls core through one adapter (`packages/server/src/content/converter.mjs`), stubbed in tests:
`@markstage/core`: `createConverter({packs}) → {mdToDoc, docToMd (surgical), changedBlocks, rawHtmlOf}` and
`readFrontmatter(text) → object`; `@markstage/core/json`: `JsonEntry` (set/remove/insert/move/duplicate).
Block packs the converter needs are listed in the server config (`packs`: absolute paths to modules whose default
export is a pack or a list of packs). Still wanted from core: `setFrontmatter(text, {key: value|null}) → text`
(surgical YAML for the settings drawer); until then the server writes changed top-level keys as single-line JSON
values (valid YAML) and leaves every other line untouched. Without core installed, Markdown routes answer `503`.
`@markstage/core/locks` (also from `@markstage/core`): `checkLocks(before, after, rules) → violations`,
`lockChanges(before, after, rules) → [{change: 'lock'|'unlock'|'change', path, type, label, from, to}]`,
`lockReport(…) → {violations, changes}` and `lockOf(v)` (a stored or configured lock to `{move?, remove?, edit?}`); a
side is a page `{data}` or an article `{doc, frontmatter}`, `rules` the site's `locks` (see "Locks" above). The
editor can run the same function before a save, to show what the server would refuse.
