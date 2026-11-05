// Releases and share links (docs/API-RELEASES.md). A release is a named set of changes (entries, shared Library
// items, pictures) that go live together in one commit, by hand or at a time; its preview is the site built as if
// it were published. A share link shows that preview, or one draft, to people without an account.
//
//   GET    /releases?status=                 {releases} (newest first)
//   POST   /releases                         {name, description?} -> 201 the release (editors and above)
//   GET    /releases/:rid                    the release, its items, preview, the rules' answer, its links
//   PATCH  /releases/:rid                    {version, name?, description?}
//   POST   /releases/:rid/cancel             {version}
//   POST   /releases/:rid/items              {kind: 'entry', collection, id, version, doc?|frontmatter?|source?|data?|changes?}
//                                            | {kind: 'library', libraryId?, version?, item} -> 201 {item, release}
//   POST   /releases/:rid/media?filename=&alt=   the picture's bytes -> 201 {item, release}
//   GET    /releases/:rid/items/:iid         {path, text, current, version} (an entry's or a Library item's file)
//   GET    /releases/:rid/items/:iid/file    the bytes the item writes (a picture)
//   DELETE /releases/:rid/items/:iid         -> {release}
//   POST   /releases/:rid/preview            -> 202 {job, preview}
//   POST   /releases/:rid/check              {at?} -> the rules' answer for you, with the trace
//   POST   /releases/:rid/approve            {version}
//   POST   /releases/:rid/schedule           {version, publishAt}
//   POST   /releases/:rid/unschedule         {version}
//   POST   /releases/:rid/publish            {version, reason?} -> 202 {job, release} | 403 {error: 'rule', words}
//   POST   /releases/:rid/rollback           {reason?} -> 202 {job, release}
//   POST   /share-links                      {release} | {collection, id}, days?, label? -> 201 {link, url}
//   GET    /share-links?release= | ?collection=&id=   {links, on}
//   DELETE /share-links/:lid                 turn the link off -> {link}
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { readRaw } from '../http.mjs';
import { mayApprove } from '../env/rules.mjs';
import { atLeast, can } from '../roles.mjs';
import { HttpError, badRequest, forbidden, invalid, newId, nowIso } from '../util.mjs';
import { createReleaseBuilds } from './builds.mjs';
import { createReleaseItems, notScheduled } from './items.mjs';
import { createReleasePublish } from './publish.mjs';
import { createShare } from './share.mjs';
import { OPEN, createReleaseStore } from './store.mjs';

const STATUSES = ['open', 'scheduled', 'publishing', 'published', 'rolled-back', 'cancelled'];

