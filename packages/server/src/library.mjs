// The routes from before the Library (docs/API.md "Snippets and templates"), answered from it (library/items.mjs),
// and the audit log. A snippet's folder and place ride in its document's attrs here, as the editor kept them.
import { can } from './roles.mjs';
import { forbidden, invalid, notFound } from './util.mjs';
import { placeInDoc } from './library/items.mjs';

const isDoc = (doc) => Boolean(doc) && typeof doc === 'object' && doc.type === 'doc' && Array.isArray(doc.content ?? []);

export function libraryRoutes(router, app, lib) {
  const { audit } = app;
  const ready = () => lib.moveOld();

  /** A Library snippet as /snippets answered it. */
  const snippet = (it) => {
    const attrs = { ...(it.body.doc.attrs ?? {}), ...(it.folder ? { folder: it.folder } : {}), ...(it.order !== null ? { order: it.order } : {}) };
    return { id: it.id, name: it.name, doc: { ...it.body.doc, ...(Object.keys(attrs).length ? { attrs } : {}) }, createdBy: it.createdBy?.id ?? null, shared: it.shared, updatedAt: it.updatedAt };
  };
  const snippetOf = (ctx) => {
    let it;
    try {
      it = lib.get(ctx.user, ctx.params.sid);
    } catch {
      throw notFound('No such snippet.');
    }
    if (it.kind !== 'snippet') throw notFound('No such snippet.');
    return it;
  };
  const fromDoc = (doc) => {
    if (!isDoc(doc)) throw invalid({ doc: 'A snippet is a document fragment.' });
    return placeInDoc(doc);
  };

  router.add('GET', '/snippets', async (ctx) => {
    await ready();
    return lib.visible(ctx.user).filter((it) => it.kind === 'snippet').sort((a, b) => a.name.localeCompare(b.name)).map(snippet);
  });

  router.add('POST', '/snippets', async (ctx) => {
    await ready();
    const { name, doc, shared } = ctx.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw invalid({ name: 'Give the snippet a name.' });
    const p = fromDoc(doc);
    const it = await lib.create(ctx, { kind: 'snippet', name, folder: p.folder, order: p.order, shared: Boolean(shared), body: { doc: p.doc } });
    ctx.status = 201;
    return snippet(lib.get(ctx.user, it.id));
  });

  router.add('PATCH', '/snippets/:sid', async (ctx) => {
    await ready();
    const cur = snippetOf(ctx);
    if (!lib.mayChange(ctx.user, cur)) throw forbidden('You can only change your own snippets.');
    const { name, doc, shared } = ctx.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 100)) throw invalid({ name: 'Give the snippet a name.' });
    const p = doc !== undefined ? fromDoc(doc) : null;
    const it = await lib.update(ctx, cur.id, { name, shared, ...(p ? { folder: p.folder, order: p.order, body: { doc: p.doc } } : {}) }, { checkVersion: false });
    return snippet(lib.get(ctx.user, it.id));
  });

  router.add('DELETE', '/snippets/:sid', async (ctx) => {
    await ready();
    await lib.remove(ctx, snippetOf(ctx).id);
    return { ok: true };
  });

  // --- templates -----------------------------------------------------------------------------------------------

  const template = (it) => ({ id: it.id, collection: it.collection, name: it.name, frontmatter: it.body.frontmatter, doc: it.body.doc, data: it.body.data, createdBy: it.createdBy?.id ?? null, updatedAt: it.updatedAt });
  const manage = (ctx) => {
    if (!can(ctx.user, 'templates.manage')) throw forbidden('Only editors can manage templates.');
  };
  const templateOf = (ctx) => {
    let it;
    try {
      it = lib.get(ctx.user, ctx.params.tid);
    } catch {
      throw notFound('No such template.');
    }
    if (it.kind !== 'template') throw notFound('No such template.');
    return it;
  };
  const bodyOf = (b, base = {}) => ({ ...base, ...Object.fromEntries(['frontmatter', 'doc', 'data'].filter((k) => b[k] !== undefined).map((k) => [k, b[k]])) });

  router.add('GET', '/templates', async (ctx) => {
    await ready();
    const c = ctx.query.get('collection');
    return lib
      .visible(ctx.user)
      .filter((it) => it.kind === 'template' && (!c || it.collection === c))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(template);
  });

  router.add('POST', '/templates', async (ctx) => {
    await ready();
    manage(ctx);
    const it = await lib.create(ctx, { kind: 'template', name: ctx.body.name, collection: ctx.body.collection, body: bodyOf(ctx.body) });
    ctx.status = 201;
    return template(it);
  });

  router.add('PATCH', '/templates/:tid', async (ctx) => {
    await ready();
    manage(ctx);
    const cur = templateOf(ctx);
    return template(await lib.update(ctx, cur.id, { name: ctx.body.name, body: bodyOf(ctx.body, cur.body) }, { checkVersion: false }));
  });

  router.add('DELETE', '/templates/:tid', async (ctx) => {
    await ready();
    manage(ctx);
    await lib.remove(ctx, templateOf(ctx).id);
    return { ok: true };
  });

  router.add('GET', '/audit', (ctx) => {
    if (!can(ctx.user, 'audit.read')) throw forbidden('Only administrators can read the audit log.');
    const q = (k) => ctx.query.get(k) ?? undefined;
    return audit.list({ user: q('user'), action: q('action'), from: q('from'), to: q('to'), before: q('before'), limit: q('limit') });
  });
}
