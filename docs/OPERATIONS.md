# Running a site with Markstage: every operational task, end to end

How to do each everyday task of running a site, from the editor. The aim for each one: a writer or site owner with no
technical background can do it **from the editor**, with no terminal, no file paths and no developer, and it works
the same in dev (`astro dev`) and on the server, unless a row says otherwise. Where a task is not built yet, the row
says so. The writer's own guide, with the keys, is [WRITING.md](WRITING.md).

## Images and files

| Task | How |
|---|---|
| Change the cover | On the canvas: hover the cover, then Replace, Crop, Alt, Focal point or Remove. |
| Change an image in the text | Select it: Replace, crop, caption, alt. |
| Media library | The Media screen (`#/media`, also in the More menu), in dev and on the server: every file with where it is used and its alt text. |
| Replace an image everywhere it is used | From the media library: a plan lists every entry and each use, then one commit makes the change; live entries are rebuilt, and a failed deploy puts it back. |
| Phone photos (HEIC), huge files, PDFs and other downloads | PDFs are stored and downloaded as attachments. A file over the limit is refused with its size and the limit. HEIC becomes JPEG when the server's `sharp` has HEIC support; otherwise the answer says how to send a JPEG instead ([DEPLOY.md](DEPLOY.md)). |
| Image alt across the site | A badge on each image without alt text, and a "Without alt text" filter in the media library. |

## Writing and finding

| Task | How |
|---|---|
| Find a post | ⌘K opens the palette; the lists have filters (status, author, topic, updated) kept in the address. |
| Find and replace across the whole site | The Replace screen (`#/replace`) previews every place first, then makes one commit; each entry is checked like a save by that person. |
| Find and replace in the open article | ⌘F (find) or ⌥⌘F (replace) opens a bar under the header: every match marked, "3 of 12", Enter and Shift+Enter to step, Match case, Whole word; Replace and Replace all (one ⌘Z), formatting kept. It is all in the address (`find=`, `with=`, `rep=1`, `fc=1`, `fw=1`). A save is a diff of only the replaced words. |
| Change many posts at once (topic, category, author, unpublish) | The Bulk screen (`#/bulk`) sets a field, adds or removes a tag, unpublishes or moves to trash, with a before and after summary. |
| New post, duplicate, from a template | New → Start from: Blank or a template from the Library. |
| Delete and undo a delete | Deleted entries go to Trash (`#/trash`), which restores them as drafts; administrators delete for good. |

## Publishing and the live site

| Task | How |
|---|---|
| Know what is live and what is only saved | Each entry says "Not live yet" until it is published. In dev mode, after the first save: "Saved on this computer, not live yet. It goes live when the site is published." |
| Publish, schedule, unpublish | From the publish sheet. A scheduled time missed while the server was down runs at the next start and says how late. An entry the publish rules stop goes back to draft, and its editors are told. |
| A publish failed | A notice for whoever started it, shown until they have seen it, in the notices bar under the editor's header; plus email, Slack or a webhook as set in Settings → Alerts. |
| Undo a bad release of the site | Site health → "Roll back to the release before" (administrators only, audited). |
| CDN cache after publish | An optional purge command runs after each deploy with the changed addresses ([DEPLOY.md](DEPLOY.md)). |
| Redirects | The Redirects screen (`#/redirects`) lists, adds, removes and tests them hop by hop on the site's own address; loops, chains, rules that never run, missing targets and duplicates are flagged, and a move repoints chains. Changing a site's redirects needs the site's redirects hook. |
| Edit the page I am looking at on the site | An opt-in "Edit this page" link in a corner of every built page, only for people signed in to Markstage (`editButton`, [API-EDIT.md](API-EDIT.md)); it opens that page's entry. A bookmarklet does the same on any site (account menu → "Edit button on your site"). Visitors download a few hundred bytes more and nothing else changes for them. |
| See every kind of section the site has | Library → Section gallery (`#/gallery`): each section type and variation drawn alone by the site's own components at 1440 and 390, light or dark, from the first page that uses it or with sample words. |
| Put several changes live together, now or at a time | Releases (`#/releases`): More → "Add to a release…" puts a page in, with its unsaved changes. A release shows the rules' answer in words, approvals, its preview, Publish now, Schedule…, and Roll back… once live. Share it… makes a link for people without an account ([API-RELEASES.md](API-RELEASES.md)). |

