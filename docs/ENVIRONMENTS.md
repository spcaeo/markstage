# Environments: local, staging, production

Markstage runs a site in three places: a developer's laptop, a staging server and production. Changes go up by
promotion and content comes down by sync, both as git merges. The routes, the command line and the tests that prove
them are in [API-ENV.md](API-ENV.md), under "Proof". The editor has the screens for it: the environment badge and
ribbon, Environments, a plan's review with its conflicts and approvals, Settings → Promotion rules with a dry run,
and Settings → Tokens.

## Why

A site has two kinds of change, and they come from different people:

- **Code and models**: templates, sections, styles, schemas, config. These come from a developer, who often works
  on a laptop and is sometimes from outside the team.
- **Content**: pages, posts, media and menus. These come from editors, who work on the live site.

The developer has to try a change against real content before it goes live. The editors must never lose work while
that happens.

Some hosted content systems sell this as "environments", usually on their top plans
([COMPARISON.md](COMPARISON.md) lists who charges what). There, an environment is often a copy of the content
repository: only models are promoted, content made in an environment never reaches production, a resync overwrites
the environment, and there is no deployed staging site unless you build one.

Markstage keeps a site in git, so an environment is simply a **branch plus a server**, at no extra cost.

## The model

| Environment | Where | Branch | Who uses it | Site |
|---|---|---|---|---|
| Local | a developer's laptop (`npm run dev`, Markstage dev mode) | any feature branch | developers | localhost; mail and forms go to a local sink |
| Staging | the server, a second Markstage instance | `staging` | developers, the site owner, reviewers | `staging.<site>`: password, `noindex`, `robots: Disallow: /`, a STAGING ribbon |
| Production | the server | `main` | editors, the public | the live site |

- **Changes flow up by promotion:** local → staging → production. A promotion is a git merge, so code, models and
  any chosen content move together.
- **Content flows down by sync:** production → staging → local. A sync is a merge, not an overwrite, so work on
  staging survives. Editors keep publishing on production the whole time.
- **Each environment keeps its own state, which is never promoted:** users and sessions, the form Inbox, the audit
  log, alerts, backups, and releases with their share links. Each server has its own data dir. A release belongs to
  the environment it was made on: its items wait in that server's data dir until it is published there, and only the
  commit it makes then travels on, like any other content ([API-RELEASES.md](API-RELEASES.md)).
- **Media lives in the repo** (`src/assets/uploads`), so it moves with the content that uses it.

## What people do

**Developer**
1. `git clone`, `npm ci`, `npm run dev`. Markstage dev mode shows a LOCAL badge with the branch name.
2. `markstage pull` merges the latest production content into the branch, so they work against real pages.
3. Work, then `git push origin my-change`. The staging server can build a **branch preview** at
   `<branch>.staging.<site>`.
4. Open a promotion to staging, either in the editor (Environments → Promote) or with
   `markstage promote my-change staging`. Rights to this are per person.

**Site owner or reviewer**
- Open Environments → "Staging → Production". The screen shows:
  - what changes: files grouped as pages, templates and sections, styles, and config;
  - before and after screenshots of every page whose HTML changed, at 1440 and 390;
  - the check results: the site's publish gate, broken links, redirects for removed pages, and the schema and
    hreflang checks;
  - an AI summary in plain words (when an AI key is set), such as "3 templates changed; 41 pages look different;
    1 page removed without a redirect (blocked)".
- **Promote** runs: merge, then build, then the checks, then deploy. If anything fails, nothing changes on
  production. **Roll back** is one click (`markstage-deploy rollback`).

**Editor**: nothing changes. They publish on production, and their work flows down to staging and local on the next
sync.

**Hotfix**: a person who has the right can promote a branch straight to production, for the rare urgent fix. It runs
the same checks and the same screenshots.

## Conflicts

These come up when an editor changed a file on production that the developer also changed.

- The promotion stops before merging and names each conflict in plain words, for example: "the About page: you
  changed the hero; Edna changed its text on 28 Oct."
