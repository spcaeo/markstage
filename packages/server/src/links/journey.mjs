// One topic as a journey (docs/API-LINKS.md, the Topic map's Journey view): its pages in the order a reader travels
// (articles, group leads, the main page, the service page), every link in their text between them and to and from
// other pages, with the words and the sentence of each and what Health says about it (vague words, words used for two
// pages, a redirect, a hidden or missing page), and the links the topic expects that are not there yet, each with
// the suggestion that adds it when one sentence fits.
//   GET /links/map?topic=<id>   {topic, pages: [JourneyPage], edges: [Edge], missing: [Missing], numbers}
// JourneyPage = PageRow + {place: 'member' | 'lead' | 'pillar' | 'money' | 'outside', problems: [kind], leads?};
// Edge = {id, pair, from, to (null: no page), anchor, sentence, at, section, status, href, address, open, warn};
// Missing = {id, kind, from, to, message, suggestion: Suggestion | null, open};
// numbers = {visits: false, leads: boolean}: Markstage keeps no visit counts; `leads` (the site's form messages whose
// visit began on the page) only when the site has form messages at all, so a zero is a real zero.
import { HttpError } from '../util.mjs';

// what a card is marked with (Health's kinds): no links in, one link in, no link up to the main page or group lead
const PROBLEMS = new Set(['no-links-in', 'weak', 'no-pillar-link', 'no-lead-link']);
// what a link is marked with: its words, and where it ends
const WARNS = new Set(['generic-anchor', 'anchor-clash', 'to-redirect', 'to-noindex', 'to-missing']);
const linkKey = (ref, path, start, anchor) => `${ref}\u0001${[].concat(path ?? []).join('.')}\u0001${start ?? ''}\u0001${anchor ?? ''}`;

