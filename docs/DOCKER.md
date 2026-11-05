# Markstage with Docker

The Markstage server image runs the editor, sign-in and publishing next to your site, from one `docker run`. It
carries Node and git; your site stays a git folder on the host, mounted into the container. Markstage is
pre-release: try it on a copy of your site first.

- **Where it comes from.** `ghcr.io/spcaeo/markstage:<version>` and `:latest`, for amd64 and arm64, published by
  GitHub Actions when a release is tagged in the public repo (since 0.4.0; `.github/workflows/image.yml`). To run
  your own changes, build it from a clone: `docker build -f deploy/Dockerfile -t markstage-server .`, and use
  `markstage-server` wherever this page says `ghcr.io/spcaeo/markstage:latest`.
- **What it needs from the site.** A git working copy of an Astro site with Markstage set up: the
  [starter](STARTER.md), or your own site ([CONFIG.md](CONFIG.md)). Since the `@markstage/*` packages are not on
  npm yet, the site carries them in `vendor/` (the starter does that for you).
- The full deploy guide (nginx, https, previews, backups, alerts) is [DEPLOY.md](DEPLOY.md); this page is the image.

## Try it: one command

From the folder that holds your site (`my-blog` here):

```sh
docker run -d --name markstage \
  -p 127.0.0.1:18231:18231 \
  -v "$PWD/my-blog:/srv/content" \
  -v markstage-modules:/srv/content/node_modules \
  -v markstage-data:/srv/data \
  -v markstage-site:/srv/site \
  ghcr.io/spcaeo/markstage:latest
```

The first start takes a minute or two (`docker logs -f markstage` shows it): the image installs the site's packages
and builds the site's editor. When `docker ps` says `healthy`, make the owner:

```sh
docker exec markstage markstage-server setup-code
```

Open **http://127.0.0.1:18231/markstage/#/setup**, enter the code, create the owner and turn on two-step sign-in.
There is no default password. Press **Publish site** once: the site is built inside the container and the release
lands in the `markstage-site` volume (`/srv/site/current/public`). The compose file below serves it.

Stop and remove it with `docker rm -f markstage`; `docker volume rm markstage-modules markstage-data markstage-site`
removes its data too (the data volume holds the accounts).

## What happens at start

The image's entrypoint (`deploy/docker/start.mjs`) does four things, in order:

1. **A config on the first start.** With no `config.json` in `/srv/data`, it writes one: the site at
   `/srv/content`, its build `npm run build`, deploys with `markstage-deploy` to `/srv/site` (keeping the last 5
   releases, so **Roll back** works), `verify.public: "dist"`, and `MARKSTAGE_CMS_URL` for the build (the starter's
   "Edit this page" button points at this server). It is written once and never again: change it freely
   ([DEPLOY.md](DEPLOY.md) explains every key).
2. **The site's packages.** When `/srv/content/node_modules` has no finished install, `npm ci` (or `npm install`
   without a lockfile) runs in the site. The site's tools (Astro, esbuild) are built per system, so a `node_modules`
   made on a Mac cannot run in the Linux container: that is why the command mounts a volume over it. The volume
   keeps the install between starts; delete it to install again.
3. **The site's editor.** `markstage build-editor` builds the editor with the site's CSS and config into
   `/srv/editor/app` (about 2 s), at every start, so it always matches the site's code; the server is told with
   `MARKSTAGE_EDITOR_DIR`. Restart the container after you change the site's `markstage.config.mjs` or its CSS.
4. **The server**, `markstage-server serve`, as the image's `node` user (uid 1000), with `tini` as PID 1.

`MARKSTAGE_SITE_SETUP=off` skips steps 2 and 3, for an operator who installs and builds the editor themselves.
A failed install stops the container with the npm error in the log; a failed editor build is logged and the
server starts with its placeholder page.

Other commands: a server command runs that command (`docker run --rm … ghcr.io/spcaeo/markstage:latest check`,
`… backup`, `… reset-password <email>`), `prepare` runs steps 1 to 3 and stops, and anything else runs as it is
(`… npm ci`, `… sh`).

## Folders

| In the container | What | Mount |
| --- | --- | --- |
| `/srv/content` | the site's git working copy: Markstage commits here and runs the build here | a bind mount of your site folder |
| `/srv/content/node_modules` | the site's packages, installed for Linux | a named volume |
| `/srv/data` | `config.json`, the SQLite database (accounts, sessions, audit), job logs: mode 0700, **back it up** | a named volume or a host folder |
| `/srv/site` | releases: `current` is the live one, read by the web server | a named volume shared with nginx |
| `/srv/editor` | the site's editor, rebuilt at every start | none needed |

