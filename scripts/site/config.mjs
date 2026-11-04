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
export const TAGLINE = 'Edit your Markdown on the real stage.';
export const PUBLISHER = { name: 'Space-O Technologies', url: 'https://www.spaceo.ca' };
export const AUTHOR = 'Rakesh Patel';
export const CONTACT_EMAIL = 'rp@spaceo.ca';
/** The date the site's facts were last checked, for dateModified. */
export const UPDATED = '2026-11-03';

/** Share images (1200 x 630), one per kind of page, made by `npm run site:og`. */
export const OG_IMAGES = {
  home: { path: 'og/home.png', alt: 'Markstage: the visual editor for Astro. Edit Markdown on the real page.' },
  docs: { path: 'og/docs.png', alt: 'Markstage documentation: set up, write, deploy and run the editor.' },
  compare: { path: 'og/compare.png', alt: 'Markstage compared with other content editors for Astro and static sites.' },
  learn: { path: 'og/learn.png', alt: 'Markstage: answers and words for editing Markdown sites visually.' },
};
export const OG_SIZE = { width: 1200, height: 630 };

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}
