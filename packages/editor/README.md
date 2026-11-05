# @markstage/editor

The Markstage editor in the browser: TipTap 3 and vanilla TypeScript, drawing each entry on the site's own design.
You do not install it by hand: [@markstage/astro](https://www.npmjs.com/package/@markstage/astro) brings it, serves
it in `astro dev` and builds it for a Markstage server (`markstage build-editor`).

The package ships its TypeScript source. The site's own Vite (it comes with Astro) compiles it, together with the
site's CSS and block packs, so the editor draws with exactly the site's styles.

What a site may import from it:

- `@markstage/editor/pack`: the editor side of a block pack (a site's own boxes): TipTap, ProseMirror and the helpers
  the built-in blocks use ([docs/CONFIG.md](https://github.com/spcaeo/markstage/blob/main/docs/CONFIG.md)).
- `@markstage/editor/fidelity`: the canvas fidelity check for a site's tests, run with Playwright
  ([docs/CANVAS-FIDELITY.md](https://github.com/spcaeo/markstage/blob/main/docs/CANVAS-FIDELITY.md)).
- `@markstage/editor/styles/*`: the editor's stylesheets.

## Licence

Markstage is source-available under the Elastic License 2.0 (LICENSE), free to use and self-host, including for
your clients' sites. NOTICE has the details. Source, issues and docs: https://github.com/spcaeo/markstage
