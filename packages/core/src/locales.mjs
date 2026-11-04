// A site's locales (markstage.config `locales`, normalized by site-config.mjs): each is a copy of every page under
// its own path prefix ('' for the root), e.g. en-CA at / and en-US at /en-us/. One source file per entry; a locale
// may rewrite its text at build (its `spelling`). These helpers give an entry's address in each locale and the
// hreflang set its pages emit (every locale, then x-default), the same on every copy so the links are reciprocal.
// A page search engines should not index (robots noindex) or whose canonical is another page emits none, so no
// hreflang ever points at a page that is not indexed. No Node imports: the editor uses them too.

/** The page at site path `path` (an entry's url, without prefix) in `locale`. */
export function localePath(locale, path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${locale.prefix}${p}`;
}

/** The hreflang links a page at `path` emits: one per locale, then x-default (the `xDefault` locale's copy). */
export function alternates(locales, path) {
  if (!locales?.list?.length) return [];
  const x = locales.list.find((l) => l.code === locales.xDefault) ?? locales.list[0];
  return [...locales.list.map((l) => ({ hreflang: l.code, path: localePath(l, path) })), { hreflang: 'x-default', path: localePath(x, path) }];
}

/** The locale a request path belongs to (longest prefix first), else the default one. */
export function localeOfPath(locales, path) {
  const prefixed = locales.list.filter((l) => l.prefix).sort((a, b) => b.prefix.length - a.prefix.length);
  return prefixed.find((l) => path === `${l.prefix}/` || path.startsWith(`${l.prefix}/`)) ?? locales.list.find((l) => l.default) ?? locales.list[0];
}

const at = (data, key) => (key ? key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data) : undefined);

/**
 * Whether a page emits hreflang, from its frontmatter `data` and the config's `hreflang` keys: not when its robots
 * value says noindex, nor when its canonical is another address. `{ok, reason}`; reason is plain words.
 */
export function emitsHreflang(locales, data, path, siteUrl = '') {
  const keys = locales?.hreflang ?? {};
  const robots = at(data, keys.robots);
  const list = (Array.isArray(robots) ? robots : typeof robots === 'string' ? robots.split(',') : []).map((r) => String(r).trim().toLowerCase());
  if (list.includes('noindex')) return { ok: false, reason: 'The page is set to noindex, so it emits no hreflang and no other copy points at it.' };
  const canonical = at(data, keys.canonical);
  if (typeof canonical === 'string' && canonical.trim()) {
    const own = [path, `${siteUrl.replace(/\/+$/, '')}${path}`];
    if (!own.includes(canonical.trim())) return { ok: false, reason: 'Its canonical is another address, so it emits no hreflang.' };
  }
  return { ok: true, reason: null };
}
