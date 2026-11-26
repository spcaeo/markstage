# Markstage API: the MCP server (AI agents)

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). An AI agent (Claude, or any
client of the Model Context Protocol) reads the site and drafts changes **as the person whose token it holds**,
through the editor's own routes. Server code: `packages/server/src/mcp/`; the relay: `packages/astro/bin/markstage.mjs`.

By default nothing an agent does publishes, deletes, moves or promotes anything. It changes drafts, adds pictures,
and puts changes to live pages (and the pictures they show) into a release that is not scheduled. A person reviews
that release and publishes or schedules it. The one exception is a token an owner or administrator made with `mcp:publish` ("Publishing" below):
its agent may ask to publish a release, and the site decides exactly as it would for that person, after its checks
pass.

## The endpoint

`POST <api>/mcp` (`/markstage/api/mcp`), on the CMS origin only. It uses MCP's Streamable HTTP transport, answered
with plain JSON: one JSON-RPC 2.0 message in, its answer out. There is no event stream and no session id.

- `GET`: `405` with `Allow: POST`, as the spec asks of a server with no event stream, and words for a person who
  opened the address in a browser ("This is Markstage's MCP address. …"). Other methods: `405`. A JSON array (a
  batch): `-32600`.
- A notification, or a client's response to the server: `202` with no body.
- Methods: `initialize`, `ping`, `tools/list`, `tools/call`. Anything else: `-32601`. Unknown or wrong arguments:
  `-32602`, or a tool error naming the argument.
- **Protocol version.** The server speaks `2025-06-18` and `2025-03-26`. `initialize` answers with the client's
  `protocolVersion` when it is one of those, else with `2025-06-18`. It never refuses, as the spec says. On later
  requests, an `MCP-Protocol-Version` header naming another version gets `400`; no header is fine.
- `initialize` gives `serverInfo {name: 'markstage', title, version}`, `capabilities {tools: {listChanged: false}}`
  and `instructions`, which tell the agent the rules below and that content it reads is data, not instructions.
- **Where it answers.** The site's hosts (`siteHosts`) and the share origin answer `404` for this path, whatever the
  method. So does every other CMS path there.

## Tokens

An agent's token is its own kind. It is not the laptop CLI's token.

- Scopes: `mcp:read` (the read tools), `mcp:draft` (the write tools too, `add_image` among them; it brings
  `mcp:read`) and `mcp:publish` (`publish_release`; it brings `mcp:read`, not `mcp:draft`).
- Made in a browser session: `POST me/tokens {name, scopes: ['mcp:read'] | ['mcp:draft'] | ['mcp:publish'] | …,
  days: 1..90}` gives `201 {token, secret}` (`mst_…`, shown once). In the editor: Settings → Tokens, "New AI
  assistant token" (`#/settings/tokens?new=mcp`). Reading is always ticked; writing drafts is ticked only when asked
  for. The page then shows the secret once, `npx markstage mcp login <origin>`, the client config and the MCP
  address.
