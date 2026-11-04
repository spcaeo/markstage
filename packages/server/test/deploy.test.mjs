// markstage-deploy: atomic switch, private folder, pruning, rollback, and "a failed deploy changes nothing".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { deploy, parseArgs, rollback } from '../bin/markstage-deploy.mjs';
import { TMP_ROOT } from './helpers.mjs';

const sandbox = () => fs.mkdtempSync(path.join(TMP_ROOT, 'deploy-'));
const build = (dir, html, priv) => {
  fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'dist-private'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'dist', 'blog'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), html);
  if (priv) {
    fs.mkdirSync(path.join(dir, 'dist-private', 'secret'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist-private', 'secret', 'index.html'), priv);
  }
};
const live = (to, file = 'public/index.html') => fs.readFileSync(path.join(to, 'current', file), 'utf8');
const opts = (to, extra = {}) => ({ to, from: 'dist', private: 'dist-private', keep: 3, ...extra });

describe('markstage-deploy', () => {
  test('arguments: absolute --to, keep of 2 or more, rollback command', () => {
    assert.deepEqual(parseArgs(['--to', '/srv/site']), { cmd: 'deploy', from: 'dist', private: 'dist-private', keep: 5, to: '/srv/site', after: [] });
    assert.deepEqual(parseArgs(['--to', '/srv/site', '--', 'nginx', '-s', 'reload']).after, ['nginx', '-s', 'reload']);
    assert.throws(() => parseArgs(['--to', '/srv/site', '--']), /Nothing after/);
    assert.equal(parseArgs(['rollback', '--to', '/srv/site']).cmd, 'rollback');
    assert.throws(() => parseArgs(['--to', 'srv/site']), /absolute/);
    assert.throws(() => parseArgs(['--to', '/srv/site', '--keep', '1']), /2 or more/);
    assert.throws(() => parseArgs(['--to', '/srv/site', '--evil', 'x']), /Usage/);
  });

  test('deploys public and private folders behind a relative current symlink', () => {
    const site = sandbox();
    const to = sandbox();
    build(site, 'v1', 'secret v1');
    const id = deploy(opts(to), site);
    assert.equal(fs.readlinkSync(path.join(to, 'current')), path.join('releases', id));
    assert.equal(live(to), 'v1');
    assert.equal(live(to, 'private/secret/index.html'), 'secret v1');
    assert.equal(JSON.parse(live(to, 'release.json')).id, id);
    // a build without a private folder still gets an empty one (protectedPages.dir must exist)
    build(site, 'v2');
    deploy(opts(to), site);
    assert.equal(live(to), 'v2');
    assert.deepEqual(fs.readdirSync(path.join(to, 'current', 'private')), []);
  });

  test('a release is readable by the web server even when the build was written under umask 077', () => {
    const site = sandbox();
    const to = sandbox();
    build(site, 'v1', 'secret');
    for (const f of ['dist/index.html', 'dist-private/secret/index.html']) fs.chmodSync(path.join(site, f), 0o600);
    fs.chmodSync(path.join(site, 'dist/blog'), 0o700);
    deploy(opts(to), site);
    const mode = (p) => fs.statSync(path.join(to, 'current', p)).mode & 0o777;
    assert.equal(mode('public/index.html'), 0o644);
    assert.equal(mode('private/secret/index.html'), 0o644);
    assert.equal(mode('public/blog'), 0o755);
    assert.equal(mode('public'), 0o755);
    assert.equal(fs.statSync(path.join(to, 'releases')).mode & 0o777, 0o755);
  });

  test('an empty or missing build is refused and the live release stays', () => {
    const site = sandbox();
    const to = sandbox();
    build(site, 'v1');
    deploy(opts(to), site);
    fs.rmSync(path.join(site, 'dist'), { recursive: true });
    assert.throws(() => deploy(opts(to), site), /No build output/);
    fs.mkdirSync(path.join(site, 'dist'));
    assert.throws(() => deploy(opts(to), site), /No build output/);
    assert.equal(live(to), 'v1');
    assert.equal(fs.readdirSync(path.join(to, 'releases')).length, 1, 'no partial release left behind');
  });

  test('after-switch command: runs on the new release; if it fails, the old release comes back', () => {
    const site = sandbox();
    const to = sandbox();
    const seen = path.join(site, 'seen.txt');
    const hook = (code) => [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(seen)}, require('fs').readFileSync(${JSON.stringify(path.join(to, 'current/public/index.html'))}, 'utf8')); process.exit(${code})`];
    build(site, 'v1');
    deploy(opts(to, { after: hook(0) }), site);
    assert.equal(fs.readFileSync(seen, 'utf8'), 'v1', 'the hook sees the new release');
    build(site, 'v2');
    assert.throws(() => deploy(opts(to, { after: hook(1) }), site), /after-switch command failed.*Switched back/);
    assert.equal(fs.readFileSync(seen, 'utf8'), 'v2', 'it ran on v2');
    assert.equal(live(to), 'v1', 'and v1 is live again');
  });

  test('keeps the newest releases only, and rollback steps back one', () => {
    const site = sandbox();
    const to = sandbox();
    for (const v of ['v1', 'v2', 'v3', 'v4']) {
      build(site, v);
      deploy(opts(to), site);
    }
    assert.equal(fs.readdirSync(path.join(to, 'releases')).length, 3);
    assert.equal(live(to), 'v4');
    rollback({ to });
    assert.equal(live(to), 'v3');
    rollback({ to });
    assert.equal(live(to), 'v2');
    assert.throws(() => rollback({ to }), /No earlier release/);
    build(site, 'v5');
    deploy(opts(to), site);
    assert.equal(live(to), 'v5');
  });
});
