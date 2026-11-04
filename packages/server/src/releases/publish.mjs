// A release goes live (docs/API-RELEASES.md "Publishing"): asked of the promotion rules (action publish-release, from
// 'release' to this environment), every file checked against the site as it is now, then one commit with all of it,
// the site's checks, build and deploy as one job. A failure puts every file back in one more commit, so the repo
// matches what is live again. Scheduled: the scheduler does the same at its time, built as of that time, so the
// published build is the preview's byte for byte. A published release rolls back the same way: its files put back,
// built and deployed.
import fs from 'node:fs';
import path from 'node:path';
import { decide, kindsOf } from '../env/rules.mjs';
import { HttpError, badRequest, conflict, nowIso, sha1 } from '../util.mjs';
import { OPEN } from './store.mjs';

const utc = (iso) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

export function createReleasePublish(app, { rs, builds }) {
  const { db, config, store, git, jobs, repoLock, audit, clock } = app;
  const envName = config.environment.name;
  const site = { collections: config.collections, mediaDir: config.media.dir, libraryDir: config.library?.dir, kinds: app.site?.environment?.kinds };
  const author = (u) => ({ name: u?.name ?? config.git.committerName, email: u?.email ?? config.git.committerEmail });
  const entryOf = (it) => ({ c: store.collection(it.collection), id: it.entry_id, text: rs.bytesOf(it).toString('utf8') });

  // ---- the preview ----------------------------------------------------------------------------------------------

  const target = (r) => `r_${r.id}`;
  /** What the release's preview is built from: the commit the site is at and the release's files. */
  async function previewKey(r) {
    const head = await git.head();
    return { head, key: sha1(`${head}\n${rs.contentKey(r)}`) };
  }

  /** The site's checks of every entry in the release (stored with the content they checked, for the rules). */
  async function runChecks(r, log) {
    const list = rs.items(r.id).filter((i) => i.kind === 'entry');
    const results = [];
    for (const it of list) {
      const e = entryOf(it);
      const out = await app.history.runChecks(e.c, e.id, e.text, log);
      for (const x of out.results) results.push({ entry: `${e.c.id}/${e.id}`, id: x.id, label: x.label, blocking: x.blocking, ok: x.ok });
    }
    const failed = [...new Set(results.filter((x) => !x.ok && x.blocking).map((x) => x.id))];
    const passed = [...new Set(results.filter((x) => x.ok).map((x) => x.id))].filter((x) => !failed.includes(x));
    return { done: true, passed, failed, results };
  }

  /** Build the release's preview as of when it goes live (its publish time, else now). Returns {job, preview}. */
  async function buildPreview(r, user) {
    if (!rs.items(r.id).length) throw new HttpError(422, 'empty', 'This release has nothing in it yet.');
    const { head, key } = await previewKey(r);
    const content = rs.contentKey(r);
    const files = rs.items(r.id).map((i) => ({ rel: i.rel, bytes: rs.bytesOf(i) }));
    const job = builds.ensure(target(r), {
      key,
      head,
      content,
      files,
      buildTime: r.publish_at ?? nowIso(clock()),
      label: `the release “${r.name}”`,
      user,
      after: (step) =>
        step('checks', async (log) => {
          const checks = await runChecks(r, log);
          // only what was checked: an item changed since is checked by its own build
          if (rs.contentKey(rs.must(r.id)) === content) db.prepare('UPDATE releases SET checks = ? WHERE id = ?').run(JSON.stringify({ key: content, ...checks }), r.id);
          return 0;
        }),
    });
    return { job, preview: await preview(r) };
  }

  /**
   * The preview's state; a built one that is not of the site and the release as they are now says which moved
   * (`stale`: 'site' | 'release' | 'both', and `words`), and that it is not what would go live.
   */
  async function preview(r) {
    if (!OPEN.includes(r.status)) return { status: 'none', fresh: false, stale: null, words: null };
    const { head, key } = await previewKey(r);
    const st = builds.state(target(r), key);
    let stale = null;
    if (st.status !== 'none' && !st.fresh) {
      const site = st.head !== head;
      const release = st.content !== rs.contentKey(r);
      stale = site && release ? 'both' : site ? 'site' : 'release';
    }
    const words = !stale ? null : `${{ site: 'The site changed since this preview was built (another change went live)', release: 'The release changed since this preview was built', both: 'The site and the release changed since this preview was built' }[stale]}. It is not what would go live now: build it again.`;
    return { ...st, key, stale, words };
  }

  // ---- the rules ------------------------------------------------------------------------------------------------

  /** The rules' answer for this person publishing the release at `at`. */
  function decision(user, r, { at = clock(), reason = null } = {}) {
    const list = rs.items(r.id);
    const content = rs.contentKey(r, list);
    const checks = r.checks ? JSON.parse(r.checks) : null;
    return decide(app.environments.rules.get(), {
      user,
      action: 'publish-release',
      from: 'release',
      to: envName,
      files: list.map((i) => ({ path: i.rel, kinds: kindsOf(i.rel, site) })),
      at,
      sha: content,
      author: r.created_by,
      approvals: JSON.parse(r.approvals),
      checks: checks?.key === content ? checks : { done: false },
      reason,
    });
  }

  function refuse(ctx, r, d, action = 'release.publish') {
    audit.log(ctx, action, { target: r.id, ok: false, detail: { rule: d.rule?.id ?? null, words: d.words } });
    throw new HttpError(403, 'rule', d.words, { rule: d.rule, words: d.words, missing: d.missing });
  }

  /** The person as they are now (a disabled account, or one with no role left, has no rights). */
  const now = (uid) => {
    const u = uid ? app.users.get(uid) : null;
    return u && !u.disabled ? app.users.toPublic(u) : { id: uid, name: u?.name ?? null, role: null };
  };

  // ---- publishing -----------------------------------------------------------------------------------------------

  /** The files that changed on the site since they were added (one the release already matches is fine). */
  const changedOnSite = (list) => list.filter((i) => {
    const cur = rs.shaNow(i.rel);
    return cur !== i.base && cur !== i.sha;
  });

  function blocked(list) {
    const stop = [];
    for (const it of list.filter((i) => i.kind === 'entry')) {
      const e = entryOf(it);
      for (const v of app.publishRules?.blocking(e.c, e.id, e.text) ?? []) stop.push({ ...v, entry: `${e.c.id}/${e.id}`, title: it.title });
    }
    return stop;
  }

  const beforeFile = (r, it) => path.join(rs.dirOf(r.id), 'before', it.id);

  /** Write every file and commit them in one; records what was there before. Inside the repo lock. */
  async function writeAll(r, list, who) {
    fs.mkdirSync(path.join(rs.dirOf(r.id), 'before'), { recursive: true, mode: 0o700 });
    for (const it of list) {
      const was = store.readRelBytes(it.rel);
      if (was === null) fs.writeFileSync(`${beforeFile(r, it)}.none`, '', { mode: 0o600 });
      else fs.writeFileSync(beforeFile(r, it), was, { mode: 0o600 });
      store.writeRel(it.rel, rs.bytesOf(it));
      if (it.kind === 'media') {
        const m = JSON.parse(it.meta);
        db.prepare('INSERT OR IGNORE INTO media (id, path, filename, type, width, height, bytes, alt, uploaded_by, uploaded_at, derived_from, credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)').run(m.mediaId, it.rel, m.filename, m.type, m.width, m.height, it.bytes, m.alt ?? '', it.added_by, nowIso(clock()));
      }
    }
    return git.commit(list.map((i) => i.rel), `Release “${r.name}”`, author(who));
  }

  /** Put back what was there before, file by file, unless it changed since the release wrote it. */
  async function putBack(r, list, message, who, log) {
    const touched = [];
    for (const it of list) {
      if (rs.shaNow(it.rel) !== it.sha) {
        log(`${it.rel} changed after the release wrote it; left as it is. Check it by hand.\n`);
        continue;
      }
      const none = fs.existsSync(`${beforeFile(r, it)}.none`);
      if (none) store.removeRel(it.rel);
      else store.writeRel(it.rel, fs.readFileSync(beforeFile(r, it)));
      if (it.kind === 'media' && none) db.prepare('DELETE FROM media WHERE id = ?').run(JSON.parse(it.meta).mediaId);
      touched.push(it.rel);
      log(`${it.rel} put back\n`);
    }
    return touched.length ? git.commit(touched, message, author(who)) : null;
  }

  /**
   * Publish: `who` is the person it is done as (the scheduler: who scheduled it); `ctx` for the audit. `buildTime`:
   * the time the site is built as. Returns the job id. Throws in words when the rules or the site say no.
   */
  async function publish(ctx, r, { who, reason = null, scheduled = false }) {
    const list = rs.items(r.id);
    if (!list.length) throw new HttpError(422, 'empty', 'This release has nothing in it yet.');
    const d = decision(who, r, { reason });
    if (d.effect !== 'allow') refuse(ctx, r, d);
    const stop = blocked(list);
    if (stop.length) throw new HttpError(422, 'blocked', `This cannot go live yet: ${stop.map((v) => `${v.title}: ${v.message}`).join('; ')}.`, { rules: stop });
    // built as of when it goes live: its time when scheduled; else as its preview was, when that is of this content
    const pv = await preview(r);
    const buildTime = scheduled ? r.publish_at : pv.status === 'ready' && pv.fresh ? pv.buildTime : nowIso(clock());
    const entriesIn = list.filter((i) => i.kind === 'entry').map((it) => ({ ...entryOf(it), before: store.readRel(it.rel) }));
    const commit = await repoLock.run(async () => {
      const cur = rs.must(r.id);
      if (!OPEN.includes(cur.status)) throw new HttpError(409, 'not-open', `This release is ${cur.status}.`);
      // changed while this was asked (an item, a schedule): what was decided on is not what would go
      if (cur.rev !== r.rev) throw conflict('This release changed while it was being published. Open it again.', { version: `r${cur.rev}` });
      const changed = changedOnSite(rs.items(r.id));
      if (changed.length) throw new HttpError(409, 'changed', `${changed.map((i) => `“${i.title}”`).join(', ')} changed on the site since ${changed.length === 1 ? 'it was' : 'they were'} added. Add ${changed.length === 1 ? 'it' : 'them'} again to take the latest, then publish.`, { items: changed.map((i) => i.id) });
      const sha = await writeAll(cur, list, who);
      db.prepare("UPDATE releases SET status = 'publishing', commit_sha = ?, build_time = ?, published_by = ?, error = NULL, blocked = NULL, rev = rev + 1, updated_at = ? WHERE id = ?").run(sha, buildTime, who.id, nowIso(clock()), r.id);
      return sha;
    });
    const agent = viaMcp(list);
    audit.log(ctx, 'release.publish', { target: r.id, detail: { commit, items: list.length, scheduled, buildTime, rule: d.rule?.id ?? null, ...(agent.length ? { mcpItems: agent } : {}) } });
    const job = jobs.enqueue({
      kind: 'release',
      user: scheduled ? null : who,
      target: r.name,
      notice: scheduled ? { to: r.scheduled_by ? [r.scheduled_by] : 'editors', text: (e) => `The release “${r.name}” was due at ${utc(r.publish_at)} and did not go live. ${e} Its files are back as they were; it is open again.` } : null,
      run: async (step) => {
        await step('commit', (log) => (log(commit ? `committed ${commit}: ${list.length} file${list.length === 1 ? '' : 's'}\n` : 'every file was already so\n'), 0));
        if (entriesIn.length && config.checks.some((k) => !k.after)) {
          await step('checks', async (log) => {
            let ok = true;
            for (const e of entriesIn) ok = (await app.history.runChecks(e.c, e.id, e.text, log)).ok && ok;
            return ok ? 0 : 1;
          });
        }
        await jobs.buildAndDeploy(step, {
          afterBuild: app.verify.afterBuild(entriesIn.map((e) => app.verify.expect(e.c, e.id, e.text, e.before))),
          changed: list.some((i) => i.kind !== 'entry') ? 'all' : entriesIn.flatMap((e) => app.afterDeploy.pagesOf(e.c, e.id, e.before, e.text)),
          buildTime,
        });
      },
      onSuccess: async () => {
        db.prepare("UPDATE releases SET status = 'published', published_at = ?, error = NULL, rev = rev + 1, updated_at = ? WHERE id = ?").run(nowIso(clock()), nowIso(clock()), r.id);
        audit.log(scheduled ? { actorName: 'scheduler' } : ctx, 'release.published', { target: r.id, detail: { commit, buildTime } });
        app.notices?.tell({ kind: 'release.published', level: 'info', text: `The release “${r.name}” is live: ${list.length} change${list.length === 1 ? '' : 's'}${scheduled ? `, as scheduled for ${utc(r.publish_at)}` : `, published by ${who.name}`}.`, link: `#/releases/${r.id}`, to: 'editors' });
        await builds.remove(target(r));
      },
      onFail: (step) =>
        step('put back', (log) =>
          repoLock.run(async () => {
            const back = await putBack(r, list, `Put back the release “${r.name}”: the publish failed`, who, log);
            db.prepare("UPDATE releases SET status = 'open', publish_at = NULL, commit_sha = NULL, revert_sha = ?, error = ?, rev = rev + 1, updated_at = ? WHERE id = ?").run(back, 'The publish failed: see the job. Nothing changed on the live site; the release is open again.', nowIso(clock()), r.id);
            return 0;
          }),
        ),
    });
    db.prepare('UPDATE releases SET job_id = ? WHERE id = ?').run(job, r.id);
    return job;
  }

  /** Roll a published release back: its files put back where nobody changed them since, built, deployed. */
  async function rollback(ctx, r, { reason = null } = {}) {
    if (r.status !== 'published') throw new HttpError(409, 'not-published', 'Only a published release rolls back.');
    const d = decide(app.environments.rules.get(), { user: ctx.user, action: 'rollback', from: envName, to: envName, files: null, at: clock(), reason });
    if (d.effect !== 'allow') refuse(ctx, r, d, 'release.rollback');
    const list = rs.items(r.id);
    let log = '';
    const revert = await repoLock.run(() => putBack(r, list, `Roll back the release “${r.name}”${reason ? ` (reason: ${reason})` : ''}`, ctx.user, (s) => (log += s)));
    audit.log(ctx, 'release.rollback', { target: r.id, detail: { revert, reason } });
    db.prepare('UPDATE releases SET revert_sha = ?, rev = rev + 1, updated_at = ? WHERE id = ?').run(revert, nowIso(clock()), r.id);
    const job = jobs.enqueue({
      kind: 'release-rollback',
      user: ctx.user,
      target: r.name,
      run: async (step) => {
        await step('revert', (l) => (l(log || 'nothing to put back\n'), l(revert ? `committed ${revert}\n` : ''), 0));
        await jobs.buildAndDeploy(step);
      },
      onSuccess: () => {
        db.prepare("UPDATE releases SET status = 'rolled-back', error = NULL, rev = rev + 1, updated_at = ? WHERE id = ?").run(nowIso(clock()), r.id);
        app.notices?.tell({ kind: 'release.published', level: 'warn', text: `${ctx.user.name} rolled back the release “${r.name}”: its changes are off the live site.`, link: `#/releases/${r.id}`, to: 'editors' });
      },
      // the live site still shows the release: its files go back into the repo so the two match
      onFail: (step) =>
        step('put the release back', (l) =>
          repoLock.run(async () => {
            const again = [];
            for (const it of list) {
              const none = fs.existsSync(`${beforeFile(r, it)}.none`);
              const was = none ? null : sha1(fs.readFileSync(beforeFile(r, it)));
              if (rs.shaNow(it.rel) !== was) continue;
              store.writeRel(it.rel, rs.bytesOf(it));
              again.push(it.rel);
            }
            if (again.length) await git.commit(again, `Put the release “${r.name}” back: the rollback failed`, author(ctx.user));
            l(`${again.length} file${again.length === 1 ? '' : 's'} back as the release has them\n`);
            return 0;
          }),
        ),
    });
    db.prepare('UPDATE releases SET job_id = ? WHERE id = ?').run(job, r.id);
    return job;
  }

  // ---- scheduling -----------------------------------------------------------------------------------------------

  function schedule(ctx, r, { publishAt }) {
    const at = Date.parse(publishAt ?? '');
    if (!Number.isFinite(at)) throw badRequest('publishAt is a date and time like "2026-11-02T09:00:00Z".');
    if (at <= clock()) throw badRequest('Pick a time in the future, or publish it now.');
    if (!rs.items(r.id).length) throw new HttpError(422, 'empty', 'This release has nothing in it yet.');
    const iso = new Date(at).toISOString();
    // asked as of that time (a freeze then, the hours a rule allows); asked again when it is due
    const d = decision(ctx.user, { ...r, publish_at: iso }, { at });
    if (d.effect === 'deny') refuse(ctx, r, d, 'release.schedule');
    rs.bump(r.id, { status: 'scheduled', publish_at: iso, scheduled_by: ctx.user.id, error: null, blocked: null });
    audit.log(ctx, 'release.schedule', { target: r.id, detail: { publishAt: iso, rule: d.rule?.id ?? null } });
    return { decision: d };
  }

  function unschedule(ctx, r) {
    if (r.status !== 'scheduled') throw conflict('This release is not scheduled.', { version: `r${r.rev}` });
    rs.bump(r.id, { status: 'open', publish_at: null, scheduled_by: null, blocked: null });
    audit.log(ctx, 'release.unschedule', { target: r.id });
  }

  let busy = false;
  /**
   * Publish every scheduled release that is due, as the person who scheduled it (their role as it is now). One the
   * rules or the site stop stays scheduled and blocked, with why: its scheduler and the editors hear it once per
   * reason, and it goes out on a later tick once nothing stops it.
   */
  /** The items an AI agent added (through the MCP server): named wherever the release goes out or is stopped. */
  const viaMcp = (list) => list.filter((i) => JSON.parse(i.meta ?? '{}').via === 'mcp').map((i) => ({ rel: i.rel, title: i.title, token: JSON.parse(i.meta).tokenName ?? null }));

  async function tick(at = clock()) {
    if (busy) return [];
    busy = true;
    const started = [];
    try {
      for (const r of db.prepare("SELECT * FROM releases WHERE status = 'scheduled' AND publish_at <= ? ORDER BY publish_at").all(new Date(at).toISOString())) {
        try {
          started.push(await publish({ actorName: 'scheduler' }, r, { who: now(r.scheduled_by), scheduled: true }));
          if (r.blocked) audit.log({ actorName: 'scheduler' }, 'release.unblocked', { target: r.id, detail: { was: JSON.parse(r.blocked).words } });
        } catch (e) {
          const words = e instanceof HttpError ? e.message : 'Something went wrong on the server.';
          if (!(e instanceof HttpError)) console.error(`[markstage] release ${r.id}:`, e?.stack ?? e);
          const rule = e?.extra?.rule ?? null;
          const was = r.blocked ? JSON.parse(r.blocked) : null;
          if (was?.words === words) continue;
          db.prepare('UPDATE releases SET blocked = ?, rev = rev + 1, updated_at = ? WHERE id = ?').run(JSON.stringify({ words, rule, code: e?.code ?? 'server', at: nowIso(clock()) }), nowIso(clock()), r.id);
          const agent = viaMcp(rs.items(r.id));
          audit.log({ actorName: 'scheduler' }, 'release.blocked', { target: r.id, ok: false, detail: { dueAt: r.publish_at, rule: rule?.id ?? null, words, ...(agent.length ? { mcpItems: agent } : {}) } });
          app.notices?.tell({ kind: 'release.blocked', level: 'warn', text: `The release “${r.name}” was due at ${utc(r.publish_at)} and is blocked: ${words} It stays scheduled and goes out as soon as nothing stops it; or unschedule it.`, link: `#/releases/${r.id}`, to: r.scheduled_by ? [r.scheduled_by] : 'editors' });
        }
      }
    } finally {
      busy = false;
    }
    return started;
  }

  // a publish cut by a restart: the job was failed at start (jobs.mjs); the release says so and is open again
  for (const r of db.prepare("SELECT * FROM releases WHERE status = 'publishing'").all()) {
    db.prepare("UPDATE releases SET status = 'open', error = ? WHERE id = ?").run(`The server restarted during the publish (commit ${r.commit_sha ?? 'none'}). Check the site, then publish it again.`, r.id);
  }

  return { decision, publish, rollback, schedule, unschedule, tick, buildPreview, preview, refuse, target };
}
