# Markstage API: Environments

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). The design and the reasons are
in docs/ENVIRONMENTS.md; this file is the server's routes and shapes. Server code: `packages/server/src/env/`.

An environment is **a branch plus a server**. Each server knows which one it is (`environment` in its config.json,
below), shares one git remote with the others, and keeps its own users, Inbox, audit log and backups. A promotion or a
sync is a **plan** made and run on the **target** server: production runs "staging → production", staging runs
"my-change → staging" and "production → staging" (sync). Nothing reaches the target's branch until a plan runs.

## Server config

```json
"environment": {
  "name": "staging", "branch": "staging", "upstream": "main", "promoteTo": "production",
  "ribbon": "#b45309", "remote": "origin",
  "peers": { "production": { "branch": "main", "origin": "https://cms.example.com" } },
  "previews": { "branches": true, "host": "{branch}.staging.example.com" },
  "mail": "actor", "gate": true, "keep": []
},
"ai": { "provider": "anthropic", "model": "claude-sonnet-5-5", "keyFile": "/etc/markstage/ai.key" }
```

- No `environment`: the server is production, on the branch it has checked out.
- `peers`: the other environments' branches (so a branch is named "staging", not "a branch") and their Markstage
  origins (for the handoff link). `promoteTo` must be a peer.
- Outside production (`name` not `production`), by default:
  - every answer says `X-Robots-Tag: noindex, nofollow` (the API, the editor, forms, the gate);
  - `mail: "actor"` mails only the people an alert is about (who ran the job), never shared addresses or roles;
    `mail: "sink"` requires `notify.email.host` to be this machine (a mail catcher);
  - a site form stores the message in this environment's Inbox, mails nobody, sends no thank-you and answers
    `{"message": "Test form: not sent. …", "test": true}`;
  - the CDN purge, IndexNow, Slack and the alerts' webhook are off, unless `keep` lists them (`purge`, `indexNow`,
    `slack`, `webhook`); so are the site's webhooks (docs/API-WEBHOOKS.md): their deliveries are kept as `held` and
    never sent, unless `keep` lists `webhooks`;
  - `gate: true` puts the site's hosts behind sign-in ("The site gate" below).
- `ai`: the AI wording of a plan's summary. The key is `MARKSTAGE_AI_KEY` or the `keyFile` (outside the repo), read
  when it is used; with no key the facts alone show, with no error. `key` in config.json is refused. The same block
  sets the AI suggestions (`perMinute`, `perDay`; the same key and model): docs/API-AI.md.

## This environment

- `GET env[?fetch=1]` (signed in; a token needs `env:read`). `fetch=1` fetches the remote first: only for owners,
  administrators and people an allowing rule names for promote or sync (`canFetch` says so; anyone else gets 403),
  and at most once per 30 s for the whole server (asked sooner, the last fetch stands). `remote.error` holds git's
  own words for owners and administrators only; everyone else is told the remote could not be reached.

  ```
  {name, production, configured, branch, upstream, promoteTo, ribbon, head, live,
   upstreamHead, ahead, behind,                  // against the upstream: here only / to sync down
   remote: {name, ok, lastFetchAt, error, head, ahead, behind},   // against this branch on the remote
   peers: [{name, branch, origin}], previews: {on, host} | null, mail, gate,
   handoff: {to, url} | null, canRollback, canFetch}
  ```

  `handoff.url` opens the target's Environments page with the plan filled in, in the fragment only (no secret):
  `<peer origin>/markstage/#/environments?plan=promote&source=<branch>&sha=<sha>`; the editor adds `&reason=`.
- `GET env/branches` → `{branches: [{name, sha, at, author, subject, env, ahead, behind}], remote, lastFetch}`: the
  branches on the remote, newest first; `env` is the peer it belongs to, this one, or `branch`.

## Plans

