# markstage.config: every key

> **Not on npm yet: install from a clone.** The `@markstage/*` packages are not published to npm. Clone this
> repository next to your site and link them, as the README's [quick start](../README.md#quick-start) shows
> (Option 2). Your site needs Astro 7.4 or newer.
> To see the editor first with nothing to install, try the [live demo](https://spcaeo.github.io/markstage/demo/).

A site tells Markstage what it edits, and how to draw it, in one file at the project root:
`markstage.config.mjs`, `.js` or `.ts` (the first found, in that order). Both sides read it with the same loader,
`@markstage/core/site-config`:

- `astro dev`, through the `@markstage/astro` integration;
- the Markstage server.

Restart either one after changing the file. Mistakes stop the start with `markstage.config: <what is wrong>`.

The server's own settings (sign-in, git, publish commands, preview origin) are in its `config.json`, not here. See
docs/DEPLOY.md; the preview's keys (`preview.origin`, `preview.warm`: the site's dev server started with Markstage
and kept warm, `preview.idleMinutes`, …) are in docs/API-PREVIEW.md.

```js
import { defineConfig } from '@markstage/astro'; // or '@markstage/core/site-config'; it only adds editor hints

export default defineConfig({
  siteName: 'My blog',
  collections: [{ id: 'posts', format: 'md', dir: 'src/content/blog', url: '/blog/{id}/' }],
});
```

Paths to modules and CSS that start with `.` are relative to the project root. Anything else is a package name or
a site path.

