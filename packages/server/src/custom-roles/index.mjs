// Custom roles (docs/API-ROLES.md): kept in the database of this environment (like its users), edited by the owner
// and administrators, given to a person in place of a built-in role. A person with one has its base as `role` (so
// every rank check still holds) and the role itself as `custom` (roles.mjs asks it first).
//
//   GET    /roles                    {builtin, custom: [role], actions, kinds, collections}
//   POST   /roles                    {id, name, base, rules} -> 201 {role}
//   PUT    /roles/:rid               {name, base, rules, version} -> {role}
//   DELETE /roles/:rid               the people with it keep its base role
//   POST   /roles/check              {userId, action, collection?, id?} -> what the person may do, and why
import { ROLES, abilities, can, canCreate, canManageUser, entryCan } from '../roles.mjs';
import { HttpError, conflict, forbidden, notFound, nowIso } from '../util.mjs';
import { tx } from '../db.mjs';
import { BASES, ENTRY_ACTIONS, KINDS, MAX_ROLES, changedPaths, checkRole, compileRole } from './rules.mjs';

const invalid = (words, field) => new HttpError(422, 'invalid', words, field ? { field } : {});

export function createCustomRoles(app) {
  const { db, audit, config } = app;
  const site = { collections: config.collections, mediaDir: config.media?.dir, libraryDir: config.library?.dir, kinds: app.site?.environment?.kinds };
  const compiled = new Map();

  const rowOf = (id) => (typeof id === 'string' ? db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(id) : null) ?? null;
  const roleOf = (r) => ({ id: r.id, name: r.name, base: r.base, rules: JSON.parse(r.rules) });

  /** The role ready to answer, rebuilt when it changes (users.toPublic asks on every request). */
  function customRoleOf(id) {
    const r = rowOf(id);
    if (!r) return null;
    const hit = compiled.get(id);
    if (hit?.rev === r.rev) return hit.role;
    const role = compileRole(roleOf(r), { site, clock: app.clock });
    compiled.set(id, { rev: r.rev, role });
    return role;
  }

  const view = (r) => ({ ...roleOf(r), version: `r${r.rev}`, people: db.prepare('SELECT COUNT(*) AS n FROM users WHERE custom_role = ?').get(r.id).n, updatedAt: r.updated_at });
  const may = (ctx) => {
    if (!can(ctx.user, 'users.manage')) throw forbidden('Roles are for the owner and administrators.');
  };
  const check = (body) => checkRole(body, { collections: config.collections.map((c) => c.id), fail: (w, f) => { throw invalid(w, f); } });
  // a role built on administrator gives that rank: only the owner makes, changes or removes one
  const mayBase = (ctx, base, words) => {
    if (base === 'administrator' && ctx.user.role !== 'owner') throw forbidden(`Only the owner ${words} a role built on administrator.`);
  };
  const tell = (ctx, words) => app.notices?.tell({ kind: 'roles.changed', level: 'warn', text: `${ctx.user.name} ${words}.`, link: '#/settings/roles', to: 'administrators' });

  /** A save's last check (content/entries.mjs guard): an edit a role allows only for some fields changes only those. */
  function checkFields(user, c, id, before, after, bodyChanged) {
    const role = user?.custom;
    if (!role || before === null) return;
    const d = role.decide('entry.edit', { collection: c, entry: { id, author: before?.[c.fields?.author ?? 'author'] }, user });
    // a page's modified date is the server's own stamp on every change (entries.mjs textFromBody, many.mjs stamped):
    // not a field the person changed
    const stamp = c.format === 'json' ? c.fields?.modified : null;
    const paths = changedPaths(before, after).filter((p) => p !== stamp);
    if (bodyChanged) paths.push('body');
    const out = role.outside(d, paths);
    if (out.length) throw new HttpError(403, 'forbidden', `As ${role.name} you change only ${d.fields.join(', ')}. This also changes ${out.slice(0, 5).join(', ')}${out.length > 5 ? ` and ${out.length - 5} more` : ''}.`, { allowed: d.fields, outside: out });
  }

  function routes(api) {
    api.add('GET', '/roles', (ctx) => {
      may(ctx);
      return {
        builtin: ROLES,
        bases: BASES,
        custom: db.prepare('SELECT * FROM custom_roles ORDER BY name').all().map(view),
        actions: { entry: ENTRY_ACTIONS, abilities: abilities() },
        kinds: KINDS,
        collections: config.collections.map((c) => ({ id: c.id, label: c.label ?? c.id })),
      };
    });

    api.add('POST', '/roles', (ctx) => {
      may(ctx);
      const r = check(ctx.body);
      mayBase(ctx, r.base, 'makes');
      if (rowOf(r.id)) throw conflict(`There is a role “${r.id}” already.`);
      if (db.prepare('SELECT COUNT(*) AS n FROM custom_roles').get().n >= MAX_ROLES) throw conflict(`A site has at most ${MAX_ROLES} custom roles.`);
      const now = nowIso(app.clock());
      db.prepare('INSERT INTO custom_roles (id, name, base, rules, rev, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?, ?)').run(r.id, r.name, r.base, JSON.stringify(r.rules), now, now, ctx.user.id);
      audit.log(ctx, 'role.create', { target: r.id, detail: { base: r.base, rules: r.rules.length } });
      tell(ctx, `made the role ${r.name} (built on ${r.base}, ${r.rules.length} rule${r.rules.length === 1 ? '' : 's'})`);
      ctx.status = 201;
      return { role: view(rowOf(r.id)) };
    });

    api.add('PUT', '/roles/:rid', (ctx) => {
      may(ctx);
      // the version check and the change hold the database's write lock: of two saves at once (on two server
      // processes), one wins and the other gets the 409
      const { was, r } = tx(db, () => {
        const was = rowOf(ctx.params.rid);
        if (!was) throw notFound('No such role.');
        if (ctx.body?.version !== `r${was.rev}`) throw conflict('The role changed since you loaded it.', { current: view(was) });
        const r = check({ ...ctx.body, id: was.id });
        mayBase(ctx, was.base, 'changes');
        mayBase(ctx, r.base, 'changes');
        db.prepare('UPDATE custom_roles SET name = ?, base = ?, rules = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE id = ?').run(r.name, r.base, JSON.stringify(r.rules), nowIso(app.clock()), ctx.user.id, was.id);
        // the people with it take its new base as their rank
        if (r.base !== was.base) db.prepare('UPDATE users SET role = ? WHERE custom_role = ?').run(r.base, was.id);
        return { was, r };
      });
      audit.log(ctx, 'role.update', { target: was.id, detail: { base: r.base !== was.base ? { from: was.base, to: r.base } : undefined, rules: r.rules.length } });
      tell(ctx, `changed the role ${r.name}${r.base !== was.base ? ` (now built on ${r.base})` : ''}`);
      return { role: view(rowOf(was.id)) };
    });

    api.add('DELETE', '/roles/:rid', (ctx) => {
      may(ctx);
      const was = rowOf(ctx.params.rid);
      if (!was) throw notFound('No such role.');
      mayBase(ctx, was.base, 'removes');
      const people = tx(db, () => {
        const n = db.prepare('UPDATE users SET custom_role = NULL WHERE custom_role = ?').run(was.id).changes;
        db.prepare('DELETE FROM custom_roles WHERE id = ?').run(was.id);
        return n;
      });
      compiled.delete(was.id);
      audit.log(ctx, 'role.delete', { target: was.id, detail: { base: was.base, people } });
      tell(ctx, `removed the role ${was.name}; ${people === 1 ? 'the person' : `the ${people} people`} with it keep${people === 1 ? 's' : ''} ${was.base}`);
      return { ok: true, people };
    });

    // a dry run: what a person may do, by their role's rules or its base, with the trace (owner and administrators)
    api.add('POST', '/roles/check', (ctx) => {
      may(ctx);
      const b = ctx.body ?? {};
      const row = typeof b.userId === 'string' ? app.users.get(b.userId) : null;
      if (!row) throw invalid('userId is a person of this site.', 'userId');
      const user = app.users.toPublic(row);
      const known = [...ENTRY_ACTIONS, ...abilities().map((a) => a.name)];
      if (!known.includes(b.action)) throw invalid(`action is one of ${known.join(', ')}.`, 'action');
      const c = b.collection === undefined ? null : config.collections.find((x) => x.id === b.collection);
      if (b.collection !== undefined && !c) throw invalid('collection is one of this site’s.', 'collection');
      let entry = null;
      if (c && b.id !== undefined) {
        try {
          entry = app.store.summarize(c, String(b.id), app.store.read(c, String(b.id)).text);
        } catch {
          throw invalid('id is an entry of that collection.', 'id');
        }
      }
      const x = user.custom?.explain(b.action, { collection: c, entry, user }) ?? { decision: null, trace: [] };
      const d = x.decision;
      let allowed;
      if (b.action.startsWith('entry.')) {
        const k = b.action.slice(6);
        if (k === 'create') allowed = c ? canCreate(user, c) : null;
        else allowed = c && entry ? entryCan(user, c, entry)[k] : null;
      } else allowed = can(user, b.action);
      return {
        user: { id: user.id, name: user.name, role: user.role, customRole: user.customRole ?? null },
        action: b.action,
        allowed,
        by: d ? 'rule' : 'base',
        rule: d?.rule ?? null,
        fields: d?.fields ?? null,
        words: d ? `${d.effect === 'allow' ? 'Allowed' : 'Refused'} by the rule “${d.rule.name}” of ${user.custom.name}.` : `No rule of ${user.custom?.name ?? 'a custom role'} applies: ${user.role} decides${allowed === null ? ' (name a collection and an entry to know)' : ''}.`,
        trace: x.trace,
      };
    });
  }

  /** Give a person a custom role (or take it away: null); their rank becomes its base. */
  function assign(ctx, row, id) {
    if (id === null) return { custom_role: null };
    const r = rowOf(id);
    if (!r) throw invalid('customRole is one of this site’s roles.', 'customRole');
    if (row.role === 'owner') throw invalid('The owner has every right; transfer ownership first.', 'customRole');
    if (!canManageUser(ctx.user, app.users.toPublic(row), r.base)) throw forbidden('You cannot give this person that role.');
    return { custom_role: r.id, role: r.base };
  }

  return { routes, customRoleOf, checkFields, assign };
}
