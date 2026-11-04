# Markstage API: translation status

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). For a site with `locales`
(docs/CONFIG.md "Locales and hreflang"), whether each entry's words for each locale are missing, outdated or done,
and the list of what needs translating. Server code: `packages/server/src/content/translations.mjs`.

Read-only. A translation is written like any other field, through the normal entry save (Post settings → Languages
and regions writes `<localeOverridesKey>.<code>.<field>`).

## What is tracked

- **Locales:** every locale except the default one whose `overrides` include `title` or `description`. A locale that
  takes only `slug`, or none, is not tracked: its pages use the source words (respelled by `spelling` at build).
- **Fields:** `title` and `description`, where the locale takes them. The source of a field is the entry's search
  text, as the publish rules read it: the collection's seo key when set, else its title or its excerpt. Its
  translation is `<localeOverridesKey>.<code>.<field>` in the same file.

## Status

Per field:

| Status | When |
|---|---|
| `missing` | The translation is empty and the source is not. In a locale of the same language as the default one (`en-US` beside `en-CA`), an empty field means "the same as the source" and is `done`: only another language needs its own words. |
| `outdated` | The source changed in a later commit than the one that last changed the translation. Changed in the same commit: `done`. A working copy that differs from HEAD (a save not committed yet) is the newest change. |
| `done` | Otherwise. |

An entry's status in a locale is its worst field's: `missing`, then `outdated`, then `done`. A field whose source
and translation are both empty is left out; an entry with no such field in a locale has no row for it.

Times are commit times (ISO, UTC): `sourceChangedAt` when the source last changed, `translatedAt` when the translation
last changed (`null` while it is empty).

## Routes

Signed in, every role (as every entry list is).

`GET translations?locale=&status=&collection=&q=&sort=&page=&perPage=`

| Query | Default | What |
|---|---|---|
| `locale` | all tracked | One tracked locale's code. |
| `status` | `needs` | `needs` (missing and outdated), `missing`, `outdated`, `done` or `all`. |
| `collection` | all | A collection id. |
| `q` | none | Part of the entry's title or id, any case. |
| `sort` | `changed` | `changed`: the newest source change first; `title`: by title. |
| `page`, `perPage` | 1, 50 | Whole numbers; at most 200 a page. |

A value it does not know (a locale that is not tracked, another status, sort or collection, a page that is not a
whole number in range) is `422 invalid` with `field` naming the query key, never quietly the default: these sit
in the screen's address, and a link edited by hand fails plainly.

```json
{
  "locales": [{ "code": "fr-CA", "label": "Français", "sameLanguage": false }],
  "counts": { "fr-CA": { "missing": 12, "outdated": 3, "done": 40 } },
  "items": [{
    "collection": "posts", "id": "hello-world", "title": "Hello World", "url": "/blog/hello-world/",
    "entryStatus": "published", "locale": "fr-CA", "status": "outdated",
    "fields": {
      "title": { "status": "outdated", "source": "Hello, World", "value": "Bonjour le monde",
                 "sourceChangedAt": "2026-10-29T14:05:00.000Z", "translatedAt": "2026-10-28T09:12:00.000Z" },
      "description": { "status": "done", "source": "The first post.", "value": "Le premier article.", "…": "…" }
    },
    "sourceChangedAt": "2026-10-29T14:05:00.000Z", "translatedAt": "2026-10-28T09:12:00.000Z",
    "can": { "edit": true }
  }],
  "total": 15, "page": 1, "perPage": 50
}
```

- `sameLanguage`: the locale has the default locale's language, so an empty field uses the source words (the screen
  says so rather than calling it missing).
- `can.edit`: whether this person's save of the entry would be allowed (the entry save's own rule: a contributor
  their own drafts, a live entry needs the publish right), so a row offers Translate or View.

`counts` covers every row of the chosen locale, collection and search, whatever `status` shows. A site with no
tracked locale answers `{locales: [], counts: {}, items: [], total: 0, …}`.

`GET collections/:c/entries/:id/translations` → `{locales: [{code, label, sameLanguage, status, fields,
sourceChangedAt, translatedAt}], can: {edit}}`, one per tracked locale (`locales: []` on a site with none). No such
entry: `404`.

## How it is read

From git, in a few processes per request whatever the number of entries: one `git log --raw` over the collections'
folders (every change to every file, with its blob ids), then `git cat-file --batch` for the versions needed, one
round per step back in history and only for the fields not yet decided. The log is cached until HEAD moves; each
file's answer until its newest commit or its working copy changes.

Tests: `translations.test.mjs`.
