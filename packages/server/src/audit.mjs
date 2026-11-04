// Append-only audit log: who did what, when, from where. There is no route to change or delete rows.
import { nowIso } from './util.mjs';

const MAX = 4000;
/**
 * Keep a row small but always valid JSON, and keep what finds it again: a long detail keeps its short top-level
 * values (a commit, an action, a field) and says how many items each long list had; the rest is a preview.
 */
export function clip(detail) {
  const json = JSON.stringify(detail);
  if (json.length <= MAX) return json;
  const kept = { truncated: true };
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    for (const [k, v] of Object.entries(detail)) {
      if (v === null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200)) kept[k] = v;
      else if (Array.isArray(v)) kept[`${k}Count`] = v.length;
    }
  }
  const room = MAX - JSON.stringify({ ...kept, preview: '' }).length;
  // the preview is cut until its escaped form fits
  let preview = json.slice(0, Math.max(room, 0));
  while (preview && JSON.stringify(preview).length - 2 > room) preview = preview.slice(0, Math.floor(preview.length * 0.9));
  const out = JSON.stringify({ ...kept, preview });
  return out.length <= MAX ? out : JSON.stringify({ truncated: true });
}

export function createAudit(db, clock = () => Date.now()) {
  const insert = db.prepare(
    'INSERT INTO audit (at, user_id, user_name, ip, user_agent, action, target, ok, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const listeners = [];
  return {
    /** Hear every action as it is recorded (webhooks/): fn({ctx, action, target, ok, detail}); a listener's error is its own. */
    listen(fn) {
      listeners.push(fn);
    },

    /**
     * Record an action. `ctx` is the request context ({ user, ip, userAgent }) or null for the server itself. An
     * action an AI agent took through the MCP server (ctx.via) says so, with the token's name: "Alice via MCP".
     */
    log(ctx, action, { target = null, ok = true, detail = null } = {}) {
      if (ctx?.via) detail = { ...(detail ?? {}), via: ctx.via.kind, token: ctx.via.tokenName };
      insert.run(
        nowIso(clock()),
        ctx?.user?.id ?? null,
        ctx?.user?.name ?? ctx?.actorName ?? null,
        ctx?.ip ?? null,
        ctx?.userAgent ? String(ctx.userAgent).slice(0, 300) : null,
        action,
        target,
        ok ? 1 : 0,
        detail ? clip(detail) : null,
      );
      for (const fn of listeners) {
        try {
          fn({ ctx, action, target, ok, detail });
        } catch (e) {
          console.error(`[markstage] audit listener: ${e.message}`);
        }
      }
    },

    list({ user, action, from, to, before, limit = 100 } = {}) {
      const where = [];
      const args = [];
      if (user) where.push('user_id = ?') && args.push(user);
      if (action) where.push("action LIKE ? ESCAPE '\\'") && args.push(`${String(action).replace(/[\\%_]/g, '\\$&')}%`);
      if (from) where.push('at >= ?') && args.push(String(from));
      if (to) where.push('at <= ?') && args.push(String(to));
      if (before) where.push('id < ?') && args.push(Number(before));
      const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
      const rows = db
        .prepare(`SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
        .all(...args, n + 1);
      const items = rows.slice(0, n).map((r) => ({
        id: r.id,
        at: r.at,
        userId: r.user_id,
        userName: r.user_name,
        ip: r.ip,
        userAgent: r.user_agent,
        action: r.action,
        target: r.target,
        ok: Boolean(r.ok),
        detail: r.detail ? JSON.parse(r.detail) : null,
      }));
      return { items, next: rows.length > n ? items[items.length - 1].id : null };
    },
  };
}
