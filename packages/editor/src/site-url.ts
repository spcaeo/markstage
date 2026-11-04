// Where a site path can be opened (copy.ts siteUrl): on the site's public address when the editor runs elsewhere
// (the Markstage server's host, where site paths are 404 by design), else on the editor's own origin (astro dev
// serves the site's pages itself). No imports: tested without a browser.

/**
 * The absolute address of a site path: on `site` (the site config's siteUrl) when that is another origin than the
 * editor's, else on `origin`. A full address stays as it is; a siteUrl that is not an address falls back to `origin`.
 */
export function resolveSiteUrl(path: string, site: string | null | undefined, origin: string): string {
  let base = origin;
  try {
    if (site && new URL(site).origin !== origin) base = site;
  } catch {
    // not an address: the editor's origin
  }
  return new URL(path, base).href;
}
