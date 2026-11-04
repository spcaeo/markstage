# Markstage API: permissions

Part of the API contract (docs/API.md: its conventions, prefix and errors apply here). Who may do what, by role
(`owner`, `administrator`, `editor`, `author`, `contributor`, the WordPress names). Every decision is made in one
file, `packages/server/src/roles.mjs`; this table is its human-readable copy and changes with it.

A person with a custom role (docs/API-ROLES.md) has its base as their role in this table; the role's own rules come
first: a rule that denies takes a right away, one that allows gives a right the base lacks (never one that is
"yes" only for the owner and administrators here).

| Action | Owner | Admin | Editor | Author | Contributor |
|---|---|---|---|---|---|
| Read all entries, revisions, media | yes | yes | yes | yes | yes |
| Create / edit entries in a status collection | all | all | all | own | own drafts only |
| Edit collections without status (pages, settings) | yes | yes | yes | no | no |
| Publish / schedule / unpublish | all | all | all | own | no |
| Save raw HTML (new or changed raw HTML blocks) | yes | yes | yes | yes | no |
| Delete to trash | all | all | all | own | own drafts |
| Restore from trash / purge | yes / yes | yes / yes | yes / no | own / no | no |
| Upload media / edit alt | yes | yes | yes | yes | yes / own |
| Delete unused media | yes | yes | yes | own | no |
| Snippets (own) / shared, templates | yes | yes | yes | own | own |
| Rebuild whole site | yes | yes | yes | no | no |
| Find and replace across the site, bulk actions | yes | yes | yes | no | no |
| Redirects: list, add, change, remove, test | yes | yes | yes | no | no |
| Authors (`authors.manage`): add, archive, change the slug, delete (posts given to another author or moved with the slug); see the list and profiles | yes | yes | yes | see; their own profile | see; their own profile |
| Change an author profile (docs/API-AUTHORS.md); see an author's private email | all | all | all | own | own |
| Change an existing page's type (docs/API-PAGE-TYPES.md; a new entry may be given one by anyone who makes it) | yes | yes | yes | no | no |
| Topics (`topics.manage`, docs/API-LINKS.md): add, change, delete; put a page in a topic (Page settings, the Topic map); see the topics, the Link inbox and Health | yes | yes | yes | see | see |
| Accept a link suggestion or a Health fix (it changes that other page, so it needs the right to edit that page, as above) | as a save | as a save | as a save | as a save | as a save |
| Site health, CSV exports, Ask Google for speed, back up now, send a test alert | yes | yes | no | no | no |
| Users, audit log | yes | yes (not owner) | no | no | no |
| Inbox: read form messages, mark them handled or spam, give them to someone, add notes | yes | yes | yes | no | no |
| Inbox: delete, CSV export, see the visitor's address; the thank-you mail | yes | yes | no | no | no |
| Settings → Alerts: read / change | yes / yes | yes / yes | yes / no | no | no |
| My alerts (one's own) | yes | yes | yes | yes | yes |
| Design & Code: read the files, tokens, revisions | yes | yes | yes | yes | yes |
| Design & Code: save CSS, tokens, scripts; add code to the site or a page | yes | yes | no | no | no |
| An AI assistant (MCP token) reads: entries, the pages a Library item is on, a release's entries | all | all | all | live + own drafts | live + own drafts |
| An AI assistant (MCP token) reads promotion plans | yes | yes | yes | no | no |
| An AI assistant (MCP token) writes: drafts (`mcp:draft`), and changes into a release that is not scheduled | as above | as above | as above | as above | own drafts, no release |
| AI suggestions (in the editor): alt text, search title and description, a translation draft, for the entries one may read | all | all | all | live + own drafts | live + own drafts |
| AI suggestions: a promotion plan's summary | yes | yes | yes | no | no |
| Import entries and media from JSON (plan, run) | yes | yes | yes | no | no |
| Translation status and the "needs translation" list (read only; writing a translation is an entry save) | yes | yes | yes | yes | yes |
| Webhooks: add, change, remove, new secret, test, read deliveries, retry | yes | yes | no | no | no |
| Integration fields: read the lists and pick from them (a save is checked against the list) | yes | yes | yes | yes | yes |
| Integration fields: fetch a list again now (once a minute) | yes | yes | yes | no | no |
| Custom roles: make, change, remove, give, dry-run (one on administrator: the owner only) | yes | yes | no | no | no |
| Single sign-on: see and undo a person's links to the providers | yes | yes (not the owner or administrators) | no | no | no |
| Sign in with a password when the site signs in with its providers only (`sso.passwordLogin: false`) | yes | no | no | no | no |

"Own" = the entry's author field equals the user's `authorSlug`. Authors and contributors always create entries
under their own `authorSlug`. "Raw HTML" = blocks the converter could not map to a known node or block pack (core
`rawHtmlOf(doc)`: block `rawHtml {html}` and inline `rawInline {html}`); a contributor's save may keep the ones already there but not add or change any (`403`).

An AI assistant reads more narrowly than a person in the editor does: an author's or a contributor's token shows live
entries and their own drafts only, and so do the pages a Library item lists and a release's entries; plans, which
name every file they move, are for editors and up. A person reads a colleague's draft in the editor to work on it
with them. An agent copies what it reads into a model's context, where it can travel further, so it gets only what
its person needs (docs/API-MCP.md "Reads follow the role").
