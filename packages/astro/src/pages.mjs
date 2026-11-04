// @markstage/astro/pages: a page's frame and type for the site's own layout (docs/API-PAGE-TYPES.md), read from the
// frames and page types markstage.config names. The layout picks how it draws the page from the frame: `full` (edge
// to edge, no reading column), `reading` (the menu and a list of contents), `plain` (the text alone).
//
//   ---
//   import { frameOf } from '@markstage/astro/pages';
//   const frame = await frameOf('posts', post.data);   // {id: 'reading', label, hint, from: 'page' | 'type' | 'collection'}
//   ---
//   <Layout frame={frame?.id ?? 'reading'}> … </Layout>
import { frameOf as frameIn, pageTypeOf as typeIn } from '@markstage/core/page-types';
import { CONFIG_KEY } from './authors.mjs';
import { loadConfig } from './config.mjs';

/** The helpers for one normalized site config (what the default exports use, and what a test calls). */
export function pagesOf(cfg) {
  const site = { frames: cfg?.frames ?? null, pageTypes: cfg?.pageTypes ?? null, collections: cfg?.collections ?? [] };
  const coll = (id) => site.collections.find((c) => c.id === id) ?? null;
  const shown = (t) => (t ? { id: t.id, label: t.label, description: t.description, collections: t.collections, frame: t.frame } : null);
  return {
    /** The site's frames: [{id, label, hint}] ([] when it has none). */
    frames: () => site.frames?.list.map((f) => ({ ...f })) ?? [],
    /** The site's page types: [{id, label, description, collections, frame}] ([] when it has none). */
    pageTypes: () => site.pageTypes?.types.map(shown) ?? [],
    /** The entry's frame: its own, else its type's, else its collection's; null when the site has no frames. */
    frameOf: (collection, data) => (coll(collection) ? frameIn(site, coll(collection), data ?? {}) : null),
    /** The entry's page type ({id, label, description, collections, frame}), or null. */
    pageTypeOf: (collection, data) => shown(coll(collection) ? typeIn(site, coll(collection), data ?? {}) : null),
  };
}

let loaded = null;
async function site() {
  const given = globalThis[CONFIG_KEY];
  if (given) return pagesOf(given);
  // outside the integration (a script, a test runner): the project the process runs in
  loaded ??= loadConfig(process.cwd()).then((r) => r?.config ?? null);
  return pagesOf(await loaded);
}

export const frames = async () => (await site()).frames();
export const pageTypes = async () => (await site()).pageTypes();
export const frameOf = async (collection, data) => (await site()).frameOf(collection, data);
export const pageTypeOf = async (collection, data) => (await site()).pageTypeOf(collection, data);