export function createReleases(app, entries) {
  const { db, config, audit, clock } = app;
  const rs = createReleaseStore(app);
  const builds = createReleaseBuilds(app);
  const items = createReleaseItems(app, { rs, entries });
  const pub = createReleasePublish(app, { rs, builds });
  const share = createShare(app, { rs, builds, pub, entries });

  const signedIn = (ctx) => {
    if (!ctx.user?.role) throw forbidden('Your account has no role on this site.');
  };
  const editor = (ctx, words) => {
    signedIn(ctx);
    if (!atLeast(ctx.user, 'editor')) throw forbidden(words);
  };
  const cleanName = (v) => {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > 120) throw invalid({ name: 'Give the release a name (up to 120 characters).' });
    return v.trim();
  };
  const cleanText = (v) => {
    if (v !== undefined && (typeof v !== 'string' || v.length > 2000)) throw invalid({ description: 'A description is up to 2000 characters.' });
    return (v ?? '').trim();
  };
  const reasonOf = (v) => (v === undefined || v === null ? null : String(v).trim().slice(0, 500) || null);

  async function full(ctx, r) {
    const preview = await pub.preview(r);
    const at = r.status === 'scheduled' ? Date.parse(r.publish_at) : clock();
    const d = OPEN.includes(r.status) ? pub.decision(ctx.user, r, { at }) : null;
    const links = db.prepare('SELECT COUNT(*) AS n FROM share_links WHERE release_id = ? AND revoked_at IS NULL AND expires_at > ?').get(r.id, nowIso(clock())).n;
    // canApprove: whether this person's approval would count under some rule (the screen offers Approve only then)
    return rs.view(r, { preview, decision: d ? { effect: d.effect, rule: d.rule, words: d.words, missing: d.missing } : null, links, canApprove: mayApprove(app.environments.rules.get(), 'publish-release', ctx.user) });
  }
  const fresh = (ctx, rid) => full(ctx, rs.must(rid));

  /** An open release this person may change; the version is checked when sent (adds from many people need none). */
  function changeable(ctx, rid, version, { needVersion = false } = {}) {
    signedIn(ctx);
    const r = rs.must(rid);
    rs.mustBeOpen(r);
    if (needVersion || version !== undefined) rs.checkVersion(r, version);
    return r;
  }

  function routes(router) {
    router.add('GET', '/releases', (ctx) => {
      signedIn(ctx);
      const status = ctx.query.get('status');
      if (status && !STATUSES.includes(status)) throw badRequest(`status is one of ${STATUSES.join(', ')}.`);
      const rows = status ? db.prepare('SELECT * FROM releases WHERE status = ? ORDER BY created_at DESC, rowid DESC').all(status) : db.prepare('SELECT * FROM releases ORDER BY created_at DESC, rowid DESC LIMIT 200').all();
      // the entries the last build broke on (jobs.mjs): nothing goes live until they are fixed
      return { releases: rows.map((r) => rs.view(r, { withItems: false })), buildBlocked: app.jobs.blocked() };
    });

    router.add('POST', '/releases', async (ctx) => {
      editor(ctx, 'Editors and above make releases.');
      const id = newId('rl');
      const at = nowIso(clock());
      db.prepare("INSERT INTO releases (id, name, description, status, created_by, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?)").run(id, cleanName(ctx.body.name), cleanText(ctx.body.description), ctx.user.id, at, at);
      audit.log(ctx, 'release.create', { target: id });
      ctx.status = 201;
      return fresh(ctx, id);
    });

    router.add('GET', '/releases/:rid', (ctx) => (signedIn(ctx), fresh(ctx, ctx.params.rid)));

    router.add('PATCH', '/releases/:rid', async (ctx) => {
      editor(ctx, 'Editors and above change releases.');
      const r = changeable(ctx, ctx.params.rid, ctx.body.version, { needVersion: true });
      const sets = {};
      if (ctx.body.name !== undefined) sets.name = cleanName(ctx.body.name);
      if (ctx.body.description !== undefined) sets.description = cleanText(ctx.body.description);
      rs.bump(r.id, sets);
      audit.log(ctx, 'release.update', { target: r.id, detail: { changed: Object.keys(sets) } });
      return fresh(ctx, r.id);
    });

    router.add('POST', '/releases/:rid/cancel', async (ctx) => {
      editor(ctx, 'Editors and above cancel releases.');
      const r = changeable(ctx, ctx.params.rid, ctx.body.version, { needVersion: true });
      rs.bump(r.id, { status: 'cancelled', publish_at: null });
      await builds.remove(pub.target(r));
      audit.log(ctx, 'release.cancel', { target: r.id });
      return fresh(ctx, r.id);
    });

    router.add('POST', '/releases/:rid/items', async (ctx) => {
      const r = changeable(ctx, ctx.params.rid, ctx.body.releaseVersion);
      if (ctx.via) notScheduled(r);
      const kind = ctx.body.kind;
      let it;
      if (kind === 'entry') it = await items.addEntry(ctx, r, ctx.body);
      else if (kind === 'library') it = items.addLibrary(ctx, r, ctx.body);
      else throw badRequest('kind is entry or library (a picture goes to /releases/:rid/media).');
      ctx.status = 201;
      const out = await fresh(ctx, r.id);
      return { item: out.items.find((x) => x.id === it.id), release: out };
    });

    router.add(
      'POST',
      '/releases/:rid/media',
      async (ctx) => {
        const r = changeable(ctx, ctx.params.rid, ctx.query.get('releaseVersion') ?? undefined);
        // the right to upload is checked before the file is read (S7); addMedia checks it again
        if (!can(ctx.user, 'media.upload')) throw forbidden('Your role cannot upload files.');
        const name = String(ctx.query.get('filename') ?? '');
        if (!name || name.length > 200) throw invalid({ filename: 'Send the file name.' });
        const raw = await readRaw(ctx.req, config.media.maxBytes);
        const it = await items.addMedia(ctx, r, raw, name, ctx.query.get('alt') ?? '');
        ctx.status = 201;
        const out = await fresh(ctx, r.id);
        return { item: out.items.find((x) => x.id === it.id), release: out };
      },
      { rawBody: true },
    );

    router.add('GET', '/releases/:rid/items/:iid', (ctx) => {
      signedIn(ctx);
      return items.text(rs.item(rs.must(ctx.params.rid).id, ctx.params.iid));
    });

    router.add('GET', '/releases/:rid/items/:iid/file', async (ctx) => {
      signedIn(ctx);
      const it = rs.item(rs.must(ctx.params.rid).id, ctx.params.iid);
      const meta = JSON.parse(it.meta);
      ctx.res.statusCode = 200;
      ctx.res.setHeader('Content-Type', it.kind === 'media' ? meta.type : 'text/plain; charset=utf-8');
      ctx.res.setHeader('Cache-Control', 'private, no-cache');
      ctx.res.setHeader('Content-Disposition', 'inline');
      await pipeline(fs.createReadStream(`${rs.dirOf(it.release_id)}/${it.id}`), ctx.res);
    });

    router.add('DELETE', '/releases/:rid/items/:iid', async (ctx) => {
      const r = changeable(ctx, ctx.params.rid, ctx.query.get('releaseVersion') ?? undefined);
      items.remove(ctx, r, rs.item(r.id, ctx.params.iid));
      return { release: await fresh(ctx, r.id) };
    });

    router.add('POST', '/releases/:rid/preview', async (ctx) => {
      signedIn(ctx);
      const r = rs.must(ctx.params.rid);
      rs.mustBeOpen(r);
      const out = await pub.buildPreview(r, ctx.user);
      audit.log(ctx, 'release.preview', { target: r.id, detail: { job: out.job } });
      ctx.status = 202;
      return out;
    });

    router.add('POST', '/releases/:rid/check', (ctx) => {
      signedIn(ctx);
      const r = rs.must(ctx.params.rid);
      const at = ctx.body.at ? Date.parse(ctx.body.at) : r.publish_at ? Date.parse(r.publish_at) : clock();
      if (!Number.isFinite(at)) throw badRequest('at is a date and time like "2026-11-02T09:00:00Z".');
      return pub.decision(ctx.user, r, { at, reason: reasonOf(ctx.body.reason) });
    });

    router.add('POST', '/releases/:rid/approve', async (ctx) => {
      const r = changeable(ctx, ctx.params.rid, ctx.body.version, { needVersion: true });
      if (r.created_by === ctx.user.id) throw new HttpError(422, 'own', 'You made this release: someone else approves it.');
      // only someone whose approval a rule would count (S10): any other would sit in the list and mislead it
      if (!mayApprove(app.environments.rules.get(), 'publish-release', ctx.user)) throw forbidden('No rule counts an approval from your role. The rules in Settings → Environments say who approves.');
      const key = rs.contentKey(r);
      const list = JSON.parse(r.approvals).filter((a) => a.userId !== ctx.user.id);
      list.push({ userId: ctx.user.id, role: ctx.user.role, sha: key, at: nowIso(clock()) });
      db.prepare('UPDATE releases SET approvals = ?, rev = rev + 1, updated_at = ? WHERE id = ?').run(JSON.stringify(list), nowIso(clock()), r.id);
      audit.log(ctx, 'release.approve', { target: r.id, detail: { key } });
      return fresh(ctx, r.id);
    });

    router.add('POST', '/releases/:rid/schedule', async (ctx) => {
      const r = changeable(ctx, ctx.params.rid, ctx.body.version, { needVersion: true });
      pub.schedule(ctx, r, { publishAt: ctx.body.publishAt });
      // its preview, built as of that time: what the scheduler will put live
      const now = rs.must(r.id);
      await pub.buildPreview(now, ctx.user);
      return fresh(ctx, r.id);
    });

    router.add('POST', '/releases/:rid/unschedule', async (ctx) => {
      const r = changeable(ctx, ctx.params.rid, ctx.body.version, { needVersion: true });
      pub.unschedule(ctx, r);
      return fresh(ctx, r.id);
    });

    router.add('POST', '/releases/:rid/publish', async (ctx) => {
      const r = changeable(ctx, ctx.params.rid, ctx.body.version, { needVersion: true });
      const job = await pub.publish(ctx, r, { who: ctx.user, reason: reasonOf(ctx.body.reason) });
      ctx.status = 202;
      return { job, release: await fresh(ctx, r.id) };
    });

    router.add('POST', '/releases/:rid/rollback', async (ctx) => {
      signedIn(ctx);
      const r = rs.must(ctx.params.rid);
      const job = await pub.rollback(ctx, r, { reason: reasonOf(ctx.body.reason) });
      ctx.status = 202;
      return { job, release: await fresh(ctx, r.id) };
    });

    router.add('POST', '/share-links', (ctx) => {
      signedIn(ctx);
      ctx.status = 201;
      return share.create(ctx, ctx.body);
    });
    router.add('GET', '/share-links', (ctx) => (signedIn(ctx), share.list(ctx, ctx.query)));
    router.add('DELETE', '/share-links/:lid', (ctx) => (signedIn(ctx), share.revoke(ctx, ctx.params.lid)));
  }

  /** Preview folders nothing shows any more: a release not open, a draft no live link points at. */
  async function sweep() {
    const drafts = share.shownDrafts();
    for (const { target } of db.prepare("SELECT target FROM release_builds WHERE status != 'building'").all()) {
      const keep = target.startsWith('r_') ? OPEN.includes(rs.row(target.slice(2))?.status) : drafts.has(target);
      if (!keep) await builds.remove(target);
    }
  }

  let timer = null;
  return {
    sweep,
    routes,
    reserved: rs.reserved,
    tick: (at) => pub.tick(at),
    /** The site's checks on what release `rid` holds now (the MCP server's publish_release asks first). */
    checkNow: (rid) => pub.checkNow(rs.must(rid)),
    /** Log a publish refused before it was asked of the rules (an agent's failed checks), as a refusal is logged. */
    refused: (ctx, rid, detail) => audit.log(ctx, 'release.publish', { target: rid, ok: false, detail }),
    share,
    start() {
      timer = setInterval(() => void pub.tick().then(sweep).catch((e) => console.error('[markstage] releases:', e.message)), config.scheduler.intervalSeconds * 1000);
      timer.unref();
    },
    stop: () => clearInterval(timer),
  };
}
