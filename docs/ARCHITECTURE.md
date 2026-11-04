# Markstage: architecture

Source-available (Elastic License 2.0, free to self-host; see LICENSE and NOTICE) visual editor for Markdown/JSON content sites. Write on the site's real design, save clean git
diffs, no database, no MDX, no cloud. First adapter: Astro. It was first built for a real 460-page Astro business site with its own block pack, called "the pilot site" in these docs.
Goal: as close to Ghost and WordPress as a git-based editor can be, with a sign-in and a full editorial journey.

## Principles (non-negotiable)

1. **Byte-safe saves.** A save rewrites only what changed; open + save with no edit = identical file. Every content
   type ships a round-trip proof that runs in tests (identity on all fixture/real files, and a build comparison).
2. **Real design.** The writer edits on the site's own CSS/components. No grey form-only editing for body content.
3. **Generic core, per-site config.** No site names, paths, CSS classes or box shapes in `packages/*`. A site gives
   one `markstage.config.ts` plus optional block packs. The pilot site's boxes are a block pack living in its own repo.
4. **Every state has a URL** (`#/…` routes for article, page, panel, palette, revision, settings). Back/forward work.
   Opaque ids only. Every URL shown gets copy + open icons; every text value a copy icon (green tick 1.5 s).
5. **Max 1000 lines per file.** Types, constants, hooks and helpers are split out before a file crosses the line
   (`npm run lines` checks it).
6. **Simple for a non-technical writer.** Calm chrome, internals hidden, plain words.

## Packages

```
markstage/
  packages/core/      pure Node/browser, no framework: document model, Markdown <-> doc converter with a
                      block-pack API (parse/print/schema/panel/inserter preview per block), JSON-entry engine
                      (schema-driven fields, surgical JSON save), changedBlocks, frontmatter edit (surgical YAML)
  packages/editor/    browser client (TipTap 3, vanilla TS): shell, palette (Cmd+K), canvas, inserter, toolbar,
                      side panel, post settings drawer, media library, revisions view, page overlay editing
  packages/server/    production server (Node 22+, minimal deps): auth, users/roles, sessions, 2FA, content API,
                      drafts/publish/schedule, revisions (git), media, audit log, security headers
  packages/astro/     Astro integration: dev mode (no login, localhost only) + config loader + field bindings helper
  examples/blog/      demo Astro blog using only the generic core (proves "generic")
  docs/               ARCHITECTURE.md (this), API.md, SECURITY.md, CONFIG.md, DEPLOY.md, the writer guide (WRITING.md)
```

