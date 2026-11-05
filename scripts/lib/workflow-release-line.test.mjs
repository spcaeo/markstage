// The release line ("v0.3.0 · build 456 · Nov 4, 2026 7:04 PM EST") on things our CI builds for people to see.
// The build number counts commits, so a shallow checkout says "build 1"; the time is in the maintainers' zone.
// A workflow that builds the editor for the public (the live demo) must clone the whole history and set the zone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflows = path.join(root, '.github/workflows');

// workflows whose output carries a release line people read
const PUBLIC_BUILDS = fs
  .readdirSync(workflows)
  .filter((f) => /\.ya?ml$/.test(f))
  .filter((f) => /npm run demo:build/.test(fs.readFileSync(path.join(workflows, f), 'utf8')));

test('the live demo is built by a workflow', () => {
  assert.ok(PUBLIC_BUILDS.length > 0, 'no workflow runs npm run demo:build');
});

for (const f of PUBLIC_BUILDS) {
  test(`${f}: the demo's release line has a real build number and the Toronto time`, () => {
    const yml = fs.readFileSync(path.join(workflows, f), 'utf8');
    for (const m of yml.matchAll(/- uses: actions\/checkout@[^\n]*\n((?:\s{8,}[^\n]*\n)*)/g)) {
      assert.match(m[1], /fetch-depth:\s*0\b/, `${f}: a checkout without fetch-depth: 0 gives "build 1"`);
    }
    assert.match(yml, /MARKSTAGE_TIME_ZONE:\s*America\/Toronto/, `${f}: set MARKSTAGE_TIME_ZONE: America/Toronto`);
  });
}
