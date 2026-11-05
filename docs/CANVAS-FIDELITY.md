# The canvas looks like the page

The canvas is where a writer edits an entry. It should look like the page a reader gets: the same column, the same
type, the same things in the margin, at every window width, and it should keep looking like it when the site's layout
changes, without anyone copying CSS into the editor by hand.

This note says why it did not, which ways of fixing it were weighed, what was built (`canvas.shell`), how it works,
what it does not do yet, and the guard that keeps it honest.

## What was wrong

With the site's stylesheets loaded (`css`) and its classes on the canvas (`canvas.articleClass`, `canvas.bodyClass`),
the canvas still drew the text on the editor's own sheet of paper. On a real site with a reading layout (a 680px
column, a rail beside it, notes hung in the right margin from 1280px up) that meant, at a 1440px window:

- the column was the sheet's width (903px), not the page's (680px), so every line broke somewhere else;
- the text was 17px on a 28.9px line, not 18px on 30.96px: the page's own breakpoints were measured on the window,
  and the rules that set the size hang off the page's `<html data-frame=…>`, which the canvas did not have;
- notes the page hangs in the margin sat in the text as boxes, because the margin is drawn by the page's grid;
- no site header, no rail, no table of contents: the page around the text was missing, so a writer could not see
  how much room a paragraph really takes;
- the text was the source as written. A site's build may change it on the way out (respelling, smart quotes,
  heading links, reading time), and the canvas did not show that, nor say it.

The fidelity guard (below) measured it on three long posts of that site: every one failed at both widths, with
paragraphs up to 5025px lower on the canvas than on the page at 1440 and up to 16065px at 390.

## The options

### (a) The page shell: the canvas inside the entry's real page

The editor reads the entry's real page (the dev server's HTML, same origin), keeps the page around the text, and puts
the canvas where the page's text element was. The page's CSS is rewritten so it reaches only that copy, and its
breakpoints are measured on the canvas's width, not the window's. Everything that is not the canvas is shown but
cannot be clicked.

- Exact: the column, rail, grid, header and margin notes are the site's own markup and CSS. When the layout changes,
  the canvas changes with it on the next load. Nothing is copied by hand.
- Editing stays as it is: one document, one ProseMirror, the same toolbar, handles, packs and shortcuts.
- Panels still work: open the Outline and the canvas narrows; the page follows its own breakpoints at that width.
- Costs: CSS rewriting (on the sheet's blocks, read with strings, comments and nesting respected), and some care
  where the editor's markup differs from the page's (a paragraph inside a list item, a line break typed in the
  source). Scripts of the page do not run (but its first `<head>` scripts, sandboxed: step 4).

### (b) A split view: the canvas beside the live preview

Keep the canvas as it is and show the real page (the preview, `API-PREVIEW.md`) beside it, scrolled in step.

- Exact on the right-hand side, with the build's own output, scripts and all.
- But the writer edits in one place and checks in another: the canvas itself stays wrong, half the screen goes to
  the preview, and scrolling in step is never exact when the two lay text out differently. The preview also only
  shows what was saved (or what a build of the draft gives, seconds later).
- Good as a tool beside (a), not instead of it.

### (c) The site's CSS plus the frame's attributes only

Keep the sheet of paper, but put the page's `<html>` and `<body>` attributes (`data-frame`, `lang`) on the canvas and
size the sheet to the page's column.

- Small, and it fixes the type size on simple sites.
- But it stops at what attributes can say: the column width still has to be told to the editor, notes still cannot
  hang in a margin the canvas does not have, the rail and header are still missing, and the breakpoints are still
  the window's. Every layout change means a matching change in the editor's config or a pack's CSS: the thing this
  work is meant to stop.

### Recommendation: (a)

Only (a) makes the canvas the page, and keeps it so on its own. (b) is worth adding later as "open the preview beside
it" for what (a) cannot show (scripts, the build's last word); (c) is a subset of (a).

## How it works (`canvas.shell: true`)

Code: `packages/editor/src/canvas-shell/` (`page.ts`, `css.ts`, `dom.ts`), styles in `styles/shell.css`.

1. **Read the page.** When an entry opens (and again after a save), the editor fetches the entry's page from the dev
   server: same origin only. It reads the page's `<link rel=stylesheet>` and `<style>` CSS too. On a server the
   page and its stylesheets come from the server's last build of the entry, as data ("On a server", below).
2. **Find the text.** The element with `canvas.bodyClass` is the text; the nearest `canvas.articleClass` around it is
   the article.
3. **Make it safe.** Scripts, frames, objects, `<base>`, `<meta>`, `<link>`, `<style>`, `on*` attributes, `autofocus`
   and `javascript:` / `vbscript:` / `data:text/html` links are removed. What is left is inert (`inert`): it can be
   seen, not clicked, focused or typed in.
4. **Stand-ins for `<html>` and `<body>`.** A `div.ms-pg` carries the page's `<html>` attributes (`data-frame`,
   `lang`, a theme), and a `div.ms-pg-body` the `<body>` ones. The page's body content goes inside. The attributes are
   the ones the page's first scripts leave (`first-paint.ts`): a site's `<head>` often sets a `js` class and the
   visitor's theme before the first paint, and its CSS shows or hides parts on them (a theme switch shown only with
   scripts on). Those inline classic scripts of `<head>` (no modules, nothing with `src`, no JSON) run in a frame of
   their own: `sandbox="allow-scripts"` (no origin: no access to the editor, its storage or cookies) and a content
   security policy that runs inline scripts and loads nothing (no analytics or tag manager starts from the editor).
   A last script reports `<html>`'s and `<body>`'s attributes; event-handler attributes are dropped. Without an answer
   within 2 s the page's own attributes are used. Then the page's colours, as its readers get them ("Colours", below).
