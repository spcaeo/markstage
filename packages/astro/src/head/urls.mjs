// Addresses the head kit writes. Page paths are kept decoded (pages.mjs: the file "café/index.html" is the page
// "/café/"), because servers decode an address before they look for its file; every URL written into a page, a
// Markdown copy, the OKF bundle or llms.txt encodes the path, so "/café.md" is linked as "/caf%C3%A9.md".

/** A site path as it goes in a URL: each segment percent-encoded once (an already-encoded one is kept). */
export function encodePath(p) {
  return String(p)
    .split('/')
    .map((seg) => {
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join('/');
}

/** The absolute URL of a site path on the site's address (an http(s) URL is kept as it is). */
export const pageUrl = (siteUrl, p) => (/^https?:\/\//i.test(p) ? p : `${String(siteUrl).replace(/\/+$/, '')}${encodePath(p.startsWith('/') ? p : `/${p}`)}`);

/** A site path from a URL's path part: decoded, for comparing with the kit's page paths. */
export function decodedPath(p) {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}
