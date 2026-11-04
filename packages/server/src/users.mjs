// User records, one-time setup codes (first owner, invites, resets) and the /users routes.
import { canManageUser, isRole } from './roles.mjs';
import { badRequest, conflict, flag, forbidden, invalid, newId, newSetupCode, normalizeCode, notFound, nowIso, sha256 } from './util.mjs';

const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const AUTHOR_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
export const INVITE_TTL_MS = 72 * 3_600_000;
export const OWNER_CODE_TTL_MS = 3_600_000;

/** Validate profile fields; returns {fields} with plain-words problems (empty when fine). */
/** An email as it is kept and compared: trimmed and lowercased (Unicode-aware, like the sign-on providers do). */
export const normalEmail = (email) => String(email ?? '').trim().toLowerCase();

export function checkProfile({ email, name, role, authorSlug }, { partial = false } = {}) {
  const fields = {};
  if (!partial || email !== undefined) if (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email)) fields.email = 'Enter a valid email address.';
  if (!partial || name !== undefined) if (typeof name !== 'string' || !name.trim() || name.length > 100) fields.name = 'Enter a name (up to 100 characters).';
  if (role !== undefined && !isRole(role)) fields.role = 'Unknown role.';
  if (authorSlug !== undefined && authorSlug !== null && authorSlug !== '' && !AUTHOR_SLUG.test(String(authorSlug))) fields.authorSlug = 'Use lowercase letters, digits and hyphens.';
  return fields;
}

export function createUsers(db, clock = () => Date.now()) {
  // a custom role (custom-roles/) is named for everyone to see and rides along, unlisted, for roles.mjs to ask
  const toPublic = (row) => {
    if (!row) return row;
    const custom = row.custom_role ? (users.customRoleOf?.(row.custom_role) ?? null) : null;
    const out = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      customRole: custom ? { id: custom.id, name: custom.name } : null,
      authorSlug: row.author_slug ?? null,
      twoFactor: Boolean(row.totp_secret),
      disabled: Boolean(row.disabled),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at ?? null,
    };
    if (custom) Object.defineProperty(out, 'custom', { value: custom, enumerable: false });
    return out;
  };

  const users = {
    toPublic,
    // set by the app (custom-roles/): the role named by a user's custom_role, ready to answer
    customRoleOf: null,
    get: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
    // emails are kept and looked up lowercased (migration 21 lowercased the older rows), so `Owner@Example.com`
    // and `owner@example.com` are one account for the sign-in, the invite, the provider's email and the CLI
    byEmail: (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(normalEmail(email)),
    list: () => db.prepare('SELECT * FROM users ORDER BY created_at').all(),
    ownerCount: () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled = 0").get().n,

    create({ email, name, role, authorSlug = null, pwHash = null }) {
      const id = newId('u');
      db.prepare('INSERT INTO users (id, email, name, role, author_slug, pw_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id,
        normalEmail(email),
        name.trim(),
        role,
        authorSlug || null,
        pwHash,
        nowIso(clock()),
      );
      return this.get(id);
    },

    update(id, { name, role, authorSlug, disabled, customRole }) {
      const row = this.get(id);
      db.prepare('UPDATE users SET name = ?, role = ?, author_slug = ?, disabled = ?, custom_role = ? WHERE id = ?').run(
        name !== undefined ? name.trim() : row.name,
        role ?? row.role,
        authorSlug !== undefined ? authorSlug || null : row.author_slug,
        disabled !== undefined ? (disabled ? 1 : 0) : row.disabled,
        customRole !== undefined ? customRole : row.custom_role,
        id,
      );
      return this.get(id);
    },

    setPassword: (id, pwHash) => db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(pwHash, id),
    touchLogin: (id) => db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(clock()), id),

    /** Issue a one-time code. Earlier unused codes for the same user/purpose stop working. */
    issueCode(purpose, userId, ttlMs) {
      const code = newSetupCode();
      db.prepare('DELETE FROM setup_codes WHERE purpose = ? AND user_id IS ? AND used_at IS NULL').run(purpose, userId);
      db.prepare('INSERT INTO setup_codes (code_hash, purpose, user_id, expires_at) VALUES (?, ?, ?, ?)').run(sha256(normalizeCode(code)), purpose, userId, clock() + ttlMs);
      return code;
    },

    /** The unused, unexpired code row for this typed code, or undefined. Codes are 80-bit random: a hash lookup is safe. */
    findCode(purpose, code) {
      const row = db.prepare('SELECT * FROM setup_codes WHERE code_hash = ? AND purpose = ?').get(sha256(normalizeCode(code)), purpose);
      return row && !row.used_at && row.expires_at > clock() ? row : undefined;
    },

    useCode: (row) => db.prepare('UPDATE setup_codes SET used_at = ? WHERE code_hash = ?').run(nowIso(clock()), row.code_hash),
  };
  return users;
}

