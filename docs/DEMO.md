# The live demo

The live demo at <https://spcaeo.github.io/markstage/demo/> is the real Markstage editor on the repo's example blog
(`examples/blog`), served as static files with no Markstage server behind it. Anyone can open it with no sign-up.
This page says what it is made of, what works in it, and how to build it again.

## What a visitor sees

1. The landing page, `/demo/`, says what the demo is and links into the editor at the post *Hello, Markstage*.
2. The editor opens with a strip above its top bar: *Live demo: sample blog, nothing is saved, edits stay in your
   browser*, with **Your changes**, **Reset demo** and **Install Markstage**. The strip never covers the top bar:
   the editor moves down by its height (`packages/editor/src/demo/demo.css`). On a phone it keeps *Live demo* and
   its three buttons. Its colours are its own tokens (`--ms-demo-*`): the demo build fills them from the public
   site's brand tokens in `site/styles.css` (`brandCss` in `scripts/demo/html.mjs`), so a new site brand reaches
   the strip with no editor change.
3. The post is drawn on its own page, with the blog's design, as on a server (the canvas shell reads the page
   from `/demo/blog/`, a normal build of the example blog under that path).

## What is real

- **Editing**, in Visual and in Source mode: the same editor bundle a server serves.
- **Save.** The save runs `@markstage/core` in the browser: the same surgical writer that a server runs, so only
  the blocks you changed are rewritten, and everything else stays byte for byte. A dialog then shows *the git diff
  this save would commit* (`packages/editor/src/demo/diff.ts`), and `?changes=last` keeps it in the address.
- **Your edits are kept** in this browser tab (`sessionStorage`, the key `markstage.demo`): a refresh keeps them,
  and **Your changes** (`?changes=all`) lists every save with its diff. **Reset demo** clears them and reloads.
- **Download** of an entry gives the `.md` file as it is now, with your edits.
- **Reading** every screen: Home, Blog posts, the publish checks, History, the Library, Messages, Site settings and
  the rest. Their answers were recorded from a real server (see below), so they show real data of the sample blog.

## What says "Not in the demo"

Every other change, for example Publish, scheduling, releases, environments, users and roles, settings, uploads
and AI suggestions, answers *Not in the demo: install Markstage to try this*, in a small dialog with a link to
the install steps, and in the editor's own message line. Nothing in the demo shows a raw error, a spinner that
never stops or a missing page for these. Changing a post's status (draft, publish date) in a save is refused the
same way, since that is publishing.

## How it is built

`npm run demo:build -- OUT [--base /path/] [--install URL]` writes, into `OUT`:

| Folder | What |
| --- | --- |
| `blog/` | `examples/blog` built by Astro under `<base>blog/`, drafts included, with the preview agent added to each page |
| `editor/` | The editor, built by `buildEditor` with `basePath` `<base>editor` and the `demo` option |
| `data/api.json` | The recorded answers (a copy of `scripts/demo/recorded/api.json`) |
| `index.html` | Only when there is none: a small noindex page that opens the editor |

The `demo` option makes the editor's client add one import: `installDemo(config)` from
`packages/editor/src/demo/`. It answers the editor's calls to the API in the browser instead of the network
(`standin.ts`): recorded answers for reads, the core writer for saves, and the refusal for the rest. **A normal
build has none of it**: the import is added only when the option is set, and `packages/astro/test/build-editor.test.mjs`
checks that a normal build carries no part of the demo.

On the public site the Pages workflow (`.github/workflows/pages.yml`) runs `npm run demo:build -- site/demo` after
the site is built and checked. Only the landing page (`site/demo/index.html`) is committed; the editor and the blog
under it (about 2.6 MB) are built from the source of the same commit on each deploy, so the demo is always the
current editor and the repo holds no second copy of it.

## The recorded answers

`npm run demo:record` records them again, and should be run after a change to what a screen reads:

1. It copies `examples/blog` into `.wt-demo/` as a fresh git repository and starts a real Markstage server for it
   on 127.0.0.1 (port `DEMO_RECORD_PORT`, default 23433), with a made-up owner, *Jordan Example*, and a random
   password that is never printed or kept.
2. A browser signs in and opens every screen of `scripts/demo/record-plan.mjs` and, for each post, the editor,
   its SEO and Outline panels, the publish checks and the history. Every JSON answer to a read is kept.
3. The answers are cleaned before they are written: folders become `/srv/example-blog`, addresses become
   `https://cms.example.com`, and any key or token becomes `demo`. The script stops if a home folder is left.
4. They are written to `scripts/demo/recorded/api.json`, one answer per line in a fixed order, so a new recording
   is a readable diff. `scripts/demo/demo.test.mjs` checks the file holds no local paths, addresses or keys.

## The video

`npm run demo:video` builds the demo, serves it on 127.0.0.1 (port `DEMO_VIDEO_PORT`, default 23437) and records
the editor with Playwright: a post opens, a heading is edited, Save shows the diff. It writes
`site/media/demo.mp4` (and `demo.webm`, for a browser without H.264) and its poster `site/media/demo-poster.webp` for the site, and `docs/screenshots/demo.gif`
for the README. It needs ffmpeg (`FFMPEG`, or `ffmpeg` on the `PATH`).

## Tests

- `packages/editor/test/demo-diff.test.ts` and `demo-standin.test.ts`: the diff, and the stand-in with the real
  core writer and the recorded answers.
- `packages/server/e2e/demo.e2e.mjs`: builds the demo, serves it as static files, opens a post, types, saves,
  checks the diff is exactly that change, refreshes, resets, tries Publish, and fails on any console error.
