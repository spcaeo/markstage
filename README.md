# Markstage

**Edit your Markdown on the real stage.**

Markstage is a visual editor for Markdown and JSON content sites. Writers edit on the site's own design, not in
grey form fields, and every save is a clean git diff of exactly what they changed. No database for content, no
MDX, no cloud. First adapter: Astro.

- **The real page.** The editor shows the site's own components and CSS; alt text, captions and links are edited
  where they appear.
- **Surgical saves.** Open and save changes nothing; moving a block and moving it back is byte-identical.
- **Never lose typing.** Local recovery copies, offline retry, and a three-way merge when two people edit.
- **Run the site from the editor.** Media library, menus, redirects, find and replace, bulk changes, trash,
  scheduled publishing, locks, backups, rollback and site health, with roles and two-factor sign-in.

Status: pre-release, in active development. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design,
[docs/CONFIG.md](docs/CONFIG.md) to set a site up and [docs/DEPLOY.md](docs/DEPLOY.md) to run the server.

## Requirements

Node.js 22.13 or newer, and git. The server keeps its users, sessions and inbox in `node:sqlite`, which Node has
without a flag only from 22.13 on. Development and CI use Node 24.

## Security

How to report a problem, the supported versions and what is in scope: [SECURITY.md](SECURITY.md). The threat
model, every control and the test that proves it, and what personal data Markstage keeps (for GDPR and PIPEDA):
[docs/SECURITY.md](docs/SECURITY.md).

## Licence

Markstage is **source-available** under the [Elastic License 2.0](LICENSE): you may use, copy, change and
self-host it for free, including in your business and for your clients' sites. You may not offer it to others as
a hosted or managed service without a commercial licence from Space-O Technologies. The name, logo and tagline
are trademarks; see [NOTICE](NOTICE).

Contributions are welcome under a short contributor licence agreement: see [CONTRIBUTING.md](CONTRIBUTING.md).

Copyright 2026 [Space-O Technologies](https://www.spaceo.ca). Author: Rakesh Patel (rp@spaceo.ca).
