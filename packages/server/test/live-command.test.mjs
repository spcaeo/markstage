// `markstage-server live <commit>`: a site deployed outside Markstage (by hand, from CI, a ship script) says which
// commit is live, so what Markstage shows as live (the environments' status, an AI agent's env_status, history's
// "live") is not the last commit Markstage itself deployed. The commit before it becomes the rollback's step back.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { makeFixture, startServer, writeFile } from './helpers.mjs';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/markstage-server.mjs');

describe('markstage-server live', () => {
  let fx;
  const run = (...args) => promisify(execFile)(process.execPath, [BIN, 'live', ...args], { env: { ...process.env, MARKSTAGE_DATA_DIR: fx.data, NODE_ENV: 'test' } });
  const commit = (n) => {
    writeFile(fx, `src/content/pages/n${n}.json`, `{"title": "N${n}"}\n`);
    fx.git('add', '-A');
    fx.git('commit', '-q', '-m', `N${n}`);
    return fx.git('rev-parse', 'HEAD').trim();
  };

  before(async () => {
    fx = makeFixture({ checks: false });
    await (await startServer(fx)).close(); // the data dir and its database, as a server leaves them
  });

  test('with nothing recorded, it says so; a commit is recorded as live, the one before kept for a rollback', async () => {
    assert.equal((await run()).stdout.trim(), 'Live: nothing recorded yet');
    const a = commit(1);
    assert.equal((await run(a.slice(0, 7))).stdout.trim(), `Live: ${a}`);
    const b = commit(2);
    assert.equal((await run('HEAD')).stdout.trim(), `Live: ${b}`);
    // the running server reads the same record
    const again = await startServer(fx);
    try {
      assert.equal(again.app.jobs.liveHead(), b);
      assert.deepEqual(again.app.jobs.liveHistory(), [a]);
      const audit = again.app.db.prepare("SELECT user_name, target FROM audit WHERE action = 'deploy.recorded'").all();
      assert.deepEqual(audit.map((r) => [r.user_name, r.target]), [['markstage-server live', a], ['markstage-server live', b]]);
    } finally {
      await again.close();
    }
  });

  test('the same commit again changes nothing; something that is not a commit is refused', async () => {
    const head = fx.git('rev-parse', 'HEAD').trim();
    assert.equal((await run(head)).stdout.trim(), `Live: ${head}`);
    await assert.rejects(run('no-such-commit'), (e) => /is not a commit of the site's repository/.test(e.stderr) && e.code !== 0);
  });
});