export function journeyRoute(router, { core, lm, rowOf, editUrl, skipped, findingsOf, db }) {
  router.add('GET', '/links/map', async (ctx) => {
    const id = ctx.query.get('topic');
    if (!id) throw new HttpError(400, 'bad-request', 'Say which topic: /links/map?topic=<id>.');
    const map = await lm.fresh();
    const t = map.topics.get(id);
    if (!t) throw new HttpError(404, 'not-found', `There is no topic “${id}”.`);
    const { money, moneyGuessed } = moneyOf(core, map, t);

    // the topic's own pages with their place on the journey, then the pages its links come from or go to
    const place = new Map();
    for (const g of t.groups) for (const r of g.members) place.set(r, 'member');
    for (const r of t.members) place.set(r, 'member');
    for (const g of t.groups) if (g.lead) place.set(g.lead, 'lead');
    if (t.pillar) place.set(t.pillar, 'pillar');
    if (money && !place.has(money)) place.set(money, 'money');
    for (const r of [...place.keys()]) if (!map.pages.has(r)) place.delete(r);
    // links between pages, and the topic's own links that end on no page (broken, or a redirect off the site)
    const edges = map.edges.filter((e) => (e.to ? place.has(e.from) || place.has(e.to) : place.has(e.from)));
    for (const e of edges) for (const r of [e.from, e.to]) if (r && !place.has(r) && map.pages.has(r)) place.set(r, 'outside');

    const problems = new Map();
    const warns = new Map();
    for (const f of findingsOf(map)) {
      if (!place.has(f.ref)) continue;
      if (WARNS.has(f.kind)) {
        const k = linkKey(f.ref, f.path, f.start, f.anchor);
        warns.set(k, [...(warns.get(k) ?? []), { kind: f.kind, message: f.message }]);
      }
      if (PROBLEMS.has(f.kind) && place.get(f.ref) !== 'outside') problems.set(f.ref, [...(problems.get(f.ref) ?? []), f]);
    }
    const leads = leadsByPath(core, db);
    const pages = [...place].map(([ref, where]) => {
      const row = rowOf(map.pages.get(ref));
      return { ...row, place: where, problems: [...new Set((problems.get(ref) ?? []).map((f) => f.kind))], ...(leads ? { leads: leads.get(core.map.pathKey(row.url ?? '\0')) ?? 0 } : {}) };
    });

    const shownEdges = edges.map((e) => {
      const from = map.pages.get(e.from);
      const at = e.anchor && e.sentence ? e.sentence.indexOf(e.anchor) : -1;
      return {
        id: core.map.hashId('le', e.from, e.to ?? e.address, [].concat(e.path ?? []).join('.'), e.start ?? '', e.anchor),
        pair: core.map.hashId('lp', e.from, e.to ?? `\u0000${e.address}`),
        from: e.from,
        to: e.to,
        anchor: e.anchor,
        sentence: e.sentence,
        at: at >= 0 ? at : null,
        section: e.section || null,
        status: e.status,
        href: e.href,
        address: e.address,
        open: editUrl(from, e.block ?? null, e.anchor || null),
        // a draft's links are not checked (Health looks at live pages only)
        warn: warns.get(linkKey(e.from, e.path, e.start, e.anchor)) ?? [],
      };
    });

    // the links the topic expects that are not there: up to the group lead and the main page (Health), and from the
    // group leads and the main page on to the service page; each with the suggestion that adds it (none when skipped)
    const skip = skipped();
    const missing = [];
    const want = (kind, from, to, message, findingId = null) => {
      const sg = core.suggest.outgoingSuggestions(map, from, { skipped: skip, limit: 50 }).find((s) => s.to === to) ?? null;
      const page = map.pages.get(from);
      missing.push({
        id: findingId ?? core.map.hashId('lf', kind, from, to),
        kind,
        from,
        to,
        message,
        suggestion: sg ? { ...sg, open: editUrl(page, sg.path?.[0] ?? null, sg.how === 'link' ? sg.anchor : null) } : null,
        open: editUrl(page),
      });
    };
    for (const list of problems.values()) for (const f of list) if (f.kind === 'no-pillar-link' || f.kind === 'no-lead-link') want(f.kind, f.ref, f.target, f.message, f.id);
    if (money) {
      for (const ref of [...t.groups.map((g) => g.lead), t.pillar]) {
        const p = ref ? map.pages.get(ref) : null;
        if (p && ref !== money && p.live && !p.to.has(money)) want('no-money-link', ref, money, `Does not link to the service page, “${map.pages.get(money).title}”.`);
      }
    }

    return {
      topic: { id: t.id, title: t.title, pillar: map.pages.has(t.pillar) ? t.pillar : null, money, moneyGuessed, groups: t.groups.map((g) => ({ id: g.id, name: g.name, lead: g.lead })) },
      pages,
      edges: shownEdges,
      missing,
      numbers: { visits: false, leads: !!leads },
    };
  });
}

/**
 * Form messages (not spam) by the site path their visit began on (its landing page, else the page it was sent
 * from); null when the site has none at all, so a page's 0 is never a guess.
 */
function leadsByPath(core, db) {
  let rows;
  try {
    rows = db.prepare("SELECT meta FROM form_messages WHERE spam IS NULL AND status != 'spam'").all();
  } catch {
    return null;
  }
  if (!rows.length) return null;
  const out = new Map();
  for (const r of rows) {
    let meta = {};
    try {
      meta = JSON.parse(r.meta);
    } catch {
      continue;
    }
    const where = meta.landing || meta.page;
    if (!where) continue;
    let path;
    try {
      path = new URL(String(where), 'https://site.invalid').pathname;
    } catch {
      continue;
    }
    const k = core.map.pathKey(path);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * The topic's service page: its own; else its main page when that is a service page itself; else the service page
 * outside the topic its pages link to most (`moneyGuessed`: the topic does not name one). Never one of its articles,
 * even when the site counts every page under a service address as a service page.
 */
function moneyOf(core, map, t) {
  if (t.money && map.pages.has(t.money)) return { money: t.money, moneyGuessed: false };
  if (t.pillar && map.pages.get(t.pillar)?.money) return { money: t.pillar, moneyGuessed: false };
  const mine = new Set(core.topics.placesIn(t).map((p) => p.ref));
  const votes = new Map();
  for (const e of map.edges) if (e.to && mine.has(e.from) && !mine.has(e.to) && map.pages.get(e.to)?.money) votes.set(e.to, (votes.get(e.to) ?? 0) + 1);
  const best = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? { money: best[0], moneyGuessed: true } : { money: null, moneyGuessed: false };
}
