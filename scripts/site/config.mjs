// One place for the public site's addresses (site/, published by GitHub Pages, .github/workflows/pages.yml).
// Moving to a custom domain: change DEFAULT_SITE_URL (or set SITE_URL for one build), then `npm run site:build`.

const DEFAULT_SITE_URL = 'https://spcaeo.github.io/markstage/';

/** The public address of site/, with a trailing slash. */
export const SITE_URL = withSlash(process.env.SITE_URL || DEFAULT_SITE_URL);

/** The public GitHub repository, `owner/name`. */
export const REPO = 'spcaeo/markstage';
export const REPO_URL = `https://github.com/${REPO}`;
export const CLONE_URL = `${REPO_URL}.git`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
/** A file of the repo on GitHub, e.g. `docs/DEPLOY.md`. */
export const repoFile = (file) => `${REPO_URL}/blob/main/${file}`;

export const NAME = 'Markstage';
/** The tagline under the name (TAGLINE at the repo root, brand.mjs draws it). */
export const TAGLINE = 'Type it. Ship it.';
export const PUBLISHER = { name: 'Space-O Technologies', url: 'https://www.spaceo.ca' };
export const AUTHOR = 'Rakesh Patel';
export const CONTACT_EMAIL = 'rp@spaceo.ca';
/**
 * The live demo (docs/DEMO.md): its landing page is a page of this site (scripts/site/demo-page.mjs); the folders
 * under it are built by the Pages workflow (npm run demo:build), never committed. DEMO_START is where the landing
 * page's button opens the editor, relative to the landing page.
 */
export const DEMO_PATH = 'demo/';
export const DEMO_BUILT = ['editor', 'blog', 'data'];
export const DEMO_START = 'editor/#/e/posts/hello-markstage';
export const DEMO_URL = `${SITE_URL}${DEMO_PATH}`;

/** The date the site's facts were last checked, for dateModified. */
export const UPDATED = '2026-11-03';

/** Share images (1200 x 630), one per kind of page, made by `npm run site:og`. */
export const OG_IMAGES = {
  home: { path: 'og/home.png', alt: 'Markstage, type it, ship it: the visual editor for Astro sites, with the slash block menu open on a real page.' },
  docs: { path: 'og/docs.png', alt: 'Markstage documentation: set up, write, deploy and run the editor.' },
  compare: { path: 'og/compare.png', alt: 'Markstage compared with other content editors for Astro and static sites.' },
  learn: { path: 'og/learn.png', alt: 'Markstage: answers and words for editing Markdown sites visually.' },
  story: { path: 'og/story.png', alt: 'Why we built Markstage: our own site moved off WordPress, and writers still needed the real page.' },
  showcase: { path: 'og/showcase.png', alt: 'Built with Markstage: a WordPress site moved to Astro, edited on the real page.' },
  features: { path: 'og/features.png', alt: 'Every Markstage feature: writing, pages and media, team and publishing, SEO, safety, AI and MCP.' },
  ai: { path: 'og/ai.png', alt: 'Markstage AI and MCP: agents draft as a person and publish only if allowed; AI suggestions wait for a person to read them.' },
};
export const OG_SIZE = { width: 1200, height: 630 };

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}
