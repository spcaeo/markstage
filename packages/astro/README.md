# @markstage/astro

Markstage for Astro: an editor for your writers that types on the site's real pages and saves to the Markdown and
MDX files in your repo, as small git diffs. This package is the Astro integration:

- in `astro dev`, the editor at `/markstage/` (no sign-in, on 127.0.0.1 only), saving straight to your files;
- `markstage build-editor`, the same editor built for a [Markstage server](https://www.npmjs.com/package/@markstage/server)
  (sign-in, roles, history, publish);
- the site config loader (`defineConfig`) and the helpers a site's pages may use (`/bind`, `/authors`, `/pages`,
  `/topics`).

It needs Node.js 22.13 or newer and Astro 7.4 or newer.

## Install

```sh
npm install @markstage/astro
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import markstage from '@markstage/astro';

export default defineConfig({
  integrations: [markstage()],
});
```

```js
// markstage.config.mjs, at the project root
import { defineConfig } from '@markstage/astro';

export default defineConfig({
  siteName: 'My blog',
  collections: [{ id: 'posts', format: 'md', dir: 'src/content/blog', url: '/blog/{id}/' }],
});
```

Run `npx astro dev` and open `/markstage/` on your dev server. Every key of the config:
[docs/CONFIG.md](https://github.com/spcaeo/markstage/blob/main/docs/CONFIG.md).

For a team, add the server (`npm install @markstage/server`) and build the editor for it:

```sh
npx markstage build-editor --out /srv/markstage-editor
```

[docs/DEPLOY.md](https://github.com/spcaeo/markstage/blob/main/docs/DEPLOY.md) has the rest; a new site with all of
this set up: [docs/STARTER.md](https://github.com/spcaeo/markstage/blob/main/docs/STARTER.md).

## The Markstage packages

| Package | What |
| --- | --- |
| `@markstage/astro` | This one: the Astro integration and `markstage build-editor` |
| `@markstage/server` | The server for a team: sign-in, roles, history, publish (`markstage-server`) |
| `@markstage/editor` | The editor in the browser (installed with this package) |
| `@markstage/core` | Markdown and MDX in and out, surgical saves (installed with this package) |

All four carry the same version; install them at the same one.

## Licence

Markstage is source-available under the Elastic License 2.0 (LICENSE), free to use and self-host, including for
your clients' sites. NOTICE has the details. Source, issues and docs: https://github.com/spcaeo/markstage
