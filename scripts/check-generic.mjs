// The packages are for any site: no site's names in their code, styles or docs. A site's own words belong in its
// markstage.config and block pack. Two checks:
// - packages/ (code, styles, JSON; tests aside): none of the site words below;
// - every tracked file of the repo (docs, tests, fixtures, scripts, deploy, LICENSE and NOTICE too): none of the names
//   of the business Markstage was first built for. Tests and docs use an example site (Example Co, example.com).
//   One exception: that site's public address, as the showcase, in the files scripts/lib/showcase.mjs lists.
// Exits 1 and lists the hits.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutShowcase } from './lib/showcase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// written in pieces so that this file does not hold the words it looks for
const OWN_NAMES = new RegExp(['task' + 'rhino', 'board' + 'bridge', 'rhino' + 'move'].join('|'), 'i');
const SITE_WORDS = new RegExp(`${OWN_NAMES.source}|sidenote|side-note|sideNote|monday\\.com|calendly|space-?o|\\bstudio\\b`, 'i');
const SKIP = new Set(['node_modules', 'dist', '.astro', 'test']);
// the publish kit's own config lists the first site's names on purpose (so they never go public); it is never
// exported itself (docs/PUBLISHING.md), so it is the one tracked file this check leaves out
const PRIVATE_FILES = new Set(['public-sync.config.json']);

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(mjs|js|ts|astro|css|json)$/.test(e.name)) yield p;
  }
}

const hits = [];
for (const f of files(path.join(root, 'packages'))) {
  fs.readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      // the old dev routes (/studio-api/…) are part of the API contract (docs/API.md "Compatibility")
      if (SITE_WORDS.test(line.replace(/\/studio-api\//g, ''))) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
}

const own = [];
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const rel of tracked) {
  if (PRIVATE_FILES.has(rel)) continue;
  if (OWN_NAMES.test(rel)) own.push(`${rel}: in the file's path`);
  const file = path.join(root, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      // the first site's public address is allowed as the showcase, in the showcase files only (lib/showcase.mjs)
      if (OWN_NAMES.test(withoutShowcase(rel, line))) own.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
}

if (hits.length) console.error(`Site-specific names in packages/:\n  ${hits.join('\n  ')}`);
if (own.length) console.error(`The first site's names in tracked files (use Example Co / example.com instead):\n  ${own.join('\n  ')}`);
if (hits.length || own.length) process.exit(1);
console.log(`generic: no site-specific names in packages/, and none of the first site's names in ${tracked.length} tracked files`);
