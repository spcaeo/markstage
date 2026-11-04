// Markstage is source-available under the Elastic License 2.0 (LICENSE): "source-available, free to self-host",
// never "open source" and never MIT. Checks every tracked text file (docs, examples, packages, scripts, the root's
// own files) for a claim otherwise, and every package.json of the repo for its licence. NOTICE and LICENSE name the
// licences of the packages Markstage uses, so they are left out. The comparison files may name another product's
// licence, never as Markstage's (scripts/lib/licence-words.mjs). Exits 1 and lists the hits.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenceHits } from './lib/licence-words.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = /\.(mjs|js|ts|astro|css|json|md|mdx|html|txt|yml|yaml)$|(^|\/)(README|TAGLINE|NAME|CONTRIBUTING|SECURITY)[^/]*$/;
// this check and its word list hold the words they look for
const SKIP = /(^|\/)(NOTICE|LICENSE)$|(^|\/)package-lock\.json$|^scripts\/check-licence\.mjs$|^scripts\/lib\/licence-words(\.test)?\.mjs$/;

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const hits = [];
for (const rel of tracked) {
  if (SKIP.test(rel) || !TEXT.test(rel) || !fs.existsSync(path.join(root, rel))) continue;
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (rel.endsWith('package.json')) {
    const license = JSON.parse(text).license;
    if (license !== undefined && license !== 'Elastic-2.0') hits.push(`${rel}: "license": ${JSON.stringify(license)} (Markstage is "Elastic-2.0")`);
  }
  for (const hit of licenceHits(rel, text)) hits.push(`${rel}:${hit.line}: ${hit.text}`);
}
if (hits.length) {
  console.error(`Markstage is source-available (Elastic License 2.0), free to self-host: never "open source" or MIT.\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('licence: no "open source" or MIT claims; every package is Elastic-2.0');
