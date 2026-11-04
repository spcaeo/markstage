// The command lines of Environments: the developer's `markstage` (packages/astro/bin, node and git only) against a
// staging server, and `markstage-server env` on the server itself. The token is a test one made here.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { as } from './helpers.mjs';
import { envCommand } from '../src/env/cli.mjs';
import { LAYOUT_V2, PRODUCTION, STAGING, commit, makeEnvFixture, sh, startEnv, waitJob } from './env-fixture.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../astro/bin/markstage.mjs');

describe('Environments from the command line', () => {
  let fx, prod, staging, sOwner, pOwner, cfg;
  /** Run the laptop CLI in the developer's clone (async: the servers answer in this same process). */
  // git on the test's bare HOME has no identity of its own (a Linux box with a bare hostname refuses to commit)
  const GIT_WHO = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' };
  const cli = (args, input = null) =>
    new Promise((resolve) => {
      const child = execFile(process.execPath, [BIN, ...args], { cwd: fx.laptop, env: { PATH: process.env.PATH, HOME: fx.run, MARKSTAGE_CONFIG_DIR: cfg, MARKSTAGE_POLL_MS: '100', ...GIT_WHO } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout, err: stderr }));
      child.stdin.end(input ?? '');
    });

  before(async () => {
    fx = makeEnvFixture();
    cfg = path.join(fx.run, 'cli-config');
    prod = await startEnv(fx, 'production', { environment: PRODUCTION });
    staging = await startEnv(fx, 'staging', { environment: STAGING(prod.base) });
    pOwner = await as(prod, 'owner');
    sOwner = await as(staging, 'owner');
    for (const [srv, c] of [[prod, pOwner], [staging, sOwner]]) await waitJob(srv, (await c.post('/site/publish', {})).json.job);
  });
  after(async () => {
    await prod?.close();
    await staging?.close();
  });

  test('login keeps the token in a 0600 file; a wrong token is refused and nothing is kept', async () => {
    const bad = await cli(['login', staging.base, '--token-stdin'], 'mst_not-a-real-token-at-all-xx\n');
    assert.equal(bad.code, 1);
    assert.match(bad.err, /The server did not take the token: Unknown token\./);
    assert.equal(fs.existsSync(path.join(cfg, 'credentials')), false);
    const t = await sOwner.post('/me/tokens', { name: 'Laptop', scopes: ['env:read', 'env:promote'], days: 30 });
    const ok = await cli(['login', staging.base, '--token-stdin'], `${t.json.secret}\n`);
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /Signed in to staging \(http:\/\/127\.0\.0\.1:\d+\), branch staging\./);
    assert.equal(ok.out.includes(t.json.secret), false, 'the token is never printed');
    assert.equal(fs.statSync(path.join(cfg, 'credentials')).mode & 0o777, 0o600);
    const st = await cli(['status']);
    assert.match(st.out, /^This copy: main, 0 to push, 0 to pull$/m);
    assert.match(st.out, /^staging \(http:\/\/127\.0\.0\.1:\d+\): staging at [0-9a-f]{7}, live [0-9a-f]{7}; \d+ to sync down from main$/m);
  });

  test('promote <branch> staging --run: the plan, its summary, and it goes live', async () => {
    sh(fx.laptop, 'checkout', '-q', '-b', 'cli-change');
    commit(fx.laptop, { 'src/layouts/page.html': LAYOUT_V2 }, 'A new layout');
    const unpushed = await cli(['promote', 'cli-change', 'staging']);
    assert.equal(unpushed.code, 1);
    assert.match(unpushed.err, /cli-change is not on the remote\. Push it first: git push origin cli-change/);
    sh(fx.laptop, 'push', '-q', 'origin', 'cli-change');
    assert.match((await cli(['promote', 'cli-change', 'production'])).err, /You are not signed in to production \(you are to staging\)/);
    const r = await cli(['promote', 'cli-change', 'staging', '--run', '--reason', 'Try the layout']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /promote cli-change → staging: ready/);
    assert.match(r.out, /1 template changed; 4 pages look different; 3 checks passed\./);
    assert.match(r.out, /Allowed by the rule “Developers promote any branch to staging”\./);
    assert.match(r.out, /Live on staging\./);
    assert.match(fs.readFileSync(path.join(fx.stagingLive, 'index.html'), 'utf8'), /Site v2/);
  });

  test('pull merges the latest production content into the branch', async () => {
    const cur = await pOwner.get('/collections/pages/entries/about');
    const pub = await pOwner.post('/collections/pages/entries/about/publish', { version: cur.json.version, changes: [{ path: 'sections.0.value.heading', value: 'Fresh from production' }] });
    assert.equal((await waitJob(prod, pub.json.job)).status, 'succeeded');
    fs.writeFileSync(path.join(fx.laptop, 'scratch.txt'), 'x');
    assert.match((await cli(['pull'])).err, /changes that are not committed/);
    fs.rmSync(path.join(fx.laptop, 'scratch.txt'));
    const r = await cli(['pull']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Merged the latest main into cli-change\./);
    assert.match(fs.readFileSync(path.join(fx.laptop, 'src/content/pages/about.json'), 'utf8'), /Fresh from production/);
    assert.match((await cli(['pull'])).out, /Already up to date with main\./);
  });

  test('markstage-server env: status, a refusal in words, and a promotion run as a named person', async () => {
    const lines = [];
    const out = (l) => lines.push(l);
    assert.equal(await envCommand(prod.app, ['status'], out), 0);
    assert.match(lines[0], /^production \(production\) on main at [0-9a-f]{7}; live [0-9a-f]{7}$/);
    const ed = await as(prod, 'editor');
    await assert.rejects(envCommand(prod.app, ['promote', 'staging', '--as', ed.user.email], out), /No rule lets editor-[0-9a-f]+ promote from staging to production\./);
    await assert.rejects(envCommand(prod.app, ['promote', 'staging'], out), /Say who runs it: --as/);
    lines.length = 0;
    const code = await envCommand(prod.app, ['promote', 'staging', '--run', '--reason', 'From the server', '--as', pOwner.user.email], out);
    assert.equal(code, 0, lines.join('\n'));
    assert.match(lines.join('\n'), /promote staging \(staging\) → production: ready/);
    assert.match(lines.at(-1), /^\nLive at .*: done$/);
    assert.match(fs.readFileSync(path.join(fx.prodLive, 'index.html'), 'utf8'), /Site v2/);
  });
});
