# The editor for non-technical people: the rulebook

Markstage is used by writers, translators, SEO managers, a manager who reviews, and the site's owner. None of them is
a developer. Every screen is built to the rules below. The writer's
own guide to the screens is [WRITING.md](WRITING.md).

## 1. Principles (think like Google)

1. **One job per screen, one main button.** Home: what do you want to do. A list: find and open. The editor:
   change and save. Go live: see what moves, then go. Nothing else competes with the main button.
2. **Words a person already knows.** The word list in section 3 is binding. No internal word (job, entry,
   collection, revision, promotion, environment, taxonomy, slug, canonical, webhook) reaches the screen without a
   plain word in front of it.
3. **Why, where, what, how, in place.** Every option has one sentence under it: what happens when it changes, with
   an example. "Learn more" opens the help panel on that topic. No option without its sentence.
4. **Progressive disclosure.** The five things most people need are visible. The rest sits behind "More" or
   "Advanced", still searchable, never deleted.
5. **Search finds everything.** The top search finds pages, posts, images, messages, settings and help topics.
6. **Undo, not "Are you sure?".** Do the action, show "Done · Undo" for 8 seconds. Only a delete-for-good keeps a
   confirmation, and it names what is lost.
7. **Empty states teach.** An empty list says what the screen is for and offers the first step.
8. **One pattern everywhere.** Lists, filters, row actions, forms, hints, toasts and drawers look and behave the
   same on every screen (section 4).
9. **Safe by default.** Nothing reaches the public site without a clear "Go live" step and a preview first. Every
   change is kept; "Take back" is always one click away.
10. **Not busy.** Whitespace is content. If a screen needs a legend, it has too much on it.
11. **Checked before shown.** Every new screen or mockup is rendered at desktop and phone width, light and dark,
    and looked at before anyone sees it.

## 2. The shell

- **Top bar:** menu button (folds the drawer to icons; on a phone it slides over the page), product name, one big
  search, Help, your account. Nothing else.
- **The place chip** sits in the top bar on every screen: grey "On my computer", amber "Staging", green "Live site".
  Click: the three places, what is newer where, and the actions "Send to staging for review", "Pull the latest".
- **Drawer:** "Create" button; Home; groups **Content** (Pages, Blog posts, Images & files, Site menus), **Visitors**
  (Messages), **Publishing** (Go live, Scheduled & history), **Site & team** (Site settings, Languages, People &
  access, Site check-up, Backups, Trash, More tools). Publishing and Site & team start folded; the state is
  remembered per person. Counts on the right (pages, posts, unread messages).
- **Home:** greeting; four cards (Edit a page, Write a new post, Read messages, Go live, each with a one-line
  status); Recent (what you touched, with Live/Draft pills); Your site (last went live, drafts not live, last
  backup, site check-up).
- **Release line** `v0.2.0 · build 267 · Nov 2, 2026 12:16 PM EST` at the foot of the drawer.

## 3. The word list (binding)

| Internal | On screen | Internal | On screen |
| --- | --- | --- | --- |
| entries, collection | Pages, Blog posts (one screen per kind) | media | Images & files |
| jobs, publish job | Go live; Scheduled & history | inbox | Messages |
| promotion, promote | Send to staging for review; Go live | environment | Place: On my computer / Staging / Live site |
| pull | Pull the latest | rollback, restore a revision | Take back |
| revisions, history | History (on a page: "Versions") | redirects | Moved addresses |
| audit log | Activity | taxonomy | Categories and tags |
| slug, URL path | Address | canonical | Main address for search engines |
| noindex | Hide from search engines | hreflang, locale | Language |
| draft | Draft | scheduled | Scheduled for … |
| users, roles | People & access | 2FA | Two-step sign-in |
| site health | Site check-up | backups, restore drill | Backups; Restore |
| library, reusable blocks | Reusable sections | topic map, links | Links between pages |
| find and replace, bulk | Change many at once | trash | Trash |
| importer, migration | Import a site | dry run | The plan (nothing is written yet) |

Roles, in plain words: Viewer (looks), Writer (edits own drafts), Translator (one language), Editor (all content,
sends to staging), Manager (approves, goes live, people), Owner (everything, settings, backups).

