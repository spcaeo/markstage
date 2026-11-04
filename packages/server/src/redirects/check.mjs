// What is wrong with a site's redirects, worked out from the list alone (and the last build, when there is one):
//   loop       following them comes back to an address already seen (or one points at itself): visitors get an error
//   chain      A -> B -> C: each hop costs a round trip and some of the link's value; point A at C
//   shadowed   a page is at the old address (a live entry, or a page in the last build), so the redirect never runs
//   missing    the final address is on this site but is not a page in the last build
//   duplicate  the same address is redirected twice (say /a and /a/); only one of them runs
// Addresses compare by path: no query or fragment, one trailing slash, and a full URL on the site's own origin is its
// path. A full URL on another site ends the trail.

const MAX_PATH = 512;
const MAX_TARGET = 2000;
// a site path: one leading slash (not two: that is another host), no spaces, backslashes or control characters
const PATHLIKE = /^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/;
// an address is what a browser sends: for accents or other letters, their encoded form (QA pass 2, N5)
const NOT_ASCII = /[^\x21-\x7e]/;
const ENCODED = 'Use letters a–z, digits, - _ . and / in an address. For accents or other letters, use the encoded form, like /caf%C3%A9/ for /café/.';

/** The address a redirect matches, as a comparable key; null for another site or something that is not an address. */
export function keyOf(address, origin = null) {
  let s = String(address ?? '');
  if (/^https?:\/\//i.test(s)) {
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (!origin || u.origin !== origin) return null;
    s = u.pathname;
  }
  s = s.replace(/[?#].*$/, '');
  if (!PATHLIKE.test(s)) return null;
  return s.length > 1 ? `${s.replace(/\/+$/, '')}/` : '/';
}

/** Why `from` cannot be a redirect's old address, or null. Old addresses are paths only: no query, no fragment. */
export function badFrom(from) {
  if (typeof from !== 'string' || !from) return 'Give the old address, starting with /.';
  if (from.length > MAX_PATH) return `Keep it under ${MAX_PATH} characters.`;
  if (/^https?:\/\//i.test(from)) return 'Give the path only, starting with / (without the site’s address).';
  if (!PATHLIKE.test(from)) return 'Start with one / and use no spaces.';
  if (NOT_ASCII.test(from)) return ENCODED;
  if (/[?#]/.test(from)) return 'Redirects match the path only: leave out ? and #.';
  if (from.split('/').some((seg) => seg === '..' || seg === '.')) return 'Use the address as visitors see it (no . or .. parts).';
  return null;
}

/** Why `to` cannot be a redirect's new address, or null. A site path, or a full http(s) address. */
export function badTo(to) {
  if (typeof to !== 'string' || !to) return 'Give the new address: a path starting with /, or a full https:// address.';
  if (to.length > MAX_TARGET) return `Keep it under ${MAX_TARGET} characters.`;
  if (/^https?:\/\//i.test(to)) {
    try {
      const u = new URL(to);
      if (u.username || u.password) return 'Leave out a user name and password.';
      return /\s/.test(to) ? 'Use no spaces.' : null;
    } catch {
      return 'That is not a web address.';
    }
  }
  if (!PATHLIKE.test(to)) return 'Start with one / (or https://) and use no spaces.';
  if (NOT_ASCII.test(to)) return ENCODED;
  return null;
}

/** The path a build would have for an address (no query or fragment, no trailing slash except for "/"). */
const builtPath = (address, origin) => {
  const k = keyOf(address, origin);
  return k === null ? null : k === '/' ? '/' : k.slice(0, -1);
};

/**
 * Each redirect with its flags: [{from, to, status, flags: [{kind, text, trail?, fix?}]}]. `built(path)` says what the
 * last build has there: 'page', 'redirect' (a stub), or null; leave it out when there is no build to look at.
 * `pages`: the keys of the live entries' addresses (a page there even before a build).
 */
export function checkRedirects(list, { origin = null, built = null, pages = new Set() } = {}) {
  const first = new Map(); // key of `from` -> index of the first redirect from it
  const out = list.map((r) => ({ from: r.from, to: r.to, status: r.status ?? null, flags: [] }));
  out.forEach((r, i) => {
    const k = keyOf(r.from, origin);
    if (k === null) return void r.flags.push({ kind: 'bad', text: 'The old address is not a path on this site.' });
    if (first.has(k)) r.flags.push({ kind: 'duplicate', text: `${list[first.get(k)].from} is redirected too; only one of them runs.` });
    else first.set(k, i);
  });
  for (const r of out) {
    const from = keyOf(r.from, origin);
    if (from === null) continue;
    if (badTo(r.to)) {
      r.flags.push({ kind: 'bad', text: 'The new address is not a path or a web address.' });
      continue;
    }
    if (keyOf(r.to, origin) === from) {
      r.flags.push({ kind: 'loop', text: 'It points at itself: visitors get an error.', trail: [r.from, r.to] });
      continue;
    }
    // follow it: r.from -> r.to -> (the redirect from r.to) -> ...
    const trail = [r.from, r.to];
    const seen = new Set([from]);
    let k = keyOf(r.to, origin);
    let loop = false;
    while (k !== null && first.has(k)) {
      if (seen.has(k) || trail.length > 50) {
        loop = true;
        break;
      }
      seen.add(k);
      const n = out[first.get(k)];
      trail.push(n.to);
      k = keyOf(n.to, origin);
    }
    if (loop) r.flags.push({ kind: 'loop', text: `A loop: ${trail.join(' → ')}. Visitors get an error.`, trail });
    else if (trail.length > 2) r.flags.push({ kind: 'chain', text: `A chain: ${trail.join(' → ')}. Point it at ${trail.at(-1)} instead.`, trail, fix: trail.at(-1) });
    if (pages.has(from) || built?.(builtPath(r.from, origin)) === 'page') r.flags.push({ kind: 'shadowed', text: `A page is at ${r.from}, so this redirect never runs.` });
    if (built) {
      const end = trail.at(-1);
      const endPath = builtPath(end, origin);
      if (!loop && endPath !== null && !first.has(keyOf(end, origin)) && !built(endPath)) r.flags.push({ kind: 'missing', text: `${end} is not a page on the site (in the last build).` });
    }
  }
  return out;
}
