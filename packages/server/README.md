# @markstage/server

The Markstage server: the editor for a team, next to your Astro site on your own server. It adds sign-in, roles,
history, the Library, releases, environments, forms and an audit log, and builds and deploys your static site when
someone presses **Publish**. Every save is a git commit in the site's repo.

It needs Node.js 22.13 or newer and git. The editor it serves is built from your site by
[@markstage/astro](https://www.npmjs.com/package/@markstage/astro) (`markstage build-editor`).

## Install

In the site's folder:

```sh
npm install @markstage/astro @markstage/server
npx markstage build-editor --out /srv/markstage-editor
npx markstage-server init /srv/markstage-data
```

Edit `/srv/markstage-data/config.json`: `contentRoot` (the site's git working copy), `editorDir`
(`/srv/markstage-editor`), `publicOrigin`, and the site's build and deploy commands. Then:

```sh
MARKSTAGE_DATA_DIR=/srv/markstage-data npx markstage-server setup-code
MARKSTAGE_DATA_DIR=/srv/markstage-data npx markstage-server serve
```

Open `<publicOrigin>/markstage/#/setup`, enter the one-time code and make the owner. There is no default password.

Commands: `markstage-server` (serve, setup-code, backup, check, version and more) and `markstage-deploy` (atomic
releases of the built site). Settings, HTTPS, nginx, systemd and backups:
[docs/DEPLOY.md](https://github.com/spcaeo/markstage/blob/main/docs/DEPLOY.md). With Docker instead:
[docs/DOCKER.md](https://github.com/spcaeo/markstage/blob/main/docs/DOCKER.md). The HTTP API:
[docs/API.md](https://github.com/spcaeo/markstage/blob/main/docs/API.md).

To update, install the new version of all the `@markstage/*` packages together, build the editor again and restart.

## Licence

Markstage is source-available under the Elastic License 2.0 (LICENSE), free to use and self-host, including for
your clients' sites. You may not offer it to others as a hosted or managed service without a commercial licence.
NOTICE has the details. Source, issues and docs: https://github.com/spcaeo/markstage
