// What a site puts in every page's head and next to its pages, set by its owner in the editor (Site settings → Search &
// AI, Tracking) and kept as one JSON file in the content repo (`head.file` in markstage.config, docs/HEAD-KIT.md):
//   markdown  a Markdown copy of every page for AI tools (/<path>.md, the home page /index.md), the OKF bundle
//             (/okf/index.md and one file per page) and llms.txt / llms-full.txt, each with its <link> in the head
//   feeds     RSS feeds of collections (/rss.xml), each with its <link> in the head
//   tracking  analytics tags by ID only (Google Tag Manager, Google Analytics 4, Ahrefs, Skald, Plausible); the build
//             writes the one loader script itself, so no pasted code runs
// Pure: the site's build, the server's settings API and the editor all read the file through readHead(), so the three
// agree on what is allowed. Nothing here touches the disk.

export const HEAD_DEFAULTS = Object.freeze({
  markdown: { pages: true, okf: true, llms: true, skip: [] },
  feeds: [],
  tracking: { gtm: '', ga4: '', ahrefs: '', skald: '', plausible: '', gtmLoad: 'first-interaction' },
});

/** The tracking tools, the shape of their ID, and words for the editor (label, hint, example). */
export const TRACKERS = Object.freeze({
  gtm: { label: 'Google Tag Manager', pattern: /^GTM-[A-Z0-9]{4,12}$/, example: 'GTM-ABC1234', hint: 'The container ID from tagmanager.google.com, starting with GTM-. Google Analytics and other tags you add inside it load with it.' },
  ga4: { label: 'Google Analytics 4', pattern: /^G-[A-Z0-9]{4,15}$/, example: 'G-ABC123DEF4', hint: 'The measurement ID, starting with G-. Leave it empty when Google Analytics already runs inside your Tag Manager container, or each visit counts twice.' },
  ahrefs: { label: 'Ahrefs Web Analytics', pattern: /^[A-Za-z0-9+/=]{10,64}$/, example: 'a1B2c3D4e5F6g7H8i9J0kL', hint: 'The data-key from the snippet Ahrefs gives you (Web Analytics → your site → Install).' },
  skald: { label: 'Skald Analytics', pattern: /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, example: 'www.example.com', hint: 'Your site as Skald names it (the data-site value), such as www.example.com.' },
  // Plausible takes one domain, or several separated by commas (a roll-up of sites into one dashboard)
  plausible: { label: 'Plausible Analytics', pattern: /^(?=.{1,1000}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(,([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}){0,9}$/, example: 'example.com', hint: 'The domain you added in Plausible, such as example.com (several, separated by commas, for a roll-up).' },
});

export const GTM_LOADS = Object.freeze(['first-interaction', 'at-once']);

const FEED_KEYS = ['id', 'title', 'description', 'path', 'collections', 'limit'];
const FEED_PATH = /^\/(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*\.xml$/;
const FEED_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SKIP_PATH = /^\/[^\s?#]*$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * The settings in `raw` (the parsed file, or null when it does not exist yet), checked: {head, issues}. `head` always
 * has every part (the defaults fill what is missing or wrong); `issues` are [{path, message}] in plain words, empty
 * when the file is fine. `collections` are the site's collection ids: a feed may only list those.
 */
export function readHead(raw, { collections = [] } = {}) {
  const issues = [];
  const bad = (p, message) => issues.push({ path: p, message });
  const head = structuredClone({ ...HEAD_DEFAULTS, markdown: { ...HEAD_DEFAULTS.markdown }, tracking: { ...HEAD_DEFAULTS.tracking } });
  if (raw === null || raw === undefined) return { head, issues };
  if (!isObj(raw)) return { head, issues: [{ path: '', message: 'The settings must be a JSON object.' }] };
  for (const k of Object.keys(raw)) if (!(k in HEAD_DEFAULTS) && k !== '$comment') bad(k, `“${k}” is not a setting here (markdown, feeds, tracking).`);

  if (raw.markdown !== undefined) {
    if (!isObj(raw.markdown)) bad('markdown', 'markdown must be an object.');
    else {
      for (const k of Object.keys(raw.markdown)) if (!(k in HEAD_DEFAULTS.markdown)) bad(`markdown.${k}`, `“${k}” is not a Markdown setting (pages, okf, llms, skip).`);
      for (const k of ['pages', 'okf', 'llms']) {
        if (raw.markdown[k] === undefined) continue;
        if (typeof raw.markdown[k] !== 'boolean') bad(`markdown.${k}`, `markdown.${k} must be true or false.`);
        else head.markdown[k] = raw.markdown[k];
      }
      if (raw.markdown.skip !== undefined) {
        if (!Array.isArray(raw.markdown.skip)) bad('markdown.skip', 'markdown.skip must be a list of page paths.');
        else
          raw.markdown.skip.forEach((p, i) => {
            if (typeof p === 'string' && SKIP_PATH.test(p)) head.markdown.skip.push(p);
            else bad(`markdown.skip.${i}`, `“${p}” is not a page path (it starts with / and has no ? or #).`);
          });
      }
    }
  }

  if (raw.feeds !== undefined) {
    if (!Array.isArray(raw.feeds)) bad('feeds', 'feeds must be a list.');
    else {
      const ids = new Set();
      const paths = new Set();
      raw.feeds.forEach((f, i) => {
        const at = `feeds.${i}`;
        if (!isObj(f)) return bad(at, 'Each feed must be an object.');
        for (const k of Object.keys(f)) if (!FEED_KEYS.includes(k)) bad(`${at}.${k}`, `“${k}” is not a feed setting (${FEED_KEYS.join(', ')}).`);
        for (const k of ['id', 'title', 'description', 'path']) if (f[k] !== undefined && typeof f[k] !== 'string') bad(`${at}.${k}`, `${k} must be text.`);
        const feed = { id: str(f.id), title: str(f.title), description: str(f.description), path: str(f.path), collections: [], limit: 50 };
        if (!FEED_ID.test(feed.id)) bad(`${at}.id`, 'A feed needs an id of small letters, digits and dashes (such as “blog”).');
        else if (ids.has(feed.id)) bad(`${at}.id`, `Two feeds are called “${feed.id}”.`);
        if (!feed.title) bad(`${at}.title`, 'A feed needs a title (feed readers show it).');
        if (!FEED_PATH.test(feed.path)) bad(`${at}.path`, 'A feed’s address ends in .xml, such as /rss.xml or /blog/rss.xml.');
        else if (paths.has(feed.path)) bad(`${at}.path`, `Two feeds use ${feed.path}.`);
        if (!Array.isArray(f.collections) || !f.collections.length) bad(`${at}.collections`, 'A feed lists at least one collection.');
        else
          for (const c of f.collections) {
            if (collections.length && !collections.includes(c)) bad(`${at}.collections`, `The site has no collection “${c}”.`);
            else if (typeof c !== 'string' || !c) bad(`${at}.collections`, 'Each collection is named by its id.');
            else if (feed.collections.includes(c)) bad(`${at}.collections`, `“${c}” is listed twice.`);
            else feed.collections.push(c);
          }
        if (f.limit !== undefined) {
          if (!Number.isInteger(f.limit) || f.limit < 1 || f.limit > 500) bad(`${at}.limit`, 'limit is a whole number from 1 to 500.');
          else feed.limit = f.limit;
        }
        ids.add(feed.id);
        paths.add(feed.path);
        head.feeds.push(feed);
      });
      head.feeds = head.feeds.filter((f) => FEED_ID.test(f.id) && f.title && FEED_PATH.test(f.path) && f.collections.length);
    }
  }

  if (raw.tracking !== undefined) {
    if (!isObj(raw.tracking)) bad('tracking', 'tracking must be an object.');
    else {
      for (const [k, t] of Object.entries(TRACKERS)) {
        if (raw.tracking[k] !== undefined && raw.tracking[k] !== null && typeof raw.tracking[k] !== 'string') {
          bad(`tracking.${k}`, `The ${t.label} ID must be text, such as ${t.example}.`);
          continue;
        }
        const v = str(raw.tracking[k]);
        if (!v) continue;
        if (t.pattern.test(v)) head.tracking[k] = v;
        else bad(`tracking.${k}`, `“${v}” is not a ${t.label} ID (such as ${t.example}).`);
      }
      if (raw.tracking.gtmLoad !== undefined) {
        if (GTM_LOADS.includes(raw.tracking.gtmLoad)) head.tracking.gtmLoad = raw.tracking.gtmLoad;
        else bad('tracking.gtmLoad', `gtmLoad is one of ${GTM_LOADS.join(', ')}.`);
      }
      for (const k of Object.keys(raw.tracking)) if (!(k in TRACKERS) && k !== 'gtmLoad') bad(`tracking.${k}`, `“${k}” is not a tracking tool Markstage knows (${Object.keys(TRACKERS).join(', ')}).`);
    }
  }
  return { head, issues };
}

/** True when the settings ask for any tracking tag. */
export const tracks = (head) => Object.keys(TRACKERS).some((k) => head.tracking[k]);

/** The Markdown copy's address for a page path: "/a/b/" -> "/a/b.md", "/" -> "/index.md", "/a.html" -> "/a.md". */
export function markdownPath(pagePath) {
  const p = String(pagePath || '/').split(/[?#]/)[0];
  if (p === '/' || p === '') return '/index.md';
  return p.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/$/, '') + '.md';
}
