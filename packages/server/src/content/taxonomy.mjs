// Categories, tags, authors (docs/OPERATIONS.md "Categories, tags, authors"): every value a field has across the
// entries, with how many use it, and the summary of a change to it wherever it is: rename one, merge several into
// one, or delete one (taken out, or given to another). The change itself is a bulk `rename` (bulk.mjs): one commit,
// the live entries rebuilt, each entry checked like a save, and Undo. Editors and above.
//   GET  /site/taxonomy?field=&collection=          {field, list, values: [{value, entries, live, collections}]}
//   POST /site/taxonomy/plan {field, from, to, collection?}
//                                                   the bulk plan for every entry that has one of `from`
import { atLeast } from '../roles.mjs';
import { badRequest, forbidden } from '../util.mjs';
import { FIELD_NAME, fixedFields, isScalar } from './bulk.mjs';
import { nameCheck } from './limits.mjs';

export function taxonomyRoutes(router, app, bulk) {
  const { store } = app;

  const needEditor = (ctx) => {
    if (!atLeast(ctx.user, 'editor')) throw forbidden('Only editors and above can change categories, tags and authors.');
  };
  const fieldOf = (v) => {
    if (typeof v !== 'string' || !FIELD_NAME.test(v)) throw badRequest('Say which field (a category, tags, the author).');
    return v;
  };
  const collectionsOf = (only) => {
    if (!only) return store.collections;
    return [store.collection(String(only))];
  };

  /** Every entry with its fields, in the asked collections; the field may not be one a bulk change leaves alone. */
  function* entriesWith(field, only) {
    for (const c of collectionsOf(only)) {
      if (fixedFields(c).includes(field)) continue;
      for (const id of store.ids(c)) {
        let cur;
        try {
          cur = store.read(c, id);
        } catch {
          continue;
        }
        const s = store.summarize(c, id, cur.text);
        yield { c, id, value: store.fieldsOf(c, cur.text)[field], live: (s.status ?? 'published') === 'published' };
      }
    }
  }

  router.add('GET', '/site/taxonomy', (ctx) => {
    needEditor(ctx);
    const field = fieldOf(ctx.query.get('field'));
    const seen = new Map();
    let list = false;
    for (const e of entriesWith(field, ctx.query.get('collection'))) {
      if (e.value === undefined || e.value === null) continue;
      list ||= Array.isArray(e.value);
      for (const v of new Set(Array.isArray(e.value) ? e.value : [e.value])) {
        if (!isScalar(v) || v === '') continue;
        const row = seen.get(v) ?? { value: v, entries: 0, live: 0, collections: new Set() };
        row.entries++;
        if (e.live) row.live++;
        row.collections.add(e.c.id);
        seen.set(v, row);
      }
    }
    const values = [...seen.values()]
      .sort((a, b) => b.entries - a.entries || String(a.value).localeCompare(String(b.value)))
      .map((r) => ({ ...r, collections: [...r.collections] }));
    return { field, list, values };
  });

  router.add('POST', '/site/taxonomy/plan', async (ctx) => {
    needEditor(ctx);
    const { from, to, collection } = ctx.body ?? {};
    const field = fieldOf(ctx.body?.field);
    if (!Array.isArray(from) || !from.length || !from.every((v) => isScalar(v) && v !== '')) throw badRequest('Say which values to change.');
    if (to !== null && !(isScalar(to) && to !== '')) throw badRequest('Say the new value, or null to take them out.');
    nameCheck(to, 'to', 'The new name');
    const has = (v) => (Array.isArray(v) ? v.some((x) => from.includes(x)) : from.includes(v));
    const entries = [];
    for (const e of entriesWith(field, collection)) if (has(e.value)) entries.push({ collection: e.c.id, id: e.id });
    if (!entries.length) return { field, from, to, entries: [] };
    return { field, from, to, entries: await bulk.plan(ctx, { action: 'rename', field, from, value: to, entries }) };
  });
}
