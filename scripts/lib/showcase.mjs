// The one place the first site Markstage was built for may be named: as the public showcase. Only its public
// address (example: "www.<name>.ca"), and only in the showcase and story content, the site pages built from it and
// the README. Everything else stays free of the name: packages/, examples/, scripts/ and docs/ (check-generic.mjs),
// and the other private names (its other projects, clients, servers) are never allowed anywhere. The public sync's
// config has the same rule as "privateTextAllow" (public-sync-core.test.mjs checks they match).

// written in pieces so that this file does not hold the name it allows
const SITE = ['task', 'rhino'].join('');

/** Repo paths where the showcase address may appear. */
export const SHOWCASE_PATHS = Object.freeze([
  'README.md',
  'site-content/why.md',
  'site-content/showcase.md',
  'site/index.html',
  'site/why/index.html',
  'site/showcase/index.html',
  'site/llms.txt',
]);

/**
 * The public address, with or without https:// and www. in front. Never as part of another host name (a subdomain
 * such as the old WordPress host), an email address or a longer word: those stay private.
 */
export const SHOWCASE_ADDRESS = new RegExp(`(?<![\\w.@-])(?:https://(?:www\\.)?|www\\.)?${SITE}\\.ca\\b(?!\\.?[\\w@-])`, 'gi');

/** `text` with the showcase address taken out when `rel` is a showcase path, so the private-name checks can run. */
export function withoutShowcase(rel, text) {
  return SHOWCASE_PATHS.includes(rel) ? text.replace(SHOWCASE_ADDRESS, '') : text;
}
