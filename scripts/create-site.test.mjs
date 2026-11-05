// scripts/create-site.mjs: a copy of the starter without build output or installs, this checkout's packages as
// tarballs in vendor/, and a package.json that takes all three from there. The install and the site's own tests run
// in CI's Docker job (scripts/docker/smoke.mjs); here, no network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { REPO, STARTER, copyStarter, createSite, slug, updateSite, withVendor } from './create-site.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-create-site-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const version = JSON.parse(fs.readFileSync(path.join(REPO, 'packages/core/package.json'), 'utf8')).version;

test('slug: a folder name becomes a package name', () => {
  assert.equal(slug('My Blog!'), 'my-blog');
  assert.equal(slug('---'), 'my-site');
});

test('withVendor: the three packages from vendor/, overrides for the two the integration needs', () => {
  const deps = { '@markstage/astro': 'file:vendor/a.tgz', '@markstage/core': 'file:vendor/c.tgz', '@markstage/editor': 'file:vendor/e.tgz' };
  const pkg = withVendor({ name: 'markstage-starter', dependencies: { '@markstage/astro': '0.3.0', astro: '7.4.4' } }, deps, { name: 'my-blog' });
  assert.equal(pkg.name, 'my-blog');
  assert.deepEqual(pkg.dependencies, { ...deps, astro: '7.4.4' });
  assert.deepEqual(pkg.overrides, { '@markstage/core': 'file:vendor/c.tgz', '@markstage/editor': 'file:vendor/e.tgz' });
});

test('copyStarter leaves out installs and build output, and refuses a folder that is not empty', () => {
  const src = path.join(tmp, 'src');
  fs.cpSync(STARTER, src, { recursive: true, filter: (f) => !f.includes('node_modules') });
  for (const d of ['node_modules/x', 'dist', '.astro']) fs.mkdirSync(path.join(src, d), { recursive: true });
  const to = path.join(tmp, 'copy');
  copyStarter(to, { from: src });
  assert.ok(fs.existsSync(path.join(to, 'markstage.config.mjs')));
  assert.ok(fs.existsSync(path.join(to, 'src/content/guides/using-components.mdx')));
  for (const d of ['node_modules', 'dist', '.astro']) assert.ok(!fs.existsSync(path.join(to, d)), d);
  assert.throws(() => copyStarter(to, { from: src }), /not empty/);
});

test('createSite (no install, no git): vendor/ holds the three tarballs and package.json points at them', { timeout: 120_000 }, () => {
  const site = path.join(tmp, 'My Blog');
  const { deps } = createSite(site, { install: false, git: false });
  const pkg = JSON.parse(fs.readFileSync(path.join(site, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'my-blog');
  for (const p of ['astro', 'core', 'editor']) {
    const file = `markstage-${p}-${version}.tgz`;
    assert.equal(pkg.dependencies[`@markstage/${p}`], `file:vendor/${file}`);
    const list = execFileSync('tar', ['-tzf', path.join(site, 'vendor', file)], { encoding: 'utf8' });
    assert.match(list, /^package\/package\.json$/m, `${file} is an npm package`);
  }
  assert.equal(deps['@markstage/astro'], pkg.dependencies['@markstage/astro']);
  assert.equal(pkg.dependencies.astro, JSON.parse(fs.readFileSync(path.join(STARTER, 'package.json'), 'utf8')).dependencies.astro);
  assert.ok(!fs.existsSync(path.join(site, '.git')), '--no-git');

  // --update packs again: still exactly three tarballs
  fs.writeFileSync(path.join(site, 'vendor', 'markstage-core-0.0.1.tgz'), 'old');
  updateSite(site, { install: false });
  assert.deepEqual(fs.readdirSync(path.join(site, 'vendor')).sort(), ['astro', 'core', 'editor'].map((p) => `markstage-${p}-${version}.tgz`));
});
