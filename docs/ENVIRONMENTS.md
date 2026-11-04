# Environments: local, staging, production

Status: the owner approved this design for build on 2026-10-28 ("development is completely required"). The server side is built in 4d43b7b: routes, CLI and the tests that prove them are in [API-ENV.md](API-ENV.md), under "Proof". The editor screens are built in 928734a: the badge and ribbon, Environments, a plan's review with conflicts and approvals, Settings → Promotion rules with a dry run, and Settings → Tokens. They were proven on two local servers (production and staging) sharing one bare remote: promote, sync with a conflict resolved by hand, an approval rule, a rollback, and a refusal. A plan's screenshots load since ab56532. One proof step is still open: screenshots and an AI summary of a real promotion of the pilot site, which needs the real server and a key, on the owner's go. Each part below says who builds it: [server] is markstage-server, [studio-ui] is the editor, [lead] is the lead.

## Why

A site has two kinds of change, and they come from different people:

- **Code and models**: templates, sections, styles, schemas, config. These come from a developer, often a
  freelancer, who works on a laptop.
- **Content**: pages, posts, media and menus. These come from editors, who work on the live site.

The developer has to try a change against real content before it goes live. The editors must never lose work while that happens.

Prismic sells this as "environments". It is an Enterprise feature, or a $3,000/year add-on on Platinum (prismic.io/pricing, checked 2026-10-28). There, an environment is a clone of the repository:

- Only models are promoted. Content made in an environment never goes to production.
- "Resync" overwrites the environment with production, destroying anything made there.
- It gives no deployed staging site. You have to wire previews to your own app.

Markstage keeps a site in git, so it can do better at no extra cost: an environment is a **branch plus a server**.

## The model

| Environment | Where | Branch | Who uses it | Site |
|---|---|---|---|---|
| Local | a developer's laptop (`npm run dev`, Markstage dev mode) | any feature branch | developers | localhost; mail and forms go to a local sink |
| Staging | the server, a second Markstage instance | `staging` | developers, the owner, reviewers | `staging.<site>`: password, `noindex`, `robots: Disallow: /`, a STAGING ribbon |
| Production | the server | `main` | editors, the public | the live site |

- **Changes flow up by promotion:** local → staging → production. A promotion is a git merge, so code, models and any chosen content move together. This is one step Prismic cannot do.
- **Content flows down by sync:** production → staging → local. A sync is a merge, not an overwrite, so work on staging survives. Editors keep publishing on production the whole time.
- **Each environment keeps its own state, which is never promoted:** users and sessions, the form Inbox, the audit log, alerts, backups, and releases with their share links. Each server has its own data dir. A release belongs to the environment it was made on: its items wait in that server's data dir until it is published there, and only the commit it makes then travels on, like any other content ([API-RELEASES.md](API-RELEASES.md)).
- **Media lives in the repo** (`src/assets/uploads`), so it moves with the content that uses it.

## What people do

**Developer (freelancer)**
1. `git clone`, `npm ci`, `npm run dev`. Markstage dev mode shows a LOCAL badge with the branch name.
2. `markstage pull` merges the latest production content into the branch, so they work against real pages.
3. Work, then `git push origin my-change`. The staging server can build a **branch preview** at
   `<branch>.staging.<site>` [server].
4. Open a promotion to staging, either in the Studio (Environments → Promote) or with `markstage promote my-change staging`.
   Rights to this are per person.

**Owner or reviewer**
- Open Environments → "Staging → Production". The screen shows:
  - what changes: files grouped as pages, templates and sections, styles, and config;
  - before and after screenshots of every page whose HTML changed, at 1440 and 390 [server];
  - the check results: the site's publish gate, broken links, redirects for removed pages, and the schema and hreflang checks;
  - an AI summary in plain words, such as "3 templates changed; 41 pages look different; 1 page removed without a redirect (blocked)" [server].
- **Promote** runs: merge, then build, then the checks, then deploy. If anything fails, nothing changes on production.
  **Roll back** is one click (`markstage-deploy rollback`, already built).

