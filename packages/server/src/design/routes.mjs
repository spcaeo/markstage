// Design & Code (docs/API.md "Design & Code"): the site's stylesheets, design tokens, scripts and injected code.
//
// Everyone signed in may look; only an owner or administrator writes (roles.mjs: design.write, code.inject), and
// every write is audited. A code save is like a live entry's: it is checked (css.mjs), committed, then built, checked
// on the fresh build and deployed as one job. If any step fails the live site keeps its previous deploy, the file is
// reverted, and the attempted text becomes the person's draft, so a broken stylesheet never waits in the repo for
// the next unrelated build to ship it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseIssues } from '../content/validate.mjs';
import { runCommand } from '../jobs.mjs';
import { can } from '../roles.mjs';
import { HttpError, badRequest, conflict, forbidden, notFound, nowIso, sha1 } from '../util.mjs';
import { LIMITS, checkCode, listTokens, scanCss, setTokens } from './css.mjs';

const TOKEN_NAME = /^--[A-Za-z0-9_-]{1,100}$/;

export function createDesign(app) {
  const { config, git, jobs, repoLock, audit, db } = app;
  const files = config.design?.files ?? [];
  const authorOf = (user) => ({ name: user?.name ?? 'Markstage', email: user?.email ?? config.git.committerEmail });

  function fileOf(fid) {
    const f = files.find((x) => x.id === fid);
    if (!f) throw notFound('No such design file.');
    return f;
  }

  /** { text, version, exists }; a declared file that is not there yet reads as empty with version null. */
  function read(f) {
    try {
      if (fs.lstatSync(f.abs).isSymbolicLink()) throw forbidden(`${f.path} is a symlink; Markstage does not follow it.`);
      const text = fs.readFileSync(f.abs, 'utf8');
      return { text, version: sha1(text), exists: true };
    } catch (e) {
      if (e?.code === 'ENOENT') return { text: '', version: null, exists: false };
      throw e;
    }
  }

  /** Atomic write (temp file in the same folder, then rename); the folder was checked inside the repo at start. */
  function write(f, text) {
    fs.mkdirSync(path.dirname(f.abs), { recursive: true });
    const real = fs.realpathSync(path.dirname(f.abs));
    if (real !== path.dirname(f.abs)) throw forbidden(`${f.path}: its folder changed to a link; nothing was written.`);
    const tmp = path.join(real, `.markstage-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, f.abs);
  }

  const mayRead = (ctx) => {
    if (!can(ctx.user, 'design.read')) throw forbidden();
  };
  function mayWrite(ctx, f) {
    if (!f.editable) throw forbidden(`${f.label} is shown here read-only; change it in the site’s code.`);
    if (!can(ctx.user, f.kind.startsWith('inject') ? 'code.inject' : 'design.write')) throw forbidden('Only an owner or administrator can change the site’s code.');
  }

  // --- drafts: a person's unsaved text of one file (and a failed save's text) ------------------------------------
  function keepDraft(userId, f, baseVersion, text) {
    db.prepare(
      `INSERT INTO design_drafts (user_id, path, base_version, text, saved_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, path) DO UPDATE SET base_version = excluded.base_version, text = excluded.text, saved_at = excluded.saved_at`,
    ).run(userId, f.path, baseVersion, text, nowIso(app.clock()));
  }
  const draftOf = (userId, f) => {
    const row = db.prepare('SELECT base_version, text, saved_at FROM design_drafts WHERE user_id = ? AND path = ?').get(userId, f.path);
    return row ? { baseVersion: row.base_version, text: row.text, savedAt: row.saved_at } : null;
  };
  const dropDraft = (userId, f) => db.prepare('DELETE FROM design_drafts WHERE user_id = ? AND path = ?').run(userId, f.path);

  // --- the save job -------------------------------------------------------------------------------------------
  /** The site's post-build checks (config checks with after: 'build'), once for the whole site. */
  function siteChecks(f) {
    const post = config.checks.filter((k) => k.after === 'build');
    if (!post.length) return null;
    return async (step) => {
      for (const check of post) {
        await step(`check: ${check.label}`, async (log) => {
          let output = '';
          const { code, timedOut } = await runCommand(check.command, {
            cwd: config.contentRoot,
            env: { ...config.commands.env, MARKSTAGE_SCOPE: 'site', MARKSTAGE_FILE: f.path, MARKSTAGE_URLS: '/', MARKSTAGE_DIST: config.verify?.public ?? '' },
            timeoutSeconds: check.timeoutSeconds,
            stdin: '',
            onOutput: (s) => {
              if (output.length < 200_000) output += s;
            },
          });
          const ok = code === 0 && !timedOut;
          const issues = parseIssues(output);
          log(`${ok ? 'pass' : check.blocking ? 'FAIL' : 'warn'} the whole site\n${ok ? '' : issues.length ? issues.map((i) => `  ${i.severity}: ${i.message}`).join('\n') + '\n' : output.slice(0, 4000)}`);
          return !ok && check.blocking ? { code: 1, reason: `${check.label} on the whole site` } : 0;
        });
      }
    };
  }

  function deployJob(ctx, f, out) {
    return jobs.enqueue({
      kind: 'design',
      user: ctx.user,
      target: f.path,
      run: async (step) => {
        await step('commit', (log) => (log(`${f.path}: committed ${out.commit}\n`), 0));
        await jobs.buildAndDeploy(step, { afterBuild: siteChecks(f) });
      },
      onFail: (step) =>
        step('revert', (log) =>
          repoLock.run(async () => {
            if (read(f).version !== sha1(out.after)) {
              log(`${f.path} changed after this job started; it was not reverted. Check it by hand.\n`);
              return 0;
            }
            if (out.before === null) fs.rmSync(f.abs, { force: true });
            else write(f, out.before);
            const sha = await git.commit([f.path], `Revert ${f.path}: the change did not build or pass its checks`, authorOf(ctx.user));
            keepDraft(ctx.user.id, f, out.before === null ? null : sha1(out.before), out.after);
            log(`Reverted in ${sha ?? '(nothing to revert)'}; your text is kept as your draft.\n`);
            return 0;
          }),
        ),
    });
  }

  /** Check, write and commit a new text of `f`, then queue its build. The answer for the route. */
  async function save(ctx, f, { version, text, message, action }) {
    mayWrite(ctx, f);
    const issues = checkCode(f, text);
    if (issues.length) throw new HttpError(422, 'invalid-code', `Line ${issues[0].line}: ${issues[0].message}`, { issues });
    const out = await repoLock.run(async () => {
      const cur = read(f);
      if ((version ?? null) !== cur.version) throw conflict('This file changed since you opened it. Reload to see the latest.', { version: cur.version });
      if (cur.exists && text === cur.text) return { version: cur.version, commit: null };
      write(f, text);
      const commit = await git.commit([f.path], message, authorOf(ctx.user));
      audit.log(ctx, action, { target: f.path, detail: { commit } });
      return { version: sha1(text), commit, before: cur.exists ? cur.text : null, after: text };
    });
    dropDraft(ctx.user.id, f);
    if (!out.commit) return { ok: true, version: out.version, commit: null, job: null };
    ctx.status = 202;
    return { ok: true, version: out.version, commit: out.commit, job: deployJob(ctx, f, out) };
  }

  // --- compare sides ------------------------------------------------------------------------------------------
  async function revision(f, sha) {
    const hit = await git.resolve(f.path, sha);
    if (!hit) throw notFound('No such revision of this file.');
    return hit;
  }

  async function side(ctx, f, ref) {
    if (ref === 'current') {
      const cur = read(f);
      return { sha: null, source: cur.exists ? cur.text : null, version: cur.version };
    }
    if (ref === 'live') {
      const head = db.prepare('SELECT value FROM kv WHERE key = ?').get('deploy.head')?.value;
      if (!head) return { sha: null, source: null, deployed: false };
      return { sha: head, source: await git.show(head, f.path) };
    }
    if (ref === 'draft') {
      const d = draftOf(ctx.user.id, f);
      if (!d) throw notFound('You have no draft of this file.');
      return { sha: null, source: d.text, savedAt: d.savedAt, baseVersion: d.baseVersion };
    }
    const rev = await revision(f, ref);
    return { sha: rev.sha, source: await git.show(rev.sha, f.path) };
  }

  // --- routes -------------------------------------------------------------------------------------------------
  function routes(router) {
    router.add('GET', '/design', (ctx) => {
      mayRead(ctx);
      const canEdit = can(ctx.user, 'design.write');
      if (!files.length) return { enabled: false, canEdit, order: [], files: [] };
      return {
        enabled: true,
        canEdit,
        order: config.design.order,
        files: files.map((f) => ({ id: f.id, path: f.path, label: f.label, kind: f.kind, lang: f.lang, scope: f.scope, editable: f.editable && canEdit, exists: read(f).exists })),
      };
    });

    router.add('GET', '/design/files/:fid', (ctx) => {
      mayRead(ctx);
      const f = fileOf(ctx.params.fid);
      const cur = read(f);
      return { id: f.id, path: f.path, label: f.label, kind: f.kind, lang: f.lang, source: cur.text, version: cur.version, exists: cur.exists, editable: f.editable && can(ctx.user, 'design.write') };
    });

    router.add('PUT', '/design/files/:fid', (ctx) => {
      const f = fileOf(ctx.params.fid);
      const { version, source, message } = ctx.body;
      if (typeof source !== 'string') throw badRequest('Send the file text as source.');
      const action = f.kind.startsWith('inject') ? 'code.inject' : 'design.save';
      return save(ctx, f, { version, text: source, message: typeof message === 'string' && message.trim() ? message : `Update ${f.label} (${f.path})`, action });
    });

    router.add('GET', '/design/files/:fid/draft', (ctx) => {
      mayRead(ctx);
      return { draft: draftOf(ctx.user.id, fileOf(ctx.params.fid)) };
    });

    router.add('PUT', '/design/files/:fid/draft', (ctx) => {
      const f = fileOf(ctx.params.fid);
      mayWrite(ctx, f);
      const { baseVersion = null, source } = ctx.body;
      if (typeof source !== 'string') throw badRequest('Send the draft text as source.');
      // a draft may be half-typed CSS; only its size is checked
      if (Buffer.byteLength(source) > LIMITS.css) throw new HttpError(413, 'too-large', 'This draft is too large.');
      keepDraft(ctx.user.id, f, baseVersion, source);
      return { ok: true };
    });

    router.add('DELETE', '/design/files/:fid/draft', (ctx) => {
      dropDraft(ctx.user.id, fileOf(ctx.params.fid));
      return { ok: true };
    });

    router.add('GET', '/design/files/:fid/revisions', async (ctx) => {
      mayRead(ctx);
      return git.log(fileOf(ctx.params.fid).path);
    });

    router.add('GET', '/design/files/:fid/revisions/:sha', async (ctx) => {
      mayRead(ctx);
      const f = fileOf(ctx.params.fid);
      const rev = await revision(f, ctx.params.sha);
      return { ...rev, source: await git.show(rev.sha, f.path) };
    });

    router.add('GET', '/design/files/:fid/compare', async (ctx) => {
      mayRead(ctx);
      const f = fileOf(ctx.params.fid);
      const from = ctx.query.get('from');
      if (!from) throw badRequest('Say which version to compare from (from=<sha|live|draft|current>).');
      const to = ctx.query.get('to') || 'current';
      const a = await side(ctx, f, from);
      const b = await side(ctx, f, to);
      // git's diff when both sides are in git (the working file counts: it is HEAD between saves)
      const diff = a.sha && a.source !== null && b.source !== null && (b.sha || to === 'current') ? await git.diff(a.sha, b.sha, f.path) : null;
      return { from: a, to: b, diff };
    });

    router.add('POST', '/design/files/:fid/revisions/:sha/restore', async (ctx) => {
      const f = fileOf(ctx.params.fid);
      mayWrite(ctx, f);
      const rev = await revision(f, ctx.params.sha);
      const source = await git.show(rev.sha, f.path);
      if (source === null) throw conflict('The file did not exist in that revision.');
      return save(ctx, f, { version: ctx.body.version, text: source, message: `Restore ${f.label} to ${rev.sha.slice(0, 7)}`, action: 'design.restore' });
    });

    const tokensFile = () => {
      const f = files.find((x) => x.kind === 'tokens');
      if (!f) throw notFound('This site has no design tokens file (design.tokens in markstage.config).');
      return f;
    };

    router.add('GET', '/design/tokens', (ctx) => {
      mayRead(ctx);
      const f = tokensFile();
      const cur = read(f);
      return { id: f.id, path: f.path, version: cur.version, tokens: listTokens(cur.text), issues: scanCss(cur.text).issues, editable: can(ctx.user, 'design.write') };
    });

    router.add('PUT', '/design/tokens', (ctx) => {
      const f = tokensFile();
      mayWrite(ctx, f);
      const { version, values } = ctx.body;
      if (!Array.isArray(values) || !values.length || values.length > 200) throw badRequest('Send values: [{name, selector, context?, value}] (1 to 200).');
      for (const v of values) {
        if (!TOKEN_NAME.test(v?.name ?? '') || typeof v.selector !== 'string' || (v.context !== undefined && typeof v.context !== 'string')) throw badRequest('Each value needs a --name, its selector and the new value.');
      }
      const cur = read(f);
      if ((version ?? null) !== cur.version) throw conflict('The tokens changed since you opened them. Reload to see the latest.', { version: cur.version });
      const out = setTokens(cur.text, values);
      if (out.errors) throw new HttpError(422, 'invalid', out.errors[0].message, { errors: out.errors });
      const names = [...new Set(values.map((v) => v.name))];
      return save(ctx, f, { version, text: out.text, message: `Design tokens: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''}`, action: 'design.tokens' });
    });
  }

  /**
   * The unsaved stylesheets a preview state carries, {fileId: text} -> {repoPath: text} (owner/administrator only).
   * Half-typed CSS is fine here: the preview shows what the person typed, and only the size is checked.
   */
  function unsaved(ctx, css) {
    if (css === undefined || css === null) return null;
    if (typeof css !== 'object' || Array.isArray(css)) throw badRequest('css must be { fileId: text }.');
    const out = {};
    for (const [fid, text] of Object.entries(css)) {
      const f = fileOf(fid);
      mayWrite(ctx, f);
      if (f.lang !== 'css') throw badRequest(`${f.label} is not a stylesheet.`);
      if (typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.css) throw badRequest(`${f.label}: send its text (at most ${LIMITS.css / 1024} KB).`);
      out[f.path] = text;
    }
    return out;
  }

  return { routes, unsaved, files };
}
