// "Edit this page" on the live site (docs/API-EDIT.md). The site's build adds one inline script (core's
// edit-button.mjs) that draws the link only when a cookie it can read holds the CMS's edit address. This sets that
// cookie for a signed-in user, clears it at sign-out, and answers which entry a page address belongs to, for the
// editor's #/edit screen the link opens.
//
//   GET site/edit-button   sets or refreshes the cookie: { on, reason?, message?, domain?, bookmarklet }
//   GET site/entry-at?path=/about-us/   { collection, id, title, url, locale, can } or 404
//
// The cookie is not secret (it only says where the editor is) and the CMS checks the session on every request
// anyway; it is JS-readable on purpose, SameSite=Lax, and lives no longer than the session. It can only reach the
// site when the two share a host name, or a parent domain (cms.example.com and www.example.com: Domain=example.com).
// Otherwise the answer says so, and the editor offers the bookmarklet instead.
import { badRequest, notFound } from './util.mjs';
import { entryCan } from './roles.mjs';

const IP = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

/**
 * The cookie's Domain for a CMS host and a site host: null for the same host (a host-only cookie; ports do not
 * matter to cookies), their shared parent of two labels or more, else undefined (it cannot reach the site).
 */
export function cookieDomain(cmsHost, siteHost) {
  const a = String(cmsHost).toLowerCase();
  const b = String(siteHost).toLowerCase();
  if (!a || !b) return undefined;
  if (a === b) return null;
  if (IP.test(a) || IP.test(b) || a === 'localhost' || b === 'localhost') return undefined;
  const x = a.split('.').reverse();
  const y = b.split('.').reverse();
  const common = [];
  for (let i = 0; i < Math.min(x.length, y.length) && x[i] === y[i]; i++) common.push(x[i]);
  return common.length >= 2 ? common.reverse().join('.') : undefined;
}

export function createEditLink(app) {
  const { config } = app;
  const eb = config.editButton ?? null;
  const own = `${config.publicOrigin}${config.basePath}/#/edit?to=`;
  const https = new URL(config.publicOrigin).protocol === 'https:';
  const siteHost = (() => {
    try {
      return config.siteUrl ? new URL(config.siteUrl).hostname : null;
    } catch {
      return null;
    }
  })();
  const domain = siteHost ? cookieDomain(new URL(config.publicOrigin).hostname, siteHost) : undefined;

  /** Why the cookie cannot be set here, or null when it can. */
  function refusal() {
    if (!eb) return { reason: 'off', message: 'This site has no edit button (editButton in markstage.config).' };
    if (eb.link !== own) return { reason: 'other-cms', message: `The site's build expects the editor at ${eb.cms}, but this server answers at ${config.publicOrigin}. Set editButton.cms to ${config.publicOrigin} and build the site again.` };
    if (domain === undefined) return { reason: 'other-domain', message: `The site (${siteHost ?? 'no siteUrl'}) and this server (${new URL(config.publicOrigin).hostname}) share no host name, so the site cannot read a cookie set here. Use the bookmarklet.` };
    return null;
  }

  function serialize(value, maxAge) {
    const parts = [`${eb.cookie}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
    if (domain) parts.push(`Domain=${domain}`);
    if (https) parts.push('Secure');
    return parts.join('; ');
  }

  return {
    /** Sets the cookie for the session (a signed-in user), when it can reach the site. */
    set(res, session) {
      if (refusal() || !session) return false;
      const left = session.createdAt ? session.createdAt + app.sessions.absoluteMs - app.clock() : app.sessions.absoluteMs;
      res.appendHeader('Set-Cookie', serialize(encodeURIComponent(own), Math.max(0, Math.floor(left / 1000))));
      return true;
    },
    /** Clears it (sign-out): sent whenever the site has an edit button, so a cookie from before goes too. */
    clear(res) {
      if (eb && domain !== undefined) res.appendHeader('Set-Cookie', serialize('', 0));
    },
    refusal,
    domain,
    bookmarklet: `javascript:location.href=${JSON.stringify(own)}+encodeURIComponent(location.pathname)`,
  };
}

/** A page address as the site writes it: a leading slash, a trailing one, no index.html, no query or hash. */
function normalPath(p) {
  let s = String(p ?? '').trim();
  if (!s.startsWith('/') || s.startsWith('//') || s.length > 2000) return null;
  s = s.split(/[?#]/)[0].replace(/\/index\.html?$/i, '/');
  try {
    s = decodeURI(s);
  } catch {
    return null;
  }
  return s.endsWith('/') || /\.[a-z0-9]+$/i.test(s) ? s : `${s}/`;
}

export function editLinkRoutes(router, app) {
  const { config, store } = app;
  const link = app.editLink;
  const coll = (id) => config.collections.find((c) => c.id === id);

  router.add('GET', '/site/edit-button', (ctx) => {
    const no = link.refusal();
    if (no) return { on: false, ...no, bookmarklet: link.bookmarklet };
    link.set(ctx.res, ctx.session?.id ? ctx.session : null);
    return { on: true, domain: link.domain, bookmarklet: link.bookmarklet };
  });

  router.add('GET', '/site/entry-at', (ctx) => {
    const want = normalPath(ctx.query.get('path'));
    if (!want) throw badRequest('path must be a page address such as /about-us/.');
    const slash = (u) => (u.endsWith('/') || /\.[a-z0-9]+$/i.test(u) ? u : `${u}/`);
    const locales = config.locales?.list ?? [];
    for (const [url, ref] of store.addresses()) {
      const paths = app.site?.pathsOf ? app.site.pathsOf(url) : [url];
      const i = paths.findIndex((p) => slash(p) === want);
      if (i < 0) continue;
      const [cId, id] = ref.split('/');
      const c = coll(cId);
      const file = store.read(c, id);
      const e = store.summarize(c, id, file.text);
      return { collection: c.id, id, title: e.title, url: paths[i], locale: locales[i]?.code ?? null, can: entryCan(ctx.user, c, e) };
    }
    throw notFound('No entry has this address.');
  });
}