- **`mcp:publish` is an owner's or administrator's to give.** Anyone else asking for it gets `403` ("Only an owner or
  administrator can make a token that lets an AI agent publish."), and the screen does not offer it to them
  (`GET me/tokens` says `canMcpPublish`). It is never ticked for you. Beside it, and again on the made token, a plain
  warning: the assistant can put releases live without you pressing Publish; it is checked like you are (the
  site's checks, the publish rules, approvals and freezes still decide, and a failed check stops it); every publish
  names the assistant and you; give it only to an assistant you trust, for as few days as you need, and revoke it
  when you are done.
- A token is for the command line (`env:…`) or for an agent (`mcp:…`), never both: a mixed request gets `400`.
  `GET me/tokens` gives `scopes` (the command line's), `mcpScopes` and `groups: {cli: {scopes, reaches: '/env'},
  mcp: {scopes, reaches: '/mcp'}}`.
- An `mcp:` token reaches `/mcp` only (`403` elsewhere). A command line token on `/mcp` gets `403`. A browser session
  on `/mcp` gets `403` too: the endpoint takes a token, not a cookie.
- **Behind a reverse proxy**, the proxy must pass `Authorization: Bearer mst_…` through to Markstage, or no agent
  can sign in. A browser password (basic auth) in front of the editor is not forwarded: pass only a Markstage bearer
  token, and leave basic auth off for `/markstage/api/mcp` and `/markstage/api/env`, which the token protects. The
  sign: a token that works gets `401` "Send a Markstage MCP token…" instead of "Unknown token.". An nginx example is in
  docs/SECURITY.md "Operator checklist".
- **The token only ever goes in `Authorization: Bearer mst_…`**, never in a URL. Unknown, revoked or expired:
  `401`, audited `security.token`. A revoked or expired agent token's words say to make a new one at Settings → Tokens
  and give it to the agent. `markstage login` keeps command line tokens only: it checks a token on `/env`, which an
  agent's token cannot reach.
- **Origin.** No `Origin` header (an agent, the relay) is fine. The CMS's own origin is fine. Any other browser
  `Origin` gets `403`, audited `security.origin`. Bearer requests skip the CSRF check: a browser never sends that
  header on its own.

## The relay: `markstage mcp`

For clients that start a command (stdio): `@markstage/astro` ships `markstage`, node only. `<url>` is the editor's
address. `https://cms.example.com` means Markstage at `/markstage`; a server with another `basePath` is named by its
path (`https://example.com/cms/`, `…/cms/api/mcp` or an editor link with `#/…` too), and that base is kept with the
token, so later the bare origin is enough. The token screen shows the commands with the editor's own address.

- `markstage mcp login <url> [--token-stdin]`: checks the token with `ping`, then keeps it in
  `~/.config/markstage/credentials` (0600; `$MARKSTAGE_CONFIG_DIR/credentials`) under `mcp`, apart from the command
  line's tokens. A token the server does not take is not kept.
- `markstage mcp [<url>]`: one JSON-RPC message per line on stdin, each answer on one line on stdout, in order. The
  token comes from `MARKSTAGE_TOKEN` or the kept one; the URL from the argument, `MARKSTAGE_URL`, or the one server
  kept. Only JSON goes to stdout. A line that is not JSON gets `-32700`. An HTTP refusal becomes a JSON-RPC error
  `-32000` with the server's words and `data.status`, and the words go to stderr too. Notifications get no line.

A client's config, for example:

```json
{ "mcpServers": { "markstage": { "command": "npx", "args": ["markstage", "mcp", "https://cms.example.com"] } } }
```

A client that speaks Streamable HTTP itself uses `https://cms.example.com/markstage/api/mcp` with the header
`Authorization: Bearer <token>`.

## Tools

`tools/list` lists the read tools, the write tools only for an `mcp:draft` token, and `publish_release` only for an
`mcp:publish` token. Each tool has a JSON Schema (`additionalProperties: false`) and annotations: reads
`readOnlyHint`, and only `publish_release` `destructiveHint`. A result is
`structuredContent` plus the same JSON as text. A refusal is a result with `isError: true` and `structuredContent
{error, status, message, …}`: the editor's own error code, status and words.

| Tool | Scope | What it does |
|---|---|---|
| `site_info` | read | The site, its collections and fields (`hasDrafts`, `canCreateDrafts`), who the agent acts as (id, name, role, author slug), the token's name and scopes, and the rules |
| `list_entries` | read | One collection's entries this person may read: id, title, status, address, author, dates, tags, excerpt. Filters `q`, `status`, `author`, `sort`; 50 to a page |
| `get_entry` | read | One entry: status, address, `version`, **`source`** (the file's text) and the Library blocks synced into it (`synced: [{id, state}]`). With `find` (exact text), instead of `source` only the passages that hold it: `{matches, passages: [{from, to, text}], lines}`, each passage a few lines around a match with its line numbers ("Small edits" below) |
| `search` | read | Entries this person may read whose title, id or text has the words, with the text around the first match. At most 50 |
| `list_library`, `get_library_item` | read | The Library (templates, sections, snippets), and one item whole with the pages that use it |
| `env_status`, `get_plan` | read | This environment, its branch and upstream, and the promotion plans |
| `get_job` | read | `{job, wait?}`: one build-and-deploy job (the `job` that `publish_release` answers with): `status` (queued, running, succeeded, failed), `steps` with how each ended (a `failed` or `warned` step with its own `output`: a warned one did not stop the job, such as the push after going live), `error` in words, and for a failed job `failedStep` and `failedOutput`, that step's own output (a check's words; the last 6,000 characters). The person who started it, editors and up. A failed publish leaves the live site as it was, puts the release's files back and opens the release again (`get_release`: `status: open`, `error`): fix what `failedOutput` names and publish it again. `wait` (0 to 90 seconds) answers when the job ends, so an agent makes one call instead of asking again and again (90 stays under the usual 120 s of a reverse proxy) |
| `list_releases`, `get_release` | read | The releases and one release with its items |
| `create_draft` | draft | A new draft in a collection with drafts, under the person's author name (Markdown for an article, data for a JSON entry). A collection without drafts: `422 no-drafts` |
| `update_entry` | draft | A changed `source` saved over a **draft**, with the `version` from `get_entry` (stale: `409`). The commit says `Update <c>/<id> (an AI agent, via MCP: <token name>)`. A live or scheduled entry, or a page in a collection without drafts: `409 live`, pointing at `add_to_release` |
| `edit_entry` | draft | `{collection, id, version, edits: [{find, replace, all?}], release?}`: a small change without sending the whole file. Each `find` is exact text and must be in one place (`422 no-match` or `422 many-matches` otherwise, naming the edit and how many places), or every place with `all: true`; the edits apply in order. Without `release` it is `update_entry` with the edited source, with `release` it is `add_to_release`: the same rules and refusals. Answers `{changed, version, edits: [{find, matches}], diff}` (plus `item` and `release` with a release), never the whole source ("Small edits" below) |
| `create_release` | draft | `{name, description?}`: a new **open** release, never scheduled, named for why (the name goes into the publish commit); the description can hold sources. Editors and above, as in the editor (`403` otherwise). Answers `{created, release: {id, name, description, status, version}}`, so an agent needs no person to start a change |
| `add_to_release` | draft | An entry, as saved or with a changed `source`, into a release that is **not scheduled**. Needs the right to publish that entry, as for a person (`403`) |
| `add_image` | draft | `{alt, url? \| data?, filename?, release?, collection?}`: one picture, from a web address or its bytes in base64, with alt text, through the editor's own upload ("Pictures" below). Answers its `path`, `url` and what to write in an entry (`use.field`, `use.markdown`) |
| `publish_release` | publish | `{release, version, reason?}`: publish an open release now, as the token's person would ("Publishing" below) |

### Source in, source out (lossless)

An entry is read and written as its file's text: front matter and Markdown for an article, the JSON for a page.
So nothing is lost in a conversion. `get_entry` then `update_entry` with the same `source` gives `{changed: false}`,
writes nothing and makes no commit. A change touches only what the agent changed. Sections, components, raw HTML,
synced copies and `_lock` markers stay byte for byte.

### Small edits

To change a word, a sentence or a link, an agent does not need the whole file. Reading and sending back a long
article costs far more than the change. Two things keep it small:

- **`get_entry` with `find`** gives only the passages that hold that exact text, each with three lines around it
  and its line numbers (`from`, `to`), plus the `version`. Passages that touch are joined; at most 20, then
  `more: true`. Without `find`, `get_entry` gives the whole `source` as before.
- **`edit_entry`** takes only the changes: `edits: [{find, replace, all?}]`. `find` is the text exactly as it is
  in the file (spaces, line breaks and Markdown marks included; in a page's JSON, as the JSON writes it, `\"` for a
  quote). `replace` is what goes there (`""` takes it out). Each `find` must be in the file once; set `all: true`
  to change every place. The edits apply in order, each to the text the ones before it left. If any edit finds
  nothing or finds several places, nothing is changed and the refusal says which edit and how many places.

`edit_entry` then saves exactly as `update_entry` (without `release`, drafts only, `409 live` otherwise) or
`add_to_release` (with `release`) would with the edited source. Every rule of theirs holds: the `version` (stale:
`409` with the version now), the rights, locked and synced blocks (`423`), hidden values (`422 hidden`), the site's
validation and the modified date. When the entry is already in that release (and its file has not changed since),
the edits apply to the text the release holds, so several small edits add up in one item (`from: "release"`).

The answer is small: `{changed, version, edits: [{find, matches}], diff}`. `find` is cut to 80 characters. `diff`
holds only the changed lines, with two lines around each change, under `@@ -<old line> +<new line> @@` headers, a long
line cut to the part that changed, and at most 4,000 characters. An edit that changes nothing gives
`{changed: false}` and writes nothing.

Use `edit_entry` for small changes. Send the whole `source` (`update_entry`, `add_to_release`) only to rewrite most
of an entry.

### Pictures

`add_image {alt, url? | data?, filename?, release?, collection?}` adds one picture. It never stores a picture
itself: the bytes go to the editor's own upload routes, as the token's person, so every rule of a person's upload
holds. The type is told from the bytes (JPEG, PNG, GIF, WebP, AVIF; an iPhone HEIC is turned into a JPEG; never SVG),
the picture is re-encoded (metadata stripped, the long side capped at `media.maxSide`), named in the media folder
(`<media.dir>/<year>/<month>/<name>.<ext>`, `-2` when the name is taken) and listed in the media library with its
alt text. The audit row says `via: 'mcp'` and the token's name.

- **`alt`** is required: a few words on what the picture shows (up to 500 characters). Empty or only spaces: refused.
- **The picture, once**: `url` or `data`, never both.
  - `data`: the bytes in base64 (standard or URL-safe), or a `data:image/…;base64,` URL. At most `media.maxBytes`
    once decoded; more is `413` with the sizes ("This file is 81 KB; the limit is 64 KB. Export it smaller…"). A
    token with `mcp:draft` may send a request big enough for that in base64 (`media.maxBytes` × 4/3 and 256 KB, and
    never less than `maxBodyBytes`); a request bigger than that, or any bigger than `maxBodyBytes` from a reading
    token, is `413` before any tool runs.
  - `url`: fetched by the server through the same guard as the media import (docs/SECURITY.md "Fetching from the
    web"): http and https on ports 80 and 443 only, no name and password in it, every address the name resolves to
    on the public internet (no loopback, private, link-local such as `169.254.169.254`, IPv6 included), each
    redirect checked again, a time limit, and at most `media.maxBytes`. Refused: `400 unsafe-url`, in words, and
    nothing is asked of that address. The file is named after the address's last part unless `filename` says.
    The address is kept with the picture (its `credit`: `{provider: 'web', label, sourceUrl}`, shown in the media
    library as "Fetched from"), so a person can check its licence later.
- **Only pictures**: a PDF (which the editor's upload keeps as a download), a page or anything else is `415` in words.
- **Rights, as in the editor.** Uploading is the person's `media.upload` (contributor and up). Fetching from an
  address is an import (`media.import`, author and up): a contributor's agent sends the bytes (`403` otherwise).
- **Without `release`** the picture is committed to the media folder as the person's upload, its commit saying
  `Upload <path> (an AI agent, via MCP: <token name>)`. It is on no page until an entry that uses it goes live: put
  it in a draft with `update_entry`, or in a live page's change with `add_to_release`. A site whose media folder is
  under `public/` puts every file there on the site at its next build, used or not, so there a picture an agent
  adds must wait in a release: without `release` it is `409 served-as-is`, nothing written.
- **With `release`** (a release that is open and not scheduled; `409 scheduled` otherwise, asked before anything is
  fetched and again just before the item is kept) nothing is written to the repo. The picture waits in the release
  as a `media` item (`get_release`'s `counts.media`), its name in the media folder kept for it (an upload meanwhile
  takes another). It is written, committed and listed in the media library when the release goes live, in the
  release's one commit with the entry that uses it, and `release.publish` lists it in `mcpItems`. Taken out of the
  release, or the release cancelled, it never reaches the site. A contributor puts nothing into a release (`403`).
- **The answer**: `{added, path, url, type, width, height, bytes, alt, media, release, use, note}`. `media` is the
  media library's id (`null` while it waits in a release); `release` is `{id, name, status, version, item, counts}`
  or `null`. `use` says what to write, as the editor writes it: `use.field` for a cover or image field (the path
  inside the media folder, `2026/11/team.webp`, or the site path of a file under `public/`), and `use.markdown`, per
  Markdown collection (or only `collection`), `![alt](…)` with the path relative to that collection's folder.

A draft's picture in Markdown: Astro processes the pictures of every entry, drafts too, so a draft that shows a
picture from `src/assets/` puts that file in the build's `_astro/` under a hashed name, as a person's draft does. No
page, sitemap or feed names it until the draft goes live.

### What an agent may not do

The editor's own checks apply to every write: rights, version, locks, synced copies, links, raw HTML, status keys,
and the site's `validate`. An agent also meets stricter checks of its own, before the route's:

- **Synced blocks.** A change that alters, removes or detaches a block synced from the Library: `423 synced`. A
  person changes the Library item, or detaches the block.
- **Locks.** Changing a locked block, removing one locked against removal, or adding or taking off any lock:
  `423 locked`, naming the block. An agent never locks or unlocks.
- **Hidden values.** A source carrying `[hidden]` where the file has a real value (below): `422 hidden`, so a
  scrubbed value is never written over the real one.
- **Scheduled releases.** `add_to_release` into a scheduled release: `409 scheduled`, "“Name” is scheduled: it goes
  live by itself at its time, so an AI agent cannot add to it. Add to a release that is not scheduled; a person
  schedules it." This is checked when the add starts and again inside it, after the entry's checks, with nothing
  awaited between that check and the item being kept, so a release scheduled meanwhile refuses too. The item's
  `via` lives in the `meta` column `release_items` already has (`DEFAULT '{}'`), so no migration was needed; a person
  who adds the same file again takes the item over, and `via` goes.

In every one of those cases nothing is written and nothing is added.

### Reads follow the role

A tool shows only what the token's person may read, through one rule (`readable()` in `src/mcp/tools.mjs`):

- Editors and above see every entry. An author or a contributor sees live entries and their own drafts.
- An entry they may not read gets the same `404` words as one that does not exist ("No entry "x" in posts, or it is
  not available to you."), so its existence is not given away.
- What else names a draft follows the same rule: the pages a Library item is on (`get_library_item`'s `uses` and
  `usedOn`) and a release's entries (`get_release`'s `items` and `counts`). Promotion plans name every file they
  move, so `env_status` gives `plans` (else `null` and why) and `get_plan` answers (else `403`) for editors and up.
- No tool gives an entry's revisions or history; `get_entry` gives the current source only.

**This is narrower than the editor**, where every role reads every entry and its revisions (docs/API-PERMISSIONS.md).
A person reads a colleague's draft in the editor to work on it with them. An agent copies what it reads into a
model's context, where it can travel further, so it gets only what its person needs.

Writes are the editor's own rights: a contributor changes and makes their own drafts and cannot put anything into a
release.

## No secrets in answers

Every answer and every error goes through a scrub last (`src/mcp/answer.mjs`). Each value below becomes `[hidden]`:

- The server's secrets from the environment, by name: names ending in `PASS`, `PASSWORD`, `SECRET`, `TOKEN`, `KEY`,
  `CREDENTIALS`, `DSN`, `SALT` or `_AUTH`, and anything with `SMTP_`. Also a form's CRM sign-in, by its prefix
  (`<env>_URL`, `_DB`, `_EMAIL`, `_PASSWORD`).
- The config's values under keys that name a secret (`password`, `apiKey`, `secretKey`, `token`, …), and the AI key
  read from `ai.keyFile` (docs/API-AI.md).
- The content repo's git remote addresses, and any sign-in written into a URL (`https://user:pass@` becomes
  `https://[hidden]@`).
- People's email addresses: a person is shown by name and id only, and any `email` key is left out.

Only a value of 8 characters or more counts as a secret, so a short value never blanks ordinary words. Search and
excerpts are matched and cut on the scrubbed text, so half a secret is never shown.

## Publishing

`publish_release {release, version, reason?}`, for an `mcp:publish` token only. Without the scope the call is a
JSON-RPC error that says so: "…does not hold mcp:publish. Only an owner or administrator makes such a token
(Settings → Tokens); until then a person publishes."

It never bypasses a rule. In order, and nothing is written until every step passes:

1. **The person.** The token's person must be an owner or administrator **now**: someone made an editor since gets
   `403 forbidden`, in words.
2. **The release.** It must be open (`409 not-open`), not empty (`422`), and `version` must be the one from
   `get_release` (stale: `409`).
3. **The checks, now.** The site's content checks run again on exactly what the release holds. A blocking check
   that fails stops it: `422 checks-failed`, naming each entry and check ("…an AI agent never publishes past a
   failed check"), and the refusal is audited as `release.publish` with `ok: false`. (A person's publish runs the
   checks inside its job and puts every file back when one fails; an agent's is refused before anything is written.)
4. **The person's own publish route.** Then the same route a person's Publish uses: the promotion rules for that
   person (who may publish releases, approvals, freezes and hours; refused: `403 rule`, audited), the publish rules
   (an image with no description, a broken link…: `422 blocked`) and the version.

When it is allowed the release goes out as a person's would (`{publishing: true, job, release, checks: {passed,
warnings}}`). It is **one commit by the person**, its subject naming the agent: `Release “Name” (published by an AI
agent for <person>, via MCP: <token name>)`. The `release.publish` audit row carries `via: 'mcp'`, the token's name
and the same words (`by`), and so does the notice editors see.

At most **5 publishes an hour per token** (counted when asked), on top of the call limits below. Over: `429` with
`Retry-After`, audited `mcp.limited` (`publishesPerHour`) once an hour. Another token is not held up.

## Limits and audit

- At most **120 calls a minute per token, 30 of them writes**. Over that: `429` with `Retry-After`, audited
  `mcp.limited` once a minute.
- Every tool call is audited as `mcp.call` (target: the tool, `ok`). Every row a call leads to (the save, the
  release item) carries `detail.via: 'mcp'` and `detail.token: <token name>`.
- A release item an agent added keeps `via`, the token's id and the token's name. When the release goes out
  (`release.publish`) or its time comes and something stops it (`release.blocked`), the audit lists those items as
  `detail.mcpItems: [{rel, title, token}]`.

## Not in v1

- No resources, prompts or sampling; no event stream.
- No tool that schedules, promotes, deletes or moves. `create_release` opens a release and `publish_release` publishes
  an open one now; a schedule is a person's.

## Proof

Server tests run against a real server on 127.0.0.1, with test people and tokens made in the test.

| Proof | Test |
|---|---|
| The protocol: version negotiation, ping, 202, the header `400`, JSON-RPC errors, no batch, `GET 405` | `mcp.test.mjs`: "initialize: the client's version when we speak it, ours when not…" |
| Read-only without `mcp:draft`: the write tools are not listed, and a call says why | "read-only by default…" |
| Tokens: none or unknown `401`, a session `403`, a CLI token `403`, an MCP token on `/env` `403`, mixed `400`, draft brings read, a token cannot list tokens, revoked and expired `401` | "tokens: only an MCP token…", "an expired token is refused" |
| Origin: none and the CMS's own are fine, any other is `403` and audited | "Origin: …" |
| `404` on the site's host and on the share origin, for every method | "only on the CMS origin…" |
| Audit `via` and the token's name, on the call, the save and the commit | "every call is audited as via MCP…" |
| 120 a minute, 30 writes; `429` with `Retry-After`; audited once | "at most 120 calls a minute per token…" |
| Planted secrets (an environment token, a git remote with a token, an email, a sign-in in a URL) in no answer; a short value stays; an excerpt cut inside a secret shows none of it; `422 hidden` | "no secret in any answer…", "the scrub on its own…" |
| Reads follow the role: `list_entries`, `get_entry` and `search` as an editor, an author and a contributor | `mcp-roles.test.mjs`: "reads follow the role…" |
| Writes by role: a contributor's own drafts, no release; an author's live entry `409`; an editor's drafts, live `409`, pages `422`/`409`, stale `409` | the three tests "a contributor…", "an author…", "an editor…" |
| A scheduled release refused in words; scheduled during the add, refused, nothing added | "add_to_release: into an open release…", "a release scheduled while the agent adds to it…" |
| `add_image`: listed with `mcp:draft` only, a reading token told why; a PNG in base64, a `data:` URL and from an address, re-encoded, named, committed naming the agent, in the media library, audited, then used in a draft; what to write (`use.field`, `use.markdown`) | `mcp-media.test.mjs`: "the scope…", "a good PNG in base64…", "a data: URL…", "from a web address…" |
| `add_image` refused in words with nothing written: no alt, spaces only, too long, both or neither source, not base64, text, an SVG, a PDF, an address sending a page; `127.0.0.1`, another loopback port, `169.254.169.254`, `[::1]`, `localhost`, `10.0.0.5`, `file:`, a sign-in in the address, a redirect to `169.254.169.254` (nothing asked of loopback); over `media.maxBytes` as bytes and from an address; a request past the raised limit `413`, a reading token's at the usual limit | "refused in words…", "an address into the server's own network…", "the size limit…" |
| `add_image` by role and with releases: a contributor's agent uploads its bytes, but neither fetches nor adds to a release; a picture in a release writes nothing, is counted as `media`, and goes live with the page that shows it in one commit (the build, the media library, `mcpItems`); `public/` media needs a release (`409 served-as-is`); a scheduled or missing release refused | "a contributor's agent…", "with a release…", "a site whose media folder is served as it is…", "a scheduled release takes no picture…" |
| `mcpItems` in `release.blocked` (a file changed since) and in `release.publish` | "at its time: …" |
| Lossless: `get_entry` then `update_entry` unchanged gives `{changed: false}`, the same bytes and no commit, on every page and article. That includes core's site-shaped fixture pages and an article with sections, components, raw HTML, synced copies and `value._lock` | `mcp-roundtrip.test.mjs`: "get_entry, then update_entry with what it gave…" |
| A one-word change changes that word only, also beside a synced piece | "a one-word change to a draft…" |
| `423 synced` (changed, dropped, detached; a page and an article) and `423 locked` (a locked block changed or removed, a lock taken off or put on), through `update_entry` and `add_to_release`, nothing written or added | "synced blocks: …", "locks: …" |
| Small edits: `edit_entry` listed with `mcp:draft` only; a one-word edit changes that word only and moves the modified date; `0` and several matches refused in words naming the edit, file and history untouched; `all: true`; edits in order; a removal; no change gives `{changed: false}`; a stale version `409`; a live entry `409 live` as `update_entry`, with `release` into the release as `add_to_release` (the item's text checked), a second edit adding up in the same item; `423 synced` with and without a release; `422 hidden`; the answer never holds the whole source; `get_entry` with `find` gives only passages with line numbers | `mcp-edit.test.mjs` |
| What else names a draft follows the role: a Library item's pages, a release's entries, the plans; no revisions tool | `mcp-roles.test.mjs`: "what else names a draft follows the role too…" |
| **Nothing an agent does publishes**: the example blog (`examples/blog`, with a sitemap and an RSS feed filtered as its pages are) built with Astro, then every write tool (a new draft, a picture for it, two drafts changed, a picture held in a release, a live post's change that shows it and a draft into that release: four commits), then built again: the same files, byte for byte, none of the agent's words anywhere, and one file more, the draft's picture in `_astro/`, named by no page. A person's save of a live post then changes the page, the index and the feed, so the comparison does see a change | `mcp-build.test.mjs` |
| The token screen: two kinds, one or the other; `?new=mcp` and `?new=cli` (reload, Back); reading always, drafting when ticked; the secret once and never in the URL; the commands, the config and the address with copy and open (opened, it says what it is); it reaches `/mcp` and not `/env` | `e2e/tokens.e2e.mjs` (Playwright, Chromium) |
| Publishing: `mcp:publish` an owner's or administrator's to give (an editor `403`), it brings reading and not drafting, `publish_release` listed with it only and `destructiveHint`; without the scope, refused in words | `mcp-publish.test.mjs`: "the scope…", "refused without the scope…" |
| Allowed: one commit by the person naming the agent and the token, the audit row and the notice | "allowed: the checks pass…" |
| Refused by a failed check (nothing written, audited), by the publish rules and a stale version, by the promotion rules (`403 rule`) and by the person's role now (`403`) | "refused by a check…", "refused by the publish rules…", "refused by the rules and by role…" |
| 5 publishes an hour per token: `429` with `Retry-After`, audited once, another token not held up | "at most 5 publishes an hour per token…" |
| On the example blog with its real Astro build and a deploy: refused while a blocking check fails (nothing committed, built or deployed), then published, built and live once it passes | `e2e/mcp-publish.e2e.mjs` |
| The Tokens screen: the publish box only for an owner, never ticked, its warning read with it and on the made token | `e2e/tokens.e2e.mjs`: "an owner may let an assistant publish…" |
| The relay: one line per answer in order, JSON only; `mcp login` keeps the token (0600) apart from the CLI's; refusals as `-32000` and on stderr; a server at another `basePath` (`/cms`) for `mcp login`, the relay, `login` and `status` | `mcp-cli.test.mjs` |
