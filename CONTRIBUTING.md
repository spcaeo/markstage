# Contributing to Markstage

Thank you for helping. Markstage has one promise, *edit on the real page*: what a writer sees in
the editor is the site's own page, and a save changes only what they changed. The rules below exist to keep it.
Please read them before you open a pull request.

## Set up

Markstage is not on npm yet: you work from a clone. Running every test needs **Node 24** (the editor's tests are
TypeScript that Node runs directly) and **git** with a name and email set (the tests make commits in throwaway
repos). Markstage itself runs on Node 22.13 or newer.

```sh
git clone https://github.com/spcaeo/markstage && cd markstage
npm ci                                    # installs exactly what package-lock.json says
npx playwright install chromium           # once: the browser some editor tests and the server's browser tests use
npm test                                  # every package's tests must pass
```

`npm test` builds the editor's preview agent (`npm run build:agent -w packages/editor`) the first time the server's
browser tests need it. If Chromium is missing, those tests stop at once and print the command above. On Linux, use
`npx playwright install --with-deps chromium` to get its system libraries too. The browser tests take their ports
from 18231 up; when those are busy, set `MARKSTAGE_E2E_PORT_BASE` to another free base.

`npm ci` also turns on a pre-commit secret scan (`scripts/hooks/pre-commit`): a commit that adds a key, token or
password is stopped, with the line shown masked. A test that needs a key-shaped value builds it at run time from
pieces. `MARKSTAGE_SKIP_HOOKS=1 npm ci` leaves it off.

Markstage keeps its own data in `node:sqlite`, which is why it needs Node 22.13 or newer.

`examples/blog` is a small Astro site to try the editor on. docs/ARCHITECTURE.md explains the parts; docs/API.md
and docs/CONFIG.md describe the server routes and the site config.

## The house rules

1. **A save changes only what the writer changed.** Moving something and moving it back, or opening and saving,
   leaves the file byte for byte as it was. Every new edit path gets a test that proves both.
2. **Nothing reaches the live site that the writer did not see.** The production build stays byte-identical
   with or without Markstage; editor bindings exist only in editor mode.
3. **The core knows no site.** Nothing in `packages/` names a real site, product, host or path; site-specific
   blocks and rules live in the site's own config and block pack. Examples use `example.com`.
4. **Never lose typing.** A failure (offline, conflict, crash, expired session) keeps the writer's text and says
   so in plain words.
5. **Every state has a URL.** Open panels, dialogs, filters and selections are in the address, so a reload or a
   shared link comes back to the same place.
6. **Enforced on the server.** A rule the UI shows (roles, locks, publish checks) is also refused by the server.
7. **No secrets, anywhere.** No password, token, API key, SMTP login or real IP address in code, tests, docs or
   commit messages. Test data uses `example.com` / `example.test` and RFC 5737 addresses.
8. **No file over 1,000 lines.** Split it before it crosses the line.
9. **Plain words on screen.** Short sentences; say what will happen before it happens; no engine terms for
   writers.
10. **Say what the licence is.** Markstage is source-available under the Elastic License 2.0, free to self-host:
    never "open source", never MIT. `npm run generic` checks it (and rule 3); `npm run lines` checks rule 8.

## Dependencies

Fewer packages mean fewer ways in. What each package uses at run time today:

| Package | Runtime dependencies |
| --- | --- |
| `@markstage/server` | `@markstage/core`; `sharp` (optional, for picture uploads). Everything else is Node's own (`node:http`, `node:crypto`, `node:sqlite`, `node:child_process`). |
| `@markstage/core` | `yaml`, `unified`, `remark-parse`, `remark-gfm`, `remark-mdx` (MDX files, pinned to 3.1.1), `decode-named-character-reference` |
| `@markstage/editor` | `@markstage/core`, TipTap 3 (pinned to one exact version), CodeMirror 6 and `@lezer/highlight`. It runs in the browser, built by `build-editor`. |
| `@markstage/astro` | `@markstage/core`, `@markstage/editor`, `yaml`; Astro 7.4 or newer (`^7.4.4`) is the site's own (a peer dependency); uses the site's `sharp` when it has one. |

The repo's own tools (`playwright`, `typescript`) are dev dependencies, pinned to exact versions.

The rules:

1. **Ask before adding one.** A new runtime dependency needs a reason in the pull request (what it does that Node
   cannot) and a look at its own dependencies, maintainers and install scripts. Prefer Node's built-ins.
2. **The lockfile is the truth.** `package-lock.json` is committed and changes only with the `package.json` change
   that needs it. Install with `npm ci` everywhere: on your machine, in CI, in Docker and on a server.
3. **Updates come from Dependabot** (`.github/dependabot.yml`): npm and GitHub Actions, once a week, with minor and
   patch updates grouped into one pull request. Each one passes CI like any other change; majors are read first.
4. **CI audits every push**: `npm audit --omit=dev --audit-level=high` and a gitleaks secrets scan
   (`.github/workflows/ci.yml`).
5. **A release only from a clean audit.** Before `npm run release`, `npm audit --omit=dev` must report no
   vulnerabilities; if one has no fix yet, the release notes say why it does not reach Markstage.

## Pull requests

1. Open an issue first for anything larger than a fix, so we can agree on the approach.
2. Branch from `main`. Keep one change per pull request.
3. Add or update tests; `npm test`, `npm run test:scripts`, `npm run typecheck`, `npm run generic` and
   `npm run lines` must pass (CI runs them all, plus `npm audit` and gitleaks).
4. Update the docs the change touches.
5. **How a pull request lands.** This public repository is made from a private one. A pull request that is accepted
   is re-applied there with you as the commit's author, then synced back here, where the public commit names you as
   a co-author (`Co-authored-by:`, so GitHub credits you). The pull request is closed with a link to that commit, and
   the CHANGELOG entry for the release that ships it names you.

## Contributor licence agreement

Markstage is released under the [Elastic License 2.0](LICENSE), and Space-O Technologies also offers it under
commercial licences (for example, for hosted use). To keep that possible, every contribution needs this short
agreement. You accept it by ticking the box in the pull request description.

> **Markstage Contributor Licence Agreement (v1.0)**
>
> 1. "You" means the person or entity submitting a contribution. "Contribution" means any code,
>    documentation or other material you submit to this repository.
> 2. You keep the copyright in your contribution.
> 3. You grant Space-O Technologies and the recipients of software it distributes a perpetual,
>    worldwide, non-exclusive, royalty-free, irrevocable licence to use, copy, modify, distribute,
>    sublicense and relicense your contribution, including under the Elastic License 2.0 and under
>    commercial licences.
> 4. You grant the same parties a perpetual, worldwide, non-exclusive, royalty-free, irrevocable
>    patent licence for your contribution, as far as your patent claims are needed to use it.
> 5. You confirm that the contribution is your original work, or that you have the right to submit
>    it under these terms, and that, if your employer has rights in it, your employer has allowed
>    you to submit it.
> 6. You confirm that the contribution contains no secret, password, personal data or real IP
>    address.
> 7. The contribution is provided "as is", without warranty.

Each commit should also carry a sign-off line (`git commit -s`), which records that you accept the agreement for
that commit:

```
Signed-off-by: Your Name <you@example.com>
```

## Reporting security problems

Not in a public issue, please. See [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