## 4. Patterns

- **List:** title first and bold; a status pill; language chips (EN ✓ FR –); last edited; one number column at
  most. 50 rows a page from the server; search box; filter chips (status, language, section, author, date, needs
  attention); saved views; tick rows for bulk actions with Undo; one click opens.
- **Needs attention filters:** no description, no title, broken links, images without alt text, not translated,
  translation outdated, thin page, hidden from search engines, scheduled.
- **Form:** label, control, one hint sentence, example value; errors in plain words under the field; Save is the
  only primary button; passwords with the eye and a confirm field (rule 268).
- **Values:** every id, code, email, address and path gets the hover-only copy icon, URLs an open icon (copy rule).
- **Drawer (right side) for details**, the list stays behind; Escape closes; the address keeps the open item.
- **Toast:** "Done · Undo" bottom center, 8 s; errors say what to do next.
- **Empty state:** icon, one sentence, one button.
- **Help panel:** "?" opens on the current topic; the word list is searchable there.

## 5. Places and what moves

- One Git folder holds text, settings, menus, moved addresses, reusable sections, images and files, and the site's
  design. A release is content plus design at one moment. The database (people, sessions, messages), backups and
  secrets stay on each server.
- **Send to staging for review:** picks your changed pages, lists them, one click. The reviewer sees "Sam asks
  you to review 4 pages", comments per page, approves or sends back with a note; the row shows "Approved by Alex,
  Tue 3:10 PM".
- **Go live:** what is approved on staging; the summary says how many pages in which languages, what is blocked
  and why (missing description, broken link, a design block not live yet); now or scheduled.
- **Go live directly:** for the 11 PM typo; marked "skips review", asks one line of reason, writes it to History;
  managers can turn it off per role.
- **Pull the latest:** banner when staging has newer pages; one click; a conflict on one page is shown side by side
  with "keep mine", "take theirs", "merge".
- **Take back:** per page or whole site, from History or from Backups; names the version and the time.
- **Known weak points to verify on real copies:** big media in Git (size rule and unused-file cleanup, or media
  outside Git); a page that needs a design block that is not live yet; moved addresses on bulk moves in every
  language; images coming back on Restore from Trash.

## 6. Git and permissions, for people who never see Git

- People sign in with email and password and a role. The role decides: save, send to staging, approve, go live,
  go live directly, restore, people, settings.
- Every change is a commit with the person's name; History shows it as "Alex changed the title, Tue 3:10 PM".
- One private repository on your git host (for example GitHub). Your computer uses your own login there. Each server has its own deploy key
  (read and write to this one repository only) in the server's locked secrets file; never in the editor or in Git.
- Branches: `staging` (reviewed) and `live` (public); protection so only the servers' keys and the owner write
  to `live`. A key can be withdrawn in one click. A live server's GitHub connection is set up per site.

## 7. Scale (800 pages, 5 languages)

- A page is one row with its language versions as chips; open, switch language at the top; "Create French version"
  with the English beside it, or "Draft a translation".
- Addresses and language tags for search engines are made automatically; a missing language falls back to the
  main one and the list says so.
- Translation board: per language, done / outdated / missing counts; click a count for the list. Outdated means the
  main language changed after the translation.
- Lists page from the server; search is indexed; bulk actions run as a job with a progress line and Undo.

## 8. The audit method (gap analysis)

A matrix, every cell proven on real local copies, not read about:

- Rows (what can move): page text, page settings, images, files, menus, moved addresses, reusable sections,
  translations, categories and tags, authors, design code, site settings, people and roles, messages, backups.
- Columns (operations): create, edit, rename or move, delete, restore, change many, send to staging, go live,
  take back, pull the latest.
- Each cell: what happens today (seen in a test, with paths), what a person expects, the gap, size S/M/L.

The gaps found this way, together with a catalog of everyday situations, feed one fix list, easiest and most
valuable first. Screens are rebuilt in the
order people use them: Home, Pages and Blog posts, the page editor and its top bar, Go live, Messages, Images &
files, Site settings, People & access, Backups, Languages.
