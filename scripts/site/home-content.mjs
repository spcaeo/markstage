// The words of the home page's cards (home.mjs). Every card was checked against the editor's code and docs on
// 2026-11-04, as features-content.mjs says. What the approved mock said and the code does not do was reworded or
// left out: a block's grip moves, duplicates and deletes it but has no "turn into"; stock photos are searched in the
// media library (not the image block) and keep the photographer's name with the photo, nothing is added to the page;
// a custom role limits fields, collections and locales; MCP clients are "Claude or any MCP client" (the docs name
// no other). Prismic's words come from docs/COMPARISON.md's cells (home.mjs reads them), never from here.

/** "Writes like Notion. Looks like your site.": the six writing cards. `k` is the key or sign on the card. */
export const WRITING_CARDS = [
  { k: '/', title: 'Type “/” for any block', text: 'A searchable block menu with a small drawing of each block. Or click the “+” beside a line.' },
  { k: '⋮⋮', title: 'Drag blocks to move them', text: 'A grip on every block: drag it, or move it up, down or to a place you pick, duplicate it or delete it.' },
  { k: '⌘K', title: 'Find anything fast', text: 'One search box for pages, posts, the editor’s screens and its settings.' },
  { k: '⌘V', title: 'Paste from Word', text: 'Word’s headings and lists come in as real blocks, without its office markup.' },
  { k: '≡', title: 'An outline of the page', text: 'Every block under its heading: jump to one, fold a section, drag rows to move them.' },
  { k: '↺', title: 'Never lose typing', text: 'A crash or a closed tab brings your words back. History keeps every saved version.' },
];

/** "Inspired by Ghost": what we kept from Ghost's editor, each checked in the code as shipped. */
export const GHOST_CARDS = [
  { k: 'alt', title: 'Alt text right on the image', text: 'Caption and alt text under the picture, where you see it. By default, publishing waits until every image has alt text.' },
  { k: 'photos', title: 'Stock photos, with your own key', text: 'Search Unsplash or Pexels from the media library. The photographer’s name is kept with the photo.' },
  { k: 'publish', title: 'A publish sheet that checks', text: 'What changes, the checks (links, alt text, the page on a phone), then now or at a time you pick.' },
];

/**
 * "Inspired by Prismic": what we wanted from Prismic, each checked in the code as shipped. `prismic` names the docs/COMPARISON.md row whose
 * Prismic cell the card's chip quotes; `chip` is a plain name of Prismic's own feature where no cell is quoted.
 */
export const PRISMIC_CARDS = [
  { k: 'sections', title: 'A Library of sections', text: 'Reusable sections, snippets and page templates, like Prismic’s Slices. Drag one from the Library onto the live page.', chip: 'Prismic: Slices' },
  { k: 'env', title: 'Local, staging, production', text: 'Promote code and content together by git merge, with checks and rules. Included and free.', prismic: 'Environments or staging' },
  { k: 'release', title: 'Releases and share links', text: 'Bundle changes, preview them together with a link that expires, then publish them at once.', prismic: 'Releases (publish many changes at once)' },
  { k: 'edit', title: '“Edit this page” on the live site', text: 'Signed-in editors get an edit link on the page itself. Visitors see nothing of it.' },
  { k: 'roles', title: 'Custom roles', text: 'Decide who may edit, publish or delete, down to collections, locales and single fields.', prismic: 'Roles' },
  { k: 'mcp', title: 'AI agents through MCP', text: 'Claude or any MCP client reads the site and drafts as you. It never publishes.', prismic: 'MCP server for AI agents' },
];

/** The AI and MCP band: what ships today (the third card is the roadmap's AI items, read from site-content/roadmap.md). */
export const AI_CARDS = [
  { title: 'MCP server', text: 'An agent works with the same roles, locks and checks as the person whose token it holds, and only ever drafts.' },
  { title: 'Suggestions where you work', text: 'Alt text for an image, a search title and description, a translation draft, a summary of a promotion.' },
];

/** The chips under the hero's buttons. */
export const HERO_CHIPS = ['Notion-style blocks', 'AI agents through MCP', 'Content stays in git', 'Free to self-host'];

/** The rows of docs/COMPARISON.md's lead table the home page's compare strip shows, in this order. */
export const STRIP_ROWS = ["Edits on the site's own design", 'Content as files in git', 'Environments or staging', 'Roles', 'What you run', 'Price to start'];

/** The roadmap items about AI and MCP (site-content/roadmap.md ids): the home band's "coming" card and /ai/. */
export const isAiItem = (item) => /^(ai|mcp)-/.test(item.id);
