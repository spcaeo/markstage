// Releases (docs/API-RELEASES.md): the rows, and each item's bytes in `<dataDir>/releases/<id>/<item id>` (0600), kept
// out of the repo until the release goes live. An item is one file the release writes: an entry's whole text, a shared
// Library item's file, or a picture. It records the file's version on the site when it was added (`base`), so a
// publish over someone's newer change is refused by name instead of overwriting it.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, conflict, notFound, nowIso, sha1 } from '../util.mjs';

export const OPEN = ['open', 'scheduled'];
const LIVE_ITEMS = ['open', 'scheduled', 'publishing'];

export function createReleaseStore(app) {
  const { db, store, clock } = app;
  const root = path.join(app.config.dataDir, 'releases');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const dirOf = (rid) => path.join(root, rid);
  const nameOf = (uid) => (uid ? (app.users.get(uid)?.name ?? null) : null);

  const row = (rid) => db.prepare('SELECT * FROM releases WHERE id = ?').get(rid) ?? null;
  function must(rid) {
    const r = row(rid);
    if (!r) throw notFound('No such release.');
    return r;
  }
  const items = (rid) => db.prepare('SELECT * FROM release_items WHERE release_id = ? ORDER BY added_at, rowid').all(rid);
  const item = (rid, iid) => {
    const it = db.prepare('SELECT * FROM release_items WHERE release_id = ? AND id = ?').get(rid, iid);
    if (!it) throw notFound('No such item in this release.');
    return it;
  };
  const bytesOf = (it) => fs.readFileSync(path.join(dirOf(it.release_id), it.id));
  /** The sha1 of a repo file now, or null when it is not there. */
  const shaNow = (rel) => {
    const b = store.readRelBytes(rel);
    return b === null ? null : sha1(b);
  };

  /** A change to an open release: the version it was opened at must still be its version. */
  function checkVersion(r, version) {
    if (version !== `r${r.rev}`) throw conflict('This release changed since you opened it. Reload to see the latest.', { version: `r${r.rev}` });
  }
  function mustBeOpen(r) {
    if (!OPEN.includes(r.status)) throw new HttpError(409, 'not-open', r.status === 'published' ? 'This release is live. Make a new release for more changes.' : `This release is ${r.status}; it takes no changes.`);
  }
  const bump = (rid, extra = {}) => {
    const sets = Object.keys(extra).map((k) => `${k} = ?`);
    db.prepare(`UPDATE releases SET rev = rev + 1, updated_at = ?${sets.length ? `, ${sets.join(', ')}` : ''} WHERE id = ?`).run(nowIso(clock()), ...Object.values(extra), rid);
  };

  /** Add an item, or replace the one that writes the same file. Its bytes go to the release's folder first. */
  function putItem(r, it, bytes) {
    const dir = dirOf(r.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const was = db.prepare('SELECT id FROM release_items WHERE release_id = ? AND rel = ?').get(r.id, it.rel);
    const id = was?.id ?? it.id;
    const tmp = path.join(dir, `.${id}.tmp`);
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, id));
    db.prepare(
      `INSERT INTO release_items (id, release_id, kind, rel, collection, entry_id, lib_id, title, base, sha, bytes, meta, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(release_id, rel) DO UPDATE SET title = excluded.title, base = excluded.base, sha = excluded.sha, bytes = excluded.bytes, meta = excluded.meta, added_by = excluded.added_by, added_at = excluded.added_at`,
    ).run(id, r.id, it.kind, it.rel, it.collection ?? null, it.entryId ?? null, it.libId ?? null, it.title, it.base, sha1(bytes), bytes.length, JSON.stringify(it.meta ?? {}), it.addedBy, nowIso(clock()));
    // what was approved and checked was the release before this change
    bump(r.id, { approvals: '[]' });
    return item(r.id, id);
  }

  function dropItem(r, it) {
    db.prepare('DELETE FROM release_items WHERE id = ?').run(it.id);
    fs.rmSync(path.join(dirOf(r.id), it.id), { force: true });
    bump(r.id, { approvals: '[]' });
  }

  /** What the release would write: approvals and checks hold for exactly this (and the time it goes live as). */
  const contentKey = (r, list = items(r.id)) => sha1([r.publish_at ?? '', ...list.map((i) => `${i.rel}:${i.sha}`).sort()].join('\n'));

  /** Is this repo path a picture an open release keeps for itself (an upload must take another name)? */
  const reserved = (rel) => Boolean(db.prepare(`SELECT 1 FROM release_items i JOIN releases r ON r.id = i.release_id WHERE i.rel = ? AND i.kind = 'media' AND r.status IN (${LIVE_ITEMS.map(() => '?').join(', ')})`).get(rel, ...LIVE_ITEMS));

  /** The other open releases that write this file too. */
  const alsoIn = (rid, rel) => db.prepare(`SELECT r.id, r.name FROM release_items i JOIN releases r ON r.id = i.release_id WHERE i.rel = ? AND r.id != ? AND r.status IN ('open', 'scheduled')`).all(rel, rid);

  function itemView(r, it) {
    const meta = JSON.parse(it.meta);
    const now = OPEN.includes(r.status) ? shaNow(it.rel) : null;
    let url = null;
    if (it.kind === 'entry') {
      try {
        url = store.summarize(store.collection(it.collection), it.entry_id, bytesOf(it).toString('utf8')).url ?? null;
      } catch {
        url = null;
      }
    } else if (it.kind === 'media') url = app.mediaPrepare?.urlOf(it.rel) ?? null;
    return {
      id: it.id,
      kind: it.kind,
      title: it.title,
      collection: it.collection,
      entryId: it.entry_id,
      libraryId: it.lib_id,
      path: it.rel,
      url,
      bytes: it.bytes,
      ...(it.kind === 'media' ? { type: meta.type, width: meta.width ?? null, height: meta.height ?? null, alt: meta.alt ?? '' } : {}),
      ...(it.kind === 'library' ? { libraryKind: meta.kind } : {}),
      isNew: it.base === null,
      // the file changed on the site since it was added: the publish is refused until it is added again
      changedSince: OPEN.includes(r.status) ? now !== it.base && now !== it.sha : false,
      alsoIn: OPEN.includes(r.status) ? alsoIn(r.id, it.rel) : [],
      addedBy: { id: it.added_by, name: nameOf(it.added_by) },
      addedAt: it.added_at,
    };
  }

  /** A release for the API; `withItems: false` for the list (counts only). */
  function view(r, { withItems = true, ...extra } = {}) {
    const list = items(r.id);
    const by = (k) => list.filter((i) => i.kind === k).length;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      version: `r${r.rev}`,
      publishAt: r.publish_at,
      key: contentKey(r, list),
      counts: { items: list.length, entries: by('entry'), library: by('library'), media: by('media') },
      ...(withItems ? { items: list.map((it) => itemView(r, it)) } : {}),
      approvals: JSON.parse(r.approvals).map((a) => ({ ...a, name: nameOf(a.userId) })),
      checks: r.checks ? JSON.parse(r.checks) : null,
      createdBy: { id: r.created_by, name: nameOf(r.created_by) },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      scheduledBy: r.scheduled_by ? { id: r.scheduled_by, name: nameOf(r.scheduled_by) } : null,
      publishedAt: r.published_at,
      publishedBy: r.published_by ? { id: r.published_by, name: nameOf(r.published_by) } : null,
      buildTime: r.build_time,
      commit: r.commit_sha,
      revert: r.revert_sha,
      job: r.job_id,
      error: r.error,
      // scheduled, and stopped at its time (the rules, a file changed on the site, a publish rule): {words, rule, code, at}
      blocked: r.blocked ? JSON.parse(r.blocked) : null,
      ...extra,
    };
  }

  return { root, dirOf, row, must, items, item, bytesOf, shaNow, checkVersion, mustBeOpen, bump, putItem, dropItem, contentKey, reserved, view };
}
