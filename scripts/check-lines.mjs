// No source file over 1000 lines (project rule). Checks packages/, examples/ and scripts/ (not node_modules or
// build output); exits 1 and lists the files that are too long.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 1000;
const SKIP = new Set(['node_modules', 'dist', '.astro', '.git', '.public-export']);
const EXT = /\.(mjs|js|ts|astro|css|json|md)$/;

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name === 'package-lock.json') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (EXT.test(e.name)) yield p;
  }
}

const long = [];
let n = 0;
for (const top of ['packages', 'examples', 'scripts', 'docs']) {
  if (!fs.existsSync(path.join(root, top))) continue;
  for (const f of files(path.join(root, top))) {
    n++;
    const lines = fs.readFileSync(f, 'utf8').split('\n').length;
    if (lines > MAX) long.push(`${path.relative(root, f)}: ${lines} lines`);
  }
}
if (long.length) {
  console.error(`Files over ${MAX} lines:\n  ${long.join('\n  ')}`);
  process.exit(1);
}
console.log(`lines: ${n} files, none over ${MAX} lines`);
