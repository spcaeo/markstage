// Login throttling, three layers:
//  - per IP: a sliding window of *failed* attempts (in memory; a restart forgets it, which is fine for a window of
//    minutes; one server process is assumed, see docs/SECURITY.md "Known limits"). A right sign-in never counts, and
//    it clears the address's misses, so an office or a proxy with many people behind one address is not locked out
//    by its own successful sign-ins.
//  - per (account, address) pair: progressive lockout kept in the database. After `accountFreeFailures` misses in a
//    row from one address the pair is locked for lockBaseSeconds, doubling per further miss up to lockMaxSeconds.
//    So a stranger who knows an email locks only their own address out, not the person.
//  - per account, from anywhere: only after `accountMaxFailures` misses within `accountWindowSeconds` (a spread
//    attack from many addresses) the account itself is locked for lockMaxSeconds. A browser the person signed in
//    from before (the known-device cookie) may still try its password during that lock (auth/routes.mjs).
// A success clears the pair and the account. The same keys serve protected pages (protect.mjs: `page:<entry>`).
import { HttpError } from '../util.mjs';

const WORDS = (retryAfter) => `Too many wrong tries. This account is locked for ${retryAfter} seconds.`;

export function createLimiter(db, settings, clock = () => Date.now()) {
  const ipHits = new Map();
  const windowMs = settings.ipWindowSeconds * 1000;
  const maxFailures = settings.accountMaxFailures ?? 50;
  const accountWindowMs = (settings.accountWindowSeconds ?? 3600) * 1000;

  const recent = (ip, now) => (ipHits.get(ip) ?? []).filter((t) => now - t < windowMs);

  /** Refuse (429) while this address has `ipMaxAttempts` misses in the window. Looking does not count. */
  function ipCheck(ip) {
    const now = clock();
    const hits = recent(ip, now);
    if (hits.length) ipHits.set(ip, hits);
    else ipHits.delete(ip);
    if (hits.length >= settings.ipMaxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
      throw new HttpError(429, 'rate-limited', `Too many failed sign-ins from your network. Try again in ${retryAfter} seconds.`, { retryAfter });
    }
  }

  /** Record a miss from this address (a wrong password, code or invite). */
  function ipFailure(ip) {
    const now = clock();
    const hits = recent(ip, now);
    hits.push(now);
    ipHits.set(ip, hits);
    // keep the map bounded if a scanner rotates through many addresses
    if (ipHits.size > 10_000) for (const key of ipHits.keys()) if (ipHits.size > 5_000) ipHits.delete(key);
  }

  /** A right sign-in from this address: its misses are forgotten. */
  function ipSuccess(ip) {
    ipHits.delete(ip);
  }

  const norm = (email) => String(email ?? '').trim().toLowerCase();
  const acctKey = (email) => `acct:${norm(email)}`;
  const pairKey = (email, ip) => `pair:${norm(email)}|${String(ip ?? '-')}`;
  const row = (k) => db.prepare('SELECT failures, locked_until, last_failure_at FROM lockouts WHERE key = ?').get(k);
  const put = (k, failures, lockedUntil, now) =>
    db.prepare(
      `INSERT INTO lockouts (key, failures, locked_until, last_failure_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until, last_failure_at = excluded.last_failure_at`,
    ).run(k, failures, lockedUntil, now);
  const secondsLeft = (r, now) => (r && r.locked_until > now ? Math.ceil((r.locked_until - now) / 1000) : 0);

  /** Seconds the account itself (from every address) is still locked, else 0. */
  const accountLockedFor = (email) => secondsLeft(row(acctKey(email)), clock());

  /**
   * Refuse (423) while this address is locked out of the account, or while the account itself is locked.
   * `knownDevice`: the browser is one the person signed in from before, so the account-wide lock does not stop it
   * (the pair lock still does); the route then lets a right password through and answers 423 to a wrong one.
   */
  function accountCheck(email, ip = null, { knownDevice = false } = {}) {
    const now = clock();
    const pair = secondsLeft(row(pairKey(email, ip)), now);
    if (pair) throw new HttpError(423, 'locked', WORDS(pair), { retryAfter: pair });
    const acct = accountLockedFor(email);
    if (acct && !knownDevice) throw new HttpError(423, 'locked', WORDS(acct), { retryAfter: acct });
  }

  /**
   * Record a miss from `ip`. Returns {seconds, scope} when this miss locked the pair ('device') or the account
   * ('account'), else null; the pair's lock is progressive, the account's is lockMaxSeconds after maxFailures in
   * the window.
   */
  function accountFailure(email, ip = null) {
    ipFailure(ip);
    const now = clock();
    const pk = pairKey(email, ip);
    const pr = row(pk);
    const failures = (pr?.failures ?? 0) + 1;
    let lockSeconds = 0;
    if (failures >= settings.accountFreeFailures) {
      const extra = failures - settings.accountFreeFailures;
      lockSeconds = Math.min(settings.lockMaxSeconds, settings.lockBaseSeconds * 2 ** Math.min(extra, 20));
    }
    put(pk, failures, lockSeconds ? now + lockSeconds * 1000 : 0, now);

    const ak = acctKey(email);
    const ar = row(ak);
    const inWindow = ar && now - ar.last_failure_at < accountWindowMs ? ar.failures : 0;
    const total = inWindow + 1;
    const acctLocked = total >= maxFailures;
    put(ak, total, acctLocked ? now + settings.lockMaxSeconds * 1000 : (ar?.locked_until > now ? ar.locked_until : 0), now);
    if (acctLocked) return { seconds: settings.lockMaxSeconds, scope: 'account' };
    return lockSeconds ? { seconds: lockSeconds, scope: 'device' } : null;
  }

  /** A right password: this address's and the account's counters are cleared. */
  function accountSuccess(email, ip = null) {
    ipSuccess(ip);
    db.prepare('DELETE FROM lockouts WHERE key = ? OR key = ?').run(pairKey(email, ip), acctKey(email));
  }

  /** Housekeeping: rows whose lock ended and whose last miss is older than the account window. */
  function sweep() {
    const now = clock();
    return Number(db.prepare('DELETE FROM lockouts WHERE locked_until < ? AND last_failure_at < ?').run(now, now - accountWindowMs).changes);
  }

  return { ipCheck, ipFailure, ipSuccess, accountCheck, accountFailure, accountSuccess, accountLockedFor, sweep, reset: () => ipHits.clear() };
}
