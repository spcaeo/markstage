// Library packs (docs/API-LIBRARY.md "Packs"): shared items with their pictures and the media files they name, in one
// JSON file. A pack keeps each item's file text as it is, so export, import and export again give the same bytes:
//   {format: 'markstage-pack', version: 1,
//    items: [{path: '<kind>/<id>.json', text} | {path: '<kind>/<id>.png', sha256, base64}],
//    media: [{path (inside the media folder), sha256, type, alt, base64}]}
// Importing is a dry run first (what would come in, which ids are there already, problems), then the writing: every
// item and file in one commit, audited. An id already here is skipped, or copied under a new id (`onClash: 'copy'`).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../config.mjs';
import { HttpError, badRequest, forbidden, newId, nowIso } from '../util.mjs';
import { TYPES, dimensions, sniff } from '../media/sniff.mjs';
import { KINDS } from './items.mjs';

export const PACK = 'markstage-pack';
const ITEM_PATH = /^(template|section|snippet)\/((?:lib|sn|t)_[A-Za-z0-9_-]{8,40})\.(json|png)$/;
const MEDIA_PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createPacks(app, lib) {
  const { config, store, db, git, audit } = app;
  const mediaRel = (p) => path.posix.join(config.media.dir.split(path.sep).join('/'), p);
  /** The media files an item's text names: the library's rows whose path inside the media folder it contains. */
  const mediaOf = (text) => db.prepare('SELECT * FROM media').all().filter((r) => text.includes(path.relative(config.media.dir, r.path).split(path.sep).join('/')));

  /** The pack of these shared items (ids in any order), as text. */
  function exportPack(user, ids) {
    const items = [];
    const media = new Map();
    for (const id of [...new Set(ids)].sort()) {
      const it = lib.get(user, id);
      if (!it.shared) throw badRequest(`“${it.name}” is a personal snippet: share it first to put it in a pack.`);
      const rel = lib.relOf(it.kind, it.id);
      const text = store.readRel(rel);
      items.push({ path: `${it.kind}/${it.id}.json`, text });
      const png = lib.thumbOf(it);
      if (png) {
        const buf = fs.readFileSync(png);
        items.push({ path: `${it.kind}/${it.id}.png`, sha256: sha(buf), base64: buf.toString('base64') });
      }
      for (const r of mediaOf(text)) {
        const abs = path.join(config.contentRoot, r.path);
        if (!fs.existsSync(abs) || media.has(r.path)) continue;
        const buf = fs.readFileSync(abs);
        media.set(r.path, { path: path.relative(config.media.dir, r.path).split(path.sep).join('/'), sha256: sha(buf), type: r.type, alt: r.alt ?? '', base64: buf.toString('base64') });
      }
    }
    items.sort((a, b) => a.path.localeCompare(b.path));
    const list = [...media.values()].sort((a, b) => a.path.localeCompare(b.path));
    return `${JSON.stringify({ format: PACK, version: 1, items, media: list }, null, 2)}\n`;
  }

  /** A pack's text read and checked: {items: [{kind, id, text, item, png?}], media: [...], problems}. Throws on a wrong file. */
  function read(text) {
    let pack;
    try {
      pack = JSON.parse(text);
    } catch {
      throw badRequest('This is not a Markstage pack (not JSON).');
    }
    if (!isObj(pack) || pack.format !== PACK || pack.version !== 1 || !Array.isArray(pack.items)) throw badRequest('This is not a Markstage pack (format "markstage-pack", version 1).');
    const problems = [];
    const pngs = new Map();
    const items = [];
    for (const e of pack.items) {
      const m = ITEM_PATH.exec(String(e?.path ?? ''));
      if (!m) {
        problems.push(`${String(e?.path ?? '?').slice(0, 100)}: not an item of a pack, left out`);
        continue;
      }
      if (m[3] === 'png') {
        const buf = Buffer.from(String(e.base64 ?? ''), 'base64');
        if (sha(buf) !== e.sha256 || sniff(buf).type !== 'image/png' || buf.length > 200 * 1024) problems.push(`${e.path}: the picture is damaged or not a PNG, left out`);
        else pngs.set(m[2], buf);
        continue;
      }
      let v;
      try {
        v = JSON.parse(String(e.text ?? ''));
      } catch {
        problems.push(`${e.path}: not JSON, left out`);
        continue;
      }
      if (!isObj(v) || v.id !== m[2] || v.kind !== m[1] || !KINDS.includes(v.kind)) {
        problems.push(`${e.path}: its id or kind is not its file name, left out`);
        continue;
      }
      try {
        const f = lib.clean({ ...v, shared: true }, { kind: v.kind });
        const by = isObj(v.createdBy) ? { id: typeof v.createdBy.id === 'string' ? v.createdBy.id.slice(0, 60) : null, name: typeof v.createdBy.name === 'string' ? v.createdBy.name.slice(0, 100) : null } : { id: null, name: null };
        const iso = (s) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : null);
        const item = { ...f, id: v.id, createdBy: by, createdAt: iso(v.createdAt), updatedAt: iso(v.updatedAt), ...(isObj(v.imported) ? { imported: v.imported } : {}) };
        const own = lib.fileText(item);
        if (own !== e.text) problems.push(`${e.path}: written in Markstage's own form`);
        items.push({ kind: v.kind, id: v.id, text: own, item });
      } catch (err) {
        problems.push(`${e.path}: ${err.extra?.fields ? Object.values(err.extra.fields)[0] : err.message}`);
      }
    }
    for (const it of items) if (pngs.has(it.id)) it.png = pngs.get(it.id);
    const media = [];
    for (const e of Array.isArray(pack.media) ? pack.media : []) {
      const p = String(e?.path ?? '');
      const buf = Buffer.from(String(e?.base64 ?? ''), 'base64');
      const found = sniff(buf);
      if (!MEDIA_PATH.test(p) || p.split('/').includes('..')) problems.push(`${p.slice(0, 100)}: not a media path, left out`);
      else if (sha(buf) !== e.sha256) problems.push(`${p}: damaged (its checksum does not match), left out`);
      else if (!found.type || found.svg || buf.length > config.media.maxBytes) problems.push(`${p}: not an image or document this site takes, left out`);
      else media.push({ path: p, buf, type: found.type, alt: typeof e.alt === 'string' ? e.alt.slice(0, 500) : '' });
    }
    return { items, media, problems };
  }

  /**
   * Bring a pack in. Dry: {items: [{path, kind, name, exists}], media, problems}. Otherwise {created, skipped,
   * problems, commit}: one commit by the person importing, audited as library.import.
   */
  async function importPack(ctx, text, { dry = false, onClash = 'skip', source = 'pack' } = {}) {
    if (!lib.manages(ctx.user)) throw forbidden('Only editors can import into the Library.');
    if (!['skip', 'copy'].includes(onClash)) throw badRequest('onClash is skip or copy.');
    const p = read(text);
    const exists = (id) => Boolean(lib.shared(id));
    if (dry) {
      return {
        items: p.items.map((x) => ({ path: `${x.kind}/${x.id}.json`, kind: x.kind, name: x.item.name, ...(exists(x.id) ? { exists: true } : {}) })),
        media: p.media.length,
        problems: p.problems,
      };
    }
    return app.repoLock.run(async () => {
      const rels = [];
      const created = [];
      const skipped = [];
      const problems = [...p.problems];
      for (const x of p.items) {
        let { item, text: t } = x;
        if (exists(x.id)) {
          if (onClash === 'skip') {
            skipped.push({ id: x.id, name: item.name, reason: 'already in the Library' });
            continue;
          }
          const at = nowIso(app.clock());
          item = { ...item, id: newId('lib'), createdBy: { id: ctx.user.id, name: ctx.user.name }, createdAt: at, updatedAt: at };
          t = lib.fileText(item);
        }
        const rel = lib.relOf(item.kind, item.id);
        store.writeRel(rel, t);
        rels.push(rel);
        if (x.png) {
          store.writeRel(lib.relOf(item.kind, item.id, 'png'), x.png);
          rels.push(lib.relOf(item.kind, item.id, 'png'));
        }
        created.push(item.id);
      }
      const media = [];
      for (const m of p.media) {
        const rel = mediaRel(m.path);
        const abs = path.join(config.contentRoot, rel);
        if (!isInside(config.media.absDir, abs)) {
          problems.push(`${m.path}: outside the media folder, left out`);
          continue;
        }
        if (fs.existsSync(abs)) {
          if (sha(fs.readFileSync(abs)) !== sha(m.buf)) problems.push(`${m.path}: another file is there already; the items name the one here`);
        } else {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          if (!isInside(config.contentRoot, fs.realpathSync(path.dirname(abs)))) throw new HttpError(403, 'forbidden', 'The media folder points outside the repo.');
          fs.writeFileSync(abs, m.buf, { flag: 'wx' });
          rels.push(rel);
          media.push(m.path);
        }
        if (!db.prepare('SELECT 1 FROM media WHERE path = ?').get(rel)) {
          const dims = TYPES[m.type]?.document ? {} : dimensions(m.buf, m.type);
          db.prepare('INSERT INTO media (id, path, filename, type, width, height, bytes, alt, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(newId('m'), rel, path.basename(rel), m.type, dims.width ?? null, dims.height ?? null, m.buf.length, m.alt, ctx.user.id, nowIso(app.clock()));
        }
      }
      const commit = rels.length ? await git.commit(rels, `Library: import ${created.length} item${created.length === 1 ? '' : 's'} from ${String(source).slice(0, 80)}`, { name: ctx.user.name, email: ctx.user.email }) : null;
      audit.log(ctx, 'library.import', { target: 'library', detail: { from: 'pack', source: String(source).slice(0, 200), commit, created, skipped: skipped.map((s) => s.id), media, problems: problems.length } });
      return { created, skipped, media: media.length, problems, commit };
    });
  }

  return { exportPack, importPack, read };
}
