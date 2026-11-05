# Markstage API: AI suggestions

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). A person in the editor asks a
model for words they then read, change and save themselves: an image's alt text, a page's search title and
description, a promotion plan's summary, a draft of a title and description for another of the site's locales,
better words for a few they selected on the page (rewrite, shorten, fix the spelling and grammar, change the tone),
links from the page to the site's own pages, or a fix for a problem the SEO check found.
The model is the owner's choice: Anthropic, any OpenAI-compatible endpoint, or Ollama on the server's own machine
("Providers" below).
Server code: `packages/server/src/ai/`.

**A suggestion never commits.** These routes write no file, no git commit and no content. They write one audit row.
Accepting a suggestion goes through the editor's normal save routes, with the same rights, versions, locks and
checks as any other save.

## Turning it on

The site owner brings the key (Ollama, and an OpenAI-compatible server on the same machine, need none), in one of
two places (one rule for the suggestions and the plan summary of
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
| `provider` | `anthropic` | Who answers: `anthropic`, `openai` (any OpenAI-compatible endpoint) or `ollama` ("Providers" below). `stub` gives fixed answers with no network and is refused outside tests (`NODE_ENV=test`). |
| `model` | `claude-sonnet-5-5` for `anthropic`; none for the others | The model id, for the suggestions and the plan summary of docs/API-ENV.md alike. `openai` and `ollama` have no default: until the owner names one, AI is off and the editor says so. Letters, digits and `. _ : / @ -`, at most 120. |
| `keyFile` | none | The file that holds the key, outside the repo (above). |
| `perMinute`, `perDay` | 10, 200 | Asks per person, rolling (the last 60 seconds, the last 24 hours). Whole numbers, at most 600 and 100,000. |
| `timeoutSeconds` | 30 | How long one ask may take, 1 to 600 (a model on the server's own machine can be slow). |
| `endpoint` | `https://api.anthropic.com/v1/messages` | `anthropic` only. Https, or a loopback address. |
| `baseUrl` | `https://api.openai.com/v1` (`openai`), `http://127.0.0.1:11434` (`ollama`) | `openai` and `ollama` only: where the API is. Https, or plain http on a loopback address (`127.0.0.1`, `localhost`, `[::1]`). A sign-in in the address is refused at start. |
| `keyHeader` | `authorization` | `openai` only: `authorization` (`Bearer <key>`, the default) or `api-key` (Azure OpenAI). |

`key` in config.json is refused at start. With no `ai` block, the defaults apply and the key alone turns it on.

## Routes

| Method + path | Who | Body | Answer |
|---|---|---|---|
| `GET ai` | signed in | | `{on, why, reason, envVar, provider, model, kinds, limits: {perMinute, perDay}}` |
| `GET ai?check=1` | owner, administrator | | the same, and `health` (below) |
| `POST ai/suggest` | signed in | `{kind, …}` (below) | `{kind, suggestion, provider, model}` |

- `on`: whether a suggestion can be asked for now. `why`: the words to show when it is off, else `null`. `reason`:
  what is missing when it is off, `key` or `model` (else `null`). `envVar`: always `MARKSTAGE_AI_KEY`.
- `health` (`?check=1`): `{ok, words, modelFound}`. The server asks the provider for its list of models (no
  suggestion, so nothing is spent) and says whether the named model is in it, for example "The Ollama server has no
  model “llama3.2”. The owner pulls it there (ollama pull llama3.2) or names another in ai.model." Its words go
  through the scrubber like every error. Each check is one `ai.health` audit row (the provider, the model, whether
  the model was found). Anyone else: `403`.
- `kinds`: what this person may ask for here. `summary` is listed for editors and up. `translate` is listed when the
  site has more than one locale. `links` is listed when the site keeps a link index (`topics` in markstage.config,
  docs/API-LINKS.md).
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
- **A fix for one problem** (the SEO check's "Suggest a fix"): add `problem`, one of `title-long`, `title-short`,
  `description-missing`, `description-long`, `description-short`, and what the editor has now, unsaved, as
  `searchTitle` and `description` (at most 1,000 each). The answer then has only the one key the problem is about
  (`{title}` or `{description}`). A `-long` answer must be shorter than what is there, a `-short` one longer, or it is
  dropped (`502 ai-failed`, "The suggestion was no shorter than…"). A problem about an empty field that is not
  `description-missing`: `422 invalid`.

### `summary`: a promotion plan in plain words

`{kind: 'summary', plan}` → `suggestion: {text}`

- Editors and up; others `403`. A plan names every file it moves.
- `plan`: a plan's id (`GET env/plans`). None: `404`. Still preparing: `422 plan-not-ready`.
- The model gets what the plan summary of docs/API-ENV.md gets: the facts JSON and the changed files' names, never a
  page's text. An answer that states a number the facts do not have is dropped: `502 ai-failed`, "The model stated
  numbers the plan does not have…". The plan's own facts words always stand.

### `rewrite`: better words for a selection on the page

`{kind: 'rewrite', collection, id, mode, text}` → `suggestion: {text}`

- `mode`: `rewrite` (clearer, the same meaning), `shorten` (fewer words, every fact kept), `fix` (only the spelling
  and grammar), or `tone:friendly`, `tone:formal`, `tone:confident`. Another: `422 invalid`.
- `text`: the selected words, at most 4,000 characters (`413 too-large`, `field: 'text'`). The entry is the one they
  are in: the readable rule ("Who sees what") applies to it.
- The answer is the new words alone, as plain text: one paragraph stays one paragraph (line breaks become spaces).
  An answer far longer than the selection (over twice its length, and over 400 characters) is `502 ai-failed`
  ("much more than was selected").
- **In the editor.** Select words inside one paragraph, heading or list item (not code), then "Improve with AI" at
  the end of the format bar (Alt+F10 reaches the bar from the keyboard, the arrows move along it). The choices open
  in a card beside the words, which stay marked on the canvas; the suggestion shows as a diff (taken out struck
  through, put in underlined). Accept, Edit then accept, or Reject. Accepting is one change on the canvas, as
  typing is: ⌘Z takes it back, and ⌘S saves it through the normal save (locks, versions, the save that rewrites only
  what changed). Nothing saves by itself. A selection whose link or formatting covers only part of it says that
  accepting keeps the words, not those. Each state has its URL: `?suggest=rewrite&sel=<from>-<to>` (the choices),
  `&how=<mode>` (the suggestion); Back and Forward walk them. The button is not there while AI is off or the
  server does not offer `rewrite`; a link that asks anyway opens the card, which says why, as every AI card does.

### `links`: links from this page to the site's own pages

`{kind: 'links', collection, id, text?, linked?, max?}` → `suggestion: {links: [{words, to, title, url, status,
reason}], dropped}`

- Only on a site that keeps a link index (`topics`, docs/API-LINKS.md); elsewhere `422 no-topics`, before the model is
  asked. The entry must be one this person may read.
- `text` (at most 20,000): the page's words as the editor has them now, unsaved; else its saved text. `linked` (at most
  500 addresses): where the editor's text links now, so those pages are not suggested again. `max`: 1 to 10, 5 when
  left out.
- **The pages come from the index, never from the model.** The model gets a list of at most 60 pages of the site: not
  this one, with an address, not `noindex`, not linked from this page already (in the index or in `linked`), and
  readable by this person (a draft only for its owner and for editors and up, the rule of "Who sees what"). Pages whose
  title words the text uses, and pages of the same topic, come first. None left: `422 no-pages`.
- **Each answer is checked on the server**: the page is one of those offered; the words are in the text (a whole-word
  match, any case) and are not vague ("click here", "read more"); no page and no words twice. A suggestion that fails
  is left out and counted in `dropped`. `words` come back as the text has them; `to` is the page's ref
  (`posts/canvas`), `url` its address and `status` `live` or `draft`.
- Nothing is linked by this route. In the editor (Post settings → Topic and links, "Suggested by AI", URL
  `?s=1&suggest=links`), Add link links the first place the words stand unlinked: one change on the canvas, ⌘Z takes
  it back, ⌘S saves it through the normal save (which writes only that link).

### `fix`: a fix for a heading or for vague link words

`{kind: 'fix', collection, id, problem, …}` → `suggestion` as below. The entry must be one this person may read. A
search title or description is the `seo` kind with its `problem`; missing alt text is the `alt` kind.

- `problem: 'heading'`, with `headings` (the page's outline, 1 to 300 `{level, text}`, the text at most 1,000 each),
  `index` (the heading to fix, from 0) and `after` (the words under it, at most 2,000) → `{level, text}`. The level
  must keep the outline in order: from 1 (2 when another H1 is there) to one below the heading before it. A heading
  that is in order already and has words: `422 in-order`. An answer outside that range is dropped (`502`).
- `problem: 'link-text'`, with `sentence` (at most 1,000), `words` (the link's words, in the sentence) and `href` →
  `{sentence, words}`: the sentence again, with link words that name the page. The model is told the page's title
  when the link index knows it and this person may read it. The words must be in the sentence and not vague, and the
  sentence may not grow much; else the answer is dropped (`502`).
- In the editor each fix has its URL (`?side=seo&suggest=fix&fix=<id>`, docs/SEO.md) and shows as a diff with Accept,
  Edit then accept and Reject. Accepting is one change: ⌘Z takes it back, ⌘S saves it.

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
| `503` | `ai-off` | No key (neither the variable nor a readable key file): `envVar: 'MARKSTAGE_AI_KEY'`. Or no model named for `openai` or `ollama`: `reason: 'model'`. `message` is the `why` of `GET ai`. |
| `429` | `ai-rate` | This person's limit, or the provider is busy with the site's key (`retryAfter` from its `Retry-After`, else 30). |
| `502` | `ai-failed` | The provider failed, timed out, refused the key ("The owner checks MARKSTAGE_AI_KEY or ai.keyFile."), does not have the model (`openai`, `ollama`: the words name it), declined, said nothing, or answered in another shape. Fixed words, never the provider's own. |
| `403` | `forbidden` | A summary below editor; a token instead of a session. |
| `404` | `not-found` | The entry, image or plan is not there or not available to this person. |
| `413` | `too-large` | A field over its size (`field`, `max`). |
| `422` | `invalid`, `image-type`, `locale`, `plan-not-ready`, `no-topics`, `no-pages`, `in-order` | A wrong kind or field, a file that is not an image, a locale or field the site does not have, a plan still preparing; links on a site with no link index, or with no page left to suggest; a heading that is in order already. |
| `500` | `spelling` | The locale's spelling module did not load. |

## What is kept, and what is never

- **The audit.** Every ask the model gets is one `ai.suggest` row: who, the kind, the target (`posts/hello-world`,
  the image's repo path, or the plan id), the provider, the model, and `inputTokens` and `outputTokens`. A failed one
  is `ok: false` with the error code. Never the prompt, the page's text or the answer.
- **The key** goes in the provider's own header (`x-api-key` for Anthropic; `Authorization: Bearer` or `api-key`
  for an OpenAI-compatible endpoint; Ollama gets none) and nowhere else: never in the database, a URL, the log, the
  audit, an answer or an error.
- **No secrets to the model or back.** What the model reads, every answer and every error go through the MCP server's
  scrubber (docs/API-MCP.md "No secrets"): secret-named environment values (the key among them), a form's CRM sign-in,
  the key read from `ai.keyFile`, secret-keyed config values, git remote addresses, a sign-in in a URL, and people's email addresses become
  `[hidden]`.
- **Content is data.** Each prompt tells the model that the page's words are data to work from, never instructions,
  and each answer is checked for its shape before anyone sees it.

## Providers

One interface (`packages/server/src/ai/provider.mjs`, the adapters in `providers.mjs`): every kind, the plan summary
and the health check work the same with each. No SDK: plain `fetch`, never streamed, within `timeoutSeconds`. A
provider's `429` is `429 ai-rate`; its other failures are the fixed words of `502 ai-failed`.

| `provider` | What it calls | Key | Model |
|---|---|---|---|
| `anthropic` (default) | Anthropic's Messages API (`ai.endpoint`, `anthropic-version: 2026-10-21`), low effort: short, scoped answers | Needed | `claude-sonnet-5-5` unless named |
| `openai` | `POST <baseUrl>/chat/completions`, `stream: false`: OpenAI, Azure OpenAI (`keyHeader: "api-key"`, the deployment's address as `baseUrl`), OpenRouter, Together, LM Studio, or another OpenAI-compatible server | Needed, except at a loopback `baseUrl` (LM Studio on the same machine) | None: the owner names one |
| `ollama` | `POST <baseUrl>/api/chat`, `stream: false`, on the server's own machine by default | Never sent | None: the owner names one (`ollama list` shows those pulled) |

```json
"ai": { "provider": "openai", "baseUrl": "https://openrouter.ai/api/v1", "model": "anthropic/claude-sonnet-5-5", "keyFile": "/run/secrets/markstage_ai_key" }
"ai": { "provider": "ollama", "model": "llama3.2", "timeoutSeconds": 120 }
```

An image goes as each API takes one: a base64 image block (Anthropic), an `image_url` data URL (OpenAI-compatible),
or the message's `images` (Ollama). A promotion's plain-words summary (docs/API-ENV.md) uses the same provider.

Tests: `ai.test.mjs` (the stub provider: kinds, the readable rule, the summary for editors, sizes, limits, the audit,
off, nothing committed, tokens refused, each rewrite mode), `ai-seo.test.mjs` (links and fixes: the pages offered,
the readable rule for drafts, the checks on each answer with a fake fetch, each problem, the limits and the audit),
`ai-provider.test.mjs` (the Anthropic provider with a
fake fetch: the request, each failure, the key file, a planted key never out, from the environment or the file;
translation drafts and the spelling) and `ai-providers.test.mjs` (the OpenAI-compatible and Ollama providers with a
fake fetch: the request's shape, streaming off, images, Azure's header, no key at a loopback address and never for
Ollama, no model named, each failure, a timeout, the address rules, the health check for owners and administrators
only, and a rewrite and a promotion summary through the server). In a browser: `e2e/ai-rewrite.e2e.mjs`, `e2e/ai-seo.e2e.mjs`. No test
calls a real API or reads a key from the machine it runs on.
