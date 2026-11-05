// The site's markstage.config (the same file the editor and `astro dev` read; loaded by @markstage/core/site-config)
// is the one source of a site's collections, their page URL and their group. config.json keeps the operator's own
// settings (commands, checks, validate, media, preview). A site without a markstage.config may list collections in
// config.json instead (url: a template like "/blog/{id}/"), never both.
//
// The config file is site code and runs inside the server process, with the same trust as the site's build: only
// whoever controls the content repo's code can change it (the API writes entry files only). It is read at start;
// restart the server after changing it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError, healthOf, isInside, normalizeCollection } from './config.mjs';
import { formsOf } from './forms/config.mjs';
import { designOf } from './design/config.mjs';
import { integrationsOf } from './integrations/config.mjs';

const FILES = ['markstage.config.mjs', 'markstage.config.js', 'markstage.config.ts'];

async function loadModule(specifier = '@markstage/core/site-config') {
  try {
    return await import(specifier);
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return null;
    throw e;
  }
}

/**
 * The site config's `schema: { keystatic: './keystatic.config.ts', options }`: the Keystatic schema of each JSON
 * collection (matched by folder, else by name), so saves write files the way Keystatic's own Save does.
 */
async function keystaticSchemas(contentRoot, schema, collections) {
  if (typeof schema?.keystatic !== 'string' || !schema.keystatic) throw new ConfigError('schema.keystatic must be the path of the keystatic config, e.g. "./keystatic.config.ts".');
  const file = path.resolve(contentRoot, schema.keystatic);
  if (!isInside(contentRoot, file) || !fs.existsSync(file)) throw new ConfigError(`schema.keystatic: ${schema.keystatic} is not a file in the site repo.`);
  const ks = await loadModule('@markstage/core/json/keystatic');
  if (!ks) throw new ConfigError('schema.keystatic needs @markstage/core/json/keystatic, which is not installed.');
  let described;
  try {
    described = await ks.loadKeystaticSchema(file, schema.options ?? {});
  } catch (e) {
    throw new ConfigError(`schema.keystatic: ${path.basename(file)} could not be loaded: ${e.message}`);
  }
  const folder = (p) => String(p ?? '').replace(/\/\*+$/, '').replace(/\/+$/, '');
  const out = new Map();
  for (const c of collections) {
    if (c.format !== 'json') continue;
    const hit = Object.entries(described.collections).find(([, k]) => folder(k.path) === c.dir) ?? Object.entries(described.collections).find(([name]) => name === c.id);
    if (hit && hit[1].format?.data === 'json') out.set(c.id, { schema: hit[1].entry, policy: ks.keystaticPolicy });
  }
  return out;
}

/** `redirects: { command: [argv] }`: how the site records old -> new addresses when an entry moves (move.mjs). */
function redirectsOf(r) {
  if (r === undefined || r === null) return null;
  const ok = Array.isArray(r?.command) && r.command.length && r.command.every((s) => typeof s === 'string' && s);
  if (!ok) throw new ConfigError('redirects must be { command: ["node", "scripts/add-redirects.mjs"] } (argv, no shell).');
  return { command: r.command, timeoutSeconds: Number.isFinite(r.timeoutSeconds) ? r.timeoutSeconds : 60 };
}

/**
 * The config with the site's markstage.config applied (its collections, and its compat when config.json has none),
 * plus the per-entry helpers `urlOf(c, id, data)` and `groupOf(c, id, data)`: { config, site }.
 */
