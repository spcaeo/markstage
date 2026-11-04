// Server-side sessions. The cookie holds a random token; the database holds only its sha256, so a leaked database
// copy cannot be replayed as a cookie. Each session has its own CSRF token, an idle timeout and an absolute
// timeout, and can be revoked at any time.
import { newId, newToken, sha256 } from '../util.mjs';

export const COOKIE = '__Host-markstage';
// last_seen_at is written at most this often, so reads do not turn into a write per request
const TOUCH_MS = 60_000;

export function createSessions(db, config, clock = () => Date.now()) {
  const idleMs = config.session.idleMinutes * 60_000;
  const absoluteMs = config.session.absoluteHours * 3_600_000;

  return {
    idleMs,
    absoluteMs,

    /** Start a session for a user. Returns { id, token, csrf }; the caller sets the cookie. */
    create(userId, { ip, userAgent }) {
      const token = newToken(32);
      const csrf = newToken(24);
      const id = newId('s');
      const now = clock();
      db.prepare(
        'INSERT INTO sessions (id, token_hash, user_id, csrf, created_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, sha256(token), userId, csrf, now, now, ip ?? null, String(userAgent ?? '').slice(0, 300));
      return { id, token, csrf };
    },

    /** The live session for a cookie token, or null (unknown, revoked, idle too long, too old, user disabled). */
    lookup(token) {
      if (!token || token.length > 100) return null;
      const row = db
        .prepare(
          `SELECT s.*, u.disabled FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
        )
        .get(sha256(token));
      if (!row || row.disabled) return null;
      const now = clock();
      if (now - row.last_seen_at > idleMs || now - row.created_at > absoluteMs) {
        db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now, row.id);
        return null;
      }
      if (now - row.last_seen_at > TOUCH_MS) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, row.id);
      return { id: row.id, userId: row.user_id, csrf: row.csrf, createdAt: row.created_at };
    },

    /** The session with this id if it is still live, without touching it (the preview origin's cookie is bound to it). */
    alive(id) {
      const row = db.prepare('SELECT s.*, u.disabled FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.revoked_at IS NULL').get(String(id ?? ''));
      if (!row || row.disabled) return null;
      const now = clock();
      if (now - row.last_seen_at > idleMs || now - row.created_at > absoluteMs) return null;
      return { id: row.id, userId: row.user_id, createdAt: row.created_at };
    },

    revoke(id) {
      return db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(clock(), id).changes;
    },

    /** Revoke every session of a user, except `keepId` when given. Returns how many were revoked. */
    revokeUser(userId, keepId = null) {
      return db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?')
        .run(clock(), userId, keepId).changes;
    },

    listForUser(userId) {
      const now = clock();
      return db
        .prepare('SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC')
        .all(userId)
        .filter((s) => now - s.last_seen_at <= idleMs && now - s.created_at <= absoluteMs);
    },

    /** Drop rows that can never be valid again (keeps the table small). */
    sweep() {
      const now = clock();
      db.prepare('DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR created_at < ?').run(now - 86_400_000, now - absoluteMs - 86_400_000);
      db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(now);
    },
  };
}

/** Short-lived 2FA challenges between the password step and the code step: 5 minutes, 5 codes. */
export function createChallenges(db, clock = () => Date.now()) {
  const TTL = 5 * 60_000;
  const MAX = 5;
  return {
    create(userId) {
      const token = newToken(24);
      db.prepare('INSERT INTO challenges (id, token_hash, user_id, expires_at) VALUES (?, ?, ?, ?)').run(newId('c'), sha256(token), userId, clock() + TTL);
      return token;
    },
    /** Count one attempt; return the user id if the challenge is still usable, else null. */
    use(token) {
      if (!token || String(token).length > 100) return null;
      const row = db.prepare('SELECT * FROM challenges WHERE token_hash = ?').get(sha256(String(token)));
      if (!row || row.expires_at < clock() || row.attempts >= MAX) return null;
      db.prepare('UPDATE challenges SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      return { id: row.id, userId: row.user_id };
    },
    consume(id) {
      db.prepare('DELETE FROM challenges WHERE id = ?').run(id);
    },
  };
}
