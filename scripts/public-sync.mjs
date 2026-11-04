#!/usr/bin/env node
// Copies a clean snapshot of this private repo into the public repo kept at .public-export/ (its own git repo,
// git-ignored here) and commits it there as one commit. No private history is copied. Never pushes.
// docs/PUBLISHING.md says how and why.
//
//   npm run public:sync                          export HEAD, check, commit in .public-export/
//   npm run public:sync -- --dry-run [--all]     list what would change; writes nothing (--all: every path)
//   npm run public:sync -- --ref <commit>        export another commit (a branch, a tag, a sha)
//   npm run public:sync -- --builtin-scan        allow the built-in secret scan alone when gitleaks is missing
//
// Checks before the public commit (any failure stops it; nothing is committed):
//   gitleaks over the export (.gitleaks.toml) and the built-in secret scan; nothing private named (privateText);
//   no file that an exclude rule drops and nothing outside the export list; the required files are there; every
//   path a package.json points at and every relative import is in the export; SECURITY.md's supported-versions
//   table matches package.json; and the export's own check-generic, check-licence and check-lines pass.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { findGitleaks } from './lib/gitleaks.mjs';
import {
  commitMessage,
  countByTop,
  lastSyncedCommit,
  manifestProblems,
  missingImports,
  missingRequired,
  normaliseConfig,
  parseLsTree,
  planChanges,
  privateTextProblems,
  publicPrAuthors,
  publicSubjects,
  selectFiles,
  strayPaths,
} from './lib/public-sync-core.mjs';
import { scanText } from './lib/secret-scan.mjs';
import { supportedVersionsProblem } from './lib/supported-versions.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

function gitOk(args, opts = {}) {
  return spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).status === 0;
}

function fail(message) {
  console.error(`\npublic:sync stopped: ${message}`);
  process.exit(1);
}

function printList(label, paths, limit) {
  if (paths.length === 0) return;
  console.log(`\n${label} (${paths.length}):`);
  for (const p of paths.slice(0, limit)) console.log(`  ${p}`);
  if (paths.length > limit) console.log(`  …and ${paths.length - limit} more (use --dry-run --all to see every path)`);
}

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|ttf|otf|woff2?|wav|mp3|mp4|webm|gz|zip|pdf)$/i;

function readExport(target, paths) {
  return paths.map((p) => {
    if (BINARY.test(p)) return { path: p, text: null };
    const buf = readFileSync(join(target, p));
    return { path: p, text: buf.includes(0) ? null : buf.toString('utf8') };
  });
}

/** Every file in the export folder, its .git aside, as repo paths. */
function filesOnDisk(target, dir = '') {
  const out = [];
  for (const e of readdirSync(join(target, dir), { withFileTypes: true })) {
    if (!dir && e.name === '.git') continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesOnDisk(target, rel));
    else out.push(rel);
  }
  return out;
}

function secretProblems(target, files, allowBuiltinOnly) {
  const problems = [];
  for (const { path: p, text } of files) {
    if (text === null) continue;
    for (const f of scanText(text)) problems.push(`${p}:${f.line}  ${f.rule}  ${f.preview}`);
  }
  const bin = findGitleaks();
  if (bin) {
    const config = existsSync(join(target, '.gitleaks.toml')) ? ['--config', '.gitleaks.toml'] : [];
    // run inside the export, so the paths gitleaks matches its allow-list against are repo paths
    const result = spawnSync(bin, ['dir', '.', '--redact', '--no-banner', '--log-level', 'warn', ...config], {
      cwd: target,
      stdio: 'inherit',
    });
    if (result.status !== 0) problems.push('gitleaks found secrets in the export (listed above, redacted)');
    else console.log('gitleaks: no secrets in the export.');
  } else if (!allowBuiltinOnly) {
    problems.push('gitleaks is not installed. Install it (Mac: brew install gitleaks) or set GITLEAKS_BIN; to rely on the built-in scan alone, rerun with --builtin-scan');
  } else {
    console.log('gitleaks not found: used the built-in scan only (--builtin-scan).');
  }
  return problems;
}

