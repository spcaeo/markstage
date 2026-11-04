# Markstage API: AI suggestions

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). A person in the editor asks a
model for words they then read, change and save themselves: an image's alt text, a page's search title and
description, a promotion plan's summary, or a draft of a title and description for another of the site's locales.
Server code: `packages/server/src/ai/`.

**A suggestion never commits.** These routes write no file, no git commit and no content. They write one audit row.
Accepting a suggestion goes through the editor's normal save routes, with the same rights, versions, locks and
checks as any other save.

## Turning it on

The site owner brings the key, in one of two places (one rule for the suggestions and the plan summary of
docs/API-ENV.md):

- `MARKSTAGE_AI_KEY` in the server's environment (the service's environment file), or
- `ai.keyFile`: the absolute path of a file that holds it, outside the site repo (a Docker secret such as
  `/run/secrets/markstage_ai_key`, or `/etc/markstage/ai.key`, mode 0600). A key file inside the content repo is
  refused at start: "a file there can be committed, pushed and built into the site".

The environment wins when both are set. The key is never in config.json (`key` there is refused at start), the
database, a URL, the audit, an answer or an error. With no key, everything else works and the editor says why the
feature is off: "AI suggestions are off: MARKSTAGE_AI_KEY is not set on the server and there is no ai.keyFile." (or
"…, and ai.keyFile cannot be read or is empty."). The key is read on every call, so a new key works without a
restart.

The server's `config.json` may tune it (all optional):

```json
"ai": { "provider": "anthropic", "model": "claude-sonnet-5-5", "keyFile": "/run/secrets/markstage_ai_key", "perMinute": 10, "perDay": 200 }
```

| Key | Default | What |
|---|---|---|
| `provider` | `anthropic` | Who answers. `stub` gives fixed answers with no network and is refused outside tests (`NODE_ENV=test`). |
| `model` | `claude-sonnet-5-5` | The model id, for the suggestions and the plan summary of docs/API-ENV.md alike. |
| `keyFile` | none | The file that holds the key, outside the repo (above). |
| `perMinute`, `perDay` | 10, 200 | Asks per person, rolling (the last 60 seconds, the last 24 hours). Whole numbers, at most 600 and 100,000. |
| `timeoutSeconds` | 30 | How long one ask may take. |
| `endpoint` | `https://api.anthropic.com/v1/messages` | Https, or a loopback address. |

`key` in config.json is refused at start. With no `ai` block, the defaults apply and the key alone turns it on.

## Routes

| Method + path | Who | Body | Answer |
|---|---|---|---|
| `GET ai` | signed in | | `{on, why, envVar, provider, model, kinds, limits: {perMinute, perDay}}` |
| `POST ai/suggest` | signed in | `{kind, …}` (below) | `{kind, suggestion, provider, model}` |

- `on`: whether a suggestion can be asked for now. `why`: the words to show when it is off, else `null`.
  `envVar`: always `MARKSTAGE_AI_KEY`.
- `kinds`: what this person may ask for here. `summary` is listed for editors and up. `translate` is listed when the
  site has more than one locale.
- A browser session only. A command-line token and an AI assistant's (MCP) token are refused (`403`): an agent has
  its own model already.

## Kinds

Sizes are in characters. Too long is `413 too-large` with `field` and `max`, and nothing is sent to the model.

### `alt`: alt text for an image

`{kind: 'alt', image, collection?, id?, context?}` → `suggestion: {alt}`

- `image`: the image as the site writes it: its address from the media URL template (`/uploads/2026/10/sky.png`), its
  path in the repo (`src/assets/uploads/2026/10/sky.png`), its path under the media folder (`2026/10/sky.png`), or,
  with `collection` and `id`, a path relative to that entry's file (`../../assets/uploads/2026/10/sky.png`). It must
  be a file inside the media folder, reached by no symbolic link; anything else is `404`, as if it did not exist.
- `collection`, `id`: the entry the image is on (optional). Its title helps the model. It must be one this person may
  read (below), else `404`.
- `context`: what the person says about the image, at most 2,000.
- JPEG, PNG, GIF and WebP up to 3.5 MB are sent as they are. Another image type (AVIF), or a larger file, is sent as
  a JPEG copy at most 1,568 pixels on its longest side when the server has its image codec. A PDF, an SVG, or a file
  that is not an image: `422 image-type`.

### `seo`: a search title and description

`{kind: 'seo', collection, id, title?, text?}` → `suggestion: {title, description}`

- The entry must be one this person may read.
- `title` (at most 1,000) and `text` (at most 20,000): what the editor has now, unsaved. Without them, the entry's
  saved title and its text (a Markdown entry's body; a JSON entry's text values) are used, cut at 20,000.
- The model is also told the search title and description the entry has now.