The container user (uid 1000) must be able to write the site folder. On Linux, if your user is not uid 1000, run
the container as you (`--user "$(id -u):$(id -g)"`, or `MARKSTAGE_UID`/`MARKSTAGE_GID` with compose) and give the
volumes to that user once: `docker run --rm -u root -v markstage-modules:/m -v markstage-data:/d -v markstage-site:/s
ghcr.io/spcaeo/markstage:latest chown -R "$(id -u):$(id -g)" /m /d /s`. As another user, npm's cache and the editor
build go to a temporary folder in the container.

## Settings from the environment

| Variable | What | Default |
| --- | --- | --- |
| `MARKSTAGE_PUBLIC_ORIGIN` | the address people open, e.g. `https://cms.example.com`; it must match the address in the browser | `http://127.0.0.1:18231` |
| `NODE_ENV` | `production` on every server people reach over a network: an https `MARKSTAGE_PUBLIC_ORIGIN` is then required | unset |
| `MARKSTAGE_PORT` | the port inside the container | `18231` |
| `MARKSTAGE_TIME_ZONE` | the zone of the release line in the footer (docs/RELEASES.md), e.g. `America/Toronto` | the container's (UTC) |
| `MARKSTAGE_SITE_SETUP` | `off`: no install and no editor build at start | on |
| `MARKSTAGE_DATA_DIR`, `MARKSTAGE_CONTENT_ROOT`, `MARKSTAGE_HOST`, `MARKSTAGE_EDITOR_DIR` | set by the image; change them only with the mounts | `/srv/data`, `/srv/content`, `0.0.0.0`, the built editor |

Everything else is in `/srv/data/config.json` ([DEPLOY.md](DEPLOY.md), [CONFIG.md](CONFIG.md)).