export async function applySiteConfig(config, mod) {
  mod ??= await loadModule();
  const file = FILES.map((f) => path.join(config.contentRoot, f)).find((f) => fs.existsSync(f));
  const templated = config.collections.some((c) => c.url);
  if (!mod && (file || templated)) throw new ConfigError(`${file ? path.basename(file) : 'A collection url template'} needs @markstage/core, which is not installed.`);

  if (file) {
    if (config.collections.length) throw new ConfigError(`The site has ${path.basename(file)}: list collections there, not in config.json too.`);
    let site;
    let raw = null;
    try {
      site = await mod.loadConfig(config.contentRoot, async (f) => (raw = await import(pathToFileURL(f).href)));
    } catch (e) {
      throw new ConfigError(`${path.basename(file)}: ${e.message.replace(/^markstage\.config: /, '')}`);
    }
    // the server's own checks on top of the loader's (real path inside the repo, not .git, no symlink escape)
    const collections = site.config.collections.map((c) => ({
      ...normalizeCollection({ id: c.id, label: c.label, format: c.mdx ? 'mdx' : c.format, dir: c.dir, hasStatus: c.hasStatus, fields: c.fields, defaultAuthor: c.defaultAuthor }, config.contentRoot),
      url: c.url,
      // what a new entry asks for and the site's defaults for it (core's newEntryFrontmatter applies them)
      newEntry: c.newEntry ?? null,
      // the keys the site's schema needs (core's requiredOf: the title, the slug and the site's list), the ones a new
      // entry must be given (newEntry.ask) and the settings' plain names, for the check before every write
      required: c.required ?? [],
      ask: c.newEntry?.ask ?? [],
      // an asked select whose choices are another collection's entries (`from`): a value must be one of them
      askFrom: Object.fromEntries((c.settings ?? []).filter((f) => f.type === 'select' && typeof f.key === 'string' && typeof f.from === 'string' && (c.newEntry?.ask ?? []).includes(f.key)).map((f) => [f.key, f.from])),
      // the category and tag fields (settings of type tags): their names are capped like tags (content/limits.mjs)
      tagFields: (c.settings ?? []).filter((f) => f.type === 'tags' && typeof f.key === 'string').map((f) => f.key),
      labels: Object.fromEntries((c.settings ?? []).filter((f) => typeof f.key === 'string').map((f) => [f.key, String(f.label ?? f.key)])),
      group: c.group,
      // its entries sorted into another collection's (core's groups): the lists give each one its groupId
      groups: c.groups ?? null,
      // the section gallery's view of it (core's galleryOf): { field, variant } or null
      gallery: c.gallery ?? null,
      // the search title and description keys (the seo setting, a JSON collection's too: core's seoOf), for the
      // duplicate check at publish, Health and the suggestions
      seo: c.seo ?? null,
      // the image settings (a cover) with their alt and altFallback keys, for the alt text check
      images: (c.settings ?? []).filter((f) => f.type === 'image' && f.key).map((f) => ({ key: f.key, alt: f.alt ?? null, altFallback: f.altFallback ?? null })),
      // the settings that pick from an integration's live options (integrations/): a save is checked against them
      integrations: (c.settings ?? []).filter((f) => f.type === 'select' && f.integration !== undefined).map((f) => ({ key: f.key, source: f.integration, label: f.label ?? f.key })),
    }));
    const schemaOf = (raw?.default ?? raw)?.schema ? await keystaticSchemas(config.contentRoot, (raw.default ?? raw).schema, collections) : new Map();
    for (const c of collections) Object.assign(c, schemaOf.get(c.id) ?? { schema: null, policy: null });
    const compat = { ...config.compat, collection: config.compat.collection ?? site.config.compat ?? null };
    if (compat.collection && !collections.some((c) => c.id === compat.collection)) throw new ConfigError(`compat.collection "${compat.collection}" is not a collection of ${path.basename(file)}.`);
    const own = raw?.default ?? raw ?? {};
    const integrations = integrationsOf(own.integrations, { contentRoot: config.contentRoot, production: config.production, file: path.basename(file) });
    for (const c of collections) {
      for (const f of c.integrations) {
        if (!integrations[f.source]) throw new ConfigError(`${path.basename(file)}: collection "${c.id}" setting "${f.key}" picks from integration "${f.source}", which integrations does not name.`);
      }
    }
    config = Object.freeze({
      ...config,
      collections,
      compat,
      siteConfigFile: path.basename(file),
      // every locale copy of a page (core's locales: {list: [{code, prefix}], xDefault}); null for one-locale sites
      locales: site.config.locales ?? null,
      siteUrl: site.config.siteUrl || null,
      // the site's name as its people know it (alert mail is named for it); none set: null, and mail says Markstage
      siteName: typeof own.siteName === 'string' && own.siteName.trim() ? own.siteName.trim() : config.siteName ?? null,
      redirects: redirectsOf(own.redirects),
      // lists of options fetched from a JSON address on a schedule (integrations/config.mjs)
      integrations,
      // config.json may name one too (a site without markstage.config); the site's own wins
      health: own.health === undefined ? config.health : healthOf(own.health),
      // the site's forms (forms/config.mjs); config.json may name them too, the site's own win
      forms: own.forms === undefined ? config.forms : formsOf(own.forms, (m) => {
        throw new ConfigError(`${path.basename(file)}: ${m}`);
      }),
      // the site's author files (core's authors.mjs; authors/ checks the folder): the site's own win over config.json's
      authors: site.config.authors ?? config.authors ?? null,
      // the page's frame and what it is for (core's page-types.mjs): the choices, the type's locks and checks
      frames: site.config.frames ?? null,
      pageTypes: site.config.pageTypes ?? null,
      // the site's topics and the link map (core's topics.mjs; links/ checks the folder): the site's own win
      topics: site.config.topics ?? config.topics ?? null,
      // the site's lock rules (core's locksOf): page sections by type, article boxes by name
      locks: site.config.locks ?? { pages: {}, articles: {} },
      // Design & Code: the stylesheets, scripts and injected code the site lets the editor show (design/config.mjs)
      design: designOf(own.design, config.contentRoot),
      // the figure class that marks an image decorative (no alt text needed): core's editor.images
      decorativeClass: site.config.editor?.images?.decorativeClass ?? 'decorative',
      // the site's own link-card data (core's editor.linkCards {url, fields}): served on the CMS origin (app.mjs)
      linkCards: site.config.editor?.linkCards ?? null,
      // "Edit this page" on the built site (core's edit-button.mjs): the address the build hashed, and the cookie
      editButton: site.config.editButton ? { ...site.config.editButton, cookie: mod.EDIT_COOKIE, link: mod.editLinkOf(site.config.editButton.cms, site.config.basePath) } : null,
    });
  }

  // site functions run on every list: one that throws gives no url / group for that entry, not a broken list
  const safe = (fn, what) => (c, id, data) => {
    try {
      return mod ? fn(c, { id, data }) : null;
    } catch (e) {
      console.error(`[markstage] ${config.siteConfigFile ?? 'config'}: ${what} of ${c.id}/${id} failed: ${e.message}`);
      return null;
    }
  };
  // an entry's address in every locale (core's localePath), root first; one-locale sites: just the address
  const core = config.locales ? await loadModule('@markstage/core') : null;
  const pathsOf = (url) => (url ? (config.locales && core ? config.locales.list.map((l) => core.localePath(l, url)) : [url]) : []);
  return { config, site: { urlOf: safe(mod?.urlOf, 'url'), groupOf: safe(mod?.groupOf, 'group'), pathsOf, newEntryFrontmatter: mod?.newEntryFrontmatter ?? null } };
}