- `POST env/plans {action, source?, to?, reason?}` → `202 {plan, job}`.
  - `action: "promote"` brings `source` (a branch on the remote) here; `"sync"` brings `source` (default: the
    upstream) here. `to`, when given, must be this environment.
  - A dry run of the rules (files not known yet) comes first: if no rule could ever allow it, `403 {error: "rule",
    rule, words}`, audited `env.promote` / `env.sync` with `ok: false`.
  - The job (kind `env-plan`) fetches, compares (`git merge-base`, `git diff`), merges with no working copy
    (`git merge-tree`), and merges conflicted pages block by block (Markdown: frontmatter leaf by leaf, a save-time
    stamp such as `modified` takes the later; the body by block) or leaf by leaf (JSON). What both sides changed
    differently is a conflict. With none open, it makes the merge commit (on no branch), builds it in a throwaway work
    tree (the site's `node_modules` linked in), runs the checks, compares the build's pages with the live build
    (`verify.public`), takes screenshots, and writes the summary.
- `GET env/plans[?status=]` → `{plans}` (newest first, at most 200; files as counts per group, conflicts without
  their texts).
- `GET env/plans/:pid` → the plan:

  ```
  {id, action, from: {env, branch, sha}, to: {env, branch, sha}, base, merged, author: {id, name},
   createdAt, expiresAt, status, note, error, version, reason, job, runJob, runBy: {id, name} | null, finishedAt, newer,
   files: {count, groups: {pages, templates, styles, config, media, other: [{path, status, kinds, group, from?}]},
           autoMerged: [path]},
   conflicts: [{id, path, entry: {collection, id, title, label} | null, kind, words, ours, theirs, merged, resolved,
                take}],
   checks: [{id, label, blocking, status: passed|failed|warned|skipped, words, entries?}] | null,
   pages: {changed, added, removed, removedWithoutRedirect} | null,
   shots: {status: done|not-available|failed, words, pages: [{path, kind, shots: [{width, before, after}]}]} | null,
   summary: {status: facts|ai|dropped, text, words, facts, ai: {model, dropped?, why?} | null} | null,
   decision: {effect: allow|needs|deny, rule: {id, name} | null, words, missing: [{kind, words}]},
   approvals: [{userId, name, role, sha, note, at, current}], link}
  ```

  - `status`: `preparing`, `conflicts`, `ready`, `blocked` (a blocking check failed), `running`, `done`,
    `failed`, `cancelled`, `stale` (this environment's branch moved since: re-plan), `expired` (not run within 7
    days). `note` says why in words.
  - `decision` is for the person asking (their role now, the approvals, the checks, the time).
  - `kind` of a conflict: `text`, `blocks` (n places), `removed-here`, `removed-incoming`, `added-both`. `ours` is
    this environment's text, `theirs` the incoming one (each cut at 400 KB).
  - `newer`: the source branch has moved on since the plan was made; the plan still promotes exactly `from.sha`.
  - `checks`: `build`, each site check (`config.checks`) on every changed entry (after-build ones on the build),
    and `redirects` (a removed page must have a redirect stub in the new build).
- `GET env/plans/:pid/shots/:file` → a PNG, by its name as `shots` gives it (`<n>-<width>-before|after.png`, such as `1-1440-after.png`). Shots need Playwright on the server
  (`playwright` or `@playwright/test`); without it `shots.status` is `not-available` and says so. At most 40 pages,
  at 1440 and 390 wide; the browser is closed when they are done.
- `POST env/plans/:pid/resolve {conflictId, take: ours|theirs|text, text?, version}` (the plan's author, an
  administrator or the owner). When none is open, the plan is checked again (`{plan, job}`); earlier approvals no
  longer match the new merge.
- `POST env/plans/:pid/approve {sha, note?}`: `sha` must be the plan's `merged` (409 with `current` if it changed);
  the author cannot approve (403). Whether an approval counts is the rules' business (the approver's role when the
  plan runs).
