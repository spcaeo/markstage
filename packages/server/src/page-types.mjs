// Page frames and page types on the server (docs/API-PAGE-TYPES.md, core's page-types.mjs): the check every entry
// write makes (a frame or type it sets must be one of the site's; only editors and above change a page's type, so a
// type's locks mean something), the type's locks added to the site's for its entries, and the type's checks, for
// the page settings and the publish sheet (preflight).
//   GET /collections/:c/entries/:id/page-checks   {type: {id, label} | null, frame: {id, label, from} | null,
//                                                   checks: [{id, label, level, ok, message?}]}
import fs from 'node:fs';
import path from 'node:path';
import { atLeast } from './roles.mjs';
import { HttpError, forbidden } from './util.mjs';
import { internalLinks, pageKey } from './preflight.mjs';
import { isWithin } from './config.mjs';
import { readUpTo } from './verify.mjs';

/** How much of a built page the type checks read (its JSON-LD is in its head, or near it). */
const BUILT_LIMIT = 4 * 1024 * 1024;

const off = { enabled: false, check: () => {}, lockRules: (c, fb, fa, rules) => rules, results: () => null, forCreate: () => null, routes: () => {} };

export async function createPageTypes(app, entries) {
  const { config, store } = app;
  if (!config.frames && !config.pageTypes) return off;
  const core = await import('@markstage/core/page-types').catch(() => null);
  if (!core) return off;
  const site = { frames: config.frames, pageTypes: config.pageTypes, collections: store.collections };
  const typeOf = (c, fields) => core.pageTypeOf(site, c, fields ?? {});

  /** The check every write makes (entries.guard): 422 for a frame or type that is not the site's, 403 for a type change below editor. */
  function check(ctx, c, fa, fb, isNew) {
    const bad = core.pageProblems(site, c, isNew ? null : fb, fa);
    if (bad.length) throw new HttpError(422, 'invalid-page', bad[0].message, { fields: Object.fromEntries(bad.map((b) => [b.key, b.message])) });
    if (!isNew && core.typeChanged(site, fb, fa) && !atLeast(ctx.user, 'editor')) throw forbidden('Only an owner, administrator or editor can change what type of page this is.');
  }

  /** The lock rules for a save: the site's, and those of the entry's type before and after it. */
  const lockRules = (c, fb, fa, rules) => (config.pageTypes ? core.lockRulesFor(rules, [typeOf(c, fb), typeOf(c, fa)]) : rules);

  /** Every page's address -> {collection, id, title, data}, for the link checks: the preflight's known pages (kept by the content version). */
  const pages = () => app.preflight.knownPages();

  /** The page's last built HTML (verify.public), or null; its first 4 MB at most (a writer can make a page large). */
  function built(url) {
    const dir = config.verify?.public;
    if (!dir || !url || !fs.existsSync(dir)) return null;
    const rel = decodeURI(pageKey(url)).replace(/^\/+/, '');
    for (const f of [path.join(dir, rel, 'index.html'), path.join(dir, `${rel}.html`)]) if (isWithin(dir, f) && fs.existsSync(f) && fs.statSync(f).isFile()) return readUpTo(f, BUILT_LIMIT);
    return null;
  }

  /**
   * The type, frame and type checks of an entry's text. `parsed` ({doc} or {data}) and `fields` may be given (the
   * preflight has them); `known` is the page map when the caller has one.
   */
  function results(c, id, text, { parsed = null, fields = null, known = null } = {}) {
    const f = fields ?? store.fieldsOf(c, text);
    const type = typeOf(c, f);
    const frame = core.frameOf(site, c, f);
    if (!type) return { type: null, frame, checks: [] };
    let doc = null;
    try {
      doc = c.format === 'md' ? (parsed ?? entries.parse(c, text)).doc : null;
    } catch (e) {
      // an .mdx file the MDX reader cannot read has no blocks to check (it opens read-only, docs/MDX.md)
      if (e?.code !== 'invalid-mdx') throw e;
    }
    const needLinks = type.checks.some((k) => k.kind === 'linksTo');
    const map = needLinks ? (known ?? pages()) : null;
    const links = needLinks ? internalLinks(doc, f, config.siteUrl).map((l) => ({ href: l.href, target: map.get(pageKey(l.href)) ?? null })) : [];
    const url = store.summarize(c, id, text).url;
    // a `links` check (pillar, money, anchors…) reads the site's topics and link map (links/)
    const linkChecks = type.checks.some((k) => k.kind === 'links') ? (app.links?.linkChecks(c, id) ?? null) : null;
    const checks = core.runPageChecks(site, type, { collection: c.id, format: c.format, data: f, doc, links, linkChecks, built: type.checks.some((k) => k.kind === 'jsonld') ? built(url) : null });
    return { type: { id: type.id, label: type.label }, frame, checks };
  }

  /**
   * A new entry asked for by its type (POST body `pageType`): the type's template (unless the body names one, or the
   * Library lacks it) and the type's key set in the frontmatter or the data. null when the body names no type.
   */
  function forCreate(ctx, c, body) {
    const v = body?.pageType;
    if (v === undefined || v === null || v === '' || !config.pageTypes) return null;
    const t = core.typesFor(site, c.id).find((x) => x.id === v);
    if (!t) throw new HttpError(422, 'invalid-page', core.pageProblems(site, c, null, { [config.pageTypes.key]: String(v) })[0]?.message ?? 'No such page type.', { fields: { pageType: 'No such page type.' } });
    let template = null;
    if (t.template && !(body.template ?? body.templateId)) {
      try {
        app.library.templateFor(ctx.user, t.template, c);
        template = t.template;
      } catch {
        // the type's template is not in the Library (yet): a blank page of the type
      }
    }
    const set = (o) => {
      const out = structuredClone(o ?? {});
      const keys = config.pageTypes.key.split('.');
      const holder = keys.slice(0, -1).reduce((h, k) => (h[k] && typeof h[k] === 'object' && !Array.isArray(h[k]) ? h[k] : (h[k] = {})), out);
      holder[keys.at(-1)] = t.id;
      return out;
    };
    return { template, apply: ({ frontmatter, data }) => (c.format === 'md' ? { frontmatter: set(frontmatter), data } : { frontmatter, data: set(data) }) };
  }

  function routes(router) {
    router.add('GET', '/collections/:c/entries/:id/page-checks', (ctx) => {
      const c = store.collection(ctx.params.c);
      return results(c, ctx.params.id, store.read(c, ctx.params.id).text);
    });
  }

  return { enabled: true, site, check, lockRules, results, forCreate, routes };
}
