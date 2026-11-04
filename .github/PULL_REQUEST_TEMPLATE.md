## What this changes

<!-- One change per pull request. What does a writer, an editor or a site's developer see or get? -->

## Why

<!-- The problem it solves. Link the issue: "Closes #123". -->

## How I tested it

<!-- The tests you added or ran, and what you checked by hand. -->

## Checklist

- [ ] `npm run typecheck`, `npm run lines`, `npm run generic` and `npm run licence` pass
- [ ] The tests of every package I touched pass (`npm test -w packages/<name>`; the server's browser tests with
      `npm run test:e2e -w packages/server` after `npm run build:agent -w packages/editor`)
- [ ] A save still changes only what the writer changed (a test proves it for any new edit path)
- [ ] The docs the change touches are updated, and a user-facing change is in `CHANGELOG.md`
- [ ] No passwords, tokens, keys, real IP addresses or a real site's names in code, tests, docs or commit messages
- [ ] My commits are signed off (`git commit -s`)

## How this lands

This repository is made from a private one: once accepted, your change is re-applied there with you as the author,
then synced back here as a commit that names you as co-author, and this pull request is closed with a link to it.

## Contributor licence agreement

- [ ] I accept the Markstage Contributor Licence Agreement (v1.0) in `CONTRIBUTING.md`
      for this contribution.

## Screenshots

<!-- Before and after, for anything on screen. -->