5. **The canvas in place of the text.** The page's text element is replaced by the editor's canvas. The editor's
   head (title, byline, cover…) takes the place of the page's own: page elements before the text whose first class
   the head also draws, and the page's first heading of the title's tag, are hidden (`ms-pg-covered`). A title inside
   a header of the page's (the starter's `header.post__head > time + h1 + p`) is found there too, and the editor's
   head goes in its place, between what the page draws around it. The editor's wrappers have no box of their own (`display: contents`), so the canvas's children are where the page's were.
6. **Scope classes.** Frameworks that scope CSS per component mark elements with an empty attribute or a class
   (`data-astro-cid-…`, `svelte-…`). Those are copied from the page's text element and head onto the editor's, so
   the scoped rules reach them.
7. **The CSS, rewritten.** Each sheet's rules are read from its text (`parseRules`: blocks, strings, comments and
   nesting respected, every declaration kept as written) and written back. Not with the browser's CSSOM: it keeps a
   shorthand written with `var()` as one pending value, and when a later declaration sets one of its longhands the
   others come back empty (`border: 1px solid var(--line); border-left: 2px solid var(--accent)` read back as the
   left border only: a card on the page had a frame its canvas copy did not):
   - `html` becomes `:where(.ms-pg):is(div)` and `:root` becomes `.ms-pg`, with the same weight; `body` becomes
     `:where(.ms-pg-body):is(div)`. Every other selector gets `:where(.ms-pg) ` in front (and a second form for a
     selector about the stand-in itself, `[data-theme=dark] .x`), so it reaches only the shell, at its own weight.
   - Width media queries become container queries on the canvas: `@media (min-width: 1280px)` is
     `@container ms-vp (min-width: 1280px)`, where `ms-vp` is the canvas's scroll area. `em` and `rem` in them are
     turned into px (16px), as media queries read them. Other features (`prefers-reduced-motion`, `hover`) stay
     media queries; `print` rules are left out.
   - `vw` becomes `calc(N * var(--ms-vw))`, and `--ms-vw` is kept at one hundredth of the canvas's width.
   - `@supports`, `@layer`, `@container` and `@starting-style` are rewritten inside; `@font-face` and `@keyframes`
     are kept; `@import`, `@page`, `@charset` and `@namespace` are dropped.
   The result is one `<style>` at the end of the editor's head, cached by a hash of the page's CSS.
8. **What the editor's markup does differently.** In the shell only:
   - lines break as the page breaks them (`white-space: pre-wrap`, not ProseMirror's `break-spaces`);
   - a line break typed in the source inside a paragraph is a space, as on the page (decoration `.ms-soft`; the text
     keeps it, so the file is saved as written);
   - the items of a tight list hold their text with no paragraph margins (decoration `.ms-tight`);
   - a code block wraps or scrolls as the site's do (the page's `pre` is asked);
   - a field typed in place keeps the wrapping of the site's element around it;
   - the empty cover drop zone is not drawn: a cover the post does not have takes no room. It is added in Post
     settings (the byline and date open them).
