// What of the site's dev server the preview passes through (security review 3 Nov 2026, S4). Every signed-in role
// reaches the dev server through the preview origin, and a dev server has addresses no page needs: Vite's
// /__open-in-editor (opens a file in an editor on the server's machine) and /@fs/<absolute path> (any file Vite's
// own allow-list lets through), and Astro's dev image endpoint takes an /@fs/ address in its `href`. These are
// refused here, before the dev server sees them, whatever Vite's settings are:
//   - /__open-in-editor and /__inspect (Vite plugins' dev pages): never;
//   - an /@fs/ address, in the path or in any query value: only for a file (real path, links followed) inside the
//     preview clone, inside a package its node_modules links to from outside (a `file:` dependency such as
//     ../markstage/packages/astro), or in a node_modules folder such a package resolves its own imports from.
import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../config.mjs';

const DEV_ONLY = /^\/(?:__open-in-editor|__inspect)(?:\/|$)/i;
const FS = '/@fs/';
const ROOTS_MS = 10_000;

const decodeOnce = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The packages linked from outside `nm` (top level and @scope level): their real folders. */
function linkedOutside(nm, siteReal) {
  const out = [];
  const visit = (dir, depth) => {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      const at = path.join(dir, d.name);
      if (depth === 0 && d.isDirectory() && d.name.startsWith('@')) visit(at, 1);
      if (!d.isSymbolicLink()) continue;
      try {
        const real = fs.realpathSync(at);
        if (!isInside(siteReal, real)) out.push(real);
      } catch {
        // a broken link serves nothing
      }
    }
  };
  visit(nm, 0);
  return out;
}

/** `siteDir`: the preview clone. Returns { refusal(url) }: null when the request may go on, else why not. */
export function createDevPaths(siteDir) {
  let cached = null;
  function roots() {
    if (cached && Date.now() - cached.at < ROOTS_MS) return cached.roots;
    let siteReal;
    try {
      siteReal = fs.realpathSync(siteDir);
    } catch {
      siteReal = path.resolve(siteDir);
    }
    const list = [siteReal];
    for (const pkg of linkedOutside(path.join(siteReal, 'node_modules'), siteReal)) {
      list.push(pkg);
      // where such a package's own imports resolve from (node_modules folders up its path, as Node looks)
      for (let d = pkg; ; d = path.dirname(d)) {
        list.push(path.join(d, 'node_modules'));
        if (path.dirname(d) === d) break;
      }
    }
    cached = { at: Date.now(), roots: [...new Set(list)] };
    return cached.roots;
  }

  /** May an /@fs/ address (what follows "/@fs") be served? Only a file that exists inside one of the roots. */
  function fsAllowed(rest) {
    const clean = rest.split(/[?#]/)[0];
    const abs = process.platform === 'win32' ? clean.replace(/^\/+/, '') : clean;
    if (!path.isAbsolute(abs)) return false;
    let real;
    try {
      real = fs.realpathSync(path.resolve(abs));
    } catch {
      return false;
    }
    return roots().some((r) => isInside(r, real));
  }

  function refusal(url) {
    let p;
    try {
      p = decodeURIComponent(url.pathname);
    } catch {
      return 'bad-address';
    }
    if (DEV_ONLY.test(p)) return 'dev-only';
    // the path and every query value, as given and decoded once more (an address passed on encoded)
    const refs = [p, ...url.searchParams.values()].flatMap((r) => [r, decodeOnce(r)]);
    for (const ref of refs) {
      for (let at = ref.indexOf(FS); at >= 0; at = ref.indexOf(FS, at + 1)) if (!fsAllowed(ref.slice(at + FS.length - 1))) return 'outside-site';
    }
    return null;
  }

  return { refusal, roots };
}
