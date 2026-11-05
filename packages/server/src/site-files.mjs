// The site's own files that the editor draws with, on the CMS origin: the fonts in the site's CSS (url(/fonts/…)),
// the images in entries (/img/x.webp from public/, or ../../assets/x.webp next to the Markdown), the favicon. In
// `astro dev` the dev server answers these on the editor's origin; a built editor (editorDir, `markstage
// build-editor`) asks this server for the same addresses.
//
// Only GET and HEAD, only images and fonts: never HTML, scripts, styles or data, so nothing here can run on the CMS
// origin. Read from the content repo: public/<path> first (served at the site root; the live site serves these to
// anyone, and the editor page asks for its fonts before anyone has signed in); then, for signed-in people only, from
// the site's last build (verify.public: the /_astro/… files of the page drawn around the canvas) and from <path> in
// the repo (a draft's images; dev mode: this machine). Never inside .git, node_modules or any dot-folder, never
// through a link that leaves the folder. SVG goes out with a sandbox CSP.
import fs from 'node:fs';
import path from 'node:path';
import { COOKIE } from './auth/sessions.mjs';
import { isWithin } from './config.mjs';
import { parseCookies } from './http.mjs';

export const SITE_FILE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const MAX_BYTES = 50 * 1024 * 1024;

export function createSiteFiles(config, sessions) {
  const root = config.contentRoot;
  const pub = path.join(root, 'public');

  // the site's last build (verify.public): the images and fonts its pages and CSS name by their built address
  // (/_astro/x.woff2), for the page drawn around the canvas (preview/shell.mjs)
  const built = config.verify?.public ?? null;

  /** The file for a site path, or null: { abs, size, open } (open: in public/, for anyone). */
  function find(rel, signedIn) {
    for (const base of signedIn ? [pub, built, root].filter(Boolean) : [pub]) {
      const abs = path.resolve(base, rel);
      if (!isWithin(base, abs)) continue;
      // never git's own files, installed packages or hidden folders (.env, .astro, …)
      if (path.relative(base === built ? built : root, abs).split(path.sep).some((p) => p.startsWith('.') || p === 'node_modules')) continue;
      try {
        const st = fs.statSync(abs);
        if (st.isFile() && st.size <= MAX_BYTES) return { abs, size: st.size, open: base === pub };
      } catch {
        // not in this folder
      }
    }
    return null;
  }

  return {
    /** Answer a request for a site file; false when it is not one (the caller answers 404). */
    handle(req, res, url) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      const type = SITE_FILE_TYPES[path.extname(url.pathname).toLowerCase()];
      if (!type) return false;
      let rel;
      try {
        rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      } catch {
        return false;
      }
      if (!rel || rel.includes('\0')) return false;
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const signedIn = config.devNoAuth || Boolean(token && sessions.lookup(token));
      // signed out, a repo file gets the same 404 as a missing one: the answer does not say which files exist (S15)
      const file = find(rel, signedIn);
      if (!file) return false;
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Length', String(file.size));
      // checked again on each use (a file may change with the next save); a repo file is the person's own copy only
      res.setHeader('Cache-Control', file.open ? 'no-cache' : 'private, no-cache');
      if (type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      fs.createReadStream(file.abs).on('error', () => res.destroy()).pipe(res);
      return true;
    },
  };
}
