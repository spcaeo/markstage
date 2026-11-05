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

## AI drafts of a whole site

Translate the site (Languages › Translate the site with AI, `#/translate`) drafts every entry's title and description
in one region with the [`translate` AI kind](API-AI.md#translate-a-draft-for-another-locale), for people to review.
The drafts are never published and never replace anyone's words.

**What it covers.** Markdown collections with pages (the ones Post settings shows regions for), and only the fields
the region takes as its own (its `overrides`). Other collections are listed with why they cannot be included.

**The plan first.** `POST translate` with `{locale, collections?: [id…] | null, skipExisting?: true}` → `201
{run, plan}`, writing nothing and asking the AI nothing. The plan lists every entry with `action: 'draft' | 'skip'`
and, for a skip, `reason` and `why` in plain words:

| `reason` | `why` |
|---|---|
| `translated` | It has its own words in that region already (only with `skipExisting`, the default). |
| `nothing` | It has no title or description to translate. |
| `waiting` | An AI draft is already waiting for review. |
| `rights` | This person's role cannot change its words in that region. |
| `too-long` | A field is over 1,000 characters, more than the AI translates at once. |

`plan.counts` has the entries, drafts, skips, characters and an estimate of the tokens in and out; `plan.time` says
how many asks of the AI that is, how long under this person's `perMinute` limit, and how many asks are left today.
`plan.lines` is the plan in plain words, as the command line prints it. A plan is kept for an hour for its person to
run as it is; after that it is `expired` and running it is `410 expired`.

**The run.** `POST translate/:rid/run` → `202`. It goes on in the server, not in the browser: leaving the page does
not stop it. Each entry is one ask through the same path as the editor's Draft translation (rights, limits, the
scrubber and an `ai.suggest` audit row). It waits when this person's minute limit is reached, and pauses when the
day's is used, saying when to resume; it never gets an `ai-rate` refusal of its own making. Before each ask the entry
is checked again: words written since the plan (`changed`) or an entry removed (`gone`) are skipped. A provider
failure fails that entry only, with words in `why`; AI turned off stops the run, paused.

`POST translate/:rid/pause`, `resume` and `cancel` act between two asks; drafts already made are kept. One run goes at
a time (`409 busy`). A server restart pauses a run that was going, with a reason; its person resumes it.

**The drafts** go in `markstage/translations/<code>.json` in the content repo, in batches of 25 entries, each batch
one commit in the name of the person who ran it ("Draft 25 Français (Canada) translations with AI (batch 1 of 3)").
The site never reads that file, so no page changes and nothing goes live. Each draft keeps the source words and the
region's words as they were, so it is done with as soon as someone writes that region's words: the next run's
`waiting` check and the review list read only open drafts.

**The report.** `GET translate/:rid` → `{run, plan, result}`. `result.items` lists each entry with `action:
'created' | 'skipped' | 'failed'`, `why` and, for a draft, `open` (still waiting). It starts with the entries the plan
skipped, with their reasons, so once a run is done created + skipped + failed is every entry the plan considered.
`run.progress` counts them as it goes (`done` of `total`, the plan's entries). A notice tells the person when it stops.

**Review.** `GET translate/drafts/:c/:id` → `{drafts: [{locale, label, fields, source, before, by, at, run, model}]}`,
the open drafts of an entry. Post settings shows a waiting draft first ("Review the AI draft"): Accept puts it in the
fields, and saving them is an ordinary entry save. `DELETE translate/drafts/:c/:id/:locale` discards one, as a
commit, for someone who may change that region's words.

**Who.** A person in the editor: editors and up, or a custom role that may write the region's words (each entry is
then checked as its save would be). Never a token or an agent (`403`). A run is its person's to start, resume, pause
and cancel; an administrator may pause or cancel it. While AI is off, `503 ai-off` with the same `why` as
`GET ai`, and the editor shows the reason instead of the button. Audited: `translate.plan`, `translate.start`,
`translate.resume`, `translate.pause`, `translate.cancel`, `translate.run` (the counts at the end) and
`translate.discard`.

## From the command line

```sh
markstage-server translate --to fr-CA --dry --as editor@example.com
markstage-server translate --to fr-CA --as editor@example.com
```

The same plan and run, as the person named by `--as`, with the same rights, limits and audit. `--dry` prints the plan
and writes nothing; `--only posts,guides` limits the collections; `--include-translated` also drafts entries that
have their own words (the draft waits beside them; it never replaces them). The run prints its counts and each skip
or failure with why, then the editor address of its review list. Exit code 0 when done, 1 when it stopped before the end (paused or cancelled).

Tests: `translate.test.mjs` (server), `translate-site.e2e.mjs` (browser).

## How it is read

From git, in a few processes per request whatever the number of entries: one `git log --raw` over the collections'
folders (every change to every file, with its blob ids), then `git cat-file --batch` for the versions needed, one
round per step back in history and only for the fields not yet decided. The log is cached until HEAD moves; each
file's answer until its newest commit or its working copy changes.

Tests: `translations.test.mjs`.