9. **Overlays.** What the page fixes over the window (a cookie bar, a chat button) is hidden.
10. **The editor's own copy of the site's CSS, fenced.** The editor loads the site's `css` for itself too (packs,
    dialogs, the canvas without the shell), unscoped. Inside the shell that copy was wrong twice over: its `html` and
    `:root` are the editor's (`:root:not([data-theme=dark]) .logo-night { display: none }` hid the page's night logo
    in a dark canvas, since the editor's `<html>` never has the site's theme attribute), and its media queries
    measure the browser's window, not the canvas. The integration imports each file with `?ms-site`; `fence.ts`
    rewrites those `<style>`s (and again whenever the dev server replaces one) so every rule matches outside the
    shell only: `.a > .b::before` becomes `.a > .b:where(:not(.ms-pg, .ms-pg *))::before`, no weight added. Inside
    the shell only the scoped copy of the page's own CSS applies. The built editor (on a server) gets the same fence
    when it is built (`markstage build-editor`).
11. **Nothing of the editor's changes how a block looks.** The canvas's clearfix (`::after { display: table }`) kept
    the last block's bottom margin inside the text, where the page lets it run out: everything after the text (an
    author box, related posts, the footer) was that margin lower (48px on the pilot site). In the shell it is gone. The
    outline of the block being edited follows the block's own corners (no radius of the editor's or a pack's).

### Parts of the page that follow the text (`EditorPack.shell`)

The page around the canvas is as last saved. Some of it is worked out from the text: a contents list from the
headings, a reading time. A block pack keeps those live with `shell(ctx)` (`pack.ts`, `ShellCtx`). It is called when
the page is drawn, a moment after the text or a setting changes, and as the canvas scrolls, with:

- `root`: the page around the canvas, to find the site's own parts in;
- `headings`: the document's headings (level, text, and the heading on the canvas), and `text`: its words;
- `entry.frontmatter`: the settings as they are now, unsaved changes too (a "Show contents" switch);
- `live(el)`: that part of the page can be clicked and focused (the rest stays inert); a link in it never leaves the
  editor, its click is the pack's;
- `scrollTo(el)`: scrolls the canvas to a heading, below what the page keeps at its top (its `scroll-padding-top`);
- `scroller`: the canvas's scrolling box, where the page's own script would read the window (the item being read,
  the minutes left).

The pack draws the part with the site's own markup and classes, so the site's CSS draws it as on the page. A site
that lets a post turn such a part off gives it a `switch` setting (`CONFIG.md`), reads the key in its layout, and the
pack reads the same key from `entry.frontmatter`. The example blog does this for its list of contents
(`examples/blog/markstage/contents.ts`, "Show contents").

### Colours: the page as readers see it

The canvas shows the page as a reader whose system is in the editor's colour scheme sees it: never the editor's own
colours, in light or dark (`canvas-shell/scheme.ts`).

- **The site's dark colours** (config `themes.dark`) are turned on in a dark editor only when the page turns dark by
  itself for a reader in a dark system: its CSS has a `prefers-color-scheme: dark` rule, or a script of its reads the
  system's scheme. A site whose dark colours nothing on the page turns on (the example blog: `data-theme="dark"`,
  which only the screen check sets) stays light in a dark editor, as its readers get it. One the page's own first
  scripts turned on stays. The screen check's Light / Dark switch still shows the site's dark colours on demand.
