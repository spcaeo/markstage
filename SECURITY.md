# Security policy

Markstage edits a site's content and, with the Markstage server, signs people in and publishes to the live
site. The threat model, every control and the test that proves it are in [docs/SECURITY.md](docs/SECURITY.md).

## Supported versions

<!-- supported-versions:start (written by scripts/release.mjs from package.json; do not edit by hand) -->
| Version | Security fixes |
| --- | --- |
| 0.4.x | Yes |
| older than 0.4 | No: please update |

Fixes go into the newest 0.4.x release (and `main`). When a newer minor version
comes out, this table says how long the one before it still gets fixes. `markstage-server version` says which one
you run.
<!-- supported-versions:end -->

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

- **On GitHub:** the **Security** tab of this repository, then **Report a vulnerability** (a private report only
  the maintainers see).
- **By email**, if you have no GitHub account: rp@spaceo.ca.

Include the version, what you did, what happened and what you expected. Never send real passwords, tokens or
personal data: use `example.com` addresses and made-up accounts.

## What happens next

- We **acknowledge your report within 3 working days**, and tell you whether we can reproduce it.
- We keep you told as we work on it, agree a date with you before anything is made public, and publish a fix and a
  GitHub security advisory as soon as the fix is ready.
- We credit you in the advisory, if you want that.

## Scope

In scope:

- the server (`packages/server`), with its sign-in, roles, publishing, forms and inbox;
- the editor (`packages/editor`);
- the Astro integration (`packages/astro`);
- the core converter and its checks (`packages/core`);
- the deploy recipes in `deploy/` (Docker, nginx, the example config).

Out of scope:

- a site's own build and deploy scripts, its block packs and its content;
- the hosting: the machine, its operating system, the reverse proxy's TLS set-up and the DNS;
- the example site in `examples/`;
- problems that need someone who already has the owner's or an administrator's account, or shell access to the
  server.