/** The export's own checks (config "checks"), run inside it on the staged files. */
function exportChecks(target, checks) {
  const problems = [];
  for (const { name, run } of checks) {
    const result = spawnSync(run[0], run.slice(1), { cwd: target, encoding: 'utf8' });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (result.status === 0) console.log(`${name}: passed. ${out.split('\n').pop()}`);
    else problems.push(`${name} failed in the export:\n    ${out.split('\n').join('\n    ')}`);
  }
  return problems;
}

function clearWorkTree(target) {
  for (const entry of readdirSync(target)) {
    if (entry === '.git') continue;
    rmSync(join(target, entry), { recursive: true, force: true });
  }
}

function main() {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const configPath = resolve(root, option('--config') ?? 'public-sync.config.json');
  const config = normaliseConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  const target = resolve(root, config.target);
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) fail(`target "${config.target}" must be a folder inside the project`);
  if (!gitOk(['check-ignore', '-q', `${rel}/.probe`], { cwd: root })) fail(`${rel}/ must be git-ignored here (add it to .gitignore)`);

  const ref = option('--ref') ?? 'HEAD';
  const fullSha = git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root }).trim();
  const shortSha = fullSha.slice(0, 8);
  const tree = parseLsTree(git(['ls-tree', '-r', '-z', '--full-tree', fullSha], { cwd: root }));
  const { kept, excluded, notAllowed } = selectFiles([...tree.keys()], config);
  const next = new Map(kept.map((p) => [p, tree.get(p)]));

  const hasRepo = existsSync(join(target, '.git'));
  const hasHead = hasRepo && gitOk(['rev-parse', '--verify', 'HEAD'], { cwd: target });
  const current = hasHead ? parseLsTree(git(['ls-tree', '-r', '-z', 'HEAD'], { cwd: target })) : new Map();
  const plan = planChanges(next, current);
  const changed = plan.added.length + plan.modified.length + plan.deleted.length;

  const dryRun = flag('--dry-run');
  const limit = dryRun && flag('--all') ? Infinity : dryRun ? 200 : 20;
  console.log(`Private ${shortSha} (${ref}) → ${rel}/ ${hasHead ? '' : '(new public repo)'}`);
  console.log(`Files: ${kept.length} exported, ${excluded.length} excluded, ${notAllowed.length} not in the include list.`);
  console.log('\nExported, by top-level folder:');
  for (const [top, n] of countByTop(kept)) console.log(`  ${String(n).padStart(4)}  ${top}`);
  if (excluded.length) {
    console.log('\nExcluded:');
    for (const e of excluded) console.log(`  ${e.path}  (${e.rule}: ${e.why || 'private'})`);
  }
  printList('Not in the include list (add to public-sync.config.json to publish)', notAllowed, limit);
  printList('Added', plan.added, limit);
  printList('Changed', plan.modified, limit);
  printList('Deleted', plan.deleted, limit);
  if (changed === 0) {
    console.log('\nNothing to sync: the public repo already matches.');
    return;
  }
  if (dryRun) {
    console.log(`\nDry run: ${changed} file(s) would change. Nothing was written.`);
    return;
  }

  // Export through a throwaway index inside the public repo's .git, so this repo's own index is untouched.
  if (!hasRepo) {
    mkdirSync(target, { recursive: true });
    git(['init', '-q', '-b', config.branch], { cwd: target });
  }
  clearWorkTree(target);
  const indexFile = join(target, '.git', 'markstage-export-index');
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    git(['read-tree', fullSha], { cwd: root, env });
    git(['checkout-index', '-z', '--stdin', `--prefix=${target}/`], { cwd: root, env, input: kept.join('\0') });
  } finally {
    rmSync(indexFile, { force: true });
  }

  console.log('\nChecking the export…');
  const files = readExport(target, kept);
  const pkg = JSON.parse(files.find((f) => f.path === 'package.json')?.text ?? '{}');
  const security = files.find((f) => f.path === 'SECURITY.md')?.text;
  const problems = [
    ...strayPaths(filesOnDisk(target), kept, config),
    ...missingRequired(kept, config),
    ...privateTextProblems(files, config.privateText),
    ...manifestProblems(files),
    ...missingImports(files, new Set(tree.keys())),
    ...(security ? [supportedVersionsProblem(security, pkg.version)].filter(Boolean) : []),
    ...secretProblems(target, files, flag('--builtin-scan')),
  ];
  // the export's own checks read `git ls-files`, so they run on the staged export
  git(['add', '-A'], { cwd: target });
  problems.push(...exportChecks(target, config.checks));
  if (problems.length) {
    git(hasHead ? ['reset', '-q'] : ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.'], { cwd: target });
    console.error('\nChecks failed:');
    for (const p of problems) console.error(`  ${p}`);
    fail('fix these in the private repo (or in public-sync.config.json), commit, and run again. Nothing was committed.');
  }

  if (gitOk(['diff', '--cached', '--quiet'], { cwd: target })) {
    console.log('\nNothing to commit after export.');
    return;
  }
  const last = hasHead ? lastSyncedCommit(git(['log', '-1', '--format=%B'], { cwd: target })) : null;
  const lastKnown = last && gitOk(['merge-base', '--is-ancestor', last, fullSha], { cwd: root });
  const subjects = lastKnown
    ? git(['log', '--no-merges', '--format=%s', `${last}..${fullSha}`], { cwd: root }).split('\n').filter(Boolean).reverse()
    : [];
  // the contributors of public pull requests re-applied here (a `Public-PR: #<n>` trailer) are credited as co-authors
  const coAuthors = lastKnown ? publicPrAuthors(git(['log', '--no-merges', '--format=%an <%ae>%x1f%B%x1e', `${last}..${fullSha}`], { cwd: root })) : [];
  const message = commitMessage({ shortSha, fullSha, subjects: publicSubjects(subjects, config.privateSubjectWords), first: !hasHead, coAuthors });
  // commitAuthor is both the author and the committer: git records both, and the committer would otherwise be this
  // machine's identity (often a personal email)
  const who = config.commitAuthor?.match(/^(.+?)\s*<([^>]+)>$/);
  if (config.commitAuthor && !who) fail(`commitAuthor must look like "Name <email>", not "${config.commitAuthor}"`);
  const identity = who ? ['-c', `user.name=${who[1]}`, '-c', `user.email=${who[2]}`] : [];
  const author = who ? ['--author', config.commitAuthor] : [];
  // --no-verify: the checks above are the full scan; the public repo's own hook would only repeat them
  git([...identity, 'commit', '-q', '--no-verify', '-F', '-', ...author], { cwd: target, input: message });
  const made = git(['log', '-1', '--format=%h %s'], { cwd: target }).trim();

  const hasRemote = gitOk(['remote', 'get-url', 'origin'], { cwd: target });
  console.log(`\nCommitted in ${rel}/: ${made}`);
  console.log('\nReview it:');
  console.log(`  git -C ${rel} show --stat HEAD`);
  console.log(`  git -C ${rel} commit --amend      # edit the message before pushing`);
  console.log('\nPush it yourself when it looks right (this script never pushes):');
  if (!hasRemote) console.log(`  git -C ${rel} remote add origin ${config.publicRemote || '<public repo URL>'}`);
  console.log(`  git -C ${rel} push ${hasRemote ? '' : '-u '}origin ${config.branch}`);

  // A release tag goes public only on its own, after main is pushed and green, and only when the export says the
  // same version (docs/PUBLISHING.md "Releases"). Never chain it with the sync.
  const tag = `v${pkg.version}`;
  const tagged = git(['tag', '--points-at', fullSha], { cwd: root }).split('\n').filter(Boolean);
  const releaseTags = tagged.filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  if (releaseTags.includes(tag)) {
    console.log(`\nThis is release ${tag}. After main is pushed and the public CI is green, tag it there on its own:`);
    console.log(`  git -C ${rel} tag -a ${tag} -m "Markstage ${tag}"`);
    console.log(`  git -C ${rel} push origin ${tag}`);
  } else if (releaseTags.length) {
    console.log(`\nWarning: ${ref} is tagged ${releaseTags.join(', ')}, but the export's package.json says ${pkg.version}. Do not tag the public repo.`);
  }
}

main();