### `summary`: a promotion plan in plain words

`{kind: 'summary', plan}` → `suggestion: {text}`

- Editors and up; others `403`. A plan names every file it moves.
- `plan`: a plan's id (`GET env/plans`). None: `404`. Still preparing: `422 plan-not-ready`.
- The model gets what the plan summary of docs/API-ENV.md gets: the facts JSON and the changed files' names, never a
  page's text. An answer that states a number the facts do not have is dropped: `502 ai-failed`, "The model stated
  numbers the plan does not have…". The plan's own facts words always stand.

### `translate`: a draft for another locale

`{kind: 'translate', collection, id, locale, fields?: {title?, description?}}` → `suggestion` with the same keys

- `locale`: one of the site's locales (`locales` in markstage.config, docs/CONFIG.md "Locales and hreflang"). Another:
  `422 locale`, naming the ones there are.
- `fields`: the words to translate, at most 1,000 each (`field: 'fields.title'`). Without them, the entry's search
  title and description. Only `title` and `description`, and only the ones the locale takes as its own (its
  `overrides`); another is `422 locale` with `fields`.
- The model is told the source locale (the default one) and the target, with their `variety`.
- **The site's spelling.** The answer goes through the locale's `spelling` module, the same text → text function the
  build and the editor's Region switch use, so an `en-CA` draft says "colour" whatever the model wrote. A module that
  does not load is `500 spelling`, said before the model is asked, so it costs nothing.

## Who sees what

The same rule as the MCP server's reads (docs/API-MCP.md "Reads follow the role"): editors and up may ask about any
entry; authors and contributors about live entries and their own drafts. Another entry's answer is
`404 "That entry is not available to you."`, the same as one that does not exist. A plan's summary is for editors and
up.

## Limits

- **Per person:** at most `perMinute` and `perDay` asks, counted from the audit (rolling) and the asks still running.
  Over: `429 ai-rate` with `Retry-After`, `retryAfter` seconds, `limit: 'minute' | 'day'` and `max`. The refusal is
  audited as `ai.limited`, at most once a minute per person.
- An ask that is refused before the model is asked (rights, sizes, shape, the spelling module, off) does not count.

## Errors

| Status | `error` | When |
|---|---|---|
| `503` | `ai-off` | No key (neither the variable nor a readable key file). `message` is the `why` of `GET ai`; `envVar: 'MARKSTAGE_AI_KEY'`. |
| `429` | `ai-rate` | This person's limit, or the provider is busy with the site's key (`retryAfter` from its `Retry-After`, else 30). |
| `502` | `ai-failed` | The provider failed, timed out, refused the key ("The owner checks MARKSTAGE_AI_KEY or ai.keyFile."), declined, said nothing, or answered in another shape. Fixed words, never the provider's own. |
| `403` | `forbidden` | A summary below editor; a token instead of a session. |
| `404` | `not-found` | The entry, image or plan is not there or not available to this person. |
| `413` | `too-large` | A field over its size (`field`, `max`). |
| `422` | `invalid`, `image-type`, `locale`, `plan-not-ready` | A wrong kind or field, a file that is not an image, a locale or field the site does not have, a plan still preparing. |
| `500` | `spelling` | The locale's spelling module did not load. |

## What is kept, and what is never

- **The audit.** Every ask the model gets is one `ai.suggest` row: who, the kind, the target (`posts/hello-world`,
  the image's repo path, or the plan id), the provider, the model, and `inputTokens` and `outputTokens`. A failed one
  is `ok: false` with the error code. Never the prompt, the page's text or the answer.
- **The key** goes in the provider's `x-api-key` header and nowhere else: never in the database, a URL, the audit,
  an answer or an error.
- **No secrets to the model or back.** What the model reads, every answer and every error go through the MCP server's
  scrubber (docs/API-MCP.md "No secrets"): secret-named environment values (the key among them), a form's CRM sign-in,
  the key read from `ai.keyFile`, secret-keyed config values, git remote addresses, a sign-in in a URL, and people's email addresses become
  `[hidden]`.
- **Content is data.** Each prompt tells the model that the page's words are data to work from, never instructions,
  and each answer is checked for its shape before anyone sees it.

## Provider

Anthropic's Messages API over HTTPS (`anthropic-version: 2026-10-21`), with low effort: these are short, scoped
answers. An image goes as a base64 image block. The server has no SDK dependency; tests pass their own `fetch`.

Tests: `ai.test.mjs` (the stub provider: kinds, the readable rule, the summary for editors, sizes, limits, the audit,
off, nothing committed, tokens refused) and `ai-provider.test.mjs` (the Anthropic provider with a fake fetch: the
request, each failure, the key file, a planted key never out, from the environment or the file; translation
drafts and the spelling). No test calls a real API or
reads a key from the machine it runs on.