- For each conflict you can keep the production version, keep the incoming version, or open both side by side.
  Nothing is ever merged silently.
- Content-only conflicts, where both sides edited a page, use the same three-way merge as the editor's own concurrent
  saves.

## Promotion rules: a permission and rule engine

Teams work in many different ways, so rights are not fixed toggles. They are **rules**, kept in
`<dataDir>/promotion-rules.json` (0600, version-checked, audited). The owner and administrators edit them in
Settings → Promotion rules.

A rule has:
- **who**: a role, named people, or a group;
- **action**: `promote`, `sync`, `rollback` or `preview`;
- **from → to** environments, for example `branch → staging`, `staging → production`, or `branch → production`
  (a hotfix).
- **what** may change, as path or kind filters. For example, "templates, sections and styles only", "content only",
  or "not `markstage.config.*` and not `deploy/`".
- **when**: a weekday and hour window, and a freeze, such as "no production promotions Friday 15:00 to Monday 08:00"
  or "freeze until the launch".
- **requires**: approvals (N people from a role, never the author), checks that must pass, a minimum time on
  staging (for example 1 hour), and a filled-in reason (required for a hotfix).
- **effect**: `allow`, `allow-with-approval` or `deny`.

How rules are applied:
- **Deny wins.** With no rule, the default is deny.
- **An explanation every time:** each refusal names the rule that stopped it, in plain words. For example:
  "Hotfixes to production need Olive's approval (rule 'hotfix needs owner')."
- **A dry run:** "What would happen if Sam promoted this?" shows which rule applies.
- **Approvals are recorded:** an approval is tied to the exact SHA, so a new push cancels it.

Starter rules for a new site:
1. Developers promote any branch to staging.
2. Staging → production needs the owner or an administrator, plus all checks passing.
3. Hotfixes (branch → production) are denied unless a named person is listed. A listed person still needs a reason
   and all checks, and the owner gets an alert.
4. Nobody promotes to production during a freeze that the owner has set.

Every promotion, sync, rollback, approval and rule change is audited with its from and to SHAs. The alert kinds are
`env.promoted`, `env.promote-failed`, `env.approval-needed` and `env.rules-changed`. The rules-changed alert is a
safety kind, so it can't be turned off.

## Safety on non-production

- Mail goes to a sink or to the person who triggered it. Forms on staging say "Test form: not sent" and store into
  staging's own Inbox only.
- Staging is behind sign-in or basic auth, with `X-Robots-Tag: noindex` on every response. The sitemap is not
  submitted. Canonical URLs still point at production, so a leaked page can't compete with the live one.
- Webhooks, the CDN purge and analytics are off unless they are set per environment.

## Configuration

The server's `config.json` gains:

```json
"environment": { "name": "staging", "branch": "staging", "upstream": "main", "ribbon": "#b45309",
                 "promoteTo": "production", "previews": { "branches": true, "host": "{branch}.staging.example.com" } }
```

The site's `markstage.config` stays the same in every environment. Per-environment values come from the server
config or the environment variables, never from the repo.

## Server setup (example)

- One server with two Markstage containers: `production` (www.example.com) and `staging` (staging.example.com).
  Each has its own data dir and port, and both pull from one central git remote.
- The central remote can be a **private repository** on your git host. A developer from outside the team gets
  access to that repository only, and both servers pull from it with a read-only deploy key each.
- Branch previews are optional. They need a wildcard DNS record and a certificate for `*.staging.example.com`.

## How it is tested

End-to-end tests on two local servers (production and staging) sharing one bare remote
([API-ENV.md](API-ENV.md), "Proof"):
- A promotion carries both a template change and a new page.
- Sync down keeps a staging-only page.
- A conflict is shown, then resolved each way.
- A failed check leaves production unchanged, and a rollback works.
- Staging sends no mail and returns `noindex` on every response.
- A developer without `env.promote.production` is refused, and the refusal is audited.
