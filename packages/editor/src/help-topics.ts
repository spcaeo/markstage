// The "How do I…" guide's topics (help.ts): one task each, in a writer's words, a few steps, the keys, and the
// part of the screen "Show me" points at (a selector; a topic whose part is not on screen just has no button).
// docs/WRITING.md is written from these: after a change, `npm run guide` (and `npm run guide -- --check` tells).

export interface HelpTopic {
  id: string;
  title: string;
  /** more words the search matches */
  words: string;
  steps: string[];
  keys?: [string, string][];
  /** what "Show me" points at */
  show?: string;
}

export const TOPICS: HelpTopic[] = [
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    words: 'keys keyboard shortcut hotkey cheat sheet list',
    steps: ['Press ? anywhere but in text to open this list.', 'On Windows and Linux, ⌘ is Ctrl.'],
    keys: [
      ['⌘K', 'Find and open a page or screen; with text selected, add a link'],
      ['⌘S', 'Save'],
      ['⌘F', 'Find in the article (⌥⌘F with Replace)'],
      ['/', 'On an empty line: add a block'],
      ['⌘Z / ⇧⌘Z', 'Undo / redo'],
      ['⌘B / ⌘I', 'Bold / italic'],
      ['⌥F10', 'With words selected: go to the bar over them (←/→ along it, Esc back)'],
      ['Enter in the title', 'Go to the text'],
      ['⌥↑ / ⌥↓', 'Move the block up or down (Outline)'],
      ['Esc', 'Close the open panel, menu or check'],
      ['?', 'This guide'],
    ],
  },
  {
    id: 'open',
    title: 'Find an article and open it',
    words: 'search palette list open switch',
    steps: ['Press ⌘K, or click the search box at the top left.', 'Type a few words of its title or its address.', 'Press Enter on the one you want. Your recent ones are listed first.'],
    keys: [['⌘K', 'Find and open']],
    show: '[data-search]',
  },
  {
    id: 'new',
    title: 'Start a new article',
    words: 'create draft add post write',
    steps: ['Click New at the top.', 'Give it a title, and anything the site asks for (such as its topic).', 'It opens as a draft: nothing goes live until it is published.'],
    show: '[data-new]',
  },
  {
    id: 'save',
    title: 'Save, and know what is live',
    words: 'save publish live draft status unsaved',
    steps: [
      'Press ⌘S, or click Save. The dot next to the status turns green.',
      'Saved is not live yet: with a Publish button at the top, publish from there; where it says "Not live yet", click it to see how this site goes live.',
      'Your typing is also kept in this browser (and nowhere else) as a safety net: a closed tab or a lost connection loses nothing, but clearing the browser’s data does. Save puts it on the server.',
    ],
    keys: [['⌘S', 'Save']],
    show: '[data-save]',
  },
  {
    id: 'block',
    title: 'Add a heading, an image, a table or a box',
    words: 'insert add block slash plus image table faq callout list quote',
    steps: ['On an empty line, type / and a few letters of what you want, then Enter.', 'Or point at a line and click the + at its left.', 'Boxes (FAQ, tips, steps…) are drawn as the page shows them; type straight into them.'],
    keys: [['/', 'On an empty line: the block menu']],
  },
  {
    id: 'snippet',
    title: 'Keep blocks and pages to use again (the Library)',
    words: 'snippet section template synced save reuse again library shared folder signature call to action boilerplate new page from template detach',
    steps: [
      'Click a block’s grip and choose Save section to Library…, or select several blocks and choose Save … to Library… in the More menu. Give it a name and a folder; tick Synced so every page that uses it follows when it changes.',
      'To use one, open Library in the header and drag it between two blocks (a line shows where it lands; ⌘Z takes it back), press Enter on it to put it after the block you are in, or type / on an empty line and a few letters of its name.',
      'On a page made of sections, the Add section list has a From the Library group: click one, drag it into the outline, or drag it onto the page itself, where a line says where it will land. From the keyboard, choose Insert… under it and pick a place from the list. It is saved at once and the page is drawn with it; Undo on the note takes it out again. A locked section, or a page whose layout is locked, takes none and says why. A synced copy shows Synced; change it on one page, then choose Apply to … pages in the note above it, Undo my changes, or Detach here to keep it as this page’s own.',
      'More → Save page as template… keeps the whole page (not its address, dates or author). New → Start from then begins a page from it.',
      'More → Library lists everything: filter by kind, folder or tag, put items in order with Arrange, see which pages use a synced item, and export or import packs.',
    ],
  },
  {
    id: 'groups',
    title: 'Put a topic’s articles in order, or move one to another topic',
    words: 'topic cluster group hub order pillar reorder move article another topic category address redirect',
    steps: [
      'Open the topics screen in the left bar (named as your site calls them, such as Topics) and choose a topic: its articles show in the order its page lists them.',
      'Drag one by its ⋮⋮ grip, or press Alt+↑ or Alt+↓ on it: it and everything above it keep those places; the rest follow, newest first. Undo in the message puts it back.',
      'In the grip’s menu, Back to newest first takes away its place; Move to another topic… shows its new address, the redirect and the links that follow before anything changes.',
    ],
  },
  {
    id: 'topics',
    title: 'Put a page in a topic, so pages link to each other',
    words: 'topic topics cluster pillar main page group lead internal links linking related more on this topic drag',
    steps: [
      'Click the gear at the top to open the page’s settings. Under Topic and links, pick its topic, its group, and whether it is the topic’s main page or leads its group. It is kept straight away.',
      'More → Topic map shows each topic as a board: drag a page from Not in a topic onto a place, or use its Move to… list. Edit topic names the words for links to the main page and its service page.',
      'Pages in a topic are listed under More on this topic on the site, group first, so old pages show a new one after the next publish without being edited.',
    ],
    show: '.ms-topicbox',
  },
  {
    id: 'links',
    title: 'Link old pages to a new one, and the new one to the right pages',
    words: 'link links inbox suggestion suggestions internal linking anchor words accept skip old new pages that should link',
    steps: [
      'In the page’s settings, Pages to link to lists its main page, its group’s lead and pages next to it, each with the words to link and the sentence they fit in. Link these words links them on the page; ⌘S saves it.',
      'Pages that should link here lists sentences on other pages that talk about this one. Accept adds the link on that page (a normal save, published if the page is live); Undo in the message takes it back. Skip hides it for everyone.',
      'More → Links → Link inbox collects every open suggestion of the site, grouped by the page they link to. Skipped lists the ones skipped, to bring back.',
    ],
  },
  {
    id: 'link-health',
    title: 'Fix links that are weak or wrong',
    words: 'link health weak no links orphan pillar generic click here read more redirect noindex nofollow sponsored outside external',
    steps: [
      'More → Links → Health lists what to fix, worst first: pages no page links to, pages with one link in, pages that do not link up to their topic’s main page, the same words used for two pages, vague words such as click here, links to old addresses or hidden pages, and outside links.',
      'Pick a topic or a kind to see fewer; the address keeps the view, so a link shares it.',
      'A fix button does it in one click (a new address, nofollow or sponsored on an outside link), with Undo in the message. Open at the sentence opens the page where the link is.',
    ],
  },
  {
    id: 'edit-button',
    title: 'Open the page you are looking at on your site',
    words: 'edit this page button live site bookmark bookmarklet open entry find page from site',
    steps: [
      'Sign in here, then open any page of your site in the same browser: an Edit this page link sits in its corner (only you see it; visitors never do). It opens that page here.',
      'No link? Open your account menu (your initials at the bottom left) and choose Edit button on your site: it says why, and gives you a bookmark that does the same from any page.',
    ],
  },
  {
    id: 'gallery',
    title: 'See every kind of page section your site has',
    words: 'section gallery types variations sample preview developer review dark light mobile desktop components',
    steps: [
      'Open the Library and choose Section gallery: each section type and variation is drawn alone by your site, at 1440 and 390 pixels wide.',
      'Pick a width, Dark, or one type above the list; Whole page shows the page around a section. Each one says which page it comes from, and Edit it there opens that page at that section.',
    ],
  },
  {
    id: 'releases',
    title: 'Put several changes live together, now or at a time',
    words: 'release releases launch schedule later publish together bundle preview share link client review approve rollback',
    steps: [
      'Make a release under Releases (New release…). Then open a page and choose More → Add to a release…: your unsaved changes go into it, not on the site. A Library item: open it in the Library, change it there, and choose Add to a release….',
      'On the release, build the preview to see the site as it will be; Share it… makes a link for people without an account (it is shown once: copy it then).',
      'Publish now, or Schedule… a time: everything in it goes live in one go. Once live, Roll back… takes it off again.',
    ],
  },
  {
    id: 'move',
    title: 'Move a block, a list item or a question',
    words: 'move reorder drag up down order outline handle grip section heading fold collapse headings only',
    steps: [
      'Put the caret in it and press Alt+↑ or Alt+↓.',
      'Or point at it and drag the ⋮⋮ grip at its left; the grip’s menu also has Move to the top, to the bottom and Move to….',
      'The Outline lists every block, each section under its H2: drag rows there, or select several with ⌘-click. Moving an H2 moves its whole section.',
      'Fold a section with its arrow (or ← on its row), or press Headings only to see the headings alone.',
      'Every move is one step back with ⌘Z.',
    ],
    keys: [
      ['Alt+↑ / Alt+↓', 'Move up / down'],
      ['← / →', 'Fold / unfold a section (Outline)'],
      ['⌘Z', 'Undo'],
    ],
    show: '[data-sections]',
  },
  {
    id: 'lock',
    title: 'Lock or unlock a block',
    words: 'lock unlock padlock locked keep fixed protect move delete rule site',
    steps: [
      'A locked box or section shows Locked (or Locked by the site) at its top right; point at it to see why.',
      'Click the padlock, or choose Lock… in the grip’s menu, to say what can’t be done: moved, deleted or changed.',
      'A lock the site sets on every page can be lifted here with Unlock on this page.',
      'Save the page (⌘S) to keep the change. Owners and administrators change the site’s rules in Settings → Locks.',
    ],
    keys: [['Esc', 'Close the padlock’s box']],
  },
  {
    id: 'format',
    title: 'Make text bold, add a link, a heading or a list',
    words: 'bold italic link heading list format toolbar nofollow new tab',
    steps: [
      'Select the words: a small bar appears above them.',
      'Click a button, or press ⌘B, ⌘I, ⌘K (link).',
      'In the link field, search the site’s pages or paste an address. Below it: New tab, Nofollow, Sponsored, User content.',
    ],
    keys: [
      ['⌘B', 'Bold'],
      ['⌘I', 'Italic'],
      ['⌘K', 'Link (with words selected)'],
    ],
  },
  {
    id: 'settings',
    title: 'Change the cover, address, excerpt or search title',
    words: 'cover image slug url address excerpt seo meta title description author date tags category settings',
    steps: ['Click the gear at the top.', 'Change what you need; the search result and the social card preview follow as you type. ⌘Z there takes back a change.', 'Save with ⌘S. When the site keeps redirects, an old address goes on working after a change.'],
    show: '[data-settings]',
  },
  {
    id: 'find',
    title: 'Find and replace words',
    words: 'find replace search words rename',
    steps: ['Press ⌘F (⌥⌘F to replace as well).', 'Enter goes to the next match, Shift+Enter to the one before.', 'Replace changes one, Replace all every one; ⌘Z takes it back in one step.'],
    keys: [
      ['⌘F', 'Find'],
      ['⌥⌘F', 'Find and replace'],
    ],
  },
  {
    id: 'seo',
    title: 'Check the article for search engines',
    words: 'seo google keyphrase keyword headings links images schema social share',
    steps: [
      'Click SEO at the top.',
      'Red ones are problems to fix, orange ones are worth a look; each says what to do, and a click shows where.',
      'Type your focus keyphrase to see where it appears. "What Google sees" reads the saved page.',
    ],
    show: '[data-seo]',
  },
  {
    id: 'phone',
    title: 'See it on a phone or a tablet',
    words: 'phone mobile tablet screen device responsive check',
    steps: ['Click the phone at the top.', 'Pick a screen; the list on the right shows what does not fit.', 'Esc goes back to editing.'],
    show: '[data-devices]',
  },
  {
    id: 'undo',
    title: 'Undo a mistake, or get an older version back',
    words: 'undo redo mistake history revision restore older version recover',
    steps: ['⌘Z undoes, ⇧⌘Z redoes.', 'More (…) → History shows the saved versions when the site keeps them.', 'After a crash or a closed tab, the editor offers your unsaved text again when you reopen the page in this same browser. That copy lives in this browser only (not on the server): another computer does not have it, and clearing the browser’s site data loses it.'],
    keys: [
      ['⌘Z', 'Undo'],
      ['⇧⌘Z', 'Redo'],
    ],
    show: '[data-undo]',
  },
  {
    id: 'source',
    title: 'Edit the Markdown file itself',
    words: 'source markdown code raw file html',
    steps: ['Click Source at the top.', 'Edit the file as it is written; Visual brings the page back with your changes.'],
    show: '[data-view="source"]',
  },
  {
    id: 'table',
    title: 'Change a table',
    words: 'table row column sort header add delete',
    steps: ['Click in a cell: a Table button appears at the table’s top right.', 'Its menu adds, moves, sorts and deletes rows and columns.', 'Alt+↑ / Alt+↓ in a cell move its row.'],
  },
  {
    id: 'image',
    title: 'Describe, crop or replace an image',
    words: 'image alt text crop replace caption decorative picture photo',
    steps: [
      'Click the image: its tools appear over it.',
      'Alt describes it for people who cannot see it (and for search engines); an image only there for looks can be marked decorative.',
      'Replace and Crop are in the bar over it.',
    ],
  },
  {
    id: 'translations',
    title: 'See what still needs translating',
    words: 'translation translations translate region language locale missing outdated french title description',
    steps: [
      'More → Translations lists each page’s title and description per region: missing, outdated (the original changed after it) or done. Needs work shows first, newest change first.',
      'Pick a region or a status, or search a title; the address keeps the view, so a link shares it.',
      'Details shows the original beside the translation. Translate in Post settings opens the page at its regions; ⌘S saves it, and it leaves the list.',
    ],
  },
  {
    id: 'translate-site',
    title: 'Translate the whole site with AI',
    words: 'translate site whole all pages region language locale ai draft batch run pause resume cancel review',
    steps: [
      'In Languages, press Translate the site with AI. Choose the region, what to include, and whether to skip pages that have their own words there already (the usual choice).',
      'Plan it: the plan says how many pages get a draft, about how long that takes, and which are skipped and why. Nothing is asked of the AI or written yet.',
      'Run it. It goes on on the server, so you can leave the page; Pause, Resume and Cancel are at the top. When the day’s AI limit is used it pauses and says when to resume.',
      'The report lists what was drafted, skipped and failed. To review opens each page in Post settings at its region, with the draft shown first: Accept puts it in the fields and ⌘S saves it; Discard drops it.',
      'A draft is never published and never replaces anyone’s words: it waits beside the page until someone saves that region’s words.',
    ],
  },
  {
    id: 'ai',
    title: 'Get a suggestion from the AI',
    words: 'ai suggest suggestion alt text seo title description translate translation draft summary summarize promotion improve rewrite shorten spelling grammar tone links internal link fix heading click here',
    steps: [
      'Click Suggest beside what you want written: alt text (on an image’s Alt line, in an image’s settings, under a cover’s alt text, or under a picture’s alt text on a page), Suggest title and description in the SEO check, Draft translation under a region in Post settings, or Summarize changes beside a promotion’s reason.',
      'The suggestion shows next to what is there now. Accept uses it, Edit then accept lets you change it first, Dismiss leaves everything as it was.',
      'To improve words you wrote, select them inside one paragraph, heading or list item and press Improve with AI in the bar over them (⌥F10 reaches the bar from the keys). Pick Rewrite, Shorten, Fix spelling and grammar, or a tone: the change shows beside the words, taken out struck through and put in underlined. Accept, Edit then accept, or Reject.',
      'For links to your own pages, open Post settings → Topic and links and press Suggest links with AI: each suggestion names a page of the site, the words to link and why. Add link links those words on the page; Dismiss drops it.',
      'In the SEO check, press Suggest a fix under a problem it found (a title or description too long or short, a heading out of order, link words such as “click here”, an image with no alt text). The fix shows as a change, taken out struck through and put in underlined: Accept, Edit then accept, or Reject.',
      'Nothing changes until you accept, and ⌘S saves it as any change. ⌘Z, wherever you accepted it, or Undo on the note, takes it back.',
      'If it says suggestions are off, it says why: the person who runs the server sets the key it names (MARKSTAGE_AI_KEY), or names the model to use.',
    ],
  },
];
