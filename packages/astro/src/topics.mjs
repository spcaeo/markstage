// @markstage/astro/topics: the site's topics for its own layout (docs/API-LINKS.md), read from the topic files the
// site config names (topics.dir). The "More on this topic" block lists the pages of a page's topic, its own group
// first, so an old page shows a new one on the next build without being edited.
//
//   ---
//   import { getEntry } from 'astro:content';
//   import { moreOnTopic } from '@markstage/astro/topics';
//   const more = await moreOnTopic('posts', post.id, { limit: 4 });   // [{collection, id, role, group, topic}]
//   const entries = (await Promise.all(more.map((m) => getEntry(m.collection, m.id)))).filter((e) => e && !e.data.draft);
//   ---
import fs from 'node:fs';
import path from 'node:path';
import { placesIn, topicMap, topicOf, TOPIC_ID } from '@markstage/core/topics';
import { CONFIG_KEY } from './authors.mjs';
import { loadConfig } from './config.mjs';

/** Every topic file of a normalized site config, normalized (an unreadable file is left out). */
export function readTopics(cfg) {
  const dir = cfg?.topics?.absDir;
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const id = d.name.replace(/\.json$/, '');
    if (!d.isFile() || !d.name.endsWith('.json') || !TOPIC_ID.test(id)) continue;
    try {
      out.push(topicOf(id, JSON.parse(fs.readFileSync(path.join(dir, d.name), 'utf8'))));
    } catch {
      // not JSON: the server's Topic map says so; the site leaves it out
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** The helpers for one normalized site config (what the default exports use, and what a test calls). */
export function topicsOf(cfg) {
  const list = readTopics(cfg);
  const places = topicMap(list);
  const split = (ref) => ({ collection: ref.slice(0, ref.indexOf('/')), id: ref.slice(ref.indexOf('/') + 1) });
  return {
    /** The site's topics: [{id, title, description, pillar, money, anchors, keywords, members, groups}]. */
    topics: () => list.map((t) => structuredClone(t)),
    /** Where a page sits: {topic, group, role: 'pillar' | 'lead' | 'member'}, or null. */
    placeOf: (collection, id) => places.get(`${collection}/${id}`) ?? null,
    /**
     * The pages to list under "More on this topic" for a page: its group's pages (the lead first), then the topic's
     * main page, then the rest of the topic. Never the page itself. [{collection, id, role, group, topic}].
     */
    moreOnTopic: (collection, id, { limit = 6 } = {}) => {
      const ref = `${collection}/${id}`;
      const at = places.get(ref);
      if (!at) return [];
      const t = list.find((x) => x.id === at.topic);
      const all = placesIn(t);
      const g = at.group ? t.groups.find((x) => x.id === at.group) : null;
      const order = [...(g ? [g.lead, ...g.members] : []), t.pillar, ...t.members, ...all.map((p) => p.ref)];
      const seen = new Set([ref]);
      const out = [];
      for (const r of order) {
        if (!r || seen.has(r)) continue;
        seen.add(r);
        const p = all.find((x) => x.ref === r);
        out.push({ ...split(r), role: p?.role ?? 'member', group: p?.group ?? null, topic: t.id });
      }
      return out.slice(0, limit);
    },
  };
}

let loaded = null;
async function site() {
  const given = globalThis[CONFIG_KEY];
  if (given) return topicsOf(given);
  loaded ??= loadConfig(process.cwd()).then((r) => r?.config ?? null);
  return topicsOf(await loaded);
}

export const topics = async () => (await site()).topics();
export const placeOf = async (collection, id) => (await site()).placeOf(collection, id);
export const moreOnTopic = async (collection, id, opts) => (await site()).moreOnTopic(collection, id, opts);
