// The root "prepare" script runs this on `npm ci` and `npm install`: it points git at scripts/hooks, so the
// pre-commit secret scan runs on every commit. It does nothing outside a git checkout, in CI, for a production
// install (`--omit=dev`), or with MARKSTAGE_SKIP_HOOKS=1, and leaves another hooks folder alone.
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function main() {
  const env = process.env;
  if (env.CI || env.MARKSTAGE_SKIP_HOOKS === '1' || /\bdev\b/.test(env.npm_config_omit ?? '') || env.NODE_ENV === 'production') return;
  try {
    if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') return;
  } catch {
    return; // no git, or not a checkout
  }
  let current = '';
  try {
    current = git(['config', '--get', 'core.hooksPath']);
  } catch {
    current = '';
  }
  if (current === 'scripts/hooks') return;
  if (current) {
    console.log(`Git hooks: core.hooksPath is already "${current}", left as it is. The secret scan is scripts/hooks/pre-commit.`);
    return;
  }
  execFileSync('git', ['config', 'core.hooksPath', 'scripts/hooks'], { stdio: 'ignore' });
  console.log('Git hooks: the pre-commit secret scan is on (scripts/hooks).');
}

main();
