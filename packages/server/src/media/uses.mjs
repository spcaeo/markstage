// Where each media file is used (docs/API.md "Media"): the `media_uses` table, path under the media folder ->
// the entries whose text names it, filled per entry version from the content index. Before any answer, `sync`
// compares the index (every entry's version) with what the table holds and re-reads only the entries that changed,
// came or went: a save, an import, a bulk change or a pull move a few rows, never a scan of every text against
// every file. The first ask fills the table once.
//
// An entry names a file when its text holds the file's path under the media folder as a whole path piece: in
// `/uploads/2026/01/photo.jpg`, `photo.jpg`, `01/photo.jpg` and `2026/01/photo.jpg` are such pieces (a path is cut
// at whitespace, quotes, brackets, commas, `?` and `#`). A file whose own path holds one of those marks (a space in
// its name) is looked for in the texts themselves.
import path from 'node:path';
import { tx } from '../db.mjs';

const CUT = /[\s"'`()<>[\]{}\\,|?#]+/;
const EXT = /\.[A-Za-z0-9]{1,8}$/;

/** The path pieces of a text that could name a file: every suffix of a path-like word that starts at a `/`. */
export function piecesOf(text) {
  const out = new Set();
  for (const word of text.split(CUT)) {
    if (!EXT.test(word) || word.length > 400) continue;
    const w = word.replace(/^\/+/, '');
    let at = 0;
    for (;;) {
      out.add(w.slice(at));
      const next = w.indexOf('/', at);
      if (next === -1) break;
      at = next + 1;
    }
  }
  return out;
}

export function createMediaUses(app) {
  const { db, store, config } = app;
  const media = config.media;
  const relToMedia = (row) => path.relative(media.dir, row.path).split(path.sep).join('/');
  const plain = (p) => !CUT.test(p);

  /** Bring the table up to the content index: only the entries whose version moved are read. */
  function sync() {
    const have = new Map(db.prepare('SELECT collection, entry_id, version FROM media_use_entries').all().map((r) => [`${r.collection}/${r.entry_id}`, r.version]));
    const changed = [];
    for (const c of store.collections) {
      for (const e of store.index(c).values()) {
        const key = `${c.id}/${e.id}`;
        if (have.get(key) === e.version) {
          have.delete(key);
          continue;
        }
        have.delete(key);
        changed.push({ c, id: e.id, version: e.version });
      }
    }
    const gone = [...have.keys()];
    if (!changed.length && !gone.length) return { changed: 0, gone: 0 };
    const dropUses = db.prepare('DELETE FROM media_uses WHERE collection = ? AND entry_id = ?');
    const dropEntry = db.prepare('DELETE FROM media_use_entries WHERE collection = ? AND entry_id = ?');
    const putEntry = db.prepare('INSERT INTO media_use_entries (collection, entry_id, version) VALUES (?, ?, ?) ON CONFLICT (collection, entry_id) DO UPDATE SET version = excluded.version');
    const putUse = db.prepare('INSERT INTO media_uses (collection, entry_id, path) VALUES (?, ?, ?)');
    tx(db, () => {
      for (const key of gone) {
        const i = key.indexOf('/');
        dropUses.run(key.slice(0, i), key.slice(i + 1));
        dropEntry.run(key.slice(0, i), key.slice(i + 1));
      }
      for (const { c, id, version } of changed) {
        let text;
        try {
          text = store.read(c, id).text;
        } catch {
          continue;
        }
        dropUses.run(c.id, id);
        for (const p of piecesOf(text)) putUse.run(c.id, id, p);
        putEntry.run(c.id, id, version);
      }
    });
    return { changed: changed.length, gone: gone.length };
  }

  /** The entries that name this media row's file: [{collection, id, title}]. */
  function usedBy(row) {
    sync();
    const p = relToMedia(row);
    const refs = plain(p) ? db.prepare('SELECT DISTINCT collection, entry_id FROM media_uses WHERE path = ?').all(p).map((r) => ({ collection: r.collection, id: r.entry_id })) : scanFor(p);
    const out = [];
    for (const r of refs) {
      let c;
      try {
        c = store.collection(r.collection);
      } catch {
        continue;
      }
      const e = store.index(c).get(r.id);
      if (e) out.push({ collection: c.id, id: e.id, title: store.summaryOf(c, e).title });
    }
    return out;
  }

  /** The files (their paths under the media folder) that some entry names: for "unused" over a whole list. */
  function usedPaths() {
    sync();
    return new Set(db.prepare('SELECT DISTINCT path FROM media_uses').all().map((r) => r.path));
  }

  /** Is this file used at all? `used` is usedPaths() when the caller asks about many files. */
  const isUsed = (row, used = usedPaths()) => {
    const p = relToMedia(row);
    return plain(p) ? used.has(p) : scanFor(p).length > 0;
  };

  /** How many entries name a path under the media folder (the file indexer's report). */
  function countOf(inMedia) {
    sync();
    return plain(inMedia) ? db.prepare("SELECT COUNT(DISTINCT collection || '/' || entry_id) AS n FROM media_uses WHERE path = ?").get(inMedia).n : scanFor(inMedia).length;
  }

  /** The slow way, for a path with a mark in it: the texts themselves. */
  function scanFor(p) {
    const out = [];
    for (const c of store.collections) {
      for (const e of store.index(c).values()) {
        try {
          if (store.read(c, e.id).text.includes(p)) out.push({ collection: c.id, id: e.id });
        } catch {
          // gone between the index and the read
        }
      }
    }
    return out;
  }

  return { sync, usedBy, usedPaths, isUsed, countOf, relToMedia };
}
