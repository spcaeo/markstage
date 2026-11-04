// Inside/outside checks see through symlinks: a secret file, a backup folder or a key file inside the site repo is
// refused however the path is written (through a linked folder such as macOS /var -> /private/var, or not yet
// existing), and a file merely named "..x" is still inside. One helper (config.mjs realish/isInside) for every check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { isInside, isWithin, loadConfig, realish } from '../src/config.mjs';
import { makeFixture } from './helpers.mjs';

test('realish: links resolved, a missing tail kept; isInside on real paths; "..x" is a name, not a way up', () => {
  const fx = makeFixture({ checks: false });
  const link = path.join(fx.run, 'linked-site');
  fs.symlinkSync(fx.site, link);
  const real = fs.realpathSync(fx.site);
  assert.equal(realish(path.join(link, 'not', 'yet.txt')), path.join(real, 'not', 'yet.txt'));
  assert.ok(isInside(fx.site, path.join(link, 'a.txt')));
  assert.ok(isInside(link, path.join(real, 'a', 'b.txt')));
  assert.ok(isInside(fx.site, path.join(fx.site, '..secret')), 'a name that starts with two dots is inside');
  assert.ok(!isInside(fx.site, path.join(fx.site, '..', 'next-door')));
  assert.ok(!isInside(fx.site, `${fx.site}-private`), 'a sibling with the same start is not inside');
  assert.ok(isWithin(fx.site, path.join(link, 'x')) && !isWithin(fx.site, link), 'within: not the folder itself');
});

test('the repo reached through a linked folder: secrets, backups and key files inside it are refused', () => {
  const fx = makeFixture({ checks: false });
  const link = path.join(fx.run, 'linked-site');
  fs.symlinkSync(fx.site, link);
  const real = fs.realpathSync(fx.site);
  fs.writeFileSync(path.join(fx.site, 'slack.url'), 'https://hooks.slack.com/services/T/B/x');
  fs.writeFileSync(path.join(fx.site, 'key.txt'), 'k'.repeat(32));
  const env = { MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' };
  for (const [root, inside] of [[link, real], [real, link], [fx.site, link]]) {
    const load = (o) => loadConfig({ env, overrides: { contentRoot: root, ...o } });
    assert.throws(() => load({ notify: { slack: { webhookFile: path.join(inside, 'slack.url') } } }), /outside the site repo/, `webhook via ${inside}`);
    assert.throws(() => load({ backup: { dir: path.join(inside, 'backups') } }), /outside the site repo and the data dir/, `backup via ${inside}`);
    assert.throws(() => load({ stock: { provider: 'unsplash', keyFile: path.join(inside, 'key.txt') } }), /keyFile must be outside the content repo/, `key via ${inside}`);
  }
  // and the data dir reached through a link is the data dir
  const dataLink = path.join(fx.run, 'linked-data');
  fs.symlinkSync(fx.data, dataLink);
  assert.throws(() => loadConfig({ env, overrides: { backup: { dir: path.join(dataLink, 'b') } } }), /outside the site repo and the data dir/);
});
