// Markstage is source-available under the Elastic License 2.0 (LICENSE): "source-available, free to self-host",
// never "open source" and never MIT. Checks every tracked text file (docs, examples, packages, scripts, the root's
// own files) for a claim otherwise, and every package.json of the repo for its licence. NOTICE and LICENSE name the
// licences of the packages Markstage uses, so they are left out. Exits 1 and lists the hits.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = /\.(mjs|js|ts|astro|css|json|md|mdx|html|txt|yml|yaml)$|(^|\/)(README|TAGLINE|NAME|CONTRIBUTING|SECURITY)[^/]*$/;
const SKIP = /(^|\/)(NOTICE|LICENSE)$|(^|\/)package-lock\.json$|^scripts\/check-licence\.mjs$/;
const CLAIM = /\bopen[\s-]?source\b|\bMIT\b|\bMIT[\s-]licen[cs]ed\b/i;
// words that say what Markstage is not, or name the packages it uses, are fine
const FINE = /\b(not|never) ["“]?(open[\s-]?source|MIT)\b|\bopen-source packages\b/i;

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const hits = [];
for (const rel of tracked) {
  if (SKIP.test(rel) || !TEXT.test(rel) || !fs.existsSync(path.join(root, rel))) continue;
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (rel.endsWith('package.json')) {
    const license = JSON.parse(text).license;
    if (license !== undefined && license !== 'Elastic-2.0') hits.push(`${rel}: "license": ${JSON.stringify(license)} (Markstage is "Elastic-2.0")`);
  }
  text.split('\n').forEach((line, i) => {
    if (CLAIM.test(line) && !FINE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}
if (hits.length) {
  console.error(`Markstage is source-available (Elastic License 2.0), free to self-host: never "open source" or MIT.\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('licence: no "open source" or MIT claims; every package is Elastic-2.0');
