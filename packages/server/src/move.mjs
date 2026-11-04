// Move (rename) an entry: POST collections/:c/entries/:id/move {version, newId, newSlug?}. In one commit: the file
// gets its new name (and slug), every entry that links to the old address links to the new one (links.mjs, every
// locale), and the site's redirects hook records old -> new for every locale (redirects/hook.mjs: older redirects to
// the old address follow it, so no chain is made). A live entry then gets a build and deploy job; if it fails, the
// move is undone file by file (unless someone changed a file since) and the live site keeps the old address.
import { ID } from './config.mjs';
import { linkRewriter, movePairs, rewriteEntry } from './content/links.mjs';
import { HttpError, conflict, forbidden, invalid } from './util.mjs';

/** The text with its slug set (md frontmatter or JSON), when the collection has a slug field. */
export const slugSetter = (converter) => (c, text, slug) => {
  const key = c.fields.slug;
  if (!key || slug === undefined) return text;
  return c.format === 'md' ? converter.setFrontmatter(text, { [key]: slug }) : converter.applyJsonChanges(text, [{ path: key, value: slug }], c);
};

/** After a failed build of a move: every file of the move commit nobody changed since goes back, in one commit. */
export async function revertMoveCommit(app, { paths, commit, message, author, log }) {
  const { store, git } = app;
  const touched = [];
  for (const rel of paths) {
    const now = await git.show(commit, rel);
    const current = store.readRel(rel);
    if (now !== current) {
      log(`${rel} changed after the move; it was not reverted. Check it by hand.\n`);
      continue;
    }
    const prev = await git.show(await git.parent(commit), rel);
    if (prev === null) store.removeRel(rel);
    else store.writeRel(rel, prev);
    touched.push(rel);
  }
  return git.commit(touched, message, author);
}

