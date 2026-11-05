# Topics and internal links

When a site publishes page D today, D can link to pages A, B and C from last month. But A, B and C never learn that
D exists, so D gets no links from them, and fixing that by hand means rereading every old page. Markstage keeps a
map of every link in the site's text and finds the fixes both ways:

- **Writing D:** the pages D should link to (its topic's main page, its group's lead, its service page, two or
  three pages next to it), each with the words to link and the sentence of D they fit in.
- **Publishing D:** sentences on older pages that already talk about D's subject, with the words to link. **Accept**
  adds the link on that page as a normal save (one commit, Undo); **Skip** hides the suggestion for everyone.
- **On the site:** a "More on this topic" block fed from the topics, so old pages list new ones on the next build
  without being edited.
- **Health:** what is weak or wrong in the site's links, worst first, with one-click fixes.

What an editor sees:

- **Page settings → Topic and links** (under the Page box): the page's topic, group and role, put in straight away;
  how many pages link here; "Pages to link to" (with **Link these words** on the canvas), "Suggested by AI" (below)
  and "Pages that should link here" (with **Accept** and **Skip**).
- **More → Topic map** (`#/topic-map`): each topic as a **Journey** (which page links to which, with the link words;
  below) and as a board (**Arrange**). On the board, drag pages between the main page, the pages without a group,
  each group's lead and pages, and "Not in a topic", or use a card's **Move to…** list.
- **More → Links** (`#/links`): the **Link inbox** (every open suggestion, grouped by the page the link goes to),
  **Health**, **Pages** (links in, out and outside per page) and **Skipped**.
- **The publish sheet**: a Links row (how many pages could link here, what this page should link to), and the page
  type's link checks (below).

Code: `packages/core/src/topics.mjs` (the topic files and config), `packages/core/src/link-map.mjs` (the map and the
Health findings), `packages/core/src/link-suggest.mjs` (the suggestions and the edits that apply them),
`packages/server/src/links/` (the routes), `packages/astro/src/topics.mjs` (`@markstage/astro/topics`, the site's
helpers), and in the editor `src/settings/topic-box.ts`, `src/suggestion-card.ts`, `src/admin/topics/` and
`src/admin/links/`.

## Turning it on

In `markstage.config.mjs` (docs/CONFIG.md, key `topics`):

```js
export default defineConfig({
  topics: {
    money: ['service'],                 // page types (or site paths such as '/services/') that sell something
    follow: ['docs.example.com'],       // outside sites a link may pass credit to; any other gets rel="nofollow"
    sponsored: ['partner.example.com'], // paid or partner sites: their links need rel="sponsored"
  },
  // or `topics: true` for every default
});
```

| Key | Default | What it does |
| --- | --- | --- |
| `dir` | `'markstage/topics'` | The folder of `<id>.json` topic files, inside the project. Never a collection's folder. |
| `collections` | every collection with an address | The collections whose pages are in the map and may be put in topics. |
| `money` | `[]` | The service ("money") pages: page type ids, or site paths starting with `/`. A topic may also name its own (`money` in its file). |
| `follow` | `[]` | Outside domains a body link may pass credit to (a plain link). Subdomains count. |
| `sponsored` | `[]` | Paid or partner domains: their links must say `rel="sponsored"`. |
| `generic` | `[]` | More vague link words, over the built-in ones ("click here", "read more", "here", "this", "link", "source", …). |
| `keywords` | `'keywords'` | The frontmatter key (or JSON field) of a page's own words for itself. They are matched first. |
| `robots` | `'robots'` | The key that may say `noindex` (a link to such a page is a finding). `noindex: true` works too. |
| `enough` | `3` | How many pages should link to a live page. The inbox suggests links to live pages with fewer. Health calls a page with none "no links in" and one with one "weak". |
| `related` | none | `{command: [argv], timeoutSeconds?}`: the site's own finder of the words that name a page (an embeddings index, an AI model). See below. |

## The topic files

One JSON file per topic, `markstage/topics/<id>.json`, in the site's own repo, so git keeps their history and the
site's build reads them. The Topic map and the Page box write them; they can be written by hand too.