## People, access and safety

| Task | How |
|---|---|
| Invite, roles, 2FA, sessions | The Users screen: invite, give a role, require two-step sign-in, sign out a session. |
| Two people on one post | While an entry is open, a line under the header says who else is editing it ("Olive Owner is editing this (since 15:31)") with Take over; the person taken over from is told, with Take it back. A second tab of your own says so too. Saves by two people merge block by block (see "Never lose typing"). |
| Session ends mid-edit | Every change is also kept in a local recovery copy in the browser, offered when the entry is opened again; saves made offline retry by themselves. A request that finds no session brings "Sign in again" over the editor, and once signed in, the failed save runs again. |
| Locked out | An owner or administrator resets anyone below them from Users; Users recommends a second administrator while only one person can manage users. The owner can also be reset from a terminal on the server. |
| Backups | Scheduled: a copy of the database, a git bundle, the config and a checksum manifest, the newest N kept, with an optional command to ship them off the server. "Back up now" and "Last backup" are on Site health; the restore drill is in [DEPLOY.md](DEPLOY.md). |

## Keeping it healthy

| Task | How |
|---|---|
| Site health | The Site health screen: last deploy and backup, forms that can or cannot send, and the checks the server runs ([DEPLOY.md](DEPLOY.md)). |
| Updating Markstage itself | The running version and commit are shown in your account menu; `markstage-server update --check`, `--to` and `--rollback` in a terminal, with the database copied aside first. |
| Help for writers | ? (anywhere but in text) or More → How do I… opens a guide in the right column: tasks in a writer's words, a search, steps and keys, and "Show me", which rings the control it is about. [WRITING.md](WRITING.md) is the same guide as a page. |
| Look and feel (light and dark) | The editor follows the site's own Light, Dark or System switch through the `themes` config. |
| Numbers in tables | In every table of the editor and its screens, a column of numbers (counts, money, %, sizes, durations, "3 of 12") is right-aligned with tabular figures; text, dates, addresses, phones and IPs stay left. |

## Order, move, delete and hierarchy

One way to reorder things everywhere, so a writer learns it once:
- **Drag** by a grip (⋮⋮) that shows on hover and focus, with a drop line, auto-scroll near edges, and Escape to cancel.
- **Keyboard**: Alt+↑ / Alt+↓ moves the focused item; in a tree, Alt+→ / Alt+← indents and outdents; Delete removes
  (with Undo in a note, never a confirm dialog for one item); ⌘D duplicates.
- **Menu** on the grip: Move up, Move down, Move to top or bottom, Move to… (a picker, for long lists and other
  parents), Duplicate, Delete.
- **Several at once**: ⌘-click or Shift-click to select several, then move or delete them together.
- Every move is one undo step and one surgical save; screen readers hear "moved to position 3 of 8".