export function moveRoutes(router, app, entries) {
  const { store, git, jobs, repoLock, audit, converter, config, db } = app;
  const withSlug = slugSetter(converter);

  router.add('POST', '/collections/:c/entries/:id/move', async (ctx) => {
    const c = store.collection(ctx.params.c);
    const id = ctx.params.id;
    const { version, newId, newSlug } = ctx.body;
    if (typeof newId !== 'string' || !ID.test(newId)) throw invalid({ newId: 'Use lowercase letters, digits and hyphens.' });
    if (newSlug !== undefined && (typeof newSlug !== 'string' || !ID.test(newSlug))) throw invalid({ newSlug: 'Use lowercase letters, digits and hyphens.' });

    const out = await repoLock.run(async () => {
      const cur = store.read(c, id);
      if (version !== cur.version) throw conflict('This entry changed since you opened it. Reload to see the latest.', { version: cur.version });
      const summary = store.summarize(c, id, cur.text);
      const can = entries.assertEditable(ctx, c, summary);
      const live = summary.status === 'published';
      // a live page's address changes for visitors (and search engines): an editor's decision
      if (live && !can.publish) throw forbidden('This entry is live; moving it needs the publish right.');
      if (newId === id && (newSlug === undefined || newSlug === store.fieldsOf(c, cur.text)[c.fields.slug])) throw invalid({ newId: 'That is its current name.' });
      if (newId !== id && store.exists(c, newId)) throw new HttpError(409, 'id-taken', 'An entry with this name already exists.', { id: newId });

      // the slug follows the file name when it was the same, unless a new one is given
      const oldSlug = c.fields.slug ? store.fieldsOf(c, cur.text)[c.fields.slug] : undefined;
      const slug = newSlug ?? (oldSlug === id ? newId : undefined);
      const text = withSlug(c, cur.text, slug);
      const after = store.summarize(c, newId, text);
      await entries.validate(c, newId, text);
      // the new address may not be another page's (two pages at one address: one of them is never seen)
      const owner = after.url && after.url !== summary.url ? store.addresses().get(after.url) : undefined;
      if (owner) throw new HttpError(409, 'address-taken', `${after.url} is the address of another page already (${owner}).`, { url: after.url, entry: owner });

      const pairs = summary.url && after.url && summary.url !== after.url ? movePairs(summary.url, after.url, { locales: config.locales, siteUrl: config.siteUrl }) : [];
      const redirects = pairs.filter((p) => p.from.startsWith('/'));

      // write: the new file, the old one gone, then every entry that linked to it
      const written = new Map(); // rel -> text before (null: did not exist)
      const write = (cc, eid, t, prev) => {
        const w = store.write(cc, eid, t);
        if (!written.has(w.rel)) written.set(w.rel, prev);
        return w;
      };
      const undo = () => {
        for (const [rel, prev] of written) {
          if (prev === null) store.removeRel(rel);
          else store.writeRel(rel, prev);
        }
      };
      const linksUpdated = [];
      let extra;
      try {
        write(c, newId, text, null);
        if (newId !== id) {
          const { rel } = store.remove(c, id);
          written.set(rel, cur.text);
        }
        if (pairs.length) {
          const rw = linkRewriter(pairs);
          for (const cc of store.collections) {
            for (const eid of store.ids(cc)) {
              if (cc.id === c.id && eid === newId) continue;
              const t = store.read(cc, eid).text;
              const nt = rewriteEntry(converter, cc, t, rw);
              if (nt === t) continue;
              write(cc, eid, nt, t);
              linksUpdated.push({ collection: cc.id, id: eid });
            }
          }
          // the moved entry may link to itself (its canonical, an anchor)
          const self = store.read(c, newId).text;
          const fixed = rewriteEntry(converter, c, self, linkRewriter(pairs));
          if (fixed !== self) store.write(c, newId, fixed);
        }
        // what the hook changes = what is dirty after it and was not before it
        extra = await app.redirectsHook.recordMove(redirects, await git.dirty());
      } catch (e) {
        undo();
        throw e;
      }
      const paths = [...written.keys(), ...extra.files];
      const commit = await git.commit(paths, `Move ${c.id}/${id} to ${newId}`, entries.authorOf(ctx.user));
      // the mover's private autosave follows the entry
      db.prepare('UPDATE OR REPLACE autosaves SET entry_id = ? WHERE collection = ? AND entry_id = ?').run(newId, c.id, id);
      db.prepare('UPDATE autosave_snapshots SET entry_id = ? WHERE collection = ? AND entry_id = ?').run(newId, c.id, id);
      audit.log(ctx, 'entry.move', { target: `${c.id}/${id}`, detail: { to: `${c.id}/${newId}`, commit, links: linksUpdated.length, redirects: redirects.length, repointed: extra.repointed.length, removed: extra.removed.length } });
      const fresh = store.read(c, newId);
      return { live, commit, paths, written, fresh, oldUrl: summary.url, url: after.url, linksUpdated, redirects, repointed: extra.repointed };
    });

    const job = out.live && out.commit ? moveJob(ctx, c, id, newId, out) : null;
    ctx.status = job ? 202 : 200;
    return { id: newId, version: out.fresh.version, url: out.url, oldUrl: out.oldUrl, linksUpdated: out.linksUpdated, redirects: out.redirects, repointed: out.repointed, commit: out.commit, job };
  });

  /** Build and deploy a live move; on failure put every file back as it was before the move commit. */
  function moveJob(ctx, c, id, newId, out) {
    return jobs.enqueue({
      kind: 'move',
      collection: c.id,
      entryId: newId,
      user: ctx.user,
      run: async (step) => {
        await step('commit', (log) => (log(`committed ${out.commit}: ${out.paths.length} file(s), ${out.linksUpdated.length} linking entr${out.linksUpdated.length === 1 ? 'y' : 'ies'}, ${out.redirects.length} redirect(s)\n`), 0));
        const now = store.read(c, newId).text;
        // the new address, the old one (now a redirect), and the pages whose links were rewritten
        const changed = [...app.afterDeploy.pagesOf(c, newId, now), ...(app.site?.pathsOf?.(out.oldUrl) ?? (out.oldUrl ? [out.oldUrl] : []))];
        for (const l of out.linksUpdated) {
          const lc = store.collection(l.collection);
          changed.push(...app.afterDeploy.pagesOf(lc, l.id, store.read(lc, l.id).text));
        }
        await jobs.buildAndDeploy(step, { afterBuild: app.verify.afterBuild([app.verify.expect(c, newId, now), app.verify.moved(c, newId, out.oldUrl)]), changed });
      },
      onFail: (step) =>
        step('revert', (log) =>
          repoLock.run(async () => {
            // only files nobody changed since the move commit go back
            const sha = await revertMoveCommit(app, { paths: out.paths, commit: out.commit, message: `Revert move of ${c.id}/${id}: build or deploy failed`, author: entries.authorOf(ctx.user), log });
            db.prepare('UPDATE OR REPLACE autosaves SET entry_id = ? WHERE collection = ? AND entry_id = ?').run(id, c.id, newId);
            log(`Reverted in ${sha ?? '(nothing to revert)'}; ${c.id}/${id} is back at its old address.\n`);
            return 0;
          }),
        ),
    });
  }
}
