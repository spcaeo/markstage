// Finds gitleaks for the pre-commit hook and scripts/public-sync.mjs.
import { spawnSync } from 'node:child_process';

/** The gitleaks binary to use (GITLEAKS_BIN, then PATH), or null when there is none. */
export function findGitleaks(env = process.env) {
  for (const bin of [env.GITLEAKS_BIN, 'gitleaks'].filter(Boolean)) {
    const probe = spawnSync(bin, ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (probe.status === 0) return bin;
  }
  return null;
}
