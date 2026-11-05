# Markstage server: security

How `packages/server` protects a content site, what each control is, and which test proves it. Tests live in
`packages/server/test/` and run with `npm test` in `packages/server` (`node:test`, a throwaway git fixture site per
suite, the server on an ephemeral 127.0.0.1 port).

## What we protect

- **The live site.** Only a signed-in user with the right role can change what visitors see. A failed check, build
  or deploy never changes it.
- **The content repo.** Writes touch only entry files inside configured collection folders, plus uploads inside the
  media folder. Each write is one git commit by the signed-in user, so nothing is lost and everything is
  attributable.
- **Accounts.** Password hashes, sessions, 2FA secrets, recovery codes and page passwords live in the server's data
  dir, never in the repo or in a URL.
- **Protected pages.** A page with a password is never in the public build output, and is served only after the
  page password is entered.

## Threat model

| Attacker | Wants to | Main controls |
|---|---|---|
| Anonymous internet user | sign in, guess passwords, enumerate users | no default account, rate limit + progressive lockout, constant-time verify, same answer for unknown email |
| Malicious website visited by a signed-in writer | make the writer's browser save, publish or delete (CSRF), or read API answers | SameSite=Strict cookie, Origin check, per-session CSRF token, Host allowlist (DNS rebinding), JSON-only bodies, CORS not enabled |
| Network observer | steal a session | Secure + `__Host-` cookie, HSTS on https origins, https required in production |
| Thief of a session cookie | keep access | idle + absolute timeouts, server-side revoke (logout, sessions list, password change, disable) |
| Thief of a password | sign in | TOTP 2FA, replay refused, recovery codes single-use |
| Contributor (lowest role) | publish, edit others' posts, plant script in content | server-side role checks on every route, own-drafts-only, raw-HTML rule, author field locked |
| Any signed-in user | read or write files outside content (traversal), run commands | strict id pattern, realpath checks, symlink refusal, argv-only commands from operator config |
| Uploader | plant script (SVG, HTML, polyglot), exhaust disk/memory | content sniffing, SVG refused, re-encode, size and pixel limits |
| Visitor of a protected page | read it without the password, guess it | private build output, signed per-page cookie, per-page lockout, noindex |
| Visitor or bot on a site form | flood the Inbox, turn the form off for real visitors, mail strangers through the thank-you reply, slip in headers or formulas, reach the CMS | site Origin only, daily limits by connection address, network and email, an hourly cap that holds messages instead of refusing visitors, honeypot and fill time, fields checked and cleaned, one-address Reply-To, CSV formula guard, site hosts reach only the forms and the gate |
| Author (preview) | put a script in a draft and have an owner preview it, to act as the owner | previews on their own origin, never the CMS origin; Markstage cookies stripped before site code |
| Editor or author importing from the web | make the server reach its own network (the cloud metadata address, the database, the CMS itself) through an address or a redirect (SSRF), or bring script in with a page | fetches by the server only, public addresses only (checked after DNS, connection pinned to the checked address, every redirect checked again), ports 80 and 443, size and time limits, robots.txt; imported HTML read into Markdown, never stored as HTML |
| A signed-in person asking for AI suggestions, or a page that tries to steer the model | read drafts they may not, run up the site's AI bill, learn the key, change the site without review | the MCP `readable` rule, a session only, suggestions only (never a commit), size caps, per-person limits, the key in the environment or a file outside the repo, everything scrubbed, every ask audited without its text |
| An AI agent, or a page it reads that tries to steer it (prompt injection) | publish, delete or reach what its person cannot; learn the server's secrets; rewrite locked or synced blocks; hide what it did | its own token kind (`mcp:read`, `mcp:draft`, `/mcp` only), the person's role on every read and write, no publish, delete, move or promote tool, drafts and unscheduled releases only, `423` on locked and synced blocks, every answer scrubbed, a rate limit, every call audited as the agent's |
| Someone who controls a sign-on provider's answer, or a page that starts a sign-in | sign in as someone else, sign a person in as the attacker, reach the server's network, raise their role | the state bound to the browser and used once, PKCE, the ID token's signature and claims checked, a person found by the provider's id or a verified email only, the role Markstage's own, `autoCreate` to named domains and never above editor, the provider's addresses through the SSRF guard |
| Someone with a copy of the database | log in with it | session tokens and codes stored as hashes, passwords as scrypt |

Out of scope for the server itself: the security of the machine, the reverse proxy's TLS setup, the site's own build
scripts (the operator configures them), and rendering. The editor draws raw HTML cleaned by its own sanitiser
(`packages/editor/src/canvas-shell/dom.ts` `cleanHtml`: no script, frame, meta, base, style, link, form or form
control, no `on*` handler, no `javascript:` or `data:text/html` address, no `id`/`name`; proven by
`packages/editor/test/raw-html-clean.test.ts` in a real browser document), behind the editor's CSP. The server's job
there is to stop contributors from saving new raw HTML.

## Controls and their proof

### Accounts and sign-in

| Control | How | Proof (test) |
|---|---|---|
| No default password | A fresh server has no users. The first owner needs a one-time code from `markstage-server setup-code`: 80 bits, valid 1 hour, single use, only while no owner exists. | `auth.test.mjs`: "a fresh server has no users and no default password", "setup needs the one-time CLI code; the code works once"; e2e on port 18231 |
| Password hashing | scrypt N=2^15, r=8, p=3 (Node built-in; argon2 is not in Node 22/24 LTS without a native addon), 16-byte salt, parameters stored per hash | `unit.test.mjs`: "hash format, verify, wrong password, and unknown-user path" |
| Password policy | 12-256 characters, not the email, not on a common list, not one repeated character | `unit.test.mjs`: "policy"; `auth.test.mjs`: weak setup and weak change refused |
| Constant-time compare | `crypto.timingSafeEqual` for hashes; tokens compared after padding to equal length. An unknown email is verified against a dummy hash, so it costs the same time. | `unit.test.mjs`: "safeEqual"; `auth.test.mjs`: "wrong password and unknown email get the same answer" |
| One account per email | Emails are kept and looked up lowercased (trimmed; migration 21 lowercased older rows and refuses to run while two accounts differ only in letter case, with both named), so an invite typed with a capital, the provider's lowercased email and the CLI's `--as` all find the same person, and `Owner@Example.com` can never be a second account. | `auth.test.mjs`: "an email is one account whatever its letter case…"; `update.test.mjs`: "migration 21 lowercases every email…" |
| Login rate limit | 30 tries per IP per 10 minutes (configurable); `429` + `Retry-After` | `auth.test.mjs`: "one IP gets 429 with Retry-After after too many attempts" |
| Progressive lockout | Per (account, address) pair: after 5 misses in a row from one address (`login.accountFreeFailures`) that address is locked out of the account for 60 s, doubling per further miss up to 1 h (`lockBaseSeconds`, `lockMaxSeconds`). Even the right password from that address waits it out; a success clears it. 2FA, password-change and 2FA-setup misses count too. The account itself (from every address) locks for `lockMaxSeconds` only after `login.accountMaxFailures` (50) misses within `login.accountWindowSeconds` (1 h), so a stranger who knows an email cannot lock the person out from one address; during an account-wide lock a browser the person signed in from before (the known-device cookie) still gets in with the right password (a wrong one answers 423 like everyone else). Both locks answer the same `423` words, so an unknown email looks the same. Each lock is audited (`auth.lockout`, `scope: device` or `account`). | `auth.test.mjs`: "the account locks after 3 misses, longer after each further miss, and a success clears it" (test config: 3), "the lock is per address: another address, or the person from a known browser, still signs in; the account alone locks only after many misses in an hour" |
| TOTP 2FA | RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step). Setup needs the password and is confirmed with a code. A code is accepted once (last step stored). The challenge between password and code lives 5 minutes and allows 5 codes. | `unit.test.mjs`: RFC test vectors and replay; `auth.test.mjs`: "enable, sign in with a code, refuse replay, use a recovery code once, disable", "an expired challenge is refused" |
| Recovery codes | 10 random codes (~60 bits each), stored as sha256, single use, regenerated with password + code | same 2FA test |
| Invites and resets | Owner/admin gets a one-time setup code that the person types along with their email. No secret ever goes in a URL. Codes expire after 72 h; a new code voids the old one. A reset clears the password and revokes sessions. A CLI reset exists for a locked-out owner. | `auth.test.mjs`: "invite: setup code + matching email ...", "reset clears the password ..." |

### Sessions

| Control | How | Proof |
|---|---|---|
| Cookie flags | `__Host-markstage`: HttpOnly, Secure, SameSite=Strict, Path=/, no Domain | `auth.test.mjs`: "session cookie is __Host-, HttpOnly, Secure, SameSite=Strict, and rotates at sign-in"; e2e |
| Stored hashed | The cookie holds 256 random bits; the database holds its sha256 | code: `src/auth/sessions.mjs` |
| Rotation | Every sign-in (password, 2FA, setup, invite) revokes the browser's previous session and issues a new token and a new CSRF token. A password change rotates the session too. | same cookie test; "changing the password revokes the other sessions and rotates this one" |
| Idle + absolute timeout | Defaults 2 h idle, 12 h absolute (configurable) | `auth.test.mjs`: "idle timeout", "absolute timeout even when active" |
| Server-side revoke | Logout, the own-sessions list, password change, admin "revoke sessions", disabling a user | "logout revokes the session server-side", "revoking a session from the list ends it; disabling a user ends theirs" |

### Requests

