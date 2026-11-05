// The footer's release line (release.mjs): "v0.2.0 · build 256 · Nov 2, 2026 8:49 AM EST".
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInfo, releaseLine, releaseTime } from '../src/release.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('the time reads like the owner wrote it, in the zone asked for', () => {
  assert.equal(releaseTime('2026-11-02T13:49:00Z', 'America/Toronto'), 'Nov 2, 2026 8:49 AM EST');
  assert.equal(releaseTime('2026-07-02T13:49:00Z', 'America/Toronto'), 'Jul 2, 2026 9:49 AM EDT');
  assert.equal(releaseTime('not a date', 'America/Toronto'), null);
});

test('the line joins version, build and time with middle dots; unknown parts are left out', () => {
  assert.equal(releaseLine({ version: '2.276.0', build: 1424, builtAt: '2026-11-02T13:49:00Z', timeZone: 'America/Toronto' }), 'v2.276.0 · build 1424 · Nov 2, 2026 8:49 AM EST');
  assert.equal(releaseLine({ version: '0.2.0' }), 'v0.2.0');
});

test('the Docker build passes the facts in the environment; a checkout reads git', () => {
  const env = { MARKSTAGE_COMMIT: 'abcdef1234567890', MARKSTAGE_BUILD: '1424', MARKSTAGE_BUILT_AT: '2026-11-02T13:49:00Z', MARKSTAGE_TIME_ZONE: 'America/Toronto' };
  const r = releaseInfo({ dir: repo, env });
  assert.equal(r.commit, 'abcdef123456');
  assert.equal(r.build, 1424);
  assert.match(r.line, /^v\d+\.\d+\.\d+ · build 1424 · Nov 2, 2026 8:49 AM EST$/);
  const g = releaseInfo({ dir: repo, env: { MARKSTAGE_TIME_ZONE: 'UTC' } });
  assert.match(g.commit ?? '', /^[0-9a-f]{12}$/);
  // the commit count of this checkout: the public repo starts from one snapshot, so no fixed number holds everywhere
  const count = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim());
  assert.ok(count >= 1);
  assert.equal(g.build, count, 'the commit count');
  assert.match(g.line, /^v\d+\.\d+\.\d+ · build \d+ · \w{3} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M UTC$/);
});

test("an install from npm: the folder holds no Markstage package.json, so the version is the package's own", () => {
  const own = JSON.parse(fs.readFileSync(path.join(repo, 'packages/core/package.json'), 'utf8')).version;
  // as @markstage/astro and @markstage/server pass a site's node_modules: no git, no Markstage package.json in it
  const r = releaseInfo({ dir: path.join(repo, 'packages/core/src'), env: { MARKSTAGE_TIME_ZONE: 'UTC' } });
  assert.equal(r.version, own);
  assert.notEqual(r.version, '0.0.0');
  assert.equal(r.line, `v${own}`);
});
