// The image's entrypoint (deploy/docker/start.mjs): what each command does, the first config.json (written once,
// never over one that is there), when the site is installed. The image itself is tested by scripts/docker/smoke.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { defaultConfig, ensureConfig, needsInstall, plan, prepareSite } from '../../deploy/docker/start.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-start-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('plan: serve gets the site ready first; server commands get the config; anything else runs as it is', () => {
  assert.deepEqual(plan([]), { prepare: 'all', run: 'server' });
  assert.deepEqual(plan(['serve']), { prepare: 'all', run: 'server' });
  assert.deepEqual(plan(['prepare']), { prepare: 'all', run: null });
  assert.deepEqual(plan(['setup-code']), { prepare: 'config', run: 'server' });
  assert.deepEqual(plan(['reset-password', 'a@example.com']), { prepare: 'config', run: 'server' });
  assert.deepEqual(plan(['npm', 'ci']), { prepare: null, run: 'exec' });
  assert.deepEqual(plan(['sh']), { prepare: null, run: 'exec' });
});

test('defaultConfig: the container paths, argv commands, the edit button aimed at this server', () => {
  const c = defaultConfig({});
  assert.equal(c.contentRoot, '/srv/content');
  assert.deepEqual(c.commands.build, ['npm', 'run', 'build']);
  assert.deepEqual(c.commands.deploy, ['markstage-deploy', '--to', '/srv/site']);
  assert.deepEqual(c.commands.rollback, ['markstage-deploy', 'rollback', '--to', '/srv/site']);
  assert.equal(c.commands.env.MARKSTAGE_CMS_URL, 'http://127.0.0.1:18231');
  assert.equal(defaultConfig({ MARKSTAGE_PUBLIC_ORIGIN: 'https://cms.example.com' }).commands.env.MARKSTAGE_CMS_URL, 'https://cms.example.com');
  assert.equal(defaultConfig({ MARKSTAGE_PORT: '18301' }).commands.env.MARKSTAGE_CMS_URL, 'http://127.0.0.1:18301');
  const { $comment, ...settings } = c;
  assert.match($comment, /never rewritten/);
  assert.doesNotMatch(JSON.stringify(settings), /password|secret|token|key/i, 'no secret in the written config');
});

test('ensureConfig writes config.json once (0600), and never over an existing one', () => {
  const data = path.join(tmp, 'data');
  assert.equal(ensureConfig(data, {}), true);
  const file = path.join(data, 'config.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.writeFileSync(file, '{"contentRoot": "/elsewhere"}\n');
  assert.equal(ensureConfig(data, {}), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"contentRoot": "/elsewhere"}\n');
});

test('needsInstall: a package.json and no finished install', () => {
  const site = path.join(tmp, 'site');
  fs.mkdirSync(path.join(site, 'node_modules'), { recursive: true });
  assert.equal(needsInstall(site), false, 'no package.json: nothing to install');
  fs.writeFileSync(path.join(site, 'package.json'), '{}');
  assert.equal(needsInstall(site), true, 'an empty node_modules (a new volume)');
  fs.writeFileSync(path.join(site, 'node_modules', '.package-lock.json'), '{}');
  assert.equal(needsInstall(site), false);
});

test('prepareSite: off skips it; a folder that is not a git repository stops the start', () => {
  assert.equal(prepareSite(path.join(tmp, 'nowhere'), { MARKSTAGE_SITE_SETUP: 'off' }), true);
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain);
  assert.equal(prepareSite(plain, {}), false);
});
