// "Edit this page" on the built site, for signed-in editors only (docs/API-EDIT.md). The CMS sets a
// cookie at sign-in that JavaScript can read, holding its edit address; the build adds one small inline script to
// every page that draws the link only when that cookie is there and its address hashes to the one the build knows.
// A visitor has no cookie: the script reads document.cookie and stops (no request, nothing else). The page never
// holds the CMS's address, only the first 8 bytes of its SHA-256; a cookie planted by a sibling host with another
// address draws nothing. The hash needs crypto.subtle (https, or loopback): elsewhere the script does nothing.
import { createHash } from 'node:crypto';

/** The cookie's name: neutral, so nothing in the page names the CMS. */
export const EDIT_COOKIE = '_ed';

const CORNERS = { 'bottom-right': 'bottom:16px;right:16px', 'bottom-left': 'bottom:16px;left:16px', 'top-right': 'top:16px;right:16px', 'top-left': 'top:16px;left:16px' };

/**
 * editButton: `{cms: 'https://cms.example.com', corner?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'}`,
 * or null when the site has none. `fail` throws the config's own error.
 * @param {unknown} raw
 * @param {(message: string) => never} fail
 */
export function editButtonOf(raw, fail) {
  if (raw === undefined || raw === null || raw === false) return null;
  const bad = () => fail('editButton must be {cms: "https://cms.example.com", corner?} (the Markstage server\'s address).');
  if (typeof raw !== 'object' || Array.isArray(raw)) bad();
  const b = /** @type {{cms?: unknown, corner?: unknown}} */ (raw);
  let u;
  try {
    u = new URL(String(b.cms));
  } catch {
    return bad();
  }
  if (!/^https?:$/.test(u.protocol) || u.pathname !== '/' || u.search || u.hash || u.username || u.password) bad();
  if (b.corner !== undefined && !(typeof b.corner === 'string' && b.corner in CORNERS)) fail(`editButton.corner must be one of ${Object.keys(CORNERS).join(', ')}.`);
  return { cms: u.origin, corner: /** @type {string} */ (b.corner ?? 'bottom-right') };
}

/** Where the link goes: the editor's #/edit screen on the CMS, the page's path appended (encoded). */
export const editLinkOf = (cms, basePath = '/markstage') => `${cms}${basePath}/#/edit?to=`;

/** The first 8 bytes of the address's SHA-256, in hex: what the page compares the cookie with. */
export const editLinkHash = (link) => createHash('sha256').update(link).digest('hex').slice(0, 16);

/**
 * The inline script (without its <script> tag) for a normalized site config, or null when it has no editButton.
 * The same text on every page, so a site with a hash-based CSP allows it with one hash.
 * @param {{ editButton: { cms: string, corner: string } | null, basePath: string }} cfg
 */
export function editButtonScript(cfg) {
  if (!cfg.editButton) return null;
  const want = editLinkHash(editLinkOf(cfg.editButton.cms, cfg.basePath));
  const style = `position:fixed;${CORNERS[cfg.editButton.corner]};z-index:40;padding:10px 16px;border-radius:99px;background:#14181f;color:#fff;font:600 14px/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 0 0 1px #fff8,0 2px 8px #0006`;
  return (
    `(c=>{try{c&&crypto.subtle.digest("SHA-256",new TextEncoder().encode(c=decodeURIComponent(c[1]))).then(h=>{` +
    `if([...new Uint8Array(h)].slice(0,8).map(b=>(b|256).toString(16).slice(1)).join("")!="${want}")return;` +
    `let a=document.createElement("a"),d=()=>document.body.append(a);a.href=c+encodeURIComponent(location.pathname);` +
    `a.textContent="Edit this page";a.setAttribute("aria-label","Edit this page in the editor");a.style.cssText="${style}";` +
    `document.body?d():addEventListener("DOMContentLoaded",d)},()=>{})}catch(e){}})` +
    `(document.cookie.match(/(?:^|; )${EDIT_COOKIE}=([^;]+)/))`
  );
}
