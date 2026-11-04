# Page frames and page types

Two settings a page keeps in its own file, so the site's build reads them like any other value.

- **The frame** is how the site lays the page out around its content: **full width** (money and landing pages:
  sections edge to edge, no reading column or sidebar), **reading** (articles: one reading width, the menu and a
  list of contents) or **plain** (legal and thank-you pages: the text alone). The site's layout picks its shape
  from it.
- **The page type** is what the page is for: a money page, a migration landing page, a pillar (hub), an article, a
  comparison, contact, about, a list, a plain page. A type brings a frame, a Library page template to start from,
  locks that hold on every page of the type (the booking button of a money page can't be removed), and checks that
  say what such a page still needs (a FAQ, Service structured data, a link to its hub).

What an editor sees:

- **Post settings** (an article) and **the top of the sections list** (a page): a Page box with the page type, the
  frame ("As its type (Full width)" until the page picks its own) and what the type still needs: a tick, a warning
  or a cross per check, each with what to do, and **Check again**.
- **New** (`#/new/<collection>?type=<type>`): a card per type; a type picks its template.
- **Publish**: one row for the type's checks; a failed `block` check stops the publish like the other publish
  rules (an editor may publish anyway, audited).
- The padlocks: a block the type locks shows "Locked by the site", like the site's own rules.

Code: `packages/core/src/page-types.mjs` (pure: config, an entry's type and frame, the save check, the lock rules,
the checks), `packages/server/src/page-types.mjs` (the save check, the type's locks, `page-checks`, the preflight),
`packages/astro/src/api-pages.mjs` (the same in `astro dev`, and the build's check), `packages/astro/src/pages.mjs`
(`@markstage/astro/pages`, the site's helpers), and in the editor `src/page-types.ts` and
`src/settings/page-box.ts`.

## Turning it on

In `markstage.config.mjs` (docs/CONFIG.md, keys `frames` and `pageTypes`):

```js
export default defineConfig({
  // the three frames (full, reading, plain), kept in each entry's `frame` key
  frames: true,
  collections: [
    // a collection's frame is the default of its entries (without one: "reading")
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '{uri}', frame: 'full' },
    { id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/posts', url: '/blog/{id}/', frame: 'reading' },
  ],
  pageTypes: {
    key: 'pageType', // the entry key that names its type (default)
    types: [
      {
        id: 'money',
        label: 'Money page',
        description: 'Sells one service: a booking button, questions and answers, Service structured data.',
        collections: ['pages'],
        frame: 'full',
        template: 'lib_money-page', // a shared Library template (markstage/library/template/lib_money-page.json)
        locks: { pages: { booking: ['remove'] } },
        checks: [
          { id: 'booking', label: 'A booking button', section: 'booking', level: 'block' },
          { id: 'faq', label: 'Questions and answers', section: 'faq' },
          { id: 'service', label: 'Service structured data', jsonld: 'Service' },
        ],
      },
      { id: 'migration', label: 'Migration landing page', collections: ['pages'], frame: 'full', template: 'lib_migration-page',
        locks: { pages: { booking: ['remove'] } },
        checks: [{ label: 'A booking button', section: 'booking', level: 'block' }, { label: 'Questions and answers', section: 'faq' }] },
      { id: 'pillar', label: 'Pillar page', collections: ['pages'], frame: 'reading', checks: [{ label: 'A topic', field: 'cluster', level: 'block' }] },
      { id: 'comparison', label: 'Comparison', collections: ['posts'], frame: 'reading', checks: [{ label: 'A comparison table', section: 'table' }] },
      { id: 'article', label: 'Article', collections: ['posts'], frame: 'reading',
        checks: [
          { id: 'hub', label: 'Links to its hub', linksTo: { pageType: 'pillar', sameField: 'cluster' } },
          { id: 'money', label: 'Links to a money page', linksTo: { pageType: ['money', 'migration'] } },
        ] },
      { id: 'contact', label: 'Contact', collections: ['pages'], frame: 'plain', checks: [{ label: 'A contact form', section: 'contact' }] },
      { id: 'about', label: 'About and trust', collections: ['pages'], frame: 'full', checks: [{ label: 'Credentials', section: 'credentials' }] },
      { id: 'list', label: 'List', collections: ['pages'], frame: 'reading' },
      { id: 'plain', label: 'Plain page', collections: ['pages'], frame: 'plain' },
    ],
  },
});
```

The example blog (`examples/blog`) runs a smaller one: a guide (full width, from the `lib_guide-post` template it
ships, needs a topic), an article (reading, links to the guide of its topic) and a legal page (plain).

### `frames`

`true` gives the three frames above. `{key, list}` names other ones: `key` is the entry key that keeps the choice
(default `'frame'`), `list` is `[{id, label, hint}]` (`id` lowercase letters, digits and hyphens; `hint` is the
line under the choice). A collection's `frame` is its entries' default (it must be one of the list); a collection
without one gets `reading` (or the first frame when there is no `reading`). A collection may name a frame only when
`frames` is on.

### `pageTypes`

`{key?, types}` (a bare list is `types`). `key` is the entry key that names the type (default `'pageType'`; it must
differ from the frames' key). Each type:

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `id` | `^[a-z][a-z0-9-]{0,39}$` | required | Kept in the entry (`pageType: money`). |
| `label` | string | required | Its name in the editor. |
| `description` | string | `''` | Under its name in the Page box and on the New sheet. |
| `collections` | list of collection ids | every collection | Where it may be used. |
| `frame` | a frame id | none | The frame of its pages that pick none (needs `frames`). |
| `template` | `lib_…` | none | The shared Library page template a new page of the type starts from (docs/API-LIBRARY.md). A template not (yet) in the Library: the page starts blank. |
| `locks` | `{pages: {<section type>: [...]}, articles: {<box>: [...]}}` | none | Locks that hold on every page of the type, written like the site's `locks` (`'move'`, `'remove'`, `'edit'`). |
| `checks` | list | `[]` | What a page of the type needs (below). |

Each check is `{id?, label, level?, hint?}` with exactly one of:

| Kind | Passes when |
| --- | --- |
| `section: '<type>'` | The page has a section of that type (a JSON page: an item whose `discriminant`, or `type`, is it), or an article has a box of that block name. |
| `field: '<key>'` | The entry's key (dotted: `seo.description`) is filled: not empty, not `false`, not an empty list. |
| `jsonld: '<schema.org type>'` | The entry's own data has an object with that `@type`, or its last built page has it in an `application/ld+json` script (the server reads `verify.public`; before the first build only the data counts). |
| `linksTo: {pageType, sameField?}` | The entry links (in its text, its HTML or a link field) to a page of that type (or one of a list); with `sameField`, one whose value of that key is the same as this entry's (the hub of its own cluster). `linksTo: 'money'` is short for `{pageType: 'money'}`. |
| `links: 'pillar'\|'lead'\|'money'\|'anchors'\|'redirects'\|'outside'` | From the site's topics and link map (config `topics`, docs/API-LINKS.md): the page links in its text to its topic's main page (`pillar`), its group's lead (`lead`), its topic's service page (`money`); it has no vague link words and no words used for two pages (`anchors`); no link to a redirect, a hidden page or no page (`redirects`); every outside link has the rel its domain needs (`outside`). In `astro dev` it passes. |

`level` is `'warn'` (default: the Page box and the publish sheet show it) or `'block'` (it also stops a publish
until fixed; an editor may publish anyway, and the audit log keeps it). `id` defaults to `<kind>-<n>` (its place
in the list, from 1). `hint` replaces the words Markstage writes for what to do.

A mistake in either key stops the config from loading, with the key and the reason.

## The save check

Every save (the canvas, Source, a JSON page's changes, the API, bulk changes, imports, releases, MCP) is checked on
the server and in `astro dev`:

- A frame or page type the save **sets or changes** must be one of the site's (and the type one of its
  collection's): else `422 invalid-page`, `{fields: {<key>: message}}`, e.g. "“wide” is not a frame of this site.
  Pick one of: Full width, Reading, Plain." A value the file already had is left alone, so an old page still saves.
- An existing page's type changes for **owners, administrators and editors** only (`403`; dev mode is the owner).
  An author or contributor may set one on a new entry.
- A save is held to the locks of its type **before and after** it: dropping the type and the locked booking section
  in one save is refused (`423 locked`, docs/API.md "Locks").

## New entries

`POST collections/:c/entries` takes `pageType`: the entry's key is set to it, and without a `template` (or
`templateId`) the type's template is used when the Library has it. `422 invalid-page` for a type the collection
does not have. `astro dev` sets the key on a new post the same way (it has no Library).

## The checks

`GET collections/:c/entries/:id/page-checks` → `{type: {id, label} | null, frame: {id, label, hint, from} | null,
checks: [{id, label, level, ok, message?}]}`: the saved entry's type, its frame (`from`: `'page'`, `'type'` or
`'collection'`) and the type's checks (`message`, when not ok, says what to do). The same in `astro dev` (without
built pages: a JSON-LD check reads the data only). Anyone who can read the entry may ask.

The preflight (`GET collections/:c/entries/:id/preflight`, docs/API.md) gives the same as `page`, and each failed
check is a verdict `{rule: 'pageType', level, check, count: 1, message}` in `rules`: a `block` one sets `blocked`,
so publish, schedule and a release are refused (`422`) like for the other publish rules.

## The site's layout: `@markstage/astro/pages`

```astro
---
import { frameOf, pageTypeOf } from '@markstage/astro/pages';
const frame = await frameOf('posts', post.data);    // {id: 'reading', label, hint, from} or null
const type = await pageTypeOf('posts', post.data);   // {id, label, description, collections, frame} or null
---
<Layout frame={frame?.id ?? 'reading'}> … </Layout>
```

Also `frames()` and `pageTypes()` (the lists), and `pagesOf(config)` for a script or a test without the
integration. The example blog's `src/layouts/Base.astro` sets `class="frame-<id>"` on the body and its post page
lists the contents of a reading post and leaves the date and byline off a plain one.

## The build's check

`astro build` stops when an entry has a frame or page type the site does not have, naming each file:

```
markstage: an entry has a frame or page type the site does not have:
  src/content/posts/odd.md: “wide” is not a frame of this site. Pick one of: Full width, Reading, Plain.
```

`markstage({ checkPages: false })` lets it through.
