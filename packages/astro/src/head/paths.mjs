// How the head kit compares site paths (pages.mjs, okf.mjs): "/a/b/", "/a/b", "/a/b.html" and "/a/b/index.html" are
// the same page, "/" and "/index.html" the home page. Query and fragment never count.

/** The path as one comparable key: no query or fragment, no index.html or .html, no trailing slash ("/" stays). */
export function pathKey(p) {
  let s = String(p ?? '/').split(/[?#]/)[0];
  // "/caf%C3%A9/" and "/café/" are one page (a skip or a link may be written either way)
  try {
    s = decodeURIComponent(s);
  } catch {
    // not valid percent-encoding: compared as written
  }
  s = s.replace(/\/index\.html$/i, '/').replace(/\.html$/i, '').replace(/\/+$/, '');
  return s || '/';
}

/** True when `skip` (a path from markdown.skip) names this page path: exactly, or as a prefix when it ends in "/*". */
export function skipped(pagePath, skip) {
  const key = pathKey(pagePath);
  for (const s of skip ?? []) {
    if (typeof s !== 'string' || !s) continue;
    if (s.endsWith('/*')) {
      const prefix = s.slice(0, -1);
      if (key.startsWith(pathKey(prefix) === '/' ? '/' : `${pathKey(prefix)}/`) || key === pathKey(prefix)) return true;
    } else if (pathKey(s) === key) return true;
  }
  return false;
}
