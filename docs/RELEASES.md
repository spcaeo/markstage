# Releases and the footer line

Every editor screen ends with one small line, and the server reports the same one:

    v0.2.0 · build 256 · Nov 2, 2026 8:49 AM EST

| Part | Where it comes from | Changes when |
| --- | --- | --- |
| `v0.2.0` | the packages' `version` (all four packages share it) | `npm run release -- patch\|minor\|major` |
| `build 256` | the number of commits on the checkout (`git rev-list --count HEAD`), so it only goes up on main | every commit on main |
| `Nov 2, 2026 8:49 AM EST` | the time of that commit, in `MARKSTAGE_TIME_ZONE` (else `TZ`, else the machine's) | every commit |

`packages/core/src/release.mjs` computes it. The server uses it for `markstage-server version`, Your account and
`GET /markstage/api/release` (public: the line only, so a site's footer can show it; the parts and the exact commit once signed in). The editor build (`markstage build-editor`, and the
Astro integration in dev) stamps it into the bundle as `__MS_RELEASE__`, so the footer shows what the editor was
built from even before anyone signs in.

**Docker.** An image has no `.git`, so the build passes `MARKSTAGE_COMMIT`, `MARKSTAGE_BUILD` and `MARKSTAGE_BUILT_AT`
(the deploy's Makefile reads them from the pinned checkout) and the container sets `MARKSTAGE_TIME_ZONE`. The site's
smoke test fetches the editor's bundle and `/markstage/api/release` and fails when the two lines differ: a stale
editor build or a stale image is caught at once.

**Cutting a release.** On a clean `main`, after the whole test suite:

    npm run release -- minor        # or patch, major, or an exact 1.2.3
    git push origin main v0.3.0

The script bumps every package (and the `@markstage/*` ranges between them), refreshes `package-lock.json`, commits
"Release v0.3.0" and tags it. Sites move their `markstage.pin` to that commit as usual.
