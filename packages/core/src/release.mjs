// What a Markstage install is, in one line for the footer: "v0.2.0 · build 256 · Nov 2, 2026 8:49 AM EST".
// The version is the package's; the build number is the count of commits on the checkout (it only goes up on main);
// the time is that commit's. The Docker build, which has no .git, passes them as MARKSTAGE_COMMIT, MARKSTAGE_BUILD
// and MARKSTAGE_BUILT_AT. The server (Your account, `markstage-server version`, GET /markstage/api/release) and
// the editor build (the footer of every screen, stamped by Vite) call the same function, so both show one line;
// the site's smoke test compares them. The zone: MARKSTAGE_TIME_ZONE, else TZ, else the machine's.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (dir, args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
};

/** The time as the footer shows it, in `timeZone`: "Nov 2, 2026 8:49 AM EST". */
export function releaseTime(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let f;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch {
    f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  // "Nov 2, 2026, 8:49 AM EST" without the comma after the year. Newer ICU builds (macOS Node) put a narrow
  // no-break space (U+202F) or a no-break space before "AM"; plain spaces keep the line the same on every machine.
  return f
    .formatToParts(d)
    .map((p) => (p.type === 'literal' && p.value === ', ' ? ' ' : p.value))
    .join('')
    .replace(/[  ]/g, ' ')
    .replace(/^(\w+ \d+) (\d{4})/, '$1, $2');
}

/** {version, commit, build, builtAt, timeZone, line} for the install at `dir` (the repo root). */
export function releaseInfo({ dir, env = process.env } = {}) {
  let version = '0.0.0';
  // the checkout's root, its core package, else this package's own (an install from npm: `dir` is then the site's
  // node_modules, which has neither; the four packages always share one version)
  for (const p of [path.join(dir, 'package.json'), path.join(dir, 'packages/core/package.json'), new URL('../package.json', import.meta.url)]) {
    try {
      const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
      if (v) {
        version = v;
        break;
      }
    } catch {
      /* the next file */
    }
  }
  const hasGit = fs.existsSync(path.join(dir, '.git'));
  const commit = (/^[0-9a-f]{7,40}$/.test(env.MARKSTAGE_COMMIT ?? '') ? env.MARKSTAGE_COMMIT : hasGit ? git(dir, ['rev-parse', 'HEAD']) : null)?.slice(0, 12) ?? null;
  const build = /^\d+$/.test(env.MARKSTAGE_BUILD ?? '') ? Number(env.MARKSTAGE_BUILD) : hasGit ? Number(git(dir, ['rev-list', '--count', 'HEAD'])) || null : null;
  const builtAt = env.MARKSTAGE_BUILT_AT && !Number.isNaN(Date.parse(env.MARKSTAGE_BUILT_AT)) ? new Date(env.MARKSTAGE_BUILT_AT).toISOString() : hasGit ? git(dir, ['log', '-1', '--format=%cI']) : null;
  const timeZone = env.MARKSTAGE_TIME_ZONE || env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { version, commit, build, builtAt: builtAt ? new Date(builtAt).toISOString() : null, timeZone, line: releaseLine({ version, build, builtAt, timeZone }) };
}

/** The footer line from its parts; a part that is not known is left out. */
export function releaseLine({ version, build, builtAt, timeZone }) {
  const parts = [`v${version}`];
  if (build) parts.push(`build ${build}`);
  const when = builtAt ? releaseTime(builtAt, timeZone) : null;
  if (when) parts.push(when);
  return parts.join(' · ');
}
