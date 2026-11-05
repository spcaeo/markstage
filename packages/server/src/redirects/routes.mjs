// Redirects (docs/OPERATIONS.md "Redirects"): the site's old -> new addresses. Moves add them on their own (move.mjs);
// this lists them with what is wrong (check.mjs), adds or changes one, removes some, and tests one on the live site.
// Editors and above. Every change goes through the site's hook (hook.mjs), is one commit, and is built and deployed in
// a job; a failed job puts the files back.
//   GET  /site/redirects                         {on, canList, message, siteUrl, redirects: [{from, to, status, flags}]}
//   POST /site/redirects {from, to, was?}        add one, or change one (`was`: its old address when that changes):
//                                                {commit, job, redirect}; a loop or an address with a page is refused
//   POST /site/redirects/remove {from: [...]}    {commit, job, removed}
//   POST /site/redirects/test {from}             what the build has there, and hop by hop through that build
import fs from 'node:fs';
import path from 'node:path';
import { atLeast } from '../roles.mjs';
import { HttpError, badRequest, forbidden, invalid } from '../util.mjs';
import { builtFile, isRedirectStub, readHead } from '../verify.mjs';
import { badFrom, badTo, checkRedirects, keyOf } from './check.mjs';

const MAX_REMOVE = 500;
const MAX_HOPS = 10;
const TESTS_PER_MINUTE = 30;

/** The target of a meta-refresh stub (what static sites build for a redirect), or null. */
function stubTarget(html) {
  const m = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i.exec(html.slice(0, 4000));
  return m ? m[1] : null;
}

