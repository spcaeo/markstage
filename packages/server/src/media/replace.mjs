// Replace an image everywhere it is used (docs/OPERATIONS.md): every entry that names the old file gets the new one,
// in one commit; the old file stays in the library (delete it later once unused). Editors and above, since it
// changes other people's entries. When a live entry changed, the site is rebuilt and deployed; if that fails, the
// entries are put back (unless someone changed them meanwhile), like any other publish.
//   GET  /media/:mid/replace?with=<mid>   what would change: [{collection, id, title, status, count, url}]
//   POST /media/:mid/replace {with}       do it: {commit, entries, job}
import { atLeast } from '../roles.mjs';
import { badRequest, forbidden, notFound } from '../util.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every mention of a media path in a text, as a whole path (not a part of a longer file name). */
export const mentions = (rel) => new RegExp(`(?<![\\w.-])${esc(rel)}(?![\\w.-])`, 'g');

export function replaceRoutes(router, app, { rowOf, relToMedia }) {
  const { db, store, git, repoLock, audit } = app;

  function plan(ctx) {
    if (!atLeast(ctx.user, 'editor')) throw forbidden('Only editors and above can replace an image in every entry.');
    const from = rowOf(ctx);
    const withId = ctx.body?.with ?? ctx.query.get('with');
    if (!withId) throw badRequest('Say which image replaces it (with).');
    const to = db.prepare('SELECT * FROM media WHERE id = ?').get(withId);
    if (!to) throw notFound('The new image is not in the library.');
    if (to.id === from.id) throw badRequest('That is the same image.');
    const re = mentions(relToMedia(from));
    const hits = [];
    for (const c of store.collections) {
      for (const id of store.ids(c)) {
        let text;
        try {
          text = store.read(c, id).text;
        } catch {
          continue;
        }
        const count = (text.match(re) ?? []).length;
        if (!count) continue;
        const s = store.summarize(c, id, text);
        hits.push({ c, id, text, title: s.title || id, status: s.status ?? 'published', count, url: s.url ?? null });
      }
    }
    return { from, to, re, hits };
  }
  const listOf = (hits) => hits.map(({ c, id, title, status, count, url }) => ({ collection: c.id, id, title, status, count, url }));

  router.add('GET', '/media/:mid/replace', (ctx) => ({ entries: listOf(plan(ctx).hits) }));

  router.add('POST', '/media/:mid/replace', async (ctx) => {
    const out = await repoLock.run(async () => {
      const p = plan(ctx);
      if (!p.hits.length) return { commit: null, entries: [], changed: [] };
      const toRel = relToMedia(p.to);
      const changed = [];
      for (const h of p.hits) {
        const after = h.text.replace(p.re, toRel);
        store.write(h.c, h.id, after);
        changed.push({ ...h, before: h.text, after });
      }
      const commit = await git.commit(
        changed.map((h) => store.rel(store.fileOf(h.c, h.id))),
        `Replace ${p.from.path} with ${p.to.path} in ${changed.length} entr${changed.length === 1 ? 'y' : 'ies'}`,
        { name: ctx.user.name, email: ctx.user.email },
      );
      audit.log(ctx, 'media.replace', { target: p.from.id, detail: { with: p.to.id, commit, entries: changed.map((h) => `${h.c.id}/${h.id}`) } });
      return { commit, entries: listOf(p.hits), changed };
    });
    // a live entry changed: build and deploy it now. A failed build keeps the replacement (it is what the person
    // asked for) and says so; the site stays as it was until the build goes through (QA F10)
    const n = out.changed.length;
    const job = app.many.deploy(ctx, {
      kind: 'media-replace',
      target: `media/${ctx.params.mid}`,
      list: out.changed,
      commit: out.commit,
      keep: true,
      notice: { text: (error) => `Replaced in ${n} ${n === 1 ? 'page' : 'pages'}, but the site could not be rebuilt: ${error} Your changes are saved; the site stays as it was.` },
    });
    return { commit: out.commit, entries: out.entries, job };
  });
}
