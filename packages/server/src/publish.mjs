// Publish, schedule, unpublish, delete to trash, restore from trash, rebuild, the jobs routes and the scheduler.
//
// Failure rule (docs/API.md): the commit happens first, then checks, build and deploy run as a job. If any step fails
// the deploy never completed, so the live site keeps its previous deploy; the job then makes a revert commit that puts
// the file back to its text before the job, and keeps the attempted text as the user's autosave. So the repo matches
// what is live again and nobody loses their writing.
import { atLeast, can, owns } from './roles.mjs';
import { HttpError, badRequest, conflict, forbidden, invalid, newId, notFound, nowIso, sha1 } from './util.mjs';

/** A time for people: "2026-10-28 09:00 UTC". */
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Set or clear the status keys on an entry text (null removes a key, undefined leaves it). */
export function statusText(converter, c, text, { draft, publishAt }) {
  if (!c.hasStatus) return text;
  const keys = Object.entries({ draft, publishAt }).filter(([, v]) => v !== undefined);
  if (c.format === 'md') return converter.setFrontmatter(text, Object.fromEntries(keys));
  return converter.applyJsonChanges(text, keys.map(([path, value]) => (value === null ? { path, delete: true } : { path, value })), c);
}

export function publishRoutes(router, app, entries, history) {
  const { store, git, jobs, repoLock, db, audit, converter, config } = app;
  const coll = (ctx) => store.collection(ctx.params.c);

  const setStatus = (c, text, status) => statusText(converter, c, text, status);

  const keepAutosave = (user, c, id, beforeText, attempted) =>
    db
      .prepare(
        `INSERT INTO autosaves (user_id, collection, entry_id, base_version, payload, saved_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, collection, entry_id) DO UPDATE SET base_version = excluded.base_version, payload = excluded.payload, saved_at = excluded.saved_at`,
      )
      .run(user.id, c.id, id, sha1(beforeText), JSON.stringify({ source: attempted }), nowIso(app.clock()));

  /** The revert step of a failed job: put the file back to `before` unless someone changed it meanwhile. */
  function revertStep(ctx, c, id, out, what) {
    return (step) =>
      step('revert', (log) =>
        repoLock.run(async () => {
          let current = null;
          try {
            current = store.read(c, id);
          } catch {
            // the file is gone (a failed delete): restore it below
          }
          const expected = out.after === null ? null : sha1(out.after);
          if ((current?.version ?? null) !== expected) {
            log('The entry changed after this job started; it was not reverted. Check it by hand.\n');
            return 0;
          }
          if (out.before === null) store.remove(c, id);
          else store.write(c, id, out.before);
          const sha = await git.commit([store.rel(store.fileOf(c, id, { mustExist: false }))], `Revert ${c.id}/${id}: ${what} failed`, entries.authorOf(ctx.user));
          if (out.after !== null && out.before !== null) keepAutosave(ctx.user, c, id, out.before, out.after);
          if (out.trashId) db.prepare('DELETE FROM trash WHERE id = ?').run(out.trashId);
          log(`Reverted in ${sha ?? '(nothing to revert)'}; your text is kept as an autosave.\n`);
          return 0;
        }),
      );
  }

  /** Queue the checks + build + deploy job for an entry change that was just committed. */
  function deployJob(ctx, c, id, kind, out, { checks = false } = {}) {
    return jobs.enqueue({
      kind,
      collection: c.id,
      entryId: id,
      user: ctx.user,
      run: async (step) => {
        await step('commit', (log) => (log(out.commit ? `committed ${out.commit}\n` : 'no change to commit\n'), 0));
        if (checks && config.checks.some((k) => !k.after) && out.after !== null) await step('checks', async (log) => ((await history.runChecks(c, id, out.after, log)).ok ? 0 : 1));
        // every locale copy where its status says, in the build, before it is deployed
        await jobs.buildAndDeploy(step, { afterBuild: app.verify.afterBuild([app.verify.expect(c, id, out.after, out.before)]), changed: app.afterDeploy.pagesOf(c, id, out.before, out.after) });
      },
      onFail: out.commit ? revertStep(ctx, c, id, out, kind) : null,
    });
  }

  /** The publish rules (publish-rules.mjs): a finding set to block stops the publish, with the reasons. */
  function mayGoLive(c, id, text) {
    const stop = app.publishRules?.blocking(c, id, text) ?? [];
    if (stop.length) throw new HttpError(422, 'blocked', `This cannot go live yet: ${stop.map((v) => v.message).join('; ')}.`, { rules: stop });
  }

  const hasContent = (b) => ['doc', 'frontmatter', 'source', 'data', 'changes'].some((k) => b[k] !== undefined);
  const needPublish = (summary, rights) => {
    if (!rights.publish) throw forbidden('Your role cannot publish. Save it as a draft and ask an editor.');
  };

  router.add('POST', '/collections/:c/entries/:id/publish', async (ctx) => {
    const c = coll(ctx);
    const body = ctx.body;
    // "Publish anyway": past the publish rules (not the site's checks), editors and above, audited with the rules
    const anyway = body.anyway === true;
    if (anyway && !atLeast(ctx.user, 'editor')) throw forbidden('Only editors and above can publish past the publish rules.');
    let overruled = [];
    const out = await entries.saveEntry(ctx, c, ctx.params.id, {
      version: body.version,
      message: `Publish ${c.id}/${ctx.params.id}${anyway ? ' (past the publish rules)' : ''}`,
      action: 'entry.publish',
      allowStatus: true,
      check: needPublish,
      build: (cur) => {
        const text = hasContent(body) ? entries.textFromBody(c, cur.text, body).text : cur.text;
        if (anyway) overruled = app.publishRules?.blocking(c, ctx.params.id, text) ?? [];
        else mayGoLive(c, ctx.params.id, text);
        return { text: setStatus(c, text, { draft: null, publishAt: null }) };
      },
    });
    if (overruled.length) audit.log(ctx, 'entry.publish.anyway', { target: `${c.id}/${ctx.params.id}`, detail: { commit: out.commit, rules: overruled.map((v) => ({ rule: v.rule, message: v.message })) } });
    ctx.status = 202;
    return { job: deployJob(ctx, c, ctx.params.id, 'publish', out, { checks: true }), version: out.version };
  });

  // a live entry comes off the site (a build follows); a scheduled one goes back to a draft with no build to run,
  // since the site never had it (QA F9: "Cancel the schedule"), audited as entry.unschedule
  router.add('POST', '/collections/:c/entries/:id/unpublish', async (ctx) => {
    const c = coll(ctx);
    if (!c.hasStatus) throw badRequest('This collection has no draft status.');
    const was = store.summarize(c, ctx.params.id, store.read(c, ctx.params.id).text).status;
    const scheduled = was === 'scheduled';
    const out = await entries.saveEntry(ctx, c, ctx.params.id, {
      version: ctx.body.version,
      message: `${scheduled ? 'Cancel the schedule of' : 'Unpublish'} ${c.id}/${ctx.params.id}`,
      action: scheduled ? 'entry.unschedule' : 'entry.unpublish',
      allowStatus: true,
      check: (summary, rights) => {
        needPublish(summary, rights);
        if (summary.status === 'draft') throw conflict('This entry is already a draft.', { version: ctx.body.version });
      },
      build: (cur) => ({ text: setStatus(c, cur.text, { draft: true, publishAt: null }) }),
    });
    if (scheduled) return { job: null, version: out.version, status: 'draft' };
    ctx.status = 202;
    return { job: deployJob(ctx, c, ctx.params.id, 'unpublish', out), version: out.version };
  });

  router.add('POST', '/collections/:c/entries/:id/schedule', async (ctx) => {
    const c = coll(ctx);
    if (!c.hasStatus) throw badRequest('This collection has no draft status.');
    const at = Date.parse(ctx.body.publishAt);
    if (!Number.isFinite(at) || at <= app.clock() + 30_000) throw invalid({ publishAt: 'Pick a time in the future.' });
    const publishAt = new Date(at).toISOString();
    const file = store.read(c, ctx.params.id);
    if (config.checks.some((k) => !k.after)) {
      const res = await history.runChecks(c, ctx.params.id, file.text);
      if (!res.ok) throw invalid({ checks: 'A blocking content check failed.' }, 'Fix the failing checks before scheduling.');
    }
    const out = await entries.saveEntry(ctx, c, ctx.params.id, {
      version: ctx.body.version,
      message: `Schedule ${c.id}/${ctx.params.id} for ${publishAt}`,
      action: 'entry.schedule',
      allowStatus: true,
      check: (summary, rights) => {
        needPublish(summary, rights);
        if (summary.status === 'published') throw conflict('This entry is live. Unpublish it first to schedule it.', { version: ctx.body.version });
      },
      build: (cur) => {
        mayGoLive(c, ctx.params.id, cur.text);
        return { text: setStatus(c, cur.text, { draft: null, publishAt }) };
      },
    });
    return { ok: true, version: out.version, status: 'scheduled', commit: out.commit };
  });

  // --- trash ------------------------------------------------------------------------------------------------------

  router.add('DELETE', '/collections/:c/entries/:id', async (ctx) => {
    const c = coll(ctx);
    const id = ctx.params.id;
    const out = await repoLock.run(async () => {
      const cur = store.read(c, id);
      if (!ctx.query.get('version')) throw badRequest('Send the version you opened (?version=): a delete is checked against it.');
      if (ctx.query.get('version') !== cur.version) throw conflict('This entry changed since you opened it.', { version: cur.version });
      const summary = store.summarize(c, id, cur.text);
      if (!entries.permissions(ctx, c, summary).delete) throw forbidden('You cannot delete this entry.');
      const trashId = newId('tr');
      db.prepare('INSERT INTO trash (id, collection, entry_id, title, author, text, deleted_at, deleted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        trashId,
        c.id,
        id,
        summary.title,
        summary.author,
        cur.text,
        nowIso(app.clock()),
        ctx.user.id,
      );
      const { rel } = store.remove(c, id);
      const commit = await git.commit([rel], `Trash ${c.id}/${id}`, entries.authorOf(ctx.user));
      audit.log(ctx, 'entry.delete', { target: `${c.id}/${id}`, detail: { commit, trashId } });
      return { trashId, commit, before: cur.text, after: null, live: summary.status === 'published' };
    });
    const job = out.live && out.commit ? deployJob(ctx, c, id, 'delete', out) : null;
    return { ok: true, trashId: out.trashId, job };
  });

  const trashRow = (ctx) => {
    const row = db.prepare('SELECT * FROM trash WHERE id = ?').get(ctx.params.tid);
    if (!row) throw notFound('Not in the trash.');
    return row;
  };

  router.add('GET', '/trash', (ctx) => {
    const filter = ctx.query.get('collection');
    const rows = db.prepare('SELECT id, collection, entry_id, title, author, deleted_at, deleted_by, text FROM trash ORDER BY deleted_at DESC').all();
    // the address it had (from the text kept in the trash), so people know which page it was
    const urlOf = (r) => {
      try {
        return store.summarize(store.collection(r.collection), r.entry_id, r.text).url ?? null;
      } catch {
        return null;
      }
    };
    return rows
      .filter((r) => (!filter || r.collection === filter) && (can(ctx.user, 'trash.restore.any') || owns(ctx.user, r)))
      .map((r) => ({ trashId: r.id, collection: r.collection, id: r.entry_id, title: r.title, author: r.author, deletedAt: r.deleted_at, deletedBy: r.deleted_by, url: urlOf(r) }));
  });

  router.add('POST', '/trash/:tid/restore', async (ctx) => {
    const row = trashRow(ctx);
    const c = store.collection(row.collection);
    const mayRestore = can(ctx.user, 'trash.restore.any') || (ctx.user.role === 'author' && owns(ctx.user, row));
    if (!mayRestore) throw forbidden('You cannot restore this entry.');
    await repoLock.run(async () => {
      if (store.exists(c, row.entry_id)) throw conflict('An entry with this id exists again. Rename it first.');
      const text = setStatus(c, row.text, { draft: true, publishAt: null });
      // the person's own raw-HTML right for the entry it becomes (a custom role may restore but not add raw HTML;
      // review 3 Nov 2026, S16): every built-in role that may restore also has it
      const rights = entries.permissions(ctx, c, store.summarize(c, row.entry_id, text));
      entries.guard(ctx, c, null, text, { rawHtml: rights.rawHtml }, { allowStatus: true });
      await entries.validate(c, row.entry_id, text);
      const written = store.write(c, row.entry_id, text);
      const commit = await git.commit([written.rel], `Restore ${c.id}/${row.entry_id} from trash`, entries.authorOf(ctx.user));
      db.prepare('DELETE FROM trash WHERE id = ?').run(row.id);
      audit.log(ctx, 'entry.restore', { target: `${c.id}/${row.entry_id}`, detail: { commit } });
    });
    ctx.status = 201;
    return entries.view(ctx, c, row.entry_id);
  });

  router.add('DELETE', '/trash/:tid', (ctx) => {
    const row = trashRow(ctx);
    if (!can(ctx.user, 'trash.purge')) throw forbidden('Only administrators can empty the trash.');
    db.prepare('DELETE FROM trash WHERE id = ?').run(row.id);
    audit.log(ctx, 'entry.purge', { target: `${row.collection}/${row.entry_id}` });
    return { ok: true };
  });

  // --- whole-site rebuild and jobs --------------------------------------------------------------------------------

  router.add('POST', '/site/publish', (ctx) => {
    if (!can(ctx.user, 'site.publish')) throw forbidden('Your role cannot rebuild the site.');
    audit.log(ctx, 'site.publish');
    ctx.status = 202;
    return { job: jobs.enqueue({ kind: 'site', user: ctx.user, run: (step) => jobs.buildAndDeploy(step) }) };
  });

  // Roll back a bad release (owner, administrator): the site's rollback command puts the release before back live.
  // The content in the repo stays as it is; the next publish puts it live again, and the publish sheet lists it.
  router.add('POST', '/site/rollback', (ctx) => {
    if (!can(ctx.user, 'site.rollback')) throw forbidden('Only owners and administrators can roll the site back.');
    if (!config.commands.rollback) throw badRequest('Rolling back is not set up on this server (commands.rollback in config.json).');
    audit.log(ctx, 'site.rollback');
    ctx.status = 202;
    const by = ctx.user.name;
    return {
      job: jobs.enqueue({
        kind: 'rollback',
        user: ctx.user,
        run: (step) => jobs.rollBack(step),
        // the site changed under everyone: editors hear it, and that the saved changes go live with the next publish
        onSuccess: () => app.notices?.tell({ kind: 'site.rollback', level: 'warn', text: `${by} rolled the site back to the release before. Changes saved since are not live; the next publish puts them live again.`, link: '#/health', to: 'editors' }),
      }),
    };
  });

  // the list (no logs) is for everyone signed in; a job's log (the build's and deploy's output: paths, host names,
  // whatever the site's build prints) only for whoever started it and for editors and up (site.publish)
  router.add('GET', '/jobs', (ctx) => jobs.list(ctx.query.get('limit')));
  router.add('GET', '/jobs/:jid', (ctx) => {
    const job = jobs.get(ctx.params.jid, ctx.query.get('since'));
    if (job.userId !== ctx.user.id && !can(ctx.user, 'site.publish')) throw forbidden('Only the person who started this job, editors, administrators and the owner can read its log.');
    return job;
  });

  return { setStatus, deployJob };
}