| Control | How | Proof |
|---|---|---|
| CSRF token | Every non-GET API call needs `X-CSRF-Token` equal to the session's token (constant-time). Refusals are audited. | `auth.test.mjs`: "a write without the CSRF token is refused"; compat POST too (`content.test.mjs`) |
| Origin check | Every non-GET call (sign-in included) must carry `Origin` (or `Referer`) equal to the public origin. Refusals are audited. | "a write from another origin, or with no Origin/Referer, is refused (even with the token)" |
| Host allowlist | Only the public host (plus loopback aliases in development) is answered; anything else gets `421`. This blocks DNS rebinding against a server on a private address. | "an unknown Host header is refused (DNS rebinding)" |
| Body limits | JSON only (`415` otherwise), 4 MB (`413`), uploads 10 MB by default | "bodies are size-limited and must be JSON"; media "size limit (413)" |
| Security headers | API: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP same-origin, `Permissions-Policy`, `Cache-Control: no-store`, HSTS on https. Editor page: `script-src 'self'` (no inline script), `object-src 'none'`, `frame-ancestors 'none'`. | "security headers on API answers and on the editor page"; e2e prints the editor CSP |
| Every read needs sign-in | No anonymous API routes besides `auth/me`, login, setup, invite acceptance and single sign-on (`auth/sso`, its start and callback) | `unit.test.mjs`: "a normal server refuses requests without a session even for read routes" |

### Permissions (roles)

Every decision lives in `src/roles.mjs` and is checked on the server for every route. The editor's `can` flags are
only hints. The table is docs/API-PERMISSIONS.md.