**Secrets never go in the image, the site repo or config.json.** Each one comes from an environment variable or
from a file, as `deploy/config.example.json` lists under `$secrets`: `MARKSTAGE_SMTP_USER` and
`MARKSTAGE_SMTP_PASSWORD` (or `notify.email.passwordFile`), `MARKSTAGE_SLACK_WEBHOOK` (or `notify.slack.webhookFile`),
`MARKSTAGE_AI_KEY` (or `ai.keyFile`), `MARKSTAGE_SSO_<ID>_SECRET` (or the provider's `clientSecretFile`), and the
others there. With compose, prefer files: a `secrets:` entry is mounted read-only at `/run/secrets/<name>`, and
config.json names that path (`"passwordFile": "/run/secrets/smtp-password"`). Environment variables go in an
`env_file:` kept out of the repo, never on the command line.

## With the site and nginx: compose

`deploy/compose.yaml` runs the image with nginx serving the releases (and protected pages and forms through
Markstage), every port on 127.0.0.1. It builds the image from the clone by default; to use the published one,
set `MARKSTAGE_IMAGE`:

```sh
export SITE_REPO=/abs/path/to/my-blog MARKSTAGE_DATA=/abs/path/to/markstage-data
export MARKSTAGE_UID=$(id -u) MARKSTAGE_GID=$(id -g)
export NODE_ENV=development   # a copy on this machine (http on 127.0.0.1); leave it out on a server, see below
mkdir -m 700 -p "$MARKSTAGE_DATA"
MARKSTAGE_IMAGE=ghcr.io/spcaeo/markstage:latest docker compose -f deploy/compose.yaml up -d --no-build
docker compose -f deploy/compose.yaml exec markstage markstage-server setup-code
```

Then **http://127.0.0.1:18231/markstage/#/setup** for the editor and, after the first **Publish site**,
**http://127.0.0.1:18235/** for the site. In short, the file is:

```yaml
services:
  markstage:
    image: ${MARKSTAGE_IMAGE:-markstage-server:local}
    restart: unless-stopped
    user: "${MARKSTAGE_UID:-1000}:${MARKSTAGE_GID:-1000}"
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      MARKSTAGE_PUBLIC_ORIGIN: ${MARKSTAGE_PUBLIC_ORIGIN:-}   # empty: config.json's publicOrigin (http://127.0.0.1:18231 by default)
    volumes:
      - ${MARKSTAGE_DATA}:/srv/data
      - ${SITE_REPO}:/srv/content
      - site-modules:/srv/content/node_modules
      - site-releases:/srv/site
    ports: ["127.0.0.1:18231:18231", "127.0.0.1:18245:18245", "127.0.0.1:18251:18251"]
  site:
    image: nginx:1.29-alpine
    volumes:
      - site-releases:/srv/site:ro
      - ./nginx/site.conf:/etc/nginx/conf.d/default.conf:ro
    ports: ["127.0.0.1:18235:80"]
volumes:
  site-modules:
  site-releases:
```

`NODE_ENV` is `production` in the file unless you set it: then an https `MARKSTAGE_PUBLIC_ORIGIN` is required (even
on 127.0.0.1), which is why the commands above set `development` for a copy on this machine. For a public server, put nginx with TLS in front ([DEPLOY.md](DEPLOY.md), Option 2, "nginx, in short") and
set `MARKSTAGE_PUBLIC_ORIGIN=https://cms.example.com`. A config written before you set the origin keeps the old
`MARKSTAGE_CMS_URL` in `commands.env`: change it there too.

## Updating

Pull the new tag and start again: `docker pull ghcr.io/spcaeo/markstage:0.4.1`, then `docker rm -f markstage` and
the same `docker run` with the new tag (with compose, `MARKSTAGE_IMAGE=…:0.4.1 docker compose up -d`). Back up
`/srv/data` first (`docker exec markstage markstage-server backup` with `backup` set in config.json, or a copy of
the volume while the container is stopped). Migrations run at start and only add tables and columns, so the
previous tag still runs on the newer database.

Keep the site's Markstage packages at the image's version: in a clone at that tag,
`node scripts/create-site.mjs --update /path/to/my-blog`, then commit `vendor/`, `package.json` and
`package-lock.json`, and delete the `node_modules` volume so the next start installs them.

## What the image is

- Two stages: the server's runtime packages are installed with `npm ci --omit=dev` from the lockfile in the first;
  the image copies only them, `packages/core`, the server's `bin` and `src`, and the entrypoint. `node:24-slim`
  with git, ssh (pushes to a shared remote, docs/ENVIRONMENTS.md), CA certificates and tini.
- Runs as `node` (uid 1000), never root. A health check asks the server for `/markstage/` every 30 s (any answer
  counts, even a 421 for a host name it does not serve), with five minutes for the first start.
- The release line (docs/RELEASES.md): the build passes `MARKSTAGE_COMMIT`, `MARKSTAGE_BUILD` and
  `MARKSTAGE_BUILT_AT`, since an image has no `.git`. The published image is labelled with its version and commit,
  and carries an SBOM and build provenance: `docker buildx imagetools inspect ghcr.io/spcaeo/markstage:latest
  --format '{{json .SBOM}}'`.

## How it is tested

- **Every push and pull request** (`.github/workflows/ci.yml`, job "Server image"): the image is built for amd64,
  then `scripts/docker/smoke.mjs` makes a new site from the starter, starts the image on it as above, waits for
  `healthy`, and checks that `/markstage/` is the site's built editor (not the placeholder), that a new server asks
  for setup, that `/markstage/api/release` answers, that `markstage-server setup-code` gives a code that makes the
  owner, that the signed-in API lists the starter's posts and its MDX guide, and that **Publish site** builds and
  deploys the site inside the container. Then it removes the container and its volumes.
- **A release tag** (`.github/workflows/image.yml`, only in spcaeo/markstage): the same smoke test, then the
  amd64 and arm64 build is pushed. Nothing is pushed when the tag and `package.json` disagree.
- Run the smoke test yourself: `docker build -f deploy/Dockerfile -t markstage-server:local .` then
  `node scripts/docker/smoke.mjs --image markstage-server:local` (it labels what it makes `markstage-docker-starter=1`
  and removes it; `--keep` leaves it running, `--port` picks the host port, 37433 by default).

## Limits

- One server process per data dir (docs/SECURITY.md, "Known limits"): do not run two containers on one volume.
- The built editor draws an article as a sheet with the site's CSS; drawing it inside the real page works in
  `astro dev` only for now (docs/CANVAS-FIDELITY.md).
- Previews (the real page with unsaved changes) and share links need their own host names and `preview` and
  `share` in config.json (DEPLOY.md); they are off in the config the image writes.