- `POST env/plans/:pid/run {reason?, version}` → `202 {plan, job}`.
  - The rules are asked again now: `403 {error: "rule", rule, words, missing}`, audited, when they refuse (a freeze
    that began after the plan, a missing approval or reason, a changed role). `409` with `current` when the plan is
    not `ready` (stale, expired, conflicts, blocked).
  - The job (kind `env-promote` or `env-sync`) asks the rules once more, fast-forwards this branch to the merge
    commit (refused if the branch moved), builds, runs the after-build checks, deploys, and pushes the branch to the
    remote. If a step fails before the site is live, the branch goes back (`git reset --keep`) and the live site is
    unchanged. A job started with a token stops at its next step when the token is revoked.
  - Audited `env.promote.start`, then `env.promote` / `env.sync` `{from, to, merged, release, branch, reason}`;
    alerts `env.promoted`, or `env.promote-failed` (to who ran it and the plan's author).
- `POST env/plans/:pid/cancel {version?}` (author, administrator, owner).

## Rollback

- `POST env/rollback {reason?}` → `202 {job, from, to}` (the rules' `rollback` action; `409` with no rollback
  command or no earlier release). The job puts the release before back live (`commands.rollback`), then commits on
  this branch the files of that release (a new commit: history is kept), so the branch equals the live site; it
  rebuilds the build folder and pushes. Audited `env.rollback {from, to, revert, reason}`; alert `site.rollback`.

## Rules

Kept in `<dataDir>/promotion-rules.json` (0600); the starter rules apply until someone saves. The shape and how they
are applied: docs/ENVIRONMENTS.md "Promotion rules" and the header of `src/env/rules.mjs`.

- `GET env/rules` → `{version, saved, groups, rules, starter, kinds, actions, envs, people}`.
- `PUT env/rules {version, groups, rules}` (owner, administrator; never with a token) → the view. `400` in plain
  words, `409 stale` with `current`. Audited `env.rules {added, removed, changed, groups}`; the `env.rules-changed`
  alert is a safety alert.
- `POST env/rules/check {action, from?, to?, userId?, files?: [path], at?, reason?, checks?, rules?}` → `{effect,
  rule, words, missing, trace: [{rule, matched, why}], user, files}`: what the rules (or the `rules` sent, unsaved)
  say. Another person's answer is for administrators.

## Personal tokens (the laptop CLI, and AI agents)

- `GET me/tokens` → `{tokens: [{id, name, scopes, createdAt, expiresAt, lastUsedAt, revokedAt, status}], scopes,
  mcpScopes, groups, maxDays}`; `POST me/tokens {name, scopes, days: 1..90}` → `201 {token, secret}` (the secret
  once, `mst_…`); `DELETE me/tokens/:tid` revokes. A browser session only: a token cannot manage tokens.
- Two kinds, never mixed in one token (`400` "A token is for the command line (env:…) or for an AI agent (mcp:…),
  not both: make two."): the command line's, `scopes` `[env:read, env:promote]`, reaching `/env/*`; and an AI
  agent's, `mcpScopes` `[mcp:read, mcp:draft]` (`mcp:draft` brings `mcp:read`), reaching `/mcp` only (`403`
  elsewhere). `groups` says so: `{cli: {scopes, reaches: '/env'}, mcp: {scopes, reaches: '/mcp'}}`. The agent's
  kind is docs/API-MCP.md; the rest of this section is the command line's. In the editor, Settings → Tokens makes
  both kinds: "New command line token" (`#/settings/tokens?new=cli`) and "New AI assistant token" (`?new=mcp`).
- `Authorization: Bearer mst_…` reaches `/env/*` only, as its person, with no Origin or CSRF check (a browser never
  sends it on its own). `GET` needs `env:read`, a write `env:promote`. A revoked, expired or unknown token is `401`
  (audited `security.token`); 20 misses from one address in 10 minutes and it waits (`429`). Each use keeps
  `lastUsedAt` and the address. A disabled account's tokens stop working.

## Branch previews (staging)

- `GET env/previews` → `{on, host, previews: [{slug, branch, sha, status: building|ready|failed, url, createdAt,
  builtAt, job, error}]}`.
- `POST env/previews {branch}` → `202 {preview, job}` (rules: `preview` from `branch`). The branch is checked out in
  `<dataDir>/env/previews/<slug>` and built; it is served at `https://<slug>.<previews host>/` behind the gate.
- `DELETE env/previews/:slug` (who made it, administrator, owner).

## The site gate (outside production)

The site's hosts (`siteHosts`) and the preview hosts answer only people with an account on this server:

- Without the cookie, a page answers `303` to `<CMS>/markstage/gate?host=<host>&to=<path>`. Signed in there, a page
  posts a one-time ticket (1 minute) to `https://<host>/markstage/gate-enter`, which sets `ms_gate` (HttpOnly,
  SameSite=Lax, 12 hours at most, signed for that host only) and returns to the page. The cookie is bound to the CMS
  session it was opened from: signing out of the CMS, a revoked or timed-out session, or a disabled account ends it.
- A file the build links to outside itself (a symlink, which a branch could add) is never served.
- `GET /markstage/gate-auth` on the host answers `204` or `401`, for nginx `auth_request` when nginx serves the
  build itself. Otherwise Markstage serves the build (`verify.public`, or the preview's) to a signed-in person.

## Command line

- On the server: `markstage-server env status`, `env sync [--run] --as <email>`, `env promote <branch> [--run]
  [--reason "…"] --as <email>`. The same rules, as that person; refused while the running server has a job going.
- On a laptop (`@markstage/astro`, node and git only): `markstage pull [--from main]`, `markstage login <url>
  [--token-stdin]`, `markstage status`, `markstage promote <branch> <env> [--run] [--reason "…"]`. The token is kept
  in `~/.config/markstage/credentials` (0600) and never printed. The address is the editor's: a server with another
  `basePath` is named by its path (`https://example.com/cms/`), kept with the token. `markstage login` keeps a
  command line token only (an agent's token cannot reach `/env`); `markstage mcp login` and `markstage mcp` are the
  agent's (API-MCP.md).

## Proof

`packages/server/test/env-flow.test.mjs`, `env-safety.test.mjs`, `env-cli.test.mjs` and `env-rules.test.mjs`: two
servers (production, staging) on one bare remote and a developer's clone, through the HTTP API and both command
lines. They cover: a template change and a new page promoted to staging and on to production; a sync down that keeps
a staging-only page; a conflict named in words and resolved each way (ours, theirs, a hand-merged text) and a page
both sides edited in different places merged with no conflict; a failed check that blocks; a failed build that leaves
production and its branch unchanged; a rollback after which the branch equals what is live and is pushed; a person
the rules do not allow refused in words and audited; a freeze that begins between plan and run refusing the run; a
stale and an expired plan that cannot run; staging mailing nobody, its forms saying "Test form: not sent", noindex on
every answer, the site gate and a branch preview; tokens (scopes, env routes only, 90 days, revoked mid-job, rate
limit); and the AI summary with a stubbed model (dropped when it states a number the facts do not have).