/** Routes under /users (owner and administrator; `?brief=1` for everyone). */
export function userRoutes(router, app) {
  const { users, sessions, audit } = app;
  const target = (ctx) => {
    const row = users.get(ctx.params.uid);
    if (!row) throw notFound('No such user.');
    return row;
  };
  const mustManage = (ctx, row, role) => {
    if (!canManageUser(ctx.user, row ? users.toPublic(row) : null, role)) throw forbidden('You cannot manage this user.');
  };

  router.add('GET', '/users', (ctx) => {
    if (flag(ctx.query, 'brief')) return users.list().map((u) => ({ id: u.id, name: u.name, authorSlug: u.author_slug ?? null }));
    mustManage(ctx, null);
    return users.list().map(users.toPublic);
  });

  router.add('GET', '/users/:uid', (ctx) => {
    const row = target(ctx);
    if (row.id !== ctx.user.id) mustManage(ctx, null);
    return users.toPublic(row);
  });

  router.add('POST', '/users', (ctx) => {
    const { email, name, role, authorSlug } = ctx.body;
    const fields = checkProfile({ email, name, role, authorSlug });
    if (!role) fields.role = 'Choose a role.';
    if (Object.keys(fields).length) throw invalid(fields);
    mustManage(ctx, null, role);
    if (role === 'owner') throw badRequest('There is one owner. Transfer ownership by changing roles.');
    if (users.byEmail(email)) throw conflict('A user with this email already exists.');
    const row = users.create({ email, name, role, authorSlug });
    const setupCode = users.issueCode('invite', row.id, INVITE_TTL_MS);
    audit.log(ctx, 'user.create', { target: row.id, detail: { role } });
    app.notices?.tell({ kind: 'user.invited', level: 'warn', text: `${ctx.user.name} invited ${row.name} (${row.email}) as ${role}.`, link: `#/users/${row.id}`, to: 'administrators' });
    ctx.status = 201;
    return { user: users.toPublic(row), setupCode };
  });

  router.add('PATCH', '/users/:uid', (ctx) => {
    const row = target(ctx);
    const { name, authorSlug, disabled } = ctx.body;
    let { role } = ctx.body;
    const fields = checkProfile({ name, role, authorSlug }, { partial: true });
    if (ctx.body.customRole !== undefined && ctx.body.customRole !== null && typeof ctx.body.customRole !== 'string') fields.customRole = 'A role’s id, or null.';
    if (Object.keys(fields).length) throw invalid(fields);
    mustManage(ctx, row, role);
    // a custom role sets the rank to its base; a built-in role given alone takes the custom one away
    let customRole;
    if (ctx.body.customRole !== undefined) {
      if (role !== undefined && ctx.body.customRole !== null) throw invalid({ role: 'Give a role or a custom role, not both.' });
      const a = app.customRoles.assign(ctx, row, ctx.body.customRole);
      customRole = a.custom_role;
      role = a.role ?? role;
    } else if (role !== undefined && row.custom_role) customRole = null;
    if (disabled && row.id === ctx.user.id) throw badRequest('You cannot disable yourself.');
    const losesOwner = row.role === 'owner' && ((role && role !== 'owner') || disabled);
    const addsOwner = role === 'owner' && row.role !== 'owner';
    // exactly one owner: making someone owner demotes the current owner to administrator in the same step
    if (losesOwner && !addsOwner && users.ownerCount() <= 1) throw conflict('The site needs an owner. Make someone else the owner first.');
    if (addsOwner) {
      if (row.disabled || disabled) throw badRequest('A disabled user cannot be the owner.');
      users.update(ctx.user.id, { role: 'administrator' });
    }
    const updated = users.update(row.id, { name, role, authorSlug, disabled, customRole });
    if (disabled) sessions.revokeUser(row.id);
    audit.log(ctx, 'user.update', { target: row.id, detail: { role, disabled, authorSlug, ...(customRole !== undefined ? { customRole } : {}) } });
    // a new role or an account turned off or on: a safety alert, to the administrators and the person
    const what = [
      role && role !== row.role ? `changed ${row.name}'s role from ${row.role} to ${role}` : null,
      customRole !== undefined && customRole !== row.custom_role ? (customRole ? `gave ${row.name} the role ${app.customRoles.customRoleOf(customRole)?.name ?? customRole}` : `took the custom role away from ${row.name}`) : null,
      disabled !== undefined && Boolean(disabled) !== Boolean(row.disabled) ? `${disabled ? 'turned off' : 'turned back on'} ${row.name}'s account` : null,
    ].filter(Boolean);
    if (addsOwner) what.push(`${ctx.user.name} is now an administrator`);
    if (what.length) app.notices?.tell({ kind: 'user.role', level: 'warn', text: `${ctx.user.name} ${what.join(' and ')}.`, link: `#/users/${row.id}`, to: [row.id, ...(addsOwner ? [ctx.user.id] : [])] });
    return users.toPublic(updated);
  });

  router.add('POST', '/users/:uid/reset', (ctx) => {
    const row = target(ctx);
    mustManage(ctx, row);
    if (row.id === ctx.user.id) throw badRequest('Change your own password from your profile.');
    users.setPassword(row.id, null);
    sessions.revokeUser(row.id);
    const setupCode = users.issueCode('invite', row.id, INVITE_TTL_MS);
    audit.log(ctx, 'user.reset', { target: row.id });
    return { setupCode };
  });

  router.add('POST', '/users/:uid/2fa/reset', (ctx) => {
    const row = target(ctx);
    mustManage(ctx, row);
    app.db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL WHERE id = ?').run(row.id);
    app.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(row.id);
    audit.log(ctx, 'user.2fa.reset', { target: row.id });
    return { ok: true };
  });

  router.add('POST', '/users/:uid/revoke-sessions', (ctx) => {
    const row = target(ctx);
    if (row.id !== ctx.user.id) mustManage(ctx, row);
    const revoked = sessions.revokeUser(row.id, row.id === ctx.user.id ? ctx.session?.id : null);
    audit.log(ctx, 'user.revoke', { target: row.id, detail: { revoked } });
    return { ok: true, revoked };
  });

  router.add('DELETE', '/users/:uid', (ctx) => {
    const row = target(ctx);
    mustManage(ctx, row);
    if (row.id === ctx.user.id) throw badRequest('You cannot delete yourself.');
    if (row.role === 'owner') throw conflict('Transfer ownership before deleting the owner.');
    app.db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
    audit.log(ctx, 'user.delete', { target: row.id, detail: { email: row.email } });
    return { ok: true };
  });
}
