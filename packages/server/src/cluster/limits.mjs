// The limits' recent hits, in the database, so every server process counts the same window (docs/SCALING.md): a
// sign-in miss per address, a try at a share link, a wrong token, an MCP call, a redirect test, an AI ask in flight.
// Each change is one write transaction: two processes cannot both see "one left" and both take it. Times are the
// app's clock (tests move it), as the limits always used.
//
// The table stays small under a flood: a refused try is never written (take() counts first), an IPv6 address counts
// as its /64 (one person usually holds a whole /64, so rotating addresses inside it gains nothing: limitKey), and
// hits whose window has passed are deleted at most a minute later, by whichever process writes next.
import { tx } from '../db.mjs';
import { netOf } from '../util.mjs';

/** How often the passed hits are deleted, at most (by the next write after it). */
const TIDY_MS = 60_000;

/** The key an address is counted under: an IPv4 address as it is, an IPv6 address as its /64. */
export function limitKey(ip) {
  const s = String(ip ?? '').trim();
  if (!s) return '-';
  if (!s.includes(':') || /^::ffff:\d/i.test(s)) return s;
  return netOf(s) ?? s;
}

export function createHits(db, { owner, clock }) {
  const prune = (bucket, key, at) => db.prepare('DELETE FROM limit_hits WHERE bucket = ? AND key = ? AND expires_at <= ?').run(bucket, key, at);
  const stats = (bucket, key, since) => db.prepare('SELECT COUNT(*) AS n, MIN(at) AS oldest FROM limit_hits WHERE bucket = ? AND key = ? AND at > ?').get(bucket, key, since);
  const insert = (bucket, key, at, windowMs, mine) => db.prepare('INSERT INTO limit_hits (bucket, key, at, expires_at, owner) VALUES (?, ?, ?, ?, ?)').run(bucket, key, at, at + windowMs, mine ? owner : null);
  const sweep = (at) => Number(db.prepare('DELETE FROM limit_hits WHERE expires_at <= ? AND owner IS NULL').run(at).changes);
  let tidied = -Infinity;
  /** On a write: the passed hits of every key go, at most once a minute (a clock moved back starts it again). */
  function tidy(at) {
    if (at >= tidied && at - tidied < TIDY_MS) return;
    tidied = at;
    sweep(at);
  }

  return {
    /** The hits in the window now: {n, oldest} (oldest: the time of the first, or null). Writes nothing. */
    count(bucket, key, windowMs, at = clock()) {
      const r = stats(bucket, key, at - windowMs);
      return { n: r.n, oldest: r.oldest ?? null };
    },
    /** Record one hit (it counts for `windowMs`). `mine`: it goes when this process stops (work in flight). */
    add(bucket, key, windowMs, { at = clock(), mine = false } = {}) {
      tidy(at);
      insert(bucket, key, at, windowMs, mine);
    },
    /**
     * Record one hit unless the window holds `max` already: null when it was recorded, else {n, oldest} (the caller
     * answers 429; a refused one writes nothing). `also`: more [bucket, windowMs, max] that must have room too and
     * get the same hit (an MCP write counts as a call and as a write).
     */
    take(bucket, key, windowMs, max, { at = clock(), also = [] } = {}) {
      return tx(db, () => {
        const all = [[bucket, windowMs, max], ...also];
        for (const [b, w, m] of all) {
          prune(b, key, at);
          const r = stats(b, key, at - w);
          if (r.n >= m) return { bucket: b, n: r.n, oldest: r.oldest };
        }
        tidy(at);
        for (const [b, w] of all) insert(b, key, at, w, false);
        return null;
      });
    },
    /** Forget every hit of this key (a right sign-in clears its address). */
    clear(bucket, key) {
      db.prepare('DELETE FROM limit_hits WHERE bucket = ? AND key = ?').run(bucket, key);
    },
    /** Forget one hit of this process's (an AI ask in flight that ended). */
    drop(bucket, key) {
      db.prepare('DELETE FROM limit_hits WHERE rowid = (SELECT rowid FROM limit_hits WHERE bucket = ? AND key = ? AND owner = ? LIMIT 1)').run(bucket, key, owner);
    },
    /**
     * True at most once per `everyMs` per key, across every process ("audited once a minute"): the first caller in
     * the window gets true and the rest false.
     */
    once(bucket, key, everyMs, at = clock()) {
      return tx(db, () => {
        const last = db.prepare('SELECT MAX(at) AS at FROM limit_hits WHERE bucket = ? AND key = ?').get(bucket, key).at;
        if (last !== null && at - last < everyMs) return false;
        tidy(at);
        db.prepare('DELETE FROM limit_hits WHERE bucket = ? AND key = ?').run(bucket, key);
        insert(bucket, key, at, everyMs, false);
        return true;
      });
    },
    /** Housekeeping: hits whose window has passed (also done on writes, at most once a minute). */
    sweep: (at = clock()) => sweep(at),
  };
}
