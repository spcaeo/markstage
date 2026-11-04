# Running a site with Markstage: every operational task, end to end

Owner, 2026-10-28: "how to change images, or upload or media library? and every other operational challenge needs
to be addressed." The test for each row: a non-technical writer or site owner can do it **from the editor**, with no
terminal, no file paths and no developer, and it works the same in dev (astro dev) and on the server. "Today" was
checked against the code and docs on 2026-10-28. Owner of the work in brackets.

## Images and files

| Task | Today | Needed |
|---|---|---|
| Change the cover | On the canvas: hover the cover, Replace / Crop / Alt / Focal / Remove | Post settings still shows a typed path ("2026/03/banner-web-225.jpg"). Make every image field a picker: thumbnail, Replace (upload, drop, paste), **Choose from library**, Crop, alt with the site's fallback note; the path only under "Details" [studio-ui] |
| Change an image in the text | Select it: Replace, crop, caption, alt | Also "Choose from library" [studio-ui] |
| Media library | **Done (cad0c9e): the #/media screen also runs in dev on the dev routes (usage and alt read from the content), reached from the More menu in both modes** | — |
| Replace an image everywhere it is used | **Done (17f244f): plan of every entry and its uses, one commit, live entries rebuilt, put back on a failed deploy** | Undo toast reverting that commit; plan lists title, uses, URL with copy/open [server] |
| Phone photos (HEIC), huge files, PDFs and other downloads | **Done (f5e0558): PDFs stored and downloaded as attachments; 413 with size and limit; HEIC → JPEG when sharp has libheif, else a 415 explaining how to send a JPEG** | Prove HEIC with a real file; stock sharp lacks HEVC (DEPLOY.md) [server] |
| Image alt across the site | Badge per image; title fallback being fixed | Library filter "Without alt text" (done on server) also in dev; bulk alt editing in the library [studio-ui] |

## Writing and finding

| Task | Today | Needed |
|---|---|---|
| Find a post | Cmd+K palette | Dashboard lists with filters in the URL (status, author, topic, updated) [studio-ui] |
| Find and replace across the whole site | **Done (a133444): #/replace previews every place, one commit, each entry checked like a save by that user**. **In the open article, done (2026-10-28)** (find.ts): ⌘F / ⌥⌘F open a find bar under the header; every match marked, "3 of 12", Enter / Shift+Enter step, Match case, Whole word; Replace and Replace all (one ⌘Z), formatting kept; all in the URL (`find=`, `with=`, `rep=1`, `fc=1`, `fw=1`). Proven on a pilot-site article: 23 replacements saved as a diff of only those words, one ⌘Z back byte-identical | Matches inside link targets, image paths, attributes, code and front matter grouped and unticked; field + words of context, not line numbers; Undo [server] |
| Change many posts at once (topic, category, author, unpublish) | **Done (a133444): #/bulk sets a field, adds/removes a tag, unpublishes or trashes, with a before/after summary** | Bulk select in the editor lists opening #/bulk?items=… [studio-ui] |
| New post, duplicate, from a template | Server API has them; editor sheet pending | New post sheet asking only what the schema needs (queued) [studio-ui] |
| Delete and undo a delete | **Done (eec7686): #/trash restores as a draft; administrators delete for good; links-in API** | Old URL with copy/open, links-in shown before delete for good, search, empty state [server] |

## Publishing and the live site