/**
 * Scheduled publishing for a static site: every tick, if any entry's publishAt passed since the last successful
 * scheduled build, queue one build + deploy. Three failed tries in a row give up (audited) until the next due entry.
 * A due entry the publish rules stop is held: a draft for the site's build that keeps its publishAt, shown as
 * "Scheduled, held: <why>" (store.setHeld), with a notice and an alert; the rest of the run goes on. Once nothing
 * stops it, the next tick puts it live; an editor can also "Publish anyway".
 */
export function createScheduler(app) {
  const { db, store, jobs, audit, config } = app;
  const get = (k) => db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value;
  const set = (k, v) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  if (!get('scheduler.coveredUntil')) set('scheduler.coveredUntil', app.clock());
  let pending = false;
  let timer = null;

  // held entries: kv `schedule.held:<c>/<id>` = {dueAt, reasons, at}; it counts only while the entry is still a draft
  // with that same publishAt (a publish, unpublish or new schedule ends it)
  const HELD = 'schedule.held:';
  const heldRow = (c, id) => {
    const v = get(`${HELD}${c.id}/${id}`);
    return v ? JSON.parse(v) : null;
  };
  store.setHeld((c, id, publishAt) => {
    const h = heldRow(c, id);
    return h && Date.parse(h.dueAt) === Date.parse(publishAt) ? { dueAt: h.dueAt, reasons: h.reasons } : null;
  });
  const forget = (c, id) => db.prepare('DELETE FROM kv WHERE key = ?').run(`${HELD}${c.id}/${id}`);
  /** Held entries nothing stops now: [{c, id, text}] (records that no longer hold anything are dropped). */
  function releasable() {
    const out = [];
    for (const r of db.prepare('SELECT key FROM kv WHERE key LIKE ?').all(`${HELD}%`)) {
      const [cid, id] = r.key.slice(HELD.length).split('/');
      let c;
      let text;
      try {
        c = store.collection(cid);
        text = store.read(c, id).text;
      } catch {
        db.prepare('DELETE FROM kv WHERE key = ?').run(r.key);
        continue;
      }
      if (!store.summarize(c, id, text).held) {
        forget(c, id);
        continue;
      }
      if (!(app.publishRules?.blocking(c, id, text) ?? []).length) out.push({ c, id, text });
    }
    return out;
  }

  function due(now) {
    const covered = Number(get('scheduler.coveredUntil'));
    const out = [];
    for (const c of store.collections.filter((x) => x.hasStatus)) {
      for (const id of store.ids(c)) {
        let f;
        try {
          f = store.fieldsOf(c, store.read(c, id).text);
        } catch {
          continue;
        }
        const at = f.publishAt ? Date.parse(f.publishAt) : NaN;
        if (f.draft !== true && Number.isFinite(at) && at > covered && at <= now) out.push({ c: c.id, id, at });
      }
    }
    return out;
  }

  const scheduler = { name: 'Markstage scheduler', email: config.git.committerEmail };
  /** A due entry the publish rules stop: held (a draft that keeps its time), in its own commit by the scheduler. */
  function holdBack(c, id, stop, dueAt) {
    return app.repoLock.run(async () => {
      const text = store.read(c, id).text;
      set(`${HELD}${c.id}/${id}`, JSON.stringify({ dueAt, reasons: stop.map((v) => v.message), at: new Date(app.clock()).toISOString() }));
      store.write(c, id, statusText(app.converter, c, text, { draft: true }));
      await app.git.commit([store.rel(store.fileOf(c, id))], `Hold back ${c.id}/${id}: ${stop.map((v) => v.rule).join(', ')} blocks publishing (still scheduled)`, scheduler);
    });
  }
  /** A held entry nothing stops now: live (draft and time cleared), in its own commit; returns the text before. */
  function release(c, id) {
    return app.repoLock.run(async () => {
      const before = store.read(c, id).text;
      const after = statusText(app.converter, c, before, { draft: null, publishAt: null });
      store.write(c, id, after);
      await app.git.commit([store.rel(store.fileOf(c, id))], `Release ${c.id}/${id}: nothing holds it back now`, scheduler);
      return { before, after };
    });
  }
  /** A failed run puts a released entry back on hold, unless someone changed it since. */
  function holdAgain(r, log) {
    return app.repoLock.run(async () => {
      if (store.read(r.c, r.id).text !== r.after) return log(`${r.c.id}/${r.id}: changed since, left as it is\n`);
      store.write(r.c, r.id, r.before);
      set(`${HELD}${r.c.id}/${r.id}`, JSON.stringify(r.held));
      await app.git.commit([store.rel(store.fileOf(r.c, r.id))], `Hold ${r.c.id}/${r.id} again: the publish failed`, scheduler);
      log(`${r.c.id}/${r.id}: held again\n`);
    });
  }

  function tick(now = app.clock()) {
    if (pending) return null;
    const list = due(now);
    const ready = releasable();
    if (!list.length && !ready.length) return null;
    pending = true;
    const until = list.length ? Math.max(...list.map((d) => d.at)) : Number(get('scheduler.coveredUntil'));
    const released = [];
    return jobs.enqueue({
      kind: 'schedule',
      run: async (step) => {
        const going = [];
        if (ready.length) {
          await step('released', async (log) => {
            for (const r of ready) {
              const held = heldRow(r.c, r.id);
              const cur = store.read(r.c, r.id).text;
              // checked again: it may have changed since the tick looked
              if (!store.summarize(r.c, r.id, cur).held || (app.publishRules?.blocking(r.c, r.id, cur) ?? []).length) continue;
              const { before, after } = await release(r.c, r.id);
              forget(r.c, r.id);
              released.push({ c: r.c, id: r.id, before, after, held });
              const title = store.summarize(r.c, r.id, after).title || r.id;
              log(`${r.c.id}/${r.id}: nothing holds it back now; it goes live\n`);
              app.notices?.tell({ kind: 'schedule.released', level: 'info', text: `“${title}” was held back and is going live now: nothing stops it any more.`, link: `#/e/${r.c.id}/${r.id}`, to: 'editors' });
              audit.log({ actorName: 'scheduler' }, 'schedule.released', { target: `${r.c.id}/${r.id}`, detail: { dueAt: held?.dueAt ?? null } });
              going.push({ c: r.c, id: r.id, text: after, before });
            }
            return 0;
          });
        }
        await step('due', async (log) => {
          for (const d of list) {
            const c = store.collection(d.c);
            let text;
            try {
              text = store.read(c, d.id).text;
            } catch {
              log(`${d.c}/${d.id}: deleted since it was scheduled\n`);
              continue;
            }
            const title = store.summarize(c, d.id, text).title || d.id;
            // edited into a state the publish rules stop since it was scheduled: back to a draft, people told
            const stop = app.publishRules?.blocking(c, d.id, text) ?? [];
            if (stop.length) {
              await holdBack(c, d.id, stop, new Date(d.at).toISOString());
              const why = stop.map((v) => v.message).join('; ');
              log(`${d.c}/${d.id}: held, still scheduled (${why})\n`);
              app.notices?.tell({ kind: 'schedule.held', level: 'warn', text: `“${title}” was due at ${utc(d.at)} but is held: ${why}. It stays scheduled and goes live on the next run once that is fixed; an editor can also publish it anyway.`, link: `#/publish/${d.c}/${d.id}`, to: 'editors' });
              audit.log({ actorName: 'scheduler' }, 'schedule.held', { target: `${d.c}/${d.id}`, ok: false, detail: { reasons: stop.map((v) => v.rule) } });
              continue;
            }
            // the server was not running when it was due: it goes live now, and people hear it was late
            const late = now - d.at;
            if (late > Math.max(120_000, 2 * config.scheduler.intervalSeconds * 1000)) {
              const mins = Math.round(late / 60_000);
              log(`${d.c}/${d.id}: due at ${new Date(d.at).toISOString()}, ${mins} min late (the server was not running)\n`);
              app.notices?.tell({ kind: 'schedule.late', level: 'info', text: `“${title}” was due at ${utc(d.at)} while the server was not running. It went out ${mins} min late.`, link: `#/e/${d.c}/${d.id}`, to: 'editors' });
              audit.log({ actorName: 'scheduler' }, 'schedule.late', { target: `${d.c}/${d.id}`, detail: { dueAt: new Date(d.at).toISOString(), minutes: mins } });
            } else log(`${d.c}/${d.id} at ${new Date(d.at).toISOString()}\n`);
            going.push({ c, id: d.id, text });
          }
          return 0;
        });
        if (!going.length) return; // nothing left to put live
        const changed = going.flatMap((g) => app.afterDeploy.pagesOf(g.c, g.id, g.before ?? null, g.text));
        await jobs.buildAndDeploy(step, { afterBuild: app.verify.afterBuild(going.map((g) => app.verify.expect(g.c, g.id, g.text, g.before))), changed });
      },
      onSuccess: () => {
        set('scheduler.coveredUntil', until);
        set('scheduler.failures', 0);
        pending = false;
      },
      onFail: async (step) => {
        if (released.length) await step('hold again', async (log) => (await Promise.all(released.map((r) => holdAgain(r, log))), 0));
        const failures = Number(get('scheduler.failures') ?? 0) + 1;
        set('scheduler.failures', failures);
        if (failures >= 3) {
          set('scheduler.coveredUntil', until);
          set('scheduler.failures', 0);
          audit.log({ actorName: 'scheduler' }, 'schedule.giveup', { ok: false, detail: { entries: list.map((d) => `${d.c}/${d.id}`) } });
        }
        pending = false;
      },
    });
  }

  return {
    tick,
    start() {
      timer = setInterval(() => {
        try {
          tick();
        } catch (e) {
          console.error('[markstage] scheduler:', e.message);
        }
      }, config.scheduler.intervalSeconds * 1000);
      timer.unref();
    },
    stop: () => clearInterval(timer),
  };
}
