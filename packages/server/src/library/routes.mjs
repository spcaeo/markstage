// The Library's routes (docs/API.md "Library"). Every route waits for the one-time move out of the database first.
//   GET    library?kind=&synced=1&shared=0|1&folder=&tag=&collection=&q=&sort=&page=&perPage=
//          -> {items, total, page, perPage, facets: {kinds, synced, folders, tags}} (synced: within the kind)
//   GET    library/:id                -> item + {uses: [...], history: [...]} (the commits of a shared item)
//   GET    library/:id/impact         -> {pages: [...]}  (the pages a change of a synced item would change)
//   POST   library {kind, name, body, …}   -> 201 item
//   PATCH  library/:id {…, version}   -> item (+ {changed, skipped, job} when a synced item's pages followed) | 409
//   PUT    library/:id {body, version}     -> {changed, skipped, job, item}  ("edit everywhere")
//   DELETE library/:id[?detach=1]     -> {ok, commit} | 409 in-use {pages}
//   POST   library/:id/duplicate {name?, kind?}  -> 201 item
//   POST   library/:id/reset {collection, entry}  -> {commit, copies, job}  (a page's changed copies back to the item)
//   GET|PUT|DELETE library/:id/thumb  (PUT: a PNG body, at most 200 KB)
//   GET    library/export?ids=a,b     -> the pack (a .json download)
//   POST   library/import[?dry=1]     multipart `file` (+ `onClash`; + `mediaMap` for WordPress): a pack (.json), a
//          WordPress export (.xml) or dump (.sql, .sql.gz) -> dry {items, media, problems} | {created, …}
//   POST   library/import/url {url}   -> {url, title, parts: [{id, label, html, images}]}  (a web page's parts, to choose)
//   POST   library/import/url/parts {url, parts, kind, folder?, dry?}  -> dry {items, media, problems} | {created, …}
import fs from 'node:fs';
import path from 'node:path';
import { readRaw, readToFile } from '../http.mjs';
import { HttpError, badRequest, flag, forbidden, notFound } from '../util.mjs';
import { KINDS, MAX_THUMB } from './items.mjs';
import { parseMultipart } from './multipart.mjs';
import { createPacks } from './packs.mjs';
import { createUrlImport } from './url-import.mjs';
import { createWpImport } from './wp.mjs';

// an import file (a pack, a WordPress export) is streamed to <dataDir>/tmp, at most library.importMaxBytes (64 MB),
// then parsed one import at a time per server (the lock shared with media imports; 409 busy otherwise)
const DEFAULT_IMPORT_MAX = 64 * 1024 * 1024;

const SORTS = {
  place: (a, b) => Number(!a.folder) - Number(!b.folder) || a.folder.localeCompare(b.folder) || (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  '-name': (a, b) => b.name.localeCompare(a.name),
  updated: (a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)),
  '-updated': (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
};

const count = (values) => {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, count: n }));
};

