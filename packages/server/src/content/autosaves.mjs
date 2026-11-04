// Autosave history: besides the one private autosave per person and entry (entries.mjs), every autosave also lands
// in a snapshot. One snapshot covers a time slice (SLICE_MS); after that a new one starts, so a long session leaves
// a trail of versions "as you edit" (like Ghost's post history), kept per person, newest MAX_PER_ENTRY of them.
// The revisions screen shows them next to the git revisions, compares and restores them.
import crypto from 'node:crypto';
import { HttpError, newId, notFound, nowIso } from '../util.mjs';

const SLICE_MS = 5 * 60_000;
const MAX_PER_ENTRY = 40;
const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

export function createAutosaveHistory(app, entries) {
  const { db, store, git, clock } = app;

  /** Record an autosave (called after the autosave itself is stored). */
  function record(userId, c, id, baseVersion, payload) {
    const at = nowIso(clock());
    const last = db.prepare('SELECT id, started_at FROM autosave_snapshots WHERE user_id = ? AND collection = ? AND entry_id = ? ORDER BY saved_at DESC LIMIT 1').get(userId, c.id, id);
    if (last && clock() - Date.parse(last.started_at) < SLICE_MS) {
      db.prepare('UPDATE autosave_snapshots SET base_version = ?, payload = ?, saved_at = ? WHERE id = ?').run(baseVersion ?? null, payload, at, last.id);
      return;
    }
    db.prepare('INSERT INTO autosave_snapshots (id, user_id, collection, entry_id, base_version, payload, started_at, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(newId('as'), userId, c.id, id, baseVersion ?? null, payload, at, at);
    db.prepare(
      `DELETE FROM autosave_snapshots WHERE user_id = ? AND collection = ? AND entry_id = ? AND id NOT IN
         (SELECT id FROM autosave_snapshots WHERE user_id = ? AND collection = ? AND entry_id = ? ORDER BY saved_at DESC LIMIT ?)`,
    ).run(userId, c.id, id, userId, c.id, id, MAX_PER_ENTRY);
  }

  /** The file text an autosave's version started from: the current file, or the git revision with that version. */
  async function textAtVersion(c, id, version) {
    const cur = store.read(c, id);
    if (!version || cur.version === version) return cur.text;
    const rel = store.rel(store.fileOf(c, id, { mustExist: false }));
    for (const r of (await git.log(rel)).slice(0, 60)) {
      const t = await git.show(r.sha, rel);
      if (t !== null && sha1(t) === version) return t;
    }
    return cur.text; // too old to find: apply it to the current text
  }

  /** The whole file text a snapshot stands for (its changes applied as a save would apply them). */
  async function textOf(c, row) {
    const base = await textAtVersion(c, row.entry_id, row.base_version);
    try {
      return entries.textFromBody(c, base, JSON.parse(row.payload)).text;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, 'invalid', `This autosave can no longer be read: ${e.message}`);
    }
  }

  async function get(userId, c, id, aid) {
    const row = db.prepare('SELECT * FROM autosave_snapshots WHERE id = ? AND user_id = ? AND collection = ? AND entry_id = ?').get(aid, userId, c.id, id);
    if (!row) throw notFound('No such autosave.');
    return { row, text: await textOf(c, row) };
  }

  function routes(router) {
    router.add('GET', '/collections/:c/entries/:id/autosaves', (ctx) => {
      const c = store.collection(ctx.params.c);
      return db
        .prepare('SELECT id, started_at, saved_at, base_version FROM autosave_snapshots WHERE user_id = ? AND collection = ? AND entry_id = ? ORDER BY saved_at DESC')
        .all(ctx.user.id, c.id, ctx.params.id)
        .map((r) => ({ id: r.id, startedAt: r.started_at, savedAt: r.saved_at, baseVersion: r.base_version }));
    });

    router.add('GET', '/collections/:c/entries/:id/autosaves/:aid', async (ctx) => {
      const c = store.collection(ctx.params.c);
      const { row, text } = await get(ctx.user.id, c, ctx.params.id, ctx.params.aid);
      let parsed = {};
      try {
        parsed = entries.parse(c, text);
      } catch {
        // shown as source only
      }
      return { id: row.id, startedAt: row.started_at, savedAt: row.saved_at, baseVersion: row.base_version, source: text, ...(c.format === 'md' ? { doc: parsed.doc } : { data: parsed.data }) };
    });
  }

  return { record, get, routes };
}
