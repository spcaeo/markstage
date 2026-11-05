// The packages are for any site: no site's names in their code, styles or docs. A site's own words belong in its
// markstage.config and block pack. Two checks (the words: scripts/lib/generic-words.mjs):
// - packages/ (code, styles, JSON; tests aside): none of the site words;
// - every tracked file of the repo (docs, tests, fixtures, scripts, deploy, LICENSE and NOTICE too): none of the names
//   of the business Markstage was first built for. Tests and docs use an example site (Example Co, example.com).
//   One exception: that site's public address, as the showcase, in the files scripts/lib/showcase.mjs lists.
// The npm package guard (scripts/npm-packages.test.mjs) runs the same two checks over each package's tarball.
// Exits 1 and lists the hits.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_FILE, ownNameHits, siteWordHits } from './lib/generic-words.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.astro', 'test']);
// the publish kit's own config lists the first site's names on purpose (so they never go public); it is never
// exported itself (docs/PUBLISHING.md), so it is the one tracked file this check leaves out
const PRIVATE_FILES = new Set(['public-sync.config.json']);

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (CODE_FILE.test(e.name)) yield p;
  }
}

const hits = [];
for (const f of files(path.join(root, 'packages'))) hits.push(...siteWordHits(path.relative(root, f), fs.readFileSync(f, 'utf8')));

const own = [];
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const rel of tracked) {
  if (PRIVATE_FILES.has(rel)) continue;
  const file = path.join(root, rel);
  const text = fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : '';
  own.push(...ownNameHits(rel, text));
}

if (hits.length) console.error(`Site-specific names in packages/:\n  ${hits.join('\n  ')}`);
if (own.length) console.error(`The first site's names in tracked files (use Example Co / example.com instead):\n  ${own.join('\n  ')}`);
if (hits.length || own.length) process.exit(1);
console.log(`generic: no site-specific names in packages/, and none of the first site's names in ${tracked.length} tracked files`);
