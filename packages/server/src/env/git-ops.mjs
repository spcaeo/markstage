// Git for Environments: the remote all environments share, the branches on it, what a branch would bring, a dry
// merge that touches no working copy, and the merge commit made from a plan's chosen resolutions. Everything runs
// through the content repo's git (content/git.mjs: execFile, never a shell). Branch names are checked (isBranch)
// and every sha is full hex before it reaches git.
import fs from 'node:fs';
import path from 'node:path';
import { isBranch } from './config.mjs';

const FULL = /^[0-9a-f]{40}$/;
const STATUS = { A: 'added', M: 'changed', D: 'removed', R: 'renamed', C: 'added', T: 'changed' };

export function createGitOps(app) {
  const { config } = app;
  const env = config.environment;
  const g = (args, o) => app.git.git(args, o);
  const kv = (k, v) => app.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  const kvGet = (k) => app.db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value ?? null;
  const tmpDir = path.join(config.dataDir, 'env', 'tmp');

  const remoteRef = (branch) => {
    if (!isBranch(branch)) throw new Error(`"${branch}" is not a branch name.`);
    return `refs/remotes/${env.remote}/${branch}`;
  };

  /** The full sha of a ref, or null. */
  async function sha(ref) {
    const r = await g(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true });
    const s = r.stdout.trim();
    return r.ok && FULL.test(s) ? s : null;
  }

  /** The branch this server runs (environment.branch, else the one checked out). */
  async function branch() {
    if (env.branch) return env.branch;
    const r = await g(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true });
    return r.stdout.trim() || 'main';
  }

  async function hasRemote() {
    return (await g(['remote', 'get-url', env.remote], { allowFail: true })).ok;
  }

  /** Fetch the shared remote; how it went is kept for GET env ({ok, lastFetchAt, error}). */
  async function fetch() {
    const at = new Date(app.clock()).toISOString();
    if (!(await hasRemote())) {
      const error = `This repo has no remote named "${env.remote}" (environment.remote).`;
      kv('env.fetch', JSON.stringify({ ok: false, lastFetchAt: at, error }));
      return { ok: false, error };
    }
    const r = await g(['fetch', '--prune', '--quiet', env.remote], { allowFail: true, extra: { GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' } });
    const out = { ok: r.ok, lastFetchAt: at, error: r.ok ? null : r.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300) || 'git fetch failed' };
    kv('env.fetch', JSON.stringify(out));
    return out;
  }
  const lastFetch = () => JSON.parse(kvGet('env.fetch') ?? 'null') ?? { ok: null, lastFetchAt: null, error: null };

  /** The branches on the remote: [{name, sha, at, author, subject}], newest first. */
  async function branches() {
    const r = await g(['for-each-ref', '--sort=-committerdate', '--format=%(refname)%1f%(objectname)%1f%(committerdate:iso-strict)%1f%(authorname)%1f%(subject)', `refs/remotes/${env.remote}/`], { allowFail: true });
    const prefix = `refs/remotes/${env.remote}/`;
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [ref, s, at, author, subject] = l.split('\x1f');
        return { name: ref.slice(prefix.length), sha: s, at, author, subject };
      })
      .filter((b) => b.name !== 'HEAD' && isBranch(b.name));
  }

  /** Commits `b` has that `a` has not (ahead) and the other way round (behind), as seen from `a`. */
  async function counts(a, b) {
    if (!a || !b) return { ahead: null, behind: null };
    const r = await g(['rev-list', '--left-right', '--count', `${a}...${b}`], { allowFail: true });
    const [behind, ahead] = r.stdout.trim().split(/\s+/).map(Number);
    return r.ok ? { ahead: behind, behind: ahead } : { ahead: null, behind: null };
  }

  const mergeBase = async (a, b) => {
    const r = await g(['merge-base', a, b], { allowFail: true });
    return FULL.test(r.stdout.trim()) ? r.stdout.trim() : null;
  };

  const isAncestor = async (a, b) => (await g(['merge-base', '--is-ancestor', a, b], { allowFail: true })).ok;

  /** The files that differ from `from` to `to`: [{path, status: added|changed|removed|renamed, from?}]. */
  async function changes(from, to) {
    const r = await g(['diff', '--name-status', '-z', '-M', '--no-color', from, to]);
    const parts = r.stdout.split('\0');
    const out = [];
    for (let i = 0; i < parts.length - 1; ) {
      const code = parts[i++];
      if (!code) continue;
      const kind = STATUS[code[0]] ?? 'changed';
      if (code[0] === 'R' || code[0] === 'C') {
        const before = parts[i++];
        out.push({ path: parts[i++], status: kind, from: code[0] === 'R' ? before : undefined });
      } else out.push({ path: parts[i++], status: kind });
    }
    return out;
  }

  /** The last commit on `range` that touched `rel`: {name, at} or null. */
  async function lastTouch(range, rel) {
    const r = await g(['log', '-1', '--format=%an%x1f%aI', range, '--', rel], { allowFail: true });
    const [name, at] = r.stdout.trim().split('\x1f');
    return name ? { name, at } : null;
  }

  /**
   * A merge with no working copy (git merge-tree): {tree, conflicts: [{path, base, ours, theirs}]} where each side
   * is the blob id or null (the file is gone on that side).
   */
  async function dryMerge(ours, theirs) {
    const r = await g(['merge-tree', '--write-tree', '-z', '--no-messages', ours, theirs], { allowFail: true });
    if (!r.ok && r.code !== 1) throw new Error(`git merge-tree failed: ${r.stderr.trim()}`);
    const parts = r.stdout.split('\0');
    const tree = parts[0];
    const byPath = new Map();
    for (const p of parts.slice(1)) {
      const m = /^(\d+) ([0-9a-f]{40}) ([123])\t(.+)$/s.exec(p);
      if (!m) continue;
      const c = byPath.get(m[4]) ?? { path: m[4], base: null, ours: null, theirs: null };
      c[{ 1: 'base', 2: 'ours', 3: 'theirs' }[m[3]]] = m[2];
      byPath.set(m[4], c);
    }
    return { tree, clean: r.ok, conflicts: [...byPath.values()] };
  }

  /** A blob's text (or a file's text at a commit: `<sha>:<path>`), or null. */
  async function text(spec) {
    if (!spec) return null;
    const r = await g(['cat-file', '-p', spec], { allowFail: true });
    return r.ok ? r.stdout : null;
  }

  /**
   * Make the merge commit of `ours` and `theirs` from the dry merge's tree with the chosen texts in place
   * (`resolutions`: [{path, text}] where text null removes the file). Nothing is checked out; returns its sha.
   */
  async function commitMerge({ ours, theirs, tree, resolutions = [], message, author }) {
    fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    const index = path.join(tmpDir, `index-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const extra = { GIT_INDEX_FILE: index };
    try {
      await g(['read-tree', tree], { extra });
      for (const r of resolutions) {
        if (r.text === null) {
          await g(['update-index', '--force-remove', '--', r.path], { extra });
          continue;
        }
        const blob = (await g(['hash-object', '-w', '--stdin'], { input: r.text })).stdout.trim();
        await g(['update-index', '--add', '--cacheinfo', `100644,${blob},${r.path}`], { extra });
      }
      const final = (await g(['write-tree'], { extra })).stdout.trim();
      const who = { GIT_AUTHOR_NAME: author?.name || 'Markstage', GIT_AUTHOR_EMAIL: author?.email || 'markstage@localhost' };
      return (await g(['commit-tree', final, '-p', ours, '-p', theirs, '-m', message], { extra: who })).stdout.trim();
    } finally {
      fs.rmSync(index, { force: true });
    }
  }

  /** A commit on top of `parent` whose files are exactly those of `like` (a rollback: the branch equals what is live). */
  async function commitLike({ parent, like, message, author }) {
    const who = { GIT_AUTHOR_NAME: author?.name || 'Markstage', GIT_AUTHOR_EMAIL: author?.email || 'markstage@localhost' };
    return (await g(['commit-tree', `${like}^{tree}`, '-p', parent, '-m', message], { extra: who })).stdout.trim();
  }

  /**
   * A throwaway work tree of `sha` (in the data dir, outside the content repo), with the site's node_modules linked
   * in so its build runs. `done()` removes it.
   */
  async function worktree(sha) {
    if (!FULL.test(sha)) throw new Error('worktree needs a full sha');
    const base = path.join(config.dataDir, 'env', 'work');
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    const dir = fs.mkdtempSync(path.join(base, 'w-'));
    await g(['worktree', 'add', '--detach', '--force', dir, sha]);
    const nm = path.join(config.contentRoot, 'node_modules');
    if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, 'node_modules'), 'dir');
    return {
      dir,
      done: async () => {
        await g(['worktree', 'remove', '--force', dir], { allowFail: true });
        fs.rmSync(dir, { recursive: true, force: true });
        await g(['worktree', 'prune'], { allowFail: true });
      },
    };
  }

  /** Push a sha to a branch on the remote (fast-forward only unless the caller says so). */
  async function push(sha, to) {
    if (!FULL.test(sha)) throw new Error('push needs a full sha');
    if (!isBranch(to)) throw new Error(`"${to}" is not a branch name.`);
    return g(['push', '--porcelain', env.remote, `${sha}:refs/heads/${to}`], { allowFail: true, extra: { GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' } });
  }

  return { sha, branch, remoteRef, hasRemote, fetch, lastFetch, branches, counts, mergeBase, isAncestor, changes, lastTouch, dryMerge, text, commitMerge, commitLike, worktree, push };
}
