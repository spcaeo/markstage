// Git for the content repo, through execFile (never a shell). Every argument that comes from a request is either
// a validated repo-relative path placed after `--`, or a validated hex sha.
import { execFile } from 'node:child_process';

const SHA = /^[0-9a-f]{7,40}$/;
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, max);

export function createGit(config) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_COMMITTER_NAME: config.git.committerName,
    GIT_COMMITTER_EMAIL: config.git.committerEmail,
  };

  /** `extra`: more environment (GIT_INDEX_FILE, a fetch's ssh command); `input`: stdin; `cwd`: another work tree. */
  function git(args, { allowFail = false, extra = null, input = null, cwd = config.contentRoot } = {}) {
    return new Promise((resolve, reject) => {
      const child = execFile('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], { env: extra ? { ...env, ...extra } : env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && !allowFail) return reject(Object.assign(new Error(`git ${args[0]} failed: ${stderr || err.message}`), { stderr, code: err.code }));
        resolve({ ok: !err, code: err ? err.code : 0, stdout, stderr });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input ?? '');
    });
  }

  /**
   * Commit exactly these paths (other changes in the working copy are left alone). The author is the signed-in
   * user; the committer is the server. Returns the new sha, or null when the paths had nothing to commit.
   */
  async function commit(paths, message, author) {
    const status = await git(['status', '--porcelain', '--', ...paths]);
    if (!status.stdout.trim()) return null;
    await git(['add', '-A', '--', ...paths]);
    const who = `${clean(author.name, 100) || 'Markstage user'} <${clean(author.email, 254) || 'unknown@markstage.invalid'}>`;
    await git(['commit', '-q', `--author=${who}`, '-m', clean(message, 500) || 'Update', '--', ...paths]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  }

  /** History of one file, newest first. */
  async function log(rel, limit = 200) {
    const out = await git(['log', '--follow', `--max-count=${limit}`, '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s', '--', rel], { allowFail: true });
    if (!out.ok) return [];
    return out.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, name, email, date, message] = line.split('\x1f');
        return { sha, author: { name, email }, date, message };
      });
  }

  /** Resolve a (possibly short) sha to a full one that touched this file, or null. */
  async function resolve(rel, sha) {
    if (!SHA.test(String(sha ?? ''))) return null;
    const entries = await log(rel, 1000);
    const hits = entries.filter((e) => e.sha.startsWith(sha));
    return hits.length === 1 ? hits[0] : null;
  }

  /** The file's text at a commit (null if the file did not exist there). */
  async function show(sha, rel) {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('show needs a full sha');
    const out = await git(['show', `${sha}:${rel}`], { allowFail: true });
    return out.ok ? out.stdout : null;
  }

  async function diff(fromSha, toSha, rel) {
    const args = toSha ? ['diff', '--no-color', fromSha, toSha, '--', rel] : ['diff', '--no-color', fromSha, '--', rel];
    return (await git(args, { allowFail: true })).stdout;
  }

  /** Paths that differ from HEAD in the working copy, repo-relative -> 'new' (untracked) or 'changed'. */
  async function dirty() {
    const out = await git(['status', '--porcelain', '-z', '--untracked-files=all']);
    return new Map(out.stdout.split('\0').filter(Boolean).map((l) => [l.slice(3), l.startsWith('??') ? 'new' : 'changed']));
  }

  /** The full sha of a commit's first parent. */
  const parent = async (sha) => {
    if (!SHA.test(sha)) throw new Error('parent needs a sha');
    return (await git(['rev-parse', `${sha}^`])).stdout.trim();
  };

  const head = async () => (await git(['rev-parse', 'HEAD'], { allowFail: true })).stdout.trim() || null;

  return { git, commit, log, resolve, show, diff, head, dirty, parent };
}
