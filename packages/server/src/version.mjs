// What Markstage runs (core's release.mjs): the version, the commit, the build number and time, and the footer
// line "v0.2.0 · build 256 · Nov 2, 2026 8:49 AM EST". From the checkout's git, or from MARKSTAGE_COMMIT,
// MARKSTAGE_BUILD and MARKSTAGE_BUILT_AT (the Docker build). The line is public (GET /markstage/api/release, the
// footer of every editor screen); the commit goes to signed-in people only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInfo } from '@markstage/core/release';

export const INSTALL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

let info;
/** {version, commit, build, builtAt, timeZone, line}: commit is 12 hex characters or null. */
export function buildInfo(env = process.env) {
  if (!info) info = { ...releaseInfo({ dir: INSTALL_DIR, env }), version: VERSION };
  return info;
}
