#!/usr/bin/env node
// markstage-deploy: atomic release switch for a static build. Use it as the server's `commands.deploy`.
//   markstage-deploy --to /srv/site [--from dist] [--private dist-private] [--keep 5] [-- <after-switch command>]
//   markstage-deploy rollback --to /srv/site [-- <after-switch command>]
//
// The after-switch command (argv, no shell) runs once `current` points at the new release, e.g.
// `-- sudo -n /usr/sbin/nginx -s reload` when the build emits nginx files (maps are read only at reload). If it
// fails, `current` goes back to the release before and the deploy fails, so the site never runs new pages with old
// server rules.
//
// Layout under --to:
//   releases/<id>/public    the public build (the web server's root is current/public)
//   releases/<id>/private   protected pages (Markstage's protectedPages.dir is <to>/current/private)
//   releases/<id>/release.json
//   current -> releases/<id>   (relative symlink, switched by rename(2): readers see the old or the new release,
//                               never a half-copied one)
// A failure before the switch leaves `current` as it was, so a failed deploy changes nothing that visitors see.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = 'Usage: markstage-deploy --to /srv/site [--from dist] [--private dist-private] [--keep 5] [-- command]\n       markstage-deploy rollback --to /srv/site [-- command]';

export function parseArgs(argv) {
  const opts = { cmd: 'deploy', from: 'dist', private: 'dist-private', keep: 5, to: null, after: [] };
  const split = argv.indexOf('--');
  const rest = split < 0 ? [...argv] : argv.slice(0, split);
  if (split >= 0) opts.after = argv.slice(split + 1);
  if (split >= 0 && !opts.after.length) throw new Error(`Nothing after "--".\n${USAGE}`);
  if (rest[0] === 'rollback') opts.cmd = rest.shift();
  while (rest.length) {
    const flag = rest.shift();
    const value = rest.shift();
    if (!['--to', '--from', '--private', '--keep'].includes(flag) || value === undefined) throw new Error(USAGE);
    opts[flag.slice(2)] = flag === '--keep' ? Number(value) : value;
  }
  if (!opts.to || !path.isAbsolute(opts.to)) throw new Error(`--to must be an absolute path.\n${USAGE}`);
  if (!Number.isInteger(opts.keep) || opts.keep < 2) throw new Error('--keep must be 2 or more (the current release and one to roll back to).');
  return opts;
}

const releasesOf = (to) => {
  const dir = path.join(to, 'releases');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => RELEASE.test(n)).sort() : [];
};

// release ids sort by time: 20261028T141500123Z-a1b2c3 (UTC to the millisecond), always newer than the last one
const RELEASE = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(\d{3})Z-[0-9a-f]{6}$/;
const msOf = (id) => {
  const [, y, mo, d, h, mi, s, ms] = RELEASE.exec(id);
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`);
};
function newReleaseId(to) {
  const last = releasesOf(to).at(-1);
  const ms = Math.max(Date.now(), last ? msOf(last) + 1 : 0);
  return `${new Date(ms).toISOString().replace(/[-:.]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
}

const currentOf = (to) => {
  try {
    return path.basename(fs.readlinkSync(path.join(to, 'current')));
  } catch {
    return null;
  }
};

/**
 * The web server runs as another user, so a release must be world-readable: dirs 0755, files 0644. (Markstage
 * itself runs with umask 077 to keep its data dir private, and builds inherit that, so the build output is 0600.)
 */
function makeReadable(dir) {
  fs.chmodSync(dir, 0o755);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) makeReadable(p);
    else if (e.isFile()) fs.chmodSync(p, 0o644);
  }
}

/** Point `current` at a release with one rename, so the switch is atomic. */
function switchTo(to, id) {
  const tmp = path.join(to, `.current-${process.pid}-${crypto.randomBytes(3).toString('hex')}`);
  fs.symlinkSync(path.join('releases', id), tmp);
  fs.renameSync(tmp, path.join(to, 'current'));
}

/** Run the after-switch command; on failure point `current` back at `previous` and fail. */
function afterSwitch(to, after, previous) {
  if (!after?.length) return;
  try {
    execFileSync(after[0], after.slice(1), { stdio: 'inherit', timeout: 120_000 });
  } catch (e) {
    if (previous) switchTo(to, previous);
    throw new Error(`The after-switch command failed (${after.join(' ')}): ${e.message}. ${previous ? `Switched back to ${previous}.` : 'No earlier release to switch back to.'}`);
  }
}

const gitHead = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

export function deploy({ to, from, private: priv, keep, after = [] }, cwd = process.cwd()) {
  const src = path.resolve(cwd, from);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory() || !fs.readdirSync(src).length) throw new Error(`No build output in ${src}; nothing deployed.`);
  const privSrc = path.resolve(cwd, priv);
  fs.mkdirSync(path.join(to, 'releases'), { recursive: true });
  fs.chmodSync(path.join(to, 'releases'), 0o755);
  if (!(fs.statSync(to).mode & 0o001)) console.warn(`warning: ${to} is not searchable by other users; the web server may not reach current/.`);

  const id = newReleaseId(to);
  const rel = path.join(to, 'releases', id);
  const staging = `${rel}.partial`;
  try {
    // copy, not move: the build folder belongs to the site repo and the next build replaces it
    fs.cpSync(src, path.join(staging, 'public'), { recursive: true, verbatimSymlinks: true });
    if (fs.existsSync(privSrc)) fs.cpSync(privSrc, path.join(staging, 'private'), { recursive: true, verbatimSymlinks: true });
    else fs.mkdirSync(path.join(staging, 'private'));
    fs.writeFileSync(path.join(staging, 'release.json'), JSON.stringify({ id, commit: gitHead(), at: new Date().toISOString() }, null, 2) + '\n');
    makeReadable(staging);
    fs.renameSync(staging, rel);
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
  const previous = currentOf(to);
  switchTo(to, id);
  afterSwitch(to, after, previous);

  // prune: keep the newest `keep` releases, and never the one `current` points at
  const current = currentOf(to);
  for (const old of releasesOf(to).slice(0, -keep)) {
    if (old !== current) fs.rmSync(path.join(to, 'releases', old), { recursive: true, force: true });
  }
  return id;
}

export function rollback({ to, after = [] }) {
  const all = releasesOf(to);
  const i = all.indexOf(currentOf(to));
  if (i < 1) throw new Error('No earlier release to roll back to.');
  switchTo(to, all[i - 1]);
  afterSwitch(to, after, all[i]);
  // the release rolled back from would otherwise come back as "newest" on the next deploy's prune; drop it
  fs.rmSync(path.join(to, 'releases', all[i]), { recursive: true, force: true });
  return all[i - 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const id = opts.cmd === 'rollback' ? rollback(opts) : deploy(opts);
    console.log(`${opts.cmd === 'rollback' ? 'Rolled back to' : 'Deployed'} release ${id} (${path.join(opts.to, 'current')})`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
