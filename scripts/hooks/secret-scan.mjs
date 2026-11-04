// The pre-commit secret scan.
//   node scripts/hooks/secret-scan.mjs --staged   scan what is staged (the hook; `npm run secrets:scan`)
//   node scripts/hooks/secret-scan.mjs --builtin  the built-in scan only, even when gitleaks is installed
// Always runs the built-in scan on the staged lines (scripts/lib/secret-scan.mjs), and gitleaks too when it is
// installed (PATH, or GITLEAKS_BIN) with .gitleaks.toml. Exit 1 blocks the commit. Never prints a whole secret.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { findGitleaks } from '../lib/gitleaks.mjs';
import { scanDiff } from '../lib/secret-scan.mjs';

const args = new Set(process.argv.slice(2));

function runGitleaks(bin) {
  const config = existsSync('.gitleaks.toml') ? ['--config', '.gitleaks.toml'] : [];
  const result = spawnSync(bin, ['git', '--pre-commit', '--staged', '--redact', '--verbose', '--no-banner', '--log-level', 'warn', ...config, '.'], {
    stdio: 'inherit',
  });
  return result.status === 0;
}

function runBuiltin() {
  const diff = execFileSync(
    'git',
    ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--diff-filter=ACMR'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const findings = scanDiff(diff);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}  ${f.preview}`);
  return findings.length === 0;
}

function main() {
  if (!args.has('--staged') && !args.has('--builtin')) {
    console.error('Usage: node scripts/hooks/secret-scan.mjs --staged [--builtin]');
    process.exit(2);
  }
  const builtinClean = runBuiltin();
  const bin = args.has('--builtin') ? null : findGitleaks();
  const gitleaksClean = bin ? runGitleaks(bin) : true;
  if (builtinClean && gitleaksClean) return;
  console.error(
    [
      '',
      'Commit blocked: the staged changes look like they hold a secret (shown above, masked).',
      'Keep keys in the environment or a git-ignored .env file, never in code, tests or docs.',
      'A test value: make it plainly fake ("fake-key-0001"), or build a key-shaped one at run time from pieces,',
      'or end the line with "// gitleaks:allow". To skip once on purpose: git commit --no-verify',
    ].join('\n'),
  );
  process.exit(1);
}

main();