export function redirectsRoutes(router, app, entries) {
  const { config, git, jobs, repoLock, audit, store, clock } = app;
  const hook = app.redirectsHook;
  // each person's live tests in the last minute: counted by every server process (cluster/limits.mjs)

  const mayManage = (ctx) => {
    if (!atLeast(ctx.user, 'editor')) throw forbidden('Only editors, administrators and the owner manage redirects.');
  };
  const needHook = () => {
    if (!config.redirects) throw new HttpError(409, 'not-set-up', 'This site has no redirects hook (redirects in markstage.config, docs/API.md).');
  };

  /** What the last build has at a site path: 'page', 'redirect', or null; null as a whole when there is no build. */
  // the build output: verify.public when set, else the site's dist/ (the same default as the health hook)
  const buildDir = () => {
    const dir = config.verify?.public ?? path.join(config.contentRoot, 'dist');
    return fs.existsSync(dir) ? dir : null;
  };
  const built = () => {
    const dir = buildDir();
    if (!dir) return null;
    return (p) => {
      const f = builtFile(dir, p);
      return f ? (isRedirectStub(f) ? 'redirect' : 'page') : null;
    };
  };

  /** The keys of every live entry's addresses (every locale). */
  function livePages() {
    const out = new Set();
    for (const c of store.collections) {
      for (const id of store.ids(c)) {
        try {
          const text = store.read(c, id).text;
          if (store.summarize(c, id, text).status !== 'published') continue;
          for (const p of app.afterDeploy.pagesOf(c, id, text)) out.add(keyOf(p, hook.origin()));
        } catch {
          // an unreadable entry has no page
        }
      }
    }
    return out;
  }

  const checked = (list) => checkRedirects(list, { origin: hook.origin(), built: built(), pages: livePages() });

  router.add('GET', '/site/redirects', async (ctx) => {
    mayManage(ctx);
    if (!config.redirects) return { on: false, canList: false, message: null, siteUrl: config.siteUrl, redirects: [] };
    const l = await repoLock.run(() => hook.list());
    return { on: true, canList: l.canList, message: l.message ?? null, more: Boolean(l.more), siteUrl: config.siteUrl, redirects: checked(l.redirects) };
  });

  /** A commit's files back as they were before it, where nobody changed them since; then one commit for it. */
  async function putBack(ctx, commit, files, log, what) {
    return repoLock.run(async () => {
      const touched = [];
      for (const rel of files) {
        if ((await git.show(commit, rel)) !== store.readRel(rel)) {
          log(`${rel} changed after it; it was not put back. Check it by hand.\n`);
          continue;
        }
        const prev = await git.show(await git.parent(commit), rel);
        if (prev === null) store.removeRel(rel);
        else store.writeRel(rel, prev);
        touched.push(rel);
      }
      const sha = await git.commit(touched, `Revert ${what}: build or deploy failed`, entries.authorOf(ctx.user));
      log(`Put back in ${sha ?? '(nothing to put back)'}.\n`);
      return 0;
    });
  }

  /** Build and deploy a redirects commit; `added`: the old addresses that must not be pages in the build. */
  function deployJob(ctx, { commit, files, added, changed, what }) {
    if (!commit || (!config.commands.build && !config.commands.deploy)) return null;
    const target = added.length ? { label: `redirect ${added[0]}`, paths: added, state: 'moved', c: null, id: null, text: null } : null;
    return jobs.enqueue({
      kind: 'redirects',
      user: ctx.user,
      target: 'redirects',
      run: async (step) => {
        await step('commit', (log) => (log(`committed ${commit}: ${files.join(', ')}\n`), 0));
        await jobs.buildAndDeploy(step, { afterBuild: app.verify.afterBuild([target]), changed });
      },
      onFail: (step) => step('revert', (log) => putBack(ctx, commit, files, log, what)),
    });
  }

  router.add('POST', '/site/redirects', async (ctx) => {
    mayManage(ctx);
    needHook();
    const { from, to, was } = ctx.body ?? {};
    const fields = {};
    const fe = badFrom(from);
    if (fe) fields.from = fe;
    const te = badTo(to);
    if (te) fields.to = te;
    if (was !== undefined && was !== null && badFrom(was)) throw badRequest('`was` must be the old address being changed.');
    if (Object.keys(fields).length) throw invalid(fields);
    const o = hook.origin();
    if (keyOf(to, o) === keyOf(from, o)) throw invalid({ to: 'That is the same address: it would point at itself.' });

    const out = await repoLock.run(async () => {
      const listed = await hook.list();
      // the list as it would be, to refuse a loop or a redirect that would never run
      const others = listed.redirects.filter((r) => keyOf(r.from, o) !== keyOf(from, o) && (!was || keyOf(r.from, o) !== keyOf(was, o)));
      const mine = checked([...others, { from, to }]).at(-1);
      const loop = mine.flags.find((f) => f.kind === 'loop');
      if (loop) throw invalid({ to: `That makes a loop: ${loop.trail.join(' → ')}.` });
      if (mine.flags.some((f) => f.kind === 'shadowed')) throw invalid({ from: `A page is at ${from}, so a redirect from it would never run. Move or unpublish that page first.` });
      const before = await git.dirty();
      const remove = was && keyOf(was, o) !== keyOf(from, o) ? [was] : [];
      const files = await hook.apply({ remove, add: [{ from, to }] }, before);
      const what = remove.length ? `redirect ${was} (now ${from} to ${to})` : `redirect ${from} to ${to}`;
      const commit = await git.commit(files, `Redirect ${from} to ${to}${remove.length ? ` (was ${was})` : ''}`, entries.authorOf(ctx.user));
      if (commit) audit.log(ctx, 'redirects.add', { target: 'redirects', detail: { from, to, was: remove[0] ?? null, commit } });
      return { commit, files, what, redirect: mine, removed: remove };
    });
    const job = deployJob(ctx, { commit: out.commit, files: out.files, added: [from], changed: [from, ...out.removed], what: out.what });
    ctx.status = job ? 202 : 200;
    return { commit: out.commit, job, redirect: out.redirect };
  });

  router.add('POST', '/site/redirects/remove', async (ctx) => {
    mayManage(ctx);
    needHook();
    const from = ctx.body?.from;
    if (!Array.isArray(from) || !from.length || from.length > MAX_REMOVE || from.some((f) => typeof f !== 'string' || f.length > 2000 || /[\u0000-\u001f]/.test(f))) {
      throw badRequest(`Give the old addresses to remove (1 to ${MAX_REMOVE}).`);
    }
    const out = await repoLock.run(async () => {
      const before = await git.dirty();
      const files = await hook.apply({ remove: from }, before);
      const commit = await git.commit(files, from.length === 1 ? `Remove the redirect from ${from[0]}` : `Remove ${from.length} redirects`, entries.authorOf(ctx.user));
      if (commit) audit.log(ctx, 'redirects.remove', { target: 'redirects', detail: { from, commit } });
      return { commit, files };
    });
    const job = deployJob(ctx, { commit: out.commit, files: out.files, added: [], changed: from, what: from.length === 1 ? `removing the redirect from ${from[0]}` : `removing ${from.length} redirects` });
    ctx.status = job ? 202 : 200;
    return { commit: out.commit, job, removed: out.commit ? from.length : 0 };
  });

  /** At most TESTS_PER_MINUTE live tests per person: each one is requests to the live site. */
  function slowDown(user) {
    if (app.cluster.hits.take('redirects.test', user.id, 60_000, TESTS_PER_MINUTE, { at: clock() })) throw new HttpError(429, 'rate-limited', 'That is a lot of tests in a minute. Wait a moment and try again.', { retryAfter: 60 });
  }

  /** Ask the live site for `from` and follow its redirects on the same site, one hop at a time. */
  /**
   * Hop by hop through the last build (QA F7): a redirect page leads to its target, a page ends it, nothing there is
   * an error. The production site is never asked from here (the owner's rule: the build or release is the proof).
   */
  function walk(from) {
    const dir = buildDir();
    if (!dir) return { error: 'There is no build to look at yet: publish once and this fills in.' };
    const site = config.siteUrl ? new URL(config.siteUrl) : null;
    const hops = [];
    const seen = new Set();
    let at = from;
    for (let i = 0; i < MAX_HOPS; i++) {
      if (seen.has(at)) return { hops, verdict: 'loop', text: `A loop: it comes back to ${at}.` };
      seen.add(at);
      const f = builtFile(dir, at);
      const next = f && isRedirectStub(f) ? stubTarget(readHead(f)) : null;
      const status = f ? 200 : 404;
      hops.push({ url: at, status, location: next, via: next ? 'page' : null });
      if (!next) {
        const verdict = hops.length === 1 ? (f ? 'page' : 'error') : f ? 'ok' : 'error';
        return { hops, verdict, status };
      }
      const url = new URL(next, site?.origin ?? 'https://site.invalid');
      if (/^[a-z][a-z0-9+.-]*:/i.test(next) && url.origin !== site?.origin) {
        hops.push({ url: url.href, status: null, location: null, via: null });
        return { hops, verdict: 'away', status: null };
      }
      at = url.pathname + url.search;
    }
    return { hops, verdict: 'long', text: `More than ${MAX_HOPS} redirects in a row.` };
  }

  router.add('POST', '/site/redirects/test', async (ctx) => {
    mayManage(ctx);
    const from = ctx.body?.from;
    const fe = badFrom(from);
    if (fe) throw invalid({ from: fe });
    slowDown(ctx.user);
    const b = built();
    let build = null;
    if (b) {
      const f = builtFile(buildDir(), from);
      const kind = b(from);
      build = { kind, to: kind === 'redirect' ? stubTarget(readHead(f)) : null };
    }
    return { from, build, live: walk(from) };
  });
}
