// Presence and a soft lock (docs/OPERATIONS.md "Two people on one post"): who has an entry open, and who is editing
// it, before a save runs into a conflict. The editor sends a heartbeat every ~20 s from each tab; a tab not heard
// from for a minute is gone. The first tab editing an entry holds its lock; others see "Olive is editing this" and
// may take over, which the holder hears on its next heartbeat. The lock is advice for the editor: saves still go
// through the version check (409), so nobody's typing is refused because of it. Kept in memory: a restart clears it,
// and every open tab claims again on its next heartbeat.
//   POST   /collections/:c/entries/:id/presence {tab, mode: viewing|editing, take?}   heartbeat -> who else, the lock,
//                                                  the entry's version and last save, the viewer's role (QA N9, N10)
//   DELETE /collections/:c/entries/:id/presence?tab=                              this tab closed the entry
//   GET    /presence                                                              entries being edited now (lists)
import { badRequest } from './util.mjs';

const TTL = 60_000;
const TAB = /^[A-Za-z0-9_-]{6,40}$/;

export function createPresence(app, entries) {
  const { store, clock, audit, db } = app;
  // the last save of an entry, from the audit (a take-over or a lock change is not a save)
  const lastSave = db ? db.prepare("SELECT user_name, at FROM audit WHERE target = ? AND ok = 1 AND action LIKE 'entry.%' AND action NOT IN ('entry.takeover', 'entry.lock', 'entry.unlock') ORDER BY id DESC LIMIT 1") : null;
  /** key "c/id" -> Map(tabKey "uid:tab" -> {userId, name, tab, mode, since, seen}) */
  const open = new Map();
  /** key -> {tabKey, userId, name, since} */
  const locks = new Map();
  /** tabKey -> {key, by, at}: a lock taken from this tab, told once */
  const taken = new Map();

  function prune(key, now = clock()) {
    const tabs = open.get(key);
    if (tabs) for (const [k, t] of tabs) if (now - t.seen > TTL) tabs.delete(k);
    if (tabs && !tabs.size) open.delete(key);
    const lock = locks.get(key);
    if (lock && !open.get(key)?.has(lock.tabKey)) locks.delete(key);
    else if (lock && open.get(key).get(lock.tabKey).mode !== 'editing') locks.delete(key);
  }

  function view(ctx, key, tabKey) {
    prune(key);
    const tabs = open.get(key) ?? new Map();
    const lock = locks.get(key) ?? null;
    const people = new Map();
    for (const t of tabs.values()) {
      if (t.userId === ctx.user.id) continue;
      const was = people.get(t.userId);
      if (!was || (t.mode === 'editing' && was.mode !== 'editing')) people.set(t.userId, { userId: t.userId, name: t.name, mode: t.mode, since: new Date(t.since).toISOString() });
    }
    const told = taken.get(tabKey);
    if (told?.key === key) taken.delete(tabKey);
    return {
      lock: lock ? { userId: lock.userId, name: lock.name, since: new Date(lock.since).toISOString(), you: lock.tabKey === tabKey, sameUser: lock.userId === ctx.user.id } : null,
      people: [...people.values()].sort((a, b) => (a.mode === b.mode ? a.since.localeCompare(b.since) : a.mode === 'editing' ? -1 : 1)),
      takenOver: told?.key === key ? { by: told.by, at: new Date(told.at).toISOString() } : null,
    };
  }

  function routes(router) {
    const target = (ctx) => {
      const c = store.collection(ctx.params.c);
      const file = store.read(c, ctx.params.id);
      return { c, key: `${c.id}/${ctx.params.id}`, summary: store.summarize(c, ctx.params.id, file.text), version: file.version };
    };
    const tabOf = (ctx, raw) => {
      if (typeof raw !== 'string' || !TAB.test(raw)) throw badRequest('Send this tab’s id (tab).');
      return `${ctx.user.id}:${raw}`;
    };

    router.add('POST', '/collections/:c/entries/:id/presence', (ctx) => {
      const { c, key, summary, version } = target(ctx);
      const tabKey = tabOf(ctx, ctx.body.tab);
      const mayEdit = entries.permissions(ctx, c, summary).edit;
      const mode = ctx.body.mode === 'editing' && mayEdit ? 'editing' : 'viewing';
      const now = clock();
      prune(key, now);
      const tabs = open.get(key) ?? new Map();
      open.set(key, tabs);
      const was = tabs.get(tabKey);
      tabs.set(tabKey, { userId: ctx.user.id, name: ctx.user.name, tab: ctx.body.tab, mode, since: was?.since ?? now, seen: now });
      const lock = locks.get(key);
      if (mode === 'editing' && (!lock || lock.tabKey === tabKey)) {
        if (!lock) locks.set(key, { tabKey, userId: ctx.user.id, name: ctx.user.name, since: now });
      } else if (mode === 'editing' && ctx.body.take === true) {
        taken.set(lock.tabKey, { key, by: ctx.user.name, at: now });
        locks.set(key, { tabKey, userId: ctx.user.id, name: ctx.user.name, since: now });
        audit.log(ctx, 'entry.takeover', { target: key, detail: { from: lock.userId } });
      }
      // a tab that wants to edit but does not hold the lock is a viewer until the lock is free (or it takes over)
      const holds = locks.get(key)?.tabKey === tabKey;
      if (!holds) tabs.get(tabKey).mode = 'viewing';
      const last = lastSave?.get(key) ?? null;
      return { mode: holds ? 'editing' : 'viewing', canEdit: mayEdit, version, saved: last ? { by: last.user_name ?? 'Markstage', at: last.at } : null, role: ctx.user.role, ...view(ctx, key, tabKey) };
    });

    router.add('DELETE', '/collections/:c/entries/:id/presence', (ctx) => {
      const { key } = target(ctx);
      const tabKey = tabOf(ctx, ctx.query.get('tab'));
      open.get(key)?.delete(tabKey);
      if (locks.get(key)?.tabKey === tabKey) locks.delete(key);
      prune(key);
      return { ok: true };
    });

    router.add('GET', '/presence', (ctx) => {
      const out = [];
      for (const key of [...open.keys()]) {
        prune(key);
        const tabs = open.get(key);
        if (!tabs) continue;
        const lock = locks.get(key);
        const [collection, id] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
        out.push({ collection, id, editing: lock ? { userId: lock.userId, name: lock.name, since: new Date(lock.since).toISOString(), you: lock.userId === ctx.user.id } : null, open: new Set([...tabs.values()].map((t) => t.userId)).size });
      }
      return { entries: out };
    });
  }

  return { routes };
}
