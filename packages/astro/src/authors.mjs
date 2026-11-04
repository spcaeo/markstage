// @markstage/astro/authors: the site's authors for its own pages (the author hub at /author/, each author's page with
// their posts, bylines and Person JSON-LD), read from the author files markstage.config names (`authors`). For the
// site's build and `astro dev`; never the email, and only published entries (docs/API-AUTHORS.md).
//
//   ---
//   import { getAuthors, getAuthor, getEntriesByAuthor, personJsonLd } from '@markstage/astro/authors';
//   export async function getStaticPaths() {
//     return (await getAuthors()).map((author) => ({ params: { slug: author.slug }, props: { author } }));
//   }
//   const posts = await getEntriesByAuthor(Astro.props.author.slug);
//   ---
import { personJsonLd as person, publicProfile } from '@markstage/core/authors';
import { readFrontmatter } from '@markstage/core';
import { authoredEntries, isLive, readAuthor, readAuthors } from './authors-files.mjs';
import { loadConfig } from './config.mjs';

/** Where the integration leaves the site's config (one process runs the build or the dev server and the pages). */
export const CONFIG_KEY = Symbol.for('@markstage/astro/config');

/**
 * The helpers for one normalized site config (what the default exports use, and what a test or a script without
 * Astro calls). Reads the files at every call in dev; a build reads the entries once.
 */
export function authorsOf(cfg, { cache = process.env.NODE_ENV === 'production' } = {}) {
  const acfg = cfg?.authors ?? null;
  let entries = null;
  const allEntries = () => (cache && entries) || (entries = authoredEntries(cfg, readFrontmatter));
  const shown = (a) => publicProfile(a.profile);
  return {
    /** Every author (not archived ones unless asked), in name order: {slug, name, role, bio, photo, website, social, seoTitle, seoDescription, archived, url}. */
    getAuthors({ archived = false } = {}) {
      if (!acfg) return [];
      return [...readAuthors(acfg).values()].filter((a) => archived || !a.profile.archived).map(shown);
    },
    /** One author by slug (an archived one too: their old posts still name them), or null. */
    getAuthor(slug) {
      const a = acfg ? readAuthor(acfg, String(slug ?? '')) : null;
      return a ? shown(a) : null;
    },
    /**
     * The published entries that name the author, primary or co-author, newest first: [{collection, id, title, url,
     * date, role: 'author'|'co-author', data}]. `collection`: only that one; `coAuthored: false`: only as the primary.
     */
    getEntriesByAuthor(slug, { collection = null, coAuthored = true } = {}) {
      if (!acfg) return [];
      return allEntries()
        .filter((e) => (coAuthored ? e.authors.includes(slug) : e.authors[0] === slug) && (!collection || e.collection === collection) && isLive(e.data))
        .map((e) => ({ collection: e.collection, id: e.id, title: e.title, url: e.url, date: e.date, role: e.authors[0] === slug ? 'author' : 'co-author', data: e.data }))
        .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.id.localeCompare(b.id));
    },
    /** schema.org Person (core personJsonLd): the author page as url, the site's Organization as worksFor. */
    personJsonLd(author, opts = {}) {
      return person(author, { acfg, siteUrl: cfg?.siteUrl ?? '', ...opts });
    },
  };
}

let loaded = null;
async function site() {
  const given = globalThis[CONFIG_KEY];
  if (given) return authorsOf(given);
  // outside the integration (a script, a test runner): the project the process runs in
  loaded ??= loadConfig(process.cwd()).then((r) => r?.config ?? null);
  return authorsOf(await loaded);
}

export const getAuthors = async (opts) => (await site()).getAuthors(opts);
export const getAuthor = async (slug) => (await site()).getAuthor(slug);
export const getEntriesByAuthor = async (slug, opts) => (await site()).getEntriesByAuthor(slug, opts);
export const personJsonLd = async (author, opts) => (await site()).personJsonLd(author, opts);
