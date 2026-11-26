// The head kit's settings (docs/HEAD-KIT.md "The settings screens and API"): the one JSON file the editor's Site
// settings → Search & AI and Tracking write (`head.file` in markstage.config, default src/site/head.json).
//
// Everyone who may look at the design may read it; only an owner or administrator writes (roles.mjs head.write), and
// every write is audited. A save is checked by core's readHead (the same checks the build and the editor use), written
// in the content repo, committed as the person and followed by the build and deploy job a design save starts. If that
// job fails the file goes back to what it was, so a setting the build cannot use never waits in the repo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isInside, realish } from '../config.mjs';
import { can } from '../roles.mjs';
import { HttpError, badRequest, conflict, forbidden, notFound, sha1 } from '../util.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createHead(app) {
  const { config, git, jobs, repoLock, audit } = app;
  const cfg = config.head;
  const authorOf = (user) => ({ name: user?.name ?? 'Markstage', email: user?.email ?? config.git.committerEmail });
  // core's checks, loaded when first needed (the same readHead the build and the editor use)
  let corePromise = null;
  const core = () => (corePromise ??= import('@markstage/core/head'));

  /** The settings file's guards, checked at each use: not a link, inside the repo, never in .git. */
  function guard() {
    try {
      if (fs.lstatSync(cfg.absFile).isSymbolicLink()) throw forbidden(`${cfg.file} is a link; Markstage does not follow it.`);
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
    }
    const real = realish(cfg.absFile);
    if (!isInside(config.contentRoot, real) || real === realish(config.contentRoot)) throw forbidden(`${cfg.file} is outside the site’s repository.`);
    if (isInside(path.join(config.contentRoot, '.git'), real)) throw forbidden(`${cfg.file} is inside .git.`);
  }

  /** { text, version, exists }; a file that is not there yet reads as empty, version null. */
  function read() {
    guard();
    try {
      const text = fs.readFileSync(cfg.absFile, 'utf8');
      return { text, version: sha1(text), exists: true };
    } catch (e) {
      if (e?.code === 'ENOENT') return { text: '', version: null, exists: false };
      throw e;
    }
  }

  /** Atomic write: a temp file in the same folder, then a rename. */
  function write(text) {
    guard();
    const dir = path.dirname(cfg.absFile);
    fs.mkdirSync(dir, { recursive: true });
    const real = fs.realpathSync(dir);
    if (!isInside(config.contentRoot, real)) throw forbidden(`${cfg.file}: its folder is outside the site’s repository; nothing was written.`);
    const tmp = path.join(real, `.markstage-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, cfg.absFile);
  }

  /** The file's JSON: { raw, issues } (raw null when it does not exist; a file that is not JSON says so). */
  function parse(cur) {
    if (!cur.exists) return { raw: null, parseIssue: null };
    try {
      return { raw: JSON.parse(cur.text), parseIssue: null };
    } catch {
      return { raw: null, parseIssue: { path: '', message: `${cfg.file} is not valid JSON. Saving here replaces it with your settings.` } };
    }
  }

  const collectionList = () => config.collections.map((c) => ({ id: c.id, label: c.label }));
  const mayRead = (ctx) => {
    if (!can(ctx.user, 'design.read')) throw forbidden();
  };
  const needHead = () => {
    if (!cfg) throw notFound('This site does not use the head settings (head in markstage.config).');
  };

  /** A plain commit message for what changed: "Site settings: search and AI" / "tracking" / both. */
  function messageOf(before, after) {
    const part = (k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k] ?? null);
    const names = [];
    if (part('markdown') || part('feeds')) names.push('search and AI');
    if (part('tracking')) names.push('tracking');
    return `Site settings: ${names.join(' and ') || 'head'}`;
  }

  function deployJob(ctx, out) {
    return jobs.enqueue({
      kind: 'design',
      user: ctx.user,
      target: cfg.file,
      run: async (step) => {
        await step('commit', (log) => (log(`${cfg.file}: committed ${out.commit}\n`), 0));
        await jobs.buildAndDeploy(step);
      },
      onFail: (step) =>
        step('revert', (log) =>
          repoLock.run(async () => {
            if (read().version !== sha1(out.after)) {
              log(`${cfg.file} changed after this job started; it was not reverted. Check it by hand.\n`);
              return 0;
            }
            if (out.before === null) fs.rmSync(cfg.absFile, { force: true });
            else write(out.before);
            const sha = await git.commit([cfg.file], `Revert ${cfg.file}: the change did not build`, authorOf(ctx.user));
            log(`Reverted in ${sha ?? '(nothing to revert)'}.\n`);
            return 0;
          }),
        ),
    });
  }

  async function save(ctx, { version, settings }) {
    if (!can(ctx.user, 'head.write')) throw forbidden('Only an owner or administrator can change these settings.');
    if (!isObj(settings)) throw badRequest('Send the settings as an object: { markdown, feeds, tracking }.');
    const { readHead } = await core();
    const { issues } = readHead(settings, { collections: config.collections.map((c) => c.id) });
    if (issues.length) throw new HttpError(422, 'invalid', issues[0].message, { issues });
    const text = `${JSON.stringify(settings, null, 2)}\n`;
    const out = await repoLock.run(async () => {
      const cur = read();
      if ((version ?? null) !== cur.version) throw conflict('These settings changed since you opened them. Reload to see the latest.', { version: cur.version });
      if (cur.exists && text === cur.text) return { version: cur.version, commit: null };
      const before = parse(cur).raw;
      write(text);
      const commit = await git.commit([cfg.file], messageOf(before, settings), authorOf(ctx.user));
      audit.log(ctx, 'head.write', { target: cfg.file, detail: { commit } });
      return { version: sha1(text), commit, before: cur.exists ? cur.text : null, after: text };
    });
    if (!out.commit) return { ok: true, version: out.version, commit: null, job: null };
    ctx.status = 202;
    return { ok: true, version: out.version, commit: out.commit, job: deployJob(ctx, out) };
  }

  function routes(router) {
    router.add('GET', '/head', async (ctx) => {
      mayRead(ctx);
      const canEdit = can(ctx.user, 'head.write');
      if (!cfg) return { enabled: false, canEdit };
      const { readHead, TRACKERS, GTM_LOADS } = await core();
      const cur = read();
      const { raw, parseIssue } = parse(cur);
      const checked = readHead(raw, { collections: config.collections.map((c) => c.id) });
      return {
        enabled: true,
        canEdit,
        file: cfg.file,
        version: cur.version,
        settings: raw,
        head: checked.head,
        issues: parseIssue ? [parseIssue, ...checked.issues] : checked.issues,
        collections: collectionList(),
        // the pattern as the source of a regular expression, so the editor checks an ID as it is typed the way the build will
        trackers: Object.entries(TRACKERS).map(([id, t]) => ({ id, label: t.label, hint: t.hint, example: t.example, pattern: t.pattern.source })),
        gtmLoads: GTM_LOADS,
      };
    });

    router.add('PUT', '/head', (ctx) => {
      needHead();
      return save(ctx, { version: ctx.body.version, settings: ctx.body.settings });
    });
  }

  return { routes };
}
