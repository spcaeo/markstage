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

The tag push in step 3 also starts the two publishing workflows of the public repo: `.github/workflows/image.yml`
(the server image) and `.github/workflows/npm.yml` (the packages on npm, once it is turned on: next section).

## npm

The four packages go to npm under the `@markstage` scope, which belongs to the npm user `markstage`. They always
carry one version, and each names the others at exactly that version. They are published in this order, so a
package's `@markstage` dependencies are on npm before it: **core, editor, astro, server**.

| Package | What it holds | Budget: files, unpacked, packed |
| --- | --- | --- |
| `@markstage/core` | `src/` (ESM and its `.d.ts`) | 70, 450 KB, 150 KB |
| `@markstage/editor` | `src/` (TypeScript, compiled by the site's own Vite), the two canvas check scripts | 450, 3.3 MB, 1 MB |
| `@markstage/astro` | `bin/markstage.mjs`, `src/` | 45, 220 KB, 70 KB |
| `@markstage/server` | `bin/markstage-server.mjs`, `bin/markstage-deploy.mjs`, `src/` | 250, 2.3 MB, 750 KB |

Each also holds its README.md, the LICENSE (the Elastic License 2.0, the same file as the repo's) and the NOTICE.
The `files` list in each package.json is an allow-list: tests, e2e tests, fixtures, tool configs and anything else
stay out. A new file a package needs at run time must be added there. The budgets sit about 30% above the first
release's sizes, in `scripts/lib/npm-packages.mjs`; raise one on purpose, in the commit that made the package grow.

The editor ships its TypeScript source, not a build: Astro's Vite compiles it in `astro dev` and in
`markstage build-editor`, together with the site's CSS and block packs. The install test proves both from
`node_modules`. Installed from npm, `astro dev` pre-bundles `@markstage/core` (its CommonJS, `extend` through unified,
cannot reach a browser as it is); a site whose packages are links to a checkout is unchanged.

### The guards

- `npm run test:scripts` runs `scripts/npm-packages.test.mjs`: each package is packed for real (`npm pack` into a
  temporary folder) and unpacked. It fails on a test, e2e or fixture file, a scratch file or tool config, anything
  secret-like by its name (`.env`, keys, certificates, databases, data dirs) or by its content (the built-in secret
  scan), an entry point (`main`, `types`, `exports`, `bin`) missing from the tarball, a package over its budget, a
  site's name (`npm run generic` over the tarball's files, and in this repo the publish kit's `privateText` too), and
  wrong metadata: `license` Elastic-2.0, `repository` with its `directory`, `homepage`, `bugs`, `engines.node`,
  `publishConfig: { access: "public", provenance: true }`, the other `@markstage` packages at exactly the same version.
- `npm run test:npm-install` (`scripts/npm-install.mjs`, CI job "npm install test" on Node 24 and 22.13): the four
  tarballs in a new site made from `examples/starter`, installed as copies with `npm install`, then `astro build`,
  `markstage build-editor`, `astro dev` with the post open in the editor, `markstage-server init`, `serve` on a free
  odd port, `setup-code`, the owner made with it, and in Chromium: sign in, open a post, type, save; the post's file
  changes and the site has a new git commit. Everything is removed at the end and the browser closed. Astro 7.4
  itself needs Node 22.23.4 or newer on the 22 line, so on 22.13 `astro build` runs on the Node given by
  `--astro-node` (CI: Node 24) and `astro dev` is left out; the rest runs on 22.13.

### The first publish: from a laptop, once

Trusted publishing can only be set for a package that exists, so the first version of each package is published by
hand, by a maintainer signed in to npm as `markstage` (`npm whoami`). Do it from the release tag, in a clean
checkout, after the public repo has the release (steps 1 to 3 above):

```sh
git worktree add "$TMPDIR/markstage-release" vX.Y.Z && cd "$TMPDIR/markstage-release"
npm ci
npm whoami                                    # must print: markstage
node --test scripts/npm-packages.test.mjs     # what each tarball holds
npm run test:npm-install                      # the tarballs in a new site, the server, the editor, a save

# 1. dry runs: nothing leaves the machine; read each file list
npm publish -w packages/core   --access public --provenance=false --dry-run
npm publish -w packages/editor --access public --provenance=false --dry-run
npm publish -w packages/astro  --access public --provenance=false --dry-run
npm publish -w packages/server --access public --provenance=false --dry-run

# 2. the real publish, in this order (npm asks for a one-time code if the account has 2FA: add --otp <code>)
npm publish -w packages/core   --access public --provenance=false
npm publish -w packages/editor --access public --provenance=false
npm publish -w packages/astro  --access public --provenance=false
npm publish -w packages/server --access public --provenance=false

npm view @markstage/astro version             # X.Y.Z
cd - && git worktree remove "$TMPDIR/markstage-release"
```

`--provenance=false`: provenance (the npm page's link to the build that made a package) can only be made on a CI
runner, and `publishConfig` asks for it, so a laptop publish turns it off for this one time; a flag on the command
line wins over `publishConfig`. Every later version is published by the workflow, with provenance. A version on npm
can never be replaced: if a step fails half way, fix it and publish the next patch version. Then check the new site
way from npm: `node scripts/create-site.mjs ../npm-check --npm`, `npm run dev` there.

### Turning on the workflow: one time, for the owner

`.github/workflows/npm.yml` runs on every `v*` tag in the public repo. Until the repository variable `NPM_PUBLISH`
is set it publishes nothing: its "not set up" job leaves a note on the run and passes. Two ways, the first preferred.

**A. Trusted publishing (no token anywhere).** After the first publish:

1. On npmjs.com, signed in as `markstage`, for each of `@markstage/core`, `editor`, `astro` and `server`: the
   package › Settings › Trusted publishing › GitHub Actions, and enter: organization or user `spcaeo`, repository
   `markstage`, workflow filename `npm.yml`, environment name `npm`. Save.
2. Still in each package's Settings, Publishing access: "Require two-factor authentication and disallow tokens"
   (the workflow needs no token, so nothing else may publish).
3. On GitHub, in the public repo: the environment and the switch.
   ```sh
   gh api -X PUT repos/spcaeo/markstage/environments/npm
   gh variable set NPM_PUBLISH --body trusted --repo spcaeo/markstage
   ```
   Optional: in Settings › Environments › npm, add yourself as a required reviewer, so each publish waits for your
   click, and allow only tags `v*` to deploy there.

**B. A token, if trusted publishing is not possible.** On npmjs.com, signed in as `markstage`: Access Tokens ›
Generate New Token › Granular Access Token, packages and scopes `@markstage` with read and write, a short expiry.
Then, without the token ever touching a file or a chat:
```sh
gh api -X PUT repos/spcaeo/markstage/environments/npm
gh secret set NPM_TOKEN --env npm --repo spcaeo/markstage     # paste the token at the prompt
gh variable set NPM_PUBLISH --body token --repo spcaeo/markstage
```
Renew it before it expires; the workflow stops with a plain message when the variable says token and the secret is
empty.

### What the workflow does on a tag

It checks that the tag is the version of all four packages, runs the package guard and the install test, then
publishes core, editor, astro and server with provenance. A version already on npm is skipped, so re-running a
failed run finishes the job. A pre-release tag (`vX.Y.Z-rc.1`) goes under the dist-tag `next`, so `npm install`
keeps getting the last release. It runs only in `spcaeo/markstage`.

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
- **privateTextAllow**: narrow exceptions to privateText, each `{ paths, text, why }`: in the listed paths only,
  matches of `text` are removed before the privateText check. Used for the showcase site's public address on the
  story and showcase pages; everything else about that site stays blocked.
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
