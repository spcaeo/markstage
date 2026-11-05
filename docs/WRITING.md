# Writing with Markstage

<!-- Written by scripts/writer-guide.mjs from packages/editor/src/help-topics.ts: change the topics there, then run
     `npm run guide`. -->

The same guide is inside the editor: press **?** (anywhere but in text) or More (…) → **How do I…**. There each
topic can point at the part of the screen it is about ("Show me"), and the open topic is in the address, so a link
to it opens it.

- [Keyboard shortcuts](#shortcuts)
- [Find an article and open it](#open)
- [Start a new article](#new)
- [Save, and know what is live](#save)
- [Add a heading, an image, a table or a box](#block)
- [Keep blocks and pages to use again (the Library)](#snippet)
- [Put a topic’s articles in order, or move one to another topic](#groups)
- [Put a page in a topic, so pages link to each other](#topics)
- [Link old pages to a new one, and the new one to the right pages](#links)
- [Fix links that are weak or wrong](#link-health)
- [Open the page you are looking at on your site](#edit-button)
- [See every kind of page section your site has](#gallery)
- [Put several changes live together, now or at a time](#releases)
- [Move a block, a list item or a question](#move)
- [Lock or unlock a block](#lock)
- [Make text bold, add a link, a heading or a list](#format)
- [Change the cover, address, excerpt or search title](#settings)
- [Find and replace words](#find)
- [Check the article for search engines](#seo)
- [See it on a phone or a tablet](#phone)
- [Undo a mistake, or get an older version back](#undo)
- [Edit the Markdown file itself](#source)
- [Change a table](#table)
- [Describe, crop or replace an image](#image)
- [See what still needs translating](#translations)
- [Translate the whole site with AI](#translate-site)
- [Get a suggestion from the AI](#ai)

<a id="shortcuts"></a>

## Keyboard shortcuts

1. Press ? anywhere but in text to open this list.
2. On Windows and Linux, ⌘ is Ctrl.

| Keys | |
|---|---|
| `⌘K` | Find and open a page or screen; with text selected, add a link |
| `⌘S` | Save |
| `⌘F` | Find in the article (⌥⌘F with Replace) |
| `/` | On an empty line: add a block |
| `⌘Z / ⇧⌘Z` | Undo / redo |
| `⌘B / ⌘I` | Bold / italic |
| `⌥F10` | With words selected: go to the bar over them (←/→ along it, Esc back) |
| `Enter in the title` | Go to the text |
| `⌥↑ / ⌥↓` | Move the block up or down (Outline) |
| `Esc` | Close the open panel, menu or check |
| `?` | This guide |

<a id="open"></a>

## Find an article and open it

1. Press ⌘K, or click the search box at the top left.
2. Type a few words of its title or its address.
3. Press Enter on the one you want. Your recent ones are listed first.

| Keys | |
|---|---|
| `⌘K` | Find and open |

<a id="new"></a>

## Start a new article

1. Click New at the top.
2. Give it a title, and anything the site asks for (such as its topic).
3. It opens as a draft: nothing goes live until it is published.

<a id="save"></a>

## Save, and know what is live

1. Press ⌘S, or click Save. The dot next to the status turns green.
2. Saved is not live yet: with a Publish button at the top, publish from there; where it says "Not live yet", click it to see how this site goes live.
3. Your typing is also kept in this browser (and nowhere else) as a safety net: a closed tab or a lost connection loses nothing, but clearing the browser’s data does. Save puts it on the server.

| Keys | |
|---|---|
| `⌘S` | Save |

<a id="block"></a>

## Add a heading, an image, a table or a box

1. On an empty line, type / and a few letters of what you want, then Enter.
2. Or point at a line and click the + at its left.
3. Boxes (FAQ, tips, steps…) are drawn as the page shows them; type straight into them.

| Keys | |
|---|---|
| `/` | On an empty line: the block menu |

<a id="snippet"></a>

## Keep blocks and pages to use again (the Library)

1. Click a block’s grip and choose Save section to Library…, or select several blocks and choose Save … to Library… in the More menu. Give it a name and a folder; tick Synced so every page that uses it follows when it changes.
2. To use one, open Library in the header and drag it between two blocks (a line shows where it lands; ⌘Z takes it back), press Enter on it to put it after the block you are in, or type / on an empty line and a few letters of its name.
3. On a page made of sections, the Add section list has a From the Library group: click one, drag it into the outline, or drag it onto the page itself, where a line says where it will land. From the keyboard, choose Insert… under it and pick a place from the list. It is saved at once and the page is drawn with it; Undo on the note takes it out again. A locked section, or a page whose layout is locked, takes none and says why. A synced copy shows Synced; change it on one page, then choose Apply to … pages in the note above it, Undo my changes, or Detach here to keep it as this page’s own.
4. More → Save page as template… keeps the whole page (not its address, dates or author). New → Start from then begins a page from it.
5. More → Library lists everything: filter by kind, folder or tag, put items in order with Arrange, see which pages use a synced item, and export or import packs.

<a id="groups"></a>

## Put a topic’s articles in order, or move one to another topic

1. Open the topics screen in the left bar (named as your site calls them, such as Topics) and choose a topic: its articles show in the order its page lists them.
2. Drag one by its ⋮⋮ grip, or press Alt+↑ or Alt+↓ on it: it and everything above it keep those places; the rest follow, newest first. Undo in the message puts it back.
3. In the grip’s menu, Back to newest first takes away its place; Move to another topic… shows its new address, the redirect and the links that follow before anything changes.

<a id="topics"></a>

## Put a page in a topic, so pages link to each other

1. Click the gear at the top to open the page’s settings. Under Topic and links, pick its topic, its group, and whether it is the topic’s main page or leads its group. It is kept straight away.
2. More → Topic map shows each topic as a board: drag a page from Not in a topic onto a place, or use its Move to… list. Edit topic names the words for links to the main page and its service page.
3. Pages in a topic are listed under More on this topic on the site, group first, so old pages show a new one after the next publish without being edited.

<a id="links"></a>

## Link old pages to a new one, and the new one to the right pages

1. In the page’s settings, Pages to link to lists its main page, its group’s lead and pages next to it, each with the words to link and the sentence they fit in. Link these words links them on the page; ⌘S saves it.
2. Pages that should link here lists sentences on other pages that talk about this one. Accept adds the link on that page (a normal save, published if the page is live); Undo in the message takes it back. Skip hides it for everyone.
3. More → Links → Link inbox collects every open suggestion of the site, grouped by the page they link to. Skipped lists the ones skipped, to bring back.

<a id="link-health"></a>

## Fix links that are weak or wrong

1. More → Links → Health lists what to fix, worst first: pages no page links to, pages with one link in, pages that do not link up to their topic’s main page, the same words used for two pages, vague words such as click here, links to old addresses or hidden pages, and outside links.
2. Pick a topic or a kind to see fewer; the address keeps the view, so a link shares it.
3. A fix button does it in one click (a new address, nofollow or sponsored on an outside link), with Undo in the message. Open at the sentence opens the page where the link is.

<a id="edit-button"></a>

## Open the page you are looking at on your site

1. Sign in here, then open any page of your site in the same browser: an Edit this page link sits in its corner (only you see it; visitors never do). It opens that page here.
2. No link? Open your account menu (your initials at the bottom left) and choose Edit button on your site: it says why, and gives you a bookmark that does the same from any page.

<a id="gallery"></a>

## See every kind of page section your site has

1. Open the Library and choose Section gallery: each section type and variation is drawn alone by your site, at 1440 and 390 pixels wide.
2. Pick a width, Dark, or one type above the list; Whole page shows the page around a section. Each one says which page it comes from, and Edit it there opens that page at that section.

<a id="releases"></a>

## Put several changes live together, now or at a time

1. Make a release under Releases (New release…). Then open a page and choose More → Add to a release…: your unsaved changes go into it, not on the site. A Library item: open it in the Library, change it there, and choose Add to a release….
2. On the release, build the preview to see the site as it will be; Share it… makes a link for people without an account (it is shown once: copy it then).
3. Publish now, or Schedule… a time: everything in it goes live in one go. Once live, Roll back… takes it off again.

<a id="move"></a>

## Move a block, a list item or a question

1. Put the caret in it and press Alt+↑ or Alt+↓.
2. Or point at it and drag the ⋮⋮ grip at its left; the grip’s menu also has Move to the top, to the bottom and Move to….
3. The Outline lists every block, each section under its H2: drag rows there, or select several with ⌘-click. Moving an H2 moves its whole section.
4. Fold a section with its arrow (or ← on its row), or press Headings only to see the headings alone.
5. Every move is one step back with ⌘Z.

| Keys | |
|---|---|
| `Alt+↑ / Alt+↓` | Move up / down |
| `← / →` | Fold / unfold a section (Outline) |
| `⌘Z` | Undo |

<a id="lock"></a>

## Lock or unlock a block

1. A locked box or section shows Locked (or Locked by the site) at its top right; point at it to see why.
2. Click the padlock, or choose Lock… in the grip’s menu, to say what can’t be done: moved, deleted or changed.
3. A lock the site sets on every page can be lifted here with Unlock on this page.
4. Save the page (⌘S) to keep the change. Owners and administrators change the site’s rules in Settings → Locks.

| Keys | |
|---|---|
| `Esc` | Close the padlock’s box |

<a id="format"></a>

## Make text bold, add a link, a heading or a list

1. Select the words: a small bar appears above them.
2. Click a button, or press ⌘B, ⌘I, ⌘K (link).
3. In the link field, search the site’s pages or paste an address. Below it: New tab, Nofollow, Sponsored, User content.

| Keys | |
|---|---|
| `⌘B` | Bold |
| `⌘I` | Italic |
| `⌘K` | Link (with words selected) |

<a id="settings"></a>

## Change the cover, address, excerpt or search title

1. Click the gear at the top.
2. Change what you need; the search result and the social card preview follow as you type. ⌘Z there takes back a change.
3. Save with ⌘S. When the site keeps redirects, an old address goes on working after a change.

<a id="find"></a>

## Find and replace words

1. Press ⌘F (⌥⌘F to replace as well).
2. Enter goes to the next match, Shift+Enter to the one before.
3. Replace changes one, Replace all every one; ⌘Z takes it back in one step.

| Keys | |
|---|---|
| `⌘F` | Find |
| `⌥⌘F` | Find and replace |

<a id="seo"></a>

## Check the article for search engines

1. Click SEO at the top.
2. Red ones are problems to fix, orange ones are worth a look; each says what to do, and a click shows where.
3. Type your focus keyphrase to see where it appears. "What Google sees" reads the saved page.

<a id="phone"></a>

## See it on a phone or a tablet

1. Click the phone at the top.
2. Pick a screen; the list on the right shows what does not fit.
3. Esc goes back to editing.

<a id="undo"></a>

## Undo a mistake, or get an older version back

1. ⌘Z undoes, ⇧⌘Z redoes.
2. More (…) → History shows the saved versions when the site keeps them.
3. After a crash or a closed tab, the editor offers your unsaved text again when you reopen the page in this same browser. That copy lives in this browser only (not on the server): another computer does not have it, and clearing the browser’s site data loses it.

| Keys | |
|---|---|
| `⌘Z` | Undo |
| `⇧⌘Z` | Redo |

<a id="source"></a>

## Edit the Markdown file itself

1. Click Source at the top.
2. Edit the file as it is written; Visual brings the page back with your changes.

<a id="table"></a>

## Change a table

1. Click in a cell: a Table button appears at the table’s top right.
2. Its menu adds, moves, sorts and deletes rows and columns.
3. Alt+↑ / Alt+↓ in a cell move its row.

<a id="image"></a>

## Describe, crop or replace an image

1. Click the image: its tools appear over it.
2. Alt describes it for people who cannot see it (and for search engines); an image only there for looks can be marked decorative.
3. Replace and Crop are in the bar over it.

<a id="translations"></a>

## See what still needs translating

1. More → Translations lists each page’s title and description per region: missing, outdated (the original changed after it) or done. Needs work shows first, newest change first.
2. Pick a region or a status, or search a title; the address keeps the view, so a link shares it.
3. Details shows the original beside the translation. Translate in Post settings opens the page at its regions; ⌘S saves it, and it leaves the list.

<a id="translate-site"></a>

## Translate the whole site with AI

1. In Languages, press Translate the site with AI. Choose the region, what to include, and whether to skip pages that have their own words there already (the usual choice).
2. Plan it: the plan says how many pages get a draft, about how long that takes, and which are skipped and why. Nothing is asked of the AI or written yet.
3. Run it. It goes on on the server, so you can leave the page; Pause, Resume and Cancel are at the top. When the day’s AI limit is used it pauses and says when to resume.
4. The report lists what was drafted, skipped and failed. To review opens each page in Post settings at its region, with the draft shown first: Accept puts it in the fields and ⌘S saves it; Discard drops it.
5. A draft is never published and never replaces anyone’s words: it waits beside the page until someone saves that region’s words.

<a id="ai"></a>

## Get a suggestion from the AI

1. Click Suggest beside what you want written: alt text (on an image’s Alt line, in an image’s settings, under a cover’s alt text, or under a picture’s alt text on a page), Suggest title and description in the SEO check, Draft translation under a region in Post settings, or Summarize changes beside a promotion’s reason.
2. The suggestion shows next to what is there now. Accept uses it, Edit then accept lets you change it first, Dismiss leaves everything as it was.
3. To improve words you wrote, select them inside one paragraph, heading or list item and press Improve with AI in the bar over them (⌥F10 reaches the bar from the keys). Pick Rewrite, Shorten, Fix spelling and grammar, or a tone: the change shows beside the words, taken out struck through and put in underlined. Accept, Edit then accept, or Reject.
4. For links to your own pages, open Post settings → Topic and links and press Suggest links with AI: each suggestion names a page of the site, the words to link and why. Add link links those words on the page; Dismiss drops it.
5. In the SEO check, press Suggest a fix under a problem it found (a title or description too long or short, a heading out of order, link words such as “click here”, an image with no alt text). The fix shows as a change, taken out struck through and put in underlined: Accept, Edit then accept, or Reject.
6. Nothing changes until you accept, and ⌘S saves it as any change. ⌘Z, wherever you accepted it, or Undo on the note, takes it back.
7. If it says suggestions are off, it says why: the person who runs the server sets the key it names (MARKSTAGE_AI_KEY), or names the model to use.