| Task | Today | Needed |
|---|---|---|
| Know what is live vs only saved | **Done (cad0c9e, e9a087d): dev mode shows "Not live yet" and, after the first save, "Saved on this computer, not live yet. It goes live when the site is published." (editor.goLive)** | — |
| Publish, schedule, unpublish | **Done (beac6cc): missed scheduled times run at the next start and say how late; an entry the publish rules stop goes back to draft and editors are told** | — |
| A publish failed | **Done (beac6cc, 6e7641b): "For you" notice to whoever started it until seen, notices bar under the editor header; webhook and Slack hooks** | Email over SMTP (owner chose Email + Slack + banner) [server] |
| Undo a bad release | **Done (36e5297): POST /site/rollback, administrators only, audited, button on Site health** | — |
| CDN cache after publish | No | Optional purge hook (Cloudflare etc.) after deploy [server] |
| Redirects | **Done on the server and admin (8939de9): #/redirects lists, adds, removes and tests hop by hop on the site's own address; loops, chains, never-runs, missing targets and duplicates flagged; moves repoint chains** | the pilot site's redirect hook answers list and remove [site-content] |
| Edit the page I am looking at on the site | **Done (2026-10-28): opt-in `editButton` puts "Edit this page" in a corner of every built page for people signed in to Markstage only (a cookie whose hash the page checks; https or loopback); it opens that page's entry, or "Not available to you" / "No entry has this address". A bookmarklet does the same on any site (account menu, "Edit button on your site"). On the pilot site: +795 bytes per page (about 440 gzipped), a visitor's requests and Lighthouse unchanged; the link covers nothing of the rail, and the open mobile menu covers the link** (docs/API-EDIT.md) | — |
| See every kind of section the site has | **Done (2026-10-28): Library, "Section gallery" (`#/gallery`): each section type and variation drawn alone by the site's own components at 1440 and 390, light or dark, from the first page that uses it (with copy and open on its address, and Edit it there) or with sample words; all in the URL. Its throwaway pages live only in the preview's private clone, which cannot push. On the pilot site: 25 samples** | — |
| Put several changes live together, now or at a time | **Done (2026-10-29): Releases (`#/releases`). More → "Add to a release…" puts a page in, with the editor's unsaved changes, which leave the editor and never touch the site; a Library item's change goes in from the Library (a synced one is refused, in the server's words). A release's page shows the rules' answer in words, approvals, its preview (and in words when the site or the release moved on since it was built), Publish now, Schedule… / Unschedule, and Roll back… once live; each panel and tab has its URL. Share it… makes a link for people without an account, shown once with copy and open, never in the editor's URL; views are counted; Turn off ends it. A draft has its own (`#/share/<collection>/<id>`). Proven in a browser: e2e/releases-ui.e2e.mjs** (docs/API-RELEASES.md) | — |

## People, access and safety

| Task | Today | Needed |
|---|---|---|
| Invite, roles, 2FA, sessions | Done (admin screens) | — |
| Two people on one post | **Done on the server (656ec09): heartbeat presence and an advisory lock with audited take-over; the publish sheet says who is editing. In the editor, done (2026-10-28)** (presence.ts): a heartbeat every 20 s while an entry is open; a line under the header "Olive Owner is editing this (since 15:31)" with Take over; "You have this open in another tab as well" with Edit here; the one taken over from hears "Edna Editor took over editing this at 15:31" with Take it back / OK. Opening another entry or closing the tab lets go at once. Proven with two people in two browsers on a local server | Who is reading (not editing) in the lists [studio-ui] |
| Session ends mid-edit | **Done (0b6fd61): every change kept in a local recovery copy (IndexedDB), offered on reopen; offline saves retry by themselves** | **Sign-in in place, done (2026-10-28)** (signin.ts): with an entry open, a request that finds no session (a save, or the next heartbeat) brings "Sign in again" over the editor, the email filled in, then the two-step code when it is on (that step not yet tried in a browser); once in, the failed save runs again. Esc puts it away (the next request asks again); "Sign in as someone else" goes to the sign-in screen. Proven: typed, session cleared, ⌘S, wrong password refused, right one, saved as one commit by that person [studio-ui] |
| Locked out | **Done (00c8285): Users recommends a second administrator while only one person can manage users; owner reset from a terminal** | — |
| Backups | **Done (656ec09): scheduled db copy + git bundle + config + sha256 manifest, newest N kept, optional ship-off command, "Back up now" and "Last backup" on Site health, restore drill in DEPLOY.md proven by a test** | Owner picks the second place (destination) [owner] |

## Keeping it healthy

| Task | Today | Needed |
|---|---|---|
| Site health | Planned (docs/SEO.md §4) | Status codes, redirects, speed, broken links, disk, last backup, last deploy [server] |
| Updating Markstage itself | **Done (adf0376): version and commit shown, `markstage-server update --check/--to/--rollback`, db copied aside first** | — |
| Help for writers | **Done (2026-10-28)** (help.ts): ? (anywhere but in text) or More → How do I… opens a guide in the right column: 14 tasks in a writer's words, a search over them, steps and keys (each key copyable), "Show me" rings the control it is about; the open topic and the search are in the URL (`side=help&topic=find&hq=replace`). docs/WRITING.md is the same topics as a page, written by `npm run guide` (`--check` tells when it is behind) | Screenshots in the guide and in WRITING.md; topics for the dashboard screens (media, menus, history) when those are on the server [studio-ui] |
| Look and feel (light/dark) | **Done: site dark mode with a Light/Dark/System switch (site-content, approved 2026-10-28); editor follows it via the `themes` config** | — |
| Numbers in tables (owner, 2026-10-28) | **Done (2026-10-28)** (numeric.ts, num-columns.ts): in every table of the editor and admin screens a column whose filled cells are all numbers (counts, money, %, sizes, durations, "3 of 12") is right-aligned, its header too, with tabular figures; text, dates, addresses, phones and IPs stay left. Found from the cells as a table appears or changes, so no screen marks its own (Inbox, Site health, Alerts, Categories and tags, Users, Audit, Redirects, Trash included); the canvas is left alone. Guard: test/numeric.test.ts. Proven on Site health (Words) and Categories and tags (Entries, Live) | — |

## Order, move, delete and hierarchy (owner, 2026-10-28)

"Think of all such use cases where you need to reorder, shuffle, bring up and down, drag and drop, delete, edit, also
hierarchy tree … wherever you need, make sure that you add that."

One interaction model everywhere, so a writer learns it once:
- **Drag** by a grip (⋮⋮) that shows on hover and focus, with a drop line, auto-scroll near edges, and Escape to cancel.
- **Keyboard**: Alt+↑ / Alt+↓ moves the focused item; Alt+→ / Alt+← indents / outdents in a tree; Delete removes
  (with Undo in a toast, never a confirm dialog for one item); Cmd+D duplicates.
- **Menu** on the grip: Move up, Move down, Move to top/bottom, Move to… (a picker, for long lists and other
  parents), Duplicate, Delete.
- **Bulk**: shift/cmd-click to select several, then move or delete together.
- Every move is one undo step and one surgical save; screen readers hear "moved to position 3 of 8".

Where it applies, checked against the code on 2026-10-28:

| Where | Today | Needed |
|---|---|---|
| Blocks in an article | **Done (2026-10-28)**: Alt+↑/↓ on the canvas moves the block the caret is in, or every block the selection spans (packages/editor/src/blocks.ts); the grip menu has only the moves that apply (up, down, to the top, to the bottom, Move to…), Duplicate, and Delete with Undo; the **Outline** (header button, `?side=outline`, outline.ts) lists every block on the order component: drag, Alt+↑/↓, Move to…, ⌘/Shift-click several, Delete with Undo, ⌘D. Since 2026-10-28 it is grouped: the opening blocks, then each H2 (or H1) with its section under it; moving or deleting an H2 takes its section along (the grip menu says so, with the count), a heading stays at the top level after the opening blocks, and a section holding a move-locked box (the FAQ) can't move. A section folds (its arrow, ←/→, `fold=2,5` in the URL) and "Headings only" (`heads=1`) hides the other blocks, which then move with the heading above them (proven on a pilot-site article: section up, to the top, to the bottom, a drag into another section, an H3 under Headings only; each exact and undone by one ⌘Z) Each move is one transaction (one ⌘Z) and saves as a diff of only that move; moving back is byte-identical (proven on a pilot-site article) | — |
| Items inside a box (FAQ questions, steps, pros/cons, takeaways, stats, cards) | Panel: up / down / remove. **On the canvas, done (2026-10-28)**: the block handle is on the item under the pointer (a list item, an FAQ question, a fact card; near the box's left edge, the box) with the same grip menu and drag; Alt+↑/↓ moves the item the caret is in (blocks.ts); a box's fixed order is kept (pros before cons). Proven on a pilot-site FAQ and list: diff of only the move, back byte-identical. **In the panel, done (2026-10-28)**: rows kept in an attribute (stat figures, layout cards) and a box's own items (`ctx.items`: FAQ questions, fact cards) are on the order component (panel-items.ts): drag, Alt+↑/↓, Move to…, Add one after, Duplicate, Delete with Undo, ⌘/Shift-click several; a box keeps at least one item, and says so | Drag in the panel **and on the canvas**, duplicate, add between any two, keyboard [studio-ui] |
| Table rows and columns | Add / delete row and column. **Done (2026-10-28)** (tables.ts): Alt+↑/↓ in a cell moves its row; the table menu adds Move row up / down, Move column left / right, Duplicate row, Sort by this column A to Z / Z to A; the header row stays on top (rows move under it, a sort leaves it, it has no copy); each one transaction (one ⌘Z). Proven on a pilot-site table: diff of only the change, back byte-identical | Drag a row by a grip [studio-ui] |
| Nested lists | Indent via Tab. **Done (2026-10-28)**: a list item has its own handle (drag takes its children along) and its grip menu adds Indent (inside the one above) and Outdent; Alt+↑/↓ moves it among its own. Alt+→/← stay word jumps in text (Tab / Shift+Tab indent and outdent there). Proven on a pilot-site list: indent then outdent is byte-identical | — |
| Page sections | **Done (eaba624): sections and panel lists on the shared order component** | — |
| Lists in page fields (cards, logos, credentials, testimonials, use cases) | **Done (eaba624): on the shared order component** | — |
| **Site menus** (main nav, Services dropdown, footer links) | **Done: menus are content (3fe0bf9, src/content/navigation/main.json, items point at a page so moves never break them) and the Menus screen (143624c) on the order component** | Real-file proof in the editor once the studio config names the collection [studio-ui] |
| **Page hierarchy** (about-us → certifications; hubs and their page-lists) | `group` and an `order` number typed per page | A **Pages tree** screen: drag to reorder and to change parent; the parent change is a move (URL + redirects); `order` written for you [studio-ui + server move route] **Server route done (57ec6b6): POST /site/move, up to 200 moves in one commit with links and redirects. Page tree screen done (2026-10-28)** (`#/tree/<collection>`, packages/editor/src/pages-tree/): each page under the page its address starts with, the pages a page lists in groups under a row per group (`group`), in their `order`; drag, Alt+↑/↓, Move to…, ⌘/Shift-click several; a move writes `order` (and `group` when it lands in another group) only for the pages whose number changes, in one commit, with Undo; the open grip menu is in the URL. Proven on a local server: a move is a diff of only the changed numbers, moving back is byte-identical; the pilot site's tree (42 pages, the /data-migration/ groups) draws in astro dev, where a move says it needs the server. Still to come: moving a page under another page (a new address), which waits for the server to take a new `uri` on a site whose address is that one field [markstage-server] |
| Topic clusters (pillar → articles) | `cluster` per post; order by date | **Done (2026-10-28): the Groups screen, `#/groups/<collection>?g=&menu=&moveto=&move=&to=` (config `groups`, packages/editor/src/groups/).** A cluster's articles in its hub's order (the cluster's `order`, then newest first, as the site's hubOrder reads it); drag, Alt+↑/↓ or the grip menu save `order` (what is above the moved one keeps its place), with Undo; Back to newest first; Move to another topic… is a `site/move` dry run (new address, redirects, links that follow), then one commit, and the article leaves the old order. The server decides the rights and its refusal is shown in its words. Proven by packages/server/e2e/groups.e2e.mjs (4 browser tests) and on a scratch clone of the pilot site: the editor's list matched the built hub before any change; after a reorder and a move, the hub's cards, its ItemList and its .md twin all follow the new order, the moved article is on its new hub with its canonical and 15 linking entries rewritten. Open: the pilot site has no redirects hook, so a move writes no redirect there (the move drawer says so); the article's stored JSON-LD keeps its old `@id`s [studio-ui + site-content] |
| Categories, tags, authors | Edited as text in each post | **Done (8f1218e): #/taxonomy, rename everywhere (a used name merges), delete with reassignment, one commit with Undo.** Order is site-specific, not built [server + studio-ui] |
| Gallery images | — | Drag to reorder inside the gallery block [studio-ui] |
| Media library | Grid with folders by year/month; delete unused one at a time | **Done (39d9e4a): select many on "Not used", delete in one commit with Undo.** Move to another folder is left out: moving a used file is Replace everywhere [server] |
| Library (templates, sections, snippets) | Server store (1 of 3) in 9af5cc0 | **In progress (2026-10-28)**. Built and proven on a local server (real routes, not mocks): `#/library?q=&kind=&synced=1&folder=&tag=&open=&pick=&import=1&step=&src=&arrange=1` (packages/editor/src/reusable/), kinds as filters, folders, a card per item, a drawer with the pages that use a synced item (copy/open), its file's commit history, Duplicate and Delete; grip → Save section to Library… and More → Save … to Library… (name, folder, section or snippet, Synced, Everyone); a synced save lists `{id, version}` in the entry's `synced` frontmatter and the server's stamped version comes back as saved; More → Save page as template… for articles (blocks + settings) and pages (sections, read as saved), never the address, `order`, dates, author or a canonical; New → Start from (Blank or a template, `#/new/<collection>?template=<id>`), and a page made from a page template with its own Address; the Library beside the canvas (`?side=library&lq=&lk=`) with drag between blocks, a drop line and one ⌘Z, Enter to put one after the caret; the + and / menus list the Library; `#/snippets` now opens `#/library?kind=snippet`. A synced copy on an article has a "Synced: <name>" pill (placed where it covers no text) and asks before a change: Edit on N pages (Apply writes every page in one commit) or Detach here; an author gets neither on an item an editor locked (the server answers 403). Import… is a dry run first, then one commit: a pack (round trip proven byte-identical, a picture included; the same pack again is skipped as already here), parts of a public web page (into `Imported`), media in bulk from a zip or addresses (a job; private and non-web addresses named). Arrange (`arrange=1&menu=&moveto=`) puts the whole Library in order with the order component: drag, Alt+↑/↓, Move to… a folder, Undo; items someone may not change stay locked (the old Snippets screen is gone). A card's picture: Add a picture… in the drawer (any image made a PNG under 200 KB), Remove picture. the pilot site's seeds are in its repo (markstage/library/: 3 page templates, 4 article templates, 7 sections), made through the real routes; a page from each, made through New's route on a server over a scratch clone, passes entry_validate, and built, the pages pass schema_check (posts wait for the site's JSON-LD for posts without a stored Rank Math node; pages need the site's `newEntry` for `modified` and the canonical, proven in the clone and handed to site-content). Library sections in the pages editor (pages/outline.ts, pages/library.ts, 2026-10-28): Add section's picker has a "From the Library" group (the page collection's sections of this page's kinds): a click or Enter adds a copy, or drag it into the list (a drop line; ⌘Z, now bound in the pages editor, takes it back); a synced copy's row has a Synced pill beside its Locked one; its panel says where it comes from and on how many pages, and once changed offers Apply to N pages (this page's other changes saved first, then the item and every copy in one commit), Undo my changes and Detach here; a save that changes a copy in place gets the server's words in the banner with Show it and Detach and save. The #/library bar: "Search the Library", Synced as a toggle chip with its count, Export pack with an icon like Import. Proven in the suite's browser test packages/server/e2e/library.e2e.mjs (5 tests, real server, site-shaped pages from core's fixtures): URL state with reload and Back; a pack exported, an item deleted and imported back byte for byte; a WordPress file into "Imported"; the canvas panel's drag, ⌘Z and Enter; the picker by keyboard and by drag; an edit applied to 2 pages in one commit; a refused save, Detach and save; a locked item's copy shows Locked. A section's lock inside its value (`value._lock`, as the editor and Keystatic keep it) binds since 53707c6. Onto the page itself (pages/canvas-drop.ts, place.ts, places.ts, 2026-10-29): a Library section dragged from the picker over the live page shows a line between two sections that says where it lands (the page agent says where its sections are drawn and scrolls near the edges: page:track, page:rects, page:scroll), and every way in (a click, Enter, the outline, the page, Insert… with a place chosen by name, `ins=<item>` in the URL) goes through one path: the copy is saved at once and the page drawn with it, Undo on the note puts the file back byte for byte (the modified date too), and a save the server refuses takes it out again with its words. A section locked by the site or an editor takes no drop in its middle, a page whose `_lock` has layout or edit takes none; both say why. Proven by packages/server/e2e/canvas-drop.e2e.mjs (5 tests) and on the pilot site's /about-us/ on a scratch clone. The pages preview loads in the editor's frame through the sign-in chain (preview → preview-auth → preview-enter → the page, measured in a browser); an earlier 401 came from fetching the frame's address outside the page, with no cookie [studio-ui] |
| Redirects | **Done (8939de9): the Redirects screen lists them with change and remove** | — |
| Dashboard lists | — | Sort by any column; pinned/featured posts dragged into the homepage order if the site has one [studio-ui] |

Proof for every row: a Playwright test that moves an item, saves, and shows the file changed only by that move; then
moves it back and shows the file byte-identical to before.

## Locks (owner, 2026-10-28)

"Ability to lock, unlock certain sections so you don't delete that or move them." WordPress has block locking
(move / remove) and template locks; Markstage does the same on articles and pages.

- **Three lock levels**, combinable: *can't move*, *can't delete*, *can't edit* (content lock). Plus two whole-entry
  locks: *layout locked* (text editable, blocks/sections can't be added, removed or reordered) and *read-only*.
- **Who**: Owner, Administrator and Editor lock and unlock; Authors and Contributors see a lock badge with "Locked by
  <name>: can't be moved or deleted" and the grip menu hides those actions (shown greyed with the reason).
- **Where it is stored**, so it survives in git and is generic:
  - pages (JSON): a `_lock` key on the section or list item (`{move, remove, edit}`), ignored by the site and by
    Keystatic (fields.ignored, like `protected`); entry locks as top-level `_lock`.
  - articles (Markdown): boxes carry `data-lock="move remove"` on their HTML; other blocks are locked by heading
    section in frontmatter (`locks: [{heading: "Frequently asked questions", move: true, remove: true}]`), because a
    plain paragraph has nowhere to hold an attribute.
  - site rules in config (`locks: {pages: {credentials: ['move','remove']}, articles: {faq: ['remove']}}`), for
    things that must always stay, shown as "Locked by the site".
- **Enforced on the server**, not only hidden in the UI: core compares the saved document with the stored one, and a
  save that moves, removes or edits a locked block is refused (`423 locked`, with which block), for every role
  except an unlock first by someone allowed. Audit-logged.
- **Moves around locks**: dragging other blocks past a locked one is allowed (it keeps its place relative to its
  neighbours unless move-locked items are fixed to an index; the order component shows the drop as not allowed).
- **Seen and changed in the editor (owner, 2026-10-28)**. **Articles done (2026-10-28)** (packages/editor/src/
  padlocks.ts, lock-ui.ts, locks.ts, site-settings/):
  - a padlock pill ("Locked", or "Locked by the site") just above the top right corner of every locked box or heading
    section, 26px, always shown to every role, the reason in its tooltip and aria-label ("Locked by the site: can't
    be moved or deleted."); the Outline rows, the pages tree and the snippets list carry the same pill; an open
    padlock ("Lock") shows on hover over a box or heading that can be locked (owner, administrator, editor only);
  - one storage model (2026-10-28): an editor's lock on one box is `data-lock="…"` on that box (the pack's nodes keep
    it as `attrs.lock`, so a box loads and saves byte-identical and an author editing elsewhere changes no lock); the
    front matter `locks: [{box}]` only holds this entry's exception to a site rule; heading sections stay in front
    matter (`locks: [{heading}]`); proven on an article with two callouts, locking only the second;
  - a click opens what is locked and by whom; editors and up get "Can't be moved / deleted / changed" switches and
    Unlock, or "Unlock on this page" for a site rule (kept in the article as `locks: [{box: faq, move: false,
    remove: false, by, at}]`, only the parts that differ from the rule; "Lock again (the site's rule)" takes the entry
    off, so the file is byte-identical), plus "Change the rule for every page" (Settings → Locks) for owner and
    administrator; authors and contributors read the reason and "Ask an editor to unlock it"; it is saved with the
    page (⌘S); the open popover is in the URL (`lock=<block>`), Esc returns to the padlock;
  - the grip menu has Lock… / Unlock… for the same roles; a block locked against edits can't be typed in;
  - **Settings → Locks** (`#/settings/locks?kind=articles&type=faq`, owner and administrator, in the rail and the
    More menu): the site rules as a list, a row per box and section type with its three switches, Save / Discard,
    leaving with changes asks first. It reads and writes the server's `GET / PUT site/locks` (proven on a local
    server: a rule saved, read back after a reload, and taken off again); in astro dev it shows the config's rules
    read only. Another role opening the link reads "Not available to you".
  - page sections (pages/outline.ts, 2026-10-28): the same pill on its own line under the section's title, the same
    popover (`?lock=<section>`), "Unlock on this page" writes `sections.<i>.value._lock: {move: false, …}` and "Lock
    again" removes it (proven on the pilot site's home hero: the file came back byte-identical apart from the site's
    `modified` stamp); the site rules are read from `GET site/locks` (at most once a minute).

## Never lose typing (found 2026-10-28 by testing)

Tested in Chromium on the dev editor: offline save keeps the text and says "Not saved / Saving failed"; reload with
unsaved work asks first; two tabs give a conflict banner. Two failures:
1. **Closing or crashing the tab loses unsaved text**: nothing is kept locally (only `markstage.recent` in storage);
   the server's autosave runs at most every 5 minutes. Needed: every change also goes to a local recovery copy
   (IndexedDB, per entry and version), offered on reopen ("Unsaved changes from 12:41: Restore / Discard"), in dev
   and server mode; offline saves retry by themselves when the connection is back. [studio-ui]
2. **The conflict banner throws work away**: "Your changes were not saved… Reload… your unsaved changes will be lost"
   even when the two people changed different paragraphs. Needed: a block-level three-way merge (base, mine, theirs):
   different blocks merge automatically ("Merged with Olive's changes"); the same block shows both side by side to
   pick or combine. Pages already offer "Save mine on top"; articles get the merge. [core + studio-ui]

## Messages and alerts, all in one place (owner, 2026-10-28)

"I need all that under one" and "a way to fully set up what alerts one needs". One mail account sends everything,
one Inbox holds every message, and every person chooses what reaches them.

**Site forms, served by Markstage** (no WordPress left behind the site) [server + studio-ui + site]
- A generic form route: `POST /forms/<id>`, with fields, required fields and limits in config `forms`. It replaces
  the WordPress route the pilot site's contact form posts to (`/wp-json/form/v1/store-contact-form-data/`).
  It keeps everything that route did:
  - the same fields: name, email, phone with country code, message, service type, how soon, budget, page URL;
  - referrer, landing page, UTM source and medium;
  - an approximate location from the IP;
  - the daily limit per visitor.
- Done safely:
  - the IP is the connection's (trusted proxy header only), never a value the browser sends;
  - no SQL;
  - a honeypot field and a minimum fill time, no CAPTCHA;
  - the form's origin is checked;
  - the data is stored outside git, with a retention period in config.
- Mail: a thank-you reply to the visitor (text in config, editable in Settings) and a "New message" alert to the team.
- History: an import of the old `wp_contact` table from the 2026-10-27 backup, so the Inbox starts with every past
  message.

**In the editor, built (2026-10-28), waiting on the server's routes** (packages/editor/src/inbox/, site-settings/alerts.ts,
my-alerts.ts): Inbox in the rail (editor and up), Settings → Alerts next to Locks (owner, administrator), My alerts
in each person's menu. Each says "Not on this server yet" until the server answers `GET inbox`, `site/alerts` and
`me/alerts` (shapes proposed to the server, docs/API.md once agreed). Tried in a browser against stand-in answers
only: filters and the open item in the URL, every value copyable, handled / spam / assign / note with a stale-version
answer, Send a test per channel, who gets each kind, safety alerts always on.

**Inbox** (`#/inbox`) [studio-ui]
- Every form message, newest first, with search and filters (form, service, status, date) in the URL.
- Open one in a drawer, with every value copyable.
- Mark it handled or spam, add a note, assign it to a person; CSV export.
- Alerts and notices appear in the same Inbox under their own filter.

**Alerts, set up fully** (Settings → Alerts, `#/settings/alerts`) [server + studio-ui]
- **Channels:**
  - email: the account's status and the sender name ("Example Co Site");
  - Slack;
  - webhook;
  - each with Send a test alert.
  - Secrets still come only from the environment or files outside the repo, as today.
- **Every alert kind as a row:**
  - new form message;
  - publish failed;
  - deploy failed;
  - backup failed;
  - scheduled entry held;
  - scheduled entry late;
  - site rolled back;
  - site health found a broken page or link;
  - a lock changed;
  - a user was invited or a role changed;
  - a sign-in from a new device.
  For each kind: on or off, who gets it (roles and named people, plus extra addresses such as a sales inbox), and
  which channels it uses.
- **My alerts,** for each person:
  - opt in or out of each kind they are allowed to receive;
  - email now, a daily digest, or the editor only;
  - safety alerts (a failed backup, a sign-in from a new device to their own account) can't be turned off.
- **Mail names the site, not the engine:** the subject reads "Example Co: …"; Markstage is only the default.
- **Audit:** every settings change is audited. Site rules live in a data file the server writes, not in code.