```json
{
  "title": "Editing",
  "description": "How to edit pages",
  "pillar": "posts/hello-markstage",
  "money": "pages/services",
  "anchors": ["the editing guide"],
  "keywords": ["editing"],
  "members": ["posts/old-notes"],
  "groups": [
    { "id": "ways-to-write", "name": "Ways to write", "lead": "posts/writing-with-source-mode", "members": ["posts/keyboard-shortcuts"] }
  ]
}
```

- A page is named `<collection>/<id>`. A page is in **one topic at most**, in one place: the topic's main page
  (`pillar`), a group's `lead`, a group's `members`, or the topic's own `members` (no group).
- `anchors`: words for links to the main page. `keywords`: words that name the topic; sentences with them are
  suggested for a link to the main page.
- `money`: this topic's service page, over the site's `money` rule.

## The link map

On every save the server reads the changed entry again (only that one: each entry is kept by its version) and
builds the map from **the body text only**: Markdown text, and the rich-text and Markdown fields of JSON pages. Menus,
cards, footers and the site's layout are not counted. For each page it keeps the links out (address, words, rel,
the sentence and block they are in), the links in from **live** pages, the words used for each target, and every
outside link with its rel. Redirects come from the site's redirects hook (docs/CONFIG.md `redirects`), asked at most
once a minute.

## Suggestions

Words are matched as **phrases** first, longest first: the page's own `keywords`, its topic's `anchors` and
`keywords` (for the main page), its group's name (for a lead), its title made short ("How to set up a CRM in 2026"
→ "set up a CRM"), and its address. A phrase is never suggested when the same words already link to another page
(that would make one set of words name two pages), never on vague words, never inside an existing link, and never
on a page that already links there.

- **Pages to link to** (outgoing): the topic's main page, the group's lead, the service page, then two or three pages
  of the same group or topic. Each says why ("its topic’s main page") and shows the sentence the words fit in; when
  the page has no such sentence yet, it asks for one to be written with those words.
- **Pages that should link here** (incoming): sentences on other pages that talk about this one, best first (pages of
  the same topic and group first).
- **Suggested by AI** (when AI is on, docs/API-AI.md `links`): **Suggest links with AI** asks the model to pick up to
  five pages from this index for the open text, with the words to link and one line on why. The pages are the
  index's, never addresses the model made up, and the server checks each one: the page is there, live or a draft
  this person may see (marked Draft), not linked from this page yet, and the words are in the text. Each has
  **Add link** (links the first place those words stand unlinked on the canvas: one change, ⌘Z takes it back, ⌘S
  saves it) and **Dismiss**. Its address: `?s=1&suggest=links`.

### The site's own finder: `related`

A site can add words that name a page from its own tools. With `topics.related: {command: ["node",
"scripts/related.mjs"]}`, when someone looks at a page's suggestions the server runs the command (no shell, in the
project, with the same small environment as the build) and writes JSON on its stdin:

```json
{ "page": { "ref": "posts/keyboard-shortcuts", "title": "…", "url": "/posts/keyboard-shortcuts/", "keywords": [], "text": "the page's text, up to 4000 characters" },
  "pages": [{ "ref": "posts/hello-markstage", "title": "…", "url": "/posts/hello-markstage/" }] }
```

It answers `{"phrases": ["…", "…"]}` on stdout (at most 20, each up to 80 characters). Those words count as the
page's own keywords. The answer is kept until the page changes; a command that fails or takes longer than
`timeoutSeconds` (default 20) counts as no words, and the phrase match still runs. The command may call an
embeddings index or the AI provider the site already uses (docs/API-AI.md); its keys stay in its own environment.

## Accept, Skip and Undo

**Accept** changes the *other* page as a normal save would: the person's rights on it, its lock, the site's save
checks, and for a live page the publish rules (a rule that already failed before the link is not counted against
it, only a new one). It is one commit (`Link “words” on Page A to Page B`), the page is published again when it is
live, and the toast's **Undo** takes it back (`POST /site/undo`; whoever accepted it may undo it). A page that changed
since the suggestion was made answers `409 suggestion-gone`: the list is read again.

