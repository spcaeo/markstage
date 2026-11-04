// Topics (docs/API-LINKS.md): the site's subjects, each a JSON file in the folder the site config names
// (`topics.dir`, default markstage/topics): <topic id>.json holds its main page (the pillar), its groups (each with an
// optional lead page and member pages), its pages without a group, the service page it sells (money), and the words
// that name it. A page belongs to one topic at most; pages are named "<collection>/<entry id>".
// The link map (link-map.mjs) reads them to suggest links both ways, to find weak pages, and to fill the
// "More on this topic" block on the site. Pure functions: the server, the astro integration and the tests share them.

export const TOPIC_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const GROUP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COLLECTION = /^[A-Za-z0-9_-]+$/;
const KEY = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/;
const LEVELS = ['warn', 'block'];
const MAX_WORDS = 40;

const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** A page's name in a topic: "<collection>/<entry id>", or null when it is not one. */
export function refOf(v) {
  const s = str(v);
  const i = s.indexOf('/');
  if (i < 1 || i === s.length - 1 || !COLLECTION.test(s.slice(0, i)) || /\s|\.\.|^\/|\/$/.test(s.slice(i + 1))) return null;
  return s;
}
export const splitRef = (ref) => ({ collection: ref.slice(0, ref.indexOf('/')), id: ref.slice(ref.indexOf('/') + 1) });

/** A slug for a name: lowercase letters, digits and hyphens. */
export const slugOf = (name) =>
  String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'topic';

const words = (v) =>
  [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((w) => str(w)).filter(Boolean))].slice(0, MAX_WORDS);

/**
 * `topics` of the site config: null (off), or {dir, collections, money: {pageTypes, paths}, follow, sponsored,
 * generic, keywords, robots, enough, related}. `collections`: [{id, hasUrl}]; `pageTypes`: the site's (or null).
 * `related`: null, or {command: [argv], timeoutSeconds}, the site's own finder of the words that name a page (an
 * embeddings index, an AI model; docs/API-LINKS.md), used with the phrase match.
 */
export function topicsConfigOf(raw, { collections = [], pageTypes = null, fail = (m) => {
  throw new Error(m);
} } = {}) {
  if (raw === undefined || raw === null || raw === false) return null;
  const r = raw === true ? {} : raw;
  if (!plain(r)) fail('topics must be true or {dir?, collections?, money?, follow?, sponsored?, generic?, keywords?, robots?, enough?, related?}.');
  const dir = r.dir ?? 'markstage/topics';
  if (typeof dir !== 'string' || !dir.trim() || dir.split(/[\\/]/).includes('..') || dir.startsWith('/')) fail('topics.dir must be a folder inside the project, such as "markstage/topics".');
  const ids = collections.map((c) => c.id);
  const colls = r.collections ?? collections.filter((c) => c.hasUrl !== false).map((c) => c.id);
  if (!Array.isArray(colls) || colls.some((c) => !ids.includes(c))) fail(`topics.collections names collections of the site (${ids.join(', ')}).`);
  const money = { pageTypes: [], paths: [] };
  // a list, one value, or the normalized {pageTypes, paths} (the server checks the config core made once more)
  const given = plain(r.money) ? [...(r.money.pageTypes ?? []), ...(r.money.paths ?? [])] : Array.isArray(r.money) ? r.money : r.money === undefined ? [] : [r.money];
  for (const m of given) {
    if (typeof m !== 'string' || !m.trim()) fail('topics.money lists page types (such as "service") or site paths (such as "/services/").');
    if (m.startsWith('/')) money.paths.push(m.trim());
    else {
      if (pageTypes && !pageTypes.types.some((t) => t.id === m)) fail(`topics.money: "${m}" is not a page type of the site.`);
      money.pageTypes.push(m.trim());
    }
  }
  const domains = (v, what) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((d) => typeof d !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d.trim()))) fail(`topics.${what} lists domains, such as "docs.example.com".`);
    return v.map((d) => d.trim().toLowerCase().replace(/^www\./, ''));
  };
  const key = (v, d, what) => {
    if (v === undefined) return d;
    if (v !== null && (typeof v !== 'string' || !KEY.test(v))) fail(`topics.${what} must be a key, such as "${d}".`);
    return v;
  };
  const enough = r.enough ?? 3;
  if (!Number.isInteger(enough) || enough < 1 || enough > 50) fail('topics.enough is a whole number from 1 to 50.');
  let related = null;
  if (r.related !== undefined && r.related !== null) {
    const c = r.related?.command;
    if (!plain(r.related) || !Array.isArray(c) || !c.length || c.some((x) => typeof x !== 'string' || !x)) fail('topics.related must be { command: ["node", "scripts/related.mjs"] } (argv, no shell).');
    const t = r.related.timeoutSeconds ?? 20;
    if (!Number.isFinite(t) || t <= 0 || t > 300) fail('topics.related.timeoutSeconds is a number of seconds from 1 to 300.');
    related = { command: [...c], timeoutSeconds: t };
  }
  return {
    dir: dir.trim().replace(/\/+$/, ''),
    collections: [...colls],
    money,
    follow: domains(r.follow, 'follow'),
    sponsored: domains(r.sponsored, 'sponsored'),
    generic: words(r.generic).map((w) => w.toLowerCase()),
    keywords: key(r.keywords, 'keywords', 'keywords'),
    robots: key(r.robots, 'robots', 'robots'),
    enough,
    related,
  };
}

