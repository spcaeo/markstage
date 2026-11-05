# The starter site

A small Astro blog with Markstage already set up, to start a new site from. It lives in `examples/starter/`; a
script copies it to a folder of your own, ready to write in. Markstage is pre-release: a minor version may still
change how things work.

## Start a new site

You need **Node.js 22.13 or newer** and **git**. Three commands:

```sh
git clone https://github.com/spcaeo/markstage.git
node markstage/scripts/create-site.mjs my-blog
cd my-blog && npm run dev
```

Open **http://127.0.0.1:18237/markstage/** and write. The blog itself is at http://127.0.0.1:18237/. This is
`astro dev` with the editor in it: no sign-in, on 127.0.0.1 only. Saves go to the Markdown and MDX files in
`src/content/`, so `git diff` shows exactly what changed.

`create-site.mjs` copies the starter, packs this clone's Markstage packages into the new site's `vendor/`, runs
`npm install` and makes the first git commit. `--no-install` and `--no-git` skip those two steps. From inside the
clone, `npm run create-site -- ../my-blog` does the same.

**Why a clone, and `vendor/`?** The `@markstage/*` packages are not on npm yet. Until they are, the new site takes
them from tarballs in its own `vendor/` folder (about 1 MB), so it installs on its own, on any machine and in the
Docker image, with no path back to the clone. Once the packages are on npm, the starter will install them from
there and `vendor/` goes away. There is no one-command `npm create` yet for the same reason.

To try the starter without making a site, run it inside the clone: `npm install`, then `npm run dev -w
examples/starter`.

## What is in it

| Path | What |
| --- | --- |
| `src/content/posts/*.md` | Posts, in Markdown: three live and one draft |
| `src/content/guides/*.mdx` | Guides, in MDX: one, using the `Callout` component ([MDX.md](MDX.md)) |
| `src/content.config.ts` | The two content collections and their fields (`draft`, `publishAt` for Markstage's status) |
| `markstage.config.mjs` | What Markstage edits: the two collections, their settings fields, the media folder, the editor's CSS and canvas, the dark theme and the "Edit this page" button ([CONFIG.md](CONFIG.md)) |
| `src/pages/` | The home page (posts and guides), a post page, a guide page and the 404 page |
| `src/layouts/Base.astro`, `src/styles/site.css` | The look: one column, light and dark, a system font for the frame and a serif for reading |
| `src/lib/live.ts` | Which entries are built: not drafts, and not scheduled for later (`MARKSTAGE_BUILD_TIME`) |
| `src/components/Callout.astro` | A boxed note for guides; in the editor, a card whose type and title change in the side panel |
| `public/uploads/` | Pictures added in the editor (made on the first upload) |
| `vendor/` | Markstage's packages, in a site made by `create-site.mjs` |
| `test/starter.test.mjs` | `npm test`: the site builds (the draft left out), and in `astro dev` the editor and its API answer |

One collection holds one format, so the `.md` posts and the `.mdx` guides are two collections.

`markstage.config.mjs` is a plain object with no `import`: a Markstage server reads it when it starts, before the
site's packages may be installed. The type comment at its top still gives an editor's autocomplete.

## Make it yours

- The name: `src/layouts/Base.astro` (`SITE`), `src/pages/index.astro` and `siteName` in `markstage.config.mjs`.
- The address: `site` in `astro.config.mjs` (canonical links).
- The look: `src/styles/site.css`. The editor draws pages with the same file, so what writers see is the page.
- The content: delete the sample posts and guide, or keep them as notes. A new collection is a folder, a
  collection in `src/content.config.ts` and one in `markstage.config.mjs`.

## For a team: the Markstage server

`npm run dev` is one person on one machine. For sign-in, roles, history, scheduled posts and **Publish** (commit,
build, deploy), run the server image next to the site ([DOCKER.md](DOCKER.md)):

```sh
docker run -d --name markstage -p 127.0.0.1:18231:18231 \
  -v "$PWD/my-blog:/srv/content" -v markstage-modules:/srv/content/node_modules \
  -v markstage-data:/srv/data -v markstage-site:/srv/site \
  ghcr.io/spcaeo/markstage:latest
docker exec markstage markstage-server setup-code
```

Then open http://127.0.0.1:18231/markstage/#/setup. On first start the image installs the site's packages, builds
its editor and writes a config whose build is `npm run build`. The image is published with each release since 0.4.0;
to run your own changes, build it from the clone (`docker build -f deploy/Dockerfile -t markstage-server .`).

**"Edit this page".** With `MARKSTAGE_CMS_URL` set when the site is built (the image sets it to its own address),
every page gets a small inline script that shows an "Edit this page" link to people signed in to that server
([API-EDIT.md](API-EDIT.md)). Without it the build has no script at all.

## Updating Markstage in a site

Pull the clone (or check out a release tag), then:

```sh
node markstage/scripts/create-site.mjs --update my-blog
```

It packs the clone's packages into `my-blog/vendor/` again (the old tarballs removed) and runs `npm install`.
Commit `vendor/`, `package.json` and `package-lock.json`. With the image, keep the site's packages at the image's
version and delete the `node_modules` volume so the next start installs them.

## How it is tested

- `npm test -w examples/starter` (CI, every push): the starter builds with its live posts and the MDX guide and
  without the draft; with an edit button every page gains exactly one inline script; and in `astro dev` the editor
  page answers at `/markstage/`, the API lists the four posts and the guide, and the MDX guide opens for editing.
- `npm run test:scripts` covers `create-site.mjs` (the copy, the tarballs, `--update`).
- CI's image job makes a real site with `create-site.mjs`, installed and committed, and runs the Docker image on it
  ([DOCKER.md](DOCKER.md), "How it is tested").
