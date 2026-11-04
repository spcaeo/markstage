// The Topic map's routes (docs/API-LINKS.md): the site's topics as files, and where each page sits in them.
// Every change is one commit by the signed-in person. Everyone signed in may look; editors and above change.
//   GET    /topics                       {items: [Topic], pages: [PageRow], can: {manage}}
//   GET    /topics/:id                   {topic: Topic, pages: [PageRow], can}
//   POST   /topics {id?, title, …}       201 {topic}                 a page already in another topic: 422
//   PUT    /topics/:id {version, …}      {topic}                     409 when it changed since
//   DELETE /topics/:id?version=          {ok, commit}                its pages are in no topic afterwards
//   POST   /topics/place {ref, topic, group?, role?, index?}   {changed: [id], topic, from}   the Page box and drag:
//                                        the page leaves every other place; topic null takes it out of all of them
// Topic = {id, version, title, description, pillar, money, anchors, keywords, members, groups: [{id, name, lead,
// members}], counts: {pages, live, weak}}; PageRow = {ref, collection, id, title, url, status, live, topic, group,
// role, money, in, out, external, updated, published, modified}.
import { can } from '../roles.mjs';
import { HttpError, badRequest, conflict, forbidden } from '../util.mjs';
import { nameCheck } from '../content/limits.mjs';

const FIELDS = ['title', 'description', 'pillar', 'money', 'anchors', 'keywords', 'members', 'groups'];

