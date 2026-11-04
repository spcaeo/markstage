// The site's redirects hook (markstage.config `redirects: {command}`), the one place the server talks to it. The site
// keeps its redirects in its own format (a JSON map, _redirects, a framework config); the hook reads and writes them.
// Argv, no shell, run in the site repo, one JSON line on stdin:
//   {"redirects": [{from, to}]}            add these, or change the new address of a `from` already there; exit 0
//   {"action": "list"}                     print {"redirects": [{from, to, status?}]} on stdout; exit 0; change nothing
//   {"action": "remove", "from": [...]}    remove the redirects from these addresses; exit 0
// A hook that only adds (the first form) still records moves; the Redirects screen then says it cannot list.
// Whatever files the hook changes are found with git (what is dirty after it and was not before), and every one of
// them must be inside the repo; when it fails, its changes are undone.
import path from 'node:path';
import { isInside } from '../config.mjs';
import { runCommand } from '../jobs.mjs';
import { HttpError } from '../util.mjs';
import { badFrom, keyOf } from './check.mjs';

const MAX_LIST = 20_000;
const STATUSES = [301, 302, 303, 307, 308];

/** The JSON a hook printed: the whole output, or else its last line (a hook may log before it answers). */
function parseAnswer(stdout) {
  const t = stdout.trim();
  for (const s of [t, t.split('\n').at(-1)]) {
    try {
      return JSON.parse(s);
    } catch {
      // not this one
    }
  }
  return null;
}

/** What a failed hook said, as sentences: its {issues: [{message}]} when it answered that way, else its last words. */
function said(output) {
  const a = parseAnswer(output);
  const issues = Array.isArray(a?.issues) ? a.issues.map((i) => (typeof i === 'string' ? i : i?.message)).filter((m) => typeof m === 'string' && m.trim()) : [];
  if (issues.length) return issues.map((m) => m.trim().replace(/[.]?$/, '.')).join(' ');
  return output.trim().slice(-500);
}

export function createRedirectsHook(app) {
  const { config, git, store } = app;
  const origin = () => (config.siteUrl ? new URL(config.siteUrl).origin : null);

  async function call(payload) {
    let output = '';
    let stdout = '';
    const { code, timedOut } = await runCommand(config.redirects.command, {
      cwd: config.contentRoot,
      env: { ...config.commands.env },
      timeoutSeconds: config.redirects.timeoutSeconds,
      stdin: `${JSON.stringify(payload)}\n`,
      onStdout: (s) => {
        if (stdout.length < 8_000_000) stdout += s;
      },
      onOutput: (s) => {
        if (output.length < 20_000) output += s;
      },
    });
    return { ok: code === 0 && !timedOut, timedOut, output, stdout };
  }

  /** The repo files that changed since `before` (a git.dirty() map): [[rel, 'new'|'changed']]. */
  async function changedSince(before) {
    const changed = [...(await git.dirty())].filter(([p]) => !before.has(p));
    for (const [p] of changed) {
      if (!isInside(config.contentRoot, path.resolve(config.contentRoot, p)) || p.split('/')[0] === '.git') throw new Error(`The redirects hook wrote outside the repo: ${p}`);
    }
    return changed;
  }

  /** Put the repo back: changes to tracked files reverted, new files removed. */
  async function undo(changed) {
    const tracked = changed.filter(([, k]) => k === 'changed').map(([p]) => p);
    if (tracked.length) await git.git(['checkout', '--', ...tracked]);
    for (const [p, k] of changed) if (k === 'new') store.removeRel(p);
  }

  /**
   * The site's redirects: {canList, redirects: [{from, to, status}], message}. Changes nothing: a hook that writes
   * files when asked for its list has them undone. The caller holds the repo lock.
   */
  async function list() {
    if (!config.redirects) return { canList: false, redirects: [], message: 'This site has no redirects hook (redirects in markstage.config).' };
    const before = await git.dirty();
    const r = await call({ action: 'list' });
    const changed = await changedSince(before);
    if (changed.length) {
      await undo(changed);
      return { canList: false, redirects: [], message: 'The site’s redirects hook changed files when asked for its list, so that was undone. It needs to answer {"action":"list"} (docs/API.md, “The redirects hook”).' };
    }
    const rows = r.ok ? parseAnswer(r.stdout)?.redirects : null;
    if (!Array.isArray(rows)) {
      return { canList: false, redirects: [], message: `The site’s redirects hook records moves but cannot list its redirects yet: it needs to answer {"action":"list"} (docs/API.md, “The redirects hook”).${r.ok ? '' : ` It said: ${r.output.trim().slice(-300)}`}` };
    }
    const redirects = rows
      .filter((x) => x && typeof x.from === 'string' && typeof x.to === 'string')
      .slice(0, MAX_LIST)
      .map((x) => ({ from: x.from, to: x.to, status: STATUSES.includes(x.status) ? x.status : null }));
    return { canList: true, redirects, more: rows.length > MAX_LIST };
  }

  /**
   * Remove, then add (in that order, so a changed old address works); returns the repo files changed since `before`.
   * On a failure every change since `before` is undone and a 502 says what the hook said; `nothing` ends its first
   * sentence ("nothing was moved"). The caller holds the repo lock.
   */
  async function apply({ remove = [], add = [] }, before, nothing = 'nothing was changed') {
    if (!config.redirects || (!remove.length && !add.length)) return [];
    for (const payload of [remove.length ? { action: 'remove', from: remove } : null, add.length ? { redirects: add } : null]) {
      if (!payload) continue;
      const r = await call(payload);
      if (!r.ok) {
        await undo(await changedSince(before));
        throw new HttpError(502, 'redirects-failed', `The site's redirects hook failed${r.timedOut ? ' (timeout)' : ''}; ${nothing}. ${said(r.output)}`.trim());
      }
    }
    return (await changedSince(before)).map(([p]) => p);
  }

  /**
   * A move's redirects (old -> new, every locale), recorded without making chains or loops: redirects that pointed at
   * an old address now point at its new one, and one away from a new address goes (a page is there again). Needs a
   * hook that lists; one that only adds records the moves alone. Returns {files, repointed, removed}.
   */
  async function recordMove(redirects, before) {
    if (!config.redirects || !redirects.length) return { files: [], repointed: [], removed: [] };
    const o = origin();
    const listed = await list();
    const now = listed.canList ? listed.redirects : [];
    const newTo = new Map(redirects.map((r) => [keyOf(r.from, o), r.to]));
    const arrived = new Set(redirects.map((r) => keyOf(r.to, o)));
    const removed = now.filter((r) => arrived.has(keyOf(r.from, o)) && !badFrom(r.from)).map((r) => r.from);
    const gone = new Set(removed.map((f) => keyOf(f, o)));
    const moving = new Set(newTo.keys());
    const repointed = now
      .filter((r) => newTo.has(keyOf(r.to, o)) && !gone.has(keyOf(r.from, o)) && !moving.has(keyOf(r.from, o)))
      .map((r) => ({ from: r.from, to: newTo.get(keyOf(r.to, o)) }));
    const files = await apply({ remove: removed, add: [...redirects, ...repointed] }, before, 'nothing was moved');
    return { files, repointed, removed };
  }

  return { list, apply, recordMove, origin };
}
