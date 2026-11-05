// The dev API's part of page frames and types (docs/API-PAGE-TYPES.md), the same answers as the Markstage server
// without sign-in or git: the check every entry save makes (a frame or type it sets must be one of the site's; dev
// mode is the site's owner, so a type may change), a new post by its type, and the type's checks of one entry
// (page-checks). Dev mode has no built pages: a JSON-LD check looks in the entry's own data only.
import fs from 'node:fs';
import path from 'node:path';
import { frameOf, pageLinks, pageProblems, pageTypeOf, pathKey, runPageChecks, typesFor } from '@markstage/core/page-types';
import { checkEntryAuthors } from './api-authors.mjs';
import { urlOf } from './config.mjs';
import { readFile } from './content.mjs';

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** The site as core's page-types functions take it. */
export const siteOf = (cfg) => ({ frames: cfg.frames ?? null, pageTypes: cfg.pageTypes ?? null, collections: cfg.collections });

/** 422 when a save gives an entry a frame or page type the site does not have (among the values it changes). */
export function checkPage(cfg, c, before, after, HttpError) {
  if (!cfg.frames && !cfg.pageTypes) return;
  const bad = pageProblems(siteOf(cfg), c, before, after);
  if (bad.length) throw new HttpError(422, 'invalid-page', bad[0].message, { fields: Object.fromEntries(bad.map((b) => [b.key, b.message])) });
}

/** Every check an entry save makes in dev mode: its authors (api-authors.mjs) and its frame and type. */
export function checkEntry(cfg, c, before, after, HttpError) {
  checkEntryAuthors(cfg, c, before, after, HttpError);
  checkPage(cfg, c, before, after, HttpError);
}

/** A new post asked for by its type (body `pageType`): the frontmatter with the type's key set; 422 for a type it may not have. */
export function typedFrontmatter(cfg, c, body, given, HttpError) {
  const v = body?.pageType;
  if (v === undefined || v === null || v === '' || !cfg.pageTypes) return given;
  if (!typesFor(siteOf(cfg), c.id).some((t) => t.id === v)) {
    const message = pageProblems(siteOf(cfg), c, null, { [cfg.pageTypes.key]: String(v) })[0]?.message ?? 'No such page type.';
    throw new HttpError(422, 'invalid-page', message, { fields: { pageType: message } });
  }
  const out = structuredClone(given);
  const keys = cfg.pageTypes.key.split('.');
  const holder = keys.slice(0, -1).reduce((h, k) => (h[k] && typeof h[k] === 'object' && !Array.isArray(h[k]) ? h[k] : (h[k] = {})), out);
  holder[keys.at(-1)] = v;
  return out;
}

/** Every page's address -> {collection, id, title, data}: what an entry's links point at. */
function pagesOf(cfg, readFrontmatter) {
  const map = new Map();
  for (const c of cfg.collections) {
    if (!fs.existsSync(c.absDir)) continue;
    for (const f of fs.readdirSync(c.absDir)) {
      if (!f.endsWith(c.ext) || !ID.test(path.basename(f, c.ext))) continue;
      const raw = readFile(c, path.join(c.absDir, f), readFrontmatter);
      const url = urlOf(c, raw);
      if (url) map.set(pathKey(url), { collection: c.id, id: raw.id, title: String(raw.data?.[c.fields.title] ?? raw.id), data: raw.data });
    }
  }
  return map;
}

/** Every entry whose frame or page type is not one of the site's (the build's check): [{file, message}]. */
export function entryPageProblems(cfg, readFrontmatter) {
  if (!cfg.frames && !cfg.pageTypes) return [];
  const out = [];
  for (const c of cfg.collections) {
    if (!fs.existsSync(c.absDir)) continue;
    for (const f of fs.readdirSync(c.absDir).sort()) {
      if (!f.endsWith(c.ext)) continue;
      const raw = readFile(c, path.join(c.absDir, f), readFrontmatter);
      for (const b of pageProblems(siteOf(cfg), c, null, raw.data)) out.push({ file: path.relative(cfg.root, path.join(c.absDir, f)), message: b.message });
    }
  }
  return out;
}

/** The type, frame and type checks of one entry: {type: {id, label} | null, frame, checks}. */
export function pageChecksOf(cfg, c, raw, { md, readFrontmatter }) {
  const site = siteOf(cfg);
  const type = pageTypeOf(site, c, raw.data);
  const frame = frameOf(site, c, raw.data);
  if (!type) return { type: null, frame, checks: [] };
  let doc = null;
  try {
    doc = c.format === 'md' ? md.mdToDoc(raw.text).doc : null;
  } catch (e) {
    // an .mdx file the MDX reader cannot read has no blocks to check (it opens read-only)
    if (!e?.mdx) throw e;
  }
  const map = type.checks.some((k) => k.kind === 'linksTo') ? pagesOf(cfg, readFrontmatter) : null;
  const links = map ? pageLinks(doc, raw.data, cfg.siteUrl).map((href) => ({ href, target: map.get(pathKey(href)) ?? null })) : [];
  const checks = runPageChecks(site, type, { collection: c.id, format: c.format, data: raw.data, doc, links, built: null });
  return { type: { id: type.id, label: type.label }, frame, checks };
}
