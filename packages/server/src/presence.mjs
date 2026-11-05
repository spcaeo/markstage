// Presence and a soft lock (docs/OPERATIONS.md "Two people on one post"): who has an entry open, and who is editing
// it, before a save runs into a conflict. The editor sends a heartbeat every ~20 s from each tab; a tab not heard
// from for a minute is gone. The first tab editing an entry holds its lock; others see "Olive is editing this" and
// may take over, which the holder hears on its next heartbeat. The lock is advice for the editor: saves still go
// through the version check (409), so nobody's typing is refused because of it. Kept in the database (presence_*
// tables), so every server process on the data dir sees the same tabs and the same lock (docs/SCALING.md); each
// heartbeat is one write transaction. A tab not heard from for a minute is gone, wherever it was last heard.
//   POST   /collections/:c/entries/:id/presence {tab, mode: viewing|editing, take?}   heartbeat -> who else, the lock,
//                                                  the entry's version and last save, the viewer's role (QA N9, N10)
//   DELETE /collections/:c/entries/:id/presence?tab=                              this tab closed the entry
//   GET    /presence                                                              entries being edited now (lists)
import { tx } from './db.mjs';
import { badRequest } from './util.mjs';

const TTL = 60_000;
const TAB = /^[A-Za-z0-9_-]{6,40}$/;