| Where | How |
|---|---|
| Blocks in an article | On the canvas, Alt+↑/↓ moves the block the caret is in, or every block the selection spans; the grip menu has the moves that apply, Duplicate, and Delete with Undo. The **Outline** (header button, `?side=outline`) lists every block, grouped by heading: moving or deleting a heading takes its section along, a section folds (`fold=2,5` in the address) and "Headings only" (`heads=1`) hides the rest. A section holding a move-locked box stays put. Each move is one ⌘Z and saves as a diff of only that move; moving back is byte-identical. |
| Items inside a box (FAQ questions, steps, pros and cons, takeaways, stats, cards) | On the canvas, the grip is on the item under the pointer, with the same menu and drag; Alt+↑/↓ moves the item the caret is in. In the side panel: drag, Alt+↑/↓, Move to…, Add one after, Duplicate, Delete with Undo. A box keeps its fixed order (pros before cons) and at least one item. |
| Table rows and columns | Alt+↑/↓ in a cell moves its row; the table menu has Move row up or down, Move column left or right, Duplicate row, and Sort by this column; the header row stays on top. |
| Nested lists | A list item has its own grip (a drag takes its children along) with Indent and Outdent; Tab and Shift+Tab indent and outdent while typing. |
| Page sections, and lists in page fields (cards, logos, credentials, testimonials, use cases) | The same grip, keys and menu in the page outline and the side panel. |
| Site menus (main navigation, dropdowns, footer links) | The Menus screen. Menus are content files whose items point at a page, so moving a page never breaks them. |
| Page hierarchy (sections and their pages, hubs and their page lists) | The Pages tree (`#/tree/<collection>`): each page under the page its address starts with, grouped and in order; drag, Alt+↑/↓ or Move to… write the order numbers that change, in one commit, with Undo. Moving many pages with their links and redirects is one server route (up to 200 moves in one commit). Moving a page under another page in the tree (a new address) is not built yet. |
| Topic clusters (a pillar page and its articles) | The Groups screen (`#/groups/<collection>`, config `groups`): a cluster's articles in its hub's order; drag, Alt+↑/↓ or the grip menu save the order, with Undo. Move to another topic… shows a dry run (new address, redirects, links that follow), then makes one commit. |
| Categories, tags, authors | The Categories and tags screen (`#/taxonomy`): rename everywhere (a name already in use merges), delete with reassignment, one commit with Undo. |
| Media library | Select many on "Not used" and delete them in one commit, with Undo. To move a file that is in use, use Replace everywhere. |
| Library (templates, sections, snippets) | `#/library`: kinds as filters, folders, a card per item, and a drawer with the pages that use a synced item. Save a section or a whole page to the Library; start a new entry from a template; drag a Library section into an article, the page outline or onto the page itself, where a line shows where it lands. A synced item changed on one page offers Apply to N pages (one commit), Undo my changes, or Detach here. Import… takes a pack, parts of a web page, a WordPress file or media in bulk, as a dry run first. Arrange (`arrange=1`) puts the whole Library in order ([API-LIBRARY.md](API-LIBRARY.md)). |
| Redirects | The Redirects screen lists them with change and remove. |
| Gallery images, dashboard sorting | Not built yet: dragging images inside a gallery block, and sorting the dashboard lists by any column. |

Every move is tested the same way: a browser test moves an item, saves, and shows the file changed only by that move;
then moves it back and shows the file byte-identical to before.

## Locks

Some sections must not be deleted or moved by accident (a legal notice, the FAQ, the contact block). Like
WordPress's block locking, Markstage locks parts of articles and pages.

