# GitHub settings for the Markstage repositories

Everything here is ready to paste. Nothing in this repository changes GitHub settings on its own: the owner runs
these commands once, signed in with `gh auth login` as an admin of the `spcaeo` account. docs/PUBLISHING.md says
how the two repositories work together.

| Repository | What it is |
| --- | --- |
| `spcaeo/markstage-private` | All work and the full history. Private. Today it is `spcaeo/markstage`; step 1 renames it. |
| `spcaeo/markstage` | The public repository, made from clean snapshots (`npm run public:sync`). |

## 1. The private repository: rename it first

The public repository takes the name `markstage`, so the private one moves out of the way first.

```bash
gh repo rename markstage-private --repo spcaeo/markstage --yes
# in every checkout of the private repo (this Mac, any server or CI that clones it):
git remote set-url origin git@github.com:spcaeo/markstage-private.git
git remote -v
```

GitHub redirects the old name to the renamed repository only until a new repository takes the name. After step 2
the old address is the public repository, which has none of the private commits: anything that still clones or
fetches `spcaeo/markstage` (a server's pinned checkout, a deploy script, a site's lockfile) must point at
`spcaeo/markstage-private` before step 2.

The private repository keeps its current settings (private, its CI, Dependabot). Check it is still private:

```bash
gh repo view spcaeo/markstage-private --json visibility,nameWithOwner
```

## 2. The public repository

Create it empty; the first push comes from `.public-export/` (docs/PUBLISHING.md):

```bash
gh repo create spcaeo/markstage --public \
  --description "Type it. Ship it. The visual editor for Astro sites: Notion-style blocks on your real page design, every save a clean git commit, AI agents that draft through MCP. Self-hosted and source-available (Elastic License 2.0)."
```

### Description (219 of 350 characters)

```text
Type it. Ship it. The visual editor for Astro sites: Notion-style blocks on your real page design, every save a clean git commit, AI agents that draft through MCP. Self-hosted and source-available (Elastic License 2.0).
```

### Website

Empty for now. When Markstage has a site, set it with `gh repo edit spcaeo/markstage --homepage <url>`.

### Topics (18 of the 20 GitHub allows)

Lowercase letters, numbers and hyphens, at most 50 characters each.

```text
markdown
markdown-editor
visual-editor
wysiwyg
cms
git-based-cms
content-management
astro
astro-integration
static-site
jamstack
self-hosted
json
tiptap
nodejs
editor
publishing
source-available
```

### Features and settings

```bash
R=spcaeo/markstage

# Description, empty website, topics; Issues and Discussions on, Wiki and Projects off; branches deleted on merge
gh repo edit $R \
  --homepage "" \
  --add-topic markdown,markdown-editor,visual-editor,wysiwyg,cms,git-based-cms,content-management,astro,astro-integration \
  --add-topic static-site,jamstack,self-hosted,json,tiptap,nodejs,editor,publishing,source-available \
  --enable-issues \
  --enable-discussions \
  --enable-wiki=false \
  --enable-projects=false \
  --delete-branch-on-merge

# Secret scanning and push protection on
gh api -X PATCH repos/$R --input - <<'JSON'
{"security_and_analysis": {
  "secret_scanning": {"status": "enabled"},
  "secret_scanning_push_protection": {"status": "enabled"}
}}
JSON

# Dependabot alerts and Dependabot security updates on (.github/dependabot.yml sets the version updates)
gh api -X PUT repos/$R/vulnerability-alerts
gh api -X PUT repos/$R/automated-security-fixes

# Private vulnerability reporting on: SECURITY.md sends reporters to Security › Report a vulnerability
gh api -X PUT repos/$R/private-vulnerability-reporting

# GitHub Actions: the default token can only read, and cannot approve pull requests
gh api -X PUT repos/$R/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

# Labels the issue forms use (bug, enhancement and question exist by default)
gh label create triage --repo $R --color FBCA04 --description "New, not looked at yet" --force
```

### The `main` ruleset

`main` cannot be deleted or force-pushed, and a pull request into it needs the three CI jobs of
`.github/workflows/ci.yml` to pass. Repository admins may bypass it: the owner pushes each sync from
`.public-export/` straight to `main`, and those commits have no checks yet when they arrive (their CI runs on the
push). Run this after the first push, so the check names exist:

```bash
gh api -X POST repos/spcaeo/markstage/rulesets --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}],
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 0,
      "dismiss_stale_reviews_on_push": true,
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_review_thread_resolution": true
    }},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "required_status_checks": [
        {"context": "Checks and unit tests", "integration_id": 15368},
        {"context": "Server browser tests (Playwright, Chromium)", "integration_id": 15368},
        {"context": "Secrets scan (gitleaks)", "integration_id": 15368}
      ]
    }}
  ]
}
JSON
```

`actor_id` 5 is the repository's Admin role and `integration_id` 15368 is GitHub Actions. If a CI job is renamed,
change its name here too.

### Check the result

```bash
gh repo view spcaeo/markstage --json visibility,description,homepageUrl,repositoryTopics,hasIssuesEnabled,hasDiscussionsEnabled,hasWikiEnabled,hasProjectsEnabled,deleteBranchOnMerge
gh api repos/spcaeo/markstage --jq '.security_and_analysis'
gh api repos/spcaeo/markstage/private-vulnerability-reporting
gh api repos/spcaeo/markstage/actions/permissions/workflow
gh api repos/spcaeo/markstage/rulesets
```

## Discussions categories

When Discussions is on, keep or create these (Settings › General › Features › Discussions › Set up discussions,
then the pencil next to Categories):

| Category | Format | What goes there |
| --- | --- | --- |
| Announcements | Announcement | New releases and important changes (owner only) |
| Q&A | Question / Answer | How do I…? questions, with an accepted answer |
| Ideas | Open-ended | Feature ideas before they become issues |
| Show and tell | Open-ended | Sites people run on Markstage |
| General | Open-ended | Everything else |

Delete **Polls** unless you plan to use it.

## Not set yet (the owner decides)

- **The security contact email** is rp@spaceo.ca (owner, 3 Nov), in SECURITY.md and CODE_OF_CONDUCT.md.
- **The website** (above) and a social preview image (Settings › General › Social preview; GitHub has no API for it).
- **Funding:** no `.github/FUNDING.yml` until there is a sponsor link.
