# Publishing Markstage

Markstage is developed in a **private** repo and published to a **public** repo that starts from a clean snapshot.
No private history goes public: each sync adds one ordinary commit to the public repo, so the public history grows
normally from its first snapshot.

```
private repo (all work, full history)
   │  npm run public:sync          export + checks + one commit
   ▼
.public-export/  (its own git repo, git-ignored in the private repo)
   │  you review, then push yourself
   ▼
github.com/spcaeo/markstage  (public)
```

Markstage is **source-available** under the Elastic License 2.0, free to self-host. It is never called "open
source"; `npm run licence` checks every file for it, in both repos.

## Daily flow

1. **Work privately** as usual: short branches, commits, merges into `main`. The pre-commit hook blocks a commit
   that adds a key.
2. **Preview** what would change in the public repo:
   ```sh
   npm run public:sync -- --dry-run        # the first 200 paths of each list
   npm run public:sync -- --dry-run --all  # every path
   ```
3. **Sync** the commit you want to publish (default `HEAD`; it must be committed, the working tree is not read):
   ```sh
   npm run public:sync
   npm run public:sync -- --ref v0.3.0
   ```
   The script exports the files of that commit (`git ls-tree`, the same set as `git ls-files`), filtered by
   `public-sync.config.json`, into `.public-export/`, runs the checks below, and commits there as
   `Sync from private <short sha>: <commit subjects>` with a `Private-Commit:` trailer the next sync starts from.
   The very first one is `Sync from private <sha>: First public snapshot`.
4. **Review** the public commit:
   ```sh
   git -C .public-export show --stat HEAD
   git -C .public-export commit --amend    # edit the message if needed
   ```
   To prove the snapshot works on its own, run the repo's checks in it (`npm ci`, then the commands of
   CONTRIBUTING.md). `.public-export/node_modules` is git-ignored there and cleared by the next sync.
5. **Push** it yourself. The script prints the command and never runs it:
   ```sh
   git -C .public-export remote add origin git@github.com:spcaeo/markstage.git   # first time only
   git -C .public-export push -u origin main
   ```

Contributions made on the public repo come back by hand: apply the pull request's patch in the private repo
(`gh pr diff <n> --repo spcaeo/markstage | git apply`), commit with the contributor as the author (keep their
`Signed-off-by:`) and a `Public-PR: #<n>` trailer, and the next sync carries it out again. The sync credits the
author of every commit with that trailer as a `Co-authored-by:` of its public commit (and no other author, so no
private address goes out), which GitHub shows on the contributor's profile. Close the public pull request with a
link to the sync commit, and name the contributor in the CHANGELOG entry for the release that ships it.

## Releases: the order

A release is cut in the private repo (`npm run release -- minor`, docs/RELEASES.md), which bumps every package,
writes SECURITY.md's supported-versions table and tags `vX.Y.Z` there. Publishing it is three separate steps,
each started on its own after the one before has finished:

1. `npm run public:sync -- --ref vX.Y.Z`, then review the commit.
2. `git -C .public-export push origin main`, then wait until the public repo's CI is green on it.
3. Only then, and only when `.public-export/package.json` says the release's version, tag and push the tag:
   ```sh
   node -p "require('./.public-export/package.json').version"   # must print X.Y.Z
   git -C .public-export tag -a vX.Y.Z -m "Markstage vX.Y.Z"
   git -C .public-export push origin vX.Y.Z
   ```

Never chain a sync with a tag push (`npm run public:sync && git push --tags` or the like): a sync that stops on a
check, or that exported a different commit, would leave a public tag on the wrong code. The sync prints the tag
commands only when the exported commit carries the release tag and the export's `package.json` has the same
version, and warns when they differ.

The footer's build number counts the commits of the checkout (docs/RELEASES.md), so a build from the public repo
shows a smaller number than one from the private repo for the same code. The version and the date are the same.

## What is published

`public-sync.config.json` (private, never exported) decides:

- **include** is an allow-list: `packages/`, `examples/`, `scripts/`, `docs/`, `deploy/`, `.github/`, and the root
  files the build and the community need (`package.json`, `package-lock.json`, LICENSE, NOTICE, NAME, TAGLINE,
  README, CONTRIBUTING, SECURITY, SUPPORT, CODE_OF_CONDUCT, CHANGELOG, `.gitignore`, `.gitleaks.toml`). A new
  top-level folder or root file is not published until you add it; a dry run lists it under "Not in the include
  list".