/** The browser's part: which collections, the money rules, the outside-link lists. */
export function topicsClientConfig(cfg) {
  const t = cfg.topics;
  return { topics: t ? { collections: t.collections, money: t.money, follow: t.follow, sponsored: t.sponsored, enough: t.enough } : null };
}

/** A topic from its file's data, normalized: {id, title, description, pillar, money, anchors, keywords, members, groups}. */
export function topicOf(id, data) {
  const d = plain(data) ? data : {};
  const refs = (v) => [...new Set((Array.isArray(v) ? v : []).map(refOf).filter(Boolean))];
  const seen = new Set();
  const groups = (Array.isArray(d.groups) ? d.groups : []).filter(plain).map((g) => {
    const name = str(g.name) || 'Group';
    let gid = typeof g.id === 'string' && GROUP_ID.test(g.id) ? g.id : slugOf(name);
    for (let n = 2; seen.has(gid); n++) gid = `${slugOf(name)}-${n}`;
    seen.add(gid);
    return { id: gid, name, lead: refOf(g.lead), members: refs(g.members) };
  });
  return {
    id,
    title: str(d.title) || id,
    description: str(d.description),
    pillar: refOf(d.pillar),
    money: refOf(d.money),
    anchors: words(d.anchors),
    keywords: words(d.keywords),
    members: refs(d.members),
    groups,
  };
}

/** The file data of a topic (key order kept stable, so a change is a small diff). */
export function topicData(t) {
  return {
    title: t.title,
    ...(t.description ? { description: t.description } : {}),
    pillar: t.pillar ?? null,
    money: t.money ?? null,
    anchors: t.anchors ?? [],
    keywords: t.keywords ?? [],
    members: t.members ?? [],
    groups: (t.groups ?? []).map((g) => ({ id: g.id, name: g.name, lead: g.lead ?? null, members: g.members ?? [] })),
  };
}

/** Every page a topic names, with its place: [{ref, group, role: 'pillar' | 'lead' | 'member'}] (money is not a member). */
export function placesIn(t) {
  const out = [];
  if (t.pillar) out.push({ ref: t.pillar, group: null, role: 'pillar' });
  for (const r of t.members) out.push({ ref: r, group: null, role: 'member' });
  for (const g of t.groups) {
    if (g.lead) out.push({ ref: g.lead, group: g.id, role: 'lead' });
    for (const r of g.members) out.push({ ref: r, group: g.id, role: 'member' });
  }
  return out;
}

/** ref -> {topic, group, role} over every topic (the first place wins when a page is named twice; topicProblems says so). */
export function topicMap(topics) {
  const m = new Map();
  for (const t of topics) for (const p of placesIn(t)) if (!m.has(p.ref)) m.set(p.ref, { topic: t.id, group: p.group, role: p.role });
  return m;
}

/**
 * What is wrong with a topic about to be written, as {field: message} (empty when nothing is). `known(ref)`: is it a
 * page of the site; `others`: the other topics (a page belongs to one topic at most).
 */
