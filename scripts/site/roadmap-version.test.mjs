// "Coming in x.y.z" must never name a version that is already out. 0.4.0 shipped while the roadmap page still said
// "What Is Coming in 0.4.0": the version was typed by hand. The badge now takes the next minor from package.json
// (roadmap.mjs), and this test fails on any page, README line or site text that still promises a released version.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT } from './build-site.mjs';
import { NEXT, VERSION, nextRelease } from './roadmap.mjs';

const parts = (v) => v.split('.').map(Number);
const notAfter = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return true;
};

test('the next release is the minor after package.json', () => {
  assert.equal(nextRelease('0.4.0'), '0.5.0');
  assert.equal(nextRelease('0.4.3'), '0.5.0');
  assert.equal(nextRelease('1.9.0'), '1.10.0');
  assert.throws(() => nextRelease('latest'));
  assert.equal(NEXT, nextRelease(VERSION));
});

test('no text promises a version that is already out', () => {
  // the promise phrases: "Coming in 0.4.0", "for 0.4.0", "being built … 0.4.0", "from the 0.4.0 release on"
  const promise = /\b(?:coming in|being built now, for|being built for|building now for|until|before|from the)\s+v?(\d+\.\d+\.\d+)/gi;
  const files = ['README.md', 'docs/DOCKER.md', 'docs/STARTER.md'];
  const walk = (dir, ext) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name), ext) : ext.test(d.name) ? [path.join(dir, d.name)] : []));
  const all = [
    ...files.map((f) => path.join(REPO_ROOT, f)),
    ...walk(path.join(REPO_ROOT, 'site-content'), /\.md$/),
    ...walk(path.join(REPO_ROOT, 'site'), /\.(html|txt|xml)$/).filter((f) => !f.includes(`${path.sep}demo${path.sep}`)),
  ];
  const stale = [];
  for (const f of all) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(promise)) if (notAfter(m[1], VERSION)) stale.push(`${path.relative(REPO_ROOT, f)}: "${m[0]}"`);
  }
  assert.deepEqual(stale, [], `version ${VERSION} is out; these still promise it or an older one`);
});