- **exclude** drops private paths: `.claude/`, `CLAUDE.md`, `AGENTS.md`, memory folders, `.env*` (except
  `.env.example`), key files (`*.pem`, `*.key`, `*.p8`, `*.p12`, `*.pfx`, SSH keys), databases (`*.db`,
  `*.sqlite*`), data dirs and backups (`*-data/`, `.markstage/`, `markstage-backup-*/`), worktrees, the config
  itself, and the internal planning notes marked `PROPOSED` (delete an entry to publish that file). The last
  matching exclude wins; `!glob` puts a path back.
- **privateText**: regular expressions for names that must never go out (the first site and its folders, home
  folder paths, a private email). An exported line that matches one stops the sync.
- **privateSubjectWords**: a commit subject holding one of these words is published as "Private change".
- **commitAuthor**: `Name <email>` for the public commits. Empty uses your git identity, which puts your git email
  in the public history: set it to your GitHub noreply address (`Name <id+user@users.noreply.github.com>`, from
  GitHub › Settings › Emails) before the first sync.
- **checks**: the repo's own check scripts, run inside the export.

Globs match the whole path: `**` crosses folders, `*` does not.

## Checks before every public commit

A failed check stops the sync and nothing is committed: fix it in the private repo (or in the config), commit, and
run again. The export folder then holds the refused files until the next sync clears it.

- **Secrets:** gitleaks over the exported files with `.gitleaks.toml`, plus the built-in pattern scan. gitleaks is
  required (`brew install gitleaks`, or `GITLEAKS_BIN=/path/to/gitleaks`); `--builtin-scan` runs with the built-in
  scan alone.
- **Nothing private:** no exported line matches `privateText`; no file in the export folder matches an exclude
  rule or is outside the export list.
- **Complete:** the required files are there; every path a `package.json` points at (`workspaces`, `main`, `bin`,
  `exports`, `files`, the scripts it runs with `node`) is in the export; every relative import of a file that
  exists privately is exported too.
- **SECURITY.md** has the supported-versions table for the version in `package.json`.
- **The repo's own checks, run inside the export:** `check-generic` (no site's names), `check-licence`
  (source-available, Elastic-2.0 in every package) and `check-lines` (no file over 1000 lines).
- The target folder is inside the project and git-ignored.

## Guard rails in daily work

- **Pre-commit hook** (`scripts/hooks/pre-commit`), switched on by `npm ci` or `npm install` (the `prepare` script
  sets `core.hooksPath=scripts/hooks`; skipped in CI, for `--omit=dev` installs, or with `MARKSTAGE_SKIP_HOOKS=1`).
  It scans the staged lines with the built-in scan (`sk-…`, `AIza…`, `ghp_…`, `xox…`, `AKIA…`, private key blocks,
  and high-entropy values given to a name with KEY, TOKEN, SECRET or PASSWORD in it), and runs
  `gitleaks git --pre-commit --staged` too when gitleaks is installed. A plainly fake test value passes; a
  key-shaped test value is built at run time from pieces; a line can opt out with `// gitleaks:allow`;
  `git commit --no-verify` skips once. Run it by hand with `npm run secrets:scan`.
- **CI** (`.github/workflows/ci.yml`, job "Secrets scan (gitleaks)") scans the full history on every push and pull
  request, in both repos.
- **`.gitignore`** covers `.env*`, databases, data dirs, backups, `.claude/` and `.public-export/`.

## Keys

- The server reads its secrets from the environment (docs/DEPLOY.md); `deploy/config.example.json` holds only
  placeholders that say where each value comes from.
- Never put a key in code, a test or a doc. If one is ever committed, **rotate it**, even after it is removed:
  private history keeps it.

## Files

- `scripts/public-sync.mjs`: the sync. `scripts/lib/public-sync-core.mjs`: filters, plan, message and the export
  checks (tests: `scripts/lib/public-sync-core.test.mjs`, run by `npm run test:scripts`; the tests of the real
  config run only in the private repo).
- `scripts/lib/secret-scan.mjs`: the built-in scan. `scripts/lib/gitleaks.mjs`: finds gitleaks.
  `scripts/hooks/`: the hook and its installer.
- `scripts/lib/supported-versions.mjs`: SECURITY.md's table (tests: `supported-versions.test.mjs`).
- `.gitleaks.toml`: the gitleaks rules and the narrow allow-list of two published test vectors.
- `.github/REPO-SETTINGS.md`: the GitHub settings of both repos, as `gh` commands.