## Top level

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `siteName` | string | `'Site'` | The name in the editor's title and header. Alert mail is named for it too (subject `<siteName>: …`, signed "the <siteName> editor (Markstage)"); a site that sets none gets mail from "Markstage", never "Site". |
| `siteUrl` | URL | astro.config `site` in dev, else none | The live address. It is used for the hreflang links and addresses shown in Post settings, and for copied full URLs. Set it here so the server, which has no astro.config, has it too. |
| `collections` | list | `[]` | What the editor edits. See [Collections](#collections). |
| `compat` | `{collection}` | none | The collection that the older `/studio-api/` routes serve (docs/API.md, "Compatibility"). |
| `media` | `{dir}` | `src/assets/uploads` | Where uploads go, relative to the project. Frontmatter image paths are relative to it. A folder under `public/` (the example blog's `public/uploads`) is served from the site root, so its files are used as they are. |
| `authors` | `true` or `{dir, url, coAuthors, organization, collections, fields}` | none | The site's authors as JSON files in its content (`src/content/authors/<slug>.json`), each with an author page (`/author/{slug}/`): the Authors screen, the author picker in Post settings, the save and build checks and `@markstage/astro/authors` (docs/API-AUTHORS.md). `coAuthors` names the frontmatter list of co-authors; `fields` maps the profile to the file's own keys (`null` leaves one out). |
| `frames` | `true` or `{key, list: [{id, label, hint}]}` | none | How the site lays a page out around its content, kept in each entry (`frame`): `true` gives **full width** (money and landing pages), **reading** (articles: the menu and a list of contents) and **plain** (legal and thank-you pages). A collection's `frame` is its entries' default. The Page box in Post settings and above a page's sections, the save and build checks, and `@markstage/astro/pages` for the site's layout (docs/API-PAGE-TYPES.md). |
| `pageTypes` | `{key?, types: [{id, label, description?, collections?, frame?, template?, locks?, checks?}]}` | none | What a page is for (a money page, an article, a pillar…), kept in each entry (`pageType`): each type brings a frame, a shared Library page template to start from, locks that hold on its pages and checks that say what such a page still needs (`section`, `field`, `jsonld`, `linksTo`; `level: 'warn'` or `'block'`, which stops a publish). docs/API-PAGE-TYPES.md has the shape and a full example. |
| `topics` | `true` or `{dir, collections, money, follow, sponsored, generic, keywords, robots, enough, related}` | none | The site's subjects as JSON files (`markstage/topics/<id>.json`), each with a main page, groups with a lead page, and pages: the Topic map, the topic part of Page settings, the link map of every page's text, link suggestions both ways (Accept links the words on the other page), Health, the page type check `links`, and `@markstage/astro/topics` for a "More on this topic" block (docs/API-LINKS.md). `money` names the service pages (page types or `/paths/`); `follow` and `sponsored` list outside domains; `related` is the site's own finder of the words that name a page (a command). |
| `locales` | list | none | Copies of every page per region or language. See [Locales](#locales-and-hreflang). |
| `themes` | `{dark: {attr, value}}` | none | The site's dark colours and how its page turns them on: a `data-` attribute on `<html>` (`{attr: 'data-theme', value: 'dark'}`) or a class (`{attr: 'class', value: 'dark'}`). The screen check shows the page in the editor's own colours (the editor dark, the page dark), and its Light / Dark switch picks the other one for a look (`?theme=dark` or `?theme=light`, only when it differs from the editor's); without `themes` that switch is greyed ("This site has no dark mode"). The editor's own Light / Dark / System theme needs no config. |
| `editButton` | `{cms, corner?}` | none | An "Edit this page" link on the built site for people signed in to Markstage (docs/API-EDIT.md). `cms` is the Markstage server's address (its `publicOrigin`, e.g. `'https://cms.example.com'`); `corner` is `'bottom-right'` (default), `'bottom-left'`, `'top-right'` or `'top-left'`. The build adds one inline script to every page (on the pilot site: the same bytes on each); a visitor's browser runs one regular expression and nothing else, and the page never names the CMS. Signing in to Markstage sets the cookie the script looks for; it reaches the site when both share a host name or a parent domain. Needs https. Without it the build is byte for byte the same as without Markstage. |
| `locks` | `{pages: {<section type>: [...]}, articles: {<box>: [...]}}` | none | Blocks that always stay (docs/OPERATIONS.md "Locks"): each names what can't be done, `'move'`, `'remove'` or `'edit'`. `pages` names page sections by their type (`hero`), `articles` an article's boxes by their block name (`faq`; a run of them drawn as one box counts as one). They carry a closed padlock with that reason (Settings → Locks lists them; an editor lifts one on a single page with "Unlock on this page"), their grip shows the menu with those actions greyed and "Locked by the site: can't be moved or deleted.", a drag does not start, Alt+↑/↓ leaves them where they are, and the Outline marks them. Other blocks still move past them. The server checks every save against them too (`423`, docs/API.md "Locks"). Owners and administrators can change them in Settings → Locks: they are then kept in `markstage.locks.json` beside this file, which wins over this key (move the rules there, or remove the file to come back to these). One entry can lift a rule for itself ("Unlock on this page", docs/API.md "Locks"). |
| `health` | `{command: [argv], timeoutSeconds?}` | none | The site's health hook (server only): a command, run in the repo with no shell, that prints every address the host serves with its status. Site health lists broken pages, redirect chains and redirects from it (docs/API.md "Site health"). `timeoutSeconds` defaults to 120. The server's config.json may name one for a site without markstage.config; this one wins. |
| `integrations` | `{<name>: {url, value, text, …}}` | none | Lists of options fetched by the server from a JSON address on a schedule, for a `select` setting with `integration: '<name>'` to pick from (server only; docs/API-INTEGRATIONS.md). Each takes `url` (https), `value` and `text` (the keys, or dotted paths, of each item stored and shown), and may take `label`, `list` (where the list is in the answer), `detail`, `every` (minutes, 5 to 1440, default 60), `maxKB` (1 to 5120, default 1024) and `auth: {header?, scheme?, env | keyFile}`: the sign-in comes from a `MARKSTAGE_INTEGRATION_*` variable or a file outside the repo, never from this file. |
| `forms` | `{<id>: {label, fields, …}}` | none | The site's forms, which post to Markstage on the site's own host (server only). See [Forms](#forms). The server's config.json may name them for a site without markstage.config; these win. |
| `xDefault` | locale code | the default locale | The copy that `hreflang="x-default"` points at. |
| `hreflang` | `{robots, canonical}` | none | The frontmatter keys that decide whether a page emits hreflang. |
| `localeOverridesKey` | frontmatter key | `'locales'` | Where a locale's own title, description or slug are kept. |
| `editor` | object | | How the editor draws entries. See [Editor](#editor). |

## Forms

A form on the site posts to `/markstage/forms/<id>` on the site's own host (the server's config.json `siteHosts`
lists those host names; docs/DEPLOY.md "Forms"). What it keeps, checks and mails is set here. Messages go to the
Inbox in the data dir (never the repo); docs/API-INBOX.md "Forms and the Inbox" has the answers and the limits.

```js
forms: {
  contact: {
    label: 'Contact',
    fields: {
      name: { label: 'Name', required: true, max: 100 },
      email: { label: 'Email', type: 'email', required: true },
      number: { label: 'Phone', type: 'tel', required: true },
      comment: { label: 'Message', type: 'textarea', required: true, min: 14 },
      service_type: { label: 'Service type', max: 100 },
    },
    meta: { page: 'pageUrl', referrer: 'referrerURL', landing: 'landingURL', utmSource: 'u_source', utmMedium: 'u_medium' },
    service: 'service_type',
    honeypot: 'hp_website',
    started: 'started',
    thanks: '/thank-you/',
    reply: { subject: 'Thank you for reaching out', text: 'Hi {name},\n\nThanks for contacting {siteName}. …' },
    team: { subject: 'Inquiry from {name} from {siteName} website' },
  },
},
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `label` | string | the id | The form's name in the Inbox and its mail. |
| `fields` | `{<posted name>: {label, type, required, min, max, options}}` | required | What is kept, in this order; anything else posted is dropped. `type`: `text` (default; `email` for a field named `email`), `email`, `tel` (7 to 15 digits), `textarea` (keeps line breaks; `max` 5000), `url` (http or https). `max` defaults to 200 for one line. `options`: the only values allowed. |
| `name`, `email` | field name | `name`, `email` when there | The sender's name and address: the Inbox lists them, the limit counts the address, the thank-you mail goes to it. |
| `service` | field name | `service` or `service_type` when there | What the visitor asked about: the Inbox filters by it. |
| `meta` | `{page, referrer, landing, referringDomain, utmSource, utmMedium, utmCampaign}` → posted name | none | Where the visitor came from, kept beside the fields and shown in the team mail and the Inbox. |
| `honeypot` | posted name | none | A field people never see: filled in, the message is kept as spam. |
| `started`, `minSeconds` | posted name, seconds | none, 3 | The time (ms) the page's script set when the form appeared: sent sooner than `minSeconds`, the message is kept as spam. |
| `perDay`, `limitMessage` | number, text | 3, "You've already submitted a request today. Please try again tomorrow." | At most this many a day from one address or for one email address. |
| `perHour` | number | 300 | Real messages (never spam) an hour from everyone: past it, a message is stored as `held` and let through once the hour is under it again, the visitor answered as usual, the administrators told (docs/API-INBOX.md "A flood"). Raise it for a campaign day. 10 to 100000. |
| `message`, `thanks` | text, site path | "Thank you. Your message was sent.", none | The answer to the page's script; a page with no script goes on to `thanks`. |
| `reply` | `{subject, text}` | none | The thank-you mail to the visitor, through the server's `notify.email`. `{name}` (left out when it looks like a link or an address) and `{siteName}`. Settings → Forms can change it or turn it off (kept in the data dir, docs/API.md). |
| `team` | `{subject}` | `{siteName}: a message from {name} ({form})` | The team mail's subject (`{name}`, `{form}`, `{siteName}`); it goes to the alert recipients with every field and `Reply-To` the visitor. |
| `keepDays` | days | none: kept forever | Opt-in: messages older than this are deleted. Spam goes after 30 days, and the visitor's address and browser are cleared after 30 days whatever this says. |
| `crm` | `{kind: 'odoo', source, env?, phone?, description?}` | none | Opt-in: each message also goes to Odoo as a lead (docs/API-INBOX.md "Odoo"). `source`: the Odoo lead source's name ("Example Website"). `env`: the prefix of the environment variables with the address and sign-in (default `ODOO`: `ODOO_URL`, `ODOO_DB`, `ODOO_EMAIL`, `ODOO_PASSWORD`, `ODOO_ENABLE`); they are never written here. `phone`, `description`: the fields for those (defaults: `phone` or `number`, the first long text). The country, region, city and `mobile_country_code` come from the visitor's address (the city file), never from a field. |
| `leads` | `{kind: 'skald', url, action?, env?, vid?, test?}` | none | Opt-in: each real message (never spam) also goes to Skald as a lead (docs/API-INBOX.md "Leads for analytics"). `url`: Skald's lead hook for the site. `action`: a short word (default `contact`). `env`: the prefix of the secret's variable (default `SKALD_LEAD`: `SKALD_LEAD_SECRET`); it is never written here. `vid`: the posted value with Skald's visitor id (`skald('id')`), `test`: the posted value that marks a team's test lead with `1`; both are names of posted values that are not fields. |

## Collections

Each collection is a folder of entries. One file is one entry, and the entry's id is the file name without its
extension.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `id` | `^[a-z][a-z0-9-]{0,39}$` | required | Used in the editor's URLs (`#/e/posts/<id>`) and the API's (`collections/posts/…`). |
| `label` | string | the id | The name shown in the editor (e.g. Articles). |
| `format` | `'md'`, `'mdx'` or `'json'` | required | `md` is Markdown with YAML frontmatter, edited on the canvas. `mdx` is MDX (`.mdx` files): the same, with the code kept as written and components shown as cards ([MDX.md](MDX.md)). `json` is a data file, edited with forms. |
| `dir` | path | required | The folder, relative to the project and inside it. |
| `hasStatus` | boolean | `false` | Entries can be drafts (`draft: true`) or scheduled (`publishAt` in the future). New entries start as drafts. Without it, every entry is live. |
| `fields` | object | below | Which frontmatter keys hold the entry's basics. |
| `url` | template or function | none | The entry's page address. Without it, the entry has no page: no preview and no screen check. |
| `group` | function | none | The section the search lists the entry under. |
| `groups` | `{field, collection, order, label?}` | none | The entries sorted into another collection's entries, each group keeping its own order (topic clusters): `field` is the setting that names the group (a key of `settings`, `'cluster'`), `collection` the groups' collection (`'clusters'`), `order` the key in a group's entry that lists entry ids shown first, in that order (the rest follow, newest first), `label` what the editor calls them (default "Groups"). The editor's Groups screen (`#/groups/<collection>?g=<group>`) lists a group's entries in that order, saves `order` when one is dragged, and moves an entry to another group through `site/move` (its address, redirects and links follow). The lists give each entry `groupId`. |
| `gallery` | `{field?, variant?}` or `false` | `{field: 'sections'}` for a JSON collection | The section gallery (`#/gallery/<collection>`, linked from the Library): every section type and variation in `field` (the list of page sections), each drawn alone by the site's own components through the preview, at 1440 and 390 px, light and dark. `variant` is the key inside a section's value that names its variation (`'variant'`); without it, one sample per type. `false` leaves the collection out. Needs the server's preview (`preview.origin`). |
| `settings` | list | from `fields` | The Post settings drawer (`md` only). See [Post settings](#post-settings). A `json` collection takes one `seo` setting only (`{type: 'seo', title, description}`, keys in the entry's JSON), with no drawer: its search title and description for the duplicate check, Health and the suggestions, instead of the entry's title and excerpt. |
| `frame` | a frame id | `reading` (with `frames`) | The frame of the collection's entries that pick none and whose type gives none (docs/API-PAGE-TYPES.md). Needs `frames`. |
| `defaultAuthor` | author slug | none | The author written into a new entry when its maker has no author of their own (the server), and into every new entry in astro dev. |
| `newEntry` | function or `{ask, defaults}` | none | Making a new entry (`md` only; the header's **New**, `#/new/<collection>`). `ask`: the `settings` keys the New sheet asks for besides the title, the ones the site's schema needs and nothing can guess (`['cluster']`). `defaults({title, id, collection, values, user, now})`: the frontmatter the file starts with (dates, an SEO title, a canonical address); `values` are the asked ones, `user` is the maker on the server (null in dev). The title, the slug (`fields.slug`, = the id) and the asked values always win; then the author and `draft: true`. A bare function is `defaults` with nothing to ask. Core's `newEntryFrontmatter()` does the merge for both the server and astro dev. |

**`fields`** maps each role to a frontmatter key. Dotted keys reach into objects, e.g. `seo.title`. A role set to
null is not read.

| Role | Default | Used for |
| --- | --- | --- |
| `title` | `title` | The title edited above the canvas, and the lists and search. |
| `author` | `author` | Lists, filters and the server's ownership rules. |
| `tags` | `tags` | Lists and filters. |
| `date` | `date` | Lists and sorting. The server sets it on a new status entry. |
| `modified` | `modified` | Lists. |
| `excerpt` | `excerpt` | Lists. |
| `slug` | none | The default slug field, and new entries' file names. |
| `url` | none | A frontmatter key that holds the page address itself. It wins over `url` below. |

**`url`** has two forms:

- A template: `{id}` is the file name, and `{key}` or `{a.b}` is a frontmatter or JSON value. Examples:
  `'/blog/{id}/'`, `'/posts/{slug}/'`, `'{uri}'` (the whole address is stored in the entry).
- A function `({id, data}) => string | null`. Use it when the address depends on other files; for example,
  the pilot site looks up the post's topic.

**`group`** is a function `({id, data}) => string | null`. The search groups results under its value, for example
"Salesforce alternatives".

### Menus

A JSON collection with the id `navigation` holds the site's menus: one entry, or one per language when the
languages' menus differ (a language picker then shows). The editor has a **Site menus** screen (`#/menus/<entry>`;
under Content in the drawer, and in an entry's ⋯ menu). Every list in the entry whose items all have a `label` is a menu, named
after where it is: `primary` is "Primary", `footer.company` is "Footer: Company", a list inside a column titled
"Company" is "Footer: Company" too. Items nest with `children`; a menu whose items have `children` is a tree, as
deep as it is now (the site's header decides how deep it can show).

A site that names its pages its own way sets `linkKeys` on the collection: `{ id: 'navigation', …, linkKeys: { page:
'pages' } }` reads `"page": "about-us"` as a link to that page, and writes a picked page that way (in the old key's
place). An entry of a collection no key names (a post, when only pages have one) is then written as its address.
An item moved into a list takes that list's shape: `"children": []` where every other item has one (an item whose
last child moved out keeps its `[]`), none where none has. Keys that start with `_` (`_lock`) always stay last.

An item links to an entry, `"entry": "pages/about-us"` (`<collection>/<id>`): the site turns it into the entry's
address when it builds, so moving the page never breaks the menu. Anything else is an address, `"href": "/blog/"`
or `"https://…"`. With neither it is a heading that opens its list. The screen picks a page or post from a search
(stored as `entry`) or takes a typed address (`href`); a typed address that is one of the site's pages offers to
link to the page instead, and an `entry` whose page is gone shows "Missing page".

```json
{ "primary": [{ "label": "About us", "entry": "pages/about-us" },
              { "label": "Services", "children": [{ "label": "Migration", "entry": "pages/data-migration" }] },
              { "label": "Blog", "href": "/blog/" }],
  "footer": { "company": [{ "label": "Contact", "entry": "pages/contact-us" }] } }
```

The screen reorders (drag, keyboard, the grip's menu), nests, renames, changes links, adds a page, post or any
address, duplicates and deletes, with undo. Every change saves that one list, so the file changes only where the
menu did; every other key of an item (`cssClasses` …) stays. An item with `"_lock": { "move": true, "remove": true,
"by": "the site" }` can't be moved or deleted (docs/OPERATIONS.md "Locks"); the site ignores keys that start with `_`.
The site reads the entry itself (e.g. `getEntry('navigation', 'en')` in Astro).

## Post settings

`settings` lists the fields of the drawer behind the gear (`?s=1`). When a writer saves, only the keys they changed
are rewritten in the file; every other line stays byte for byte. Without `settings`, the drawer shows slug, excerpt,
tags, author and date, for whichever of those `fields` names.

Every field takes `label`, and may take `hint` (a line under it). A `key` is a frontmatter key; dotted keys are
written as nested YAML.

| `type` | Needs | Also takes | Draws |
| --- | --- | --- | --- |
| `text` | `key` | `max`, `placeholder` | A one-line input. |
| `textarea` | `key` | `max`, `placeholder` | A text box that grows as you type. |
| `slug` | `key` | | The slug, with the address it gives and a warning that the page moves. |
| `date` | `key` | | Date and time (UTC). |
| `tags` | `key` | | Tag chips, with suggestions from the collection. |
| `select` | `key` | `from` (a collection id), `options` (`[value, label]` pairs) or `integration` (a name in `integrations`) | A choice. With `from`, the choices are that collection's entries; with `integration`, that list's options as last fetched, searched as you type, and a save is checked against them (an old value that left the list is kept until it is changed). |
| `image` | `key` | `alt` (key), `clears` (keys), `focal` (key), `altFallback` (key) | A picker: the picture, Replace (upload, drop or paste), Choose from library, Crop, Remove, the alt text, and the file's path under "Details". `clears` lists keys that are removed when the image changes, e.g. a stored width and height. `focal` is where the image's focal point is kept, as a CSS position (`"50% 30%"`) the site uses for `object-position` when it crops the image; without it no focal point is offered. `altFallback` names the key the site uses as alt text while `alt` is empty (e.g. `"title"`): the editor then says "Uses the title as alt text" instead of warning, and the alt checks (canvas badge, preflight) count the image as having alt text. Only set it when the site really renders that fallback. A block pack's head can show the image on the canvas with `ctx.image()`, edited there (upload, replace, crop, alt text, focal point, remove). |
| `author` | `key` | `coAuthors` (key) | One of the site's authors (config `authors`), picked from a searchable list, with "Add … as a new author" and co-authors as chips; an author the site does not have is a warning. With `authors` on, a `text` or `select` setting of the author key becomes this field. |
| `switch` | `key` | `default` (`true` or `false`; `false` when left out) | A checkbox: on or off. The file holds the key only when it is not the default (`toc: false` for a switch that is on by default); turned back to the default, the key is removed. |
| `seo` | `title`, `description` (keys) | `titleMax` (60), `descriptionMax` (160), `keyphrase` (key) | Meta title and description, with counters and a search-result preview. Empty values show the title and excerpt as they will be used. `keyphrase` is where the focus keyphrase is kept (a string, or a list whose first item is the one checked, e.g. Rank Math's `seo.focusKeywords`): the SEO check (the header's SEO button) then edits it and checks where it appears; without it the keyphrase section is hidden. |
| `social` | `title`, `description`, `image` (keys) | | The social card, with a preview. Empty values fall back to the meta title and description (then the title and excerpt), and to the cover image. |

## Locales and hreflang

A site with `locales` serves a copy of every page per region or language, each under its own path prefix. One
source file serves every copy, and a locale may rewrite its text when the site is built (`spelling`).

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `code` | language tag | required | `en-CA`, `en-US`, `fr`… This is the `hreflang` value, and the editor's `?region=`. |
| `prefix` | `''` or `/path` | `''` | Where the copies live: `''` is the root, `/en-us` puts them under `/en-us/…`. |
| `default` | boolean | the root locale | The copy the editor shows first. Only one locale may be the default. |
| `label` | string | the code | The name on the Region switch and in Post settings. |
| `variety` | string | none | The spelling it uses, in words: `'US'`, `'Canadian'`. It is shown as "Editing the source text (US spelling)". |
| `spelling` | module path | none | A module whose default export is `(text) => text`: what the build does to this locale's prose. The editor runs it on the entry's text to list and highlight what changes. |
| `overrides` | list of `title`, `description`, `slug` | `[]` | Fields this locale may set on its own. They are stored under `<localeOverridesKey>.<code>.<field>`. Leave the list empty unless the site's pages read them. |

Validation: codes and prefixes must be unique, there may be only one default, and `xDefault` must be one of the
codes.

Each page emits one hreflang link per locale and then `x-default`, the same set on every copy. The helpers in
`@markstage/core` compute that set: `localePath`, `alternates`, `localeOfPath` and `emitsHreflang`.

`hreflang: {robots, canonical}` names the frontmatter keys the site reads for two cases where a page emits no
hreflang:

- its robots value contains `noindex`;
- its canonical is another address.

Post settings then says so instead of listing links. Set these keys only if the site's pages follow that rule.

In the editor:

- the screen check has a Region switch (`?region=<code>`). It frames that locale's copy, through the preview route
  with `?locale=`.
- For a locale with `spelling`, the editor counts what the spelling changes, lists it in the checks column and
  highlights it in the page.
- The translation status of every entry in every locale with its own title or description (missing, outdated or
  done) is read from git: docs/API-TRANSLATIONS.md.
- Post settings has a "Languages and regions" section: each copy's address (copy and open) and the hreflang set.

## Editor

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `lang` | language tag | `'en'` | The editor page's `lang` (spell-check language in the canvas). |
| `css` | list of paths | `[]` | The site's stylesheets. The canvas draws an entry with them, so it looks like the page. |
| `canvas.articleClass` | classes | `'ms-article'` | Classes on the canvas's article element, as on the site's post page. |
| `canvas.bodyClass` | classes | `'ms-body'` | Classes on the element that holds the body text. |
| `canvas.shell` | boolean | `false` | Draw the canvas inside the entry's real page (dev, same origin): the page's header, rail, grid and breakpoints around the text, measured on the canvas's width, and "What readers see" for the text as the build prints it (docs/CANVAS-FIDELITY.md). Off: the canvas is a sheet of paper with the site's CSS. |
| `packs` | list | `[]` | Block packs: a site's own boxes. Each pack has `markdown` (how they are written; the server needs it too), `editor` (how they are edited) and `css`. |
| `pageData` | module path | none | Its default export returns data the packs need from the site (labels, icons), in the page as `#ms-page-data`. |
| `links` | module path or object | none | `{special: [{href, label}], popup: {selector, note}}`. `special` links come first in the link search. Links matching `popup.selector` get a badge saying the site opens a popup. A module path keeps this next to the site code it mirrors. |
| `linkCards` | site path or `{url, fields}` | none | The site's own hover-card data for its links: a JSON object keyed by page path (`'/link-cards.json'`). Resting the pointer on a link on the canvas shows that card (picture, group, title, description, date) with the address and Edit / Open / Copy / Remove. `fields` maps the data's key names (`{title: 't', description: 'e', image: 'i', tag: 'g', date: 'd'}`); the defaults are those names spelled out. Without it the card shows what the editor knows of the page (title, excerpt, group, and "Draft: not live yet" for a draft); a link to another site shows its domain. |
| `images.widths` | list | `[{id: 'normal', label: 'Normal'}]` | The widths an image may take: `{id, label, class}`. The first is the default and writes no class; each other one writes its `class` on the image's `<figure>`, which the site's CSS must style (e.g. `figure.wide`). With one width the editor shows no width choice. |
| `images.captions` | boolean | `true` | Images get a caption line under them. A caption is written as `<figcaption>` in the image's `<figure>`. |
| `images.decorativeClass` | class | `'decorative'` | The `<figure>` class that marks an image as decorative (no alt text on purpose), so the editor stops asking for alt text. |
| `goLive` | sentence | "It goes live when the change is committed and the site is built and deployed, or published from the Markstage server." | In dev mode a save says "Saved on this computer, not live yet." and then this sentence: how a change reaches the live site, in the site's own terms (e.g. "It goes live when the site is published."). At most 300 characters. |
| `favicon` | site path | none | The editor tab's icon. |
| `preload` | site paths | `[]` | Fonts to preload (woff2), so the canvas does not flash. |
| `aliases` | site paths | `[]` | Older addresses of the editor (`/studio`) that open it in `astro dev`. |

### How images are written

A plain image stays plain Markdown: `![alt](../../assets/uploads/2026/10/chart.webp)`. An image with a caption, a width
other than the first, or the decorative mark is written as a figure around the same Markdown image, so the site still
processes the image as usual (Astro optimises it):

```md
<figure class="wide">

![A dashboard with three boards](../../assets/uploads/2026/10/chart.webp)

<figcaption>The board view, after the import</figcaption>
</figure>
```

The caption is plain text (`&`, `<` and `>` escaped). A figure written any other way is kept as HTML, unchanged.
Uploads go to `media.dir/<year>/<month>/` and the content refers to them relative to the entry's file.

## Worked example: the example blog

`examples/blog/markstage.config.mjs` uses no block packs, has one collection, and keeps the defaults everywhere
else.

```js
export default defineConfig({
  siteName: 'Example blog',
  collections: [
    {
      id: 'posts',
      label: 'Posts',
      format: 'md',
      dir: 'src/content/posts',
      hasStatus: true, // drafts and scheduling
      fields: { excerpt: 'description' }, // the blog calls its excerpt `description`
      url: '/posts/{id}/',
      frame: 'reading', // a post with no frame of its own or of its type
    },
  ],
  // full width, reading or plain (src/layouts/Base.astro draws each), and what a post is for
  frames: true,
  pageTypes: {
    types: [
      { id: 'guide', label: 'Guide', collections: ['posts'], frame: 'full', template: 'lib_guide-post', checks: [{ id: 'topic', label: 'A topic', field: 'topic', level: 'block' }] },
      { id: 'article', label: 'Article', collections: ['posts'], frame: 'reading', checks: [{ id: 'guide', label: 'Links to its guide', linksTo: { pageType: 'guide', sameField: 'topic' } }] },
      { id: 'legal', label: 'Legal page', collections: ['posts'], frame: 'plain' },
    ],
  },
  // authors as files (src/content/authors/), pages at /author/<slug>/ (src/pages/author/), co-authors allowed
  authors: { coAuthors: 'coAuthors' },
  compat: { collection: 'posts' },
  editor: {
    css: ['./src/styles/blog.css'],
    canvas: { articleClass: 'post', bodyClass: 'post__body' }, // as in src/layouts/Post.astro
  },
});
```

The Post settings drawer comes from `fields`: excerpt (`description`), tags, author and publish date. The author is
picked from the blog's authors (docs/API-AUTHORS.md), whose hub and pages are in `src/pages/author/`. Post settings
starts with the Page box: the post's type, its frame and what its type still needs; the guide template ships in
`markstage/library/template/lib_guide-post.json` (docs/API-PAGE-TYPES.md). There are no locales, so the Region
switch and "Languages and regions" do not appear.

## Worked example: a two-locale business site

`markstage.config.mjs` of a business site with a Canadian and a US copy (abridged):

```js
import { SITE } from './src/lib/seo/site.mjs';

export default {
  siteName: 'Example Co',
  siteUrl: SITE, // https://www.example.com
  // Canadian English at the root (x-default), a US copy under /en-us/. The files are written in US spelling and
  // the root respells prose at build, with the same function the editor imports.
  locales: [
    { code: 'en-CA', prefix: '', default: true, label: 'Canada', variety: 'Canadian', spelling: './markstage/spelling-en-ca.ts' },
    { code: 'en-US', prefix: '/en-us', label: 'United States', variety: 'US' },
  ],
  xDefault: 'en-CA',
  hreflang: { robots: 'seo.robots', canonical: 'seo.canonical' }, // Seo.astro's rule
  collections: [
    {
      id: 'posts',
      label: 'Articles',
      format: 'md',
      dir: 'src/content/blog',
      fields: { slug: 'slug' },
      settings: [
        { type: 'slug', key: 'slug', label: 'URL slug' },
        { type: 'image', key: 'cover.src', alt: 'cover.alt', label: 'Cover image', clears: ['cover.width', 'cover.height'] },
        { type: 'select', key: 'cluster', label: 'Topic', from: 'clusters' },
        { type: 'select', key: 'author', label: 'Author', from: 'authors' },
        { type: 'seo', label: 'Search engines', title: 'seo.title', description: 'seo.description' },
        { type: 'social', label: 'Social card', title: 'seo.ogTitle', description: 'seo.ogDescription', image: 'seo.ogImage' },
        // … excerpt, categories, tags, date, canonical
      ],
      // the address and the search group come from the post's topic cluster (src/content/clusters/*.json)
      url: ({ id, data }) => `${clusters().get(data.cluster)?.path ?? '/blog/'}${data.slug ?? id}/`,
      group: ({ data }) => clusters().get(data.cluster)?.title ?? data.cluster,
    },
    { id: 'pages', label: 'Pages', format: 'json', dir: 'src/content/pages', url: '{uri}' },
    { id: 'authors', label: 'Authors', format: 'json', dir: 'src/content/authors', fields: { title: 'name' } },
    { id: 'clusters', label: 'Topics', format: 'json', dir: 'src/content/clusters' },
  ],
  compat: { collection: 'posts' },
  editor: {
    lang: 'en-CA',
    css: ['./src/styles/tokens.css', './src/styles/base.css', './src/styles/prose.css', './src/styles/article.css', './src/styles/article-parts.css'],
    canvas: { articleClass: 'post post--rich', bodyClass: 'prose post__body' },
    packs: [{ markdown: './markstage/blocks/markdown.mjs', editor: './markstage/blocks/editor.ts', css: './markstage/blocks/canvas.css' }],
    pageData: './markstage/page-data.ts',
    links: './markstage/links.ts', // the booking link, and the selector of the site's booking popup
    favicon: '/favicon-32x32.png',
    preload: ['/fonts/geist-latin-wght.woff2', '/fonts/geist-mono-latin-wght.woff2'],
    aliases: ['/studio'],
  },
};
```

The site's own round-trip check (a script in its repo) keeps parts of this config honest against
the site's own code:

- section 7: `links.ts` popup selector equals the site's booking-popup rule;
- section 8: the locales equal `src/lib/seo/i18n.mjs`, and every built article page emits exactly the hreflang set
  the editor shows.
