# Changelog

What changed in each Markstage release, in plain words. The newest is first. Versions follow
[semantic versioning](https://semver.org); while Markstage is 0.x, a minor version may change how things work.
docs/RELEASES.md says how a release is made.

## Unreleased

### Added

- A live demo at https://spcaeo.github.io/markstage/demo/: the real editor on the example blog, in the browser
  with no sign-up. A save runs the same Markdown writer as a server and shows the git diff it would commit; edits
  stay in the browser tab, and Reset demo clears them. Publishing, users, settings and the other changes answer
  "Not in the demo" with a link to the install steps. docs/DEMO.md says how it is built and recorded.

### Fixed

- With the drawer folded to its rail, the top bar at 1280 to 1440 pixels wide with unsaved changes no longer
  pushes Publish, Save and the account button off the screen: its buttons give up their words first, as they do
  with the drawer open.
- Saving a page in the page view after its first save no longer writes "null" into the page or stops with an
  error.

### MDX

- Markstage now edits MDX files. MDX too: code stays locked, prose is editable. A collection with
  `format: 'mdx'` lists its `.mdx` files, and they open on the canvas like Markdown (docs/MDX.md).
- The two promises hold for MDX: open and save with no edit leaves the file byte for byte the same, and an edit
  changes only what was edited.
- Imports, exports and `{expressions}` are kept exactly as written and shown as quiet locked lines ("Uses 2
  components: Callout, Chart"). The editor will not delete or move them.
- A component is a card with its name and settings. Text, number and on/off settings change in the side panel; the
  save rewrites only that value and keeps its quote style. Settings that are code are shown read-only. The text
  inside a component (a Callout's words) is typed in like any other text.
- What the writer types never becomes code: `<`, `{` and a line starting with `import` or `export` are escaped.
- A file the MDX reader cannot read opens read-only in Source mode with a plain message and its line, and the server
  refuses a save over it.
- A contributor may change words and simple settings in an MDX file, never the code.
- The example blog has an MDX guide with a Callout and a Chart.
- New dependency: `remark-mdx` 3.1.1 in `@markstage/core` (its licence is listed in NOTICE).

## 0.3.0 (3 November 2026)

The first public release: the source is on GitHub under the Elastic License 2.0 (source-available, free to
self-host), with a website, docs and a sourced comparison at https://spcaeo.github.io/markstage/.

### Security

- A security review: its findings are fixed or, where a trade-off stays, written down in docs/SECURITY.md. Among
  them: a link to `javascript:` (or a trick that hides it) is refused for every role, the preview page can no
  longer press Save or pick what the pages editor edits, a file outside the build is never served, a signed-out
  visitor cannot tell which files the repo has, and only people who can promote or sync can make the server
  fetch, at most once every 30 seconds.
- Sign-in lockouts now hold the account and the address together, so one person's wrong passwords cannot lock
  someone else out.
- The public release address (`/markstage/api/release`) answers with the release line only.

### Fixed

- The findings of two quality passes, for example: a title longer than 300 characters is refused with a plain
  message instead of being cut, a title with no Latin letters (Arabic, emoji) gets a dated address, a scheduled
  post can be un-scheduled, a bad entry can no longer stop every build, and on a phone Save and Publish stay on
  screen.
- The release line in the footer uses plain spaces on every machine.

### New

- Images & files can list the pictures the site already has.
- The site's preview starts warm with Markstage, so the first preview opens quickly.
- Dependabot keeps the dependencies and GitHub Actions up to date, and CI runs every check, every package's tests,
  the browser tests, a dependency audit and a secrets scan on each push and pull request.
- `SUPPORT.md`, issue forms, a pull request template and this changelog; a pre-commit secret scan.

## 0.2.0 (2 November 2026)

The first numbered release. Everything below is in it.

### Writing on the real page

- The editor draws each entry inside the site's own page shell, with the site's components and CSS, so a writer
  sees what a reader will see. Alt text, captions and links are edited where they appear.
- Saves are surgical: opening and saving changes nothing, and moving a block and moving it back gives the same
  bytes. Every save is a clean git diff of exactly what changed.
- Never lose typing: local recovery copies, retry when offline, a three-way merge when two people edit, and
  "Sign in again" that keeps the text.
- Blocks move by keyboard, by the grip or in the Outline; find and replace; images edited on the page; Light, Dark
  and System themes for the editor; plain words everywhere.

### Pages and the Library

- JSON pages are edited on the page itself, with their sections and fields in a panel.
- One Library of templates, sections and snippets, with synced copies (Apply, Undo, Detach), packs to export and
  import, and sections dragged from the Library onto the live page.
- A section gallery that draws every section type and variation alone.

### Running the site

- A secure server: sign-in with two-factor codes and single sign-on, roles and custom roles, invitations, and
  every rule the screens show also enforced on the server.
- Publishing as background jobs, scheduled publishing, releases that publish several changes together, share
  links for previews, and rollback of a bad release.
- Environments: staging next to production, with plans, promotion rules, sync and rollback.
- Media library, menus, redirects, categories and tags, authors, a page tree, bulk changes, trash, locks, backups
  and translations.
- Forms with an inbox, spam handling, alerts and a daily digest; optional sending to a CRM and an analytics tool.
- Site check-up: SEO checks while writing, publish rules, links and a topic map, broken links, speed from field
  data, and what the host serves for every address.

### Packages and deploy

- `@markstage/core` (the Markdown and JSON converter and its checks), `@markstage/editor`, `@markstage/astro` (the
  Astro integration and the `markstage` command) and `@markstage/server` (the server, `markstage-server` and
  `markstage-deploy`).
- A Docker image and compose file, nginx recipes and a publish gate (docs/DEPLOY.md), with every secret as a
  placeholder.
- An example blog (`examples/blog`) to try the editor on.
- The release line `v0.2.0 · build N · <date and time>` in the editor's footer and from the server.
