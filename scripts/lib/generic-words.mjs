// The words `npm run generic` (scripts/check-generic.mjs) looks for, shared with the npm package guard
// (scripts/npm-packages.test.mjs), which runs the same two checks over what each package's tarball holds:
// - SITE_WORDS: a site's own words, in the packages' code, styles and JSON (CODE_FILE);
// - OWN_NAMES: the names of the business Markstage was first built for, in every file, except the showcase address
//   in the files scripts/lib/showcase.mjs lists.
import { withoutShowcase } from './showcase.mjs';

// written in pieces so that this file does not hold the words it looks for
export const OWN_NAMES = new RegExp(['task' + 'rhino', 'board' + 'bridge', 'rhino' + 'move'].join('|'), 'i');
export const SITE_WORDS = new RegExp(`${OWN_NAMES.source}|sidenote|side-note|sideNote|monday\\.com|calendly|space-?o|\\bstudio\\b`, 'i');
/** The files of a package that SITE_WORDS applies to: its code, styles and JSON. */
export const CODE_FILE = /\.(mjs|js|ts|astro|css|json)$/;

/** `rel:line: text` for each line of a package's code file with a site's own word. */
export function siteWordHits(rel, text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    // the old dev routes (/studio-api/…) are part of the API contract (docs/API.md "Compatibility")
    if (SITE_WORDS.test(line.replace(/\/studio-api\//g, ''))) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return hits;
}

/** `rel:line: text` for each line of any file (and the path itself) with the first site's names. */
export function ownNameHits(rel, text) {
  const hits = [];
  if (OWN_NAMES.test(rel)) hits.push(`${rel}: in the file's path`);
  text.split('\n').forEach((line, i) => {
    // the first site's public address is allowed as the showcase, in the showcase files only (lib/showcase.mjs)
    if (OWN_NAMES.test(withoutShowcase(rel, line))) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return hits;
}
