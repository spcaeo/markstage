# Deploying Markstage

How to run the Markstage server next to a static site, with Docker or without it. All files referred to here are
in `deploy/` and were tested locally (see [What was proven](#what-was-proven)). Security detail is in
[SECURITY.md](SECURITY.md); the API in [API.md](API.md).

## The shape

```
writer ── https://cms.example.com/markstage/ ──► nginx ──► Markstage :18231 ──► git commit in the site repo
                                                                  │            build (site's command)
                                                                  │            markstage-deploy ─► /srv/site/releases/<id>
visitor ─ https://www.example.com/ ──► nginx: /srv/site/current/public                         /srv/site/current ─┘
                                            └─ not found there? auth_request to Markstage → /srv/site/current/private
```

- **Two host names.** The editor and API live on their own host (`cms.example.com`). Authors may write raw HTML into
  pages, and that HTML must never run on the origin that holds the CMS session. On the site host, `/markstage/` is
  proxied too, but Markstage answers only the protected-page gate there (the unlock form); the API and editor are 404.
- **Three folders, three owners.** Data dir (secrets, SQLite: Markstage only, mode 0700), the site's git working copy
  (Markstage commits and builds there), and `/srv/site` (releases; nginx only reads it).
- **Previews have a third host name** (`preview.example.com`, Markstage `preview.origin`, listener 18245). A
  preview runs the author's draft and the site's scripts, so it must not share the CMS origin. Markstage runs the
  site's dev server on a private clone in the data dir; see [API-PREVIEW.md](API-PREVIEW.md).
- **Publishing is a job:** commit → build → deploy. Any step failing reverts the commit and leaves the live release
  untouched (the writer's text is kept as their autosave).

## Ports

| Port  | What                                | Bound to                |
|-------|-------------------------------------|-------------------------|
| 18231 | Markstage server (editor + API)     | 127.0.0.1 (or the compose network) |
| 18235 | the site, in the compose setup      | 127.0.0.1               |
| 18245 | previews (`preview.origin`)          | 127.0.0.1               |
| 18251 | share links (`share.origin`): a release's or a draft's preview for people without an account | 127.0.0.1 |
| 18247–18299 (odd) | the site's dev server for previews, started on demand | 127.0.0.1 only, never proxied directly |

Production listens on 443 via nginx; nothing else is public.

## The deploy command: `markstage-deploy`

Shipped with the server package. Point `commands.deploy` at it; it runs in the site repo after the build.

```json
"commands": {
  "build": ["npx", "astro", "build"],
  "deploy": ["markstage-deploy", "--to", "/srv/site"],
  "timeoutSeconds": 900
}
```

- Copies `dist/` to `/srv/site/releases/<id>/public` and `dist-private/` (protected pages, from the site build) to
  `.../private`, writes `release.json` (git commit, time), then switches `/srv/site/current` with one `rename(2)`.
  Visitors see the old release or the new one, never a half-copied one.
- Makes each release readable by the web server (dirs 0755, files 0644): Markstage runs with umask 077 for its
  data dir and builds inherit it, so without this nginx (another user) would answer 403. `/srv/site` itself must be
  searchable by the web server user. The private folder is readable by local users too; on a shared host, put
  `/srv/site` in a group with the web server and drop the world bits.
- Refuses an empty or missing build (exit 1, nothing switched). Keeps the newest 5 releases (`--keep`).
- After the switch it can run one command (argv after `--`, no shell), e.g. reload nginx when the build emits
  nginx files (maps are read only at reload): `"deploy": ["markstage-deploy", "--to", "/srv/site", "--", "sudo",
  "-n", "/usr/sbin/nginx", "-s", "reload"]` with a sudoers rule for exactly that command. If it fails, `current` goes
  back to the release before and the deploy fails, so new pages never run with old server rules.
- `markstage-deploy rollback --to /srv/site` steps back one release (no rebuild). Options: `--from dist`,
  `--private dist-private`.
- Markstage's `protectedPages.dir` is `/srv/site/current/private`.

## Option 1: Docker compose (one server, or local)

`deploy/compose.yaml` runs two containers: `markstage` (this repo's image; Node 24 + git) and `site`
(`nginx:1.29-alpine` with `deploy/nginx/site.conf`). They share the `site-releases` volume.

1. Make a data dir and a config. Paths are the container's:

   ```json
   {
     "contentRoot": "/srv/content",
     "publicOrigin": "http://127.0.0.1:18231",
     "trustProxy": true,
     "commands": { "build": ["npx", "astro", "build"], "deploy": ["markstage-deploy", "--to", "/srv/site"] },
     "validate": ["node", "scripts/validate-entry.mjs"],
     "protectedPages": { "dir": "/srv/site/current/private", "hosts": ["127.0.0.1:18235"] },
     "preview": { "origin": "http://127.0.0.1:18245", "port": 18245 },
     "share": { "origin": "http://127.0.0.1:18251", "port": 18251 }
   }
   ```

   `mkdir -m 700 /abs/data && cp config.json /abs/data/ && chmod 600 /abs/data/config.json`

   `deploy/config.example.json` is a fuller starting point for a public server (https origins, the forms' hosts,
   the import and sign-in limits, mail): every secret is named by its environment variable, never written in it.

   The collections (folders, page URLs, groups) come from the site's own `markstage.config.mjs` (or `.js` / `.ts`)
   at the repo root. It is the same file the editor uses in `astro dev`, so there is one source. Restart Markstage
   after changing it. A site without one may list `collections` in config.json instead, e.g.
   `[{ "id": "posts", "dir": "src/content/blog", "format": "md", "hasStatus": true, "url": "/blog/{slug}/" }]`.
   Never use both: the server refuses to start.

2. Build and start:

   ```sh
   export SITE_REPO=/abs/path/to/site MARKSTAGE_DATA=/abs/data MARKSTAGE_UID=$(id -u) MARKSTAGE_GID=$(id -g)
   docker compose -f deploy/compose.yaml build
   # the site's build runs inside the container: install its dependencies there once (Linux binaries)
   docker compose -f deploy/compose.yaml run --rm -w /srv/content markstage npm ci
   docker compose -f deploy/compose.yaml up -d
   docker compose -f deploy/compose.yaml exec markstage markstage-server setup-code
   ```

3. Open `http://127.0.0.1:18231/markstage/#/setup`, enter the code, create the owner, turn on 2FA. Then
   **Publish site** once to make the first release; the site appears on `http://127.0.0.1:18235/`.

Notes:

- `MARKSTAGE_UID/GID` must own the site repo and the data dir (default 1000, the image's `node` user). The
  `site-releases` volume is created owned by 1000; with another uid, `chown` it once.
- `NODE_ENV` is `production` by default in `deploy/compose.yaml` (set `NODE_ENV=development` on purpose for a
  local play copy). On every public server set `NODE_ENV=production` (the plain-Node and systemd ways below too), an
  https `publicOrigin`, and put the nginx from Option 2 in front (the compose ports stay on 127.0.0.1). Dev mode
  (`devNoAuth`, no sign-in) refuses to start in production and with any `publicOrigin` that is not a loopback
  address, so a dev config copied to a server cannot open the editor to the internet.
- One server process is assumed: the sign-in, share-link and gate limiters count in process memory (see
  docs/SECURITY.md "Known limits"). Run one `markstage-server serve` per data dir; do not scale it to several
  processes behind one address.
- The site's own redirects/headers: add them to `deploy/nginx/site.conf` (it is mounted read-only).
- The editor itself: build it once with `markstage build-editor` and set `editorDir` (see
  [The editor in production](#the-editor-in-production)); until then `/markstage/` shows a placeholder page.

## The editor in production

In `astro dev` the editor is built on the fly. A Markstage server serves a built copy from `editorDir`:

```sh
# in the site's checkout, after npm install (it uses the site's own Vite, and its markstage.config)
node node_modules/@markstage/astro/bin/markstage.mjs build-editor --out /srv/markstage-editor
```

(`npx markstage build-editor …` is the same where npm linked the package's `markstage` command.)

- It writes `index.html`, `assets/` (the editor with the site's CSS, block packs, link and spelling modules, and its
  `pageData` run at build time) and `preview-agent.js`, plus `markstage-editor.json` (what was built, when). Set
  `"editorDir": "/srv/markstage-editor"` in config.json. About 2 s; the server needs no restart, the next page load
  gets the new build.
- Build again whenever the site's editor CSS, packs or `pageData` change (after pulling the site's code). The new
  build is written beside the old one and swapped in, so a running server never serves half a build. It refuses to
  replace a folder that is not an earlier build (no `markstage-editor.json`), so a wrong `--out` cannot wipe it.
- Put the folder outside the content repo (Markstage commits there) and outside the data dir. The site config's
  `basePath` (default `/markstage`) must be the server's.
- The block packs' Markdown side is code the server runs too: list each pack's `markdown` module in config.json
  `packs` (absolute paths), or articles with the site's own boxes cannot be saved.
- Fonts and images the canvas draws with keep their site paths (`url(/fonts/x.woff2)`, `/img/x.webp`,
  `../../assets/x.webp`). The server answers those on the CMS host: files under the repo's `public/` for anyone (the
  live site serves them anyway), other images in the repo for signed-in people only. Only image and font types,
  never from `.git`, `node_modules` or a dot-folder, never through a link out of the repo; an SVG gets a sandbox CSP.
- `editor.canvas.shell` (the canvas drawn inside the entry's real page) works in `astro dev` only for now. The built
  editor cannot read the page from the CMS host, so it draws the canvas as before, a sheet with the site's CSS
  (docs/CANVAS-FIDELITY.md "With the server").
- Pages are edited on the real page, which is the preview: set up the preview host (`preview.origin`, below). The
  site's dev server runs there on a private clone, with the field bindings (`data-ms-*`). `node_modules` is copied
  into the clone; packages the site links from outside its folder (`file:../markstage/...`) are linked again by
  their absolute path. Its own Markstage addresses (`/markstage/*` other than the preview's) answer 404 there, and
  the integration adds neither its editor page nor its dev API when `MARKSTAGE_PREVIEW=1`.

## Option 2: no Docker (systemd + nginx)

1. Node 22.13+ and git. A user `markstage` that may write the site repo, the data dir and `/srv/site`, nothing else.
2. `npm ci --omit=dev --workspace @markstage/server --workspace @markstage/core` in a checkout of this repo
   (sharp, optional, re-encodes uploads). The prebuilt sharp cannot read iPhone photos (HEIC needs libheif with an
   HEVC decoder, which it leaves out); such uploads get a plain `415` asking for a JPEG. To accept them, the simple
   way is libheif's converter: `apt install libheif-examples` (Debian/Ubuntu; `brew install libheif` on macOS) and
   `"media": {"heicCommand": ["heif-dec", "{in}", "{out}"]}` in `config.json` (older libheif: `heif-convert`; on
   macOS `["sips", "-s", "format", "jpeg", "{in}", "--out", "{out}"]` also works). The server writes the photo to a
   private temporary folder, runs the command (argv, no shell, 60 s), and re-encodes its JPEG like any upload.
   Or install sharp built against a system libvips that has HEIC (`npm install sharp --build-from-source` with
   `libvips-dev libheif-dev libde265-dev` on Debian), then check: `node -e "console.log(require('sharp').format.heif.input)"`.
3. `markstage-server init /srv/markstage-data`, edit `config.json` (`publicOrigin: "https://cms.example.com"`,
   `trustProxy: true`, `protectedPages.hosts: ["www.example.com"]`). Outside the image `markstage-deploy` is not
   on `PATH`: use `"deploy": ["node", "/opt/markstage/packages/server/bin/markstage-deploy.mjs", "--to", "/srv/site"]`.
4. A unit, e.g. `/etc/systemd/system/markstage.service`:

   ```ini
   [Unit]
   Description=Markstage
   After=network.target

   [Service]
   User=markstage
   Environment=NODE_ENV=production MARKSTAGE_DATA_DIR=/srv/markstage-data
   ExecStart=/usr/bin/node /opt/markstage/packages/server/bin/markstage-server.mjs serve
   Restart=on-failure
   UMask=0077
   NoNewPrivileges=true
   ProtectSystem=strict
   ReadWritePaths=/srv/markstage-data /srv/site /srv/content
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```

   (`ProtectSystem=strict` makes everything else read-only; add the npm cache dir to `ReadWritePaths` if the
   site's build needs one.)
5. nginx: `deploy/nginx/production.conf`. Set the two host names and certificates, then `nginx -t` and reload.
6. `sudo -u markstage MARKSTAGE_DATA_DIR=/srv/markstage-data markstage-server setup-code`, sign in at
   `https://cms.example.com/markstage/#/setup`, turn on 2FA.

### nginx, in short

`production.conf` has four parts:

- **preview host:** everything proxied to Markstage's preview listener (18245), with the websocket upgrade headers
  for HMR and a 120 s read timeout for the first, cold preview.
- **share host:** share links (docs/API-RELEASES.md), proxied to Markstage's share listener (18251), GET and HEAD
  only. A link's first address holds its token, so this host and the http redirect log with the `markstage_redacted`
  format (`/share/[link]` in the request line and the referrer), and this host keeps only critical errors. Set
  `"share": {"origin": "https://share.example.com"}`.
- **cms host:** everything proxied to Markstage with `Host` and `X-Forwarded-For`; `client_max_body_size 12m`
  for uploads.
- **site host:** files from `/srv/site/current/public` with `try_files $uri $uri/index.html @protected`. Not
  `$uri/`: a protected page's folder may still exist in the public build because of its public child pages, and
  `$uri/` would answer 403 there. `/_nginx/` (nginx files the build emits) answers 404.
- **protected pages:** `@protected` asks Markstage with `auth_request /markstage/page-auth` (`X-Original-URI`,
  cookie forwarded). On 204, nginx serves the file from `/srv/site/current/private` with `noindex` and
  `no-store`; on 401, `@gate` proxies to Markstage, which shows the password form or 404 (then the site's own
  404 page). `/markstage/page-auth` is `internal`.
- If Markstage is down, protected pages answer 500 (fail closed); public pages are unaffected.

## What the site must do (site contract)

From [API.md](API.md#site-side-contract-static-sites), checked by the rehearsal:

1. Build only live entries: `draft: true` and a future `publishAt` (compared with `MARKSTAGE_BUILD_TIME`) stay out.
2. Exit non-zero on failure (Astro does: an invalid entry fails the build, and Markstage reverts).
3. Emit `protected: true` pages to `dist-private/` instead of `dist/`, and leave them out of every derived output
   (sitemap, RSS, llms.txt, Markdown twins, search, link cards). Add `dist-private/` to `.gitignore`.
4. One broken entry fails every build (and the preview), including unrelated publishes. Give the server a
   `validate` command in `config.json`, e.g. `"validate": ["node", "scripts/validate-entry.mjs"]`: it reads the
   entry on stdin (`MARKSTAGE_COLLECTION`, `MARKSTAGE_FILE` in env), checks it against the site's schema and exits
   non-zero with `{"issues": [...]}`. Every write runs it first and is refused with 422 when it fails
   ([API.md](API.md#content-checks)). A build that still fails names the entry in the job error.
5. Sites with locales (`locales` in `markstage.config`) emit every locale copy of an entry from its one source
   file (`/x/` and `/en-us/x/`). Set `"verify": {"public": "dist", "private": "dist-private"}` in `config.json`,
   and every status job checks each copy in the build before deploying it. Add the site's hreflang check as
   `{"id": "hreflang", "command": ["node", "migration/verify/hreflang_check.mjs"], "after": "build"}` in `checks`.
6. What stops a publish: `"publishRules": {"altText": "block", "links": "block", "duplicates": "block",
   "headings": "warn"}` in `config.json` (these are the defaults; `off` skips a rule). See
   [API.md](API.md#before-publishing-the-publish-sheet).
7. Moving an entry records redirects through `redirects: {command: [...]}` in `markstage.config`. That command gets
   `{"redirects": [{"from": "/old/", "to": "/new/"}, …]}` (every locale) on stdin and writes them where the site
   keeps them. The site's build turns them into redirect pages or server rules.

8. Design & Code (`design` in `markstage.config`): the build puts the `inject.head` / `inject.foot` files and each
   live page's `codeInjection: {head, foot}` into that page's head and the end of its body, and allows them in the
   page's Content-Security-Policy: a `'sha256-…'` source in `script-src` for every inline `<script>` (and in
   `style-src` for every inline `<style>`), and the origin of every external `src`. The custom CSS file loads after
   every other stylesheet. `@markstage/core/csp` does the counting: `cspHashes(html)` returns
   `{script, style, scriptOrigins, styleOrigins, problems}` for the injected code (JSON-LD and other data blocks need
   nothing), and `withCspSources(policy, needs)` adds them to the page's policy (from `default-src` when it has no
   `script-src`; never next to a bare `'unsafe-inline'`, where a hash would switch it off). `problems` names what no
   hash allows (an `onclick=` attribute, a `style=` attribute, a `javascript:` link): show it to the owner and leave
   that code out. Proven in Chromium: the hashed script and style run, any other inline script is blocked. A post-build check in `checks` (`after: 'build'`) also runs after each design save, once
   for the site, with `MARKSTAGE_SCOPE=site`.

The publish sheet's link check reads the last build output (`verify.public`) to know which addresses exist besides
the entries, so set `verify` even on a single-locale site.

## Optional: a browser publish gate

`deploy/recipes/publish-gate.mjs` checks the fresh build in Chromium (Playwright) before the deploy, at 390 and
1440 px. These are errors and fail the job (the live site stays as it was):

- a page that scrolls sideways
- an image wider than the screen

Text under 12 px and tap targets under 24 px are logged as warnings. With `--baseline` set to the live release,
an error the live site already has is reported but does not block. A publish is stopped only by what it makes worse.

```json
"deploy": ["node", "scripts/publish-gate.mjs", "--baseline", "/srv/site/current/public",
           "--", "markstage-deploy", "--to", "/srv/site"]
```

Copy the file into the site repo, add `playwright` as a dev dependency and run `npx playwright install chromium`.
On the pilot site's 460 pages at both widths it adds about 15 s to a publish. Use `--pages /,/about/` to check fewer
pages. The editor's device preview is the writer's check while writing; this gate is the server's last check.

## Operations

- **Back up:** see [Backups](#backups) below. Releases can be rebuilt from the repo.
- **Update:** see [Updating Markstage](#updating-markstage) below. Migrations run at start.
- **Logs:** job logs are in the API (`/jobs/:id`, 1 MB cap per job); the audit log is at `/audit`. The process
  writes little to stdout.
- **Locked out:** an owner or administrator resets anyone below them from Users. The owner (there is exactly one) is
  reset only in a terminal: `markstage-server reset-password <email>` prints a setup code (72 h). So Users
  recommends a second administrator while only one person can manage users.
- **Stock photos (optional):** `"stock": {"provider": "unsplash", "keyFile": "/srv/markstage-data/stock.key"}` in
  `config.json` (or `pexels`), the key file `chmod 600`; or `MARKSTAGE_STOCK_KEY` in the environment. The server
  needs outbound https to the provider's API and image host only (`api.unsplash.com`, `images.unsplash.com`;
  `api.pexels.com`, `images.pexels.com`). Restart after changing it.
- **Imports from the web:** the Library's "From a web page" and the media import from addresses need outbound http
  and https (ports 80 and 443) to the public internet; nothing to set. The server refuses every private, loopback
  and link-local address itself (docs/SECURITY.md "Fetching from the web"); a firewall that allows only public
  egress is a second wall, not a replacement. Proxy variables (`HTTP_PROXY`) are not used. Without egress, those
  imports answer that the site could not be reached; packs, zips and folders still import.
- **CDN cache (optional):** `"purge": {"command": ["node", "/srv/markstage-data/purge-cdn.mjs"]}` in `config.json`.
  After every deploy it gets `{"urls": ["https://…/blog/x/", …]}` (or `{"all": true}`) on stdin and exits 0; the
  CDN token goes in `commands.env`, never in the site repo. A failure is a warning on the job, not a failed publish.
- **IndexNow (optional):** `"indexNow": {"keyFile": "/srv/markstage-data/indexnow.key"}` (or `key`), and the site
  serves the same key as `/<key>.txt` at its root. After each publish, unpublish, move or scheduled run the server
  tells `https://api.indexnow.org/indexnow` (Bing, Yandex and the others that share it; `endpoint` to change it) the
  changed addresses. Needs `siteUrl` in `markstage.config` and outbound https to that host.
- **Speed for real visitors (optional):** `"crux": {"keyFile": "/srv/markstage-data/crux.key"}` in `config.json`
  (or `MARKSTAGE_CRUX_KEY`): **the site's own** Google Cloud API key with the Chrome UX Report API enabled,
  restricted to that API. Site health then shows phone and desktop LCP, INP and CLS. Outbound https to
  `chromeuxreport.googleapis.com` only.
- **Alerts (optional):** see "Alerts" below: a failure also goes out by email, Slack and a webhook.
- **Bad release:** with `"commands": {…, "rollback": ["markstage-deploy", "rollback", "--to", "/srv/site"]}` an owner or
  administrator rolls back from Site health ("Roll back to the release before"; a job, audited, editors told).
  Without it: `markstage-deploy rollback --to /srv/site` in a terminal. Then fix and publish again.

## Alerts

A failed publish, deploy or backup, and a scheduled entry held back by the publish rules or gone out late (the server
was down at its time), are shown in the editor until seen (the bar under the header, and Publishing). With `notify`
in `config.json` each one also goes out once, by any of:

```json
"notify": {
  "email": { "host": "smtp.example.com", "port": 587, "from": "Markstage <cms@example.com>",
             "to": ["ops@example.com"], "roles": ["owner", "administrator"] },
  "slack": { "webhookFile": "/srv/markstage-secrets/slack-webhook.url" },
  "webhook": { "url": "https://hooks.example.com/markstage" }
}
```

- **Email** (SMTP): `security` is `"starttls"` (port 587, the default) or `"tls"` (port 465). Nothing is sent when the
  server does not offer STARTTLS: no password and no mail ever go out in plain text. `"none"` is only for a relay on
  the same machine in development. The account comes from the environment, `MARKSTAGE_SMTP_USER` and
  `MARKSTAGE_SMTP_PASSWORD`, or `user` plus `passwordFile` (a file outside the site repo, mode 0600); a `password`
  in `config.json` is refused. Mail goes to the `to` addresses and to every active user whose role is in `roles`
  (with no `to`, the owner and administrators). `caFile` trusts a relay with its own certificate authority.
  The mail says what happened (the entry and the error) with a link to the job in the editor. It is named for the
  site: the subject starts with the site's `siteName` (`Example Co: A publish … did not go live.`) and the mail is
  signed "Sent by the Example Co editor (Markstage)"; a site with no `siteName` gets `Markstage: …`.
- **Slack:** an incoming webhook, from `MARKSTAGE_SLACK_WEBHOOK` or `webhookFile` (the URL is a secret).
- **Webhook:** `{kind, level, text, url, at}` posted as JSON to `url` (https).
- **Who and how:** Settings → Alerts picks, per kind, the roles, people and extra addresses and the channels (the
  editor always shows it), and the sender name mail comes from ("Example Co Site"; the address stays `from`'s). Each
  person turns each kind on or off and picks mail now, a daily digest or the editor only (My alerts). Safety alerts
  (a failed backup, an invite, a role change, a sign-in from a new device) can't be turned off and always go by mail.
  `"digestHour": 8` in `notify` sets when the digest goes (server time). The rules are kept in the data dir
  (`alert-rules.json`), never in the repo.

Settings → Alerts shows each channel with how its last send went and has **Send a test** per channel; Site health
has **Send a test alert** through all of them. Each says what the channel answered. A channel that is down never stops the publish or backup that raised the alert; it is logged.

**Real sending waits for the owner's SMTP details** (host, port, account, sender and recipients). Until they are set,
alerts show in the editor (and Slack, when its webhook is set). It is proven against a local SMTP sink:
`packages/server/test/alerts.test.mjs` (a failed publish sends one mail over STARTTLS, signed in, with the entry, the
error and the job link; a relay without STARTTLS gets nothing; a named site's subject and signature) and the browser
test "alerts".

## Single sign-on

People can sign in with the company's OpenID Connect provider (Google Workspace, Microsoft Entra ID, Okta, Auth0,
Keycloak) as well as, or instead of, a password: docs/API-SSO.md.

1. At the provider, register a web client with the redirect URI
   `https://cms.example.com/markstage/api/auth/sso/<id>/callback` (the public origin, then the provider's `id`).
2. Put its client secret in the service's environment as `MARKSTAGE_SSO_<ID>_SECRET` (`MARKSTAGE_SSO_GOOGLE_SECRET`),
   or in a file outside the site repo (mode 0600) named by `clientSecretFile`. Never in config.json.
3. In config.json:

```json
"sso": {
  "providers": [
    { "id": "google", "label": "Google", "issuer": "https://accounts.google.com", "clientId": "1234.apps.googleusercontent.com",
      "domains": ["example.com"] }
  ]
}
```

4. Restart. A mistake stops the start and says which key. The sign-in screen then shows "Sign in with Google".

People are found by the email they were invited with (verified by the provider), so invite them first, or let
`autoCreate: {role: "author"}` give everyone at `domains` an account on their first sign-in. `"passwordLogin": false`
keeps passwords for the owner alone, for when the provider is down.

## Forms

A form on the site (a contact form) posts to Markstage on the site's own host: `POST /markstage/forms/<id>`. The
form itself is described in the site's markstage.config `forms` (docs/CONFIG.md "Forms"); the server needs:

- `"siteHosts": ["www.example.com", "example.com"]` in config.json: the site's host names (as the `Host` header
  arrives; with the port in development, e.g. `"127.0.0.1:18235"`). A form is only taken from a page on one of them
  (its `Origin`), and on those hosts the rest of Markstage answers 404. `protectedPages.hosts` count too.
- `"trustProxy": true` behind nginx, so the daily limit counts the visitor's address (the hop nginx appends), not
  nginx's. A posted address is never used.
- nginx passing `/markstage/` on the site host to Markstage with the `Host` header (`deploy/nginx/site.conf` does,
  with a 64 KB body limit).
- `notify.email` (see "Alerts") for the team mail and the thank-you mail to the visitor. Without it messages still
  land in the Inbox and the editor's notices. The thank-you mail's words can be changed (or turned off) in Settings →
  Forms; that is kept in the data dir (`forms-settings.json`).

Every message is stored in the data dir's database before anything is mailed, so a mail server that is down loses
nothing: the message is in the Inbox marked "alert not sent", the mail is tried again with backoff, and Site health
counts them. Messages are kept forever unless a form sets `keepDays`; they are in every backup (`markstage.db`). The
visitor's address and browser are kept 30 days (for the limit).

**Odoo** (optional). A form with `crm` (docs/CONFIG.md "Forms") also sends each message to Odoo as a lead. The
address and sign-in come from the server's environment, never from config.json or the repo:

| Variable | What |
|---|---|
| `ODOO_ENABLE` | `true` to send; anything else sends nothing |
| `ODOO_URL` | the Odoo address, https (e.g. `https://odoo.example.com`) |
| `ODOO_DB` | the Odoo database name |
| `ODOO_EMAIL` | the Odoo user that creates the leads |
| `ODOO_PASSWORD` | its password or API key |

(`crm.env` picks another prefix.) With systemd, put them in an `EnvironmentFile=` readable by root only (0600);
with Docker Compose, in an `env_file:` kept out of the repo. Site health says whether each form can send, and how
many messages did not go ("not sent to Odoo"); the Inbox has "Send to Odoo again". Outside production (an
environment's `production: false`) nothing is sent. Old WordPress messages are never sent again.

**Leads for analytics** (optional). A form with `leads` (docs/CONFIG.md "Forms") also sends each real message to
Skald as a lead. Its secret comes from the environment the same way: `SKALD_LEAD_SECRET` (the lead hook's secret
from Skald's Settings → Leads & integrations; `leads.env` picks another prefix). Without it nothing is sent and Site
health says so.

**The visitor's approximate place** (optional). With a city database on the server, each message gets a place from
the visitor's address ("Toronto, Ontario, Canada"), looked up here when it comes in: nothing is sent anywhere, and
nothing the browser says is used. Any MaxMind DB City file works; the default is DB-IP's free "IP to City Lite"
(no account or key; CC BY 4.0, so the Inbox shows its credit line), MaxMind's GeoLite2 City works the same. Put it
in place as a deploy step, and again each month to keep it current:

```sh
markstage-server geoip update https://download.db-ip.com/free/dbip-city-lite-2026-10.mmdb.gz
markstage-server geoip update /path/to/GeoLite2-City.mmdb
```

It is checked (a MaxMind DB with city records) before it replaces the one there, and lands in
`<dataDir>/geoip/city.mmdb` (`"geoip": {"file": "…"}` in config.json for another place, outside the site repo). The
running server picks it up within a minute. Without it, messages have no place. Site health shows which file is in
use (`forms.geoip`).

**Coming from WordPress.** Point the site's form at `/markstage/forms/<id>` (the same field names keep working when
`fields` names them), then bring the old messages over, read only and once or as often as you like (a second run
adds only rows it has not seen):

```sh
markstage-server forms import-wordpress /path/to/01-database.sql.gz --form contact --dry-run
markstage-server forms import-wordpress /path/to/01-database.sql.gz --form contact
```

It reads the `wp_contact` table (`--table` for another) from a mysqldump (`.sql` or `.sql.gz`), keeps the fields,
the page and referrer, the UTM source and medium, the service asked about, and the city, state and country as the
location; the old IP address is left behind. They arrive marked handled, under the form, with "imported from
WordPress" in their history; nobody is mailed. Run it as the server's user (it writes the data dir's database; the
server may keep running).

## Environments (staging next to production)

The design: docs/ENVIRONMENTS.md; the routes and the config keys: docs/API-ENV.md. On one server:

1. **One remote for all.** Both content repos are clones of the same remote (a private repo, or a bare repo on the
   server). Give each server a read-write deploy key of its own: production pushes `main` after each deploy, staging
   pushes `staging`. Git runs with `GIT_TERMINAL_PROMPT=0` and ssh in batch mode, so a missing key fails in words,
   never waits for a password.
2. **Two Markstage servers**, each with its own data dir, port and service: production as today, staging with
   `"environment": {"name": "staging", "branch": "staging", "upstream": "main", "promoteTo": "production",
   "peers": {"production": {"branch": "main", "origin": "https://cms.example.com"}}}`, and production with
   `"environment": {"name": "production", "branch": "main", "peers": {"staging": {"branch": "staging"}}}`.
   Check each with `markstage-server check`, then `markstage-server env status`.
3. **Staging is quiet.** Point staging's `notify.email` at a mail catcher on the box with `"mail": "sink"`, or keep
   real mail with `"mail": "actor"` (only the person who did something hears of it). Its forms answer "Test form:
   not sent". Purge, IndexNow, Slack and the webhook stay off unless `environment.keep` lists them.
4. **The staging site behind sign-in.** List `staging.example.com` in staging's `siteHosts`. Either proxy that host to
   Markstage (it serves `verify.public` to signed-in people), or let nginx serve the files and ask Markstage first:
   `auth_request /markstage/gate-auth;` with `error_page 401 = @gate;` and `location @gate { return 303
   https://staging-cms.example.com/markstage/gate?host=$host&to=$request_uri; }`, and proxy `/markstage/gate-enter`
   to Markstage. Add `add_header X-Robots-Tag "noindex, nofollow" always;`.
5. **Branch previews (optional)** need a wildcard DNS record and certificate for `*.staging.example.com`, proxied to
   the staging server, and `"previews": {"branches": true, "host": "{branch}.staging.example.com"}`.
6. **Screenshots** in a plan need Playwright on the server (`npm i -D playwright && npx playwright install
   chromium` in the Markstage folder); without it the plan says so and everything else works.
7. **The AI summary (optional):** `"ai": {"provider": "anthropic", "model": "claude-sonnet-5-5", "keyFile":
   "/etc/markstage/ai.key"}` (0600, owned by the service user, outside the repo). Only the facts and the list of
   changed files are sent, never a page's text. The AI suggestions in the editor (docs/API-AI.md) use the same key
   (this file, or `MARKSTAGE_AI_KEY` in the service's environment) and the same model.

## Updating Markstage

Your account (and the menu) shows the version that runs, e.g. `0.2.0 (3f9c2a1b7d4e)`; `markstage-server version` says
the same in a terminal. Releases are git tags `vX.Y.Z`.

**A git checkout (option 2):**

```sh
markstage-server update --check        # the newer releases and what changed in each (commits, CHANGELOG.md)
markstage-server update                # the newest; or --to v0.3.0
sudo systemctl restart markstage
markstage-server update --rollback     # back to the version before the last update
```

`update` refuses a checkout with local changes. It copies the database to `<data dir>/updates/` first (a consistent
copy while the server runs), switches the checkout, runs `npm ci --omit=dev` for the server and core, then
`markstage-server check` (the config and the new code load, nothing written). If any step fails it switches back
and reinstalls the old version: nothing changed. The running server is untouched until you restart it. The history
is `<data dir>/updates/history.json`.

`--rollback` switches back to the commit before the last update. Migrations only ever add tables and columns, so the
older version runs on the newer database. To also put the database back as it was before the update (losing what
was written since), stop the server first and add `--with-data`; the current database is copied aside before.

**Docker:** pull the new image tag, `docker compose up -d`; to go back, set the previous tag. Back up first
(`markstage-server backup`, below).

## Backups

What must survive a lost disk: the data dir (users, sessions, audit, autosaves, media records, protected-page hashes,
`config.json`) and the site repo (content, uploads, history). Markstage backs up both on a schedule:

```json
"backup": { "dir": "/mnt/backup/markstage", "everyHours": 24, "keep": 7,
            "command": ["rclone", "copy", "--"] }
```

- `dir` must be outside the site repo and the data dir, ideally another disk or a mounted share. Each backup is a
  folder `markstage-backup-YYYYMMDD-HHMMSS` (mode 0700) holding `markstage.db` (a consistent copy taken while the
  server runs), `site.bundle` (`git bundle --all`: every branch, the history and the committed uploads),
  `config.json`, and `manifest.json` (the commit and each file's size and sha256). The newest `keep` stay.
- `command` (optional, argv, no shell) runs after each backup with the folder as its last argument, to copy it off
  the machine (rclone, rsync, `aws s3 cp --recursive`). Its keys go in `commands.env` or its own config file, never
  in the site repo. If it fails, the backup job fails.
- Every `everyHours` (default 24). A server that was down past the time backs up about 30 s after it starts. After
  a failure it tries again an hour later, and the administrators get a notice (and the notify hooks).
- Site health shows the last backup, its size, "late" when it is more than two hours overdue, and **Back up now**.
  In a terminal: `markstage-server backup` (prints the log, exits 1 on failure).
- The folder holds password hashes, sessions, any keys in `config.json`, and each person's two-step (TOTP) secret
  as a plain value (an authenticator app needs the secret itself, so it cannot be stored as a hash). Whoever reads a
  backup can make that person's codes. Keep `dir` and wherever `command` copies to as private as the server itself,
  and protect them like a password store.

### Restore drill (do it once, before you need it)

On a spare machine or folder, never over the running server:

```sh
B=/mnt/backup/markstage/markstage-backup-20261028-090000
cd "$B" && sha256sum markstage.db site.bundle config.json   # compare with manifest.json
git clone "$B/site.bundle" /srv/site-restored                 # content, uploads, history
git -C /srv/site-restored log -1 --format=%H                  # = manifest.json "commit"
mkdir -m 700 /srv/markstage-data-restored
cp "$B/markstage.db" "$B/config.json" /srv/markstage-data-restored/
# point config.json at the restored repo ("contentRoot": "/srv/site-restored"), then:
MARKSTAGE_DATA_DIR=/srv/markstage-data-restored markstage-server serve
```

Sign in with an existing account: the users, roles, 2FA and media library are back. Sessions from before are still
valid until they expire; to sign everyone out, delete them first: `sqlite3 markstage.db "DELETE FROM sessions"`. The
proof that this works is `packages/server/test/backup.test.mjs`: the bundle clones to the manifest's commit, and a
server started from the restored folder signs an existing account in and shows the same entries and users.

## What was proven

All local (2026-10-28), on a scratch clone of the pilot site (231 pages), never the real repos or servers.

| Check | Result |
|---|---|
| Writer journey (setup, invite, edit + publish, failed build, schedule, unpublish, protect, unlock) | 10/10; publish 12.4 s (build 11.1 + deploy 0.8); failed build 2.1 s, live site byte-identical |
| Real nginx 1.29 with `site.conf` (auth_request) in front of Markstage, deploy via `markstage-deploy` | 14/14 checks; 30,561 requests during build + release switch, all 200 |
| Protected page through nginx | no cookie → form; wrong password 401; right → 303 + cookie → nginx serves the private file (noindex, no-store); tampered cookie → form; `/markstage/page-auth` and the API 404 from outside |
| `production.conf` | `nginx -t` passes (self-signed test certificate) |
| Server on Linux (node:24-slim, arm64, `--network none`) | starts, `setup-code`, API, editor placeholder, healthcheck |
| `compose.yaml` | `docker compose config` valid; missing paths give a clear error |
| `markstage-deploy` | unit tests: switch, private folder, refusal of an empty build, pruning, rollback |
| Publish gate | blocks a new overflow, passes known ones with `--baseline`, 460 pages × 2 widths in 15.5 s |
| Preview with real `astro dev` (Astro 7.4) on the clone | 11/11. Unsaved edit visible; cold start 3.6 s (15.5 s the very first time, copying `node_modules`), warm render 0.18 s, next autosave visible after 1.4 s, a draft renders, HMR websocket 101 through the proxy, content repo and live release untouched, dev server gone after shutdown |
| `production.conf` with the preview host | `nginx -t` passes |
| The built editor on a Markstage server, not `astro dev` (2026-10-29, scratch clone of the pilot site, Chromium) | `build-editor` 1.5 s. Sign in 1.7 s; a page on its real design from the preview origin (cold 14.6 s, warm 0.3 s, 101 bound fields); heading edited in place, saved in 0.9 s (commit in the repo); published in 154 s (commit, `astro build`, `markstage-deploy`) and the release served the new heading; Inbox, Site settings, Media opened; an article drew its 3 images and the site's fonts through the CMS host (all 200); a media upload listed and drawn |
| `production.conf` with the share host (2026-10-28) | `nginx -t` passes (nginx 1.29, a throwaway self-signed certificate) |
| `compose.yaml` with the share port 18251 (2026-10-28) | `docker compose config` valid |
| The redacted log format (2026-10-28) | nginx 1.29 ran a copy of `production.conf` (odd local ports, a stub share listener, a throwaway certificate). `GET /share/<token>` on the share host, with that link as the referrer, and the same on the http redirect: the access log says `"GET /share/[link] HTTP/2.0" 303 … "https://share.example.com/share/[link]"` and `"GET /share/[link] HTTP/1.1" 301`; the token is in neither the access log nor the error log. A page path is logged as it is |

Not run here, because each needs the network:

- `docker build`: it installs git from Debian and npm packages.
- The nginx container: `nginx:1.29-alpine` is not in the local image cache.

The Dockerfile's steps were exercised piecewise as listed above. The first `docker build` on a machine with
network access is the remaining check.
