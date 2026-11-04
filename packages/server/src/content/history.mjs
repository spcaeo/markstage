// Revisions (git history per file: list, show, compare, restore as a new revision) and content checks (the site's
// own check commands, run on the saved or unsaved text).
import { runCommand } from '../jobs.mjs';
import { badRequest, flag, notFound } from '../util.mjs';
import { entryEnv, parseIssues } from './validate.mjs';

export function historyRoutes(router, app, entries) {
  const { store, git, converter, config } = app;
  const coll = (ctx) => store.collection(ctx.params.c);

  /** The entry's repo path; the file may be gone (trashed) but its history is still readable. */
  const relOf = (c, id) => store.rel(store.fileOf(c, id, { mustExist: false }));

  async function revision(c, id, sha) {
    const hit = await git.resolve(relOf(c, id), sha);
    if (!hit) throw notFound('No such revision of this entry.');
    return hit;
  }

  router.add('GET', '/collections/:c/entries/:id/revisions', async (ctx) => {
    const c = coll(ctx);
    const list = await git.log(relOf(c, ctx.params.id));
    if (!list.length && !store.exists(c, ctx.params.id)) throw notFound('No such entry.');
    return list;
  });

  router.add('GET', '/collections/:c/entries/:id/revisions/:sha', async (ctx) => {
    const c = coll(ctx);
    const rev = await revision(c, ctx.params.id, ctx.params.sha);
    const source = await git.show(rev.sha, relOf(c, ctx.params.id));
    if (source === null) return { sha: rev.sha, source: null, deleted: true };
    let parsed = {};
    try {
      parsed = entries.parse(c, source);
    } catch {
      // an old revision that no longer parses is still shown as source
    }
    return { ...rev, source, ...(c.format === 'md' ? { doc: parsed.doc } : { data: parsed.data }) };
  });

  /**
   * One side of a compare: a revision sha, `current` (the file now), `live` (the entry as the last deploy built it:
   * null when it was not live then, or nothing was ever deployed) or `autosave:<id>` (one of the caller's own
   * autosave snapshots). `commit` is the git commit to diff from, when there is one.
   */
  async function side(ctx, c, id, ref) {
    const rel = relOf(c, id);
    if (ref === 'current') {
      const cur = store.read(c, id);
      return { sha: 'current', source: cur.text, version: cur.version, commit: null };
    }
    if (ref === 'live') {
      const head = app.db.prepare("SELECT value FROM kv WHERE key = 'deploy.head'").get()?.value ?? null;
      if (!head) return { sha: 'live', source: null, deployed: false, commit: null };
      const text = await git.show(head, rel);
      // the build leaves drafts and future posts out: their text at the live commit is not on the site
      const on = text !== null && (store.summarize(c, id, text).status ?? 'published') === 'published';
      return { sha: 'live', source: on ? text : null, deployed: true, commit: on ? head : null };
    }
    if (ref.startsWith('autosave:')) {
      if (!app.autosaves) throw notFound('No autosave history on this server.');
      const { row, text } = await app.autosaves.get(ctx.user.id, c, id, ref.slice('autosave:'.length));
      return { sha: ref, source: text, savedAt: row.saved_at, commit: null, text: true };
    }
    const rev = await revision(c, id, ref);
    return { sha: rev.sha, source: await git.show(rev.sha, rel), commit: rev.sha };
  }

  router.add('GET', '/collections/:c/entries/:id/compare', async (ctx) => {
    const c = coll(ctx);
    const rel = relOf(c, ctx.params.id);
    const from = await side(ctx, c, ctx.params.id, ctx.query.get('from') ?? '');
    const to = await side(ctx, c, ctx.params.id, ctx.query.get('to') ?? 'current');
    // git's own diff between two commits, or a commit and the file; none when a side is not in git (an autosave)
    const gitSide = (s) => s.commit ?? (s.sha === 'current' ? null : undefined);
    const a = gitSide(from);
    const b = gitSide(to);
    const diff = a && b !== undefined && from.source !== null && to.source !== null ? await git.diff(a, b, rel) : null;
    // docs=1: each side parsed too (the rendered side-by-side compare and block restore need the documents)
    const docs = flag(ctx.query, 'docs');
    const clean = ({ commit: _c, text: _t, ...rest }) => (docs ? { ...rest, ...parsed(c, rest.source) } : rest);
    return { from: clean(from), to: clean(to), diff };
  });

  /** { doc, frontmatter } (md) or { data } (json) of a text; null when there is no text or it no longer parses. */
  function parsed(c, source) {
    const empty = c.format === 'md' ? { doc: null, frontmatter: null } : { data: null };
    if (source === null) return empty;
    try {
      const p = entries.parse(c, source);
      return c.format === 'md' ? { doc: p.doc ?? null, frontmatter: store.fieldsOf(c, source) } : { data: p.data ?? null };
    } catch {
      return empty;
    }
  }

  // restore = write the old text as a new commit; the entry keeps its current status (restoring never publishes)
  router.add('POST', '/collections/:c/entries/:id/revisions/:sha/restore', async (ctx) => {
    const c = coll(ctx);
    const rev = await revision(c, ctx.params.id, ctx.params.sha);
    const old = await git.show(rev.sha, relOf(c, ctx.params.id));
    if (old === null) throw badRequest('The entry did not exist in that revision.');
    const out = await entries.saveEntry(ctx, c, ctx.params.id, {
      version: ctx.body.version,
      message: `Restore ${c.id}/${ctx.params.id} to ${rev.sha.slice(0, 7)}`,
      action: 'revision.restore',
      build: (cur) => ({ text: keepStatus(c, old, store.fieldsOf(c, cur.text)) }),
    });
    return { ok: true, version: out.version, commit: out.commit };
  });

  // an autosave snapshot (the caller's own) written as a new revision, the same way
  router.add('POST', '/collections/:c/entries/:id/autosaves/:aid/restore', async (ctx) => {
    const c = coll(ctx);
    if (!app.autosaves) throw notFound('No autosave history on this server.');
    const { row, text } = await app.autosaves.get(ctx.user.id, c, ctx.params.id, ctx.params.aid);
    const out = await entries.saveEntry(ctx, c, ctx.params.id, {
      version: ctx.body.version,
      message: `Restore ${c.id}/${ctx.params.id} to the autosave of ${row.saved_at}`,
      action: 'autosave.restore',
      build: (cur) => ({ text: keepStatus(c, text, store.fieldsOf(c, cur.text)) }),
    });
    return { ok: true, version: out.version, commit: out.commit };
  });

  /** The old text with the current status and protection keys (restoring never publishes or unprotects). */
  function keepStatus(c, text, current) {
    const keys = { protected: current.protected === true ? true : null };
    if (c.hasStatus) Object.assign(keys, { draft: current.draft === true ? true : null, publishAt: current.publishAt ?? null });
    if (c.format === 'md') return converter.setFrontmatter(text, keys);
    return converter.applyJsonChanges(text, Object.entries(keys).map(([path, value]) => (value === null ? { path, delete: true } : { path, value })), c);
  }

  // --- content checks --------------------------------------------------------------------------------------------

  router.add('GET', '/checks', () => config.checks.map(({ id, label, blocking, after }) => ({ id, label, blocking, after })));

  router.add('POST', '/collections/:c/entries/:id/checks', async (ctx) => {
    const c = coll(ctx);
    const file = store.read(c, ctx.params.id);
    const body = ctx.body;
    const unsaved = body.doc !== undefined || body.frontmatter !== undefined || body.source !== undefined || body.data !== undefined || body.changes !== undefined;
    const text = unsaved ? entries.textFromBody(c, file.text, body).text : file.text;
    return runChecks(c, ctx.params.id, text);
  });

  /** Run every configured check on `text`; `ok` is false when a blocking check failed. */
  async function runChecks(c, id, text, log = null) {
    const results = [];
    for (const check of config.checks.filter((k) => !k.after)) {
      let output = '';
      const { code, timedOut } = await runCommand(check.command, {
        cwd: config.contentRoot,
        env: entryEnv(config, c, id),
        timeoutSeconds: check.timeoutSeconds,
        stdin: text,
        onOutput: (s) => {
          if (output.length < 200_000) output += s;
        },
      });
      // JSON issues when the check prints them; plain-text output is shown as is
      const issues = parseIssues(output);
      const ok = code === 0 && !timedOut;
      results.push({ id: check.id, label: check.label, blocking: check.blocking, ok, issues, output: output.slice(0, 20_000) });
      if (log) log(`${ok ? 'pass' : 'FAIL'} ${check.label}${check.blocking ? '' : ' (warning only)'}\n${ok ? '' : output.slice(0, 4000)}`);
    }
    return { ok: results.every((r) => r.ok || !r.blocking), results };
  }

  return { runChecks, keepStatus };
}