export function topicProblems(t, { known = () => true, others = [] } = {}) {
  const bad = {};
  if (!str(t.title)) bad.title = 'Give the topic a name.';
  const elsewhere = topicMap(others);
  const seen = new Map();
  const where = (p) => (p.role === 'pillar' ? 'main page' : p.role === 'lead' ? 'group lead' : 'page');
  for (const p of placesIn(t)) {
    const field = p.role === 'pillar' ? 'pillar' : p.group ? `groups.${p.group}` : 'members';
    if (!known(p.ref)) bad[field] ??= `${p.ref} is not a page of the site.`;
    else if (seen.has(p.ref)) bad[field] ??= `${p.ref} is in this topic twice (as ${where(seen.get(p.ref))} and as ${where(p)}).`;
    else if (elsewhere.has(p.ref)) bad[field] ??= `${p.ref} is in the topic “${others.find((o) => o.id === elsewhere.get(p.ref).topic)?.title}” already. A page belongs to one topic.`;
    seen.set(p.ref, p);
  }
  if (t.money && !known(t.money)) bad.money = `${t.money} is not a page of the site.`;
  return bad;
}

/** The topic without this page anywhere in it (and not as its money page when `money`). A new object; null when unchanged. */
export function withoutPage(t, ref, { money = false } = {}) {
  let changed = false;
  const drop = (list) => list.filter((r) => (r === ref ? ((changed = true), false) : true));
  const out = {
    ...t,
    pillar: t.pillar === ref ? ((changed = true), null) : t.pillar,
    money: money && t.money === ref ? ((changed = true), null) : t.money,
    members: drop(t.members),
    groups: t.groups.map((g) => ({ ...g, lead: g.lead === ref ? ((changed = true), null) : g.lead, members: drop(g.members) })),
  };
  return changed ? out : null;
}

/**
 * Put a page in a topic: as its main page (`role: 'pillar'`), as a group's lead (`role: 'lead'`, with `group`), or as
 * a member of a group (`group`) or of no group. The page leaves every other place, in this topic and the others; a
 * main page or lead it replaces stays in the topic as a member. `index`: its place in the list (end when left out).
 * Returns {changed: [topic], from: {topic, group, role} | null}.
 */
export function placePage(topics, ref, { topic, group = null, role = 'member', index = null }) {
  const was = topicMap(topics).get(ref) ?? null;
  const changed = new Map();
  for (const t of topics) {
    const w = withoutPage(changed.get(t.id) ?? t, ref);
    if (w) changed.set(t.id, w);
  }
  if (topic) {
    const base = changed.get(topic) ?? topics.find((t) => t.id === topic);
    if (!base) throw new Error(`There is no topic “${topic}”.`);
    const t = { ...base, members: [...base.members], groups: base.groups.map((g) => ({ ...g, members: [...g.members] })) };
    const put = (list) => list.splice(index === null || index < 0 || index > list.length ? list.length : index, 0, ref);
    if (role === 'pillar') {
      if (t.pillar && t.pillar !== ref) t.members.unshift(t.pillar);
      t.pillar = ref;
    } else {
      const g = group ? t.groups.find((x) => x.id === group) : null;
      if (group && !g) throw new Error(`The topic “${t.title}” has no group “${group}”.`);
      if (role === 'lead') {
        if (!g) throw new Error('A lead page leads a group: name the group.');
        if (g.lead && g.lead !== ref) g.members.unshift(g.lead);
        g.lead = ref;
      } else put(g ? g.members : t.members);
    }
    changed.set(topic, t);
  }
  return { changed: [...changed.values()], from: was };
}

/** What a page type check `links` names: the page's own topic links it must have, or the link problems it must not. */
export const LINK_CHECKS = ['pillar', 'lead', 'money', 'anchors', 'redirects', 'outside'];

/** A page type check of kind `links` ({links: 'pillar'}), for page-types.mjs. */
export function linkCheckOf(v, where, fail) {
  if (!LINK_CHECKS.includes(v)) fail(`${where}: links is one of ${LINK_CHECKS.join(', ')}.`);
  return v;
}

export { LEVELS as LINK_LEVELS };