- **Three lock levels**, combinable: *can't move*, *can't delete*, *can't edit*. Plus two whole-entry locks:
  *layout locked* (text editable, but blocks and sections can't be added, removed or reordered) and *read-only*.
- **Who**: the Owner, Administrators and Editors lock and unlock; Authors and Contributors see a lock badge with
  "Locked by <name>: can't be moved or deleted", and the grip menu shows those actions greyed with the reason.
- **Where it is stored**, so it lives in git with the content:
  - pages (JSON): a `_lock` key on the section or list item (`{move, remove, edit}`), ignored by the site and by
    Keystatic (`fields.ignored`, like `protected`); whole-entry locks as a top-level `_lock`;
  - articles (Markdown): a box carries `data-lock="move remove"` on its HTML; other blocks are locked by heading
    section in the front matter (`locks: [{heading: "Frequently asked questions", move: true, remove: true}]`),
    because a plain paragraph has nowhere to hold an attribute;
  - site rules in config (`locks: {pages: {credentials: ['move','remove']}, articles: {faq: ['remove']}}`), for
    things that must always stay, shown as "Locked by the site".
- **Enforced on the server**, not only hidden on screen: a save that moves, removes or edits a locked block is
  refused (`423 locked`, naming the block), for every role, until someone allowed unlocks it. Audited.
- **Moving around locks**: other blocks can be dragged past a locked one; the drop line says when a drop is not
  allowed.
- **In the editor**:
  - a padlock pill ("Locked", or "Locked by the site") just above the top right corner of every locked box or
    heading section, shown to every role, with the reason in its tooltip; the Outline, the Pages tree and the
    Library carry the same pill; an open padlock ("Lock") shows on hover for those who may lock;
  - a click opens what is locked and by whom; editors and up get "Can't be moved / deleted / changed" switches and
    Unlock, or "Unlock on this page" for a site rule (only the parts that differ from the rule are kept in the
    entry; "Lock again (the site's rule)" removes them, so the file is byte-identical), plus "Change the rule for
    every page" (Settings → Locks) for the owner and administrators; authors and contributors read the reason and
    "Ask an editor to unlock it". The open popover is in the address (`lock=<block>`);
  - the grip menu has Lock… and Unlock… for the same roles; a block locked against edits can't be typed in;
  - **Settings → Locks** (`#/settings/locks`, owner and administrators): the site rules as a list, a row per box
    and section type with its three switches; in `astro dev` it shows the config's rules read-only;
  - page sections: the same pill under the section's title and the same popover (`?lock=<section>`).

## Never lose typing

- **Every change is kept locally** in a recovery copy in the browser, per entry and version, and offered when the
  entry is opened again ("Unsaved changes from 12:41: Restore / Discard"), in dev and on the server. Saves made
  offline retry by themselves when the connection is back.
- **A save that meets someone else's save merges** block by block (base, mine, theirs): different blocks merge by
  themselves ("Merged with Olive's changes"); the same block shows both side by side to pick or combine.
- Reloading with unsaved work asks first, and a failed save keeps the text and says so in plain words.

## Messages and alerts, all in one place

One mail account sends everything, one Inbox holds every message, and every person chooses what reaches them
([API-INBOX.md](API-INBOX.md)).

**Site forms, served by Markstage**
- A form route, `POST /forms/<id>`, with its fields, required fields and limits in the config's `forms`. It keeps
  what a site's contact form usually needs: the fields the form asks for (name, email, phone, message and any
  others), the referrer, landing page and campaign (UTM), an approximate place from the IP when a city database is
  installed, and a daily limit per visitor.
- Done safely: the IP is the connection's (a trusted proxy header only), never a value the browser sends; a
  honeypot field and a minimum fill time instead of a CAPTCHA; the form's origin is checked; messages are stored
  outside git, with a retention period in config.
- Mail: a thank-you reply to the visitor (its text editable in Settings) and a "New message" alert to the team.
- History: old WordPress contact messages come in from a database dump with
  `markstage-server forms import-wordpress` ([DEPLOY.md](DEPLOY.md), "Forms"), so the Inbox starts with every
  past message.

**Inbox** (`#/inbox`, editors and up)
- Every form message, newest first, with search and filters (form, service, status, date) in the address.
- Open one in a drawer, with every value copyable.
- Mark it handled or spam, add a note, give it to a person; export as CSV.

**Alerts** (Settings → Alerts, `#/settings/alerts`, owner and administrators)
- **Channels:** email (with the sender name, for example "Example Co Site"), Slack and a webhook, each with Send a
  test. Their secrets come only from the environment or files outside the repo.
- **Every alert kind as a row:** a new form message, publish failed, deploy failed, backup failed, a scheduled
  entry held or late, the site rolled back, site health found a broken page or link, a lock changed, a user invited
  or a role changed, a sign-in from a new device. For each kind: on or off, who gets it (roles and named people,
  plus extra addresses such as a sales inbox), and which channels it uses.
- **My alerts**, in each person's menu: opt in or out of each kind they may receive; email now, a daily digest, or
  the editor only. Safety alerts (a failed backup, a sign-in from a new device to their own account) can't be
  turned off.
- **Mail names the site, not the engine:** the subject reads "Example Co: …".
- **Audit:** every settings change is audited. The rules live in a data file the server writes, not in code.
