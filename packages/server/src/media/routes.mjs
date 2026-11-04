// Media library: upload (sniffed, size-limited, re-encoded, committed), list, alt text, usage, delete when unused
// (one, or many at once in bulk.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isInside } from '../config.mjs';
import { runCommand } from '../jobs.mjs';
import { readRaw } from '../http.mjs';
import { atLeast, can } from '../roles.mjs';
import { HttpError, conflict, flag, forbidden, invalid, newId, notFound, nowIso, slugify } from '../util.mjs';
import { TYPES, dimensions, sniff } from './sniff.mjs';
import { bulkMediaRoutes } from './bulk.mjs';
import { createMediaImport } from './import.mjs';
import { replaceRoutes } from './replace.mjs';
import { indexExistingFiles } from './index-files.mjs';
import { stockRoutes } from './stock.mjs';

export function mediaRoutes(router, app) {
  const { db, config, store, git, repoLock, audit, codec } = app;
  const media = config.media;

  const relToMedia = (row) => path.relative(media.dir, row.path).split(path.sep).join('/');
  const toPublic = (row) => ({
    id: row.id,
    filename: row.filename,
    path: row.path,
    url: media.url.replace('{path}', relToMedia(row)),
    type: row.type,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    alt: row.alt,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    derivedFrom: row.derived_from ?? null,
    credit: row.credit ? JSON.parse(row.credit) : null,
  });

  // where a file is used: the media_uses table (uses.mjs), brought up to the content index before each answer
  const usedBy = (row) => app.mediaUses.usedBy(row);

  const rowOf = (ctx) => {
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(ctx.params.mid);
    if (!row) throw notFound('No such media file.');
    return row;
  };

  router.add('GET', '/media', (ctx) => {
    const q = (ctx.query.get('q') ?? '').toLowerCase();
    let rows = db.prepare('SELECT * FROM media ORDER BY uploaded_at DESC').all();
    if (q) rows = rows.filter((r) => r.filename.toLowerCase().includes(q) || r.alt.toLowerCase().includes(q));
    // kind=image: pictures only (the "Choose from library" picker; a PDF cannot go in an image box, QA F16)
    if (ctx.query.get('kind') === 'image') rows = rows.filter((r) => String(r.type ?? '').startsWith('image/'));
    if (flag(ctx.query, 'unused')) {
      const used = app.mediaUses.usedPaths();
      rows = rows.filter((r) => !app.mediaUses.isUsed(r, used));
    }
    const perPage = Math.min(Math.max(Number(ctx.query.get('perPage')) || 50, 1), 200);
    const page = Math.max(Number(ctx.query.get('page')) || 1, 1);
    return { items: rows.slice((page - 1) * perPage, page * perPage).map(toPublic), total: rows.length, page, perPage };
  });

  router.add('GET', '/media/:mid', (ctx) => {
    const row = rowOf(ctx);
    const derivatives = db.prepare('SELECT id, filename FROM media WHERE derived_from = ? ORDER BY uploaded_at DESC').all(row.id);
    return { ...toPublic(row), usedBy: usedBy(row), derivatives };
  });

  router.add('GET', '/media/:mid/file', async (ctx) => {
    const row = rowOf(ctx);
    const abs = path.join(config.contentRoot, row.path);
    if (!isInside(media.absDir, abs) || !fs.existsSync(abs)) throw notFound('The file is missing from the repo.');
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', row.type);
    ctx.res.setHeader('Cache-Control', 'private, max-age=300');
    // a document downloads (never drawn on the editor's origin); an image shows in the library
    ctx.res.setHeader('Content-Disposition', TYPES[row.type]?.document ? `attachment; filename="${row.filename.replace(/[^\w.-]/g, '_')}"` : 'inline');
    await pipeline(fs.createReadStream(abs), ctx.res);
  });

  /**
   * An iPhone photo (HEIC) as a JPEG: by the image library when it reads HEIC, else by the operator's converter
   * (config media.heicCommand, e.g. libheif's heif-dec), whose JPEG is then re-encoded like any upload. Refused in
   * plain words when neither can.
   */
  async function fromHeic(raw) {
    const said = 'iPhone photos in HEIC format cannot be read on this server. On the iPhone, choose Settings › Camera › Formats › Most Compatible, or share the photo as a JPEG, then upload it again.';
    if (!codec) throw new HttpError(415, 'unsupported-type', said);
    try {
      return (await codec.reencode(raw, { type: 'image/heic', maxSide: media.maxSide, as: 'image/jpeg' })).buffer;
    } catch {
      if (!media.heicCommand) throw new HttpError(415, 'unsupported-type', said);
    }
    // a private folder of its own, removed afterwards; the command gets file paths only (argv, no shell)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markstage-heic-'));
    try {
      const input = path.join(dir, 'photo.heic');
      const output = path.join(dir, 'photo.jpg');
      fs.writeFileSync(input, raw, { mode: 0o600 });
      const argv = media.heicCommand.map((a) => a.replace('{in}', input).replace('{out}', output));
      let said2 = '';
      const { code, timedOut } = await runCommand(argv, { cwd: dir, env: {}, timeoutSeconds: 60, onOutput: (t) => (said2 = (said2 + t).slice(-500)) });
      if (code !== 0 || timedOut || !fs.existsSync(output)) {
        console.error(`[markstage] media.heicCommand failed${timedOut ? ' (timeout)' : ''}: ${said2.trim()}`);
        throw new HttpError(415, 'unsupported-type', said);
      }
      const jpeg = fs.readFileSync(output);
      if (sniff(jpeg).type !== 'image/jpeg') throw new HttpError(415, 'unsupported-type', said);
      return (await codec.reencode(jpeg, { type: 'image/jpeg', maxSide: media.maxSide })).buffer;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * An upload made ready to store: sniffed (never SVG), an iPhone photo turned into a JPEG, re-encoded (metadata
   * stripped, size capped). {out: {buffer, type, width?, height?}, base (the file name's stem), ext}. A release's
   * pictures go through it too (releases/items.mjs), so what goes live is what an upload would have stored.
   */
  async function prepareImage(raw, name) {
    const found = sniff(raw);
    if (found.svg) throw new HttpError(415, 'unsupported-type', 'SVG files are not accepted (they can carry scripts). Use PNG, JPEG, WebP, AVIF or GIF.');
    if (found.heic) return prepareImage(await fromHeic(raw), name.replace(/\.(heic|heif)$/i, '.jpg'));
    if (!found.type) throw new HttpError(415, 'unsupported-type', 'This kind of file cannot be uploaded. Images (JPEG, PNG, GIF, WebP, AVIF, iPhone HEIC) and PDF documents can.');
    const doc = TYPES[found.type].document;
    if (doc && media.documents === false) throw new HttpError(415, 'unsupported-type', 'Documents (PDF) are not accepted on this site. Upload images only.');

    let out = { buffer: raw, type: found.type, ...(doc ? {} : dimensions(raw, found.type)) };
    if (media.reencode && !doc) {
      if (!codec) throw new HttpError(503, 'unavailable', 'Image processing (sharp) is not installed on this server.');
      try {
        out = await codec.reencode(raw, { type: found.type, maxSide: media.maxSide });
      } catch {
        throw new HttpError(415, 'unsupported-type', 'This image could not be read. Export it again and retry.');
      }
      if (sniff(out.buffer).type !== out.type) throw new HttpError(500, 'server', 'The re-encoded image is not what was expected.');
    }
    return { out, base: (slugify(path.basename(name).replace(/\.[^.]*$/, '')) || 'image').slice(0, 80), ext: TYPES[out.type].ext };
  }

  /**
   * Store an image: made ready (prepareImage), written under the media folder by year and month, committed, indexed.
   * `from` is the media row it was edited from (the original stays); `credit` is where a stock photo came from.
   */
  async function storeImage(ctx, raw, name, { from = null, credit = null, alt = '', action = 'media.upload', commit: commitIt = true } = {}) {
    const { out, base } = await prepareImage(raw, name);
    const now = new Date(app.clock());
    const sub = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
    return repoLock.run(async () => {
      const dir = path.join(media.absDir, sub);
      fs.mkdirSync(dir, { recursive: true });
      if (!isInside(config.contentRoot, fs.realpathSync(dir))) throw forbidden('The media folder points outside the repo.');
      let file = `${base}.${TYPES[out.type].ext}`;
      // a name a release has kept for its own picture is taken too (it goes live with the release)
      const taken = (f) => fs.existsSync(path.join(dir, f)) || Boolean(app.releases?.reserved(store.rel(path.join(dir, f))));
      for (let n = 2; taken(file); n++) file = `${base}-${n}.${TYPES[out.type].ext}`;
      const abs = path.join(dir, file);
      fs.writeFileSync(abs, out.buffer, { flag: 'wx' });
      const rel = store.rel(abs);
      // not committed when the caller commits many files at once (an import)
      const commit = commitIt ? await git.commit([rel], from ? `Edit ${from.path} as ${rel}` : `Upload ${rel}`, { name: ctx.user.name, email: ctx.user.email }) : null;
      const id = newId('m');
      db.prepare('INSERT INTO media (id, path, filename, type, width, height, bytes, alt, uploaded_by, uploaded_at, derived_from, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id,
        rel,
        file,
        out.type,
        out.width ?? null,
        out.height ?? null,
        out.buffer.length,
        String(alt ?? '').trim().slice(0, 500),
        ctx.user.id,
        nowIso(app.clock()),
        from?.id ?? null,
        credit ? JSON.stringify(credit) : null,
      );
      audit.log(ctx, action, { target: id, detail: { path: rel, commit, bytes: out.buffer.length, ...(from ? { from: from.id } : {}), ...(credit ? { provider: credit.provider } : {}) } });
      return db.prepare('SELECT * FROM media WHERE id = ?').get(id);
    });
  }

  // an upload; with ?from=<mid> it is an edit of that image (crop, rotate, annotate in the editor): a new file next
  // to the original, which stays as it is, with the original's alt text unless the edit brings its own
  router.add(
    'POST',
    '/media',
    async (ctx) => {
      if (!can(ctx.user, 'media.upload')) throw forbidden('Your role cannot upload files.');
      const name = String(ctx.query.get('filename') ?? '');
      if (!name || name.length > 200) throw invalid({ filename: 'Send the file name.' });
      const fromId = ctx.query.get('from');
      const from = fromId ? db.prepare('SELECT * FROM media WHERE id = ?').get(fromId) : null;
      if (fromId && !from) throw notFound('The image it was edited from is gone.');
      let raw;
      try {
        raw = await readRaw(ctx.req, media.maxBytes);
      } catch (e) {
        // said with the sizes, so the writer knows how much smaller it must be
        if (e.status !== 413) throw e;
        const sent = Number(ctx.req.headers['content-length']);
        const mb = (n) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`);
        throw new HttpError(413, 'too-large', `${Number.isFinite(sent) && sent > 0 ? `This file is ${mb(sent)}; the` : 'The'} limit is ${mb(media.maxBytes)}. Export it smaller (a photo at 2560 px wide is plenty) and upload it again.`);
      }
      const alt = ctx.query.get('alt') ?? from?.alt ?? '';
      const row = await storeImage(ctx, raw, from && !ctx.query.get('keepName') ? `${from.filename.replace(/\.[^.]*$/, '')}-edited` : name, { from, alt, credit: from?.credit ? JSON.parse(from.credit) : null, action: from ? 'media.edit' : 'media.upload' });
      ctx.status = 201;
      return toPublic(row);
    },
    { rawBody: true },
  );

  stockRoutes(router, app, { storeImage, toPublic });
  replaceRoutes(router, app, { rowOf, relToMedia });
  bulkMediaRoutes(router, app, { usedBy });
  // many at once (a list of addresses, a zip, a folder), and the Library's imports store their pictures through it
  app.mediaImport = createMediaImport(app, { storeImage, toPublic });
  // a release's pictures (releases/items.mjs): made ready like an upload, stored when the release goes live
  app.mediaPrepare = { prepare: prepareImage, toPublic, urlOf: (rel) => media.url.replace('{path}', path.relative(media.dir, rel).split(path.sep).join('/')) };
  app.mediaImport.routes(router);

  // the site's existing files registered in place (nothing copied or committed); owner and administrators
  router.add('POST', '/media/index', (ctx) => {
    if (!can(ctx.user, 'media.index')) throw forbidden('Only an owner or administrator can index the site’s files.');
    const r = indexExistingFiles(app, { dry: ctx.body?.dry === true });
    if (!r.dry && r.added.length) audit.log(ctx, 'media.index', { target: 'media', detail: { added: r.added.length, known: r.known, skipped: r.skipped.length } });
    return r;
  });

  router.add('PATCH', '/media/:mid', (ctx) => {
    const row = rowOf(ctx);
    if (!atLeast(ctx.user, 'editor') && row.uploaded_by !== ctx.user.id) throw forbidden('You can only edit your own uploads.');
    const alt = ctx.body.alt;
    if (typeof alt !== 'string' || alt.length > 500) throw invalid({ alt: 'Alt text up to 500 characters.' });
    db.prepare('UPDATE media SET alt = ? WHERE id = ?').run(alt.trim(), row.id);
    audit.log(ctx, 'media.update', { target: row.id });
    return toPublic(rowOf(ctx));
  });

  router.add('DELETE', '/media/:mid', async (ctx) => {
    const row = rowOf(ctx);
    const mine = row.uploaded_by === ctx.user.id;
    if (!(can(ctx.user, 'media.delete.any') || (mine && can(ctx.user, 'media.delete.own')))) throw forbidden('You cannot delete this file.');
    await repoLock.run(async () => {
      const users = usedBy(row);
      if (users.length) throw conflict('This file is still used. Remove it from these entries first.', { usedBy: users });
      const abs = path.join(config.contentRoot, row.path);
      if (isInside(media.absDir, abs) && fs.existsSync(abs)) fs.unlinkSync(abs);
      const commit = await git.commit([row.path], `Delete ${row.path}`, { name: ctx.user.name, email: ctx.user.email });
      db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
      audit.log(ctx, 'media.delete', { target: row.id, detail: { path: row.path, commit } });
    });
    return { ok: true };
  });
}