export function libraryItemRoutes(router, app, lib) {
  const ready = () => lib.moveOld();
  const packs = createPacks(app, lib);
  app.libraryPacks = packs;
  const fromUrl = createUrlImport(app, lib);
  app.libraryWp = createWpImport(app, lib);

  // before /library/:id, so "export" and "import" are never read as ids
  router.add('GET', '/library/export', async (ctx) => {
    await ready();
    const ids = String(ctx.query.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length || ids.length > 500) throw badRequest('Pick the items to put in the pack first (up to 500).');
    const text = packs.exportPack(ctx.user, ids);
    app.audit.log(ctx, 'library.export', { target: 'library', detail: { ids } });
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'application/json; charset=utf-8');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="markstage-pack-${new Date(app.clock()).toISOString().slice(0, 10)}.json"`);
    ctx.res.end(text);
  });

  router.add(
    'POST',
    '/library/import',
    async (ctx) => {
      await ready();
      // who may import is known before anything is taken or read: a refused upload holds no lock and no disk (S7)
      if (!lib.manages(ctx.user)) throw forbidden('Only editors can import into the Library.');
      const release = app.importLock.take('library');
      if (!release) throw new HttpError(409, 'busy', 'Another import is running. Try again when it is done.');
      let tmp = null;
      try {
        ({ file: tmp } = await readToFile(ctx.req, app.config.library.importMaxBytes ?? DEFAULT_IMPORT_MAX, path.join(app.config.dataDir, 'tmp')));
        // a pack or an export is parsed whole: bounded by the limit above, one at a time by the lock
        const raw = fs.readFileSync(tmp);
        fs.rmSync(tmp, { force: true });
        tmp = null;
        const type = String(ctx.req.headers['content-type'] ?? '');
        let file;
        let fields = {};
        let mapFile = null;
        if (/^multipart\//i.test(type)) {
          const form = parseMultipart(raw, type);
          fields = form.fields;
          mapFile = form.files.find((f) => f.name === 'mediaMap')?.data.toString('utf8') ?? null;
          file = form.files.find((f) => f.name === 'file') ?? form.files[0];
          if (!file) throw badRequest('Send the file to import (field "file").');
        } else file = { filename: ctx.query.get('filename') ?? 'pack.json', data: raw };
        const onClash = fields.onClash ?? ctx.query.get('onClash') ?? 'skip';
        const dry = flag(ctx.query, 'dry') || fields.dry === '1';
        const name = String(file.filename ?? '').slice(0, 200);
        const head = file.data.subarray(0, 64).toString('utf8').trimStart();
        if (/\.json$/i.test(name) || head.startsWith('{')) return await packs.importPack(ctx, file.data.toString('utf8'), { dry, onClash, source: name || 'pack' });
        return await app.libraryWp.importFile(ctx, file, { dry, source: name, mediaMap: fields.mediaMap ?? mapFile });
      } finally {
        if (tmp) fs.rmSync(tmp, { force: true });
        release();
      }
    },
    { rawBody: true },
  );
  router.add('POST', '/library/import/url', async (ctx) => {
    await ready();
    return fromUrl.preview(ctx, ctx.body?.url);
  });
  router.add('POST', '/library/import/url/parts', async (ctx) => {
    await ready();
    const b = ctx.body ?? {};
    return fromUrl.importParts(ctx, { url: b.url, parts: b.parts, kind: b.kind ?? 'section', folder: b.folder ?? undefined, dry: Boolean(b.dry) || flag(ctx.query, 'dry') });
  });

  router.add('GET', '/library', async (ctx) => {
    await ready();
    const q = (k) => ctx.query.get(k) ?? '';
    const kind = q('kind');
    if (kind && !KINDS.includes(kind)) throw badRequest('kind is template, section or snippet.');
    const sort = q('sort') || 'place';
    if (!SORTS[sort]) throw badRequest(`That is not a way to sort the Library. Sort by ${Object.keys(SORTS).join(', ')}.`);
    const uses = lib.synced.scan();
    const all = lib.visible(ctx.user).map((it) => lib.toPublic(it, { usedOn: it.synced ? (uses.get(it.id)?.length ?? 0) : 0 }));
    const kinds = Object.fromEntries(KINDS.map((k) => [k, all.filter((it) => it.kind === k).length]));
    const ofKind = kind ? all.filter((it) => it.kind === kind) : all;
    const words = q('q').trim().toLowerCase();
    const items = ofKind.filter(
      (it) =>
        (!q('synced') || it.synced === /^(1|true)$/.test(q('synced'))) &&
        (!q('shared') || it.shared === /^(1|true)$/.test(q('shared'))) &&
        (!ctx.query.has('folder') || it.folder === q('folder')) &&
        (!q('tag') || it.tags.includes(q('tag'))) &&
        (!q('collection') || it.collection === q('collection')) &&
        (!words || [it.name, it.description, it.folder, ...it.tags].some((s) => s.toLowerCase().includes(words))),
    );
    items.sort(SORTS[sort]);
    const perPage = Math.min(200, Math.max(1, Number.parseInt(q('perPage'), 10) || 50));
    const page = Math.max(1, Number.parseInt(q('page'), 10) || 1);
    return {
      items: items.slice((page - 1) * perPage, page * perPage),
      total: items.length,
      page,
      perPage,
      facets: { kinds, synced: ofKind.filter((it) => it.synced).length, folders: count(ofKind.map((it) => it.folder).filter(Boolean)), tags: count(ofKind.flatMap((it) => it.tags)) },
    };
  });

  router.add('GET', '/library/:id', async (ctx) => {
    await ready();
    const it = lib.get(ctx.user, ctx.params.id);
    const history = it.shared ? (await app.git.log(lib.relOf(it.kind, it.id))).map((h) => ({ sha: h.sha, author: h.author.name, date: h.date, message: h.message })) : [];
    const uses = it.synced ? lib.synced.pagesOf(it.id) : [];
    return lib.toPublic(it, { history, usedOn: uses.length, uses });
  });

  router.add('GET', '/library/:id/impact', async (ctx) => {
    await ready();
    const it = lib.get(ctx.user, ctx.params.id);
    return { pages: it.synced ? lib.synced.pagesOf(it.id) : [] };
  });

  /** A change as the API answers it: the item, and what its pages did when it is synced. */
  const answer = (it) => ({ ...lib.toPublic(it), ...(it.follow ? { changed: it.follow.changed, skipped: it.follow.skipped, job: it.follow.job ? { id: it.follow.job } : null } : {}) });

  router.add('PUT', '/library/:id', async (ctx) => {
    await ready();
    if (ctx.body.body === undefined) throw badRequest('Send the new body and the version you opened.');
    const it = await lib.update(ctx, ctx.params.id, { body: ctx.body.body, version: ctx.body.version, ...(ctx.body.locks !== undefined ? { locks: ctx.body.locks } : {}) });
    const a = answer(it);
    return { changed: a.changed ?? 0, skipped: a.skipped ?? [], job: a.job ?? null, item: lib.toPublic(it) };
  });

  router.add('POST', '/library', async (ctx) => {
    await ready();
    const it = await lib.create(ctx, ctx.body);
    ctx.status = 201;
    return lib.toPublic(it);
  });

  router.add('PATCH', '/library/:id', async (ctx) => {
    await ready();
    return answer(await lib.update(ctx, ctx.params.id, ctx.body));
  });

  router.add('DELETE', '/library/:id', async (ctx) => {
    await ready();
    return lib.remove(ctx, ctx.params.id, { detach: flag(ctx.query, 'detach') });
  });

  router.add('POST', '/library/:id/reset', async (ctx) => {
    await ready();
    const { collection, entry } = ctx.body ?? {};
    if (typeof collection !== 'string' || typeof entry !== 'string') throw badRequest('Say which page (collection, entry).');
    return lib.reset(ctx, ctx.params.id, app.store.collection(collection), entry);
  });
  router.add('POST', '/library/:id/duplicate', async (ctx) => {
    await ready();
    const src = lib.get(ctx.user, ctx.params.id);
    const kind = ctx.body.kind ?? src.kind;
    const name = typeof ctx.body.name === 'string' ? ctx.body.name : `${src.name} (copy)`.slice(0, 100);
    const it = await lib.create(ctx, { kind, name, description: src.description, folder: src.folder, tags: src.tags, order: src.order, synced: src.synced, shared: ctx.body.shared ?? src.shared, collection: ctx.body.collection ?? src.collection, sectionType: src.sectionType, locks: src.locks, body: src.body }, { action: 'library.duplicate' });
    ctx.status = 201;
    return lib.toPublic(it);
  });

  router.add('GET', '/library/:id/thumb', async (ctx) => {
    await ready();
    const file = lib.thumbOf(lib.get(ctx.user, ctx.params.id));
    if (!file) throw notFound('This item has no picture.');
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'image/png');
    ctx.res.setHeader('Cache-Control', 'private, max-age=300');
    ctx.res.end(fs.readFileSync(file));
  });

  router.add(
    'PUT',
    '/library/:id/thumb',
    async (ctx) => {
      await ready();
      const type = String(ctx.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'image/png') throw badRequest('Send the picture as image/png.');
      // the item is there and the person may change it before the picture is read (S7); setThumb checks again
      if (!lib.mayChange(ctx.user, lib.get(ctx.user, ctx.params.id))) throw forbidden('Only editors can change this item’s picture.');
      return lib.setThumb(ctx, ctx.params.id, await readRaw(ctx.req, MAX_THUMB));
    },
    { rawBody: true },
  );

  router.add('DELETE', '/library/:id/thumb', async (ctx) => {
    await ready();
    return lib.setThumb(ctx, ctx.params.id, null);
  });
}