**Link these words** (a page's own outgoing suggestion) links the words on the open canvas instead; ⌘S saves it.

**Skip** is remembered for everyone (the `link_skips` table): the suggestion leaves the inbox and the page's lists.
**Links → Skipped** lists them, with **Bring back**.

## Health

Each finding names the page, says what is wrong in plain words, shows the sentence when there is one, and offers a
fix button or **Open at the sentence** (the editor at that block, with the words found).

| Kind | Level | What it is | Fix |
| --- | --- | --- | --- |
| `no-links-in` | Fix first | A live page no other page links to in its text (not a page hidden from search engines). | Pages that could link here |
| `weak` | Worth fixing | Only one page links to it (not a hidden page either). | Pages that could link here |
| `no-pillar-link` | Fix first | A page of a topic that does not link to the topic's main page. | Suggested links |
| `no-lead-link` | When there is time | A group's page that does not link to its group's lead. | Suggested links |
| `not-in-topic` | When there is time | A live page in no topic. | Put it in a topic |
| `anchor-clash` | Worth fixing | The same words link to two or more pages. | Open at the sentence |
| `generic-anchor` | Worth fixing | Vague link words ("click here", "read more", a bare "Source"). | Open at the sentence |
| `to-redirect` | Worth fixing | A link to an address that redirects. | **Point it to** the final address (one click) |
| `to-noindex` | Worth fixing | A link to a page hidden from search engines. | Open at the sentence |
| `to-missing` | Fix first | A link to a site address that is no page. | Open at the sentence |
| `outside-follow` | When there is time | An outside link that passes credit to a site not on `follow`. | **Mark it nofollow** (one click) |
| `outside-sponsored` | Fix first | A link to a `sponsored` site without `rel="sponsored"`. | **Mark it sponsored** (one click) |
| `missing-page` | Worth fixing | A topic names a page that is gone. | **Take it out of the topic** (one click) |
| `money-path-wide` | When there is time | A service-page address in `topics.money` also covers the pages under it (`/data-migration/` and its articles at `/data-migration/x/`), so each counts as a service page, and a topic's "service page" could turn out to be one of its articles. One finding per address. | List exact addresses, or name each topic's `money` |

A one-click fix is a normal save of that page (or of the topic file), one commit, with Undo on the toast (taking a
gone page out of a topic has no Undo: put it back on the board). A rel in a Markdown page is written as
`<a href="…" rel="nofollow">words</a>`, which the site's Markdown keeps.

## The Journey view

A topic opens as a journey (`#/topic-map/<id>`), left to right the way a reader travels: **articles and guides**
(in their groups), **group lead pages**, the **main page**, and the **service page** (the topic's `money`; else the
main page when it is a service page itself; else, marked as a guess, the service page its pages link to most). Each
page is a card: its title, its address (copy and open), published or draft and when it last changed (its own
`modified` field, else its date), and its links in and out (right-aligned numbers). A card is marked when no page
links to it, when one page does, when it does not link up to the main page or its group lead, and when a link on it
goes to no page.

- **Lines** are links that move a reader on (an article up to its group lead or the main page, a lead to the main
  page, the main page to the service page). The links into one page meet in one upright line, so they read as a comb.
  Each line has a **chip** with the link words (and "+2" when there are more): click it for the side panel with each
  link, the heading above it, its sentence with the words marked, and **Open at the sentence**.
- **Dashed lines** are links the topic expects that are missing: up to the group lead and the main page (Health's
  `no-lead-link`, `no-pillar-link`), and from each group lead and the main page on to the service page. The panel
  offers the suggestion that adds one (**Accept**, **Skip**), or says to write a sentence when none fits.
- **Amber** lines and chips go through a redirect (or to a page hidden from search engines); a chip with a mark has
  words to change (`generic-anchor`, `anchor-clash`). A link to no page is a red tag on its card.
- **Links back** (the main page down to its leads, a lead down to its articles) are light dotted lines; a link back
  from further away (the service page to an article) is a note on the card. A link straight past a column (an
  article to the service page) is a chip inside the card, never a line across other cards. Links between two
  articles and from other topics show when a card is picked, and in its **+** list.
- Above the map: the topic's gaps in plain sentences, worst first, and a row to show **one group at a time**. A long
  group shows its first four pages and "+N more".
- Numbers that are not there are not made up: Markstage keeps no visit counts, so there are none, and form
  messages (those whose visit began on the page) only show when the site has form messages at all.

## The Flow view

The same topic as a river (`#/topic-map/<id>?view=flow`), read top down. The **service page** is the goal bar on
top; the **main page** sits under it; the **group leads** fork off the main page in a row, and each group's
**articles** are stacked under its lead, slightly indented. Each page is a card (240 × 120) with a short **code**:
each group a letter and a colour (A, B, C… never M or S), its lead number 1 and its articles 2 on in the topic's
order; **M** is the main page, **S** the service page. A card shows the code, a short title and one quiet line
("8 in · 11 out", or for a lead its group's name), **→ S** when it links straight to the service page, **New** (first
out in the last 90 days) or **Stale** (no change for a year) from its own dates, and a **red dot** when it has a
missing link. A group with no lead page has a dashed "No lead page yet" card in its place.

- **Lines** are the river: the main page up to the goal, the main page down to each lead, each lead down to its
  articles, each branch in its group's colour. A line's width is the number of links it carries, plus one (at most
  8); a link the river expects that is not there is a thin dotted line. Rows hold as many groups as fit the screen
  at 93% (five at 1512px wide); the rows below the first are fed by a channel down the left.
- **Calm by default**: no line across the map until a card is pointed at (or focused); then that page's links to
  the other cards show, thin and grey, and those cards lift.
- **Folding**: a topic with more than 40 pages opens with its groups folded but the three with the most articles. A
  folded group shows its lead only, with "Group · N pages ▸" to open it (▾ folds it again); its chip has ▸ too.
- **A page picked** (a click, or Enter) shows the step round it, in three columns: **Comes from** (pages that link to
  it), the page, **Goes to** (pages it links to), each in code order, with one grey trunk in and one out. Under the
  page: **To fix** (its missing links, each with **Accept**, which adds the link at the sentence the suggestion found,
  Undo on the toast; **Skip**; or **Open the page** when no sentence fits), then **Both ways ⇄** (pages that link to
  it and that it links to, shown once). Pointing at a card lights its one line in its colour, with the link words
  and the heading above each. A click on any card walks on; the **trail** above the map keeps the pages walked
  through, each a way back, and **← All pages** goes back to the river. The side panel gives the picked page's
  details only: its code and title, where it sits, its dates and age, its address (copy and open), its numbers, the
  ways to open it, and its shortest way to the service page.
- **View** (a popover; everything off at first): **Show side links** (pages of one level linking to each other, as
  faint dashed curves), **Show deep links** (the main or service page straight down to an article, as arcs), the
  pages of an age (the rest fade), and **the site as it was on** a day (a slider: pages published later are left
  out; links are drawn as they are today).
- **Zoom** (the buttons in the bar under the map, never over a card): the map fits its width, a small one up to 125%, a tall one at 100% scrolling down, never under 93% (so
  a card's smallest words, 13px, are 12px or more on screen); − and + step through 93, 100, 110, 125 and 150%.
- **The layout**: every box on an 8px grid, 16px between cards, 64px between levels, 48px round the map; nothing
  closer than 8px to anything else, every column left-aligned, no line under a card, no control over a card, no word cut short or ended
  with "…", no sideways scroll at 1280, 1512 or 1920px. The unit tests run this check on the layouts
  (`packages/editor/test/flow.test.ts`), and the browser test runs it on the page (`packages/server/e2e/flow-check.mjs`).

The URL keeps every state, and Back and Forward step through them: `group` (one group's branch only), `open` (the
groups open: their ids with commas, `none` or `all`; none: the ones open at first), `page` (the page picked), `trail`
(the pages walked through to it, with commas), `zoom` (in %), `options=1` (the View popover open), `side=1`,
`deep=1`, `age=new|stale` and `asof=YYYY-MM-DD`. Keys: Tab goes through the cards, Enter picks one, Esc goes back to
the river, + and − zoom, 0 fits.

## Page type checks: `links`

A page type (docs/API-PAGE-TYPES.md) can ask for links. Each is a check like any other, shown in the Page box and the
publish sheet, and `level: 'block'` stops a publish:

```js
{ id: 'article', label: 'Article', collections: ['posts'], checks: [
  { id: 'up', label: 'Links up to its topic’s main page', links: 'pillar', level: 'block' },
  { id: 'sell', label: 'Links to the service page', links: 'money' },
] }
```

| `links:` | Passes when |
| --- | --- |
| `pillar` | The page is in a topic and links to its main page (or is the main page). |
| `lead` | A group's page links to its group's lead. |
| `money` | The page links to its topic's service page (or none is set). |
| `anchors` | No vague link words, and no words it uses for two pages. |
| `redirects` | No link to a redirect, a hidden page or no page. |
| `outside` | Every outside link has the rel its domain needs. |

In `astro dev` (no link map) a `links` check counts as passed.

`astro dev` has no link map of its own. To see the Links screens and the topic map there, run a Markstage server
in dev mode on the same machine (`MARKSTAGE_DEV_NO_AUTH=1`, 127.0.0.1 only) and start `astro dev` with
`MARKSTAGE_DEV_SERVER=http://127.0.0.1:<its port>`: the dev API then hands `links/*`, `topics/*` and `site/undo` to
that server (`packages/astro/src/api-forward.mjs`). Only a loopback address is accepted.

## Routes

On the Markstage server (`/markstage/api/…`, signed in). Everyone signed in may look; editors and above change topics
(`topics.manage`, docs/API-PERMISSIONS.md). Accept and the fixes need the right to change the page they change. A
site without `topics` answers `404 no-topics`.

| Route | Does |
| --- | --- |
| `GET /topics` | `{items: [Topic], pages: [PageRow], can: {manage}}`. With `?pages=0`, `pages` is `[]` (a picker on an open entry needs the topics alone). |
| `GET /topics/:id` | `{topic, pages, can}`. |
| `POST /topics {id?, title, description?, pillar?, money?, anchors?, keywords?, members?, groups?}` | `201 {topic}`. `id` defaults to a slug of the title. A page already in another topic: `422`, naming it. Commit `Add topic <title>`. |
| `PUT /topics/:id {version, …}` | Change only the keys sent. `409` when the file changed since `version`. |
| `DELETE /topics/:id?version=` | `{ok, commit}`. Its pages are in no topic afterwards; their links stay. |
| `POST /topics/place {ref, topic, group?, role?, index?}` | The Page box and the board: the page leaves every other place and goes to this one (`role`: `member`, `lead`, `pillar`; `index`: its place in the list). `topic: null` takes it out. `{changed, topic, from, page}`. Commit `Put “Title” in topic <title>`. |
| `GET /links/pages?topic=&q=` | `{items: [PageRow], topics: [{id, title}]}`. |
| `GET /links/health?topic=&kind=&ref=` | `{items: [Finding], counts: {<kind>: n}, kinds: {<kind>: words}, total, topics}`, worst first. |
| `GET /links/suggest?ref=&dir=in\|out` | `{page: PageRow, in: [Suggestion], out: [Suggestion]}`. Asks the `related` hook first. |
| `GET /links/inbox?topic=&page=&perPage=` | `{items: [Suggestion], counts: {total, in, out, topics}, skipped}`; with `perPage` (1–500) one page of the items and `page`, `perPage` in the answer. The inbox is worked out once per link map and skip list (a skip, an unskip or an accept makes it again). |
| `GET /links/map?topic=` | One topic as a journey: `{topic: {id, title, pillar, money, moneyGuessed, groups}, pages: [JourneyPage], edges: [Edge], missing: [Missing], numbers: {visits, leads}}`. `400` without a topic, `404` for an unknown one. |
| `POST /links/accept {id, from, to, dir}` | `{ok, commit, job, from, to, anchor}`. `409 suggestion-gone`; `422 needs-words` for a suggestion with no sentence yet. Audited as `links.accept`. |
| `POST /links/skip {id, from, to, anchor}` | `{ok}`. |
| `GET /links/skips` | `{items: [{id, from, to, anchor, at, by}]}`. |
| `DELETE /links/skips/:id` | `{ok}`: suggested again. |
| `POST /links/fix {id}` | A finding's one-click fix. `{ok, commit, job}`. Audited as `links.fix`. |

`PageRow` = `{ref, collection, id, title, url, status, live, topic, group, role, money, in, out, external, updated,
published, modified, edit}` (`updated`: the page's `modified` field, else its date; `published` and `modified`: its
date field and its `modified` field as the entry gives them, each null when it gives none, never guessed). `JourneyPage` = `PageRow` + `{place: 'member' | 'lead'
| 'pillar' | 'money' | 'outside', problems: [kind], leads?}` (`outside`: a page of another topic that links with
this one; `problems`: `no-links-in`, `weak`, `no-pillar-link`, `no-lead-link`; `leads`: form messages whose visit
began on the page, only when `numbers.leads`). `Edge` = `{id, pair, from, to, anchor, sentence, at, section, status,
href, address, open, warn: [{kind, message}]}`: one link in a page's text that starts or ends on the topic's pages
(`to: null`: no page of the site; `pair`: the same for every link from one page to another; `warn`: Health's
`generic-anchor`, `anchor-clash`, `to-redirect`, `to-noindex`, `to-missing` for it). `Missing` = `{id, kind:
'no-lead-link' | 'no-pillar-link' | 'no-money-link', from, to, message, suggestion: Suggestion | null, open}` (the
`id` is Health's finding id where Health has one; `suggestion` is null when it was skipped). `numbers.visits` is
always false: Markstage keeps no visit counts.
`Suggestion` = `{id, dir, from, to, fromTitle, fromUrl, toTitle, toUrl, reason, anchor, how: 'link'|'add', sentence,
at, section, path, start, end, open}` (`open`: the editor at that sentence). `Finding` = `{id, kind, level, ref,
page, message, sentence?, anchor?, href?, fix?, open?}`.

`GET /collections/:c/entries/:id/preflight` (the publish sheet) has `topicLinks: {ref, topic, in, incoming,
outgoing, review}` (`review`: `#/links?view=page&ref=…`).

## The screens' addresses

Every state is in the URL, so each can be linked to, reloaded and gone back from:

| Hash | Shows |
| --- | --- |
| `#/topic-map?action=new` | Every topic (pages, live pages, pages that need links, its main page) and the pages in no topic; the New topic form. |
| `#/topic-map/<id>?group=<g>&page=<ref>&details=1&link=<id>&more=<g>,<g>` | One topic as a journey. `group`: one group only (`-`: the pages in no group); `page`: the picked page; `details`: its links in the side panel; `link`: a connection (its `pair`) or a missing link (its `id`) in the side panel; `more`: groups shown whole. |
| `#/topic-map/<id>?view=arrange&q=&page=<ref>` | One topic as a board. `q`: the search in the pages in no topic; `page`: the picked page. |
| `#/topic-map/<id>?action=edit\|delete` | Edit its name, words, service page and groups; delete it. |
| `#/links?view=inbox&topic=<id>&s=<suggestion>` | The Link inbox (`s`: the open suggestion). |
| `#/links?view=health&topic=<id>&kind=<kind>&f=<finding>` | Health (`f`: the open finding). |
| `#/links?view=pages&topic=<id>&q=` | Every page with its links in, out and outside (numbers right-aligned). |
| `#/links?view=page&ref=<collection/id>` | One page: the pages that should link to it, the pages it should link to, what to fix on it. |
| `#/links?view=skipped` | Skipped suggestions, to bring back. |

Every page address shown has copy and open buttons (open uses the site's own address); link words and outside
addresses can be copied.

## The site's pages: `@markstage/astro/topics`

```ts
import { moreOnTopic, placeOf, topics } from '@markstage/astro/topics';
```

| Helper | Gives |
| --- | --- |
| `topics()` | Every topic, normalized (`[]` when the site keeps none). |
| `placeOf(collection, id)` | `{topic, group, role}` or `null`. |
| `moreOnTopic(collection, id, {limit?})` | The pages for "More on this topic": the page's own group (lead first), then the topic's main page, then the pages without a group, then the other groups. Never the page itself. `[{collection, id, role, group, topic}]`. |

They read the topic files during the build and in `astro dev`; `topicsOf(cfg)` gives the same helpers for a
normalized config. Leave out drafts yourself (`getEntry`, then `!entry.data.draft`).

The example blog has the block (`examples/blog/src/components/MoreOnTopic.astro`):

```astro
---
import { getEntry } from 'astro:content';
import { moreOnTopic } from '@markstage/astro/topics';
const { id } = Astro.props;
const more = await moreOnTopic('posts', id, { limit: 8 });
const posts = (await Promise.all(more.map((m) => getEntry('posts', m.id)))).filter((p) => p && !p.data.draft).slice(0, 4);
---
{posts.length > 0 && (
  <aside class="more-topic"><h2>More on this topic</h2>
    <ul>{posts.map((p) => <li><a href={`/posts/${p.id}/`}>{p.data.title}</a></li>)}</ul>
  </aside>
)}
```
