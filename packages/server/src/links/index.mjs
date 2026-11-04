// Topics and internal links (docs/API-LINKS.md): the site's topics as files (topics-routes.mjs), the link map of
// every page's text (map.mjs, core's link-map.mjs), what to fix (Health), and link suggestions both ways with a
// one-click Accept that changes the other page as a normal save would (rights, locks, the site's checks, and the
// publish rules for a live page), in one commit with Undo.
//   GET    /links/pages?topic=&q=               {items: [PageRow], topics: [{id, title}]}
//   GET    /links/health?topic=&kind=&ref=      {items: [Finding], counts: {<kind>: n}, kinds: {<kind>: words}, total}
//   GET    /links/suggest?ref=&dir=in|out       {in: [Suggestion], out: [Suggestion], page: PageRow}
//   GET    /links/inbox?topic=                  {items: [Suggestion], counts: {total, in, out, topics}, skipped}
//   GET    /links/map?topic=                    one topic as a journey: its pages, the links between them with their
//                                               words and sentences, and the links it expects (journey.mjs)
//   POST   /links/accept {id, from, to, dir}    {ok, commit, job, from, to, anchor}   409 suggestion-gone
//   POST   /links/skip {id, from, to, anchor}   {ok}          remembered for everyone (the inbox leaves it out)
//   GET    /links/skips                         {items: [{id, from, to, anchor, at, by}]}
//   DELETE /links/skips/:id                     {ok}          offered again
//   POST   /links/fix {id}                      {ok, commit, job}   a finding's one-click fix: a link's new address
//                                               (it redirected) or rel, a gone page out of its topic
// A page's link checks for its type (page type checks `links: 'pillar'`, …) and the publish sheet's links part come
// from here too (linkChecks, preflight).
import { can } from '../roles.mjs';
import { HttpError, forbidden, nowIso } from '../util.mjs';
import { createTopicFiles, topicsConfig } from './files.mjs';
import { journeyRoute } from './journey.mjs';
import { createLinkMap } from './map.mjs';
import { topicsRoutes } from './topics-routes.mjs';

const off = {
  enabled: false,
  linkChecks: () => null,
  preflight: () => null,
  routes: (router) => {
    const none = () => {
      throw new HttpError(404, 'no-topics', 'This site keeps no topics (site config `topics`).');
    };
    for (const p of ['/topics', '/links/pages', '/links/health', '/links/inbox', '/links/suggest', '/links/map']) router.add('GET', p, none);
  },
};

