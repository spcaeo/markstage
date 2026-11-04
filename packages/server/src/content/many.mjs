// Changing many entries at once (find and replace across the site, bulk actions, replacing an image everywhere):
// every change is checked like a save of that entry, all of them go in one commit, and when a live entry changed the
// site is rebuilt and deployed in one job. If that job fails, the entries are put back (those nobody changed since)
// and entries sent to the trash come back out of it, so the repo matches what is live again.
//
// A change: {c, id, before, after, title, status, trashId?}; `after: null` sends the entry to the trash.
import { sha1 } from '../util.mjs';
import { stampLike } from './entries.mjs';

export function createMany(app, entries) {
  const { store, git, repoLock, audit, jobs, db } = app;

  /**
   * Check one change as a save by this user would be checked (rights, status keys, author, raw HTML, links, the
   * site's validate). Returns null when it may be written, else the reason in words.
   */
  async function problemOf(ctx, h, { allowStatus = false } = {}) {
    try {
      const summary = store.summarize(h.c, h.id, h.before);
      if (h.after === null) return entries.permissions(ctx, h.c, summary).delete ? null : 'You cannot delete this entry.';
      const can = entries.assertEditable(ctx, h.c, summary);
      entries.guard(ctx, h.c, h.before, h.after, can, { allowStatus, id: h.id });
      await entries.validate(h.c, h.id, h.after);
      return null;
    } catch (e) {
      return e.message || String(e);
    }
  }

  /** A JSON entry's modified date follows a change, in the file's own format (as an editor save does). */
  function stamped(c, before, after) {
    const mod = c.fields.modified;
    if (c.format !== 'json' || !mod || after === null || after === before) return after;
    const was = store.fieldsOf(c, before)?.[mod];
    const stamp = typeof was === 'string' ? stampLike(was, new Date(app.clock())) : null;
    return stamp ? app.converter.applyJsonChanges(after, [{ path: mod, value: stamp }], c) : after;
  }

  /** Write the changes and commit them together; the caller holds the repo lock. Returns the commit (or null). */
  async function commitAll(ctx, list, message) {
    const files = [];
    for (const h of list) {
      if (h.after === null) files.push(store.remove(h.c, h.id).rel);
      else files.push(store.write(h.c, h.id, h.after).rel);
    }
    return list.length ? git.commit(files, message, entries.authorOf(ctx.user)) : null;
  }

  /**
   * After the commit: when a live entry changed (or went to the trash, or was taken down), build and deploy in one
   * job; on failure put the texts back. Returns the job id, or null when nothing live changed. `files`: other repo
   * files of the same commit ({rel, before, after}, e.g. a Library item) that go back with the entries.
   */
  function deploy(ctx, { kind, target, list, commit, files = [], keep = false, notice = null }) {
    const live = list.filter((h) => h.status === 'published' || (h.after !== null && store.summarize(h.c, h.id, h.after).status === 'published'));
    if (!live.length || !commit) return null;
    return jobs.enqueue({
      kind,
      user: ctx.user,
      target,
      notice,
      run: async (step) => {
        await step('commit', (log) => (log(`committed ${commit}: ${list.length} entr${list.length === 1 ? 'y' : 'ies'}\n`), 0));
        await jobs.buildAndDeploy(step, {
          afterBuild: app.verify.afterBuild(live.map((h) => app.verify.expect(h.c, h.id, h.after, h.before))),
          changed: live.flatMap((h) => app.afterDeploy.pagesOf(h.c, h.id, h.before, h.after)),
        });
      },
      // `keep`: the change stays saved on a failed build (the person chose it; the site stays as it was)
      onFail: keep ? null : (step) => step('revert', (log) => repoLock.run(() => putBack(ctx, list, kind, log, files))),
    });
  }

  async function putBack(ctx, list, kind, log, files = []) {
    const back = list.filter((h) => {
      try {
        return h.after === null ? !store.exists(h.c, h.id) : store.read(h.c, h.id).version === sha1(h.after);
      } catch {
        return false;
      }
    });
    for (const h of back) {
      store.write(h.c, h.id, h.before);
      if (h.trashId) db.prepare('DELETE FROM trash WHERE id = ?').run(h.trashId);
    }
    // the other files of that commit, unless someone changed them since
    const others = files.filter((f) => store.readRel(f.rel) === f.after);
    for (const f of others) {
      if (f.before === null) store.removeRel(f.rel);
      else store.writeRel(f.rel, f.before);
    }
    const sha = await git.commit([...back.map((h) => store.rel(store.fileOf(h.c, h.id))), ...others.map((f) => f.rel)], `Revert the ${kind}: the publish failed`, entries.authorOf(ctx.user));
    if (sha) audit.log(ctx, 'entries.revert', { target: kind, detail: { commit: sha, entries: back.map((h) => `${h.c.id}/${h.id}`) } });
    log(`Put back ${back.length} of ${list.length} entries in ${sha ?? '(nothing to revert)'}${back.length < list.length ? '; the others changed since and were left as they are' : ''}.\n`);
    return 0;
  }

  return { problemOf, stamped, commitAll, deploy };
}
