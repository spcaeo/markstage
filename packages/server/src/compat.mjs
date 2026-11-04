// The original dev API, answered by the production server for the configured
// `compat.collection`, so the current editor keeps working while it moves to /markstage/api/. Same sign-in and CSRF
// rules as the new API.
//   GET  /studio-api/articles          -> [{ slug, title, url, cluster }]
//   GET  /studio-api/article?slug=x    -> { slug, url, title, doc, version }
//   POST /studio-api/article?slug=x    body { doc, version } -> { ok, version, changedBlocks } | 409
import { badRequest, notFound } from './util.mjs';

export function compatRoutes(router, app, entries) {
  const { store, config } = app;
  const c = () => store.collection(config.compat.collection);
  const slugOf = (ctx) => {
    const slug = ctx.query.get('slug') ?? '';
    if (!store.exists(c(), slug)) throw notFound(`No article "${slug}".`);
    return slug;
  };

  router.add('GET', '/studio-api/articles', () => {
    const col = c();
    return store
      .ids(col)
      .map((id) => {
        const { text } = store.read(col, id);
        const s = store.summarize(col, id, text);
        return { slug: id, title: s.title, url: s.url, cluster: String(store.fieldsOf(col, text).cluster ?? '') };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  });

  router.add('GET', '/studio-api/article', (ctx) => {
    const v = entries.view(ctx, c(), slugOf(ctx));
    return { slug: v.id, url: v.url, title: v.title, doc: v.doc, version: v.version };
  });

  router.add('POST', '/studio-api/article', async (ctx) => {
    const slug = slugOf(ctx);
    const { doc, version } = ctx.body;
    if (!doc || doc.type !== 'doc') throw badRequest('No document in the request.');
    const out = await entries.saveEntry(ctx, c(), slug, { version, build: (cur) => entries.textFromBody(c(), cur.text, { doc }) });
    return { ok: true, version: out.version, changedBlocks: out.changedBlocks };
  });
}