export async function createLinks(app, entries) {
  const loaded = await topicsConfig(app.config);
  if (!loaded) return off;
  const { core, cfg } = loaded;
  const files = createTopicFiles(app.config, loaded);
  const lm = createLinkMap(app, { core, cfg, files });
  const { store, db, audit, repoLock, converter } = app;
  const derived = new WeakMap();
  // the inbox per map object and skip-list version (a skip, an unskip or an accept moves it)
  let skipsRev = 0;

  /** The findings of a map (worked out once per map). */
  function findingsOf(map) {
    if (!derived.has(map)) derived.set(map, { findings: core.map.linkFindings(map), inbox: new Map() });
    return derived.get(map).findings;
  }

  /** The inbox of a map for a topic (worked out once per map and skip-list version: the suggestions of every page). */
  function inboxOf(map, topic) {
    findingsOf(map);
    const box = derived.get(map).inbox;
    const key = `${skipsRev}\0${topic ?? ''}`;
    if (!box.has(key)) {
      if (box.size > 50) box.clear();
      box.set(key, core.suggest.linkInbox(map, { skipped: skipped(), topic }));
    }
    return box.get(key);
  }
  const skipped = () => new Set(db.prepare('SELECT id FROM link_skips').all().map((r) => r.id));
  const editUrl = (p, block = null, find = null) => {
    const q = new URLSearchParams();
    if (block !== null && block !== undefined) q.set('b', String(block));
    if (find) q.set('find', find);
    const s = q.toString();
    return `#/${p.format === 'json' ? 'p' : 'e'}/${p.collection}/${p.id}${s ? `?${s}` : ''}`;
  };
  const rowOf = (p) => ({ ref: p.ref, collection: p.collection, id: p.id, title: p.title, url: p.url, status: p.status, live: p.live, noindex: p.noindex, format: p.format, topic: p.topic, group: p.group, role: p.role, money: p.money, in: p.in, out: p.out, external: p.external, updated: p.updated ?? null, published: p.published ?? null, modified: p.modified ?? null, edit: editUrl(p) });
  const named = (map, ref) => {
    const p = map.pages.get(ref);
    return p ? { title: p.title, url: p.url, edit: editUrl(p) } : { title: ref, url: null, edit: null };
  };
  const shownFinding = (map, f) => {
    const p = map.pages.get(f.ref);
    return { ...f, page: named(map, f.ref), ...(f.target ? { targetPage: named(map, f.target) } : {}), open: p ? editUrl(p, f.path?.[0] ?? null, f.anchor || null) : null };
  };
  const authorOf = (user) => entries.authorOf(user);

  function routes(router) {
    topicsRoutes(router, app, { core, files, lm, rowOf, authorOf });
    journeyRoute(router, { core, lm, rowOf, editUrl, skipped, findingsOf, db });

    router.add('GET', '/links/pages', async (ctx) => {
      const map = await lm.fresh();
      const topic = ctx.query.get('topic');
      const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
      const items = [...map.pages.values()]
        .filter((p) => !topic || (topic === '-' ? !p.topic : p.topic === topic))
        .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.url ?? '').toLowerCase().includes(q))
        .map(rowOf);
      return { items, topics: [...map.topics.values()].map((t) => ({ id: t.id, title: t.title })) };
    });

    router.add('GET', '/links/health', async (ctx) => {
      const map = await lm.fresh();
      const topic = ctx.query.get('topic');
      const kind = ctx.query.get('kind');
      const ref = ctx.query.get('ref');
      const all = findingsOf(map).filter((f) => (!topic || f.topic === topic) && (!ref || f.ref === ref));
      const counts = {};
      for (const f of all) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
      return { items: all.filter((f) => !kind || f.kind === kind).map((f) => shownFinding(map, f)), counts, total: all.length, kinds: core.map.FINDING_KINDS, topics: [...map.topics.values()].map((t) => ({ id: t.id, title: t.title })) };
    });

    router.add('GET', '/links/suggest', async (ctx) => {
      const ref = ctx.query.get('ref');
      lm.current();
      await lm.relatedFor(ref);
      const map = await lm.fresh();
      const page = map.pages.get(ref);
      if (!page) throw new HttpError(404, 'not-found', 'That page is not in the link map (its collection has no topics).');
      const skip = skipped();
      const dir = ctx.query.get('dir');
      return {
        page: rowOf(page),
        in: dir === 'out' ? [] : core.suggest.incomingSuggestions(map, ref, { skipped: skip }).map((s) => ({ ...s, open: editUrl(map.pages.get(s.from), s.path?.[0], s.anchor) })),
        out: dir === 'in' ? [] : core.suggest.outgoingSuggestions(map, ref, { skipped: skip }).map((s) => ({ ...s, open: editUrl(page, s.path?.[0] ?? null, s.how === 'link' ? s.anchor : null) })),
      };
    });

    router.add('GET', '/links/inbox', async (ctx) => {
      const map = await lm.fresh();
      const r = inboxOf(map, ctx.query.get('topic') || null);
      const perPage = Math.min(Math.max(Number(ctx.query.get('perPage')) || 0, 0), 500);
      const page = Math.max(Number(ctx.query.get('page')) || 1, 1);
      const items = perPage ? r.items.slice((page - 1) * perPage, page * perPage) : r.items;
      return { ...r, items: items.map((s) => ({ ...s, open: editUrl(map.pages.get(s.from), s.path?.[0], s.anchor) })), ...(perPage ? { page, perPage } : {}), skipped: db.prepare('SELECT COUNT(*) AS n FROM link_skips').get().n };
    });

    router.add('POST', '/links/accept', async (ctx) => {
      const { id, from, to, dir } = ctx.body ?? {};
      if (typeof id !== 'string' || typeof from !== 'string' || typeof to !== 'string' || !['in', 'out'].includes(dir)) throw new HttpError(400, 'bad-request', 'This suggestion is incomplete. Reload the page and try again.');
      const map = await lm.fresh();
      const list = dir === 'in' ? core.suggest.incomingSuggestions(map, to, { limit: 500 }) : core.suggest.outgoingSuggestions(map, from, { limit: 500 });
      const sg = list.find((s) => s.id === id);
      if (!sg) throw new HttpError(409, 'suggestion-gone', 'One of the pages changed since, so this suggestion is gone. Look at the list again.');
      if (sg.how !== 'link') throw new HttpError(422, 'needs-words', `“${sg.fromTitle}” has no sentence for this link yet. Open it and write one with the words “${sg.anchor}”.`);
      const target = map.pages.get(sg.to);
      const out = await applyEdit(ctx, sg.from, (doc) => core.suggest.linkWords(doc, { path: sg.path, start: sg.start, end: sg.end, expect: sg.anchor, href: target.url }), {
        message: `Link “${sg.anchor}” on ${sg.fromTitle} to ${sg.toTitle}`,
        action: 'links.accept',
        detail: { suggestion: id, to: sg.to, anchor: sg.anchor },
      });
      db.prepare('DELETE FROM link_skips WHERE id = ?').run(id);
      skipsRev++;
      return { ok: true, ...out, from: sg.from, to: sg.to, anchor: sg.anchor };
    });

    router.add('POST', '/links/skip', (ctx) => {
      const { id, from, to, anchor } = ctx.body ?? {};
      if (typeof id !== 'string' || !/^sg_[0-9a-z]+$/.test(id) || typeof from !== 'string' || typeof to !== 'string') throw new HttpError(400, 'bad-request', 'This suggestion is incomplete. Reload the page and try again.');
      db.prepare('INSERT OR IGNORE INTO link_skips (id, from_ref, to_ref, anchor, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, from.slice(0, 300), to.slice(0, 300), typeof anchor === 'string' ? anchor.slice(0, 200) : null, ctx.user.id, nowIso(app.clock()));
      audit.log(ctx, 'links.skip', { target: to, detail: { suggestion: id, from } });
      skipsRev++;
      return { ok: true };
    });

    router.add('GET', '/links/skips', () => ({
      items: db
        .prepare('SELECT s.id, s.from_ref, s.to_ref, s.anchor, s.created_at, u.name FROM link_skips s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 500')
        .all()
        .map((r) => ({ id: r.id, from: r.from_ref, to: r.to_ref, anchor: r.anchor, at: r.created_at, by: r.name ?? null })),
    }));

    router.add('DELETE', '/links/skips/:id', (ctx) => {
      db.prepare('DELETE FROM link_skips WHERE id = ?').run(ctx.params.id);
      audit.log(ctx, 'links.unskip', { target: ctx.params.id });
      skipsRev++;
      return { ok: true };
    });

    router.add('POST', '/links/fix', async (ctx) => {
      const map = await lm.fresh();
      const f = findingsOf(map).find((x) => x.id === ctx.body?.id);
      if (!f) throw new HttpError(409, 'finding-gone', 'This was fixed or changed since. Look at the list again.');
      if (f.fix?.kind === 'retarget' || f.fix?.kind === 'rel') {
        const change = f.fix.kind === 'retarget' ? { href: f.fix.href } : { rel: f.fix.rel };
        const out = await applyEdit(ctx, f.ref, (doc) => core.suggest.setLinkAt(doc, { path: f.path, start: f.start, end: f.end, ...change }), {
          message: f.fix.kind === 'retarget' ? `Point “${f.anchor}” on ${named(map, f.ref).title} to ${f.fix.href}` : `Mark the link to ${f.href} on ${named(map, f.ref).title} ${f.fix.rel}`,
          action: 'links.fix',
          detail: { finding: f.id, kind: f.kind, ...change },
        });
        return { ok: true, ...out };
      }
      if (f.fix?.kind === 'drop-page') {
        if (!can(ctx.user, 'topics.manage')) throw forbidden('Only editors and above can change topics.');
        const commit = await repoLock.run(async () => {
          const cur = files.read(f.fix.topic);
          const t = core.topics.withoutPage(cur.topic, f.ref, { money: true });
          if (!t) return null;
          const w = files.write(t);
          const sha = await app.git.commit([w.rel], `Take ${f.ref} out of topic ${cur.topic.title} (it is not a page any more)`, authorOf(ctx.user));
          audit.log(ctx, 'topic.update', { target: `topics/${cur.id}`, detail: { commit: sha, dropped: f.ref } });
          return sha;
        });
        return { ok: true, commit, job: null };
      }
      throw new HttpError(422, 'no-quick-fix', 'This one has no one-click fix. Open the page and change it there.');
    });
  }

  /**
   * Change one page's document (Markdown) as a save by this person would be: their rights, the locks, the site's
   * checks, and for a live page the publish rules; then one commit (Undo on the toast) and, when live, a build.
   */
  async function applyEdit(ctx, ref, edit, { message, action, detail }) {
    const i = ref.indexOf('/');
    const c = store.collection(ref.slice(0, i));
    const id = ref.slice(i + 1);
    if (c.format !== 'md') throw new HttpError(422, 'no-quick-fix', 'Only Markdown pages can be changed from here. Open the page and change it there.');
    const out = await repoLock.run(async () => {
      const cur = store.read(c, id);
      const doc = converter.mdToDoc(cur.text).doc;
      const next = edit(doc);
      if (!next) throw new HttpError(409, 'suggestion-gone', 'The page changed since, so these words are not there any more. Look at the list again.');
      const summary = store.summarize(c, id, cur.text);
      const h = { c, id, before: cur.text, after: app.many.stamped(c, cur.text, converter.docToMd(next, cur.text)), title: summary.title || id, status: summary.status ?? 'published' };
      const problem = await app.many.problemOf(ctx, h);
      if (problem) throw new HttpError(422, 'refused', `“${h.title}” cannot be changed: ${problem}`);
      if (!c.hasStatus || h.status === 'published') {
        // a live page keeps to the publish rules: what the change would newly stop (not what stopped it before)
        const was = new Set((app.publishRules?.blocking(c, id, h.before) ?? []).map((v) => `${v.rule}\u0001${v.check ?? ''}\u0001${v.message}`));
        const stop = (app.publishRules?.blocking(c, id, h.after) ?? []).filter((v) => !was.has(`${v.rule}\u0001${v.check ?? ''}\u0001${v.message}`));
        if (stop.length) throw new HttpError(422, 'blocked', `“${h.title}” is live, and this change would stop it going live: ${stop.map((v) => String(v.message).replace(/\.$/, '')).join('; ')}.`, { rules: stop });
      }
      const commit = await app.many.commitAll(ctx, [h], message.slice(0, 200));
      audit.log(ctx, action, { target: ref, detail: { commit, entries: [ref], ...detail } });
      return { h, commit };
    });
    const job = app.many.deploy(ctx, { kind: 'links', target: ref, list: [out.h], commit: out.commit });
    return { commit: out.commit, job };
  }

  /**
   * The answers to a page's `links` type checks ({pillar, lead, money, anchors, redirects, outside}: {ok, message}),
   * from the map as saved; null when the page is not in it.
   */
  function linkChecks(c, id) {
    const map = lm.current();
    const ref = `${c.id}/${id}`;
    const p = map.pages.get(ref);
    if (!p) return null;
    const t = p.topic ? map.topics.get(p.topic) : null;
    const g = t && p.group ? t.groups.find((x) => x.id === p.group) : null;
    const mine = findingsOf(map).filter((f) => f.ref === ref);
    const linksTo = (target, what) => {
      if (!target || target === ref) return { ok: true };
      return p.to.has(target) ? { ok: true } : { ok: false, message: `Link to ${what}, “${map.pages.get(target)?.title ?? target}”, from the text.` };
    };
    const none = (kinds, say) => {
      const hit = mine.filter((f) => kinds.includes(f.kind));
      return hit.length ? { ok: false, message: `${say(hit)} ${hit[0].message}` } : { ok: true };
    };
    const n = (h) => (h.length === 1 ? 'One link:' : `${h.length} links, such as:`);
    return {
      pillar: p.topic ? (t?.pillar ? linksTo(t.pillar, 'its topic’s main page') : { ok: true }) : { ok: false, message: 'Put the page in a topic first (Page settings), then link to its main page.' },
      lead: g?.lead && p.role === 'member' ? linksTo(g.lead, 'its group’s lead page') : { ok: true },
      money: (() => {
        const m = core.map.moneyFor(map, ref);
        return m ? linksTo(m, 'the topic’s service page') : { ok: true };
      })(),
      anchors: none(['anchor-clash', 'generic-anchor'], n),
      redirects: none(['to-redirect', 'to-noindex', 'to-missing'], n),
      outside: none(['outside-follow', 'outside-sponsored'], n),
    };
  }

  /** The publish sheet's links part: how many pages could link to this one, and what it should link to. */
  function preflight(c, id) {
    const map = lm.current();
    const ref = `${c.id}/${id}`;
    if (!map.pages.has(ref)) return null;
    const skip = skipped();
    const inc = core.suggest.incomingSuggestions(map, ref, { skipped: skip });
    const out = core.suggest.outgoingSuggestions(map, ref, { skipped: skip });
    const p = map.pages.get(ref);
    return { ref, topic: p.topic, in: p.in, incoming: inc.length, outgoing: out.length, review: `#/links?view=page&ref=${encodeURIComponent(ref)}` };
  }

  return { enabled: true, cfg, files, map: lm, routes, linkChecks, preflight };
}