export function topicsRoutes(router, app, { core, files, lm, rowOf, authorOf }) {
  const { git, repoLock, audit } = app;
  const T = core.topics;
  const mayManage = (user) => can(user, 'topics.manage');
  const needManage = (ctx, what) => {
    if (!mayManage(ctx.user)) throw forbidden(`Only editors and above can ${what}.`);
  };

  function shown(f, map) {
    const refs = T.placesIn(f.topic).map((p) => p.ref);
    const rows = refs.map((r) => map.pages.get(r)).filter(Boolean);
    return { ...f.topic, version: f.version, counts: { pages: rows.length, live: rows.filter((r) => r.live).length, weak: rows.filter((r) => r.live && r.in <= 1).length } };
  }

  /** The topic from a body (whole for a new one, a patch over `base` for a change), checked: 422 with fields. */
  function topicFrom(id, body, base, map, others) {
    nameCheck(body?.title, 'title', 'The topic name');
    const merged = { ...(base ? T.topicData(base) : {}) };
    for (const k of FIELDS) if (body?.[k] !== undefined) merged[k] = body[k];
    const t = T.topicOf(id, merged);
    if ((body?.title !== undefined || !base) && !String(body?.title ?? '').trim()) t.title = '';
    const bad = T.topicProblems(t, { known: (r) => map.pages.has(r), others });
    if (Object.keys(bad).length) throw new HttpError(422, 'invalid', Object.values(bad)[0], { fields: bad });
    return t;
  }

  const sameVersion = (f, version) => {
    if (version === undefined || version === null || version === '') throw badRequest('Send the version you opened: a change is checked against it.');
    if (version !== f.version) throw conflict('This topic changed since you opened it. Reload to see the latest.', { version: f.version });
  };

  router.add('GET', '/topics', async (ctx) => {
    const map = await lm.fresh();
    // ?pages=0: the topics alone (a picker on an open entry needs no page rows)
    const pages = ctx.query.get('pages') === '0' ? [] : [...map.pages.values()].map(rowOf);
    return { items: files.all().map((f) => shown(f, map)), pages, can: { manage: mayManage(ctx.user) } };
  });

  router.add('GET', '/topics/:id', async (ctx) => {
    const f = files.read(ctx.params.id);
    const map = await lm.fresh();
    const refs = new Set(T.placesIn(f.topic).map((p) => p.ref));
    return { topic: shown(f, map), pages: [...map.pages.values()].filter((p) => refs.has(p.ref)).map(rowOf), can: { manage: mayManage(ctx.user) } };
  });

  router.add('POST', '/topics', async (ctx) => {
    needManage(ctx, 'add topics');
    const given = ctx.body?.id;
    const id = given === undefined || given === null || given === '' ? T.slugOf(ctx.body?.title) : String(given);
    if (!T.TOPIC_ID.test(id)) throw new HttpError(422, 'invalid', 'The topic’s id must be lowercase letters, digits and hyphens.', { fields: { id: 'Use a-z, 0-9 and hyphens.' } });
    const out = await repoLock.run(async () => {
      if (files.exists(id)) throw new HttpError(409, 'id-taken', `There is a topic “${id}” already.`, { id });
      // inside the repo lock: the map as it is (asking the redirects hook takes the lock too)
      const map = lm.current();
      const t = topicFrom(id, ctx.body, null, map, files.all().map((f) => f.topic));
      const w = files.write(t);
      const commit = await git.commit([w.rel], `Add topic ${t.title}`, authorOf(ctx.user));
      audit.log(ctx, 'topic.create', { target: `topics/${id}`, detail: { commit } });
      return files.read(id);
    });
    ctx.status = 201;
    return { topic: shown(out, await lm.fresh()) };
  });

  router.add('PUT', '/topics/:id', async (ctx) => {
    needManage(ctx, 'change topics');
    const out = await repoLock.run(async () => {
      const cur = files.read(ctx.params.id);
      sameVersion(cur, ctx.body?.version);
      const map = lm.current();
      const t = topicFrom(cur.id, ctx.body, cur.topic, map, files.all().filter((f) => f.id !== cur.id).map((f) => f.topic));
      const w = files.write(t);
      if (w.version === cur.version) return cur;
      const commit = await git.commit([w.rel], `Update topic ${t.title}`, authorOf(ctx.user));
      audit.log(ctx, 'topic.update', { target: `topics/${cur.id}`, detail: { commit, fields: FIELDS.filter((k) => ctx.body?.[k] !== undefined) } });
      return files.read(cur.id);
    });
    return { topic: shown(out, await lm.fresh()) };
  });

  router.add('DELETE', '/topics/:id', async (ctx) => {
    needManage(ctx, 'delete topics');
    const commit = await repoLock.run(async () => {
      const cur = files.read(ctx.params.id);
      sameVersion(cur, ctx.query.get('version'));
      const r = files.remove(cur.id);
      const sha = await git.commit([r.rel], `Delete topic ${cur.topic.title}`, authorOf(ctx.user));
      audit.log(ctx, 'topic.delete', { target: `topics/${cur.id}`, detail: { commit: sha } });
      return sha;
    });
    return { ok: true, commit };
  });

  router.add('POST', '/topics/place', async (ctx) => {
    needManage(ctx, 'put pages in topics');
    const ref = T.refOf(ctx.body?.ref);
    const topic = ctx.body?.topic ?? null;
    const role = ctx.body?.role ?? 'member';
    if (!ref) throw new HttpError(422, 'invalid', 'Say which page (ref "<collection>/<id>").', { fields: { ref: 'Which page?' } });
    if (!['member', 'lead', 'pillar'].includes(role)) throw new HttpError(422, 'invalid', 'role is member, lead or pillar.', { fields: { role: 'member, lead or pillar' } });
    const index = Number.isInteger(ctx.body?.index) ? ctx.body.index : null;
    const out = await repoLock.run(async () => {
      const map = lm.current();
      const page = map.pages.get(ref);
      if (!page) throw new HttpError(422, 'invalid', `${ref} is not a page of a topic collection.`, { fields: { ref: 'Not a page here.' } });
      const all = files.all();
      let r;
      try {
        r = T.placePage(all.map((f) => f.topic), ref, { topic, group: ctx.body?.group ?? null, role, index });
      } catch (e) {
        throw new HttpError(422, 'invalid', e.message);
      }
      if (!r.changed.length) return { changed: [], from: r.from };
      const before = new Map(all.map((f) => [f.id, f.text]));
      const rels = [];
      try {
        for (const t of r.changed) rels.push(files.write(t).rel);
      } catch (e) {
        for (const t of r.changed) files.restore(t.id, before.get(t.id) ?? null);
        throw e;
      }
      const to = topic ? r.changed.find((t) => t.id === topic) : null;
      const what = to ? `Put “${page.title}” in topic ${to.title}${role === 'member' ? '' : ` as its ${role === 'pillar' ? 'main page' : 'group lead'}`}` : `Take “${page.title}” out of its topic`;
      const commit = await git.commit(rels, what.slice(0, 200), authorOf(ctx.user));
      audit.log(ctx, 'topic.place', { target: ref, detail: { commit, topic, group: ctx.body?.group ?? null, role, from: r.from } });
      return { changed: r.changed.map((t) => t.id), from: r.from, commit };
    });
    const map = await lm.fresh();
    return { ...out, topic: topic ? shown(files.read(topic), map) : null, page: map.pages.has(ref) ? rowOf(map.pages.get(ref)) : null };
  });
}