**Editor**: nothing changes. They publish on production, and their work flows down to staging and local on the next sync.

**Hotfix**: a person who has the right can promote a branch straight to production. It runs the same checks and the same screenshots. The owner's words were "or maybe directly sometime".

## Conflicts

These come up when an editor changed a file on production that the developer also changed.

- The promotion stops before merging and names each conflict in plain words, for example: "the About page: you changed the hero; Edna changed its text on 28 Oct."
- For each conflict you can keep the production version, keep the incoming version, or open both side by side. Nothing is ever merged silently [studio-ui].
- Content-only conflicts, where both sides edited a page, use the same three-way merge as the editor's own concurrent saves.

## Promotion rules: a permission and rule engine [server]

The owner asked for this on 2026-10-28: "make sure we have permission and rule engine built to support various situations". Rights are not fixed toggles. They are **rules**, kept in `<dataDir>/promotion-rules.json` (0600, version-checked, audited). The owner and administrators edit them in Settings → Environments → Rules [studio-ui].

A rule has:
- **who**: a role, named people, or a group;
- **action**: `promote`, `sync`, `rollback` or `preview`;
- **from → to** environments, for example `branch → staging`, `staging → production`, or `branch → production` (a hotfix).
- **what** may change, as path or kind filters. For example, "templates, sections and styles only", "content only", or "not `markstage.config.*` and not `deploy/`".
- **when**: a weekday and hour window, and a freeze, such as "no production promotions Friday 15:00 to Monday 08:00" or "freeze until the launch".
- **requires**: approvals (N people from a role, never the author), checks that must pass, a minimum time on staging (for example 1 hour), and a filled-in reason (required for a hotfix).
- **effect**: `allow`, `allow-with-approval` or `deny`.

How rules are applied:
- **Deny wins.** With no rule, the default is deny.
- **An explanation every time:** each refusal names the rule that stopped it, in plain words. For example: "Hotfixes to production need Olive's approval (rule 'hotfix needs owner')."
- **A dry run:** "What would happen if Sam promoted this?" shows which rule applies [studio-ui].
- **Approvals are recorded:** an approval is tied to the exact SHA, so a new push cancels it.

Starter rules for a new site:
1. Developers promote any branch to staging.
2. Staging → production needs the owner or an administrator, plus all checks passing.
3. Hotfixes (branch → production) are denied unless a named person is listed. A listed person still needs a reason and all checks, and the owner gets an alert.
4. Nobody promotes to production during a freeze that the owner has set.

Every promotion, sync, rollback, approval and rule change is audited with its from and to SHAs. The alert kinds are `env.promoted`, `env.promote-failed`, `env.approval-needed` and `env.rules-changed`. The rules-changed alert is a safety kind, so it can't be turned off [server].

## Safety on non-production [server]

- Mail goes to a sink or to the person who triggered it. Forms on staging say "Test form: not sent" and store into staging's own Inbox only.
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

## Server setup (example) [lead]

- There is one server with two Markstage containers: `production` (www.example.com) and `staging`
  (staging.example.com). Each has its own data dir and port, and both pull from one central git remote.
- The central remote is a **private GitHub repo** (the owner chose this on 2026-10-28). The freelancer gets access to that repo only, and both servers pull from it with a read-only deploy key each. The lead creates the repo only on the owner's go.
- Branch previews are optional. They need a wildcard DNS record and a certificate for `*.staging.example.com`.

## Proof required before "done"

These are end-to-end tests on two local servers (production and staging) sharing one bare remote:
- A promotion carries both a template change and a new page.
- Sync down keeps a staging-only page.
- A conflict is shown, then resolved each way.
- A failed check leaves production unchanged, and a rollback works.
- Staging sends no mail and returns `noindex` on every response.
- A developer without `env.promote.production` is refused, and the refusal is audited.
- Screenshots and the AI summary are produced for one real promotion of the pilot site.
