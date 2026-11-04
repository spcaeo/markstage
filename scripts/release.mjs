// A Markstage release: `npm run release -- patch|minor|major` (or an exact version). It bumps the version in every
// package (and the @markstage/* dependency ranges between them), refreshes package-lock, commits "Release vX.Y.Z"
// and tags vX.Y.Z. Run on a clean main after the tests; then push main and the tag. The build number and time
// are not here: they come from git at build time (core's release.mjs), so the footer reads
// "v0.2.0 · build 256 · Nov 2, 2026 8:49 AM EST" without any hand-kept counter. docs/RELEASES.md says more.
// It also writes SECURITY.md's supported-versions table for the new version (scripts/lib/supported-versions.mjs);
// `npm run release -- --security-table` writes that table for the current version and changes nothing else.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSupportedBlock } from './lib/supported-versions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args, opts = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', ...opts }).trim();
const PACKAGES = ['packages/core', 'packages/server', 'packages/editor', 'packages/astro'];
// workspaces that only depend on the packages: their @markstage/* ranges follow, their own version stays
const USERS = ['examples/blog'];

const want = process.argv[2];
const security = path.join(root, 'SECURITY.md');
const writeSecurityTable = (version) => fs.writeFileSync(security, withSupportedBlock(fs.readFileSync(security, 'utf8'), version));
if (want === '--security-table') {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  writeSecurityTable(version);
  console.log(`SECURITY.md: supported-versions table written for ${version}`);
  process.exit(0);
}
if (!want) {
  console.error('usage: npm run release -- patch|minor|major|<x.y.z>   (or --security-table)');
  process.exit(2);
}
if (run(['status', '--porcelain', '--', 'package.json', 'package-lock.json', 'SECURITY.md', ...[...PACKAGES, ...USERS].map((p) => `${p}/package.json`)])) {
  console.error('release: package files have uncommitted changes; commit or drop them first');
  process.exit(1);
}
const current = JSON.parse(fs.readFileSync(path.join(root, 'packages/core/package.json'), 'utf8')).version;
let next = want;
if (['patch', 'minor', 'major'].includes(want)) {
  const [a, b, c] = current.split('.').map(Number);
  next = want === 'major' ? `${a + 1}.0.0` : want === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`release: "${next}" is not a version like 1.2.3`);
  process.exit(2);
}
const files = [];
for (const p of ['.', ...PACKAGES, ...USERS]) {
  const file = path.join(root, p, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!USERS.includes(p)) pkg.version = next;
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[key] ?? {})) if (name.startsWith('@markstage/') && /^\d/.test(pkg[key][name])) pkg[key][name] = next;
  }
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  files.push(path.relative(root, file));
}
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
files.push('package-lock.json');
writeSecurityTable(next);
files.push('SECURITY.md');
run(['add', '--', ...files]);
run(['commit', '-q', '-m', `Release v${next}\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`]);
run(['tag', '-a', `v${next}`, '-m', `Markstage v${next}`]);
console.log(`Release v${next} (was ${current}): committed and tagged. Now: git push origin main v${next}`);