export function createPresence(app, entries) {
  const { store, clock, audit, db } = app;
  // the last save of an entry, from the audit (a take-over or a lock change is not a save)
  const lastSave = db ? db.prepare("SELECT user_name, at FROM audit WHERE target = ? AND ok = 1 AND action LIKE 'entry.%' AND action NOT IN ('entry.takeover', 'entry.lock', 'entry.unlock') ORDER BY id DESC LIMIT 1") : null;
  const q = {
    tabs: db.prepare('SELECT * FROM presence_tabs WHERE entry = ?'),
    tab: db.prepare('SELECT * FROM presence_tabs WHERE entry = ? AND tab_key = ?'),
    putTab: db.prepare('INSERT INTO presence_tabs (entry, tab_key, user_id, name, tab, mode, since, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entry, tab_key) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, tab = excluded.tab, mode = excluded.mode, seen = excluded.seen'),
    setMode: db.prepare('UPDATE presence_tabs SET mode = ? WHERE entry = ? AND tab_key = ?'),
    dropTab: db.prepare('DELETE FROM presence_tabs WHERE entry = ? AND tab_key = ?'),
    gone: db.prepare('DELETE FROM presence_tabs WHERE entry = ? AND seen < ?'),
    lock: db.prepare('SELECT * FROM presence_locks WHERE entry = ?'),
    putLock: db.prepare('INSERT INTO presence_locks (entry, tab_key, user_id, name, since) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entry) DO UPDATE SET tab_key = excluded.tab_key, user_id = excluded.user_id, name = excluded.name, since = excluded.since'),
    dropLock: db.prepare('DELETE FROM presence_locks WHERE entry = ?'),
    taken: db.prepare('SELECT * FROM presence_taken WHERE tab_key = ?'),
    putTaken: db.prepare('INSERT INTO presence_taken (tab_key, entry, by_name, at) VALUES (?, ?, ?, ?) ON CONFLICT(tab_key) DO UPDATE SET entry = excluded.entry, by_name = excluded.by_name, at = excluded.at'),
    dropTaken: db.prepare('DELETE FROM presence_taken WHERE tab_key = ?'),
  };

  /** Tabs not heard from for a minute are gone; a lock whose tab is gone, or no longer editing, is free. */
  function prune(key, now = clock()) {
    q.gone.run(key, now - TTL);
    const lock = q.lock.get(key);
    if (!lock) return;
    const t = q.tab.get(key, lock.tab_key);
    if (!t || t.mode !== 'editing') q.dropLock.run(key);
  }

  function view(ctx, key, tabKey) {
    prune(key);
    const tabs = q.tabs.all(key);
    const lock = q.lock.get(key) ?? null;
    const people = new Map();
    for (const t of tabs) {
      if (t.user_id === ctx.user.id) continue;
      const was = people.get(t.user_id);
      if (!was || (t.mode === 'editing' && was.mode !== 'editing')) people.set(t.user_id, { userId: t.user_id, name: t.name, mode: t.mode, since: new Date(t.since).toISOString() });
    }
    const told = q.taken.get(tabKey);
    if (told?.entry === key) q.dropTaken.run(tabKey);
    return {
      lock: lock ? { userId: lock.user_id, name: lock.name, since: new Date(lock.since).toISOString(), you: lock.tab_key === tabKey, sameUser: lock.user_id === ctx.user.id } : null,
      people: [...people.values()].sort((a, b) => (a.mode === b.mode ? a.since.localeCompare(b.since) : a.mode === 'editing' ? -1 : 1)),
      takenOver: told?.entry === key ? { by: told.by_name, at: new Date(told.at).toISOString() } : null,
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
      // one write transaction: two tabs on two server processes never both take a free lock
      const { holds, takeover } = tx(db, () => {
        prune(key, now);
        const was = q.tab.get(key, tabKey);
        q.putTab.run(key, tabKey, ctx.user.id, ctx.user.name, ctx.body.tab, mode, was?.since ?? now, now);
        const lock = q.lock.get(key);
        let takeover = null;
        if (mode === 'editing' && (!lock || lock.tab_key === tabKey)) {
          if (!lock) q.putLock.run(key, tabKey, ctx.user.id, ctx.user.name, now);
        } else if (mode === 'editing' && ctx.body.take === true) {
          q.putTaken.run(lock.tab_key, key, ctx.user.name, now);
          q.putLock.run(key, tabKey, ctx.user.id, ctx.user.name, now);
          takeover = lock.user_id;
        }
        // a tab that wants to edit but does not hold the lock is a viewer until the lock is free (or it takes over)
        const holds = q.lock.get(key)?.tab_key === tabKey;
        if (!holds) q.setMode.run('viewing', key, tabKey);
        return { holds, takeover };
      });
      if (takeover) audit.log(ctx, 'entry.takeover', { target: key, detail: { from: takeover } });
      const last = lastSave?.get(key) ?? null;
      return { mode: holds ? 'editing' : 'viewing', canEdit: mayEdit, version, saved: last ? { by: last.user_name ?? 'Markstage', at: last.at } : null, role: ctx.user.role, ...view(ctx, key, tabKey) };
    });

    router.add('DELETE', '/collections/:c/entries/:id/presence', (ctx) => {
      const { key } = target(ctx);
      const tabKey = tabOf(ctx, ctx.query.get('tab'));
      tx(db, () => {
        q.dropTab.run(key, tabKey);
        if (q.lock.get(key)?.tab_key === tabKey) q.dropLock.run(key);
        prune(key);
      });
      return { ok: true };
    });

    router.add('GET', '/presence', (ctx) => {
      const now = clock();
      db.prepare('DELETE FROM presence_tabs WHERE seen < ?').run(now - TTL);
      const out = [];
      for (const { entry: key } of db.prepare('SELECT DISTINCT entry FROM presence_tabs ORDER BY entry').all()) {
        prune(key, now);
        const tabs = q.tabs.all(key);
        if (!tabs.length) continue;
        const lock = q.lock.get(key);
        const [collection, id] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
        out.push({ collection, id, editing: lock ? { userId: lock.user_id, name: lock.name, since: new Date(lock.since).toISOString(), you: lock.user_id === ctx.user.id } : null, open: new Set(tabs.map((t) => t.user_id)).size });
      }
      // locks whose tabs all went
      db.prepare('DELETE FROM presence_locks WHERE entry NOT IN (SELECT entry FROM presence_tabs)').run();
      return { entries: out };
    });
  }

  /** Housekeeping (the hourly sweep): tabs not heard from for a minute, and the locks and notes they leave. */
  function sweep(now = clock()) {
    db.prepare('DELETE FROM presence_tabs WHERE seen < ?').run(now - TTL);
    db.prepare('DELETE FROM presence_locks WHERE entry NOT IN (SELECT entry FROM presence_tabs)').run();
    db.prepare('DELETE FROM presence_taken WHERE at < ?').run(now - TTL);
  }

  return { routes, sweep };
}
