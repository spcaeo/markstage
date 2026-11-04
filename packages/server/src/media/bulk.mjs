// Media library, many at once: delete every selected file nothing uses, in one commit, and bring them back with the
// Undo on the toast (POST /site/undo, undo.mjs). A file still used, or one this person may not delete, is left and
// named with the reason. The library rows of the deleted files are kept (kv `media.deleted:<commit>`) so the Undo
// brings back the alt text, the uploader and the credit along with the file.
//   POST /media/delete {ids: [mid, …]}   {commit, deleted: [{id, filename}], skipped: [{id, filename, reason, usedBy?}]}
import fs from 'node:fs';
import path from 'node:path';
import { isInside } from '../config.mjs';
import { can } from '../roles.mjs';
import { badRequest } from '../util.mjs';

const MAX = 200;
const kvKey = (sha) => `media.deleted:${sha}`;

export function bulkMediaRoutes(router, app, { usedBy }) {
  const { db, config, git, repoLock, audit } = app;

  router.add('POST', '/media/delete', async (ctx) => {
    const ids = ctx.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX || !ids.every((x) => typeof x === 'string' && x.length < 100)) throw badRequest(`Say which files to delete (ids, 1 to ${MAX}).`);
    return repoLock.run(async () => {
      const deleted = [];
      const skipped = [];
      for (const id of new Set(ids)) {
        const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
        if (!row) {
          skipped.push({ id, filename: null, reason: 'It is not in the library any more.' });
          continue;
        }
        const mine = row.uploaded_by === ctx.user.id;
        if (!(can(ctx.user, 'media.delete.any') || (mine && can(ctx.user, 'media.delete.own')))) {
          skipped.push({ id, filename: row.filename, reason: can(ctx.user, 'media.delete.own') ? 'You can only delete your own uploads.' : 'Your role cannot delete files.' });
          continue;
        }
        const users = usedBy(row);
        if (users.length) {
          skipped.push({ id, filename: row.filename, reason: 'It is still used.', usedBy: users });
          continue;
        }
        deleted.push(row);
      }
      if (!deleted.length) return { commit: null, deleted: [], skipped };
      for (const row of deleted) {
        const abs = path.join(config.contentRoot, row.path);
        if (isInside(config.media.absDir, abs) && fs.existsSync(abs)) fs.unlinkSync(abs);
      }
      const n = deleted.length;
      const commit = await git.commit(deleted.map((r) => r.path), n === 1 ? `Delete ${deleted[0].path}` : `Delete ${n} unused media files`, { name: ctx.user.name, email: ctx.user.email });
      const drop = db.prepare('DELETE FROM media WHERE id = ?');
      for (const row of deleted) drop.run(row.id);
      if (commit) db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(kvKey(commit), JSON.stringify(deleted));
      audit.log(ctx, 'media.delete.many', { target: 'media', detail: { commit, count: n, skipped: skipped.length } });
      return { commit, deleted: deleted.map((r) => ({ id: r.id, filename: r.filename })), skipped };
    });
  });
}

/**
 * Undo a delete of many files (inside the repo lock): each file comes back from the commit before, with its library
 * row, unless a file was put at that path since (it is named and left). One new commit.
 */
export async function restoreMedia(app, ctx, commit, subject) {
  const { db, config, git } = app;
  const rows = JSON.parse(db.prepare('SELECT value FROM kv WHERE key = ?').get(kvKey(commit))?.value ?? '[]');
  const parent = await git.parent(commit);
  const back = [];
  const skipped = [];
  for (const row of rows) {
    const abs = path.join(config.contentRoot, row.path);
    if (!isInside(config.media.absDir, abs)) continue;
    if (fs.existsSync(abs) || db.prepare('SELECT 1 FROM media WHERE id = ? OR path = ?').get(row.id, row.path)) {
      skipped.push({ collection: 'media', id: row.id, title: row.filename, reason: 'A file was put at that place since, so it was left as it is.' });
      continue;
    }
    back.push(row);
  }
  let sha = null;
  if (back.length && parent) {
    await git.git(['checkout', parent, '--', ...back.map((r) => r.path)]);
    sha = await git.commit(back.map((r) => r.path), `Undo: ${subject}`.slice(0, 200), { name: ctx.user.name, email: ctx.user.email });
    const known = new Set(db.prepare('PRAGMA table_info(media)').all().map((c) => c.name));
    for (const row of back) {
      const cols = Object.keys(row).filter((k) => known.has(k));
      db.prepare(`INSERT INTO media (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((k) => row[k]));
    }
  }
  return { sha, restored: back.map((r) => ({ id: r.id, filename: r.filename })), skipped };
}
