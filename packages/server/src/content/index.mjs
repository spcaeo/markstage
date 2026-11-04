// The content index (docs/ARCHITECTURE.md "The content index"): every entry of every collection, summarised once per
// file version and kept in memory, so a list, a count, the link map or the site check-up never read and parse the
// whole collection again. It is never trusted blindly: before it answers, it stats every file in the collection
// folders (readdir + stat, a few milliseconds for a thousand files) and re-reads only the files whose size, mtime or
// inode moved, and drops the ones that are gone. So a save made here, a `git pull` run in a terminal, a checkout by
// the environments, or an editor writing the file by hand are all seen on the next request. A stale index is worse
// than a slow one.
//
// `rev` is the content version: it moves whenever a change is seen (a write through the store, or one found on
// disk). Anything derived from the index (the link map, the known pages, the media uses) is kept by `rev` and
// rebuilt only when it moved. The stat sweep runs at most once per turn of the event loop (a request handler that
// asks ten times inside one synchronous run gets one sweep); a write through the store updates the index at once.
import fs from 'node:fs';
import path from 'node:path';
import { ID } from '../config.mjs';
import { sha1 } from '../util.mjs';

/**
 * `summarise(c, text)` -> what the index keeps of a file besides its version (the parsed fields, the words).
 * Returns {entries(c), rev(), put(c, id, text), drop(c, id), touch()}.
 */
export function createContentIndex(collections, summarise) {
  const byCollection = new Map(collections.map((c) => [c.id, new Map()]));
  let rev = 0;
  let swept = false;

  const same = (e, st) => e.size === st.size && e.mtimeMs === st.mtimeMs && e.ino === st.ino;

  /** One file's record: its stat, version, and what `summarise` makes of its text. */
  function record(c, id, st) {
    const text = fs.readFileSync(path.join(c.absDir, id + c.ext), 'utf8');
    return { id, version: sha1(text), size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, ...summarise(c, text) };
  }

  /** Stat every file of one collection; read the changed ones; forget the gone ones. True when anything moved. */
  function sweep(c) {
    const entries = byCollection.get(c.id);
    let list;
    try {
      list = fs.readdirSync(c.absDir, { withFileTypes: true });
    } catch {
      list = [];
    }
    const seen = new Set();
    let moved = false;
    for (const d of list) {
      if (!d.isFile() || !d.name.endsWith(c.ext)) continue;
      const id = d.name.slice(0, -c.ext.length);
      if (!ID.test(id)) continue;
      let st;
      try {
        st = fs.statSync(path.join(c.absDir, d.name));
      } catch {
        continue;
      }
      seen.add(id);
      const hit = entries.get(id);
      if (hit && same(hit, st)) continue;
      try {
        entries.set(id, record(c, id, st));
        moved = true;
      } catch {
        // a file that cannot be read is no entry (it comes in when it can)
        if (entries.delete(id)) moved = true;
      }
    }
    for (const id of entries.keys()) if (!seen.has(id)) entries.delete(id), (moved = true);
    return moved;
  }

  /** Sweep every collection once per turn of the event loop. */
  function fresh() {
    if (swept) return;
    for (const c of collections) if (sweep(c)) rev++;
    swept = true;
    setImmediate(() => {
      swept = false;
    });
  }

  return {
    /** The entries of a collection as they are now: Map id -> {id, version, ...summary}. Do not change them. */
    entries(c) {
      fresh();
      return byCollection.get(c.id);
    },
    /** The content version: a number that moves on every change seen. */
    rev() {
      fresh();
      return rev;
    },
    /** A file the store just wrote: into the index at once (no sweep needed to see it). */
    put(c, id, text) {
      let st;
      try {
        st = fs.statSync(path.join(c.absDir, id + c.ext));
      } catch {
        return;
      }
      byCollection.get(c.id).set(id, { id, version: sha1(text), size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, ...summarise(c, text) });
      rev++;
    },
    /** A file the store just removed. */
    drop(c, id) {
      if (byCollection.get(c.id).delete(id)) rev++;
    },
    /** Make the next ask sweep the folders again, whatever the turn (after a git command that moved files). */
    touch() {
      swept = false;
    },
  };
}
