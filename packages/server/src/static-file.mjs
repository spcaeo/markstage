// The static file at a site path inside a build folder, never outside it (security review 3 Nov 2026, S5): `..` and
// NUL are refused, and the file's real path (links followed) must be inside the folder's real path, so a symlink in a
// build (a branch can add one to public/) never serves a file from elsewhere on the server. Every server that serves
// a build uses it: the gated site and branch previews (env/site.mjs), share links (releases/share.mjs) and the
// before/after comparison server (env/pages.mjs).
import fs from 'node:fs';
import path from 'node:path';

/** Is `abs` (links followed) the folder `root` itself or inside it? False when either does not exist. */
export function realInside(root, abs) {
  try {
    const real = fs.realpathSync(abs);
    const realRoot = fs.realpathSync(root);
    return real === realRoot || real.startsWith(`${realRoot}${path.sep}`);
  } catch {
    return false;
  }
}

/** The file for a site path (URL-encoded, starting with /) in `dir`: a folder means its index.html. Else null. */
export function staticFileIn(dir, sitePath) {
  let rel;
  try {
    rel = decodeURIComponent(sitePath);
  } catch {
    return null;
  }
  if (rel.includes('\0') || rel.split(/[/\\]/).some((s) => s === '..')) return null;
  const root = path.resolve(dir);
  let abs = path.resolve(root, `.${rel}`);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
  try {
    if (fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html');
    if (!fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return realInside(root, abs) ? abs : null;
}
