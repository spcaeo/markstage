# Markstage API: the section gallery, and "Edit this page" on the live site

Paths are under `<basePath>/api/`, signed in, like docs/API.md. The gallery runs on the preview
(docs/API-PREVIEW.md); the edit link needs `editButton` in markstage.config (docs/CONFIG.md).

## Section gallery (the preview)

Every section type and variation a JSON collection's pages use, or its schema declares, drawn alone by the site's own
components. The editor's `#/gallery/<collection>` frames each sample on the preview origin at 1440 and 390 px, light or
dark. Source: `packages/server/src/preview/gallery.mjs`, `packages/editor/src/gallery/`.

| Route (API, signed in, any role) | Answer |
|---|---|
| `GET preview/gallery` | `{collections: [{id, label}]}`: the JSON collections whose entries (or schema) have page sections. `409 no-preview` without `preview.origin` |
| `GET preview/gallery/:c` | `{collection, samples: [{key, kind, variant, from, path, url}], problems: [{kind, variant, message}]}`. `404` for a collection without sections |

- **Which samples.** The section list is the collection's `gallery.field` (default `sections`); a section is stored as
  `{discriminant, value}` (or the schema's own storage keys) or flat `{kind, …}`. The variation is the value at
  `gallery.variant` inside it (none: one sample per type). Each type and variation's sample is its **first real use**
  in the content (`from: {id, title, url, index}`, the page and the section's place). A type the schema declares
  that no page uses, and a variation the schema lists as a `select` option, gets **placeholder words** (`from: null`).
  The order is the schema's (else the order the pages first use them), the plain variation first.
- **How it is drawn.** Each sample is a throwaway page: a copy of the page it comes from (or the first page with an
  address) holding only that section, at `/markstage-gallery-<n>/` (set through the collection's address field, or
  its `{id}`). `key` is a stable opaque id for the URL (`s=`, `whole=`). The pages are written into the **preview's
  private clone only**, with every state the clone shows from then on; they are never in the content repo, never
  committed, never in a build or a sitemap. An address that is taken, or a collection that gives a new page none,
  is listed in `problems`.
- **The clone never pushes.** Its `remote.origin.pushurl` is a path that cannot exist
  (`<clone>/.git/markstage-preview-never-pushes`), set whenever the clone is made or used; even a `git push` run in it
  by hand fails.
- **Alone in the frame.** The preview agent takes `{markstage: 'gallery', alone}`: with `alone` it hides every
  element beside the first `[data-ms-section]` and beside each of its parents (scripts and styles stay), then answers
  `{markstage: 'gallery:shown', found, height}`; the editor sizes the frame to `height`. Every picture in what is
  shown loads first, lazy ones made eager (a lazy picture below the frame's first screen would never load in a scaled
  frame): the answer waits for them, up to 8 s, and comes again when a later picture changes the height. Without a marker, or with
  "Whole page" (`whole=<key>`), the whole page shows at the screen's height (900 at 1440, 844 at 390). Dark is the
  site's own switch (`themes.dark`, the `theme` message).
- **A request the browser drops while it waits for the clone** (a page of many frames, left before they loaded)
  ends there: it no longer holds the clone's lock (it used to wait for a `close` that had already fired).

## Edit this page (the live site)

An "Edit this page" link on the built site, for people signed in to Markstage only. Opt-in with `editButton` in
markstage.config (docs/CONFIG.md). Source: `packages/core/src/edit-button.mjs` (the script),
`packages/server/src/edit-link.mjs` (the cookie, the address lookup), `packages/editor/src/edit-link/` (`#/edit`).

- **The page.** The build adds one inline script to the `<head>` of every page, the same text everywhere (a site with
  a hash-based CSP allows it with one hash). The pilot site measures 795 bytes raw per page (about 440 gzipped). A visitor has no cookie: the script runs one regular expression on
  `document.cookie` and stops; no request, nothing drawn. The page holds no CMS address, only the first 8 bytes of
  the SHA-256 of the edit address. With the cookie, the script hashes its value and draws the link only when the
  hash matches, so a cookie planted by a sibling host with another address draws nothing. The link is a fixed pill
  in a corner (`editButton.corner`), labelled "Edit this page in the editor", reached by Tab after the page's own
  links. It sits at `z-index: 40`: above the page's content, under the site's own menus, dialogs and bars (which
  sit higher), so an open menu covers it rather than the other way round. It needs `crypto.subtle`, so **https** (or loopback): on plain http it does nothing and logs nothing.
- **The cookie.** `_ed=<encoded edit address>`: `Path=/`, `SameSite=Lax`, `Max-Age` the rest of the session, `Secure`
  on https, **not** HttpOnly (the page must read it). It names where the editor is and nothing else; the CMS checks
  the session on every request anyway. Its `Domain` is the CMS's own host when the site has the same one (ports do
  not count), else the parent both share (`cms.example.com` and `www.example.com`: `Domain=example.com`). A site on
  another domain cannot read it: then the bookmarklet.

| Route | Answer |
|---|---|
| `GET site/edit-button` (API, signed in, any role) | Sets or refreshes the cookie: `{on: true, domain, bookmarklet}`. Or `{on: false, reason, message, bookmarklet}` and no cookie: `off` (no `editButton`), `other-cms` (the build expects the editor at another address: set `editButton.cms` to this server's `publicOrigin`), `other-domain` (the site and the CMS share no host name). The editor calls it when it starts |
| `GET site/entry-at?path=/about-us/` (API, signed in) | `{collection, id, title, url, locale, can}`: the entry whose address (in any locale) is that path; a missing trailing slash, `index.html`, a query or a hash are ignored. `404` "No entry has this address.", `400` for a path that is not one |
| sign-out (`POST auth/logout`) | also clears the cookie |

- **The link** goes to `<cms>/markstage/#/edit?to=<path>`. Signed in, the editor finds the entry and opens it (in the
  locale whose address it was), replacing `#/edit` in the history. Signed out, it signs in first, then opens it. A
  role that cannot change the entry sees "Not available to you"; an address no entry has says so.
- **The bookmarklet** (`#/edit`, also "Edit button on your site" in the account menu) does the same from any site,
  wherever the editor runs: `javascript:location.href="<cms>/markstage/#/edit?to="+encodeURIComponent(location.pathname)`.