- **What the page leaves to the browser stays the browser's**: the text colour (`CanvasText`), the scheme of its
  controls (light, or the page's `<meta name="color-scheme">`), its font, and the window's background (the page's
  `<html>` background, else its `<body>`'s, else `Canvas`, as the browser paints it). Before, a page with no text
  colour of its own took the editor's (light text in a dark editor), and the window around a narrow body was the
  editor's dark grey.
- **Code blocks take the page's code colours**: a highlighter gives the page's code blocks their colours inline
  (Astro's Shiki: `pre.astro-code` with `background-color` and `color`); the canvas's code blocks are the editor's,
  without them, so they get the same two colours, as an inline style weighs on the page. Before, a dark editor
  drew the page's light code box with the page's light text colour (1.2:1).

The guard checks it in both themes: every run of text on the canvas at least 4.5:1 against what is behind it ("The
guard", below).

### What the build does to the text: "What readers see"

A site's build may change the text between the file and the page. The canvas never changes the source to look like
the page: what is edited is what is saved. Two things show the difference instead:

- **"What readers see"** (bottom right of the canvas; `?readers=1` in the URL, so it can be linked). It shows the
  page's own text, as last saved, in place of the canvas: respelled words, typographic quotes, heading links, the
  reading time the site worked out. A note says so: "As last saved, with what the site does to the text." With
  unsaved changes: "As last saved: your unsaved changes are not in it." The button again goes back to editing.
- **Pack decorations** for what the build adds as markup, not as text (a heading's link button, a label): a block
  pack draws them on the canvas with `decorate` (`pack.ts`), outside the document, so the lines break where the
  page's do. A pack's head can also reuse the page's own drawing of a part of the head with `ctx.page(selector)`
  (`HeadCtx.page`, a copy of the page's element, as last saved), so a byline row with what the site works out is
  the site's, with only the editable parts (author, date) replaced.

## On a server

In `astro dev` the shell reads the entry's page from the dev server, on the editor's own origin. The built editor
served by `@markstage/server` (`editorDir`, `markstage build-editor`) has no such page on its origin: the site is
built by the publish job and served elsewhere, and the preview has an origin of its own, on purpose (`API-PREVIEW.md`:
the site's scripts run there, never where the editor's session is). So the server hands the page over **as data**:

```
GET /markstage/api/preview/:collection/:id/shell      (signed in)
→ { html, sheets: [{ path, text }], from: "site" | "draft", builtAt, path, frame }
```

and the shell treats it exactly as it treats the dev server's page: from step 2 on, nothing changes (find the text,
remove scripts and handlers, make it inert, scope the CSS, put the canvas in place of the text).

**For the writer.** On a server the canvas sits in the entry's real page too: the site's header, columns, frame
and footer, at the page's widths and breakpoints, with "What readers see". The page around the text is **the last
build** of it, not the last save: after a save the canvas still shows the new text, and the frame changes with the
site's next build (a publish, or a share link's build of the draft). "What readers see" says so: "As the site's
build of Nov 5, 10:42 has it: later changes are not in it." A draft no build has yet (a new post, a draft never
shared) opens on the sheet of paper as before, with a quiet note at the bottom right: "The page around the text
shows here after the site's next build."

**Which build.** The newest of the ones that have the entry's page (its address, `/posts/hello/` →
`posts/hello/index.html`):

- the site's own output, `verify.public` in `config.json` (the folder the publish job builds into and checks); for a
  protected page, `verify.private`. A redirect stub there (an entry that moved) is not its page;
- the draft's preview build: the one a share link of the draft makes, "as if published"
  (`API-RELEASES.md`, `<data dir>/releases/builds/e_<collection>_<id>`), once it has finished.

No new setting: without `verify.public` the server says so in the note, and the canvas is the sheet of paper.

**Its stylesheets.** The page's `<link rel=stylesheet>` to a `.css` file of the **same build folder** are read and
sent with it, by path (`/_astro/post.css`); the editor finds each link's text by that path. A link to another host
(`https://cdn…`, `//cdn…`, `file:`) is left out and never fetched. `<style>` blocks are in the HTML already. The
fonts and images the page and its CSS name by their built address (`/_astro/x.woff2`) are answered on the CMS
origin from `verify.public`, to signed-in people only, images and fonts only (`site-files.mjs`).

**The first `<head>` scripts.** Step 4 runs them in a sandboxed frame. In `astro dev` that frame is a `srcdoc`; on a
server it would take on the editor page's CSP, which allows no inline script, so the server has a frame page for it,
`GET /markstage/shell-frame`: an empty page whose own header says `sandbox allow-scripts` (no origin: no cookies,
no storage, no access to the editor, whatever loads it), `default-src 'none'` (nothing is loaded) and
`frame-ancestors 'self'`. The editor sends it the head (`postMessage`); the frame writes it and reports
`<html>`'s and `<body>`'s attributes, as the `srcdoc` does.

**The editor's copy of the site's CSS (step 10)** is fenced at build time on a server: `markstage build-editor`
runs the same `fenceSheet` on each `?ms-site` file after Vite has compiled it (imports inlined), so the bundled copy
matches outside the shell only, as it does in `astro dev`.

### Its safety rules

| Rule | How | Proof |
|---|---|---|
| No site script runs on the CMS origin | The page comes as JSON (`Content-Type: application/json`, the API's `default-src 'none'` CSP, `nosniff`): never a page on the CMS origin. The editor parses it with `DOMParser` (nothing runs or loads), then the same `sanitize` as in dev removes every script, frame, `<base>`, `<meta>`, `<link>`, `<style>`, `on*` attribute and `javascript:` link before any of it is in the editor's document, and makes the rest inert. Head scripts run only in the sandboxed frame (`sandbox allow-scripts`, no `allow-same-origin`, by the frame's attribute and by its own header) | `shell-page.test.mjs` "the frame the first <head> scripts run in…"; `canvas-server.e2e.mjs` "the page's scripts never run on the CMS origin…" (a script, an `onerror` handler and a cookie read in the built page: none ran in the editor, the head script ran in the frame with no cookies) |
| The same sanitising as in dev | One code path from the parsed document on (`page.ts` `open`): only where the HTML and CSS texts come from differs | the e2e above, and the fidelity guard on the server |
| No file outside the build folder | The page and each stylesheet through `staticFileIn` (`static-file.mjs`): no `..` (also encoded), and the real path, links followed, inside the folder's real path. Stylesheets `.css` only, the page `.html` only; the entry's address must start with one `/` | `shell-page.test.mjs` "never a file outside the build folder…", "an entry whose address leaves the site or the folder…" |
| No request leaves the server (no SSRF) | Nothing is fetched by address: a link to another host is left out; `@import` and `url()` in the CSS are text, never followed by the server. In the editor, `@import` is dropped (step 7) and the CMS's CSP (`img-src`, `font-src`, `connect-src 'self'`) keeps `url()` on its own origin | `shell-page.test.mjs` "no request leaves the server…" (a stand-in host counts zero requests); the e2e counts zero too |
| Only the web's addresses | `sanitize` keeps an address only when it is relative, a `#fragment`, http(s), mailto or tel (an image's source also `data:image/…`), read as a browser reads it: ASCII whitespace and control characters taken out first, so `java&#9;script:`, `&#1;javascript:` and a newline in a `formaction` are dropped too. SVG `set` and `animate*` (which could write a `javascript:` address after the page is drawn) are dropped. In the page around the canvas no link, image-map area or form button leaves the editor, and no form is sent | `shell-sanitize.test.ts` (the review's payloads, in Chromium with no CSP, clicked: nothing runs, nothing navigates) |
| Size limits | The page's size from a stat first: over 4 MB it is never read (`413 too-large`, the sheet of paper), not even to see whether it is a redirect stub; a stub check reads a file's first 4,000 characters only. Each stylesheet at most 2 MB, 8 MB in all; the page's links are read up to the first 64 distinct `.css` files (a Set, one pass: 60,000 links cost milliseconds) | `shell-review.test.mjs` 1 and 2; `shell-page.test.mjs` "a redirect stub is not the page; size limits…" |
| Who | Signed in, any role: whoever may read the entry (every signed-in role reads every entry, `SECURITY.md` "Known limits"). Signed out: `401`. A collection that is not the site's, or an entry not in it: `404` | `shell-page.test.mjs` "signed out: 401…", "…every role that may read it has it" |
| Kept, and where | On the server by the files' size and time: at most 32 answers and 64 MB. Never on the browser's disk (`Cache-Control: no-store`: a draft's or a protected page's HTML does not stay after sign-out); the editor keeps the last 4 in memory and asks with `If-None-Match` (the answer's `etag`), so an open or a save that finds the same build is a `304` | `shell-review.test.mjs` 3; `shell-page.test.mjs` "a repeat is a 304 (ETag)…" |

Nothing new is written to the audit log: reading an entry is not audited either.

## What it does not do yet

- **Scripts after the first paint.** Only the page's first `<head>` scripts run (sandboxed, step 4). What later
  scripts do (cards that slide in on scroll, a "Read more" under a clamped bio, a menu that closes) is drawn by the
  site's block pack in its resting state, from the same markup (`EditorPack.shell`, and the pack's node views for
  blocks of the text): the pilot site's `markstage/blocks/settled.ts` marks every `[data-reveal]` in and shows "Read more"
  when the bio is clamped. "What readers see" is the same page.
- **Images before they load.** The page's images carry their width and height (the build knows them); the canvas's
  are the source's (`![alt](src)`), so until an image has loaded it takes no room and the text below it sits higher.
  Once loaded it is the page's size. The guard measures both with their images loaded.
- **The editor's own copy of the site CSS.** `css` is still loaded for the editor as before (packs and dialogs use
  it), unscoped. A rule there that depends on the window's width can still reach the editor while a panel narrows
  the canvas. It has not mattered so far; a site can scope it.
- **Not the build's last word.** The canvas is the page as last saved, with the edited text in place. What the build
  would make of the unsaved text shows after a save, in "What readers see".
- **On a server, the last build.** The page around the text is the newest build that has the entry (above), so a
  change to the site's layout shows after its next build, and a draft that was never built has no page around it.
  The server does not start a build for the canvas.
- **On a server, images on another host.** The CMS's CSP allows images from its own origin only, so an image whose
  source is on another host (`![](https://…)`) takes no room on the canvas (with or without the shell); on the page
  it does. The guard runs on posts whose images are the site's own.
- **Later, maybe:** a snapshot `<iframe>` of the page for exact script-made states, side by side (option b).

## The guard

`packages/editor/scripts/canvas-fidelity.mjs` (also `@markstage/editor/fidelity`) opens an entry in the canvas and
its real page at the same window width, measures both, and fails when they differ:

- the frame: the page's `<html>` `data-*` attributes and `lang`, on the stand-in;
- the text column: edges, height, font size, line height;
- each paragraph, list, quotation and code block directly in the text, each h2 and h3, table, figure, caption, image
  and embed at any depth, and each of the site's own `parts` (`[name, selector]`, e.g. a note hung in the margin):
  edges, width, height, font size, line height, and its top measured from the top of the column;
- every block of the text, whatever it is (`block`: a card, a callout, a block of the site's HTML): its box and its
  look (colour, background, corners, border);
- the title: edges, size, and where it sits above the column;
- the head (`head`): each box in the article above the text (title, byline, cover) and each image in it, box and look;
- what follows the text in the article (`after`: an author box, related posts), its top from the text's bottom;
- the page around the article (`frame`): every element of it (the site header with its logo, menu, buttons and theme
  switch, the side column, the footer), box and look. Elements are paired by tag and classes (state classes like
  `is-in` aside), so one the canvas lacks or adds is named ("the page's fieldset.theme is not on the canvas"), not a
  shift of everything after it. Tops of what comes after the text are measured from the text's bottom; the side
  column, as tall as the text, has no height compared. What the page lays over the window (`position: fixed`) and
  the editor's own controls (`data-ms-ui`, a control of `ms-` classes only) are left out;
- each of the site's `frameParts` found in the page around the text (`[name, selector]`, e.g. the items of a contents
  list in the side column): how many are shown, their edges, size and top.

And in every run, **contrast** (`scripts/canvas-contrast.mjs`, `contrastIn`): every run of text on the canvas
(paragraphs, headings, lists, quotations, code, tables, links) and in the article around it (the title, the head,
what follows the text) must have a WCAG contrast of at least 4.5:1 against what is really behind it: the first
background that is not transparent, walking up through the page shell to the editor, partly transparent ones laid
over what is under them. Nothing light on light, nothing dark on dark. The report gives the lowest ratio per kind.

Each run is one width, one theme (`themes`: `light`, `dark`, the browser's colour scheme, which the editor and the
page both follow) and one side panel (`sides`: `''`, or `outline`, `seo`… which narrows the canvas; the page is then
measured in a window as wide as the canvas). Lefts are measured from the page's left edge (the stand-in's on the
canvas). Both sides are measured with their images loaded.

`checkSwitch({ base, entry, label, hides })` checks a Post settings switch that takes a part of the page away: with
the entry on the canvas it counts the shown `hides`, turns the switch off (none may be left), and on again (the
same number). Nothing is saved.

A length may be off by `tolerance` px (2), a font size by 0.1px, a line height by 0.5px, a look not at all; tops and
heights use `topTolerance`
(default the same), raise it only for a site whose build respells words and so moves a line break. The page is
measured with reduced motion and after scrolling through once, so what slides in on scroll has come to rest; then it
is back at its top, and so is any box that scrolled with it.

```
node packages/editor/scripts/canvas-fidelity.mjs --base http://127.0.0.1:4321 \
  --entry posts/hello=/blog/hello/ --widths 1440,390 --themes light,dark --sides ,outline --body-class "post__body" \
  --part note=.note --frame-part contents='.contents a' [--shots <dir>]
```

or from a test:

```js
import { checkFidelity, report } from '@markstage/editor/fidelity';
const results = await checkFidelity({ base, entries: [{ entry: 'posts/hello', page: '/blog/hello/' }], bodyClass: 'post__body' });
assert.ok(results.every((r) => r.ok), report(results));
```

On a server, `--base` is the Markstage server (the built editor), `--page-base` the built site as readers get it,
and `--storage-state` a signed-in browser's state (Playwright's `storageState` file); from a test, `pageBase` and
`storageState`:

```
node packages/editor/scripts/canvas-fidelity.mjs --base https://cms.example.com --page-base https://www.example.com \
  --storage-state signed-in.json --entry posts/hello=/blog/hello/ --widths 1440,390 --body-class "post__body"
```

Run it after any layout change on the site. Markstage runs it at 1440 and 390, light and dark, on the example blog in
`astro dev` (`packages/server/e2e/canvas-shell.e2e.mjs`) and on a server, the blog built by Astro and the editor by
`markstage build-editor` (`packages/server/e2e/canvas-server.e2e.mjs`), and on the starter in `astro dev`
(`canvas-starter.e2e.mjs`): every measure 0px off, every run of text at least 4.5:1. The blog's dark colours are
reached by an attribute only, so it is light in both themes; the starter follows the reader's system, so it is dark
in a dark editor: the two cases of "Colours" above. The live demo is checked the same way in both themes
(`demo.e2e.mjs`).

### Before and after, on a real site (three long posts, 1440 and 390)

| | Before (sheet of paper) | After (`canvas.shell`) |
| --- | --- | --- |
| Text column at 1440 | 268.5 to 1171.5 (903px), 17/28.9px; page 384 to 1064 (680px), 18/30.96px | 384 to 1064, 18/30.96px |
| Text column at 390 | 80 to 310; page 16 to 374 | 16 to 374, 17/28.9px |
| Margin notes at 1440 | up to 831.5px off to the left, in the text | in the margin, 0px off |
| Worst paragraph top | 5025px off at 1440, 16065px at 390 | 0px |
| Result | 6 of 6 runs fail | 6 of 6 runs pass, every measure 0px off |
| Side column at 1440 | no side column | the contents list (3, 21 and 7 items, drawn by the site's pack from the canvas's headings) and "x min left", 0px off |

On the example blog (`examples/blog`, a two-column guide with a list, quotation, code block, table and raw HTML) the
guard passes at both widths with every measure 0px off.

### Round two: everything around the text

The guard above measured the text only, so it passed while the page around it still differed. Measured again on the
same site, with the guard as it is now (everything around the text too, in light and dark), before and after:

| What | Before | After | Why it differed |
| --- | --- | --- | --- |
| Header at 1512 | no theme switch (94px on the page), the menu's right end 110px further right | the page's | the page's `<head>` adds `js` to `<html>` and its CSS shows the switch only then; the shell ran no scripts (step 4) |
| Header logo, dark | none (154px on the page) | the page's | the editor's unscoped copy of the site's CSS asked the editor's `<html>` for the theme (step 10) |
| Author box | 255.9px high (284.2 on the page): no "Read more" | 284.2 | a later script shows "Read more" under a clamped bio: drawn at rest by the site's pack |
| Everything after the text | 48px lower (18px on a post ending in a table) | 0 | the canvas's clearfix kept the last block's bottom margin (step 11) |
| "Key takeaways" box | 14px corners (2px on the page) | 2px | the editor's and the pack's radius on the box being edited (step 11) |
| A call-to-action card after the text | no top, right or bottom border | the page's | the CSSOM lost `border: 1px solid var(--line)` before `border-left` (step 7) |
| Body images | 0px off once loaded | 0px off once loaded | no difference; before it loads an image takes no room on the canvas ("Images before they load") |

Four long posts at 1280, 1440, 1512 and 1920, light and dark, and at 1512 with the Outline open: every run passes
with every measure 0px off, but one post whose source has a block of HTML the editor cannot draw (a `</div>` with
text right after it, no blank line): the canvas shows that block as source, 147.6px shorter, and the guard says so.
