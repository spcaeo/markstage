// Undo a change made to many entries at once (find and replace, replacing an image everywhere): the Undo on the toast
// right after it. Each entry goes back to its text before that commit, except one someone changed since (it is named
// and left as it is), all in one new commit; when a live entry changed, the site is rebuilt and deployed (many.mjs).
// Editors and above, like the change itself. A change is undone once. Deleting many media files at once is undone
// here too (the files and their library rows come back, media/bulk.mjs), by editors or by whoever deleted them; so is
// a change to a field in many entries (bulk set, add, remove, rename: a category renamed everywhere), but never a
// bulk unpublish or trash. A link a suggestion added (links/) is undone here too, by editors or by whoever added it.
//   POST /site/undo {commit}   {commit, undone: [{collection, id, title}], restored: [{id, filename}],
//                               skipped: [{collection, id, title, reason}], job}
import { restoreMedia } from '../media/bulk.mjs';
import { FIELD_ACTIONS } from './bulk.mjs';
import { atLeast } from '../roles.mjs';
import { HttpError, badRequest, forbidden, notFound } from '../util.mjs';

const UNDOABLE = ['site.replace', 'media.replace', 'media.delete.many', 'entries.bulk', 'links.accept', 'links.fix'];
const SHA = /^[0-9a-f]{40}$/;

export function undoRoutes(router, app, many) {
  const { db, store, git, repoLock, audit } = app;

  router.add('POST', '/site/undo', async (ctx) => {
    const commit = ctx.body?.commit;
    if (typeof commit !== 'string' || !SHA.test(commit)) throw badRequest('Say which change to undo (its commit).');
    const out = await repoLock.run(async () => {
      const rows = db.prepare(`SELECT action, user_id, detail FROM audit WHERE action IN (${UNDOABLE.map(() => '?').join(', ')}, 'site.undo') AND detail LIKE ?`).all(...UNDOABLE, `%${commit}%`);
      const made = rows.map((r) => ({ action: r.action, by: r.user_id, detail: JSON.parse(r.detail ?? 'null') })).find((r) => UNDOABLE.includes(r.action) && r.detail?.commit === commit);
      // whoever deleted many files, or accepted a link suggestion, may undo it (a link: on a page they could change)
      const own = ['media.delete.many', 'links.accept', 'links.fix'].includes(made?.action) && made.by === ctx.user.id;
      if (!atLeast(ctx.user, 'editor') && !own) throw forbidden('Only editors and above can undo a change to many entries.');
      if (!made || (made.action === 'entries.bulk' && !FIELD_ACTIONS.includes(made.detail?.action))) throw notFound('There is no such change to undo.');
      if (rows.some((r) => r.action === 'site.undo' && JSON.parse(r.detail ?? 'null')?.of === commit)) throw new HttpError(409, 'already-undone', 'This change was undone already.');
      const subject = (await git.git(['log', '-1', '--format=%s', commit])).stdout.trim();
      if (made.action === 'media.delete.many') {
        const m = await restoreMedia(app, ctx, commit, subject);
        audit.log(ctx, 'site.undo', { target: 'media', detail: { of: commit, commit: m.sha, media: m.restored.length } });
        return { sha: m.sha, list: [], restored: m.restored, skipped: m.skipped };
      }
      const parent = await git.parent(commit);
      const list = [];
      const skipped = [];
      // the entries come from the commit itself (an audit row may be cut short for a change to many entries)
      const files = (await git.git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit])).stdout.split('\0').filter(Boolean);
      for (const rel of files) {
        const at = store.entryOfRel(rel);
        if (!at) continue;
        const { c, id } = at;
        const [was, then] = [await git.show(parent, rel), await git.show(commit, rel)];
        const now = store.exists(c, id) ? store.read(c, id).text : null;
        const title = (now ?? then ?? was) ? store.summarize(c, id, now ?? then ?? was).title || id : id;
        if (was === null || then === null) continue;
        if (now !== then) {
          skipped.push({ collection: c.id, id, title, reason: now === null ? 'It was deleted since.' : 'It was changed since, so it was left as it is.' });
          continue;
        }
        list.push({ c, id, before: now, after: was, title, status: store.summarize(c, id, now).status ?? 'published' });
      }
      const sha = list.length ? await many.commitAll(ctx, list, `Undo: ${subject}`.slice(0, 200)) : null;
      audit.log(ctx, 'site.undo', { target: 'site', detail: { of: commit, commit: sha, entries: list.map((h) => `${h.c.id}/${h.id}`) } });
      return { sha, list, restored: [], skipped };
    });
    const job = many.deploy(ctx, { kind: 'undo', target: 'site', list: out.list, commit: out.sha });
    return { commit: out.sha, undone: out.list.map((h) => ({ collection: h.c.id, id: h.id, title: h.title })), restored: out.restored, skipped: out.skipped, job };
  });
}