Site side (the pilot site's repo): `markstage.config.ts` (collections, URL builder, CSS, preview command) and
`markstage/blocks/` (its pack: takeaways, sideNote, callout, facts, steps, caseStudy, stats, layoutCards,
formDemo, faq, prosCons). Markstage began as an editor inside that site's repo and was then made generic.

## Content types

- **Articles** (Markdown + YAML frontmatter): edited in place on the canvas. Frontmatter edited in the Post settings
  drawer, saved surgically (only changed keys rewritten, key order and quoting kept).
- **Pages** (JSON entries with typed sections, e.g. Keystatic `fields.conditional` sections): edited **on the real
  rendered page**. Site components emit field bindings only in editor mode, e.g.
  `data-ms-field="sections.3.value.heading"` (`data-ms-kind="text|rich|image|link|list"`), via a helper from
  `packages/astro`. A production build must stay byte-identical (bindings never emitted there). Text and rich-HTML
  fields edit inline on the page; everything else in the side panel from the schema (labels, enums, arrays add /
  remove / reorder, image picker). Sections add / remove / reorder / duplicate from the page outline. Save writes
  only the changed paths and keeps the file's JSON formatting, so Keystatic still reads and writes it with 0 diff.
- **Other collections** (authors, categories, clusters, settings): schema-driven forms, same JSON engine.

## The writer's journey (Ghost / WordPress parity)

1. **Sign in** at `/markstage/` → email + password (+ 6-digit code if 2FA on). Forgot password: owner resets from
   the users screen or CLI (no email sending in v1).
2. **Dashboard**: Posts and Pages lists with filters in the URL (status: draft / scheduled / published, author, tag,
   search), sort, counts. New post, duplicate, delete (to trash, restorable).
3. **Editor**: title, canvas, "/" and "+" inserter, toolbar, Cmd+K palette, internal link search, word count +
   reading time, find & replace, autosave every few seconds to a private autosave (never the live file).
4. **Post settings drawer**: URL slug, excerpt, cover image + alt, tags/categories, author, publish date, SEO title
   and description with counters and a Google preview, social card preview, canonical, noindex, featured.
5. **Preview + device check**: the real page in a new tab, including unsaved/draft changes
   (preview render). Inside the editor a device switcher (`?device=desktop|tablet|mobile`, plus custom width)
   shows the real rendered page in a frame at 1440 / 820 / 390 px, with portrait/landscape, so the writer checks
   mobile layout before publishing. A responsive content check flags overflowing tables, wide images, long
   unbroken words and tiny tap targets at mobile width.
6. **Publish**: Save draft / Publish / Schedule / Update / Unpublish, with a confirm sheet (Ghost style). Publish =
   write file, git commit (author = signed-in user), run the site's build, then the site's deploy step (a configured
   command). Status and log visible; failure leaves the live site untouched.
7. **Revisions**: list from git per file (who, when, message), visual compare, restore as a new revision.
8. **Content checks** before publish (site-provided, e.g. the pilot site's 14 verifiers): blocking errors vs warnings.
9. **Media library**: paste/drop/upload, alt text required, reuse, search, delete unused; images resized/re-encoded.
10. **Raw source**: every entry has a "Source" mode (`?view=source` in the URL) to read and
    edit the raw Markdown/JSON in a code editor (line numbers, syntax colours, find), with the same version/409
    rules; switching back re-parses and shows any block that fell back to raw HTML. Also: Download .md/.json,
    Copy as Markdown (whole entry or a selection), Import a .md file as a new draft (frontmatter validated).
    Contributor's source edits go through the same raw-HTML restriction.
11. **Snippets & templates**: save a selection or box as a reusable snippet; new post from a template.
12. **Users & roles** (WordPress names): Owner, Administrator, Editor (all content), Author (own posts, publish),
    Contributor (own drafts, cannot publish). Invite = owner creates the user and gives a one-time setup link.
13. **Password-protected pages** (WordPress feature, in scope now): a `protected` setting per entry; the build
    emits those pages to a private folder, not the public one, and the Markstage server (or nginx `auth_request`
    to it) serves them only after the visitor enters the page password (hashed, rate-limited, signed cookie per
    page, noindex, excluded from sitemap/RSS/llms.txt/search).

## International SEO

Generic locale support, configured per site (`locales: [{code, prefix, default, spelling?}]`, `xDefault`).
For example: root = en-CA (x-default, a Canadian spelling pass at build), `/en-us/` = the en-US copy; one source file.
- The editor edits the single source and says so; a **Region** switch (`?region=`) previews each locale's rendering
  (spelling differences highlighted) in the device frame.
- Post settings show every locale URL with copy/open icons and the hreflang set the page will emit; per-locale
  overrides (title, description, slug) only where the site config allows them.
- Every feature is locale-aware: drafts, scheduling, protection, unpublish, delete and move apply to all locale
  copies at once; a protected/draft page is removed from every locale's hreflang set, sitemap, RSS, llms.txt and
  link cards (no hreflang pointing at a missing or private page); a slug move redirects every locale's old URL.
- Checks: reciprocal, self-canonical hreflang on every page, `html lang` / `og:locale` / `inLanguage` per locale,
  x-default present, no hreflang to non-200 URLs; publish blocks on a failure.

## Design & Code

WordPress "Additional CSS" + theme file editor and Ghost "Code injection", for git-based sites. Site config declares
`design: {tokens: 'src/styles/tokens.css', customCss: 'src/styles/custom.css', files: [{path, label, scope}],
scripts: [{path, label}], inject: {head, foot}}` with the load order, so the editor can explain which file wins.
- **Design settings**: token pickers (colours, fonts, sizes, spacing) parsed from the tokens file; live preview;
  saved surgically (only the changed custom-property values).
- **Custom CSS**: CodeMirror editor; applied live to the canvas and the device frame (CSS hot-swap) before saving;
  saved to the custom file loaded last.
- **Inspect**: click an element on the canvas or frame → the matching rules with file:line, in cascade order
  (winner first); "Override this" starts a rule in custom CSS with the right selector.
- **Code injection**: site-wide head/foot and per-entry (frontmatter `codeInjection`) HTML/JS. Owner/Administrator
  only (server-enforced, audited); runs only on the preview origin while editing, never in the CMS; the site's CSP
  gets the needed hashes/origins at build (site contract).
- **Core files**: listed files viewable by everyone, editable by Owner/Administrator in a code editor; every code
  save goes through validate + build + checks (build, mobile overflow, contrast, hreflang) before publish; revisions
  and one-click restore like content.
- Component structure (.astro/.tsx) stays developer work in git; the editor shows it read-only at most.

## Security (detail in docs/SECURITY.md)

Argon2id/scrypt password hashes; no default password (first owner via one-time CLI setup token); sessions in
httpOnly + Secure + SameSite=Strict cookies, rotated at login, idle + absolute timeout, server-side revoke; CSRF
(Origin check + token on every write); login rate limit + progressive lockout + constant-time compare; TOTP 2FA with
recovery codes; every API action checks role server-side; path/slug allowlists (no traversal); upload type sniffing,
size limits, SVG rejected or sanitized, images re-encoded; raw HTML in the editor drawn through the editor's own sanitiser (`canvas-shell/dom.ts cleanHtml`) and
Contributor cannot save raw HTML; strict CSP and security headers; audit log (who did what, when, from where);
secrets only in env/files outside the repo; dev mode binds to 127.0.0.1 only and is refused in production.

## API (packages/server; dev mode implements the same contract without auth)

Prefix `/markstage/api/`. JSON. Writes need the session cookie + `X-CSRF-Token`. Optimistic concurrency: every
entry has `version` (sha1 of file text); a write with a stale version returns 409 with the current version.
`docs/API.md` is the contract; the editor and the server both follow it, and a change to one is made in the contract first.

## The content index (server)

The server never reads a whole collection to answer a list, a count, the link map, the site check-up or "which
pages use this picture". `content/index.mjs` keeps every entry's parsed fields, word count and file version in
memory, once per file version. Before it answers, it stats the collection folders (readdir + stat, a few
milliseconds for a thousand files, at most once per turn of the event loop) and re-reads only the files whose size,
mtime or inode moved; files that are gone are dropped. So a save through the store shows at once, and a `git pull`
in a terminal, a checkout by the environments or a file edited by hand show on the next request. A stale index is
worse than a slow one, which is why the check is a stat sweep and not a counter alone.

`store.rev()` is the content version: a number that moves on every change seen. Everything derived from the index
is kept by it and rebuilt only when it moved: the link map (`links/map.mjs`), the known pages for link checks
(`preflight.mjs knownPages`), the per-version findings of the publish rules (images, headings, links), the
`media_uses` table (`media/uses.mjs`, path piece → entries, brought up to the index before each media answer), and
the light index the editor boots from (`GET /index`, with an ETag). Long loops (the site check-up, a bulk change)
yield to the event loop every twenty entries, so other people's requests are answered meanwhile.
`test/content-index.test.mjs` proves the index follows a save, a hand edit, an outside commit and a pull.

## Ports (local)

Dev editor on the site's own dev server and port. Markstage production server locally: 18231. Example blog
dev: 18233. Spare: 18235, 18237.

## Status

Markstage is pre-release. Everything described above is in scope; [CHANGELOG.md](../CHANGELOG.md) says what each
release added, and the README's roadmap lists what is still to come.