| Control | Proof |
|---|---|
| Contributors: own drafts only. No publish, schedule or rebuild. Cannot touch live entries. | `content.test.mjs`: "authors: own entries only; contributors: own drafts only, never live ones"; `publish.test.mjs`: "contributors cannot publish, schedule or rebuild", "saving a live entry needs the publish right" |
| Raw-HTML rule (block `rawHtml` and inline `rawInline`): a contributor may keep the raw-HTML blocks already in an entry but may not add or change any. This is checked on the final text, so doc saves, source saves, new entries, duplicates and revision restores all go through it. | "contributors cannot add or change raw HTML ..." (stub) and "the raw-HTML rule uses core's rawHtml nodes" (real core, block and inline HTML) |
| URL-scheme rule (every role): every `href`, `src` or `url` attr at any depth of the document (link marks, images, box attrs), the frontmatter and JSON entries must be http, https, mailto, tel or relative; whitespace and control characters inside a scheme are ignored the way browsers do (`java\tscript:`). Checked on the submitted document and again on the re-parsed saved text, so raw source cannot get around it; snippets and templates too. Raw HTML blocks are not parsed for URLs: only editors and authors can save raw HTML, and the editor draws it through its sanitiser (`cleanHtml`, `raw-html-clean.test.ts`). On the real site, 186 entries had 0 unsafe URLs. | `unit.test.mjs`: "URL-scheme rule" (19 cases, deep walk); `content.test.mjs`: "URL-scheme rule for every role ..." (link, image, box, frontmatter, JSON, snippet); `core.test.mjs`: a Markdown `[x](javascript:...)` parsed by core |
| The author field is locked for non-editors (no handing a post to someone else) | "authors: own entries only ..." (`steal` attempt) |
| Status (`draft`, `publishAt`) and `protected` change only through their routes | "frontmatter edits are surgical; status keys cannot be set by a save" (raw source too); protect test |
| Users: only owner/admin manage users. Admins cannot touch owners or create admins. Nobody changes their own role, disables or deletes themselves. There is always exactly one owner. | "only owner/admin manage users ...", "there is always exactly one owner; ownership transfers" |
| Design & Code: stylesheets, tokens, scripts and injected code are written by owner/administrator only (`design.write`, `code.inject` in roles.mjs), every write audited (`design.save`, `design.tokens`, `design.restore`, `code.inject`). A page's `codeInjection` is compared before and after on every save path (doc, frontmatter, source, new entry, restore, preview state): a change from anyone else is `403`; an editor's duplicate drops it. Injected code never runs on the CMS origin. | `design.test.mjs`: "only owner/administrator may edit, components never", "code injection: … other saves cannot change it" |
| Design files: paths from the site config only, checked at start (inside the repo, not `.git`, no symlink, a known extension; components read-only); writes are atomic and re-check that the folder is not a link. A code save is checked before writing (CSS that would break later stylesheets, `</style`, size), then built, checked on the build and deployed as one job; a failure reverts it and keeps the text as the person's private draft. Token saves change only the values named, refusing values that could close the rule or load from another origin. | `design.test.mjs`: "the config is checked at start", "tokens … saved surgically", "a save that fails its build or a check is reverted" |
| Locks: a block locked by the site (markstage.config `locks`) or by an editor (`_lock`, `data-lock`, frontmatter `locks`) cannot be moved, deleted or changed by any role through any save path (`423`, nothing written); only owner, administrator and editor add or take off a lock or lift a site rule on one entry (`403`), each one audited, with who and when written by the server on the marker; only owner and administrator change the site's rules (`site.locks`, version-checked, committed, audited). The check is on the server, from the stored and the saved file, so the editor's greyed grip is only a hint. Without core it fails closed (`503`). | core `locks.test.mjs` (site-shaped pages and an article from core's fixtures, every lock kind, overrides, box locks, the rules file); server `lock-rules.test.mjs` (Unlock on this page, Settings → Locks) and `locks.test.mjs`: "a page: deleting the hero is refused …", "every save route …", "an editor's own lock on a section …", "an article: the FAQ stays …" |
| Audit log readable by owner/admin only | "the audit log is admin-only and records sign-ins" |

### Files, paths and commands

| Control | How | Proof |
|---|---|---|
| Path allowlist | Entry ids must match `^[a-z0-9][a-z0-9-]{0,99}$`; the router accepts only `[A-Za-z0-9_-]` in a path segment. The file must sit directly in a configured collection folder (realpath-checked at startup, never `.git`, never outside the repo) and must not be a symlink. | `content.test.mjs`: "path allowlist: traversal, encoded separators, other dirs and symlinks are not found" (10 probes + symlink to a file outside the collection); `unit.test.mjs`: config refuses `../`, `.git`, absolute dirs |
| Inside / outside checks | One helper (`config.mjs` `realish`, `isInside`, `isWithin`) for every check that a path is in or out of the site repo, the data dir, the media folder, a build folder or the preview clone: both sides are compared as real paths (symlinks resolved; a path that does not exist yet by its nearest existing parent), so a secret file, a backup folder or a key file inside the repo is refused however the path is written (through macOS `/var` → `/private/var` or any linked folder). A name such as `..x` is inside, and `dist-private` is not inside `dist`. | `paths.test.mjs`: "the repo reached through a linked folder: secrets, backups and key files inside it are refused"; the whole suite runs with the default macOS TMPDIR |
| Job logs | `GET jobs` (the list, no logs) is for everyone signed in; `GET jobs/:id` (the build's and deploy's output: repo paths, the deploy command, host names, whatever the site's build prints) only for whoever started the job and for editors and up (`site.publish`), `403` otherwise. | `publish.test.mjs`: "jobs list and the audit trail of publishing" (an author reads her own, not another's; a contributor none; an editor every one) |
| Optimistic concurrency | Every write sends the version (sha1) it started from. A stale one gets `409` and nothing is written. The check-write-commit runs under one repo lock. | "a stale version gets 409 ..." and the source/delete/compat variants |
| Atomic writes | Temp file in the same folder, then rename | code: `src/content/store.mjs` |
| Git | `execFile` (no shell). Request-derived arguments are only validated paths after `--` and validated hex shas. A commit includes exactly the touched paths. The author is the user; the committer is the server. | "save: surgical write, git commit authored by the user, ..."; revisions test refuses shas that did not touch the file |
| Site config | The site's `markstage.config` runs inside the server process (its url/group functions run on every list). It is site code with the same trust as the build: only whoever controls the repo's code can change it, never the API, which writes entry files only. The server re-checks every collection dir (real path inside the repo, not `.git`, no symlink escape) and refuses two sources (config.json and markstage.config). A function that throws costs one entry its URL, not the list. | `site-config.test.mjs` |
| Site commands | Build, deploy and checks are argv arrays from the operator's config file in the data dir (no shell, never from the API). They run in the repo with an allowlisted environment (no server secrets), a timeout that kills the whole process group, and a 1 MB log cap. | `unit.test.mjs`: config refuses a shell string; `publish.test.mjs` (all job tests) |
| Prototype pollution | JSON change paths refuse `__proto__`, `prototype` and `constructor` | `content.test.mjs`: "JSON changes are applied by path; prototype keys are refused"; `core.test.mjs` |

### Publishing

| Control | How | Proof |
|---|---|---|
| Move (rename) | A live entry needs the publish right (its public address changes). One commit holds the rename, the link rewrites and the redirects. Link rewrites change only string values that are exactly the old address (any locale, path or absolute site URL), never visible text. The site's redirects hook is an argv command (no shell) that gets only `{redirects:[{from,to}]}` site paths on stdin (and, when it can list, the repointing of older redirects so no chain or loop is made). Only files it changed inside the repo (not `.git`) are committed; a failure undoes its changes and nothing moves. A failed build reverts file by file, skipping a file someone changed since. Moving many at once (`POST /site/move`, the Pages tree) checks every move like one (rights, version, name, the site's `validate`) and writes nothing unless all may be made; it sets only fields a bulk change may set, and refuses a new address that another move in the same request leaves (no chain). | `move.test.mjs`; `move-many.test.mjs`; `redirects.test.mjs`: "moves: … moving again repoints the older ones (no chain); moving back removes them (no loop)" |
| Redirects | Editors and above only. Old addresses must be site paths (one leading `/`, so never `//host`; no `?`, `#`, spaces, backslashes, `.` or `..`); new ones a path or an `http(s)` URL without a user name, so no `javascript:` target can be written. A loop and a redirect from a page's own address are refused before anything is written. The hook (argv, no shell, the build's environment) changes the site's files; only files inside the repo are committed, a failure undoes them, and a hook that writes when asked to list is undone. One commit per change, audited (`redirects.add`, `redirects.remove`); a failed build or deploy puts the files back. The test asks only the site's own `siteUrl` (https; plain http only for a loopback address outside production), builds the URL from the path and checks its origin, follows redirects one hop at a time (at most 10) and never fetches a hop on another site, with an 8 s timeout per request and 30 tests a minute per person. | `redirects.test.mjs`: "refused: a loop, a page at the old address, the same address, and what is not an address", "test: … another site is named, never asked", "a hook that only adds: … a remove fails cleanly", "live tests are limited per person"; e2e: redirects |
| Every locale copy checked before deploy | `verify` checks the fresh build for every locale path of each changed entry: published = public in every locale; protected = private, and never in the public output; not live = in neither. A protected page leaking into the public output in one locale (e.g. `/en-us/`) fails the job before the deploy, and the change is reverted. Post-build checks (`after: 'build'`, e.g. hreflang) block the same way. | `locales.test.mjs` |
| One bad entry cannot break the site | The operator's `validate` command (the site's own schema check) runs before every write of an entry, inside the repo lock; non-zero = 422 with its issues, timeout = 503, nothing written or committed. A failed build names the entry files in its output in the job error. | `validate.test.mjs` |
| Failure leaves the live site untouched | Jobs run one at a time: commit, checks, build, deploy. The deploy command must be atomic (upload, then switch). If a step fails, deploy never completed, so the previous deploy stays live. | `publish.test.mjs`: "a failed build leaves the live site untouched and reverts", "a failed deploy keeps the previous deploy and reverts", "a blocking check stops the publish before build" |
| Repo matches live after a failure | The job makes a revert commit restoring the pre-job text, unless someone changed the file meanwhile (then it says so in the log). The attempted text becomes the user's private autosave. **Decision: revert, not "keep as draft"**, because for a live entry a kept edit would ship with the next unrelated build. | same tests check the file text, the revert commit message and the autosave; delete-rebuild failure restores the file |
| Autosave history is private | Autosave snapshots belong to their author: listing, reading, comparing (`autosave:<id>`) and restoring them answer 404 to anyone else. A restore is a normal save (version check, validate, the raw-HTML and URL rules, the publish right for a live entry) that keeps the status and protection keys. | `ux.test.mjs`: "autosaves leave a trail ... private", "an autosave is restored as a new revision, status kept" |
| Updating Markstage | Only in a terminal (`markstage-server update`), never over HTTP, so no web account can change the server's code. Git and npm run with argv (no shell); a checkout with local changes is refused; the database is copied aside before the switch; the new code must pass `markstage-server check` or the old version is put back. Migrations only add, so `--rollback` runs the older code on the newer database (checked for every migration). The release line (version, build number, build time) is public in `GET release` by the owner's footer rule; the exact commit only to signed-in people (`GET auth/me`, `GET release` once signed in). | `update.test.mjs` (a local bare repo as the remote, no network); `auth.test.mjs`: "GET /release: the footer line for everyone…" |
| Backups | The folder must be outside the site repo and the data dir (checked at start) and is created 0700; it holds password hashes, sessions and `config.json`, so the operator keeps it and its off-site copy private. The database copy is consistent (`VACUUM INTO`), the repo bundle is taken under the repo lock, each file's sha256 is in the manifest. The ship command is argv (no shell) with the allowlisted environment and a timeout. Only owners and administrators start one; a failure is told to administrators. Only folders the server named are ever pruned. | `backup.test.mjs` |
| Alerts (email, Slack, webhook) | Secrets never sit in `config.json`: the SMTP password comes from `MARKSTAGE_SMTP_PASSWORD` or a file outside the site repo (a `password` key is refused), the Slack URL from `MARKSTAGE_SLACK_WEBHOOK` or a file; the password is not an enumerable property, so it never shows in the config as JSON, and it is never in an error. Mail goes only over STARTTLS (never downgraded when the relay does not offer it) or implicit TLS, with the certificate checked; plain SMTP only to a loopback relay outside production. Header values are stripped of line breaks (no header injection) and addresses are checked; the body is base64, so no line can end the message early. Hooks are https (loopback http in development). Only owners and administrators send a test alert; it is audited. A channel that is down never stops a publish or backup. | `alerts.test.mjs`: "a failed publish: one mail over STARTTLS …", "a relay without STARTTLS gets nothing in plain text …", "config: secrets from the environment or files only …", "the message: line breaks never reach a header …"; e2e: alerts |
| Presence and the soft lock | Any signed-in user sees who else has an entry open (user id, name, since), never an email or IP. A tab id is checked (`A-Za-z0-9_-`, 6 to 40) and kept per user, so one user cannot speak for another's tab. Only someone who may edit the entry can hold or take its lock; a take-over is audited. The lock never refuses a save (the version check still guards against overwriting), so it cannot be used to keep others from working. | `presence.test.mjs` |
| Many entries at once (find and replace, bulk actions) | Editors and above only. Every changed entry goes through the same checks as a save by that user (rights, status and protection keys, own author, raw HTML, URL schemes, page code, the site's `validate`); one that fails is left out with the reason. The search is plain text: the query is escaped before it becomes a pattern, so no input can make the search slow (no user patterns). Each match is sorted by where it sits (`content/find-places.mjs`): only plain words are replaced unless the request names another group, so a link address, image path, HTML tag or attribute, code or a field name never changes by accident (the screen shows those groups unticked). The new text is inserted literally (`$&` is not a back-reference), and in JSON entries it is JSON-escaped so the file stays valid. Stale entries (changed since the preview) are left out. One commit for all, one job for the live ones; a failure reverts each untouched entry and takes trashed ones out of the trash. Audited (`site.replace`, `entries.bulk`). A rename of a category, tag or author everywhere (`rename`, the taxonomy screen) is the same bulk change: it never touches status keys, page code, the title or the address fields. Deleting many media files (`POST /media/delete`) checks each file on its own like a single delete (rights, then "still used" against every entry, inside the repo lock); the rows it removes are kept in the database only to undo it. Undo (`POST /site/undo`) reverts only a commit the audit log records as `site.replace`, `media.replace`, `media.delete.many` (that last one also by whoever deleted them) or a bulk field change (`entries.bulk` set/add/remove/rename, never an unpublish, so an Undo cannot put an entry live again), once, and only in entries whose text is still exactly what that commit wrote (anything changed since, a publish included, is left alone and named), so it can only put back text that was in the site before; audited as `site.undo`. | `undo.test.mjs`; `media-bulk.test.mjs`; `taxonomy.test.mjs`; `find-safety.test.mjs`: "a plain replace changes the words and never an address, image, tag or code", "a link address changes only when that group is ticked on purpose"; `find-bulk.test.mjs`: "with the new text: each entry says whether it may change (a status key may not)", "replace: … the new text taken literally; a stale entry is left out", "in a JSON entry the new text is written as JSON writes it", "a failed deploy puts the trashed entries back …"; e2e: find and replace, then change many entries |
| Scheduled publishing | The scheduler builds once when any `publishAt` passes since the last successful scheduled build. It gives up after 3 failed tries (audited). A due entry the publish rules stop is held as a draft that keeps its time, so no other build can put it live; it goes live only once the rules pass again (checked again inside the run) or by "Publish anyway", which needs Editor or above and is audited (`entry.publish.anyway`) with the rules passed over. The site's own checks are never skipped. | "schedule: future only, not for live entries; the scheduler builds when the time comes"; `notices.test.mjs`: "held, still scheduled …", "publish anyway: editors and above only …", "once fixed, the next run puts a held entry live; a failed deploy holds it again"; e2e: held |

### Uploads

| Control | How | Proof |
|---|---|---|
| Type sniffing | Magic bytes only: JPEG, PNG, GIF, WebP, AVIF. The name and Content-Type are ignored. | `media.test.mjs`: "SVG, HTML and unknown bytes are refused whatever the name says"; `unit.test.mjs` sniffing |
| PDF documents | Sniffed by `%PDF-`, stored as uploaded (never re-encoded, so a PDF's own script or form stays in it) and served by the CMS only as a download (`Content-Disposition: attachment`, `nosniff`), so a PDF never opens inside the editor's origin. On the site the nginx recipes (`deploy/nginx/site.conf`, `production.conf`) serve `*.pdf` the same way (`location ~* \.pdf$`: attachment, nosniff), guarded by `unit.test.mjs` "the site nginx recipes serve PDFs as downloads…"; a site with its own nginx copies that location. `media.documents: false` refuses them. | `uploads.test.mjs`: "a PDF is stored as it is and downloads (never drawn on the editor origin)" |
| iPhone photos (HEIC) | Recognised by the ISO-BMFF brand, decoded and re-encoded to JPEG like any photo (metadata gone). The optional converter (`media.heicCommand`) is operator argv with `{in}`/`{out}` file paths only (no shell, allowlisted environment, 60 s), in a private temporary folder removed afterwards; its output must sniff as a JPEG and is then re-encoded like any upload. When neither the image library nor the converter can read it, `415` with how to send a JPEG; never stored raw. | `uploads.test.mjs` HEIC tests, including "a real HEIC photo (made with sips): refused … by sharp alone; converted by media.heicCommand" |
| SVG | Refused (it can carry script). SVGs go into the repo by git, reviewed. | same |
| Imports never sit in memory | A media zip (`POST media/import/zip`) and a Library file (`POST library/import`) are streamed to a file under `<dataDir>/tmp` (dir 0700, file 0600; counted as it streams, so a lying `Content-Length` does not help) and refused over `media.importMaxBytes` / `library.importMaxBytes` (64 MB by default, 1 MB to 2 GB; `413`, the file removed). The zip is read in place (`fileSource`: the list of files, then one entry at a time); the file goes when the import's job ends, however it ends. One import runs at a time per server (`409 busy` for a second). The single-file upload (`POST media`, 10 MB) is unchanged. | `import-limits.test.mjs`: "the zip reader: the same files from a file on disk as from a Buffer…", "a media zip over media.importMaxBytes is 413 and leaves no file…", "one import at a time…", "a Library import over library.importMaxBytes is 413…", "the limits are config…" |
| Re-encode | Decoded and re-encoded with sharp (libvips): metadata stripped, trailing payloads dropped, auto-rotated, longest side capped at 2560 px, 50 Mpx input limit. Without sharp, raster uploads are refused (`503`) unless the operator sets `media.reencode: false`, which keeps sniffing and limits but stores the bytes as uploaded (weaker: metadata and appended bytes stay). | `media.test.mjs`: "a PNG is re-encoded ..." (polyglot `<script>` after IEND is gone), "without an image codec ... 503"; with `MARKSTAGE_SHARP` set, "JPEG with EXIF + trailing payload comes out clean and resized" (real sharp 0.35) |
| Size | 10 MB default, checked against Content-Length and while streaming | "size limit (413) ..." |
| Safe names | A slug of the name plus the sniffed extension, under `YYYY/MM/`. Never overwrites (`-2`, `-3`). The media folder is realpath-checked inside the repo. | "a PNG is re-encoded, stored under YYYY/MM ..." (`../../Evil Name.PNG` becomes `evil-name.png`) |
| Delete only unused | `409` with the list of entries that still use the file; deleting many at once leaves each used file and names its entries | "delete only when unused; contributors cannot delete"; `media-bulk.test.mjs`: "only the unused files this person may delete go, in one commit …" |
| Image edits keep the original | An edit (crop, rotate, annotate in the editor) is uploaded with `from=<mid>` and goes through the same sniffing, re-encode and size limit as any upload. It is a new file; the original's bytes are never touched. | `ux.test.mjs`: "an image edit is a new file next to the original, which stays"; e2e: the rotated copy is 300×480, the original still 480×300 |
| Stock photos (no SSRF, key stays server-side) | The provider key is read from `MARKSTAGE_STOCK_KEY`, a key file or config.json (data dir, outside the repo) and is sent only to the provider's API. The browser sends a photo **id**, never a URL: the server asks the provider for that id and downloads only from the provider's image hosts over https (a redirect elsewhere fails), with the upload size cap, then sniffs and re-encodes it like an upload. Thumbnails come through the server from the URLs of the provider's own search answer, by an opaque token. Errors never echo the key. | `ux.test.mjs`: "search goes through the server with the site key ... the key never reaches the browser", "import fetches the photo by id ..." (an off-host photo link is refused and never fetched; a URL as the id is 400; a non-image is 415); e2e: the page never contains the key |

### Password-protected pages

| Control | How | Proof |
|---|---|---|
| Never public | The site builds protected entries to a private folder only (site contract) | `protect.test.mjs`: "protecting a live page rebuilds it into the private output" |
| Password storage | scrypt hash in the data dir; the repo only has `protected: true` | same test checks the source has no password |
| Signed per-page cookie | HMAC-SHA256 over (page path, password version, expiry), with a random key kept in the data dir. Path-scoped, HttpOnly, Secure, SameSite=Lax, 12 h. A new password voids old cookies. | "wrong password: 401 form; right password: 303 ..." (forged expiry refused), "a new password ends every old cookie ..." |
| Guessing | A page password is 8 to 200 characters (`422` in plain words). IP rate limit + progressive lockout per (page, address), so one guesser locks only themselves out; the page for everyone only after `login.accountMaxFailures` (50) misses in an hour; each lock audited on `page.unlock.fail`. Origin must be the site. | "setting a password needs the publish right…" (7 characters refused), "unlock from another origin is refused; repeated misses lock the page for that address, not for everyone" |
| noindex | `X-Robots-Tag: noindex, nofollow` and `<meta name="robots">` on the form and on the page; `Cache-Control: private, no-store` | "a visitor sees the password form (noindex), never the page" |
| Isolation | Site host names reach only the gate: the CMS API and the editor answer `404` there, and only protected pages from the private folder are served (traversal-checked) | "the site host reaches only the gate: no CMS API, no editor, no other files" |

### Site forms

| Control | How | Proof (`forms.test.mjs`) |
|---|---|---|
| Only from the site | `POST /markstage/forms/<id>` is answered on `siteHosts` only, and only with `Origin` = `https://` one of them (refusals audited `security.origin`). On the CMS host the path is the editor's (read only); on a site host nothing else of Markstage answers. | "only from the site: no Origin, another site, or the CMS host are refused and nothing is kept" |
| The visitor's address | From the connection, or the hop a trusted proxy appended (`trustProxy`); a posted `ip` and a forged `X-Forwarded-For` without `trustProxy` are ignored. (The WordPress handler this replaces took `ip` from the body into its SQL.) | "a visitor sends the contact form…" (posted ip ignored), "three a day…" (forged header ignored) |
| Limits | `perDay` (3) a day per form from one address, and for one email address in any case, so the thank-you mail cannot be aimed at a stranger more than that; 20 a day from one address and 60 a day from one network (IPv4 /24, IPv6 /64) including spam. | "three a day: from one address, and for one email from anywhere", "one network is capped like one address: 60 a day from an IPv4 /24 or an IPv6 /64, spam included", "netOf…" |
| A flood never turns the form off | Past `perHour` (300, per form, real messages only: spam never counts) a message is stored as `held`, the visitor answered as usual, nobody mailed and nothing sent to the CRM yet; the administrators get one `form.held` alert an hour (audited `forms.held`). Every minute held messages go out oldest first while the hour is under the cap again. So a burst from many addresses costs the team a delay, never a visitor's message. | "past perHour (real messages only) a message is held: the visitor is answered, nobody mailed, the administrators told once; it goes out when the hour calms down" |
| Bots | Honeypot field and a minimum fill time: kept as spam (deleted after 30 days), answered `200`, nobody mailed or told. | "bots: the honeypot and a form sent within 3 seconds…" |
| What is kept | Only the form's own fields (a posted file path, IP or anything else is dropped; the old handler mailed a server file named in the body), control and bidi characters removed, lengths and types checked. Parameterised SQL only. In the data dir, never the repo. | "a visitor sends the contact form…" (`tmpfile`, `ip`, `city` not kept); "form helpers" |
| Mail | Plain text; header values lose line breaks; `Reply-To` is one checked address or left out. The thank-you mail greets by name only when the name does not look like a link or an address; its words are changed only by an owner or administrator (version-checked, audited, kept in the data dir 0600). | "form helpers": "a visitor is greeted by name, but never by a link or an address"; "the thank-you mail: changed in Settings…" |
| Who reads it | Editors and above read, mark handled or spam, give a message to an editor or above, and add notes; owner/administrator delete, export, and see the visitor's address and browser. Each change is checked against the message's version (`409` when someone changed it meanwhile) and audited without the message or note text. A person's alerts in the Inbox are theirs alone (`404` to anyone else). CSV cells starting with `= + - @` are made text. | "the Inbox: messages and my alerts in one list…", "a message: its fields…, handled with a version, given to a person…", "owners and administrators export (CSV) and delete…" |
| Retention | Leads kept forever unless a form sets `keepDays`; spam after 30 days; addresses and browsers cleared after 30 days (hourly; audited `forms.retention`). Stored before any mail; a failed team mail is kept, marked and retried; leads are in the backups. | "retention: leads are kept forever unless keepDays is set…", "a lead is stored first…", `backup.test.mjs` "back up now…" (the restored Inbox) |
| Approximate place | From the connection's address (or the trusted proxy's hop) and a city file on this server: no lookup service, nothing sent out, a posted `location` or `city` ignored. Only the place is kept with the message. The file is checked before it is used; a URL must be https (http only for this machine). | `geo.test.mjs` |
| Odoo | The address and sign-in come from the environment only (`<env>_URL`, `_DB`, `_EMAIL`, `_PASSWORD`, `_ENABLE`); the config names the prefix and refuses any other key. https only (http only for this machine), no sign-in inside the URL. They are never logged, audited, kept or answered: an error that quotes one (Odoo's fault text) has it replaced by `[hidden]`. The push runs after the message is stored and answered, so Odoo can neither lose a message nor slow the visitor; spam and non-production messages never go. Same fields and lookups as the old theme, without its file attachment (which sent a server file named in the request). | `odoo.test.mjs` (a stand-in XML-RPC server, never a real Odoo): "the lead is the old theme’s…", "Odoo down…", "the sign-in is nowhere…" (every file under the data folder, the logs and the answers searched for the three values) |
| WordPress import | Read only from the dump file; one table, parsed as data (never run); the old IP addresses are left behind; idempotent on the WordPress id; nobody mailed. Proven on the real 2026-10-27 backup in a scratch data dir (148 rows, 0 skipped, a second run adds 0). | `forms-import.test.mjs` |

### Alerts

| Control | How | Proof (`alert-rules.test.mjs`) |
|---|---|---|
| Safety alerts can't be silenced | A failed backup, an invite, a role change (or an account turned off or on, or a new owner) and a sign-in from a new device are always on, always in the editor and by mail (a person picks only now or the daily digest); the rules and a person's choices that would stop them are refused (`400`), and a hand-edited rules file is overridden. | "a rule is checked in plain words; safety alerts stay on…", "safety: an invite and a role change…" |
| New device | A random device id per browser in an HttpOnly, Secure, SameSite=Strict `__Host-` cookie (400 days), stored hashed per person. A sign-in from one the person never used tells them (browser and OS, address, time); their first device is not news. It goes to them only, never to a shared address. Markstage's cookies, this one included, never reach site code in previews (stripped by name prefix). | "safety: a sign-in from a new device tells the person…"; `preview.test.mjs` "the dev server gets no Markstage cookies…" |
| Rules and choices | Owner and administrator change the site's rules and the sender name (version-checked, `409` when stale); each person only their own choices (version-checked too). Both audited with before and after. The rules file is in the data dir, mode 0600 (it holds addresses). The sender name is a plain name (no `< > @ " , ; :`), so it cannot add an address or a header. | "a changed rule: who, which channels, off; kept in the data dir (0600), audited…", "the sender name…", "My alerts…" |

### Preview render

| Control | How | Proof (`preview.test.mjs`) |
|---|---|---|
| Own origin | `preview.origin` must differ from the CMS origin and from site hosts, and must be https in production. A second listener answers it, with its own Host allowlist (421) | "config: the preview origin must not be the CMS origin or a site host"; "a wrong Host on the preview listener is refused" |
| Sign-in without secrets in URLs | A CMS page posts a one-time 60 s ticket (stored hashed) in a form body. The preview origin accepts it only with `Origin` = CMS and turns it into an HttpOnly cookie bound to the CMS session | "sign-in hand-off: CMS session required, ticket only in a form body, one use, CMS origin only" |
| The measuring agent | The preview origin adds one same-origin script (from the editor build) to the pages it proxies. It talks only to the CMS origins named in its tag, and answers only its parent window from those origins; the editor accepts only the preview origin. No data from the CMS goes to the page. | `preview.test.mjs` "every proxied page gets the agent…"; Chromium run in API.md |
| Hand-off works in real browsers | The CMS hand-off page uses `Referrer-Policy: strict-origin` (the origin only, never the path), so the browser sends `Origin` on the ticket POST. With `no-referrer`, Chromium sends `Origin: null`, which `preview-enter` refuses. Found by the Chromium run. | "sign-in hand-off…" asserts the policy |
| Dies with the session | Every preview request re-checks the bound CMS session (revoked, idle, absolute, disabled user) | "signing out of the CMS ends the preview cookie too" |
| Never the content repo | The viewer's autosave is written into a private git clone in the data dir. The repo stays clean | "the viewer's autosave is rendered from the clone; the content repo is untouched" |
| Per-viewer state | Page loads are serialized: the clone shows exactly one viewer's state while that viewer's page renders | "two viewers: each sees their own state (serialized)" |
| Site code sees no Markstage secrets | Session and preview cookies are removed, Host and Origin are rewritten to loopback, and the dev server gets the allowlisted environment plus `MARKSTAGE_PREVIEW=1` | "the dev server gets no Markstage cookies, a loopback Host, MARKSTAGE_PREVIEW=1, an odd port in range" |
| HMR socket | Viewers only, `Origin` must be the preview origin, cookies stripped | "HMR socket: viewers only, same origin only, proxied without Markstage cookies" |
| Framing | Proxied answers get `frame-ancestors <CMS origin>`; the site's `X-Frame-Options` is dropped; `noindex`, `no-store` | asserted in the autosave test |
| Lifetime | Started on demand on an odd loopback port, stopped when idle, stopped with the server | "stopped when idle, started again on the next request"; the real-site run checks the port is free after shutdown |

### Environments

| Control | How | Proof |
|---|---|---|
| Rules decide, twice | Every plan, run, rollback and preview asks the promotion rules (deny wins, no rule is deny); a run asks again with the time, the runner's role and the approvals as they are then, and once more when its job starts. Each refusal names the rule and is audited. | `env-rules.test.mjs` (table cases); `env-flow.test.mjs`: "a person the rules do not allow is refused, in words, and it is audited", "a freeze that begins between the plan and the run refuses the run" |
| Nothing changes until it runs | A plan merges with no working copy (`git merge-tree`) and builds in a throwaway work tree. A run fast-forwards only from the commit the plan saw; a failure before the site is live puts the branch back. Approvals are tied to the exact merge commit. Plans expire after 7 days and go stale when the branch moves. | `env-flow.test.mjs`: "a failed build leaves production unchanged", "a plan goes stale"; `env-safety.test.mjs`: "expires" |
| Personal tokens | `mst_` + 32 random bytes, stored as SHA-256, shown once; at most 90 days; `/env/*` only, scoped `env:read` / `env:promote`; made and revoked in a browser session only; a revoked token stops a running job at its next step; 20 misses per address in 10 minutes and it waits; every use keeps its time and address. Bearer requests skip the Origin and CSRF checks because no browser sends that header on its own. | `env-safety.test.mjs`: "personal tokens: …" |
| Staging is not public | noindex on every answer; the site and its previews only for people with an account (a one-time ticket from the CMS, then a cookie signed for that host, HttpOnly, 12 hours); forms mail nobody; purge, IndexNow, Slack and the webhook off unless kept. | `env-safety.test.mjs`: "behind sign-in", "Test form: not sent", "test alert goes to the person who sent it only"; `env-flow.test.mjs`: "noindex on every answer" |
| AI wording | Off without a key (from a file outside the repo or the environment, never config.json; the same rule as the AI suggestions). The model gets the facts JSON and the changed file names, never page text; its words are dropped when they state a number the facts do not have, and the facts words always show beside them. | `env-safety.test.mjs`: "the summary" |
| Git from requests | Branch names are checked against a strict pattern before they reach git; shas must be full hex; git runs with execFile (no shell), no terminal prompt, ssh in batch mode. | `env-safety.test.mjs`: config; `env-cli.test.mjs` |

### AI agents (the MCP server)

docs/API-MCP.md. Tests: `mcp.test.mjs`, `mcp-roles.test.mjs`, `mcp-roundtrip.test.mjs`, `mcp-cli.test.mjs`,
`mcp-build.test.mjs`; the token screen `e2e/tokens.e2e.mjs`.

| Control | How | Proof |
|---|---|---|
| Its own token | `mcp:read` / `mcp:draft`, never mixed with `env:` (`400`); `/mcp` only (`403` elsewhere); a CLI token and a browser session are refused on `/mcp` (`403`); made and revoked in a browser session only; in the `Authorization` header only, never a URL; stored as SHA-256 like every personal token | `mcp.test.mjs`: "tokens: only an MCP token…", "an expired token is refused"; `mcp-cli.test.mjs`: the CLI's `login` refuses it |
| Where it answers | The CMS origin only: the site's hosts and the share origin answer `404` for `/mcp` and every CMS path, whatever the method. A browser `Origin` other than the CMS's is `403`, audited; no `Origin` is fine (no browser sends a bearer token on its own) | "only on the CMS origin…", "Origin: …" |
| No publishing | No tool publishes, deletes, moves or promotes. `update_entry` saves drafts only (`409 live` otherwise); `create_draft` only where there are drafts (`422 no-drafts`); a live page's change goes into a release that is not scheduled (`409 scheduled`, checked again inside the add), which a person publishes | `mcp-roles.test.mjs`: "an author…", "an editor…", "add_to_release…", "a release scheduled while the agent adds to it…"; `mcp-build.test.mjs`: the example blog built with Astro before and after every write tool is the same, byte for byte (pages, sitemap, feed) |
| The person's rights | Every write goes through the editor's own route as the token's person (rights, version, locks, synced copies, links, raw HTML, status keys, `validate`). Reads show only what that person may read, narrower than the editor for authors and contributors (live entries and their own drafts; also a Library item's pages and a release's entries; plans for editors and up; no revisions); an entry they may not read gets the words of one that does not exist | "reads follow the role…", "what else names a draft…", "a contributor…"; `mcp.test.mjs`: "a person with no rights to a draft never learns it is there" |
| Locked and synced blocks | Stricter than a person's save: any change, removal or detach of a synced block, any change to a locked block, any lock put on or taken off: `423`, nothing written or added | `mcp-roundtrip.test.mjs`: "synced blocks…", "locks…" (core's site-shaped fixture pages, both write tools) |
| Lossless | Entries are read and written as their files' text; sent back unchanged, nothing is written and no commit is made | "get_entry, then update_entry with what it gave…" (every page and article) |
| No secrets out | Every answer and error is scrubbed last: secret-named environment values, a form's CRM sign-in, secret-keyed config values, git remote addresses, a sign-in in a URL, people's emails (and `email` keys); 8 characters or more only. Search and excerpts are cut on the scrubbed text. A source carrying `[hidden]` is refused (`422 hidden`) so a scrubbed value is never written over the real one | `mcp.test.mjs`: "no secret in any answer…" (planted values grepped in every answer), "the scrub on its own…" |
| Rate limit | 120 calls a minute per token, 30 writes; `429` with `Retry-After`; `mcp.limited` audited once a minute | "at most 120 calls a minute per token…" |
| Audit | `mcp.call` per tool call; the rows a call leads to and its commit message say `via: mcp` and the token's name; release items keep it, and `release.publish` / `release.blocked` list them as `mcpItems` | "every call is audited as via MCP…"; `mcp-roles.test.mjs`: "at its time: …" |

### AI suggestions

docs/API-AI.md. Tests: `ai.test.mjs`, `ai-provider.test.mjs`.

| Control | How | Proof |
|---|---|---|
| Never commits | The routes write no file, git or content; only the `ai.suggest` audit row. Accepting goes through the normal save routes | `ai.test.mjs`: "asking commits nothing…" |
| The key | `MARKSTAGE_AI_KEY` in the environment, or `ai.keyFile` outside the content repo (one inside is refused at start, with why; `key` in config.json refused too), one rule with the plan summary; sent in `x-api-key` only; the file's value scrubbed like a secret-named variable; never in the database, a URL, the audit, an answer or an error; provider failures are fixed words; no key: off, in words (`503 ai-off`), nothing sent | `ai-provider.test.mjs`: "the request…", "each failure is fixed words with no key in them", "no key…", "the key from ai.keyFile…", "not in what the model reads, the answer, an error or the audit" (a made-up key planted), "a key from ai.keyFile is hidden…"; `ai.test.mjs`: "off in words" |
| No secrets to the model or back | What the model reads, every answer and every error go through the MCP scrubber | `ai-provider.test.mjs`: "not in what the model reads…" |
| The person's rights | A browser session only (MCP and CLI tokens `403`); the MCP `readable` rule (authors and contributors: live entries and their own drafts; another is `404` like a missing one); a plan's summary for editors and up | `ai.test.mjs`: "the readable rule…", "a promotion summary is for editors and up…", "only a session asks…"; `ai-provider.test.mjs`: translations of a draft |
| Files | An image only from inside the media folder, by real path, no symbolic link, no `..` out; PDFs, SVGs and non-images refused | `ai.test.mjs`: "an image outside the media folder, through a link, or not an image is refused" |
| Cost | Size caps (context 2,000, text 20,000, a field 1,000: `413`); `perMinute` and `perDay` asks per person, rolling, from the audit plus the asks running (`429` with `Retry-After`; `ai.limited` once a minute) | `ai.test.mjs`: "sizes are capped…", "per minute, then per day…" |
| Audit | `ai.suggest`: who, kind, target, provider, model, token counts; `ok: false` with the code on failure; never the prompt or the answer | `ai.test.mjs`: "the audit says who…" (a marker in the prompt is in no audit row) |
| Content is data | Each prompt says the page's words are data, never instructions; each answer is checked for its shape (`502` otherwise); a summary stating numbers the plan does not have is dropped | `ai-provider.test.mjs`: "a model answer in another shape…"; `env-safety.test.mjs`: "the summary" |

### Importing

docs/API-IMPORT.md and docs/IMPORT.md. Tests: `import.test.mjs`, `import-*.test.mjs`.

| Control | How | Proof |
|---|---|---|
| A plan first | `POST import` writes nothing and fetches nothing; only its maker runs it, once, within the hour, and the run makes the plan again at its time | "the plan writes nothing and fetches nothing…", "editors and up; a run by its maker only…", "after an hour it must be made again" |
| The editor's rules | Each entry through the editor's create and save: rights, unsafe links, raw HTML, locks (`423` in the plan), synced copies, no move by a save, the site's `validate`; drafts only, status kept on update | "problems are per item…", "locks are kept…", "a changed source updates what it made…" |
| Idempotent, never over a person | Remembered by source and source id with the file's sha1 as written; unchanged is left alone; a file a person changed or deleted since is skipped unless `overwrite: true` | "again with the same payload…", "a changed source updates…" |
| Media | Fetched through the Library's SSRF guard (a private or metadata address is a problem, never fetched), then the upload's pipeline (sniffed, no SVG, re-encoded) | "problems are per item…" (169.254.169.254 refused) |
| Cost | At most 500 entries and 200 media files a payload, 1 MB a body, the server's body limit; editors and up | "…wrong shapes are 422 naming the field" |
| A whole site: SSRF | Every API answer and picture through the same guard, also after a redirect; answers must be JSON (20 MB, 20 s each; 64 MB and 5 minutes a read; 50 pages of a list), pictures an image or PDF type, then sniffed and re-encoded | `import-sources.test.mjs`: "private, loopback and link-local addresses are refused, also after a redirect, and never contacted", "pictures at private addresses, behind a redirect to one, or that are not pictures are not brought in" |
| A whole site: credentials | An application password, Content API key or Prismic token is used for the plan's one read only, sent to the source's origin only, replaced by `[hidden]` in any error, never stored (the run uses the bundle the plan read); the command line takes it from a file or `MARKSTAGE_IMPORT_SECRET`, never an argument | `import-sources.test.mjs`: "…read once, used for that read only, kept nowhere" (every database table and data-dir log searched), "a wrong key is refused in words…"; `import-cli.test.mjs`: "secrets never on the command line" |
| A whole site: dry run and re-runs | The plan writes and fetches nothing beyond the source; a second run of the same source changes and fetches nothing; content becomes Markdown with scripts, forms and frames dropped and noted | `import-wordpress.test.mjs`: "the dry run writes nothing…", "again: nothing changes…"; `import-convert.test.mjs`: "nothing that runs comes in…" |

### Webhooks

docs/API-WEBHOOKS.md. Tests: `webhooks.test.mjs`.

| Control | How | Proof |
|---|---|---|
| Signed | Each POST carries `Markstage-Signature: t=…,v1=…`, HMAC-SHA256 with the hook's own secret of the time and the body; a new secret stops the old one at once | "an event: a signed POST…", "a new secret signs from now on…" |
| Secret shown once | `whsec_` + 32 random bytes, in the answer that made it only; never in a list, the audit log or an error | "made by an owner: the secret once, never again…" |
| SSRF | The address passes the Library's guard (public addresses after DNS, ports 80 and 443, no sign-in) when saved and at every send, must be https on 443, and a redirect is never followed (`safePost`) | "the address is checked…" (169.254.169.254, 10/8, a sign-in, ftp), "https only", "a redirect is not followed…" |
| What is told | A payload names what changed (ids, the page's path, the commit, who by name), never its text, an email or a secret | "an event: … never its text or an email" |
| What is kept | Each try's answer: its code and first 500 characters, with the server's secrets and the hook's secret replaced by `[hidden]`; addresses shown with query values and sign-in hidden; deliveries kept 30 days | "a failing address…" (a planted server token and the secret echoed back are hidden), "made by an owner…" (`?token=[hidden]`) |
| Cost | At most 20 hooks; 10 s and 64 KB an answer; one delivery at a time; six tries (backoff 1, 5, 30, 120, 360 minutes), then given up and the administrators told | "a failing address: tried again after…" |
| Not from staging | Outside production deliveries are `held`, unless `environment.keep` lists `webhooks` | "staging with keep []: held, never sent" |
| Who | Owner and administrators; each change audited with the address's host only | "made by an owner…" (an editor gets 403) |

### Custom roles

docs/API-ROLES.md. Tests: `custom-roles.test.mjs`.

| Control | How | Proof |
|---|---|---|
| No way up | An allow cannot give a right that is the owner's and administrators' only (refused when the role is saved); a role on administrator is the owner's to make, change, remove and give; the owner cannot be given one | "the owner and administrators only; a role is checked in plain words", "a role on administrator is the owner’s…" |
| Deny wins | Any rule that denies applies over every allow; with no rule the base role decides, so a broken role never gives more than its base | "an allow gives what the base lacks…; a deny takes one away; no rule leaves the base" |
| One decision point | `roles.mjs` (`can`, `entryCan`, `canCreate`, `canRawHtml`) asks the role first, so every route and an agent's token follow it; a field-limited edit is checked on the saved file, whichever route the text came by | "a translator: their locale’s words…" (the source view's body change refused) |
| Changes are seen | Audited, version-checked (`409`), and a safety alert to the administrators; removing a role leaves its people on its base | "removed: its people keep its base; every change audited and the administrators told" |

### Single sign-on

docs/API-SSO.md. Tests: `sso.test.mjs` (a provider on loopback, `fake-oidc.mjs`).

| Control | How | Proof |
|---|---|---|
| The browser that started it | A random state, nonce and PKCE verifier (S256) per sign-in, kept on the server (the state hashed) for 10 minutes; the state also in an HttpOnly `__Host-` cookie (`SameSite=Lax`). The callback needs both to match and an unused row for that provider, then marks it used | "the state is this browser’s, once…" |
| The ID token | RS256, PS256 or ES256 only (never `none` or HMAC), by a key the provider lists, of the right type; `iss`, `aud`/`azp`, `exp`/`iat` (60 s leeway), `nonce` and `sub` checked; the discovery document must name the configured issuer | "the ID token is checked: signature, algorithm, issuer, audience, nonce, expiry" (7 tampered tokens) |
| Who gets in | By the provider's `sub` once linked, else by an email the provider says is verified; a person is made only by `autoCreate`, for its `domains`, as contributor, author or editor; `domains` is checked on every sign-in; a turned-off account stays out; one link per person and provider | "who gets in: no unverified email, no stranger, no turned-off account…" |
| Two-step sign-in kept | A person with it on gives their code after the provider; the challenge in an HttpOnly `__Host-` cookie for 5 minutes, never the URL | "two-step sign-in is still asked…" |
| Where it lands | `next` must be one of the editor's own screens (`#/…`, not sign-in), else `#/`: no open redirect | "the state is this browser’s…" (an external `next`) |
| The provider's addresses | Discovery, keys and the token through the SSRF guard; the token request follows no redirect | `oidc.mjs` (`safeFetch`, `safePost`) |
| The client secret | `MARKSTAGE_SSO_<ID>_SECRET` or a file outside the repo, never config.json (a `clientSecret` key stops the start); in the scrubber; the start fails without it | "a client secret is never told…", "mistakes stop the start, in words" |
| A break-glass | With `passwordLogin: false` only the owner signs in with a password, for a provider that is down | "passwords are for the owner alone…" |
| Seen | `auth.sso`, `auth.sso.fail` (with which check), `auth.sso.link`, `auth.sso.unlink`; a person made by `autoCreate` tells the administrators | "an invited person…" (the audit), "who gets in…" (the notice) |

### Integration fields

docs/API-INTEGRATIONS.md. Tests: `integrations.test.mjs`.

| Control | How | Proof |
|---|---|---|
| SSRF | The JSON address is fetched by the server through the Library's guard (public addresses after DNS and at each redirect, ports 80 and 443); the config refuses http and a sign-in in the address | "integration config: mistakes are refused in words" |
| A sign-in stays home | It goes in a header to the first address's origin only; a redirect to another site is asked without it | "a redirect: the sign-in goes along on the same site, never to another" |
| Secrets out of the config | `auth.env` must name a `MARKSTAGE_INTEGRATION_*` variable (the config cannot send `MARKSTAGE_AI_KEY` or any other secret of the server), or `auth.keyFile` an absolute path outside the repo; the value is in the scrubber, never in an answer, the audit or an error; the address is shown by host only | "…the address and the token never shown", "a failed fetch …" (an answer echoing the token), "mistakes are refused in words" |
| Size and time | At most `maxKB` (5 MB at most) after unzipping, 15 s, 5000 options, 200 characters a value, control characters dropped | "caps: at most 5000 items kept, and an answer over maxKB is not read" |
| What a save may write | A bound setting keeps its value, is emptied, or takes one from the kept list; anything else is `422`, whichever route the text came by (the save guard) | "a save keeps to the list…" |
| Cost and noise | One fetch at a time, on its schedule; a person's refresh once a minute (editors and up); a failure alerts once | "refresh: editors and up, once a minute, audited", "a failed fetch … tells the administrators once" |

### Fetching from the web

The Library's import from a web page and the media import from addresses make the server fetch URLs a signed-in
person typed (src/library/fetch.mjs). The guard:

| Control | How | Proof |
|---|---|---|
| Public addresses only | Every address a name resolves to must be public: no loopback, 0/8, 10/8, 100.64/10, 169.254/16 (cloud metadata), 172.16/12, 192.168/16, 192.0.0/24, documentation, benchmarking, multicast or reserved ranges; for IPv6 only global unicast, without documentation, 6to4, Teredo or the IETF block, and an IPv4 inside a mapped or NAT64 address is judged as that IPv4. A name with one private address among public ones is refused. `localhost`, `*.local`, `*.internal`, `home.arpa` are refused by name. | `library-fetch.test.mjs`: "public and not public addresses …", "a name that resolves to loopback, 169.254, 10/8, or to a public and a private address together, is refused" |
| No reaching around the check | The connection goes to the address that was checked (the resolver is the guard, so DNS cannot answer differently in between). An IP written in any form (`2130706433`, `0x7f000001`, `127.1`, `0177.0.0.1`, `[::ffff:127.0.0.1]`) is read as the URL standard reads it and checked before anything is sent. http and https only, ports 80 and 443, no name and password in the address. | "addresses refused before anything is sent: written as an IP in any form, local names, other ports, credentials" |
| Redirects | Followed by hand, at most 5; each new address goes through the same checks before it is contacted. | "redirects to 169.254, 10/8, loopback (another port), localhost, a private name or a mapped IPv6 are refused, and never followed" (the site's log shows only the redirecting pages were asked for) |
| Limits | A page at most 5 MB in 10 s, a picture at most the upload size in 15 s (all a page's pictures within a minute, at most 20), a robots.txt 512 KB in 5 s; the size is checked on what comes back after unzipping, so a small gzip that unpacks to gigabytes stops at the cap. | "size and time limits: too large (also once unzipped) and too slow" |
| robots.txt | A page is fetched only when the site's robots.txt allows it for `markstage` (else `*`); a robots.txt that cannot be read (5xx, no answer) refuses, none (4xx) allows. | "robots.txt" tests; `library-url-import.test.mjs`: a disallowed page is `422 robots` |
| What comes in | Page HTML is read into Markdown and then the site's own blocks; script, style, frames, forms, SVG and event attributes are dropped, links keep http(s), mailto, tel or relative addresses only. Pictures go through the upload pipeline (sniffed, never SVG, re-encoded). Editors only for the Library, authors and up for media. Audited. | `library-url-import.test.mjs`: what is shown and stored has no script, `onclick`, `onerror` or `javascript:`; the server's own port and private addresses are `400 unsafe-url` |
| Hostile content cannot stall the server | Everything fetched or uploaded is read without backtracking: robots.txt rules are matched piece by piece with indexOf (no regular expression; at most 1000 rules of up to 2048 characters), a page's tags never scan past the next `<`, nesting deeper than 100 is read flat, a WordPress export is cut with indexOf (a closing tag inside CDATA is not the end), a zip is read from its directory with sizes capped while unpacking. | `library-fetch.test.mjs`: "matching is linear …" (a rule with 200 stars against a 2,000-character path, under 50 ms); `library-url-import.test.mjs`: "hostile pages take linear time and never overflow the stack"; `library-wp.test.mjs` (unclosed items, CDATA and tags) |
| Test seam | Tests reach their own loopback site only through `createMarkstage(config, {outbound})`, a code dependency, never config; the server has no setting that widens the guard. | `web-site.mjs` allows one loopback port; "the test site's own seam does not open the rest of loopback" |

### Secrets, data and modes

| Control | How | Proof |
|---|---|---|
| Secrets outside the repo | The data dir (SQLite database, config) must be outside the content repo; the server refuses to start otherwise. The CLI sets umask 077 and `init` makes the dir 0700; the database file is chmod 600. The page-cookie key is generated into the data dir. | `unit.test.mjs`: "the data dir must be outside the content repo; collection dirs inside it" |
| Production config | `publicOrigin` required in production and must be https (http only for loopback in development) | "production needs an https publicOrigin; non-loopback http is refused" |
| Dev mode (no sign-in) | Refuses to start with `NODE_ENV=production`, on any address but `127.0.0.1`, and with any `publicOrigin` that is not a loopback address (a dev config copied behind a public proxy, `NODE_ENV` forgotten); only `MARKSTAGE_I_KNOW_DEV_NO_AUTH=1` (for test suites) lifts the origin rule, never the production one. `markstage-server check` and `serve` both refuse; `serve` prints `DEV MODE: no sign-in` on its own line in red. It still enforces the Origin and Host checks, so a website cannot drive it from the browser. | `unit.test.mjs`: "dev mode (no sign-in) refuses production and any address but 127.0.0.1", "dev mode (no sign-in) refuses a public publicOrigin even without NODE_ENV; loopback origins and the test switch pass", "no sign-in needed, but Origin and Host checks still apply" |
| Site health hook (addresses) | The site's own command from markstage.config or config.json, an argv (no shell), run in the site repo with the server's minimal environment plus `MARKSTAGE_DIST`, with a timeout; it runs only after the job queue is idle, so never on a half-built folder, one run at a time. Its output is parsed as JSON and only rows of the expected shape are kept; it is shown as text and links, never as HTML. Owner and administrators only; "Check again" is audited. | `health-addresses.test.mjs`: "editors may not", "a failing hook says why and keeps the last good answer", "the hook answer is checked", "config: the hook is an argv (no shell)" |
| Outside services (stock, IndexNow, CrUX) | Off unless the operator configures them, each with the site's own key from config or a key file outside the repo. Only https endpoints (plain http only to loopback in development, for test doubles). The CrUX key goes in a request header, never a URL; the IndexNow key never goes in a job log; the stock key never reaches the browser. Site health and the exports are owner/administrator only. | `health.test.mjs`: "speed: … the key only in a header", "owner and administrators only"; `after-deploy.test.mjs`: "the key is the site's to publish, not the log's to show" |
| Audit log | Append-only table: who, when, IP, user agent, action, target, ok, detail. Covers sign-ins (and failures, lockouts), user changes, every content write, publish jobs, uploads and refused cross-site/CSRF requests. No API changes or deletes rows. A detail is at most 4000 characters: a longer one keeps its short values (the commit, the action) and the length of each list, so an Undo still finds its change; the Undo reads the entries from the commit, never from the row. | "the audit log is admin-only and records sign-ins", "jobs list and the audit trail of publishing"; e2e lists the recorded actions; `undo-large.test.mjs` |

### nginx recipe for protected pages (production)

The tested files are `deploy/nginx/production.conf` (TLS, two host names) and `deploy/nginx/site.conf` (compose);
[DEPLOY.md](DEPLOY.md) explains them. The security-relevant points:

- The site host serves `current/public`; anything not found there goes through `auth_request /markstage/page-auth`
  (`internal`, `X-Original-URI`, the visitor's cookie). On 204 nginx serves the file from `current/private` with
  `X-Robots-Tag: noindex` and `Cache-Control: private, no-store`; on 401 Markstage shows the password form (or 404).
- Use `try_files $uri $uri/index.html @protected`, not `$uri/`: the folder of a protected page can still exist in
  the public build (public child pages), and `$uri/` makes nginx answer 403 instead of asking Markstage.
- If Markstage is down, the auth subrequest fails and nginx answers 500: protected pages fail closed.
- A request on the site host reaches only the page gate (the CMS API and editor answer 404 there). The CMS has its
  own host name, because authors can write raw HTML and the site origin must not hold the CMS session.
- Set `trustProxy: true` so the gate's rate limit sees the visitor's address from `X-Forwarded-For`.

## Reporting a problem

See [SECURITY.md](../SECURITY.md) at the repository root: GitHub's private report or the security email, what to
include, the supported versions, what is in scope, and the response promise (an answer within 3 working days).

## Dependencies

What the server runs on (checked against each `package.json` and the imports in `src/`, 2026-11-03):

- Node built-ins for everything else: `node:http`, `node:crypto` (scrypt, HMAC), `node:sqlite`, `node:child_process`.
  No web framework, no database driver, no mail library.
- `@markstage/core` (our own package, from this repo): the converter and the checks. It brings five small packages:
  `yaml`, `unified`, `remark-parse`, `remark-gfm` and `decode-named-character-reference`.
- `sharp` (optional): Node has no image codec, and re-encoding is the reliable way to strip what is not pixels.
  Without it, picture uploads are refused (`503`) unless the operator turns re-encoding off (`media.reencode: false`).
- `node:sqlite` prints an ExperimentalWarning on Node 22/24; the CLI hides that one warning only.

The policy (CONTRIBUTING.md, "Dependencies", has the full list for every package): the lockfile is committed and
every install is `npm ci`; CI runs `npm audit --omit=dev --audit-level=high` and gitleaks on every push; a release
is cut only from a clean `npm audit --omit=dev`; Dependabot proposes updates every week.

## Privacy (GDPR/PIPEDA)

For operators who must answer for personal data. Markstage keeps it on your own server: in the database
(`markstage.db` in the data dir), in the site's git history and in your backups. It sends it nowhere unless you set
up the mail, Slack, CRM, webhook or AI connections below. What it keeps, as the code has it today (2026-11-03):

| What | Where | How long |
| --- | --- | --- |
| The people who sign in: name, email, role, password hash (scrypt), 2FA secret, recovery-code hashes, last sign-in, the single sign-on link (provider, subject, email) | `users`, `recovery_codes`, `sso_identities` | Until an owner or administrator deletes the person (Users); their rows go with them. |
| Sessions: the browser (user agent) and IP address of each sign-in | `sessions` | Removed a day after a sign-out, or a day after the session's longest life (`session.absoluteHours`). |
| Known devices: a hash of a device cookie and its browser, for "a sign-in from a new device" mails | `known_devices` | Until the person is deleted. The cookie itself lasts 400 days. |
| Failed sign-ins: the email and the address they came from | `lockouts` | Cleared at the next sign-in, or once the lock and its window have passed. The per-address counter lives in memory only. |
| The audit log: who did what, when, from which IP address and browser; share-link views (the viewer's address and browser) | `audit` | **Kept with no time limit** (no retention setting yet; see "Known limits"). Owners and administrators can read it (`GET audit`, filtered by person, action and dates); removing old rows is a manual database job today. |
| Form messages from site visitors: the form's fields (name, email, phone and whatever the form asks), the page, referrer and campaign, an approximate place (only when you install a city database, `geoip`), the visitor's IP address and browser, notes and history | `form_messages`, `form_notes`, `form_events` | The IP address and browser are **cleared after 30 days**; spam goes after 30 days; the messages themselves are **kept until deleted**, unless the form sets `keepDays` (then deleted after that many days). Owners and administrators can delete a message or export the inbox (CSV). |
| Who changed the content | the site's git history: each commit's author is the person's name and email | As long as the repo's history (git keeps it for good). |
| Backups | `markstage-server backup` copies the database, `config.json` and the repo | As long as you keep the backup folders. |

What leaves the server, and only when you configure it: alert mails (SMTP) and Slack messages with the people's
names and the message's fields; a form's message to your CRM (`forms.<id>.crm`); webhooks; and, with the AI
features on, the entry text you ask about goes to the AI provider (secrets are scrubbed first, docs/API-AI.md).

For a request to see or erase someone's data: delete the person in Users (their sessions, devices and 2FA go with
them), delete their form messages in the Inbox, and know that the audit log and git history still name them; say
so in your privacy notice, or remove those rows and rewrite history by hand.

## Operator checklist

1. `markstage-server init /srv/markstage-data`. Edit `config.json`: `contentRoot`, `publicOrigin` (https),
   collections, build/deploy argv, media, and optionally `protectedPages`.
2. Run the server as its own user. That user may write the content repo and the data dir, and nothing else.
3. Put it behind a TLS reverse proxy that passes the `Host` header. Set `trustProxy: true` only when the proxy sets
   `X-Forwarded-For`.
4. `markstage-server setup-code`, then sign in at `<publicOrigin>/markstage/#/setup`. Turn on 2FA for the owner.
5. Make the deploy command atomic. Make the build exit non-zero on failure.

### Releases and share links

See docs/API-RELEASES.md.

| Control | How | Proof |
|---|---|---|
| Nothing reaches the site early | A release's items wait in the data dir (0600), outside the repo. Each is checked when it is added, as its own route would check it: a save's rights, locks, links, raw HTML, page code and `validate`; the Library's rules; an upload's sniffing and re-encoding (never an SVG). | `releases.test.mjs`: "what goes in is checked as a save would be…", "…nothing in the repo before…" |
| Nobody's change is overwritten | Each item records the version of the file it replaces. Inside the repo lock, a file changed since is named and stops the publish, and nothing is written. A picture's name is reserved, so an upload in the meantime takes another. | "a file changed on the site since it was added…"; "…an upload meanwhile takes another name" |
| The rules decide | `publish-release` from `release` (deny wins; no rule is deny). Approvals hold for the exact content (`key`) and never count the release's maker. A schedule is asked as of its time, and asked again when it is due, as the person who scheduled it with their role then; refused then, nothing is written, the release stays scheduled but blocked, and that person gets the `release.blocked` alert naming the rule (once per reason). Each refusal names the rule and is audited. | "the rules: a deny stops a publish and a schedule…", "at its time, as who scheduled it…", "a rule that needs an approval…" |
| A failure leaves the site as it was | One commit, then checks, build, verify and deploy as one job. A failure puts back every file nobody changed since, in one commit. A rollback asks the rules (`rollback`). | "a failed build puts every file back in one commit…" |
| Share links: unguessable, short-lived, revocable | 32 random bytes in `/share/<token>`, stored as SHA-256 and shown once. They expire (7 days by default, at most `share.maxDays`), and are turned off by their maker or an editor; then they answer `410`, at the token and on every page. | `share.test.mjs`: "a link turned off answers 410…", "an expired link answers 410…" |
| Share links: their own origin, nothing else reachable | `share.origin` must differ from the CMS, preview and site hosts (https in production), on its own listener with a Host allowlist (`421`). It is GET and HEAD only, serves only that link's build (no `..`, no symlink out), has no API and no editor, and ignores a cookie whose HMAC is wrong. The token is used once, into an HttpOnly cookie for that link; after the `303` the address bar and `Referer` no longer hold it. | "nothing else is reachable…"; e2e `share.e2e.mjs` |
| Share links: not for search engines, not cached | `X-Robots-Tag: noindex, nofollow, noarchive`, `no-store`, `no-referrer` and `frame-ancestors 'none'` on every answer, and a `robots.txt` that disallows everything, whatever the build has. | "a link opens the release’s preview without an account…" |
| Share links: the token is never written down | The audit names the link by its id. The share listener's error log writes `/share/[link]` in place of a token. The nginx example logs the share host and the http redirect with a format that writes `/share/[link]` in the request line and the referrer, and keeps only critical errors there (nginx's error entries quote the request line). Only the token's SHA-256 is in the data folder. | `share.test.mjs` "a token is nowhere in the data folder…" (every file under it, the database's WAL and the preview builds included, read as bytes); the nginx log format run on nginx 1.29 (DEPLOY.md "Proof") |
| Share links: guessing is slowed | 30 requests to `/share/…` a minute per address (the proxy's `X-Forwarded-For` with `trustProxy`), then `429` with `Retry-After: 60`, audited once as `share.limited`. | "tries at /share/ are limited…" |
| Every view audited | `share.open`, then `share.view` per page with its path, the address and the browser; refusals are `share.refused`. | the same test |

## Known limits and follow-ups

- **Sign-in lockout: the trade-off.** Wrong passwords lock only the (account, address) pair they came from. The
  account itself locks for everyone only after 50 misses in an hour from anywhere (`login.accountMaxFailures`,
  `login.accountWindowSeconds`), and even then a browser the person signed in from before, with the right password,
  still gets in. What is left: someone who sends 50 wrong passwords an hour from many addresses can keep the person
  out **on a new device** (a new laptop, or after clearing cookies) until the lock ends (`login.lockMaxSeconds`, 10
  minutes by default) and again each hour. The way back at once: the owner or an administrator uses **Reset password** on the
  person (People & access), or the server's operator runs `markstage-server reset-password <email>`; the setup
  code that gives is not stopped by the lock, and signing in with it clears the lock (`auth.test.mjs` "locked out
  account-wide on a new device…"). A reset from the owner's own account needs that account to be signed in
  somewhere, so the owner should turn on 2FA and keep one known browser, or have shell access to the server.
- **Every signed-in role reads every entry, drafts included.** A contributor or author can open any draft, its
  Markdown source and its revisions, not only their own; the roles limit who may *change* and *publish*, not who may
  read. This is on purpose (people see what the site is about to say, and links and Library items need it). Give an
  account only to people who may see unpublished work; a draft that must stay with a few people belongs outside the
  site repo until it is ready.
- **Two-step secrets are stored as they are.** An authenticator app needs the TOTP secret itself, so the database
  keeps it as a plain value (passwords and recovery codes are hashed). Anyone who reads `markstage.db` or a backup of
  it can make that person's codes: protect the data dir and every backup like a password store (DEPLOY.md, Backups).
- The per-IP sign-in limiter (`login.ipMaxAttempts` failed tries per `login.ipWindowSeconds`; successes never
  count and clear the address), the share-link and the
  environment-gate counters live in process memory: a restart forgets them (fine for windows of minutes) and a
  second server process would not share them, so those limits count per process. One `markstage-server serve` per
  data dir is assumed; the account and page lockouts are in the database and hold across restarts; the edge
  proxy's own limits (deploy/nginx: 10 sign-in POSTs a minute per address) cover a public site.
- Audit rows for refused cross-site requests can grow under attack. There is no retention policy yet. The same goes
  for `share.view` rows: someone holding a working link can add rows until it expires or is turned off.
- A synced Library item cannot go into a release (it rewrites every page that uses it when it changes); it goes live
  from the Library on its own.
- Builds see the working tree as it is at build time. A draft saved during a build is not shipped (drafts are
  filtered), but a live entry saved by an editor during a build may be.
